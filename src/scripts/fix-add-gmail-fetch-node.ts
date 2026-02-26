import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

// ── Fetch current workflow ────────────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) {
  console.error("❌ Fetch failed:", JSON.stringify(workflow, null, 2));
  process.exit(1);
}
console.log("✅ Fetched workflow:", workflow.name);

// ── Log current node names + positions so we can plan the insert ──────────────
console.log("\nCurrent nodes:");
workflow.nodes.forEach((n: any) =>
  console.log(`  [${n.position}] ${n.name}`)
);

// ── The problem we're solving ─────────────────────────────────────────────────
//
//  n8n's Gmail TRIGGER uses Gmail API with format=metadata.
//  That gives: id, threadId, snippet, labels, payload.mimeType
//  But NOT: payload.body.data (the actual HTML content)
//
//  Solution: use the message ID ($json.id) to make a second Gmail API call
//  with format=full, which returns the complete message including the body.
//
//  New flow:
//  Gmail Trigger → Filter → [NEW] Fetch Full Message → Extract PDF URL → Download PDF → ...
//
//  The "Fetch Full Message" node calls:
//    GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}?format=full
//  using the Gmail OAuth2 credential already in n8n ("4434 Gmail account").

// ── Shift all nodes from index 2 onward 240px to the right to make room ──────
//  (Filter is at index 1, Extract PDF URL is at index 2 = position [480, 200])
//  We insert the new node at [480, 200] and push the rest right.
const insertAfterName = "Filter: SpyFu Only";
const filterIndex = workflow.nodes.findIndex((n: any) => n.name === insertAfterName);

if (filterIndex === -1) {
  console.error("❌ Could not find Filter node");
  process.exit(1);
}

// Shift every node that comes after the filter 240px right
for (let i = 0; i < workflow.nodes.length; i++) {
  const n = workflow.nodes[i];
  // Only shift nodes that are to the right of the filter (x > filter.x)
  if (n.position[0] > workflow.nodes[filterIndex].position[0]) {
    n.position = [n.position[0] + 240, n.position[1]];
  }
}

// ── Build the new "Fetch Full Message" HTTP Request node ──────────────────────
//
//  Authentication: "predefinedCredentialType" + "gmailOAuth2Api"
//  This tells n8n to use the Gmail OAuth2 credential the user already has.
//  The credential handles the Authorization header automatically.
//
//  URL template: https://gmail.googleapis.com/gmail/v1/users/me/messages/{{id}}?format=full
//  We reference $json.id which comes from the Gmail trigger output.
const fetchFullMessageNode = {
  id: "node-fetch-full-message",
  name: "Gmail: Fetch Full Message",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  // Position it where Extract PDF URL used to be (filter.x + 240)
  position: [
    workflow.nodes[filterIndex].position[0] + 240,
    workflow.nodes[filterIndex].position[1] - 100,
  ],
  parameters: {
    method: "GET",
    // format=full tells Gmail API to return the complete message with body data
    url: "=https://gmail.googleapis.com/gmail/v1/users/me/messages/{{ $json.id }}?format=full",
    // Use the Gmail OAuth2 credential already configured in n8n
    authentication: "predefinedCredentialType",
    nodeCredentialType: "gmailOAuth2Api",
    options: {},
  },
};

// Insert new node right after the Filter node
workflow.nodes.splice(filterIndex + 1, 0, fetchFullMessageNode);

console.log("\n✅ Inserted 'Gmail: Fetch Full Message' node");

// ── Update connections ────────────────────────────────────────────────────────
//
//  Before:  Filter (true) → Extract PDF URL
//  After:   Filter (true) → Fetch Full Message → Extract PDF URL
//
//  In n8n's connections object:
//   - "main" is an array of output branches
//   - For an IF node: main[0] = true branch, main[1] = false branch
//   - Each branch is an array of {node, type, index} connection targets

// Change Filter's true branch to point to the new Fetch node
workflow.connections["Filter: SpyFu Only"] = {
  main: [
    [{ node: "Gmail: Fetch Full Message", type: "main", index: 0 }], // true branch
    [], // false branch — do nothing
  ],
};

// Add connection from Fetch Full Message to Extract PDF URL
workflow.connections["Gmail: Fetch Full Message"] = {
  main: [
    [{ node: "Extract PDF URL", type: "main", index: 0 }],
  ],
};

console.log("✅ Updated connections:");
console.log("   Filter (true) → Gmail: Fetch Full Message → Extract PDF URL");

// ── Push updated workflow back to n8n ─────────────────────────────────────────
const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: {
    "X-N8N-API-KEY": N8N_API_KEY,
    "Content-Type": "application/json",
  },
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
  console.log("\n✅ Workflow updated successfully!");
  console.log(`   URL: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`);
  console.log("\n   Final node order:");
  putData.nodes.forEach((n: any) => console.log(`   • ${n.name}`));
} else {
  console.error("❌ Failed to update workflow:", JSON.stringify(putData, null, 2));
}
