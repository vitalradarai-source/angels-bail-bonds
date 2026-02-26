import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

// ── WHAT WENT WRONG ───────────────────────────────────────────────────────────
//
//  When the "Google Docs: Create Report" node runs, it creates a blank document.
//  Google sends back a response that looks like this:
//
//    {
//      "kind": "drive#file",
//      "id": "1zD2d0ybPS6az-5tMN5KB-ABxucx6TZ4RXdVaYwpcD-I",    ← THIS is the doc ID
//      "name": "SpyFu SEO Analysis – February 26, 2026",
//      "mimeType": "application/vnd.google-apps.document"
//    }
//
//  The ID field is called "id" — plain and simple.
//
//  But in the Write Content node, our URL was using "$json.documentId"
//  (with "document" in front). That field does not exist in the response.
//  So JavaScript says: "I can't find documentId... I'll use 'undefined' instead."
//
//  The URL became:
//    https://docs.googleapis.com/v1/documents/undefined:batchUpdate
//
//  And Google replied: "I have no document called 'undefined'!" → 404 error
//
//  THE FIX: Change "$json.documentId"  →  "$json.id"
//  Now the URL correctly uses the real document ID from the Create node output.

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

const writeIdx = workflow.nodes.findIndex((n: any) => n.name === "Google Docs: Write Content");
if (writeIdx === -1) {
  console.error("❌ Could not find 'Google Docs: Write Content' node.");
  console.log("   Nodes in workflow:", workflow.nodes.map((n: any) => n.name).join(", "));
  process.exit(1);
}

const writeNode = workflow.nodes[writeIdx];
console.log("\n📋 Current URL in Write Content node:");
console.log("  ", writeNode.parameters?.url);

// The fix: replace documentId with id
const oldUrl = writeNode.parameters.url as string;
const newUrl = oldUrl.replace("$json.documentId", "$json.id");

if (oldUrl === newUrl) {
  console.log("\n⚠️  URL already uses $json.id — no change needed.");
  console.log("   Current URL:", newUrl);
} else {
  workflow.nodes[writeIdx].parameters.url = newUrl;
  console.log("\n✅ Fixed URL:");
  console.log("   Old:", oldUrl);
  console.log("   New:", newUrl);
}

// Push the updated workflow back to n8n
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
  console.log("   Nodes:", putData.nodes.map((n: any) => n.name).join(" → "));
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
