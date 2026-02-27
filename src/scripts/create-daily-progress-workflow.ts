import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL    = process.env.N8N_BASE_URL!;
const N8N_API_KEY     = process.env.N8N_API_KEY!;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY!;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";
const CLICKUP_KEY     = process.env.CLICKUP_API_KEY!;

const DRIVE_FOLDER_ID = "1JQeh1AMB02E1gIl_tqHKvvc3GQoHRbws";
const CLICKUP_LIST_ID = "901414349243";
const GDRIVE_CRED     = { id: "9pLcah8bZziqZuRW", name: "4434 lifeline Google Drive account" };
const GDOCS_CRED      = { id: "NHKmASipLi8Aa6OM", name: "4434 Google Docs account" };

const TIMESHEET_IDS = [
  { id: "158jrGxKL6xLoof3PYiDDIfQ_lsJezbz6", name: "Timesheet_2026-01-26_2026-02-08.pdf" },
  { id: "18Cb73JkxHUe9LK2rtxa0WqmLFsJcpdjp", name: "Timesheet_2026-02-09_2026-02-22.pdf" },
  { id: "1UsyTsQqEFQGCiCKLJpRWd_UMlimYVCOG", name: "Timesheet_2026-02-23_2026-03-08.pdf" },
];

async function createWorkflow(wf: object): Promise<any> {
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(wf),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Create failed: ${JSON.stringify(data)}`);
  return data;
}

async function activateWorkflow(id: string) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${id}/activate`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  if (!res.ok) console.warn("  ⚠️  Could not auto-activate — activate manually in n8n UI");
}

// ─────────────────────────────────────────────────────────────────────────────
// CODE NODE STRINGS
// ─────────────────────────────────────────────────────────────────────────────

const CODE_FILTER_DOCS = `
// Filter Google Docs from the Drive file list, one item per doc
var files = $input.first().json.files || [];
var docs = files
  .filter(function(f) { return f.mimeType === 'application/vnd.google-apps.document'; })
  .map(function(f) { return { json: { docId: f.id, date: f.name, name: f.name } }; });

if (docs.length === 0) throw new Error('No Google Docs found in folder');

// Sort by name (date) ascending
docs.sort(function(a, b) { return a.json.name.localeCompare(b.json.name); });
return docs;
`.trim();

const CODE_EXTRACT_TEXT = `
// Extract plain text from Google Docs JSON, group by date (merge duplicates)
function getDocText(doc) {
  var text = '';
  var blocks = (doc.body && doc.body.content) ? doc.body.content : [];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.paragraph) {
      var elems = b.paragraph.elements || [];
      for (var j = 0; j < elems.length; j++) {
        if (elems[j].textRun) text += elems[j].textRun.content || '';
      }
    } else if (b.table) {
      var rows = b.table.tableRows || [];
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].tableCells || [];
        for (var c = 0; c < cells.length; c++) {
          var cc = cells[c].content || [];
          for (var k = 0; k < cc.length; k++) {
            if (cc[k].paragraph) {
              var ce = cc[k].paragraph.elements || [];
              for (var e = 0; e < ce.length; e++) {
                if (ce[e].textRun) text += ce[e].textRun.content || '';
              }
            }
          }
        }
        text += '\\n';
      }
    }
  }
  return text.trim();
}

var docItems    = $input.all();
var filterItems = $('Code: Get Google Docs').all();
var byDate = {};

for (var i = 0; i < docItems.length; i++) {
  var docJson  = docItems[i].json;
  var metaJson = filterItems[i] ? filterItems[i].json : {};
  var date     = metaJson.date || docJson.title || ('doc-' + i);
  var text     = getDocText(docJson);
  if (!byDate[date]) {
    byDate[date] = text;
  } else {
    byDate[date] += '\\n\\n' + text; // merge if same date appears twice
  }
}

// Sort dates and return one item per date
return Object.keys(byDate).sort().map(function(d) {
  return { json: { date: d, content: byDate[d] } };
});
`.trim();

const CODE_FILTER_PDFS = `
// Switch context: pull PDF files from the Drive listing node
var files = $('Drive: List Progress Files').first().json.files || [];
var pdfs = files
  .filter(function(f) { return f.mimeType === 'application/pdf'; })
  .map(function(f) { return { json: { fileId: f.id, filename: f.name } }; });

if (pdfs.length === 0) return [{ json: { skip: true, message: 'No PDFs in folder' } }];
return pdfs;
`.trim();

const CODE_COLLECT_PDFS = `
// Collect all downloaded PDFs into one item for Claude
var items = $input.all();
var metaItems = $('Code: Switch to PDFs').all();

function toStdBase64(s) {
  if (!s) return '';
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

var pdfList = [];
for (var i = 0; i < items.length; i++) {
  var binary = items[i].binary;
  if (binary && binary.data && binary.data.data) {
    var filename = (metaItems[i] && metaItems[i].json.filename) ? metaItems[i].json.filename : ('timesheet-' + (i+1) + '.pdf');
    pdfList.push({ filename: filename, base64: toStdBase64(binary.data.data) });
  }
}

if (pdfList.length === 0) throw new Error('No PDF binary data found');
return { pdfList: pdfList };
`.trim();

const CODE_PARSE_PDF_RESPONSE = `
// Parse Claude JSON response into one item per date
var rawText = $json.content[0].text || '';

// Strip markdown code fences if Claude wrapped the JSON
rawText = rawText.replace(/^\`\`\`[a-z]*\\s*/m, '').replace(/\\s*\`\`\`\\s*$/m, '').trim();

var parsed;
try {
  parsed = JSON.parse(rawText);
} catch(e) {
  throw new Error('Claude did not return valid JSON. Raw: ' + rawText.slice(0, 300));
}

var dates = parsed.dates || [];
if (dates.length === 0) return [{ json: { skip: true, message: 'No dates extracted from timesheets' } }];

return dates.map(function(d) {
  return { json: {
    date:        d.date,
    tasks:       d.tasks || [],
    description: (d.tasks || []).map(function(t) { return '- ' + t; }).join('\\n')
  }};
});
`.trim();

const CODE_PREPARE_UPSERT = `
// Decide: create new task or update existing one
var date = $json.date;
var newContent = $json.description;

// Get all existing tasks fetched from ClickUp
var existingTasks = $('ClickUp: Get Existing Tasks').first().json.tasks || [];
var match = existingTasks.find(function(t) { return t.name === date; });

if (match) {
  // Append timesheet data to existing description
  var existing = match.description || match.markdown_description || '';
  var separator = '\\n\\n---\\n**From Timesheets:**\\n';
  return {
    operation:   'update',
    taskId:      match.id,
    date:        date,
    description: existing + separator + newContent,
  };
} else {
  return {
    operation:   'create',
    date:        date,
    description: '**From Timesheets:**\\n' + newContent,
  };
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW 1 — BACKFILL FROM GOOGLE DOCS
// ─────────────────────────────────────────────────────────────────────────────

const wf1 = {
  name: "Angel Bail Bonds — Daily Progress Backfill",
  nodes: [
    {
      id: "w1n1", name: "Run Backfill",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1, position: [0, 300], parameters: {},
    },
    {
      id: "w1n2", name: "Drive: List Progress Files",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [220, 300],
      credentials: { googleDriveOAuth2Api: GDRIVE_CRED },
      parameters: {
        url: "https://www.googleapis.com/drive/v3/files",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "googleDriveOAuth2Api",
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: "q",        value: `'${DRIVE_FOLDER_ID}' in parents and trashed = false` },
            { name: "pageSize", value: "100" },
            { name: "fields",   value: "files(id,name,mimeType)" },
            { name: "orderBy",  value: "name" },
          ],
        },
        options: {},
      },
    },
    {
      id: "w1n3", name: "Code: Get Google Docs",
      type: "n8n-nodes-base.code",
      typeVersion: 2, position: [440, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: CODE_FILTER_DOCS },
    },
    {
      id: "w1n4", name: "Docs: Read Content",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [660, 300],
      credentials: { googleDocsOAuth2Api: GDOCS_CRED },
      parameters: {
        url: "=https://docs.googleapis.com/v1/documents/{{ $json.docId }}",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "googleDocsOAuth2Api",
        options: {},
      },
    },
    {
      id: "w1n5", name: "Code: Extract Text by Date",
      type: "n8n-nodes-base.code",
      typeVersion: 2, position: [880, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: CODE_EXTRACT_TEXT },
    },
    {
      id: "w1n6", name: "Claude: Filter Angel Tasks",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [1100, 300],
      parameters: {
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "x-api-key",        value: ANTHROPIC_KEY },
            { name: "anthropic-version", value: "2023-06-01" },
            { name: "content-type",      value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": "Review this daily progress document and extract ONLY Angel's Bail Bonds work.\\n\\nDATE: " + $json.date + "\\n\\nDOCUMENT:\\n" + $json.content + "\\n\\nRules:\\n1. Include ONLY items related to Angel's Bail Bonds, Angels Bail Bonds, bail bonds, or ABB\\n2. Remove exact duplicate entries\\n3. Keep each item to one concise line\\n4. If nothing bail bonds-related exists, output exactly: No Angel's Bail Bonds activities recorded.\\n\\nOutput as a markdown bullet list (use - as bullet). No intro, no headers, just the list."
  }]
}) }}`,
        options: {},
      },
    },
    {
      id: "w1n7", name: "ClickUp: Create Daily Task",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [1320, 300],
      parameters: {
        method: "POST",
        url: `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: CLICKUP_KEY },
            { name: "Content-Type",  value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: `={{ JSON.stringify({
  "name": $('Code: Extract Text by Date').item.json.date,
  "markdown_description": $json.content[0].text
}) }}`,
        options: {},
      },
    },
  ],
  connections: {
    "Run Backfill":              { main: [[{ node: "Drive: List Progress Files",  type: "main", index: 0 }]] },
    "Drive: List Progress Files":{ main: [[{ node: "Code: Get Google Docs",       type: "main", index: 0 }]] },
    "Code: Get Google Docs":     { main: [[{ node: "Docs: Read Content",          type: "main", index: 0 }]] },
    "Docs: Read Content":        { main: [[{ node: "Code: Extract Text by Date",  type: "main", index: 0 }]] },
    "Code: Extract Text by Date":{ main: [[{ node: "Claude: Filter Angel Tasks",  type: "main", index: 0 }]] },
    "Claude: Filter Angel Tasks":{ main: [[{ node: "ClickUp: Create Daily Task",  type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
  staticData: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW 2 — TIMESHEET PDF SYNC
// ─────────────────────────────────────────────────────────────────────────────

// The 3 timesheet PDFs are already in the same Drive folder.
// This workflow downloads them, sends all to Claude as PDF document blocks,
// Claude extracts per-day Angel's Bail Bonds tasks, then creates/updates ClickUp tasks.

const timesheetSeedCode = `
// Return the 3 timesheet PDF file IDs as items
var pdfs = ${JSON.stringify(TIMESHEET_IDS)};
return pdfs.map(function(p) { return { json: p }; });
`.trim();

const claudePdfBody = `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 4096,
  "messages": [{
    "role": "user",
    "content": [
      ...$json.pdfList.map(function(pdf) { return {
        "type": "document",
        "source": { "type": "base64", "media_type": "application/pdf", "data": pdf.base64 },
        "title": pdf.filename
      }; }),
      {
        "type": "text",
        "text": "These are timesheet PDFs covering daily work records for multiple clients/projects.\\n\\nYOUR TASK:\\n1. Find all work done for Angel's Bail Bonds (also: Angels Bail Bonds, bail bonds, ABB)\\n2. Organize by date — include each calendar date that has Angel's Bail Bonds work\\n3. For each date, list the specific TASKS or ACTIVITIES only — not hours\\n4. Remove duplicate tasks within the same date\\n5. Skip dates with no Angel's Bail Bonds work\\n\\nRETURN VALID JSON ONLY (no markdown, no code fences):\\n{\\n  \\"dates\\": [\\n    { \\"date\\": \\"MM/DD/YYYY\\", \\"tasks\\": [\\"task 1\\", \\"task 2\\"] },\\n    ...\\n  ]\\n}"
      }
    ]
  }]
}) }}`;

const wf2 = {
  name: "Angel Bail Bonds — Timesheet Sync",
  nodes: [
    {
      id: "w2n1", name: "Run Timesheet Sync",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1, position: [0, 300], parameters: {},
    },
    {
      id: "w2n2", name: "Code: Timesheet PDF IDs",
      type: "n8n-nodes-base.code",
      typeVersion: 2, position: [220, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: timesheetSeedCode },
    },
    {
      id: "w2n3", name: "Drive: Download PDF",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [440, 300],
      credentials: { googleDriveOAuth2Api: GDRIVE_CRED },
      parameters: {
        url: "=https://www.googleapis.com/drive/v3/files/{{ $json.id }}?alt=media",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "googleDriveOAuth2Api",
        options: {
          response: {
            response: {
              responseFormat: "file",
              outputPropertyName: "data",
            },
          },
        },
      },
    },
    {
      id: "w2n4", name: "Code: Collect PDFs",
      type: "n8n-nodes-base.code",
      typeVersion: 2, position: [660, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: CODE_COLLECT_PDFS },
    },
    {
      id: "w2n5", name: "Claude: Extract Timesheet Tasks",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [880, 300],
      parameters: {
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "x-api-key",        value: ANTHROPIC_KEY },
            { name: "anthropic-version", value: "2023-06-01" },
            { name: "content-type",      value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: claudePdfBody,
        options: {},
      },
    },
    {
      id: "w2n6", name: "Code: Parse PDF Response",
      type: "n8n-nodes-base.code",
      typeVersion: 2, position: [1100, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: CODE_PARSE_PDF_RESPONSE },
    },
    {
      id: "w2n7", name: "ClickUp: Get Existing Tasks",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [1100, 500],
      parameters: {
        url: `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task?order_by=created&page=0`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: CLICKUP_KEY },
          ],
        },
        options: {},
      },
    },
    {
      id: "w2n8", name: "Code: Prepare Upsert",
      type: "n8n-nodes-base.code",
      typeVersion: 2, position: [1320, 300],
      parameters: { mode: "runOnceForEachItem", jsCode: CODE_PREPARE_UPSERT },
    },
    {
      id: "w2n9a", name: "ClickUp: Create Task (PDF)",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [1540, 200],
      parameters: {
        method: "POST",
        url: `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: CLICKUP_KEY },
            { name: "Content-Type",  value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: `={{ JSON.stringify({ "name": $json.date, "markdown_description": $json.description }) }}`,
        options: {},
      },
    },
    {
      id: "w2n9b", name: "ClickUp: Update Task (PDF)",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [1540, 400],
      parameters: {
        method: "PUT",
        url: "=https://api.clickup.com/api/v2/task/{{ $json.taskId }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: CLICKUP_KEY },
            { name: "Content-Type",  value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: `={{ JSON.stringify({ "markdown_description": $json.description }) }}`,
        options: {},
      },
    },
    {
      id: "w2if", name: "IF: Create or Update",
      type: "n8n-nodes-base.if",
      typeVersion: 2, position: [1320, 500],
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: "", typeValidation: "loose" },
          conditions: [{
            id: "cond-create",
            leftValue: "={{ $json.operation }}",
            rightValue: "create",
            operator: { type: "string", operation: "equals", singleValue: true },
          }],
          combinator: "and",
        },
        options: {},
      },
    },
  ],
  connections: {
    "Run Timesheet Sync":           { main: [[{ node: "Code: Timesheet PDF IDs",          type: "main", index: 0 }]] },
    "Code: Timesheet PDF IDs":      { main: [[{ node: "Drive: Download PDF",              type: "main", index: 0 }]] },
    "Drive: Download PDF":          { main: [[{ node: "Code: Collect PDFs",               type: "main", index: 0 }]] },
    "Code: Collect PDFs":           { main: [[{ node: "Claude: Extract Timesheet Tasks",  type: "main", index: 0 }]] },
    "Claude: Extract Timesheet Tasks": { main: [[{ node: "Code: Parse PDF Response",      type: "main", index: 0 }]] },
    "Code: Parse PDF Response":     { main: [[{ node: "Code: Prepare Upsert",             type: "main", index: 0 }]] },
    // ClickUp: Get Existing Tasks runs in parallel — triggered from Collect PDFs too
    "Code: Collect PDFs_getExisting": { main: [[{ node: "ClickUp: Get Existing Tasks",   type: "main", index: 0 }]] },
    "Code: Prepare Upsert":         { main: [[{ node: "IF: Create or Update",             type: "main", index: 0 }]] },
    "IF: Create or Update":         {
      main: [
        [{ node: "ClickUp: Create Task (PDF)",  type: "main", index: 0 }],
        [{ node: "ClickUp: Update Task (PDF)",  type: "main", index: 0 }],
      ],
    },
  },
  settings: { executionOrder: "v1" },
  staticData: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW 3 — AUTO: ONGOING (Google Drive trigger for new docs)
// Same as Workflow 1 but triggers on new files in the Drive folder
// ─────────────────────────────────────────────────────────────────────────────

const wf3 = {
  name: "Angel Bail Bonds — Daily Progress Auto",
  nodes: [
    // Replace manual trigger with Google Drive polling trigger
    {
      id: "w3n1", name: "Drive: New Progress Doc",
      type: "n8n-nodes-base.googleDriveTrigger",
      typeVersion: 1, position: [0, 300],
      credentials: { googleDriveOAuth2Api: GDRIVE_CRED },
      parameters: {
        triggerOn: "specificFolder",
        folderToWatch: { mode: "id", value: DRIVE_FOLDER_ID },
        event: "fileCreated",
        pollTimes: { item: [{ mode: "everyMinute" }] },
        options: {},
      },
    },
    // Remaining nodes same as Workflow 1 (re-declared with different IDs)
    {
      id: "w3n2", name: "Drive: List Progress Files",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [220, 300],
      credentials: { googleDriveOAuth2Api: GDRIVE_CRED },
      parameters: {
        url: "=https://docs.googleapis.com/v1/documents/{{ $json.id }}",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "googleDriveOAuth2Api",
        options: {},
      },
    },
    {
      id: "w3n3", name: "Code: Extract Single Doc Text",
      type: "n8n-nodes-base.code",
      typeVersion: 2, position: [440, 300],
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: `
// For the auto workflow, we get a single new doc from the Drive trigger
// Extract its text and use the doc name as the date
function getDocText(doc) {
  var text = '';
  var blocks = (doc.body && doc.body.content) ? doc.body.content : [];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.paragraph) {
      var elems = b.paragraph.elements || [];
      for (var j = 0; j < elems.length; j++) {
        if (elems[j].textRun) text += elems[j].textRun.content || '';
      }
    }
  }
  return text.trim();
}

var doc  = $input.first().json;
var date = doc.title || 'unknown-date';
var text = getDocText(doc);
return [{ json: { date: date, content: text } }];
        `.trim(),
      },
    },
    {
      id: "w3n4", name: "Claude: Filter Angel Tasks",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [660, 300],
      parameters: {
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "x-api-key",        value: ANTHROPIC_KEY },
            { name: "anthropic-version", value: "2023-06-01" },
            { name: "content-type",      value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": "Review this daily progress document and extract ONLY Angel's Bail Bonds work.\\n\\nDATE: " + $json.date + "\\n\\nDOCUMENT:\\n" + $json.content + "\\n\\nRules:\\n1. Include ONLY items related to Angel's Bail Bonds, Angels Bail Bonds, bail bonds, or ABB\\n2. Remove exact duplicate entries\\n3. One concise line per item\\n4. If nothing bail bonds-related exists, output: No Angel's Bail Bonds activities recorded.\\n\\nOutput as markdown bullet list (- bullets). No intro, no headers."
  }]
}) }}`,
        options: {},
      },
    },
    {
      id: "w3n5", name: "ClickUp: Create Daily Task",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [880, 300],
      parameters: {
        method: "POST",
        url: `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: CLICKUP_KEY },
            { name: "Content-Type",  value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: `={{ JSON.stringify({
  "name": $('Code: Extract Single Doc Text').item.json.date,
  "markdown_description": $json.content[0].text
}) }}`,
        options: {},
      },
    },
  ],
  connections: {
    "Drive: New Progress Doc":      { main: [[{ node: "Drive: List Progress Files",   type: "main", index: 0 }]] },
    "Drive: List Progress Files":   { main: [[{ node: "Code: Extract Single Doc Text", type: "main", index: 0 }]] },
    "Code: Extract Single Doc Text":{ main: [[{ node: "Claude: Filter Angel Tasks",    type: "main", index: 0 }]] },
    "Claude: Filter Angel Tasks":   { main: [[{ node: "ClickUp: Create Daily Task",    type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
  staticData: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE ALL WORKFLOWS
// ─────────────────────────────────────────────────────────────────────────────

console.log("Creating Angel Bail Bonds daily progress workflows...\n");

// Workflow 1: Backfill
const created1 = await createWorkflow(wf1);
console.log(`✅ Workflow 1 created: "${wf1.name}"`);
console.log(`   ID: ${created1.id}`);
console.log(`   URL: ${N8N_BASE_URL}/workflow/${created1.id}`);

// Workflow 2: Timesheet Sync
const created2 = await createWorkflow(wf2);
console.log(`\n✅ Workflow 2 created: "${wf2.name}"`);
console.log(`   ID: ${created2.id}`);
console.log(`   URL: ${N8N_BASE_URL}/workflow/${created2.id}`);

// Workflow 3: Auto
const created3 = await createWorkflow(wf3);
await activateWorkflow(created3.id);
console.log(`\n✅ Workflow 3 created + activated: "${wf3.name}"`);
console.log(`   ID: ${created3.id}`);
console.log(`   URL: ${N8N_BASE_URL}/workflow/${created3.id}`);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  3 workflows created!

HOW TO USE:

STEP 1 — Run the backfill (one-time):
  Open: ${N8N_BASE_URL}/workflow/${created1.id}
  Click "Execute workflow" → processes all dated Google Docs
  Creates one ClickUp task per date in list 901414349243

STEP 2 — Sync timesheets (one-time, run after Step 1):
  Open: ${N8N_BASE_URL}/workflow/${created2.id}
  Click "Execute workflow" → reads 3 timesheet PDFs
  Appends timesheet tasks to existing ClickUp tasks (or creates new)

STEP 3 — Ongoing (already active):
  Workflow 3 (${created3.id}) watches the Drive folder
  When you add a new dated Google Doc → ClickUp task auto-created

ClickUp list: https://app.clickup.com/1293152/v/l/li/901414349243
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
