import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL    = process.env.N8N_BASE_URL!;
const N8N_API_KEY     = process.env.N8N_API_KEY!;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY!;

async function deleteClickUpTask(id: string) {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${id}`, {
    method: "DELETE",
    headers: { Authorization: CLICKUP_API_KEY },
  });
  return res.status;
}

async function getTaskIdsFromExecution(execId: string) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1/executions/${execId}?includeData=true`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  const data = await res.json();
  const runData = data?.data?.resultData?.runData || {};
  const clickupRuns = runData["ClickUp: Create Daily Task"] || [];
  const ids: string[] = [];
  for (const run of clickupRuns) {
    const output = run?.data?.main?.[0] || [];
    for (const item of output) {
      const id = item?.json?.id;
      if (id) ids.push(id);
    }
  }
  return ids;
}

// Clean up executions #216 and #217
const execIds = ["216", "217"];

for (const execId of execIds) {
  const ids = await getTaskIdsFromExecution(execId);
  console.log(`Execution #${execId}: found ${ids.length} tasks to delete`);

  let deleted = 0;
  for (const id of ids) {
    const status = await deleteClickUpTask(id);
    if (status === 204 || status === 404 || status === 200) deleted++;
    else console.log(`  Failed ${id}: ${status}`);
  }
  console.log(`  Deleted ${deleted}/${ids.length}`);
}

console.log("\n✅ Cleanup complete");
