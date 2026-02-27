import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra"; // Angel Bail Bonds — Daily Progress Backfill

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name}`);

// ── 1. Fix empty-tab skip logic in Code: Extract Text by Date ─────────────
const extractIdx = wf.nodes.findIndex((n: any) => n.name === "Code: Extract Text by Date");
if (extractIdx === -1) { console.error("❌ Code: Extract Text by Date not found"); process.exit(1); }

const currentCode: string = wf.nodes[extractIdx].parameters.jsCode;

// Replace the faulty condition — currently emits items for ALL projects when
// Sean's Task content exists, even if the project tab is empty.
// Fix: only emit if the project has its own tab content.
const oldCondition = `    if (!content && !seanTaskContent) return;`;
const newCondition = `    if (!content) return;  // skip projects with no tab content`;

if (!currentCode.includes(oldCondition.trim())) {
  console.log("⚠️  Old condition not found verbatim — patching with replace");
  wf.nodes[extractIdx].parameters.jsCode = currentCode.replace(
    /if \(!content && !seanTaskContent\) return;/,
    "if (!content) return;  // skip projects with no tab content"
  );
} else {
  wf.nodes[extractIdx].parameters.jsCode = currentCode.replace(
    oldCondition,
    newCondition
  );
}
console.log("✅ Fixed: empty-tab projects now skipped (only emit if tab has content)");

// ── 2. Add Schedule trigger — run daily at 08:00 ──────────────────────────
const existingScheduleIdx = wf.nodes.findIndex((n: any) =>
  n.type === "n8n-nodes-base.scheduleTrigger"
);
if (existingScheduleIdx !== -1) {
  console.log("ℹ️  Schedule trigger already exists — skipping add");
} else {
  const scheduleNode = {
    id:          "daily-schedule-trigger",
    name:        "Daily: 8am",
    type:        "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1,
    position:    [0, 500],
    parameters: {
      rule: {
        interval: [
          {
            field:           "cronExpression",
            expression:      "0 8 * * *",  // every day at 08:00
          },
        ],
      },
    },
  };

  wf.nodes.push(scheduleNode);

  // Connect schedule trigger → Drive: List Progress Files (same as Run Backfill)
  const manualTriggerName = "Run Backfill";
  const firstNodeName     = Object.keys(wf.connections).find(k =>
    wf.connections[k]?.main?.[0]?.some?.((c: any) => c.node === "Code: Get Google Docs") === false &&
    k !== manualTriggerName
  );

  // The manual trigger connects to Drive: List Progress Files
  const manualConnections = wf.connections[manualTriggerName]?.main?.[0] || [];
  wf.connections["Daily: 8am"] = {
    main: [manualConnections.map((c: any) => ({ ...c }))],
  };
  console.log("✅ Added Schedule trigger: daily at 08:00 → same flow as Run Backfill");
}

// ── 3. Deactivate + save ──────────────────────────────────────────────────
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

// ── 4. Activate (so schedule trigger fires) ───────────────────────────────
const activateRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
if (activateRes.ok) console.log("✅ Workflow activated — schedule trigger live (daily 08:00)");
else console.error("❌ Activate failed:", await activateRes.text());
