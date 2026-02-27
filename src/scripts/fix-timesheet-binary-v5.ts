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
console.log("Current nodes:", wf.nodes.map((n: any) => n.name).join(", "));

// ── 1. Remove the HTTP Request download node entirely ─────────────────────────
const dlIdx = wf.nodes.findIndex((n: any) => n.name === "Drive: Download PDF");
const dlNode = wf.nodes[dlIdx];
wf.nodes.splice(dlIdx, 1);
delete wf.connections["Drive: Download PDF"];
console.log("✅ Removed 'Drive: Download PDF' HTTP Request node");

// ── 2. Replace with a Code node that uses httpRequestWithAuthentication ────────
// encoding: null → Buffer (no text decoding, raw bytes preserved)
// Then Buffer.toString('base64') → correct base64 with zero corruption
const downloadCodeNode = {
  id: "download-pdf-as-base64",
  name: "Drive: Download PDF",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: dlNode.position,
  parameters: {
    mode: "runOnceForEachItem",
    jsCode: `
// Download PDF from Google Drive using authenticated helper.
// encoding: null ensures we get raw bytes (Buffer), not UTF-8 decoded string.
// Buffer.toString('base64') then produces correct base64 with no corruption.
const fileId   = $input.item.json.id;
const filename = $input.item.json.name;

let result;
try {
  result = await this.helpers.httpRequestWithAuthentication(
    'googleDriveOAuth2Api',
    {
      method: 'GET',
      url: 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
      encoding: null,       // raw bytes → Buffer (no UTF-8 decoding)
      returnFullResponse: false,
    }
  );
} catch (e) {
  throw new Error('Google Drive download failed: ' + e.message);
}

// Reconstruct Buffer from however the task runner serializes it
let base64;
if (result && result.type === 'Buffer' && Array.isArray(result.data)) {
  // Node.js Buffer serialized via toJSON()
  base64 = Buffer.from(result.data).toString('base64');
} else if (Buffer.isBuffer(result)) {
  base64 = result.toString('base64');
} else if (result instanceof Uint8Array) {
  base64 = Buffer.from(result).toString('base64');
} else if (typeof result === 'string') {
  // Fallback: treat as binary string (latin1)
  base64 = Buffer.from(result, 'binary').toString('base64');
} else {
  throw new Error('Unexpected response type: ' + typeof result + ' — ' + JSON.stringify(result).slice(0, 100));
}

console.log('Downloaded ' + filename + ' — base64 length: ' + base64.length);
return { json: { id: fileId, name: filename, base64 } };
`.trim(),
  },
};

wf.nodes.push(downloadCodeNode);
console.log("✅ Added Code node 'Drive: Download PDF' using httpRequestWithAuthentication + encoding:null");

// ── 3. Reconnect: PDF IDs → Download → Collect ────────────────────────────────
wf.connections["Code: Timesheet PDF IDs"] = {
  main: [[{ node: "Drive: Download PDF", type: "main", index: 0 }]],
};
wf.connections["Drive: Download PDF"] = {
  main: [[{ node: "Code: Collect PDFs", type: "main", index: 0 }]],
};
console.log("✅ Connections: PDF IDs → Drive Download → Collect PDFs");

// ── 4. Update Code: Collect PDFs to read from $json.base64 ────────────────────
const collectIdx = wf.nodes.findIndex((n: any) => n.name === "Code: Collect PDFs");
wf.nodes[collectIdx].parameters.jsCode = `
// The Code: Drive Download node now returns base64 directly in $json.base64
// (raw bytes from encoding:null → Buffer.toString('base64'), no corruption)
var items = $input.all();

var pdfList = [];
for (var i = 0; i < items.length; i++) {
  var base64   = items[i].json.base64 || '';
  var filename = items[i].json.name || ('timesheet-' + (i + 1) + '.pdf');

  if (!base64) {
    console.log('Warning: no base64 for item ' + i + ' (' + filename + ')');
    continue;
  }

  pdfList.push({ filename: filename, base64: base64 });
}

if (pdfList.length === 0) throw new Error('No PDF data collected');
console.log('Collected ' + pdfList.length + ' PDFs');
return { pdfList: pdfList };
`.trim();
console.log("✅ Code: Collect PDFs updated — reads from $json.base64 directly");

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
if (putRes.ok) console.log("✅ Saved — ready to test");
else console.error("❌ Save failed:", JSON.stringify(putData, null, 2));
