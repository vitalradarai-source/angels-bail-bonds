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

// ── 1. Add moveBinaryData node between "Drive: Download PDF" and "Code: Collect PDFs"
// moveBinaryData reads n8n's internal binary storage (including filesystem refs)
// and copies the actual base64 string into a JSON property.
const downloadNode = wf.nodes.find((n: any) => n.name === "Drive: Download PDF");
const collectNode  = wf.nodes.find((n: any) => n.name === "Code: Collect PDFs");

const convertNode = {
  id: "convert-pdf-base64",
  name: "Convert PDF to Base64",
  type: "n8n-nodes-base.moveBinaryData",
  typeVersion: 1,
  position: [
    (downloadNode.position[0] + collectNode.position[0]) / 2,
    downloadNode.position[1],
  ],
  parameters: {
    mode: "binaryToJson",
    setAllData: false,
    destinationKey: "base64",
    sourceKey: "data",
    encoding: "base64",
    options: {},
  },
};

wf.nodes.push(convertNode);
console.log("✅ Added 'Convert PDF to Base64' (moveBinaryData) node");

// ── 2. Update connections: Download → Convert → Collect ──────────────────────
// Old: Drive: Download PDF → Code: Collect PDFs
// New: Drive: Download PDF → Convert PDF to Base64 → Code: Collect PDFs
wf.connections["Drive: Download PDF"] = {
  main: [[{ node: "Convert PDF to Base64", type: "main", index: 0 }]],
};
wf.connections["Convert PDF to Base64"] = {
  main: [[{ node: "Code: Collect PDFs", type: "main", index: 0 }]],
};
console.log("✅ Connection chain updated: Download → Convert → Collect");

// ── 3. Update Code: Collect PDFs to read from $json.base64 ───────────────────
const collectIdx = wf.nodes.findIndex((n: any) => n.name === "Code: Collect PDFs");
wf.nodes[collectIdx].parameters.jsCode = `
// Collect all PDFs into one item for Claude
// moveBinaryData already converted binary → base64 string in $json.base64
var items     = $input.all();
var metaItems = $('Code: Timesheet PDF IDs').all();

function toStdBase64(s) {
  if (!s) return '';
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

var pdfList = [];
for (var i = 0; i < items.length; i++) {
  var base64   = items[i].json.base64 || '';
  var metaJson = metaItems[i] ? metaItems[i].json : {};
  var filename = metaJson.name || ('timesheet-' + (i + 1) + '.pdf');

  if (!base64) {
    console.log('Warning: no base64 data for item ' + i + ' (' + filename + ')');
    continue;
  }

  pdfList.push({ filename: filename, base64: toStdBase64(base64) });
}

if (pdfList.length === 0) throw new Error('No PDF data collected after conversion');
console.log('Collected ' + pdfList.length + ' PDFs for Claude');
return { pdfList: pdfList };
`.trim();
console.log("✅ Code: Collect PDFs updated to read from $json.base64");

// ── 4. Deactivate + save ──────────────────────────────────────────────────────
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
