import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await res.json();

const names = ["Prepare: Detect Type & Build Prompt", "Format Report Output", "ClickUp: Create Analysis Task", "Google Docs: Write Content"];

for (const name of names) {
  const node = workflow.nodes.find((n: any) => n.name === name);
  if (node) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`NODE: ${name}`);
    console.log(`${"=".repeat(60)}`);
    console.log(JSON.stringify(node.parameters, null, 2));
  } else {
    console.log(`\n❌ Node not found: ${name}`);
  }
}
