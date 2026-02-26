import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

const idx = workflow.nodes.findIndex((n: any) => n.name === "Claude: Analyze Report");
if (idx === -1) { console.error("❌ Claude node not found"); process.exit(1); }

const currentBody = workflow.nodes[idx].parameters.body as string;
console.log("\nBefore:");
console.log("  Model:      ", currentBody.match(/"model":\s*"([^"]+)"/)?.[1]);
console.log("  max_tokens: ", currentBody.match(/"max_tokens":\s*(\d+)/)?.[1]);

// Switch from Haiku → Sonnet, and increase max_tokens from 4096 → 8192
//
// WHY THESE NUMBERS:
//   Model: claude-sonnet-4-6
//     - Much better at following complex multi-section prompts
//     - Writes more coherent, detailed analysis
//     - Cost: ~$0.15 per report vs ~$0.01 for Haiku — negligible for monthly reports
//
//   max_tokens: 8192
//     - This is the maximum allowed output for Sonnet
//     - 8192 tokens ≈ 6,000-7,000 words — more than enough for a full report
//     - Previously 4096 was cutting the report in half mid-sentence

const updatedBody = currentBody
  .replace(/"model":\s*"claude-haiku-4-5-20251001"/, '"model": "claude-sonnet-4-6"')
  .replace(/"max_tokens":\s*4096/, '"max_tokens": 8192');

workflow.nodes[idx].parameters.body = updatedBody;

console.log("\nAfter:");
console.log("  Model:      ", updatedBody.match(/"model":\s*"([^"]+)"/)?.[1]);
console.log("  max_tokens: ", updatedBody.match(/"max_tokens":\s*(\d+)/)?.[1]);

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
  console.log("\n✅ Claude node updated — Sonnet + 8192 max tokens");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
