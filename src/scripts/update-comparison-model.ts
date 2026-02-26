import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "af9BFNgHLS1LgmIG";

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }

const claudeNode = workflow.nodes.find((n: any) => n.name === "Claude: Comparison Analysis");
if (!claudeNode) { console.error("❌ Claude node not found"); process.exit(1); }

claudeNode.parameters.body = claudeNode.parameters.body.replace(
  /\"model\":\s*\"claude-[^\"]+\"/,
  '"model": "claude-opus-4-6"'
);

console.log("✅ Model updated to claude-opus-4-6");

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
  console.log("✅ Saved — comparison workflow now uses claude-opus-4-6");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
