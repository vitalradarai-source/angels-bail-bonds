/**
 * Cleans up DPR for AngelsBailbonds (901414349243).
 * - For each date: merges content from duplicate tasks into the clean DPR task
 * - Deletes all duplicate tasks, leaving exactly 1 task per date
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY!;
const LIST_ID = "901414349243"; // DPR for AngelsBailbonds — the only list with duplicates

async function cu(method: string, path: string, body?: object) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    method,
    headers: { Authorization: CLICKUP_API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "DELETE") return res.status;
  return res.json();
}

// Fetch all tasks (handle pagination)
async function getAllTasks(listId: string) {
  const tasks: any[] = [];
  let page = 0;
  while (true) {
    const data: any = await cu("GET", `/list/${listId}/task?include_closed=false&page=${page}`);
    const batch = data.tasks || [];
    tasks.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return tasks;
}

console.log(`Fetching all tasks from DPR for AngelsBailbonds...`);
const allTasks = await getAllTasks(LIST_ID);
console.log(`Total tasks: ${allTasks.length}`);

// Group by base date (extract MM/DD/YYYY from task name)
const byDate: Record<string, any[]> = {};
for (const task of allTasks) {
  const m = task.name.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (!m) { console.log(`  Skipping odd task: "${task.name}" (${task.id})`); continue; }
  const date = m[1];
  if (!byDate[date]) byDate[date] = [];
  byDate[date].push(task);
}

const dates = Object.keys(byDate).sort();
console.log(`Unique dates: ${dates.length}`);

let merged = 0;
let deleted = 0;

for (const date of dates) {
  const group = byDate[date];
  if (group.length === 1) {
    // Already clean — if name has "— Name" suffix, rename it to just the date
    const t = group[0];
    if (t.name !== date) {
      await cu("PUT", `/task/${t.id}`, { name: date });
      console.log(`  Renamed: "${t.name}" → "${date}" (${t.id})`);
    }
    continue;
  }

  // Multiple tasks for this date — pick the "canonical" one to keep
  // Priority: plain "MM/DD/YYYY" name first, otherwise first by ID
  group.sort((a, b) => {
    const aClean = a.name === date ? 0 : 1;
    const bClean = b.name === date ? 0 : 1;
    return aClean - bClean;
  });

  const keeper = group[0];
  const dupes  = group.slice(1);

  // Collect all descriptions to merge
  const parts: string[] = [];
  if (keeper.description?.trim()) parts.push(keeper.description.trim());
  for (const d of dupes) {
    if (d.description?.trim()) {
      const label = d.name !== date ? `\n\n---\n**${d.name.replace(date, "").replace(/^[\s—-]+/, "").trim() || "Timesheet entry"}:**\n` : "\n\n---\n";
      parts.push(label + d.description.trim());
    }
  }

  const mergedDesc = parts.join("\n\n").trim();

  // Update the keeper with merged description + ensure correct name
  await cu("PUT", `/task/${keeper.id}`, {
    name: date,
    ...(mergedDesc ? { description: mergedDesc } : {}),
  });
  if (keeper.name !== date) {
    console.log(`  Renamed keeper: "${keeper.name}" → "${date}"`);
  }
  merged++;

  // Delete all duplicates
  for (const dupe of dupes) {
    const status = await cu("DELETE", `/task/${dupe.id}`);
    console.log(`  Deleted: "${dupe.name}" (${dupe.id}) — status ${status}`);
    deleted++;
  }

  console.log(`  ✅ ${date}: kept ${keeper.id}, merged ${dupes.length} duplicate(s)`);
}

console.log(`\n✅ Done — merged ${merged} date groups, deleted ${deleted} duplicate tasks`);
console.log(`DPR for AngelsBailbonds now has exactly 1 task per date.`);
