import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra";

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌", wf); process.exit(1); }

// ── Show current nodes ────────────────────────────────────────────────────────
console.log("Current nodes:");
wf.nodes.forEach((n: any) => console.log(`  ${n.type.split('.')[1]} → "${n.name}"`));

// ── 1. Ensure a manual trigger exists ────────────────────────────────────────
const hasTrigger = wf.nodes.some((n: any) =>
  n.type === "n8n-nodes-base.manualTrigger" ||
  n.type === "n8n-nodes-base.webhook"
);

if (!hasTrigger) {
  console.log("\n⚠️  No trigger found — adding manual trigger");
  wf.nodes.unshift({
    id: "trigger-restored",
    name: "Run Backfill",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [0, 300],
    parameters: {},
  });
  // Connect trigger to first downstream node
  const firstDownstream = wf.nodes.find((n: any) =>
    n.name === "Drive: List Progress Files"
  );
  if (firstDownstream) {
    wf.connections["Run Backfill"] = {
      main: [[{ node: "Drive: List Progress Files", type: "main", index: 0 }]],
    };
  }
} else {
  console.log("\n✅ Trigger node present");
}

// ── 2. Fix ClickUp node references ───────────────────────────────────────────
const clickupIdx = wf.nodes.findIndex((n: any) => n.name === "ClickUp: Create Daily Task");
if (clickupIdx !== -1) {
  wf.nodes[clickupIdx].parameters.body = `={{ JSON.stringify({
  "name": $('Code: Extract Text by Date').item.json.date,
  "markdown_description": $json.content[0].text
}) }}`;
  wf.nodes[clickupIdx].parameters.url =
    `=https://api.clickup.com/api/v2/list/{{ $('Code: Extract Text by Date').item.json.listId }}/task`;
  console.log("✅ ClickUp node body + URL fixed");
}

// ── 3. Deactivate first (avoids the activation-check on PUT) ─────────────────
await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});

// ── 4. Save ───────────────────────────────────────────────────────────────────
const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, staticData: wf.staticData ?? null,
  }),
});
const putData = await putRes.json();
if (putRes.ok) {
  console.log("✅ Saved successfully");
} else {
  console.error("❌ Save failed:", JSON.stringify(putData, null, 2));
  process.exit(1);
}
