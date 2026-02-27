import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra";
const WEBHOOK_PATH = "daily-progress-run-now";

// ── 1. Fetch current workflow ─────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌ Fetch failed:", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name}`);

// ── 2. Swap manual trigger → webhook trigger ──────────────────────────────
const manualIdx = wf.nodes.findIndex((n: any) => n.type === "n8n-nodes-base.manualTrigger");
const originalManualNode = JSON.parse(JSON.stringify(wf.nodes[manualIdx]));

wf.nodes[manualIdx] = {
  id:          originalManualNode.id,
  name:        originalManualNode.name,
  type:        "n8n-nodes-base.webhook",
  typeVersion: 2,
  position:    originalManualNode.position,
  parameters: {
    path:           WEBHOOK_PATH,
    responseMode:   "onReceived",
    responseData:   "allEntries",
    httpMethod:     "GET",
  },
};
console.log("✅ Swapped manual trigger → webhook");

// ── 3. Deactivate, save with webhook, activate ────────────────────────────
await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});

const saveRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, staticData: wf.staticData ?? null,
  }),
});
if (!saveRes.ok) { console.error("❌ Save failed:", await saveRes.text()); process.exit(1); }
console.log("✅ Saved with webhook trigger");

await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
console.log("✅ Activated");

// ── 4. Wait for webhook to register ──────────────────────────────────────
await new Promise(r => setTimeout(r, 2000));

// ── 5. Call the webhook to start the run ─────────────────────────────────
console.log("🚀 Triggering workflow via webhook...");
const triggerRes = await fetch(`${N8N_BASE_URL}/webhook/${WEBHOOK_PATH}`, {
  method: "GET",
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const triggerBody = await triggerRes.text();
console.log(`Webhook response (${triggerRes.status}):`, triggerBody.slice(0, 200));

// ── 6. Poll for execution result ──────────────────────────────────────────
console.log("⏳ Polling for execution...");
let execId: string | null = null;
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const listRes = await fetch(
    `${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=1`,
    { headers: { "X-N8N-API-KEY": N8N_API_KEY } }
  );
  const listData = await listRes.json();
  const exec = listData.data?.[0];
  if (exec) {
    execId = exec.id;
    const status = exec.status || exec.finished;
    console.log(`  Execution #${exec.id}: ${exec.status ?? (exec.finished ? 'finished' : 'running')}`);
    if (exec.status === "success" || exec.status === "error" || exec.finished === true) {
      console.log(exec.status === "error" ? "❌ Execution failed" : "✅ Execution completed");
      break;
    }
  }
}

if (execId) {
  // Short status check
  const execRes = await fetch(`${N8N_BASE_URL}/api/v1/executions/${execId}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  const execData = await execRes.json();
  console.log("\n📊 Result:", {
    status: execData.status,
    startedAt: execData.startedAt,
    stoppedAt: execData.stoppedAt,
  });
}

// ── 7. Restore manual trigger ─────────────────────────────────────────────
console.log("\n🔄 Restoring manual trigger...");
wf.nodes[manualIdx] = originalManualNode;

await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});

const restoreRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, staticData: wf.staticData ?? null,
  }),
});
if (!restoreRes.ok) console.error("⚠️  Restore save failed:", await restoreRes.text());
else console.log("✅ Manual trigger restored");

// Re-activate so the schedule trigger stays live
await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
console.log("✅ Workflow re-activated (schedule trigger live)");
