import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;

const WORKFLOWS = [
  { id: "9Xw3q2PtO1LPC4JH", name: "SpyFu" },
  { id: "xBdzO900m2lHDJaV", name: "SEMrush" },
  { id: "af9BFNgHLS1LgmIG", name: "Comparison" },
];

for (const wf of WORKFLOWS) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${wf.id}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  const workflow = await res.json();

  const claudeNode = workflow.nodes.find((n: any) =>
    n.name?.toLowerCase().includes("claude") || n.url?.includes("anthropic")
  );
  if (!claudeNode) { console.log(`${wf.name}: no Claude node found`); continue; }

  console.log(`\n── ${wf.name} ──`);
  console.log("  type:", claudeNode.type);
  console.log("  credentials:", JSON.stringify(claudeNode.credentials));
  const headers = claudeNode.parameters?.headerParameters?.parameters || [];
  for (const h of headers) {
    const val = h.value || "";
    const masked = val.startsWith("sk-") ? val.slice(0, 12) + "..." : val;
    console.log(`  header "${h.name}": ${masked}`);
  }
}
