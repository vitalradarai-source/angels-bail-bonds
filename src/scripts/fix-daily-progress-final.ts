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

// Helper
const node = (name: string) => wf.nodes.find((n: any) => n.name === name);
const nodeIdx = (name: string) => wf.nodes.findIndex((n: any) => n.name === name);

// ── 1. Drive: List Progress Files — only get files modified in last 48h ────
// This prevents re-processing old docs on every run
const driveNode = node("Drive: List Progress Files");
driveNode.parameters.queryParameters = {
  parameters: [
    { name: "q",
      value: `={{ "mimeType='application/vnd.google-apps.document' and '${FOLDER_ID}' in parents and trashed=false and modifiedTime > '" + DateTime.now().minus({hours: 48}).toUTC().toISO() + "'" }}` },
    { name: "fields", value: "files(id,name,mimeType,modifiedTime)" },
    { name: "orderBy",  value: "modifiedTime desc" },
  ]
};
console.log("✅ Drive filter: only docs modified in last 48h");

// ── 2. Code: Get Google Docs — add early-exit if no new docs ──────────────
const getDocsIdx = nodeIdx("Code: Get Google Docs");
wf.nodes[getDocsIdx].parameters.jsCode = `
// Extract doc IDs and dates from the Drive listing.
// Drive query already filtered to last 48h — if empty, nothing to do.
var files = $input.item.json.files || [];
if (!Array.isArray(files)) {
  try { files = JSON.parse(files); } catch(e) { files = []; }
}

if (files.length === 0) {
  throw new Error('NO_NEW_DOCS'); // caught by n8n — marks execution as error but that is OK
}

var items = [];
for (var f of files) {
  items.push({ json: { docId: f.id, date: f.name, name: f.name } });
}
console.log('New docs to process: ' + items.length);
return items;
`.trim();
console.log("✅ Code: Get Google Docs — skips if no new docs");

// ── 3. Fix Claude prompt — correct field names, no date extraction ─────────
// Previously used wrong fields: $json.projectName (→ $json.project)
//                                $json.tabContent  (→ $json.projectContent)
// Now: ask Claude to just format the task list as plain text.
//      Date comes from $json.date (already correct from the doc filename).
const claudeIdx = nodeIdx("Claude: Filter Angel Tasks");
wf.nodes[claudeIdx].parameters.body = `={{ JSON.stringify({
  "model": "${process.env.ANTHROPIC_MODEL || 'claude-opus-4-6'}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": [{
      "type": "text",
      "text": "Project: " + $json.project + "\\nDate: " + $json.date + "\\n\\n=== PROJECT TAB CONTENT ===\\n" + $json.projectContent + "\\n\\n=== SEAN'S TASK LIST (cross-reference) ===\\n" + ($json.seanTaskContent || '(none)') + "\\n\\nExtract all tasks and activities for the project '" + $json.project + "' on " + $json.date + ".\\n\\nOrganize into sections (only include sections that have items):\\n**Completed:**\\n- item\\n**In Progress:**\\n- item\\n**To-do:**\\n- item\\n**Blockage:**\\n- item\\n**Questions & Suggestions:**\\n- item\\n\\nReturn only the formatted list. If no tasks, return exactly: NO_TASKS"
    }]
  }]
}) }}`;
console.log("✅ Claude prompt fixed — uses $json.project and $json.projectContent, no date extraction");

// ── 4. Replace Code: Split by Date with Code: Format for ClickUp ──────────
// Old node split ONE Claude response into MULTIPLE items (wrong).
// New node: 1 input → 1 output. Uses date/listId from input, not from Claude.
const splitIdx = nodeIdx("Code: Split by Date");
wf.nodes[splitIdx].name = "Code: Format for ClickUp";
wf.nodes[splitIdx].parameters.mode = "runOnceForEachItem";
wf.nodes[splitIdx].parameters.jsCode = `
// Format Claude's response for ClickUp.
// 1 item in → 1 item out (or 0 if Claude says NO_TASKS).
// Date and listId come from Code: Extract Text by Date, not from Claude.
var claudeText = '';
try {
  var content = $input.item.json.content || [];
  claudeText = (Array.isArray(content) ? content[0]?.text : content) || '';
} catch(e) {
  claudeText = JSON.stringify($input.item.json);
}

claudeText = claudeText.trim();
if (!claudeText || claudeText === 'NO_TASKS' || claudeText.toLowerCase().includes('no tasks')) {
  console.log('Skipping — no tasks for this item');
  return [];
}

// Date and listId come from the input item (set by Code: Extract Text by Date)
var date   = $input.item.json.date   || $('Code: Extract Text by Date').item.json.date;
var listId = $input.item.json.listId || $('Code: Extract Text by Date').item.json.listId;

return [{ json: { date: date, listId: listId, description: claudeText } }];
`.trim();

// Fix connections: rename Code: Split by Date → Code: Format for ClickUp
if (wf.connections["Code: Split by Date"]) {
  wf.connections["Code: Format for ClickUp"] = wf.connections["Code: Split by Date"];
  delete wf.connections["Code: Split by Date"];
}
// Claude now connects to Code: Format for ClickUp
wf.connections["Claude: Filter Angel Tasks"] = {
  main: [[{ node: "Code: Format for ClickUp", type: "main", index: 0 }]],
};
console.log("✅ Code: Split by Date → Code: Format for ClickUp (1-in 1-out, uses input date)");

// ── 5. ClickUp node — use $json.date and $json.listId ─────────────────────
const clickupIdx = nodeIdx("ClickUp: Create Daily Task");
wf.nodes[clickupIdx].parameters.url =
  `=https://api.clickup.com/api/v2/list/{{ $json.listId }}/task`;
wf.nodes[clickupIdx].parameters.body =
  `={{ JSON.stringify({ "name": $json.date, "markdown_description": $json.description }) }}`;
console.log("✅ ClickUp node updated — name=$json.date, description=$json.description");

// ── 6. Save ───────────────────────────────────────────────────────────────
const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, staticData: wf.staticData ?? null,
  }),
});
const putData = await putRes.json();
if (!putRes.ok) { console.error("❌ Save failed:", JSON.stringify(putData, null, 2)); process.exit(1); }
console.log("✅ Workflow saved (deactivated — ready to test)");
console.log("\nNode pipeline:");
console.log("  Run Backfill / Daily:8am");
console.log("  → Drive: List Progress Files (last 48h only)");
console.log("  → Code: Get Google Docs");
console.log("  → Docs: Read Content");
console.log("  → Code: Extract Text by Date");
console.log("  → Claude: Filter Angel Tasks");
console.log("  → Code: Format for ClickUp (1-in 1-out)");
console.log("  → ClickUp: Create Daily Task");
