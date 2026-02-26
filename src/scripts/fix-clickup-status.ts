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

// ── WHY THIS HAPPENED ────────────────────────────────────────────────────────
//
//  Every ClickUp LIST has its OWN set of statuses.
//  Think of it like a whiteboard with columns:
//    Your list might have:  "To Do" | "In Progress" | "Complete"
//    We were sending:       status = "open"
//    ClickUp said:          "I don't have an 'open' column!"
//
//  Fix: Don't send a status at all.
//  When no status is given, ClickUp uses the FIRST column automatically —
//  whatever the default is for that list. Clean and simple.
//
//  We also remove "tags" for now. Tags in ClickUp need to already EXIST
//  in the workspace before you can assign them. If they don't exist yet,
//  ClickUp throws another error. We can add tags back later once the
//  workflow is fully working.

const clickupBody = [
  "={{ JSON.stringify({",
  '  "name": $(' + "'Format Report Output'" + ").first().json.taskName,",
  '  "description": $(' + "'Format Report Output'" + ").first().json.taskDescription,",
  '  "priority": 2',
  "}) }}",
].join("\n");

console.log("New body (no status, no tags):\n" + clickupBody);

workflow.nodes[idx].parameters.body = clickupBody;

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
  console.log("\n✅ ClickUp node fixed — removed status and tags!");
  console.log(`   URL: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`);
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
