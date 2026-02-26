import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;

const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/af9BFNgHLS1LgmIG`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await res.json();
const claude = wf.nodes.find((n: any) => n.name === "Claude: Comparison Analysis");
const body: string = claude?.parameters?.body ?? "";
const match = body.match(/"model":\s*"([^"]+)"/);
console.log("Model:", match?.[1] ?? "NOT FOUND");
console.log("Body snippet:", body.slice(0, 200));
