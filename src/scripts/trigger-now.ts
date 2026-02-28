/**
 * Triggers the Daily Progress workflow immediately by temporarily setting
 * the schedule cron to fire in ~90 seconds, then restores it to 8am UTC.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra";

// ── 1. Fetch workflow ─────────────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌ Fetch failed:", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name} (${wf.nodes.length} nodes)`);

// ── 2. Find schedule trigger node ────────────────────────────────────────
const schedIdx = wf.nodes.findIndex((n: any) =>
  n.type === "n8n-nodes-base.scheduleTrigger"
);
if (schedIdx === -1) { console.error("❌ No schedule trigger found"); process.exit(1); }

const schedNode = wf.nodes[schedIdx];
const origRule = JSON.parse(JSON.stringify(schedNode.parameters.rule || schedNode.parameters));
console.log("📅 Original schedule:", JSON.stringify(schedNode.parameters));

// ── 3. Get latest execution ID before triggering ─────────────────────────
const execListRes = await fetch(
  `${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=1`,
  { headers: { "X-N8N-API-KEY": N8N_API_KEY } }
);
const execListData = await execListRes.json();
const lastExecId = execListData.data?.[0]?.id ?? 0;
console.log(`📌 Last execution ID: ${lastExecId}`);

// ── 4. Set cron to fire in ~90 seconds from now ──────────────────────────
const fireAt = new Date(Date.now() + 90_000);
const minute = fireAt.getUTCMinutes();
const hour   = fireAt.getUTCHours();
const day    = fireAt.getUTCDate();
const month  = fireAt.getUTCMonth() + 1;

// One-time cron: specific minute/hour/day/month, any weekday
const onceCron = `${minute} ${hour} ${day} ${month} *`;
console.log(`⏰ Setting cron to fire at: ${fireAt.toUTCString()} — cron: "${onceCron}"`);

// Patch schedule parameters
wf.nodes[schedIdx].parameters = {
  rule: {
    interval: [{ field: "cronExpression", expression: onceCron }],
  },
};

// ── 5. Deactivate, save, re-activate ─────────────────────────────────────
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
if (!putRes.ok) { console.error("❌ Save failed:", await putRes.text()); process.exit(1); }
console.log("✅ Saved with one-time cron");

await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
console.log("✅ Activated — waiting for cron to fire...\n");

// ── 6. Poll for new execution ─────────────────────────────────────────────
const waitMs = (fireAt.getTime() - Date.now()) + 15_000; // wait until after fire time + buffer
console.log(`⏳ Polling for ~${Math.round(waitMs / 1000)}s...`);

let newExecId: string | null = null;
let status = "waiting";
const pollStart = Date.now();

while (Date.now() - pollStart < waitMs + 120_000) {
  await new Promise(r => setTimeout(r, 5000));
  const elapsed = Math.round((Date.now() - pollStart) / 1000);

  const listRes = await fetch(
    `${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=1`,
    { headers: { "X-N8N-API-KEY": N8N_API_KEY } }
  );
  const listData = await listRes.json();
  const latest = listData.data?.[0];

  if (latest && latest.id !== lastExecId) {
    newExecId = latest.id;
    status = latest.status ?? (latest.finished ? "finished" : "running");
    process.stdout.write(`\r  Execution #${newExecId}: ${status} (${elapsed}s)...   `);
    if (status === "success" || status === "error" || status === "crashed") {
      console.log(`\n${status === "success" ? "✅" : "❌"} Execution ${status}!`);
      break;
    }
  } else {
    process.stdout.write(`\r  Waiting for execution... (${elapsed}s)   `);
  }
}
console.log("");

// ── 7. Restore 8am UTC schedule ───────────────────────────────────────────
console.log("\n🔄 Restoring 8am UTC schedule...");
const wf2Res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf2 = await wf2Res.json();

const schedIdx2 = wf2.nodes.findIndex((n: any) => n.type === "n8n-nodes-base.scheduleTrigger");
wf2.nodes[schedIdx2].parameters = {
  rule: {
    interval: [{ field: "cronExpression", expression: "0 8 * * *" }],
  },
};

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
await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
console.log("✅ Schedule restored to 0 8 * * * (8am UTC daily)");

if (newExecId) {
  console.log(`\n📊 Execution #${newExecId}: ${status}`);
  console.log(`   View: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}/executions/${newExecId}`);
} else {
  console.log("⚠️  No new execution detected — check n8n manually");
  console.log(`   ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}/executions`);
}
