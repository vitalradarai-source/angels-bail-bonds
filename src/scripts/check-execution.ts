import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra";

// Fetch last 5 executions and pick the newest by startedAt
const res = await fetch(
  `${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=5&includeData=true`,
  { headers: { "X-N8N-API-KEY": N8N_API_KEY } }
);
const data = await res.json();
const execs: any[] = data.data || [];

if (execs.length === 0) { console.log("No executions found"); process.exit(1); }

// Sort by startedAt descending — pick the most recent
execs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
const exec = execs[0];

console.log(`Execution ID : ${exec.id}`);
console.log(`Status       : ${exec.status}`);
console.log(`Started      : ${exec.startedAt}`);
console.log(`Finished     : ${exec.stoppedAt || 'still running'}`);
console.log(`\nAll executions:`);
execs.forEach(e => console.log(`  #${e.id} — ${e.status} — ${e.startedAt}`));

const runData = exec.data?.resultData?.runData || {};
console.log("\n── Node results ──────────────────────────────");
for (const [nodeName, nodeRuns] of Object.entries(runData as any)) {
  const runs: any[] = nodeRuns as any[];
  const lastRun = runs[runs.length - 1];
  const hasError = lastRun?.error;
  const itemCount = lastRun?.data?.main?.[0]?.length ?? 0;
  console.log(`  ${hasError ? '❌' : '✅'} ${nodeName}: ${hasError ? lastRun.error.message : `${itemCount} item(s)`}`);
  if (hasError) {
    console.log(`     Error: ${JSON.stringify(lastRun.error).slice(0, 600)}`);
  }
}
