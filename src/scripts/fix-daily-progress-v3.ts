import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra";
const FOLDER_ID    = "1JQeh1AMB02E1gIl_tqHKvvc3GQoHRbws";

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name}`);

const nodeIdx = (name: string) => wf.nodes.findIndex((n: any) => n.name === name);

// ── 1. Drive: List Progress Files — all docs ───────────────────────────────
wf.nodes[nodeIdx("Drive: List Progress Files")].parameters.queryParameters = {
  parameters: [
    { name: "q",
      value: `mimeType='application/vnd.google-apps.document' and '${FOLDER_ID}' in parents and trashed=false` },
    { name: "fields",  value: "files(id,name,mimeType)" },
    { name: "orderBy", value: "name desc" },
  ]
};
console.log("✅ Drive: List Progress Files");

// ── 2. Code: Get Google Docs — filter by DATE name (last 3 days only) ─────
// Doc names are MM/DD/YYYY. We only process docs from the last 3 days.
// This prevents processing old docs every run — no static data needed.
wf.nodes[nodeIdx("Code: Get Google Docs")].parameters.jsCode = `
// Only process docs whose name (= date) is within the last 3 days.
// Doc names are MM/DD/YYYY format. Anything older is already in ClickUp.
var raw = $input.item.json.files || [];
var files;
try { files = Array.isArray(raw) ? raw : JSON.parse(raw); }
catch(e) { files = []; }

var now = new Date();
var threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

var newFiles = files.filter(function(f) {
  if (!f.name) return false;
  // Only accept MM/DD/YYYY named docs (skip "January 2026", timesheets, etc.)
  var m = f.name.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/);
  if (!m) return false;
  var docDate = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
  return docDate >= threeDaysAgo;
});

if (newFiles.length === 0) {
  console.log('No docs in last 3 days');
  return [{ json: { _skip: true, message: 'no new docs' } }];
}
console.log('Docs to process: ' + newFiles.map(function(f) { return f.name; }).join(', '));
return newFiles.map(function(f) {
  return { json: { docId: f.id, date: f.name, name: f.name } };
});
`.trim();
console.log("✅ Code: Get Google Docs — date-based filter (last 3 days)");

// ── 3. Code: Extract Text by Date — skip on _skip signal ─────────────────
const extractCode: string = wf.nodes[nodeIdx("Code: Extract Text by Date")].parameters.jsCode;
const skipCheck = `
// Skip signal from upstream
if ($input.all().length === 1 && $input.all()[0].json._skip) {
  return [];
}
`;
if (!extractCode.includes('_skip')) {
  wf.nodes[nodeIdx("Code: Extract Text by Date")].parameters.jsCode =
    skipCheck.trim() + "\n\n" + extractCode;
}
console.log("✅ Code: Extract Text by Date — handles _skip signal");

// ── 4. Fix Claude prompt — correct field names ─────────────────────────────
wf.nodes[nodeIdx("Claude: Filter Angel Tasks")].parameters.body = `={{ JSON.stringify({
  "model": "${process.env.ANTHROPIC_MODEL || 'claude-opus-4-6'}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": [{
      "type": "text",
      "text": "Project: " + $json.project + "\\nDate: " + $json.date + "\\n\\n=== PROJECT TAB CONTENT ===\\n" + $json.projectContent + "\\n\\n=== SEAN'S TASK LIST ===\\n" + ($json.seanTaskContent || '(none)') + "\\n\\nExtract tasks for project '" + $json.project + "' on " + $json.date + ". Only include sections that have items:\\n**Completed:**\\n- item\\n**In Progress:**\\n- item\\n**To-do:**\\n- item\\n**Blockage:**\\n- item\\n**Questions & Suggestions:**\\n- item\\n\\nReturn only the formatted list. If no tasks, return exactly: NO_TASKS"
    }]
  }]
}) }}`;
console.log("✅ Claude prompt — $json.project + $json.projectContent (correct fields)");

// ── 5. Code: Format for ClickUp — 1-in/1-out, valid return format ─────────
// Gets date+listId from $('Code: Extract Text by Date').item (not from Claude response)
wf.nodes[nodeIdx("Code: Format for ClickUp")].parameters.mode = "runOnceForEachItem";
wf.nodes[nodeIdx("Code: Format for ClickUp")].parameters.jsCode = `
// Extract Claude's text response
var claudeText = '';
try {
  var content = $input.item.json.content || [];
  claudeText = (Array.isArray(content) ? (content[0] ? content[0].text : '') : content) || '';
} catch(e) { claudeText = ''; }
claudeText = (claudeText || '').trim();

if (!claudeText || claudeText === 'NO_TASKS') {
  return { json: { _skip: true } };
}

// Get date and listId from the Extract Text by Date node (2 nodes upstream)
var extractItem = $('Code: Extract Text by Date').item.json;
var date   = extractItem.date;
var listId = extractItem.listId;

if (!date || !listId) {
  return { json: { _skip: true } };
}

return { json: { date: date, listId: listId, description: claudeText } };
`.trim();

// Ensure connections are right: Claude → Format → ClickUp
wf.connections["Claude: Filter Angel Tasks"] = {
  main: [[{ node: "Code: Format for ClickUp", type: "main", index: 0 }]],
};
// Ensure Format → ClickUp connection
if (!wf.connections["Code: Format for ClickUp"]) {
  wf.connections["Code: Format for ClickUp"] = {
    main: [[{ node: "ClickUp: Create Daily Task", type: "main", index: 0 }]],
  };
}
console.log("✅ Code: Format for ClickUp — fixed return format, gets date from Extract node");

// ── 6. Add IF node to skip _skip items before ClickUp ─────────────────────
// Check if there's already an IF node; if not, we need ClickUp to handle _skip
// Simplest: add _skip check inside ClickUp's pre-condition
// Actually: use a Code node before ClickUp that filters _skip
const preClickUpIdx = wf.nodes.findIndex((n: any) => n.name === "Code: Skip Filter");
if (preClickUpIdx === -1) {
  const formatNode = wf.nodes.find((n: any) => n.name === "Code: Format for ClickUp");
  const clickupNode = wf.nodes.find((n: any) => n.name === "ClickUp: Create Daily Task");

  const skipFilterNode = {
    id: "skip-filter",
    name: "Code: Skip Filter",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [
      Math.round((formatNode.position[0] + clickupNode.position[0]) / 2),
      formatNode.position[1],
    ],
    parameters: {
      mode: "runOnceForEachItem",
      jsCode: `
// Drop _skip items — only pass valid items to ClickUp
if ($input.item.json._skip) {
  console.log('Skipping item (no tasks)');
  return null;
}
return { json: $input.item.json };
`.trim(),
    },
  };
  wf.nodes.push(skipFilterNode);
  wf.connections["Code: Format for ClickUp"] = {
    main: [[{ node: "Code: Skip Filter", type: "main", index: 0 }]],
  };
  wf.connections["Code: Skip Filter"] = {
    main: [[{ node: "ClickUp: Create Daily Task", type: "main", index: 0 }]],
  };
  console.log("✅ Added Code: Skip Filter (drops _skip items before ClickUp)");
}

// ── 7. ClickUp: Create Daily Task ─────────────────────────────────────────
const clickupIdx = nodeIdx("ClickUp: Create Daily Task");
wf.nodes[clickupIdx].parameters.url =
  `=https://api.clickup.com/api/v2/list/{{ $json.listId }}/task`;
wf.nodes[clickupIdx].parameters.body =
  `={{ JSON.stringify({ "name": $json.date, "markdown_description": $json.description }) }}`;
console.log("✅ ClickUp — name=$json.date, markdown_description=$json.description");

// ── 8. Save ───────────────────────────────────────────────────────────────
await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});

const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, staticData: wf.staticData ?? null,
  }),
});
const putData = await putRes.json();
if (!putRes.ok) {
  console.error("❌ Save failed:", JSON.stringify(putData, null, 2));
  process.exit(1);
}
console.log(`✅ Saved — ${wf.nodes.length} nodes`);
console.log(`
Pipeline:
  Run Backfill / Daily:8am
  → Drive: List Progress Files    (all Google Docs in folder)
  → Code: Get Google Docs         (DATE FILTER: only last 3 days, skips non-date files)
  → Docs: Read Content
  → Code: Extract Text by Date    (per-project+date, skips empty tabs)
  → Claude: Filter Angel Tasks    (fixed: uses $json.project / $json.projectContent)
  → Code: Format for ClickUp      (fixed return format, gets date from Extract node)
  → Code: Skip Filter             (drops NO_TASKS items)
  → ClickUp: Create Daily Task    (one task per project per date)
`);
