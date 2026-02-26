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

// ── Find the Prepare node ──────────────────────────────────────────────────────
const idx = workflow.nodes.findIndex((n: any) =>
  n.name === "Prepare: Detect Type & Build Prompt"
);
if (idx === -1) { console.error("❌ Prepare node not found"); process.exit(1); }
console.log("✅ Found:", workflow.nodes[idx].name);

// ── THE BUG (lesson): How binary data works in n8n Code nodes ─────────────────
//
//  When an HTTP Request node downloads a file (responseFormat: "file"),
//  n8n stores it as a "binary item" object with this structure:
//
//    $binary.data = {
//      mimeType: "application/pdf",
//      data: "JVBERi0xLjQ...",   ← base64-encoded file content
//      fileSize: "8924",
//      ...
//    }
//
//  The CURRENT code does:
//    const binaryData = $binary?.data;       ← gets the OBJECT above
//    pdfBase64 = binaryData.toString('base64')  ← .toString() on an object = "[object Object]"
//
//  In JavaScript, calling .toString() on a plain object always returns
//  "[object Object]" — it does NOT base64-encode anything.
//  So pdfBase64 becomes the literal string "[object Object]", which Claude
//  rejects as not being a valid PDF (or in some cases as empty).
//
//  THE FIX: Access the .data PROPERTY of the binary item — it's ALREADY base64.
//    const binaryItem = $binary?.data;
//    pdfBase64 = binaryItem?.data || '';   ← .data is the base64 string
//
//  Note: With binaryDataMode "filesystem" (your n8n config), n8n automatically
//  reads the file from disk when a Code node accesses $binary, so this works.

// Build the fixed code as an array of lines (same technique as before —
// avoids backslash/quote escaping issues when sending through JSON API).
const fixedPrepareCode = [
  "var subject = $('Extract PDF URL').first().json.emailSubject || '';",
  "var reportType = subject.toLowerCase().indexOf('ppc') !== -1 ? 'PPC' : 'SEO';",
  "",
  "var seoPrompt = " + JSON.stringify(seoPrompt) + ";",
  "var ppcPrompt = " + JSON.stringify(ppcPrompt) + ";",
  "var masterPrompt = reportType === 'PPC' ? ppcPrompt : seoPrompt;",
  "",
  "// Binary data in n8n Code nodes:",
  "// $binary.data  →  the IBinaryData object: { data: 'base64...', mimeType: '...' }",
  "// $binary.data.data  →  the base64 string itself (already encoded)",
  "// With filesystem binaryDataMode, n8n reads the file from disk automatically.",
  "var binaryItem = $binary && $binary.data ? $binary.data : null;",
  "var pdfBase64 = binaryItem ? (binaryItem.data || '') : '';",
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

console.log("\n   Fixed code preview (first 300 chars):");
console.log("   " + fixedPrepareCode.slice(0, 300).replace(/\n/g, "\n   "));

// ── Apply the fix ──────────────────────────────────────────────────────────────
workflow.nodes[idx].parameters.jsCode = fixedPrepareCode;

// ── Push back to n8n ──────────────────────────────────────────────────────────
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
  console.log("\n✅ Prepare node fixed!");
  console.log(`   URL: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`);
} else {
  console.error("❌ Failed:", JSON.stringify(putData, null, 2));
}
