import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra";
const WEBHOOK_PATH = "daily-progress-backfill";

// ── STEP 1: fetch workflow ────────────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌ Fetch failed:", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name}`);

// ── STEP 2: replace Manual Trigger with Webhook ───────────────────────────────
const triggerIdx = wf.nodes.findIndex((n: any) =>
  n.type === "n8n-nodes-base.manualTrigger"
);
if (triggerIdx === -1) { console.error("❌ Manual trigger node not found"); process.exit(1); }

const oldTriggerName = wf.nodes[triggerIdx].name;
wf.nodes[triggerIdx] = {
  id:          wf.nodes[triggerIdx].id,
  name:        "Webhook Trigger",
  type:        "n8n-nodes-base.webhook",
  typeVersion: 2,
  position:    wf.nodes[triggerIdx].position,
  parameters: {
    path:           WEBHOOK_PATH,
    httpMethod:     "POST",
    responseMode:   "onReceived",
    responseData:   "firstEntryJson",
    options:        {},
  },
  webhookId: WEBHOOK_PATH,
};

// Fix connection from old trigger name to new
if (wf.connections[oldTriggerName]) {
  wf.connections["Webhook Trigger"] = wf.connections[oldTriggerName];
  delete wf.connections[oldTriggerName];
}

// ── STEP 3: save & activate ───────────────────────────────────────────────────
const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, staticData: wf.staticData ?? null,
  }),
});
const putData = await putRes.json();
if (!putRes.ok) { console.error("❌ Save failed:", putData); process.exit(1); }
console.log("✅ Workflow updated with webhook trigger");

// Activate so webhook is live
const actRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
if (actRes.ok) console.log("✅ Workflow activated");
else console.warn("⚠️  Could not activate — activating may be needed manually");

// ── STEP 4: call the webhook ──────────────────────────────────────────────────
await new Promise(r => setTimeout(r, 2000)); // give n8n 2s to register webhook

const webhookUrl = `${N8N_BASE_URL}/webhook/${WEBHOOK_PATH}`;
console.log(`\nCalling webhook: ${webhookUrl}`);

const triggerRes = await fetch(webhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ trigger: "backfill" }),
});
const triggerData = await triggerRes.text();
console.log(`Webhook response (${triggerRes.status}): ${triggerData.slice(0, 200)}`);

if (triggerRes.ok) {
  console.log("\n✅ Backfill triggered! Monitoring execution...\n");
} else {
  console.error("❌ Webhook call failed");
  process.exit(1);
}

// ── STEP 5: poll for completion ───────────────────────────────────────────────
await new Promise(r => setTimeout(r, 3000)); // give execution time to start

let latestExecution: any = null;
let status = "running";
let attempts = 0;

while (attempts < 80) {
  await new Promise(r => setTimeout(r, 4000));
  attempts++;

  const exRes = await fetch(
    `${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=1`,
    { headers: { "X-N8N-API-KEY": N8N_API_KEY } }
  );
  const exData = await exRes.json();
  latestExecution = exData.data?.[0];
  status = latestExecution?.status || "unknown";

  process.stdout.write(`\r  Status: ${status} (${attempts * 4}s elapsed)...   `);

  if (status === "success" || status === "error" || status === "crashed") break;
}

console.log(`\n\nFinal status: ${status}`);
if (status === "success") {
  console.log("✅ Backfill completed successfully!");
  console.log("   Check your ClickUp lists for the new daily tasks.");
} else {
  console.log("❌ Check n8n for details:");
  console.log(`   ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}/executions`);
}

// ── STEP 6: restore manual trigger ───────────────────────────────────────────
console.log("\nRestoring manual trigger...");
const wf2 = await (await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
})).json();

const webhookIdx = wf2.nodes.findIndex((n: any) => n.name === "Webhook Trigger");
if (webhookIdx !== -1) {
  wf2.nodes[webhookIdx] = {
    id: wf2.nodes[webhookIdx].id,
    name: "Run Backfill",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: wf2.nodes[webhookIdx].position,
    parameters: {},
  };
  if (wf2.connections["Webhook Trigger"]) {
    wf2.connections["Run Backfill"] = wf2.connections["Webhook Trigger"];
    delete wf2.connections["Webhook Trigger"];
  }
  await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
    method: "PUT",
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: wf2.name, nodes: wf2.nodes, connections: wf2.connections,
      settings: wf2.settings, staticData: wf2.staticData ?? null,
    }),
  });
  console.log("✅ Manual trigger restored");
}
