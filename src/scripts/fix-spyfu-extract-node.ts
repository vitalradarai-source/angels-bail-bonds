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

// Step 2: Replace the "Extract PDF URL" HTML Extract node with a Code node
// that properly decodes the Gmail base64 payload
const decodeAndExtractCode = `
// Decode the Gmail payload to get the full HTML body
function decodeBase64Url(data) {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

let htmlBody = '';

// Try simple body first
if ($json.payload?.body?.data) {
  htmlBody = decodeBase64Url($json.payload.body.data);
}

// Try multipart (most Gmail emails are multipart)
if (!htmlBody && $json.payload?.parts) {
  const findHtml = (parts) => {
    for (const part of parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        const found = findHtml(part.parts);
        if (found) return found;
      }
    }
    return '';
  };
  htmlBody = findHtml($json.payload.parts);
}

// Extract PDF/download URL — SpyFu report links
const urlPatterns = [
  /href="(https?:\/\/[^"]*spyfu[^"]*(?:pdf|download|report|export)[^"]*)"/i,
  /href="(https?:\/\/reports?\\.spyfu\\.com\/[^"]*)"/i,
  /href="(https?:\/\/app\\.spyfu\\.com\/[^"]*(?:download|export|pdf)[^"]*)"/i,
  /href="(https?:\/\/[^"]*\\.pdf[^"]*)"/i,
];

let pdfUrl = '';
for (const pattern of urlPatterns) {
  const match = htmlBody.match(pattern);
  if (match) {
    pdfUrl = match[1];
    break;
  }
}

// Fallback: grab all hrefs and pick the most likely one
if (!pdfUrl) {
  const allHrefs = [...htmlBody.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map(m => m[1]);
  const candidate = allHrefs.find(u =>
    u.includes('spyfu') || u.includes('download') || u.includes('.pdf')
  );
  if (candidate) pdfUrl = candidate;
}

const emailSubject = $json.Subject || $json.subject || '';

return {
  pdfUrl,
  emailSubject,
  htmlLength: htmlBody.length,
};
`;

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
