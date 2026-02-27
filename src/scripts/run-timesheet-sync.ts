import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL  = process.env.N8N_BASE_URL!;
const N8N_API_KEY   = process.env.N8N_API_KEY!;
const WORKFLOW_ID   = "TRlQAbUmRhk3tLZO";
const WEBHOOK_PATH  = "timesheet-sync-trigger";

// ── 1. Fetch workflow ─────────────────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌ Fetch failed:", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name}`);

// ── 2. Swap manual trigger → webhook ─────────────────────────────────────────
const triggerIdx = wf.nodes.findIndex((n: any) =>
  n.type === "n8n-nodes-base.manualTrigger"
);
if (triggerIdx === -1) { console.error("❌ Manual trigger not found"); process.exit(1); }

const oldName = wf.nodes[triggerIdx].name;
wf.nodes[triggerIdx] = {
  id: wf.nodes[triggerIdx].id,
  name: "Webhook Trigger",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: wf.nodes[triggerIdx].position,
  parameters: { path: WEBHOOK_PATH, httpMethod: "POST", responseMode: "onReceived", options: {} },
  webhookId: WEBHOOK_PATH,
};
if (wf.connections[oldName]) {
  wf.connections["Webhook Trigger"] = wf.connections[oldName];
  delete wf.connections[oldName];
}

// ── 3. Deactivate, save, reactivate ──────────────────────────────────────────
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
if (!putRes.ok) { console.error("❌ Save failed:", await putRes.json()); process.exit(1); }
console.log("✅ Webhook trigger set");

await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
console.log("✅ Activated");

// ── 4. Call webhook ───────────────────────────────────────────────────────────
await new Promise(r => setTimeout(r, 2000));
const webhookUrl = `${N8N_BASE_URL}/webhook/${WEBHOOK_PATH}`;
console.log(`\nCalling webhook: ${webhookUrl}`);

const trigRes = await fetch(webhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ trigger: "timesheet-sync" }),
});
console.log(`Response (${trigRes.status}): ${await trigRes.text()}`);
if (!trigRes.ok) { console.error("❌ Webhook failed"); process.exit(1); }
console.log("\n✅ Timesheet sync triggered! Monitoring...\n");

// ── 5. Poll for completion ────────────────────────────────────────────────────
await new Promise(r => setTimeout(r, 5000));

let status = "running";
let attempts = 0;

while (attempts < 80) {
  await new Promise(r => setTimeout(r, 5000));
  attempts++;

  const exRes = await fetch(
    `${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=3`,
    { headers: { "X-N8N-API-KEY": N8N_API_KEY } }
  );
  const exData = await exRes.json();
  const execs: any[] = (exData.data || []).sort(
    (a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  const latest = execs[0];
  status = latest?.status || "unknown";

  process.stdout.write(`\r  Status: ${status} (${attempts * 5}s elapsed)...   `);
  if (status === "success" || status === "error" || status === "crashed") break;
}

console.log(`\n\nFinal status: ${status}`);

// ── 6. Show node results ──────────────────────────────────────────────────────
const exRes2 = await fetch(
  `${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=3&includeData=true`,
  { headers: { "X-N8N-API-KEY": N8N_API_KEY } }
);
const exData2 = await exRes2.json();
const execs2: any[] = (exData2.data || []).sort(
  (a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
);
const exec = execs2[0];
const runData = exec?.data?.resultData?.runData || {};

console.log("\n── Node results ──────────────────────────────");
for (const [nodeName, nodeRuns] of Object.entries(runData as any)) {
  const runs: any[] = nodeRuns as any[];
  const lastRun = runs[runs.length - 1];
  const hasError = lastRun?.error;
  const itemCount = lastRun?.data?.main?.[0]?.length ?? 0;
  console.log(`  ${hasError ? '❌' : '✅'} ${nodeName}: ${hasError ? lastRun.error.message : `${itemCount} item(s)`}`);
  if (hasError) console.log(`     → ${JSON.stringify(lastRun.error).slice(0, 400)}`);
}

if (status === "success") {
  console.log("\n✅ Timesheet sync complete! ClickUp tasks updated with timesheet data.");
} else {
  console.log(`\n❌ Check n8n: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}/executions`);
}

// ── 7. Restore manual trigger ─────────────────────────────────────────────────
console.log("\nRestoring manual trigger...");
const wf2 = await (await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
})).json();

const whIdx = wf2.nodes.findIndex((n: any) => n.name === "Webhook Trigger");
if (whIdx !== -1) {
  wf2.nodes[whIdx] = {
    id: wf2.nodes[whIdx].id,
    name: "Run Timesheet Sync",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: wf2.nodes[whIdx].position,
    parameters: {},
  };
  if (wf2.connections["Webhook Trigger"]) {
    wf2.connections["Run Timesheet Sync"] = wf2.connections["Webhook Trigger"];
    delete wf2.connections["Webhook Trigger"];
  }
  await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {
    method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
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
