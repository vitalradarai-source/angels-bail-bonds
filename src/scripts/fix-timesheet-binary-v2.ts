import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "TRlQAbUmRhk3tLZO";

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name}`);

// ── 1. Remove the old moveBinaryData node (if present) ───────────────────────
const oldIdx = wf.nodes.findIndex((n: any) => n.name === "Convert PDF to Base64");
if (oldIdx !== -1) {
  wf.nodes.splice(oldIdx, 1);
  console.log("✅ Removed old moveBinaryData node");
}

// ── 2. Add a Code node that uses getBinaryDataBuffer ─────────────────────────
const downloadNode = wf.nodes.find((n: any) => n.name === "Drive: Download PDF");
const collectNode  = wf.nodes.find((n: any) => n.name === "Code: Collect PDFs");

const convertNode = {
  id: "convert-pdf-base64-v2",
  name: "Convert PDF to Base64",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [
    Math.round((downloadNode.position[0] + collectNode.position[0]) / 2),
    downloadNode.position[1],
  ],
  parameters: {
    mode: "runOnceForEachItem",
    jsCode: `
// Resolve n8n filesystem binary reference → real base64 string
const buf = await this.helpers.getBinaryDataBuffer(item, 'data');
return { json: { base64: buf.toString('base64') } };
`.trim(),
  },
};

wf.nodes.push(convertNode);
console.log("✅ Added 'Convert PDF to Base64' Code node (getBinaryDataBuffer)");

// ── 3. Update connections: Download → Convert → Collect ──────────────────────
wf.connections["Drive: Download PDF"] = {
  main: [[{ node: "Convert PDF to Base64", type: "main", index: 0 }]],
};
wf.connections["Convert PDF to Base64"] = {
  main: [[{ node: "Code: Collect PDFs", type: "main", index: 0 }]],
};
console.log("✅ Connection chain updated: Download → Convert → Collect");

// ── 4. Update Code: Collect PDFs — read from $json.base64, no transform ───────
const collectIdx = wf.nodes.findIndex((n: any) => n.name === "Code: Collect PDFs");
wf.nodes[collectIdx].parameters.jsCode = `
// Collect all PDFs into one item for Claude
// Convert PDF to Base64 node already resolved binary → proper base64 string
var items     = $input.all();
var metaItems = $('Code: Timesheet PDF IDs').all();

var pdfList = [];
for (var i = 0; i < items.length; i++) {
  var base64   = items[i].json.base64 || '';
  var metaJson = metaItems[i] ? metaItems[i].json : {};
  var filename = metaJson.name || ('timesheet-' + (i + 1) + '.pdf');

  if (!base64) {
    console.log('Warning: no base64 data for item ' + i + ' (' + filename + ')');
    continue;
  }

  // Standard base64 from Buffer.toString('base64') needs no transform
  pdfList.push({ filename: filename, base64: base64 });
}

if (pdfList.length === 0) throw new Error('No PDF data collected after conversion');
console.log('Collected ' + pdfList.length + ' PDFs for Claude');
return { pdfList: pdfList };
`.trim();
console.log("✅ Code: Collect PDFs updated");

// ── 5. Deactivate + save ──────────────────────────────────────────────────────
await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});

const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, staticData: wf.staticData ?? null,
  }),
});
const putData = await putRes.json();
if (putRes.ok) console.log("✅ Saved — ready to run");
else console.error("❌ Save failed:", JSON.stringify(putData, null, 2));
