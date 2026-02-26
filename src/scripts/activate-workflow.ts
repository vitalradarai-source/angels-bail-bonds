import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

// Check current status
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }

console.log("Workflow:", workflow.name);
console.log("Currently active:", workflow.active);

if (workflow.active) {
  console.log("\n✅ Workflow is already ACTIVE — it's listening for SpyFu emails!");
  console.log(`\n👉 Forward a SpyFu email to: 4434lifeline@gmail.com`);
  console.log("   The subject must contain 'SpyFu' to pass the filter.\n");
} else {
  console.log("\n⚡ Activating workflow...");

  const patchRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  const patchData = await patchRes.json();

  if (patchRes.ok) {
    console.log("✅ Workflow is now ACTIVE — it's listening for SpyFu emails!");
    console.log(`\n👉 Forward a SpyFu email to: 4434lifeline@gmail.com`);
    console.log("   The subject must contain 'SpyFu' to pass the filter.\n");
  } else {
    console.error("❌ Failed to activate:", JSON.stringify(patchData, null, 2));
  }
}
