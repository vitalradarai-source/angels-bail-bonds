import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "TRlQAbUmRhk3tLZO";

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌", wf); process.exit(1); }

console.log("Nodes in Timesheet Sync workflow:");
wf.nodes.forEach((n: any) => console.log(`  "${n.name}"`));

// Fix Code: Collect PDFs — wrong node reference
const collectIdx = wf.nodes.findIndex((n: any) => n.name === "Code: Collect PDFs");
if (collectIdx !== -1) {
  // Replace the wrong reference $('Code: Switch to PDFs') with the correct one
  wf.nodes[collectIdx].parameters.jsCode = wf.nodes[collectIdx].parameters.jsCode
    .replace(/\$\('Code: Switch to PDFs'\)/g, "$('Code: Timesheet PDF IDs')");
  console.log("\n✅ Fixed: 'Code: Switch to PDFs' → 'Code: Timesheet PDF IDs'");
}

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
if (putRes.ok) console.log("✅ Saved");
else console.error("❌ Save failed:", await putRes.json());
