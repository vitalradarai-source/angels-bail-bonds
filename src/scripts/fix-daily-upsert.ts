/**
 * Adds upsert logic to the Daily Progress workflow:
 * - Before creating a ClickUp task, check if the date already exists
 * - If it does: update it (replace description with latest content)
 * - If not: create it
 * This prevents duplicate date tasks even if the workflow runs multiple times.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL    = process.env.N8N_BASE_URL!;
const N8N_API_KEY     = process.env.N8N_API_KEY!;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY!;
const WORKFLOW_ID     = "ZmIN72JrIyb4h1Ra";

const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await res.json();
if (!res.ok) { console.error("❌", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name}`);

const nodeIdx = (name: string) => wf.nodes.findIndex((n: any) => n.name === name);

// ── Move ClickUp: Create Daily Task to the right to make room ─────────────
wf.nodes[nodeIdx("ClickUp: Create Daily Task")].position = [2464, 500];

// ── Add HTTP Request: Get List Tasks ──────────────────────────────────────
// GETs all tasks from the list so we can check for existing same-date task
const getTasksNode = {
  id: "get-list-tasks",
  name: "HTTP Request: Get List Tasks",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1792, 400],
  parameters: {
    method: "GET",
    url: `=https://api.clickup.com/api/v2/list/{{ $json.listId }}/task?include_closed=false&page=0`,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "Authorization", value: CLICKUP_API_KEY },
        { name: "Content-Type",  value: "application/json" },
      ],
    },
    options: {},
  },
};
wf.nodes.push(getTasksNode);
console.log("✅ Added: HTTP Request: Get List Tasks");

// ── Add Code: Check Duplicate ─────────────────────────────────────────────
// Checks if a task with the same date name already exists.
// Gets date/listId/description from Code: Skip Filter (1:1 paired item).
const checkDupNode = {
  id: "check-duplicate",
  name: "Code: Check Duplicate",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [2016, 400],
  parameters: {
    mode: "runOnceForEachItem",
    jsCode: `
// Get the date/listId/description from Code: Skip Filter (1:1 paired item)
var skipItem = $('Code: Skip Filter').item.json;
var date        = skipItem.date;
var listId      = skipItem.listId;
var description = skipItem.description;

// Search in the ClickUp list tasks for a task with the same date name
var tasks = $input.item.json.tasks || [];
var existing = tasks.find(function(t) { return t.name === date; });

if (existing) {
  console.log('Existing task found for ' + date + ' (id: ' + existing.id + ') — will update');
  return { json: {
    action:      'update',
    taskId:      existing.id,
    date:        date,
    listId:      listId,
    description: description,
  }};
}

console.log('No existing task for ' + date + ' — will create');
return { json: {
  action:      'create',
  date:        date,
  listId:      listId,
  description: description,
}};
`.trim(),
  },
};
wf.nodes.push(checkDupNode);
console.log("✅ Added: Code: Check Duplicate");

// ── Add IF: Create or Update? ─────────────────────────────────────────────
const ifNode = {
  id: "if-create-or-update",
  name: "IF: Create or Update?",
  type: "n8n-nodes-base.if",
  typeVersion: 2,
  position: [2240, 400],
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [
        {
          id:          "check-action",
          leftValue:   `={{ $json.action }}`,
          rightValue:  "update",
          operator:    { type: "string", operation: "equals" },
        },
      ],
      combinator: "and",
    },
  },
};
wf.nodes.push(ifNode);
console.log("✅ Added: IF: Create or Update?");

// ── Add HTTP Request: Update Task ─────────────────────────────────────────
// Updates the existing ClickUp task with the new description (replaces content)
const updateTaskNode = {
  id: "update-task",
  name: "HTTP Request: Update Task",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [2464, 300],
  parameters: {
    method: "PUT",
    url: `=https://api.clickup.com/api/v2/task/{{ $json.taskId }}`,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "Authorization", value: CLICKUP_API_KEY },
        { name: "Content-Type",  value: "application/json" },
      ],
    },
    sendBody: true,
    contentType: "raw",
    rawContentType: "application/json",
    // Replace description with latest content from the progress doc
    body: `={{ JSON.stringify({ "markdown_description": $json.description }) }}`,
    options: {},
  },
};
wf.nodes.push(updateTaskNode);
console.log("✅ Added: HTTP Request: Update Task");

// ── Rewire connections ────────────────────────────────────────────────────
// Code: Skip Filter → Get List Tasks
wf.connections["Code: Skip Filter"] = {
  main: [[{ node: "HTTP Request: Get List Tasks", type: "main", index: 0 }]],
};
// Get List Tasks → Check Duplicate
wf.connections["HTTP Request: Get List Tasks"] = {
  main: [[{ node: "Code: Check Duplicate", type: "main", index: 0 }]],
};
// Check Duplicate → IF: Create or Update?
wf.connections["Code: Check Duplicate"] = {
  main: [[{ node: "IF: Create or Update?", type: "main", index: 0 }]],
};
// IF True (update) → HTTP Request: Update Task
// IF False (create) → ClickUp: Create Daily Task
wf.connections["IF: Create or Update?"] = {
  main: [
    [{ node: "HTTP Request: Update Task",  type: "main", index: 0 }], // output 0 = True
    [{ node: "ClickUp: Create Daily Task", type: "main", index: 0 }], // output 1 = False
  ],
};
console.log("✅ Rewired connections: Skip Filter → Get List Tasks → Check Dup → IF → Update/Create");

// ── Save + activate ───────────────────────────────────────────────────────
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
if (!putRes.ok) { console.error("❌ Save failed:", JSON.stringify(putData, null, 2)); process.exit(1); }
console.log("✅ Saved");

await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
console.log("✅ Activated — schedule trigger live (daily 8am UTC)");
console.log(`
Updated pipeline:
  ...
  → Code: Skip Filter
  → HTTP Request: Get List Tasks   ← fetches existing tasks from the list
  → Code: Check Duplicate          ← finds if same date exists
  → IF: Create or Update?
      TRUE  → HTTP Request: Update Task   ← updates description (no duplicate created)
      FALSE → ClickUp: Create Daily Task  ← creates new task
`);
