import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

import * as fs from "fs";
const seoPrompt = fs.readFileSync(
  path.resolve(__dirname, "../prompts/spyfu-seo-master-prompt.md"),
  "utf-8"
);
const ppcPrompt = fs.readFileSync(
  path.resolve(__dirname, "../prompts/spyfu-ppc-master-prompt.md"),
  "utf-8"
);

// ── Fetch current workflow ─────────────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

// ── Print current node chain ───────────────────────────────────────────────────
console.log("\nCurrent nodes:");
workflow.nodes.forEach((n: any) => console.log(`  • ${n.name}`));

// ── Find the "Download PDF" and "Prepare" nodes ────────────────────────────────
const downloadIdx = workflow.nodes.findIndex((n: any) => n.name === "Download PDF");
const prepareIdx  = workflow.nodes.findIndex((n: any) => n.name === "Prepare: Detect Type & Build Prompt");

if (downloadIdx === -1) { console.error("❌ Download PDF node not found"); process.exit(1); }
if (prepareIdx === -1)  { console.error("❌ Prepare node not found"); process.exit(1); }

const downloadNode = workflow.nodes[downloadIdx];
const prepareNode  = workflow.nodes[prepareIdx];
console.log(`\nDownload PDF position: ${downloadNode.position}`);
console.log(`Prepare position:      ${prepareNode.position}`);

// ── WHY WE NEED THIS NODE ──────────────────────────────────────────────────────
//
//  n8n has two binary data storage modes:
//
//  1. MEMORY mode: binary files stored in RAM as base64 strings.
//     Code nodes can read with: $binary.data.data  → base64 string ✅
//
//  2. FILESYSTEM mode (your setup): binary files written to disk as actual files.
//     Code nodes try $binary.data.data → returns "" (empty) ❌
//     Reason: Code nodes run in a sandbox without file-reading APIs (fs/helpers).
//
//  SOLUTION: Built-in n8n nodes DO have the proper API: this.helpers.getBinaryDataBuffer()
//  The "Move Binary Data" node uses this API internally, reads the file from disk,
//  and outputs the content as a base64 string in a JSON field.
//
//  New flow:
//    Download PDF → [NEW] Move Binary Data → Prepare → Claude
//                   (converts file to JSON    (reads $json.pdfBase64)
//                    {pdfBase64: "base64..."})

// ── Build the "Move Binary Data" node ─────────────────────────────────────────
//  Position it between Download PDF and Prepare
const newX = Math.round((downloadNode.position[0] + prepareNode.position[0]) / 2);
const newY = downloadNode.position[1];

const moveBinaryNode: any = {
  id: "node-move-binary-data",
  name: "Convert PDF to Base64",
  type: "n8n-nodes-base.moveBinaryData",
  typeVersion: 1,
  position: [newX, newY],
  parameters: {
    // Mode: convert binary data → JSON field
    mode: "binaryToJson",

    // Keep the existing JSON fields from the previous node (don't wipe them)
    setAllData: false,

    // Source: the binary property name from the Download PDF HTTP Request node.
    // When HTTP Request downloads a file, n8n stores it as binary under "data".
    sourceKey: "data",

    // Destination: where to write the base64 string in the JSON output
    destinationKey: "pdfBase64",

    options: {
      // encoding: "base64" tells the node: read the file bytes,
      // then store them encoded as base64 (not raw bytes, not utf8).
      // This is what Claude API needs: a base64-encoded PDF string.
      encoding: "base64",

      // Keep the binary item after conversion so downstream
      // nodes can still access the binary if needed
      keepSource: true,
    },
  },
};

console.log("\n✅ Built 'Convert PDF to Base64' (Move Binary Data) node");
console.log(`   Position: [${newX}, ${newY}]`);

// ── Insert the new node into the nodes array ───────────────────────────────────
// We insert it right after Download PDF (at downloadIdx + 1)
workflow.nodes.splice(downloadIdx + 1, 0, moveBinaryNode);

// ── Update connections ─────────────────────────────────────────────────────────
//  Before: Download PDF → Prepare
//  After:  Download PDF → Convert PDF to Base64 → Prepare
workflow.connections["Download PDF"] = {
  main: [[{ node: "Convert PDF to Base64", type: "main", index: 0 }]],
};
workflow.connections["Convert PDF to Base64"] = {
  main: [[{ node: "Prepare: Detect Type & Build Prompt", type: "main", index: 0 }]],
};
console.log("✅ Updated connections: Download PDF → Convert PDF to Base64 → Prepare");

// ── Update the Prepare node to read $json.pdfBase64 (not $binary) ─────────────
//  After Move Binary Data runs, the item's JSON contains { pdfBase64: "base64..." }.
//  The Prepare code node now reads $json.pdfBase64 instead of $binary.data.data.
const newPrepareCode = [
  "// subject comes from the Extract PDF URL node earlier in the flow",
  "var subject = $('Extract PDF URL').first().json.emailSubject || '';",
  "var reportType = subject.toLowerCase().indexOf('ppc') !== -1 ? 'PPC' : 'SEO';",
  "",
  "var seoPrompt = " + JSON.stringify(seoPrompt) + ";",
  "var ppcPrompt = " + JSON.stringify(ppcPrompt) + ";",
  "var masterPrompt = reportType === 'PPC' ? ppcPrompt : seoPrompt;",
  "",
  "// pdfBase64 comes from the Convert PDF to Base64 (Move Binary Data) node above.",
  "// That node reads the binary file from filesystem and converts it to base64 JSON.",
  "// $json.pdfBase64 is the base64-encoded PDF content ready for Claude API.",
  "var pdfBase64 = $json.pdfBase64 || '';",
  "",
  "return {",
  "  reportType: reportType,",
  "  masterPrompt: masterPrompt,",
  "  pdfBase64: pdfBase64,",
  "  pdfBase64Length: pdfBase64.length,",
  "  subject: subject,",
  "  receivedAt: new Date().toISOString()",
  "};",
].join("\n");

// Find the updated index (it shifted by 1 after our splice)
const newPrepareIdx = workflow.nodes.findIndex((n: any) =>
  n.name === "Prepare: Detect Type & Build Prompt"
);
workflow.nodes[newPrepareIdx].parameters.jsCode = newPrepareCode;
console.log("✅ Updated Prepare node to read $json.pdfBase64 instead of $binary");

// ── Push updated workflow back ─────────────────────────────────────────────────
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
  console.log("\n✅ Workflow updated!");
  console.log(`   URL: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`);
  console.log("\n   Final node order:");
  putData.nodes.forEach((n: any) => console.log(`   • ${n.name}`));
} else {
  console.error("❌ Failed:", JSON.stringify(putData, null, 2));
}
