import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL!;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY!;
const CLICKUP_SPACE_ID = "90090599325";
const CLICKUP_LIST_ID = "901414340773";
const GOOGLE_DRIVE_FOLDER_ID = "1I0BspHZEJNBTFb04Oq585LsQrFd7sny5";

const seoPrompt = fs.readFileSync(
  path.resolve(__dirname, "../prompts/spyfu-seo-master-prompt.md"),
  "utf-8"
);
const ppcPrompt = fs.readFileSync(
  path.resolve(__dirname, "../prompts/spyfu-ppc-master-prompt.md"),
  "utf-8"
);

const workflow = {
  name: "SpyFu Report Analyzer",
  nodes: [
    // ── 1. GMAIL TRIGGER ──────────────────────────────────────────────────────
    {
      id: "node-gmail-trigger",
      name: "Gmail: SpyFu Email",
      type: "n8n-nodes-base.gmailTrigger",
      typeVersion: 1,
      position: [0, 300],
      parameters: {
        filters: {
          sender: "support@spyfu.com",
        },
        options: {},
      },
    },

    // ── 2. FILTER — CONFIRM SPYFU SENDER ─────────────────────────────────────
    {
      id: "node-filter-sender",
      name: "Filter: SpyFu Only",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: [240, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: false },
          conditions: [
            {
              leftValue: "={{ $json.from.value[0].address }}",
              rightValue: "spyfu.com",
              operator: { type: "string", operation: "contains" },
            },
          ],
        },
      },
    },

    // ── 3. EXTRACT PDF DOWNLOAD URL ───────────────────────────────────────────
    {
      id: "node-extract-pdf-url",
      name: "Extract PDF URL",
      type: "n8n-nodes-base.htmlExtract",
      typeVersion: 1,
      position: [480, 200],
      parameters: {
        html: "={{ $json.html }}",
        extractionValues: {
          values: [
            {
              key: "pdfUrl",
              cssSelector: "a",
              returnValue: "href",
              returnArray: false,
              attribute: "href",
            },
            {
              key: "emailSubject",
              cssSelector: "body",
              returnValue: "text",
            },
          ],
        },
        options: {},
      },
    },

    // ── 4. DOWNLOAD PDF ───────────────────────────────────────────────────────
    {
      id: "node-download-pdf",
      name: "Download PDF",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [720, 200],
      parameters: {
        method: "GET",
        url: "={{ $json.pdfUrl }}",
        responseFormat: "file",
        options: {
          response: {
            response: {
              responseFormat: "file",
            },
          },
        },
      },
    },

    // ── 5. PREPARE & DETECT REPORT TYPE ───────────────────────────────────────
    {
      id: "node-prepare",
      name: "Prepare: Detect Type & Build Prompt",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [960, 200],
      parameters: {
        mode: "runOnceForEachItem",
        jsCode: `
const subject = $('Extract PDF URL').first().json.emailSubject || '';
const reportType = subject.toLowerCase().includes('ppc') ? 'PPC' : 'SEO';

const seoPrompt = ${JSON.stringify(seoPrompt)};
const ppcPrompt = ${JSON.stringify(ppcPrompt)};

const masterPrompt = reportType === 'PPC' ? ppcPrompt : seoPrompt;

// Get binary PDF data and convert to base64
const binaryData = $binary?.data;
let pdfBase64 = '';
if (binaryData) {
  pdfBase64 = binaryData.toString('base64');
}

return {
  reportType,
  masterPrompt,
  pdfBase64,
  subject,
  receivedAt: new Date().toISOString(),
};
`,
      },
    },

    // ── 6. ANALYZE WITH CLAUDE ────────────────────────────────────────────────
    {
      id: "node-claude-analysis",
      name: "Claude: Analyze Report",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [1200, 200],
      parameters: {
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "x-api-key", value: ANTHROPIC_API_KEY },
            { name: "anthropic-version", value: "2023-06-01" },
            { name: "content-type", value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "json",
        body: {
          model: ANTHROPIC_MODEL,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: "={{ $json.pdfBase64 }}",
                  },
                },
                {
                  type: "text",
                  text: "={{ $json.masterPrompt }}",
                },
              ],
            },
          ],
        },
        options: {},
      },
    },

    // ── 7. FORMAT OUTPUT ──────────────────────────────────────────────────────
    {
      id: "node-format",
      name: "Format Report Output",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1440, 200],
      parameters: {
        mode: "runOnceForEachItem",
        jsCode: `
const analysis = $json.content?.[0]?.text || 'Analysis failed — no output from Claude.';
const reportType = $('Prepare: Detect Type & Build Prompt').first().json.reportType;
const receivedAt = $('Prepare: Detect Type & Build Prompt').first().json.receivedAt;
const subject = $('Prepare: Detect Type & Build Prompt').first().json.subject;
const date = new Date(receivedAt).toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric'
});

const taskName = \`SpyFu \${reportType} Report — \${date}\`;
const taskDescription = \`## SpyFu \${reportType} Analysis\\n**Received:** \${date}\\n**Email Subject:** \${subject}\\n**Analyzed by:** Claude AI (SEO Expert Mode)\\n\\n---\\n\\n\${analysis}\`;

return {
  taskName,
  taskDescription,
  reportType,
  analysis,
  date,
};
`,
      },
    },

    // ── 8. CREATE CLICKUP TASK ────────────────────────────────────────────────
    {
      id: "node-create-task",
      name: "ClickUp: Create Analysis Task",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [1680, 200],
      parameters: {
        method: "POST",
        url: `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: CLICKUP_API_KEY },
            { name: "Content-Type", value: "application/json" },
          ],
        },
        sendBody: true,
        contentType: "json",
        body: {
          name: "={{ $('Format Report Output').first().json.taskName }}",
          description: "={{ $('Format Report Output').first().json.taskDescription }}",
          status: "open",
          priority: 2,
          notify_all: false,
          tags: ["spyfu", "={{ $('Format Report Output').first().json.reportType.toLowerCase() }}", "seo-report"],
        },
        options: {},
      },
    },

    // ── 9. SEND EMAIL NOTIFICATION ────────────────────────────────────────────
    {
      id: "node-send-email",
      name: "Gmail: Send Report Email",
      type: "n8n-nodes-base.gmail",
      typeVersion: 2.1,
      position: [1920, 200],
      parameters: {
        operation: "send",
        toList: "4434lifeline@gmail.com",
        subject: "=SpyFu {{ $('Format Report Output').first().json.reportType }} Analysis Ready — {{ $('Format Report Output').first().json.date }}",
        emailType: "html",
        message: `=<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #1a73e8;">SpyFu {{ $('Format Report Output').first().json.reportType }} Report Analyzed</h2>
  <p>Your SpyFu <strong>{{ $('Format Report Output').first().json.reportType }}</strong> report for <strong>www.angelsbailbonds.com</strong> has been processed by Claude AI.</p>
  <p><strong>Date:</strong> {{ $('Format Report Output').first().json.date }}</p>
  <hr style="border: 1px solid #eee;">
  <h3>View Full Analysis in ClickUp:</h3>
  <p><a href="{{ $json.url }}" style="background: #1a73e8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">View ClickUp Task →</a></p>
  <hr style="border: 1px solid #eee;">
  <h3>Quick Summary:</h3>
  <p style="font-size: 13px; color: #555; white-space: pre-wrap;">{{ $('Format Report Output').first().json.analysis.substring(0, 800) }}...</p>
  <p style="font-size: 11px; color: #999;">This analysis was automatically generated by the Angel's Bail Bonds SEO automation system.</p>
</div>`,
        options: {},
      },
    },
  ],

  connections: {
    "Gmail: SpyFu Email": {
      main: [[{ node: "Filter: SpyFu Only", type: "main", index: 0 }]],
    },
    "Filter: SpyFu Only": {
      main: [
        [{ node: "Extract PDF URL", type: "main", index: 0 }],
        [], // false branch — do nothing
      ],
    },
    "Extract PDF URL": {
      main: [[{ node: "Download PDF", type: "main", index: 0 }]],
    },
    "Download PDF": {
      main: [[{ node: "Prepare: Detect Type & Build Prompt", type: "main", index: 0 }]],
    },
    "Prepare: Detect Type & Build Prompt": {
      main: [[{ node: "Claude: Analyze Report", type: "main", index: 0 }]],
    },
    "Claude: Analyze Report": {
      main: [[{ node: "Format Report Output", type: "main", index: 0 }]],
    },
    "Format Report Output": {
      main: [[{ node: "ClickUp: Create Analysis Task", type: "main", index: 0 }]],
    },
    "ClickUp: Create Analysis Task": {
      main: [[{ node: "Gmail: Send Report Email", type: "main", index: 0 }]],
    },
    "ClickUp: Get SpyFu List": {
      main: [],
    },
  },

  settings: {
    executionOrder: "v1",
    saveManualExecutions: true,
    callerPolicy: "workflowsFromSameOwner",
    errorWorkflow: "",
  },
};

// Push workflow to n8n
const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
  method: "POST",
  headers: {
    "X-N8N-API-KEY": N8N_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(workflow),
});

const data = await res.json();

if (res.ok) {
  console.log("✅ Workflow created successfully!");
  console.log(`   ID: ${data.id}`);
  console.log(`   Name: ${data.name}`);
  console.log(`   URL: ${N8N_BASE_URL}/workflow/${data.id}`);
} else {
  console.error("❌ Failed:", JSON.stringify(data, null, 2));
}
