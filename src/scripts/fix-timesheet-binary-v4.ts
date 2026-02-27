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

// ── 1. Remove the moveBinaryData node — it can't access filesystem binary refs ─
const convertIdx = wf.nodes.findIndex((n: any) => n.name === "Convert PDF to Base64");
if (convertIdx !== -1) {
  wf.nodes.splice(convertIdx, 1);
  delete wf.connections["Convert PDF to Base64"];
  console.log("✅ Removed moveBinaryData node");
}

// ── 2. Change Drive: Download PDF to return base64 text directly ──────────────
// n8n HTTP Request with responseFormat:"text" + encoding:"base64" calls
// Buffer.toString('base64') internally — no binary filesystem storage involved.
const dlIdx = wf.nodes.findIndex((n: any) => n.name === "Drive: Download PDF");
wf.nodes[dlIdx].parameters.options = {
  response: {
    response: {
      responseFormat: "text",
      outputPropertyName: "data",  // base64 string stored in $json.data
      encoding: "base64",          // buffer.toString('base64')
    },
  },
};
console.log("✅ Drive: Download PDF → responseFormat:text + encoding:base64 → $json.data");

// ── 3. Direct connection: Download → Collect (no intermediate node) ────────────
wf.connections["Drive: Download PDF"] = {
  main: [[{ node: "Code: Collect PDFs", type: "main", index: 0 }]],
};
console.log("✅ Connection: Drive: Download PDF → Code: Collect PDFs (direct)");

// ── 4. Code: Collect PDFs — read base64 from $json.data ───────────────────────
const collectIdx = wf.nodes.findIndex((n: any) => n.name === "Code: Collect PDFs");
wf.nodes[collectIdx].parameters.jsCode = `
// Collect all PDFs into one item for Claude.
// Drive: Download PDF now returns base64 directly in $json.data
// (responseFormat:text + encoding:base64 → Buffer.toString('base64'))
var items     = $input.all();
var metaItems = $('Code: Timesheet PDF IDs').all();

var pdfList = [];
for (var i = 0; i < items.length; i++) {
  var base64   = items[i].json.data || '';
  var metaJson = metaItems[i] ? metaItems[i].json : {};
  var filename = metaJson.name || ('timesheet-' + (i + 1) + '.pdf');

  if (!base64) {
    console.log('Warning: no base64 data for item ' + i + ' (' + filename + ')');
    continue;
  }

  pdfList.push({ filename: filename, base64: base64 });
}

if (pdfList.length === 0) throw new Error('No PDF data collected');
console.log('Collected ' + pdfList.length + ' PDFs for Claude');
return { pdfList: pdfList };
`.trim();
console.log("✅ Code: Collect PDFs updated — reads from $json.data");

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
