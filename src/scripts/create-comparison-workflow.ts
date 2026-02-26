import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL     = process.env.N8N_BASE_URL!;
const N8N_API_KEY      = process.env.N8N_API_KEY!;
const ANTHROPIC_MODEL  = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

// ── LOAD COMPARISON PROMPT ────────────────────────────────────────────────────
const comparisonPrompt = fs.readFileSync(
  path.resolve(__dirname, "../prompts/comparison-master-prompt.md"),
  "utf-8"
);

// ── CONSTANTS (same as SpyFu workflow) ───────────────────────────────────────
const CLICKUP_LIST_ID       = "901414340773";
const CLICKUP_API_KEY       = process.env.CLICKUP_API_KEY!;
const GOOGLE_DRIVE_FOLDER   = "1I0BspHZEJNBTFb04Oq585LsQrFd7sny5";
const ANTHROPIC_API_KEY     = process.env.ANTHROPIC_API_KEY!;
const GMAIL_NOTIFY          = "4434lifeline@gmail.com";
const GDRIVE_BOUNDARY       = "comparison_report_v1";

// ── NODE POSITIONS ────────────────────────────────────────────────────────────
const POS = {
  trigger:    [0,    300],
  fetch:      [220,  300],
  filter:     [440,  300],
  extract:    [660,  300],
  fetchPdf:   [880,  300],
  aggregate:  [1100, 300],
  claude:     [1320, 300],
  format:     [1540, 300],
  clickup:    [1760, 300],
  gdrive:     [1980, 300],
  email:      [2200, 300],
};

// ── FORMAT NODE CODE (reused from SpyFu, adapted for comparison) ──────────────
const formatNodeCode = `
const rawAnalysis = $json.content?.[0]?.text || 'Analysis failed — no output from Claude.';
const reportType  = $('Aggregate & Label PDFs').first().json.reportType;
const website     = $('Aggregate & Label PDFs').first().json.website || '';
const receivedAt  = $('Aggregate & Label PDFs').first().json.receivedAt;
const date = new Date(receivedAt).toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric'
});

// Strip code fence wrapper Claude sometimes adds
let html = rawAnalysis.trim();
html = html.replace(/^\`\`\`[a-zA-Z]*\\s*/m, '');
html = html.replace(/\\s*\`\`\`\\s*$/m, '');
html = html.trim();

// Strip <style> blocks
html = html.replace(/<style[^>]*>[\\s\\S]*?<\\/style>/gi, '');
// Strip <html>, <head>, <body> wrapper tags
html = html.replace(/<head[^>]*>[\\s\\S]*?<\\/head>/gi, '');
html = html.replace(/<\\/?html[^>]*>/gi, '');
html = html.replace(/<\\/?body[^>]*>/gi, '');
html = html.trim();
const analysisHtml = html;

// Convert HTML → Markdown for ClickUp
let md = html;
md = md.replace(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/gi, (_, t) => '\\n# ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
md = md.replace(/<h2[^>]*>([\\s\\S]*?)<\\/h2>/gi, (_, t) => '\\n## ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
md = md.replace(/<h3[^>]*>([\\s\\S]*?)<\\/h3>/gi, (_, t) => '\\n### ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
md = md.replace(/<strong[^>]*>([\\s\\S]*?)<\\/strong>/gi, (_, t) => '**' + t.replace(/<[^>]+>/g, '') + '**');
md = md.replace(/<b[^>]*>([\\s\\S]*?)<\\/b>/gi, (_, t) => '**' + t.replace(/<[^>]+>/g, '') + '**');
md = md.replace(/<li[^>]*>([\\s\\S]*?)<\\/li>/gi, (_, t) => '• ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
md = md.replace(/<p[^>]*>([\\s\\S]*?)<\\/p>/gi,  (_, t) => t.replace(/<[^>]+>/g, '') + '\\n\\n');
md = md.replace(/<br\\s*\\/?>/gi, '\\n');
md = md.replace(/<hr[^>]*>/gi, '\\n---\\n');
md = md.replace(/<[^>]+>/g, '');
md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
md = md.replace(/\\n{3,}/g, '\\n\\n').trim();
const analysisMarkdown = md;

const websiteLabel = website && website !== 'the website' ? \` — \${website}\` : '';
const taskName = \`SEO Comparison\${websiteLabel} — SpyFu vs SEMrush — \${date}\`;

return {
  taskName,
  reportType,
  website,
  date,
  analysisHtml,
  analysisMarkdown,
  analysis: analysisHtml,
  taskDescription: \`SpyFu vs SEMrush Comparison — \${date}\\n\\n\${analysisMarkdown}\`,
};
`.trim();

// ── WORKFLOW DEFINITION ───────────────────────────────────────────────────────
const workflow = {
  name: "SEO/PPC Comparison Analyzer",
  nodes: [

    // ── 1. GMAIL TRIGGER ───────────────────────────────────────────────────────
    {
      id: "node-trigger",
      name: "Gmail: Comparison Email",
      type: "n8n-nodes-base.gmailTrigger",
      typeVersion: 1,
      position: POS.trigger,
      credentials: { gmailOAuth2: { id: "1", name: "Gmail account" } },
      parameters: {
        pollTimes: { item: [{ mode: "everyMinute" }] },
        simple: false,
        filters: {},
        options: {},
      },
    },

    // ── 2. GMAIL FETCH FULL MESSAGE ────────────────────────────────────────────
    {
      id: "node-fetch",
      name: "Gmail: Fetch Full Message",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: POS.fetch,
      parameters: {
        url: "=https://gmail.googleapis.com/gmail/v1/users/me/messages/{{ $json.id }}?format=full",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "gmailOAuth2",
        options: {},
      },
    },

    // ── 3. FILTER: COMPARISON SUBJECT ─────────────────────────────────────────
    //  Only processes emails whose subject contains "comparison" (case-insensitive)
    //  You send: "SEO Comparison angelsbailbonds.com" → passes ✅
    //  Other emails → blocked ❌
    {
      id: "node-filter",
      name: "Filter: Comparison Only",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: POS.filter,
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: "", typeValidation: "loose" },
          conditions: [
            {
              id: "cond-comparison",
              leftValue: "={{ $json.payload?.headers?.find(h => h.name === 'Subject')?.value || '' }}",
              rightValue: "comparison",
              operator: { type: "string", operation: "contains", singleValue: true },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    },

    // ── 4. EXTRACT ALL PDF ATTACHMENTS ────────────────────────────────────────
    //  Walks the Gmail payload.parts tree and finds ALL PDF attachments (up to 6)
    //  Returns one item per PDF so node 5 runs once per attachment
    {
      id: "node-extract",
      name: "Extract PDF Attachments",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: POS.extract,
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: `
// ── Find all PDF attachments in the Gmail message ─────────────────────────
var items   = $input.all();
var msg     = items[0].json;
var payload = msg.payload || {};
var messageId = msg.id;

// Subject is in payload.headers array
var headers      = payload.headers || [];
var emailSubject = '';
for (var i = 0; i < headers.length; i++) {
  if (headers[i].name === 'Subject') { emailSubject = headers[i].value; break; }
}
if (!emailSubject) emailSubject = msg.Subject || msg.subject || '';

// Detect SEO vs PPC from subject
var reportType = emailSubject.toLowerCase().indexOf('ppc') !== -1 ? 'PPC' : 'SEO';

// Extract domain from subject
var domainMatch = emailSubject.match(/([a-zA-Z0-9][a-zA-Z0-9-]*\\.[a-zA-Z]{2,}(?:\\.[a-zA-Z]{2,})?)/);
var website = domainMatch ? domainMatch[1].toLowerCase() : 'the website';
website = website.replace(/^www\\./, '');

// Walk parts tree recursively
function findPdfParts(parts, results) {
  if (!parts) return;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var isPdf = p.mimeType === 'application/pdf' ||
                (p.filename && p.filename.toLowerCase().endsWith('.pdf'));
    if (isPdf) {
      results.push({
        attachmentId: (p.body && p.body.attachmentId) ? p.body.attachmentId : null,
        inlineData:   (p.body && p.body.data)         ? p.body.data         : null,
        filename:     p.filename || ('attachment-' + (results.length + 1) + '.pdf'),
        size:         (p.body && p.body.size)         ? p.body.size         : 0,
      });
    }
    if (p.parts) findPdfParts(p.parts, results);
  }
}

var pdfParts = [];
findPdfParts(payload.parts, pdfParts);
pdfParts = pdfParts.slice(0, 6); // max 6 PDFs (3 SpyFu + 3 SEMrush)

if (pdfParts.length === 0) {
  return [{ json: {
    error: 'No PDF attachments found',
    messageId: messageId,
    emailSubject: emailSubject,
    attachmentId: null,
  }}];
}

return pdfParts.map(function(p) {
  return { json: {
    attachmentId: p.attachmentId,
    inlineData:   p.inlineData,
    filename:     p.filename,
    messageId:    messageId,
    emailSubject: emailSubject,
    reportType:   reportType,
    website:      website,
  }};
});
`.trim(),
      },
    },

    // ── 5. FETCH EACH ATTACHMENT FROM GMAIL API ───────────────────────────────
    //  Runs once per PDF item. Calls Gmail Attachment API.
    //  Returns: { size, data } where data is base64url encoded PDF
    {
      id: "node-fetch-pdf",
      name: "Fetch PDF Attachment",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: POS.fetchPdf,
      parameters: {
        url: "=https://gmail.googleapis.com/gmail/v1/users/me/messages/{{ $json.messageId }}/attachments/{{ $json.attachmentId }}",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "gmailOAuth2",
        options: {},
      },
    },

    // ── 6. AGGREGATE & LABEL PDFs ─────────────────────────────────────────────
    //  Collects all fetched PDFs, converts base64url → base64,
    //  and identifies which are SpyFu vs SEMrush by filename.
    //  Then builds the comparison prompt with {{WEBSITE}} and {{REPORT_TYPE}} replaced.
    {
      id: "node-aggregate",
      name: "Aggregate & Label PDFs",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: POS.aggregate,
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: `
// ── Collect and label all PDFs ────────────────────────────────────────────
var fetchItems   = $input.all();        // from Fetch PDF Attachment: {size, data}
var extractItems = $('Extract PDF Attachments').all(); // {filename, emailSubject, ...}

var emailSubject = extractItems.length > 0 ? extractItems[0].json.emailSubject : '';
var reportType   = extractItems.length > 0 ? extractItems[0].json.reportType   : 'SEO';
var website      = extractItems.length > 0 ? extractItems[0].json.website      : 'the website';

// Gmail uses base64url — convert to standard base64 for Claude API
function base64urlToBase64(str) {
  if (!str) return '';
  return str.replace(/-/g, '+').replace(/_/g, '/');
}

// Identify which tool a PDF comes from by its filename
function detectSource(filename) {
  var f = (filename || '').toLowerCase();
  if (f.includes('spyfu') || f.includes('spy_fu') || f.includes('spy-fu')) return 'spyfu';
  if (f.includes('semrush') || f.includes('sem_rush') || f.includes('sem-rush')) return 'semrush';
  return 'unknown';
}

var spyfuPdfs   = [];
var semrushPdfs = [];
var unknownPdfs = [];

for (var i = 0; i < fetchItems.length; i++) {
  var fetchItem   = fetchItems[i].json;
  var extractItem = extractItems[i] ? extractItems[i].json : {};
  var rawData     = fetchItem.data || extractItem.inlineData || '';
  var filename    = extractItem.filename || ('report-' + (i + 1) + '.pdf');

  if (!rawData) continue;

  var pdfObj = { filename: filename, base64: base64urlToBase64(rawData) };
  var source = detectSource(filename);

  if (source === 'spyfu')   spyfuPdfs.push(pdfObj);
  else if (source === 'semrush') semrushPdfs.push(pdfObj);
  else unknownPdfs.push(pdfObj);
}

// Fallback: if filenames don't identify the tool, split by position
// First half = SpyFu, second half = SEMrush
if (spyfuPdfs.length === 0 && semrushPdfs.length === 0 && unknownPdfs.length > 0) {
  var mid = Math.ceil(unknownPdfs.length / 2);
  spyfuPdfs   = unknownPdfs.slice(0, mid);
  semrushPdfs = unknownPdfs.slice(mid);
} else if (spyfuPdfs.length === 0 && unknownPdfs.length > 0) {
  spyfuPdfs = unknownPdfs;
} else if (semrushPdfs.length === 0 && unknownPdfs.length > 0) {
  semrushPdfs = unknownPdfs;
}

// Build the comparison prompt — replace {{WEBSITE}} and {{REPORT_TYPE}}
var prompt = ${JSON.stringify(comparisonPrompt)};
prompt = prompt.replace(/\\{\\{WEBSITE\\}\\}/g, website);
prompt = prompt.replace(/\\{\\{REPORT_TYPE\\}\\}/g, reportType);

return {
  spyfuPdfs:        spyfuPdfs,
  semrushPdfs:      semrushPdfs,
  totalPdfs:        spyfuPdfs.length + semrushPdfs.length,
  spyfuCount:       spyfuPdfs.length,
  semrushCount:     semrushPdfs.length,
  emailSubject:     emailSubject,
  reportType:       reportType,
  website:          website,
  comparisonPrompt: prompt,
  receivedAt:       new Date().toISOString(),
};
`.trim(),
      },
    },

    // ── 7. CLAUDE: COMPARISON ANALYSIS ───────────────────────────────────────
    //  Sends ALL PDFs (SpyFu + SEMrush) as separate document blocks.
    //  Claude reads them all in one context window and produces the comparison.
    {
      id: "node-claude",
      name: "Claude: Comparison Analysis",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: POS.claude,
      parameters: {
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "x-api-key",          value: ANTHROPIC_API_KEY },
            { name: "anthropic-version",   value: "2023-06-01" },
            { name: "content-type",        value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 8192,
  "messages": [
    {
      "role": "user",
      "content": [
        ...$json.spyfuPdfs.map(pdf => ({
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": pdf.base64
          },
          "title": "SpyFu: " + pdf.filename
        })),
        ...$json.semrushPdfs.map(pdf => ({
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": pdf.base64
          },
          "title": "SEMrush: " + pdf.filename
        })),
        {
          "type": "text",
          "text": $json.comparisonPrompt
        }
      ]
    }
  ]
}) }}`,
        options: {},
      },
    },

    // ── 8. FORMAT COMPARISON OUTPUT ───────────────────────────────────────────
    {
      id: "node-format",
      name: "Format Comparison Output",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: POS.format,
      parameters: {
        mode: "runOnceForEachItem",
        jsCode: formatNodeCode,
      },
    },

    // ── 9. CLICKUP: CREATE COMPARISON TASK ───────────────────────────────────
    {
      id: "node-clickup",
      name: "ClickUp: Create Comparison Task",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: POS.clickup,
      parameters: {
        method: "POST",
        url: `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: CLICKUP_API_KEY },
            { name: "Content-Type",  value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: `={{ JSON.stringify({
  "name": $('Format Comparison Output').first().json.taskName,
  "markdown_description": $('Format Comparison Output').first().json.taskDescription,
  "priority": 2,
  "tags": [{"name":"comparison"},{"name":"spyfu"},{"name":"semrush"}]
}) }}`,
        options: {},
      },
    },

    // ── 10. GOOGLE DRIVE: CREATE COMPARISON DOC ───────────────────────────────
    {
      id: "node-gdrive",
      name: "Google Drive: Create Comparison Doc",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: POS.gdrive,
      parameters: {
        method: "POST",
        url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "googleDocsOAuth2Api",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Content-Type", value: `multipart/related; boundary=${GDRIVE_BOUNDARY}` },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: `multipart/related; boundary=${GDRIVE_BOUNDARY}`,
        body: `={{ [
  '--${GDRIVE_BOUNDARY}',
  'Content-Type: application/json; charset=UTF-8',
  '',
  JSON.stringify({
    name: $('Format Comparison Output').first().json.taskName,
    mimeType: 'application/vnd.google-apps.document',
    parents: ['${GOOGLE_DRIVE_FOLDER}']
  }),
  '--${GDRIVE_BOUNDARY}',
  'Content-Type: text/html; charset=UTF-8',
  '',
  '<html><body>' + $('Format Comparison Output').first().json.analysisHtml + '</body></html>',
  '--${GDRIVE_BOUNDARY}--'
].join('\\r\\n') }}`,
        options: {},
      },
    },

    // ── 11. GMAIL: SEND COMPARISON REPORT EMAIL ───────────────────────────────
    {
      id: "node-email",
      name: "Gmail: Send Comparison Email",
      type: "n8n-nodes-base.gmail",
      typeVersion: 2.1,
      position: POS.email,
      credentials: { gmailOAuth2: { id: "1", name: "Gmail account" } },
      parameters: {
        sendTo: GMAIL_NOTIFY,
        subject: `=SEO Comparison Ready — {{ $('Format Comparison Output').first().json.website }} — SpyFu vs SEMrush — {{ $('Format Comparison Output').first().json.date }}`,
        message: `=<div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; color: #333;">

  <div style="background: linear-gradient(135deg, #1a73e8, #6c35de); color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
    <h2 style="margin:0">SpyFu vs SEMrush Comparison</h2>
    <p style="margin:4px 0 0; opacity:0.85">{{ $('Format Comparison Output').first().json.website }} — {{ $('Format Comparison Output').first().json.date }}</p>
  </div>

  <div style="background: #f8f9fa; padding: 16px 24px; border-left: 4px solid #6c35de;">
    <p style="margin:0">📋 <strong>ClickUp Task:</strong> <a href="{{ $json.url }}">{{ $('Format Comparison Output').first().json.taskName }}</a></p>
    <p style="margin:4px 0 0">📊 <strong>Report Type:</strong> {{ $('Format Comparison Output').first().json.reportType }} Comparison</p>
  </div>

  <div style="padding: 8px 24px;">
    <a href="{{ $json.url }}" style="display:inline-block; background:#6c35de; color:white; padding:12px 24px; text-decoration:none; border-radius:4px; margin:16px 0; font-weight:bold">View in ClickUp →</a>
  </div>

  <hr style="border: 1px solid #e0e0e0; margin: 0 24px">

  <div style="padding: 16px 24px;">
    <h3 style="color:#6c35de">Full Comparison Analysis</h3>
    {{ $('Format Comparison Output').first().json.analysis }}
  </div>

  <div style="background:#f1f3f4; padding:12px 24px; font-size:11px; color:#999; border-radius:0 0 8px 8px">
    Auto-generated by Angel's Bail Bonds SEO comparison workflow.
  </div>

</div>`,
        options: {},
      },
    },
  ],

  // ── CONNECTIONS ─────────────────────────────────────────────────────────────
  connections: {
    "Gmail: Comparison Email": {
      main: [[{ node: "Gmail: Fetch Full Message", type: "main", index: 0 }]],
    },
    "Gmail: Fetch Full Message": {
      main: [[{ node: "Filter: Comparison Only", type: "main", index: 0 }]],
    },
    "Filter: Comparison Only": {
      main: [
        [{ node: "Extract PDF Attachments", type: "main", index: 0 }], // true branch
        [],                                                              // false branch
      ],
    },
    "Extract PDF Attachments": {
      main: [[{ node: "Fetch PDF Attachment", type: "main", index: 0 }]],
    },
    "Fetch PDF Attachment": {
      main: [[{ node: "Aggregate & Label PDFs", type: "main", index: 0 }]],
    },
    "Aggregate & Label PDFs": {
      main: [[{ node: "Claude: Comparison Analysis", type: "main", index: 0 }]],
    },
    "Claude: Comparison Analysis": {
      main: [[{ node: "Format Comparison Output", type: "main", index: 0 }]],
    },
    "Format Comparison Output": {
      main: [[{ node: "ClickUp: Create Comparison Task", type: "main", index: 0 }]],
    },
    "ClickUp: Create Comparison Task": {
      main: [[{ node: "Google Drive: Create Comparison Doc", type: "main", index: 0 }]],
    },
    "Google Drive: Create Comparison Doc": {
      main: [[{ node: "Gmail: Send Comparison Email", type: "main", index: 0 }]],
    },
  },

  settings: { executionOrder: "v1" },
  staticData: null,
};

// ── CREATE WORKFLOW ───────────────────────────────────────────────────────────
console.log("Creating SEO/PPC Comparison Analyzer workflow...");

const createRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
  method: "POST",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify(workflow),
});

const created = await createRes.json();
if (!createRes.ok) {
  console.error("❌ Failed to create workflow:", JSON.stringify(created, null, 2));
  process.exit(1);
}

const WORKFLOW_ID = created.id;
console.log(`✅ Workflow created! ID: ${WORKFLOW_ID}`);
console.log(`   URL: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`);

// ── ACTIVATE WORKFLOW ─────────────────────────────────────────────────────────
const activateRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: "POST",
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});

if (activateRes.ok) {
  console.log("✅ Workflow activated — Gmail trigger is live");
} else {
  const err = await activateRes.json();
  console.warn("⚠️  Could not auto-activate:", err.message, "— activate manually in n8n UI");
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  SEO/PPC Comparison Analyzer is ready!

HOW TO USE:
  1. Download SpyFu PDF for your target domain
  2. Download SEMrush PDF for the same domain
  3. Send one email to ${GMAIL_NOTIFY}:
       Subject: SEO Comparison angelsbailbonds.com
       Attach:  spyfu-report.pdf + semrush-report.pdf

  For PPC comparison:
       Subject: PPC Comparison angelsbailbonds.com

WHAT YOU GET BACK (~60-90 seconds):
  • Email with full SpyFu vs SEMrush comparison
  • ClickUp task created with markdown analysis
  • Google Doc saved to Drive

WORKFLOW ID: ${WORKFLOW_ID}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
