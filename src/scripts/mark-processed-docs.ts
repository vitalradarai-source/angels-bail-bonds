/**
 * Pre-marks the 19 already-processed docs (02/02–02/26) in n8n static data
 * so the workflow only processes the new 02/27/2026 doc.
 * Also excludes timesheets and non-date docs.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra";

// These 19 docs were already successfully processed by execution #162
// (the run that created the correct 02/02–02/26 tasks in ClickUp)
const alreadyProcessed: Record<string, string> = {
  "1Wn7iK-77oapKCV6D0qpn3pWkWNz4ApZc5eMCLuw65-w": "02/02/2026",
  "1JwPETnmxBia7FrMomS4wiJMdCxH-MJy9KNQNupxwvTw": "02/03/2026",
  "17mPOIh0uLN3QutDyQYI8c3YD4laXPJYSmEKXwdX8g60": "02/04/2026",
  "1f39x-pLtxaIx2exCVQN6UYDTvcw8qmT9DQ4qbt9DI1Y": "02/05/2026",
  "1yzIBkQgFbdJ6jQ-MKf1PJ5zlJL-MtvFNAN0po1lZAFo": "02/06/2026",
  "16xSG84D7XUkUAPuGYkHU97Tov2GoeUrAxfIQHzvjXIY": "02/09/2026",
  "1tkzo-dQbhzZLXu1gwnClopC4zFa9kseTFInXyfpt1XU": "02/10/2026",
  "1rbdI368dSt6QRtW7vyq1M7EYnufkOLFUdEp575g-_a8": "02/11/2026",
  "10ytJPe-x9i6nhudU7i42TP2M8zobKg3U9VIbqYUyZF0": "02/12/2026",
  "1OVZ7GZONwRe9kXRv4iuM9WVnl5eE6SjUxbgLXgZ0YNw": "02/13/2026",
  "1HnY4KgImimIkaT-5UdRXgzKFY5drisutn0oweuNg6SU": "02/16/2026",
  "1MtFs6mKzRaujNYKYBmisyT1NN8LmqPnjyMzzGwSM43c": "02/17/2026",
  "14X8CF5mgh8qAjRLkGunyrYhmuOEa92mSZSHFPft7LlA": "02/18/2026",
  "1xv-LTR07_Eo_cZoHPUXAi-jhlj9RQneJsmuFGssph5M": "02/19/2026",
  "10Qasxl0njCMrCQ9cEcpy9u-FFoLHn3KLa2nFkIj3iE8": "02/20/2026",
  "1fhHe8p9iRkUQ2qXX91LxPZbcw-_iI9sozelqyVlKrec": "02/23/2026",
  "12A7DOZrwL1f3VqsxnzUgRqFkeKS3z-hgC55YUsDtCOo": "02/24/2026",
  "1MXGUNorDhIL-SEdxuWH4SFBS7-XQeKy57UUrqgd1JA0": "02/25/2026",
  "12BzIe3ICaSSZzff7PPMLlRW2TCw9JG3VGxUwtCOsjCU": "02/26/2026",
  // Mark timesheets + January doc as skipped permanently (not progress reports)
  "1IZ8m8ADwWmumGajkz1j0Aft9w34rNS1b": "January 2026 (skip)",
  "158jrGxKL6xLoof3PYiDDIfQ_lsJezbz6": "Timesheet PDF (skip)",
  "18Cb73JkxHUe9LK2rtxa0WqmLFsJcpdjp": "Timesheet PDF (skip)",
  "1UsyTsQqEFQGCiCKLJpRWd_UMlimYVCOG": "Timesheet PDF (skip)",
};

// Build the static data payload
const staticData = {
  global: {
    docIds: Object.fromEntries(
      Object.entries(alreadyProcessed).map(([id, date]) => [
        id,
        { date, processedAt: "2026-02-27T15:00:57.213Z" }  // execution #162 timestamp
      ])
    )
  }
};

console.log(`Marking ${Object.keys(alreadyProcessed).length} docs as already processed`);
console.log("NOT marking 02/27/2026 — so it gets processed fresh");

const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await putRes.json();

const saveRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
    staticData,
  }),
});

const result = await saveRes.json();
if (!saveRes.ok) {
  console.error("❌ Failed:", JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log("✅ Static data saved — only 02/27/2026 will be processed on next run");
console.log("   All future docs added to the folder will also be auto-processed once.");
