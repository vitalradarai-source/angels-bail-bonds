import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

// Step 1: Fetch the current workflow
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();

if (!getRes.ok) {
  console.error("❌ Failed to fetch workflow:", JSON.stringify(workflow, null, 2));
  process.exit(1);
}

console.log("✅ Fetched workflow:", workflow.name);
console.log("   Current nodes:", workflow.nodes.map((n: any) => n.name));

// Step 2: Build the Code node JavaScript as an array of line strings then join.
//
// LESSON — why this approach:
//   The code must travel as: TypeScript string → JSON.stringify → n8n API → n8n JS engine.
//   Each layer has its own escaping rules. Regex literals with " chars inside them
//   cause "Unterminated group" errors because the quotes get double-escaped along the way.
//
//   Fix: write the generated JS using only single-quoted strings. When we need a literal
//   double-quote character (e.g. to split on href="), we use String.fromCharCode(34)
//   instead of writing the character itself — zero escaping problems, fully readable.
const decodeAndExtractCode = [
  "// String.fromCharCode(34) = double-quote character, used to avoid escaping issues",
  "var DQ = String.fromCharCode(34);",
  "",
  "// Decode base64url (Gmail uses base64url, not standard base64)",
  "// base64url swaps + with - and / with _ to make URLs safe.",
  "// We reverse that, add padding if needed, then decode.",
  "function decodeBase64Url(data) {",
  "  var b64 = data.replace(/-/g, '+').replace(/_/g, '/');",
  "  var rem = b64.length % 4;",
  "  if (rem > 0) { b64 = b64 + '===='.slice(0, 4 - rem); }",
  "  return Buffer.from(b64, 'base64').toString('utf-8');",
  "}",
  "",
  "// Gmail multipart emails nest parts inside parts.",
  "// This function walks the tree to find the HTML part.",
  "function findHtmlPart(parts) {",
  "  for (var i = 0; i < parts.length; i++) {",
  "    var p = parts[i];",
  "    if (p.mimeType === 'text/html' && p.body && p.body.data) {",
  "      return decodeBase64Url(p.body.data);",
  "    }",
  "    if (p.parts) {",
  "      var nested = findHtmlPart(p.parts);",
  "      if (nested) return nested;",
  "    }",
  "  }",
  "  return '';",
  "}",
  "",
  "var htmlBody = '';",
  "var payload = $json.payload || {};",
  "",
  "// Case 1: simple email — body data sits directly on payload.body",
  "if (payload.body && payload.body.data) {",
  "  htmlBody = decodeBase64Url(payload.body.data);",
  "}",
  "",
  "// Case 2: multipart email — body is nested inside payload.parts",
  "if (!htmlBody && payload.parts) {",
  "  htmlBody = findHtmlPart(payload.parts);",
  "}",
  "",
  "// Extract href URLs without regex.",
  "// Split on 'href=\"' — every piece after a split starts with the URL.",
  "// Then take everything up to the next double-quote to get the URL.",
  "var pdfUrl = '';",
  "var chunks = htmlBody.split('href=' + DQ);",
  "for (var i = 1; i < chunks.length; i++) {",
  "  var url = chunks[i].split(DQ)[0];",
  "  var lower = url.toLowerCase();",
  "  if (lower.indexOf('spyfu') !== -1 ||",
  "      lower.indexOf('download') !== -1 ||",
  "      lower.slice(-4) === '.pdf') {",
  "    pdfUrl = url;",
  "    break;",
  "  }",
  "}",
  "",
  "var emailSubject = $json.Subject || $json.subject || '';",
  "",
  "return {",
  "  pdfUrl: pdfUrl,",
  "  emailSubject: emailSubject,",
  "  htmlLength: htmlBody.length,",
  "  payloadKeys: Object.keys(payload).join(', ')",
  "};",
].join("\n");

// Step 3: Find and replace the Extract PDF URL node
const nodeIndex = workflow.nodes.findIndex((n: any) => n.name === "Extract PDF URL");

if (nodeIndex === -1) {
  console.error("❌ Could not find 'Extract PDF URL' node");
  process.exit(1);
}

const originalNode = workflow.nodes[nodeIndex];
console.log(`\n   Found node at index ${nodeIndex}:`, originalNode.name, "—", originalNode.type);

// Replace with Code node
workflow.nodes[nodeIndex] = {
  id: originalNode.id,
  name: "Extract PDF URL",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: originalNode.position,
  parameters: {
    mode: "runOnceForEachItem",
    jsCode: decodeAndExtractCode,
  },
};

console.log("   Replaced with Code node (base64 decoder + URL extractor)");

// Step 4: Push the updated workflow back to n8n
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
  console.log(`   ID: ${putData.id}`);
  console.log(`   URL: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`);
  console.log("\n   Node breakdown:");
  putData.nodes.forEach((n: any) => console.log(`   • ${n.name} (${n.type})`));
} else {
  console.error("❌ Failed to update workflow:", JSON.stringify(putData, null, 2));
}
