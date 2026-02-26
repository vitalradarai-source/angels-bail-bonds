import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const NEW_MODEL    = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

const WORKFLOWS = [
  { id: "9Xw3q2PtO1LPC4JH", name: "SpyFu" },
  { id: "xBdzO900m2lHDJaV", name: "SEMrush" },
  { id: "af9BFNgHLS1LgmIG", name: "Comparison" },
];

for (const wf of WORKFLOWS) {
  const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${wf.id}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  const workflow = await getRes.json();
  if (!getRes.ok) { console.error(`❌ ${wf.name}:`, workflow.message); continue; }

  let changed = false;
  for (const node of workflow.nodes) {
    if (node.parameters?.body && typeof node.parameters.body === "string") {
      const before = node.parameters.body;
      node.parameters.body = node.parameters.body.replace(
        /\"model\":\s*\"claude-[^\"]+\"/g,
        `"model": "${NEW_MODEL}"`
      );
      if (node.parameters.body !== before) {
        console.log(`  ✅ ${wf.name} → node "${node.name}": model updated`);
        changed = true;
      }
    }
  }

  if (!changed) {
    console.log(`  ⚠️  ${wf.name}: no Claude model string found to update`);
    continue;
  }

  const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${wf.id}`, {
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
    console.log(`  ✅ ${wf.name} saved`);
  } else {
    console.error(`  ❌ ${wf.name} save failed:`, putData.message);
  }
}

console.log(`\n✅ All workflows now use ${NEW_MODEL}`);
