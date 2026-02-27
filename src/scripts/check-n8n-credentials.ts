import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;

// Check all existing workflows for Google credentials used
const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const data = await res.json();

const credsSeen = new Set<string>();
for (const wf of data.data || []) {
  const full = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${wf.id}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  const wfData = await full.json();
  for (const node of wfData.nodes || []) {
    if (node.credentials) {
      for (const [type, cred] of Object.entries(node.credentials as any)) {
        const key = `${type} → ID:${(cred as any).id} Name:${(cred as any).name}`;
        if (!credsSeen.has(key)) {
          credsSeen.add(key);
          console.log(`  [${wf.name}] ${key}`);
        }
      }
    }
  }
}
