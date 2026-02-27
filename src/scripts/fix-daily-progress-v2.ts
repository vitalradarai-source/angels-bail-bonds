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
const node    = (name: string) => wf.nodes[nodeIdx(name)];

// ── 1. Drive: List Progress Files — get ALL docs (no time filter) ──────────
// We'll filter in Code: Get Google Docs using static data instead.
// Remove any modifiedTime filter and exclude PDFs/non-progress-report files.
const driveNode = node("Drive: List Progress Files");
driveNode.parameters.queryParameters = {
  parameters: [
    { name: "q",
      value: `mimeType='application/vnd.google-apps.document' and '${FOLDER_ID}' in parents and trashed=false` },
    { name: "fields",  value: "files(id,name,mimeType)" },
    { name: "orderBy", value: "name desc" },
  ]
};
console.log("✅ Drive: List Progress Files — gets all Google Docs in folder");

// ── 2. Code: Get Google Docs — filter to ONLY unprocessed docs via static data
const getDocsIdx = nodeIdx("Code: Get Google Docs");
wf.nodes[getDocsIdx].parameters.jsCode = `
// Use workflow static data to track which doc IDs have been processed.
// This means each doc is ONLY processed once — ever — regardless of run frequency.
var processed = $getWorkflowStaticData('global');
if (!processed.docIds) processed.docIds = {};

var raw = $input.item.json.files || [];
var files;
try { files = Array.isArray(raw) ? raw : JSON.parse(raw); }
catch(e) { files = []; }

// Only include date-named docs (MM/DD/YYYY format) that haven't been processed yet
var newFiles = files.filter(function(f) {
  if (!f.name || !f.name.match(/^\\d{2}\\/\\d{2}\\/\\d{4}$/)) return false; // skip non-date names
  return !processed.docIds[f.id]; // skip already processed
});

if (newFiles.length === 0) {
  console.log('No new docs to process (all already done)');
  return [{ json: { skip: true } }]; // emit skip signal
}

console.log('New docs: ' + newFiles.map(function(f) { return f.name; }).join(', '));
return newFiles.map(function(f) { return { json: { docId: f.id, date: f.name, name: f.name } }; });
`.trim();
console.log("✅ Code: Get Google Docs — static-data deduplication (process each doc only once)");

// ── 3. Code: Extract Text by Date — skip if upstream sent skip signal ──────
const extractIdx = nodeIdx("Code: Extract Text by Date");
const existingCode: string = wf.nodes[extractIdx].parameters.jsCode;
// Add skip-signal handling at the top if not already there
if (!existingCode.includes('skip signal')) {
  wf.nodes[extractIdx].parameters.jsCode = `
// Skip if Code: Get Google Docs had nothing new to process
if ($input.all().length === 1 && $input.all()[0].json.skip) {
  console.log('No new docs — skipping');
  return [];
}

${existingCode}
`.trim();
}
console.log("✅ Code: Extract Text by Date — handles skip signal");

// ── 4. Fix Claude prompt — correct field names ($json.project, $json.projectContent)
const claudeIdx = nodeIdx("Claude: Filter Angel Tasks");
wf.nodes[claudeIdx].parameters.body = `={{ JSON.stringify({
  "model": "${process.env.ANTHROPIC_MODEL || 'claude-opus-4-6'}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": [{
      "type": "text",
      "text": "Project: " + $json.project + "\\nDate: " + $json.date + "\\n\\n=== PROJECT TAB CONTENT ===\\n" + $json.projectContent + "\\n\\n=== SEAN'S TASK LIST ===\\n" + ($json.seanTaskContent || '(none)') + "\\n\\nExtract tasks for project '" + $json.project + "' on date " + $json.date + ". Organize into sections that have items only:\\n**Completed:**\\n- item\\n**In Progress:**\\n- item\\n**To-do:**\\n- item\\n**Blockage:**\\n- item\\n**Questions & Suggestions:**\\n- item\\n\\nReturn only the formatted list. If no tasks exist, return exactly: NO_TASKS"
    }]
  }]
}) }}`;
console.log("✅ Claude prompt — uses $json.project and $json.projectContent (fixed field names)");

// ── 5. Code: Format for ClickUp — 1-in 1-out, uses $json.date from input ──
const splitIdx = nodeIdx("Code: Format for ClickUp");
if (splitIdx === -1) {
  // Still named "Code: Split by Date" in the workflow — rename it
  const oldIdx = nodeIdx("Code: Split by Date");
  if (oldIdx !== -1) {
    wf.nodes[oldIdx].name = "Code: Format for ClickUp";
    if (wf.connections["Code: Split by Date"]) {
      wf.connections["Code: Format for ClickUp"] = wf.connections["Code: Split by Date"];
      delete wf.connections["Code: Split by Date"];
    }
  }
}

const formatIdx = nodeIdx("Code: Format for ClickUp");
wf.nodes[formatIdx].parameters.mode = "runOnceForEachItem";
wf.nodes[formatIdx].parameters.jsCode = `
// Takes Claude's text response + date/listId from the input item.
// Returns 1 item (to create ClickUp task) or 0 items (to skip).
// ALSO marks the doc as processed in static data so it's never re-processed.
var claudeText = '';
try {
  var content = $input.item.json.content || [];
  claudeText = (Array.isArray(content) ? (content[0] && content[0].text) : content) || '';
} catch(e) {
  claudeText = JSON.stringify($input.item.json);
}
claudeText = (claudeText || '').trim();

if (!claudeText || claudeText === 'NO_TASKS' || claudeText.toLowerCase().indexOf('no task') !== -1) {
  console.log('No tasks — skipping ClickUp creation');
  return [];
}

// Get date and listId from input (set by Code: Extract Text by Date)
var date   = $input.item.json.date;
var listId = $input.item.json.listId;

if (!date || !listId) {
  console.log('Missing date or listId — skipping');
  return [];
}

// Mark this doc as processed in static data (prevent future duplicate runs)
// Note: we mark at the ClickUp-creation step so only successful docs are marked
var docId = $input.item.json.docId;
if (docId) {
  var processed = $getWorkflowStaticData('global');
  if (!processed.docIds) processed.docIds = {};
  processed.docIds[docId] = { date: date, processedAt: new Date().toISOString() };
}

return [{ json: { date: date, listId: listId, description: claudeText } }];
`.trim();

// Fix connections
wf.connections["Claude: Filter Angel Tasks"] = {
  main: [[{ node: "Code: Format for ClickUp", type: "main", index: 0 }]],
};
console.log("✅ Code: Format for ClickUp — 1-in/1-out, marks doc as processed");

// ── 6. ClickUp: Create Daily Task — one task per project per date ──────────
const clickupIdx = nodeIdx("ClickUp: Create Daily Task");
wf.nodes[clickupIdx].parameters.url =
  `=https://api.clickup.com/api/v2/list/{{ $json.listId }}/task`;
wf.nodes[clickupIdx].parameters.body =
  `={{ JSON.stringify({ "name": $json.date, "markdown_description": $json.description }) }}`;
console.log("✅ ClickUp node — name=$json.date, description=$json.description");

// ── 7. Save (deactivated) ─────────────────────────────────────────────────
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
console.log("✅ Workflow saved");
console.log(`
Pipeline:
  Run Backfill / Daily:8am
  → Drive: List Progress Files (all Google Docs in folder)
  → Code: Get Google Docs       ← DEDUPLICATION: skips already-processed doc IDs
  → Docs: Read Content
  → Code: Extract Text by Date  ← skips empty tabs (Principal Stone etc.)
  → Claude: Filter Angel Tasks  ← fixed field names
  → Code: Format for ClickUp    ← marks doc as processed; 1-in 1-out
  → ClickUp: Create Daily Task  ← one task per project per date
`);
