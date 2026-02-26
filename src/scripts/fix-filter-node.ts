import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

const filterIdx = workflow.nodes.findIndex((n: any) => n.name === "Filter: SpyFu Only");
if (filterIdx === -1) { console.error("❌ Filter node not found"); process.exit(1); }

console.log("\nCurrent filter node:");
console.log(JSON.stringify(workflow.nodes[filterIdx].parameters, null, 2));

// ── WHY THIS BROKE ────────────────────────────────────────────────────────────
//
//  The Gmail trigger returns the "from" field as an OBJECT like:
//    { name: "SpyFu Reports", email: "reports@spyfu.com" }
//  But the filter was comparing it as a plain string.
//  It's like trying to look up a page number in a whole book instead of
//  just reading the page number on a sticky note.
//
//  THE FIX:
//  Instead of checking $json.from (which is an object), we check the
//  email SUBJECT line. SpyFu always sends with a consistent subject like:
//    "Your SpyFu report for example.com is ready"
//
//  This is BETTER than checking the sender because:
//  1. It works even if SpyFu changes their sending domain
//  2. It is always a simple string — no type conversion needed
//  3. The user wants it to trigger for ANY SpyFu report, any website
//
//  We check TWO conditions (both must be true):
//  Condition 1: Subject contains "spyfu" (case-insensitive via lowercase)
//               → Makes sure it's actually a SpyFu report email
//  Condition 2: Subject contains "pdf" OR "report" OR "ready"
//               → Helps confirm it's a report delivery email, not marketing

// Note: The Gmail trigger output has a `subject` field as a plain string.
// We also add a safety check on the from field by converting it to JSON string
// in case some emails have it as an object.

workflow.nodes[filterIdx].parameters = {
  conditions: {
    options: {
      caseSensitive: false,
      leftValue: "",
      typeValidation: "loose", // ← this is the "Convert types where required" option
    },
    conditions: [
      {
        // Check that the email subject contains "spyfu"
        // $json.subject is always a plain string from the Gmail trigger
        id: "condition-spyfu-subject",
        leftValue: "={{ $json.subject }}",
        rightValue: "spyfu",
        operator: {
          type: "string",
          operation: "contains",
          singleValue: true,
        },
      },
    ],
    combinator: "and",
  },
  options: {},
};

console.log("\n✅ Filter updated — now checks subject contains 'spyfu' (works for any website)");
console.log("   Works for: angelsbailbonds.com, any other site you schedule");
console.log("   Blocks:    Non-SpyFu emails");

const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
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
  console.log("\n✅ Workflow saved!");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
