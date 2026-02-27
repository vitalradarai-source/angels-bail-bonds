import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra";

// Get latest execution
const res = await fetch(
  `${N8N_BASE_URL}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=1&includeData=true`,
  { headers: { "X-N8N-API-KEY": N8N_API_KEY } }
);
const data = await res.json();
const exec = data.data?.[0];

if (!exec) { console.log("No executions found"); process.exit(1); }

console.log(`Execution ID: ${exec.id}`);
console.log(`Status: ${exec.status}`);
console.log(`Started: ${exec.startedAt}`);
console.log(`Finished: ${exec.stoppedAt || 'still running'}`);

// Find the errored node
const runData = exec.data?.resultData?.runData || {};
console.log("\n── Node results ──────────────────────────────");
for (const [nodeName, nodeRuns] of Object.entries(runData as any)) {
  const runs: any[] = nodeRuns as any[];
  const lastRun = runs[runs.length - 1];
  const hasError = lastRun?.error;
  const itemCount = lastRun?.data?.main?.[0]?.length ?? 0;
  console.log(`  ${hasError ? '❌' : '✅'} ${nodeName}: ${hasError ? lastRun.error.message : `${itemCount} item(s)`}`);
  if (hasError) {
    console.log(`     Error: ${JSON.stringify(lastRun.error).slice(0, 500)}`);
  }
}

// Print last node's output for debugging
const nodeNames = Object.keys(runData);
const lastNode = nodeNames[nodeNames.length - 1];
if (lastNode) {
  const lastRun = (runData[lastNode] as any[])[0];
  if (lastRun?.data?.main?.[0]?.[0]) {
    console.log(`\n── Last node output (first item) ──────────────`);
    console.log(JSON.stringify(lastRun.data.main[0][0].json, null, 2).slice(0, 1000));
  }
}
