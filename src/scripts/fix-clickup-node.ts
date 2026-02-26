import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY!;
const CLICKUP_LIST_ID = "901414340773";
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }

const idx = workflow.nodes.findIndex((n: any) => n.name === "ClickUp: Create Analysis Task");
if (idx === -1) { console.error("❌ ClickUp node not found"); process.exit(1); }

console.log("Current ClickUp node params:");
console.log(JSON.stringify(workflow.nodes[idx].parameters, null, 2));

// ── WHAT WENT WRONG (simple version) ─────────────────────────────────────────
//
//  Think of it like ordering food at a restaurant.
//  You hand the waiter (n8n) a form with your order written on it.
//  The form says:
//    Name: {{ $json.taskName }}
//    Description: {{ $json.taskDescription }}
//
//  But the waiter sent the form to ClickUp with the curly brace
//  expressions NOT filled in — ClickUp got an empty name field.
//  ClickUp said: "Task name invalid!"
//
//  Same fix as the Claude node: use "raw" body mode so n8n RUNS
//  the expressions first, THEN sends the filled-in result.
//
//  Also: ClickUp's tags API expects objects like [{name: "spyfu"}]
//  NOT plain strings like ["spyfu"]. We fix that too.

// Build the JSON body as a string expression (same pattern that fixed Claude)
const clickupBody = [
  "={{ JSON.stringify({",
  '  "name": $(' + "'Format Report Output'" + ").first().json.taskName,",
  '  "description": $(' + "'Format Report Output'" + ").first().json.taskDescription,",
  '  "status": "open",',
  '  "priority": 2,',
  '  "notify_all": false,',
  '  "tags": [',
  '    { "name": "spyfu" },',
  '    { "name": $(' + "'Format Report Output'" + ").first().json.reportType.toLowerCase() },",
  '    { "name": "seo-report" }',
  "  ]",
  "}) }}",
].join("\n");

console.log("\nNew body expression:\n" + clickupBody);

workflow.nodes[idx] = {
  ...workflow.nodes[idx],
  parameters: {
    method: "POST",
    url: `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "Authorization", value: CLICKUP_API_KEY },
        { name: "Content-Type", value: "application/json" },
      ],
    },
    sendBody: true,
    contentType: "raw",
    rawContentType: "application/json",
    body: clickupBody,
    options: {},
  },
};

const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
    staticData: workflow.staticData ?? null,
  }),
});

const putData = await putRes.json();
if (putRes.ok) {
  console.log("\n✅ ClickUp node fixed!");
  console.log(`   URL: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`);
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
