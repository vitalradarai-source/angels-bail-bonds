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

// ── 1. Remove any existing "Convert PDF to Base64" node (v1 or v2) ────────────
const oldIdx = wf.nodes.findIndex((n: any) => n.name === "Convert PDF to Base64");
if (oldIdx !== -1) {
  wf.nodes.splice(oldIdx, 1);
  delete wf.connections["Convert PDF to Base64"];
  console.log("✅ Removed old Convert PDF to Base64 node");
}

// ── 2. Add moveBinaryData node — copies raw PDF bytes into $json.rawBinary ────
// The n8n sandbox can't access filesystem refs via getBinaryDataBuffer,
// but moveBinaryData CAN (it runs in the main process).
// encoding:"base64" causes it to store raw binary as a JS string (each char = 1 byte).
const downloadNode = wf.nodes.find((n: any) => n.name === "Drive: Download PDF");
const collectNode  = wf.nodes.find((n: any) => n.name === "Code: Collect PDFs");

const convertNode = {
  id: "convert-pdf-raw-bytes",
  name: "Convert PDF to Base64",
  type: "n8n-nodes-base.moveBinaryData",
  typeVersion: 1,
  position: [
    Math.round((downloadNode.position[0] + collectNode.position[0]) / 2),
    downloadNode.position[1],
  ],
  parameters: {
    mode: "binaryToJson",
    setAllData: false,
    destinationKey: "rawBinary",
    sourceKey: "data",
    // "base64" here tells moveBinaryData to store raw bytes as a string —
    // we'll use Buffer.from(str, 'binary').toString('base64') in the Code node
    encoding: "base64",
    options: {},
  },
};

wf.nodes.push(convertNode);
console.log("✅ Added moveBinaryData node → $json.rawBinary");

// ── 3. Connections: Download → Convert → Collect ──────────────────────────────
wf.connections["Drive: Download PDF"] = {
  main: [[{ node: "Convert PDF to Base64", type: "main", index: 0 }]],
};
wf.connections["Convert PDF to Base64"] = {
  main: [[{ node: "Code: Collect PDFs", type: "main", index: 0 }]],
};
console.log("✅ Connection chain updated");

// ── 4. Code: Collect PDFs — convert raw binary string → proper base64 ─────────
// moveBinaryData gives us raw PDF bytes stored as a JS Latin-1 string.
// Buffer.from(str, 'binary') reads each char as one byte → correct base64.
const collectIdx = wf.nodes.findIndex((n: any) => n.name === "Code: Collect PDFs");
wf.nodes[collectIdx].parameters.jsCode = `
// Collect all PDFs into one item for Claude
// moveBinaryData stores raw PDF bytes in $json.rawBinary (Latin-1 string).
// Buffer.from(str, 'binary') treats each char as one byte → proper base64.
var items     = $input.all();
var metaItems = $('Code: Timesheet PDF IDs').all();

var pdfList = [];
for (var i = 0; i < items.length; i++) {
  var rawBinary = items[i].json.rawBinary || '';
  var metaJson  = metaItems[i] ? metaItems[i].json : {};
  var filename  = metaJson.name || ('timesheet-' + (i + 1) + '.pdf');

  if (!rawBinary) {
    console.log('Warning: no binary data for item ' + i + ' (' + filename + ')');
    continue;
  }

  // Convert raw binary string → proper base64
  var base64 = Buffer.from(rawBinary, 'binary').toString('base64');
  pdfList.push({ filename: filename, base64: base64 });
}

if (pdfList.length === 0) throw new Error('No PDF data collected after conversion');
console.log('Collected ' + pdfList.length + ' PDFs for Claude');
return { pdfList: pdfList };
`.trim();
console.log("✅ Code: Collect PDFs updated — uses Buffer.from(rawBinary, 'binary').toString('base64')");

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
