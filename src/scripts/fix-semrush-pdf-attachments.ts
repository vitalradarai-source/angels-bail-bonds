import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL    = process.env.N8N_BASE_URL!;
const N8N_API_KEY     = process.env.N8N_API_KEY!;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";
const WORKFLOW_ID = "xBdzO900m2lHDJaV";

// ── WHAT WE ARE FIXING ────────────────────────────────────────────────────────
//
//  PROBLEM: The workflow was copied from SpyFu which downloads a PDF from a URL
//  in the email body. But SEMrush PDFs are direct email ATTACHMENTS — there is
//  no URL to download. So $json.pdfUrl is empty → "Invalid URL" error.
//
//  THE FIX — replace 3 nodes in the chain:
//
//  OLD (SpyFu style):
//    Gmail Fetch → Extract PDF URL (find link in body) → Download PDF (HTTP GET)
//      → Convert to Base64 → Prepare → Claude
//
//  NEW (SEMrush attachment style):
//    Gmail Fetch → Extract Attachments (find PDFs in parts) → Fetch Each Attachment
//      (Gmail Attachment API) → Aggregate PDFs (combine up to 5) → Prepare → Claude
//
//  SUPPORTS UP TO 5 PDF ATTACHMENTS:
//    Claude receives all PDFs as separate document blocks in one API call.

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

// ── STEP 1: UPDATE "Extract PDF URL" ─────────────────────────────────────────
//
//  OLD: Searches the email HTML body for a download link (SpyFu style)
//  NEW: Walks the Gmail message payload.parts tree to find PDF attachments
//       Returns one item per PDF (so Download PDF runs once per attachment)

const extractIdx = workflow.nodes.findIndex((n: any) => n.name === "Extract PDF URL");
if (extractIdx !== -1) {
  workflow.nodes[extractIdx].parameters = {
    mode: "runOnceForAllItems",
    jsCode: `
// ── Extract PDF Attachments from Gmail message ─────────────────────────────
// Gmail stores attachments in payload.parts (possibly nested).
// Each PDF part has either:
//   body.attachmentId  → large attachment, needs a separate API call to fetch
//   body.data          → small inline attachment, data is already base64url here
//
// We find all PDF parts (up to 5) and return one item per PDF.

var items = $input.all();
var msg = items[0].json;
var payload = msg.payload || {};
var messageId = msg.id;

// Get subject from Gmail headers array
var headers = payload.headers || [];
var emailSubject = '';
for (var i = 0; i < headers.length; i++) {
  if (headers[i].name === 'Subject') { emailSubject = headers[i].value; break; }
}
if (!emailSubject) emailSubject = msg.Subject || msg.subject || '';

// Walk the parts tree recursively to collect all PDF attachments
function findPdfParts(parts, results) {
  if (!parts) return;
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var isPdf = part.mimeType === 'application/pdf' ||
                (part.filename && part.filename.toLowerCase().endsWith('.pdf'));
    if (isPdf) {
      results.push({
        attachmentId: (part.body && part.body.attachmentId) ? part.body.attachmentId : null,
        inlineData:   (part.body && part.body.data)         ? part.body.data         : null,
        filename:     part.filename || ('report-' + (results.length + 1) + '.pdf'),
        size:         (part.body && part.body.size)         ? part.body.size         : 0
      });
    }
    if (part.parts) findPdfParts(part.parts, results);
  }
}

var pdfParts = [];
findPdfParts(payload.parts, pdfParts);
pdfParts = pdfParts.slice(0, 5); // limit to 5

if (pdfParts.length === 0) {
  // No attachments found — return single item so workflow can show error gracefully
  return [{ json: {
    attachmentId: null,
    inlineData: null,
    filename: 'not-found.pdf',
    messageId: messageId,
    emailSubject: emailSubject,
    error: 'No PDF attachments found in email'
  }}];
}

// Return one item per PDF — the next node (Fetch Attachment) runs once per item
return pdfParts.map(function(p) {
  return { json: {
    attachmentId: p.attachmentId,
    inlineData:   p.inlineData,
    filename:     p.filename,
    messageId:    messageId,
    emailSubject: emailSubject
  }};
});
`.trim(),
  };
  console.log("✅ Extract PDF URL updated — now finds PDF attachments in email parts (up to 5)");
}

// ── STEP 2: UPDATE "Download PDF" ────────────────────────────────────────────
//
//  OLD: GET $json.pdfUrl  (a link extracted from the email body)
//  NEW: GET Gmail Attachment API endpoint using messageId + attachmentId
//       Returns: { size: N, data: "base64url_encoded_pdf_data" }

const downloadIdx = workflow.nodes.findIndex((n: any) => n.name === "Download PDF");
if (downloadIdx !== -1) {
  workflow.nodes[downloadIdx].parameters = {
    url: "=https://gmail.googleapis.com/gmail/v1/users/me/messages/{{ $json.messageId }}/attachments/{{ $json.attachmentId }}",
    authentication: "predefinedCredentialType",
    nodeCredentialType: "gmailOAuth2",
    options: {},
  };
  console.log("✅ Download PDF updated — now calls Gmail Attachment API (no external URL needed)");
}

// ── STEP 3: REPLACE "Convert PDF to Base64" ──────────────────────────────────
//
//  OLD: moveBinaryData node — converts one binary PDF to base64 string
//  NEW: Code node — aggregates ALL PDFs fetched in previous step into one list
//       Converts Gmail's base64url encoding to standard base64 for Claude
//       Outputs single item: { pdfList: [{filename, base64}], emailSubject }

const convertIdx = workflow.nodes.findIndex((n: any) => n.name === "Convert PDF to Base64");
if (convertIdx !== -1) {
  workflow.nodes[convertIdx].type = "n8n-nodes-base.code";
  workflow.nodes[convertIdx].typeVersion = 2;
  workflow.nodes[convertIdx].parameters = {
    mode: "runOnceForAllItems",
    jsCode: `
// ── Aggregate all fetched PDF attachments into one list ────────────────────
// Previous node ran once per PDF and returned Gmail API response: { size, data }
// We also pull filenames from the "Extract PDF URL" node which ran before.
//
// Gmail encodes attachment data as base64url (uses - and _ instead of + and /).
// Claude API requires standard base64 (uses + and /). We convert here.

var fetchItems = $input.all();  // one item per PDF: { size, data (base64url) }

// Pull filenames and emailSubject from the extract step
var extractItems = $('Extract PDF URL').all();
var emailSubject = extractItems.length > 0 ? extractItems[0].json.emailSubject : '';

function base64urlToBase64(str) {
  if (!str) return '';
  // base64url uses - and _ instead of + and /
  return str.replace(/-/g, '+').replace(/_/g, '/');
}

var pdfList = [];

for (var i = 0; i < fetchItems.length; i++) {
  var fetchItem  = fetchItems[i].json;
  var extractItem = extractItems[i] ? extractItems[i].json : {};

  // fetchItem.data  = base64url from Gmail Attachment API
  // extractItem.inlineData = base64url if the PDF was small enough to be inline
  var rawData = fetchItem.data || extractItem.inlineData || '';

  if (rawData) {
    pdfList.push({
      filename: extractItem.filename || ('report-' + (i + 1) + '.pdf'),
      base64:   base64urlToBase64(rawData)
    });
  }
}

return {
  pdfList:      pdfList,
  pdfCount:     pdfList.length,
  emailSubject: emailSubject
};
`.trim(),
  };
  console.log("✅ Convert PDF to Base64 replaced — now aggregates up to 5 PDFs into pdfList array");
}

// ── STEP 4: UPDATE "Prepare" node ────────────────────────────────────────────
//
//  OLD: reads $json.pdfBase64 (single PDF)
//  NEW: reads $json.pdfList (array of PDFs) and passes it through

const prepareIdx = workflow.nodes.findIndex((n: any) => n.name === "Prepare: Detect Type & Build Prompt");
if (prepareIdx !== -1) {
  const currentCode: string = workflow.nodes[prepareIdx].parameters.jsCode;

  // Replace pdfBase64 references with pdfList
  const updatedCode = currentCode
    .replace(
      "var pdfBase64 = $json.pdfBase64 || '';",
      "var pdfList = $json.pdfList || [];"
    )
    .replace(
      "  pdfBase64: pdfBase64,\n  pdfBase64Length: pdfBase64.length,",
      "  pdfList: pdfList,\n  pdfCount: pdfList.length,"
    );

  workflow.nodes[prepareIdx].parameters.jsCode = updatedCode;
  console.log("✅ Prepare node updated — uses pdfList array instead of single pdfBase64");
}

// ── STEP 5: UPDATE "Claude: Analyze Report" ──────────────────────────────────
//
//  OLD: sends one document block with a single pdfBase64
//  NEW: sends one document block per PDF (up to 5), then the text prompt
//
//  Claude API supports multiple documents in one request — it reads all of them
//  and synthesizes a combined analysis across all the reports.

const claudeIdx = workflow.nodes.findIndex((n: any) => n.name === "Claude: Analyze Report");
if (claudeIdx !== -1) {
  workflow.nodes[claudeIdx].parameters.body = `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 8192,
  "messages": [
    {
      "role": "user",
      "content": [
        ...$json.pdfList.map(pdf => ({
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": pdf.base64
          },
          "title": pdf.filename
        })),
        {
          "type": "text",
          "text": $json.masterPrompt
        }
      ]
    }
  ]
}) }}`;
  console.log("✅ Claude node updated — now sends all PDFs as separate document blocks");
}

// ── PUSH BACK ─────────────────────────────────────────────────────────────────
const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
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
  console.log("\n✅ SEMrush workflow fixed and saved!");
  console.log("\nHow to use:");
  console.log("  1. Compose an email with subject: 'SEMrush SEO Report for angelsbailbonds.com'");
  console.log("  2. Attach 1–5 SEMrush PDF reports");
  console.log("  3. Send to the Gmail account n8n monitors");
  console.log("  4. n8n picks it up and Claude analyzes ALL PDFs together");
  console.log("\nClaude receives:");
  console.log("  PDF 1 as document block");
  console.log("  PDF 2 as document block (if attached)");
  console.log("  ... up to PDF 5");
  console.log("  Then the analysis prompt");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
