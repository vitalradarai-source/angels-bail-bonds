/**
 * Creates the "Claude Session Progress Logger" n8n workflow
 * Run: node scripts/create-progress-logger-workflow.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '../.env'), 'utf8');
const N8N_API_KEY = env.match(/N8N_API_KEY=(.+)/)[1].trim();
const N8N_BASE_URL = env.match(/N8N_BASE_URL=(.+)/)[1].trim();
const CLICKUP_API_KEY = env.match(/CLICKUP_API_KEY=(.+)/)[1].trim();

const DRIVE_FOLDER_ID = '1JQeh1AMB02E1gIl_tqHKvvc3GQoHRbws';
const ABB_CLICKUP_LIST = '901414349243';

const GOOGLE_DRIVE_CRED  = { id: '9pLcah8bZziqZuRW',  name: '4434 lifeline Google Drive account' };
const GOOGLE_DOCS_CRED   = { id: 'NHKmASipLi8Aa6OM',  name: '4434 Google Docs account' };

const workflow = {
  name: 'Claude Session Progress Logger',
  nodes: [
    // ── 1. Webhook ──────────────────────────────────────────────────────────
    {
      id: 'webhook-node',
      name: 'Webhook: Claude Progress',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 300],
      parameters: {
        path: 'claude-progress',
        httpMethod: 'POST',
        responseMode: 'responseNode',
      },
    },

    // ── 2. Parse + PST date ─────────────────────────────────────────────────
    {
      id: 'code-parse',
      name: 'Code: Parse & PST Date',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [240, 300],
      parameters: {
        jsCode: `
const body = $input.first().json.body || $input.first().json;

// Build PST date string
const now = new Date();
const pst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
const mm = String(pst.getMonth() + 1).padStart(2, '0');
const dd = String(pst.getDate()).padStart(2, '0');
const yy = String(pst.getFullYear()).slice(2);
const datePST   = body.date_pst || \`\${mm}/\${dd}/\${yy}\`;       // 03/01/26
const docName   = body.date_pst
  ? \`\${body.date_pst.replace(/\\//g, '/')}\`.replace(/(\\d{2})\\/(\\d{2})\\/(\\d{2})/, (_, m, d, y) => \`\${m}/\${d}/20\${y}\`)
  : \`\${mm}/\${dd}/20\${yy}\`;                                       // 03/01/2026

const business  = body.business || 'Angelsbailbonds';
const tabKeywords = business.toLowerCase().includes('angel') || business.toLowerCase().includes('bail')
  ? ['angel', 'bail bond', 'abb', 'angelsbailbonds']
  : null; // null = use claude tab

return [{
  json: {
    datePST,
    docName,
    business,
    tabKeywords,
    completed:   Array.isArray(body.completed)   ? body.completed   : [],
    in_progress: Array.isArray(body.in_progress) ? body.in_progress : [],
    todo:        Array.isArray(body.todo)         ? body.todo        : [],
    blockers:    Array.isArray(body.blockers)     ? body.blockers    : [],
    questions:   Array.isArray(body.questions)    ? body.questions   : [],
  }
}];
`,
      },
    },

    // ── 3. Search Drive for today's doc ────────────────────────────────────
    {
      id: 'drive-search',
      name: 'Drive: Search for Today Doc',
      type: 'n8n-nodes-base.googleDrive',
      typeVersion: 3,
      position: [480, 300],
      credentials: { googleDriveOAuth2Api: GOOGLE_DRIVE_CRED },
      parameters: {
        operation: 'fileSearch',
        queryString: `='${DRIVE_FOLDER_ID}' in parents and name = '{{ $json.docName }}' and trashed = false`,
        returnAll: false,
        limit: 1,
      },
    },

    // ── 4. IF doc exists ────────────────────────────────────────────────────
    {
      id: 'if-doc-exists',
      name: 'IF: Doc Exists?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [720, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [
            {
              id: 'cond-1',
              leftValue: '={{ $json.id }}',
              rightValue: '',
              operator: { type: 'string', operation: 'notEmpty' },
            },
          ],
          combinator: 'and',
        },
      },
    },

    // ── 5a. Create doc if missing ──────────────────────────────────────────
    {
      id: 'drive-create',
      name: 'Drive: Create New Doc',
      type: 'n8n-nodes-base.googleDrive',
      typeVersion: 3,
      position: [960, 460],
      credentials: { googleDriveOAuth2Api: GOOGLE_DRIVE_CRED },
      parameters: {
        operation: 'createFromText',
        name: `={{ $('Code: Parse & PST Date').item.json.docName }}`,
        content: '',
        driveId: { __rl: true, mode: 'list', value: 'myDrive' },
        folderId: { __rl: true, mode: 'id', value: DRIVE_FOLDER_ID },
      },
    },

    // ── 5b. Merge doc ID (from existing or newly created) ─────────────────
    {
      id: 'merge-doc-id',
      name: 'Code: Resolve Doc ID',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1200, 300],
      parameters: {
        jsCode: `
// Input comes from either the IF true branch (existing) or Create branch (new)
const item = $input.first().json;
const parsed = $('Code: Parse & PST Date').first().json;
return [{
  json: {
    ...parsed,
    docId: item.id || item.documentId,
  }
}];
`,
      },
    },

    // ── 6. Get doc content + tabs ──────────────────────────────────────────
    {
      id: 'http-get-doc',
      name: 'HTTP: Get Doc with Tabs',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1440, 300],
      credentials: { googleDriveOAuth2Api: GOOGLE_DRIVE_CRED },
      parameters: {
        method: 'GET',
        url: `=https://docs.googleapis.com/v1/documents/{{ $json.docId }}?includeTabsContent=true`,
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleDriveOAuth2Api',
      },
    },

    // ── 7. Find or note tab ID ─────────────────────────────────────────────
    {
      id: 'code-find-tab',
      name: 'Code: Find/Note Tab',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1680, 300],
      parameters: {
        jsCode: `
const doc = $input.first().json;
const parsed = $('Code: Resolve Doc ID').first().json;
const keywords = parsed.tabKeywords;
const business = parsed.business;

const tabs = doc.tabs || [];

let tabId = null;
let tabTitle = null;

if (keywords) {
  // Find matching tab
  for (const tab of tabs) {
    const title = (tab.documentTab?.properties?.title || '').toLowerCase();
    if (keywords.some(k => title.includes(k))) {
      tabId = tab.documentTab?.properties?.index ?? null;
      tabTitle = tab.documentTab?.properties?.title || business;
      break;
    }
  }
  if (!tabId && tabs.length > 0) {
    // Use first tab if no match found
    tabId = tabs[0].documentTab?.properties?.index ?? 0;
    tabTitle = tabs[0].documentTab?.properties?.title || business;
  }
} else {
  // Look for "claude" tab
  for (const tab of tabs) {
    const title = (tab.documentTab?.properties?.title || '').toLowerCase();
    if (title.includes('claude')) {
      tabId = tab.documentTab?.properties?.index ?? null;
      tabTitle = 'claude';
      break;
    }
  }
  tabTitle = tabTitle || 'claude';
}

// Build formatted session text
const d = parsed;
const lines = [];
lines.push('');
lines.push('─────────────────────────────────────');
lines.push('Claude Code Session — ' + d.datePST + ' PST');
lines.push('─────────────────────────────────────');

const fmt = (emoji, label, arr) => {
  lines.push(emoji + ' ' + label);
  if (arr.length === 0) { lines.push('  • (none)'); }
  else { arr.forEach(t => lines.push('  • ' + t)); }
  lines.push('');
};

fmt('✅', 'COMPLETED',   d.completed);
fmt('🔄', 'IN PROGRESS', d.in_progress);
fmt('📋', 'TODO',        d.todo);
fmt('🚫', 'BLOCKERS',    d.blockers);
fmt('❓', 'QUESTIONS',   d.questions);

const sessionText = lines.join('\\n');

// All ClickUp items
const clickupItems = [
  ...d.completed.map(t   => ({ text: t, status: 'complete' })),
  ...d.in_progress.map(t => ({ text: t, status: 'in progress' })),
  ...d.todo.map(t        => ({ text: t, status: 'to do' })),
  ...d.blockers.map(t    => ({ text: '[BLOCKER] ' + t, status: 'blocked' })),
  ...d.questions.map(t   => ({ text: '[Q] ' + t, status: 'to do' })),
];

return [{
  json: {
    ...parsed,
    docId: $('Code: Resolve Doc ID').first().json.docId,
    tabId,
    tabTitle,
    sessionText,
    clickupItems,
    clickupTaskPrefix: d.datePST + ' - ' + d.business + ' | ',
  }
}];
`,
      },
    },

    // ── 8. Append to Google Doc ────────────────────────────────────────────
    {
      id: 'docs-append',
      name: 'Docs: Append Session',
      type: 'n8n-nodes-base.googleDocs',
      typeVersion: 2,
      position: [1920, 300],
      credentials: { googleDocsOAuth2Api: GOOGLE_DOCS_CRED },
      parameters: {
        operation: 'update',
        documentURL: `=https://docs.google.com/document/d/{{ $json.docId }}`,
        actionsUi: {
          actionFields: [
            {
              action: 'insert',
              text: `={{ $json.sessionText }}`,
            },
          ],
        },
      },
    },

    // ── 9. Split ClickUp items ─────────────────────────────────────────────
    {
      id: 'split-items',
      name: 'Split: ClickUp Items',
      type: 'n8n-nodes-base.splitInBatches',
      typeVersion: 3,
      position: [2160, 300],
      parameters: { batchSize: 1, options: {} },
    },

    // ── 10. Search ClickUp for existing task (dedup) ───────────────────────
    {
      id: 'http-search-clickup',
      name: 'HTTP: Search ClickUp Task',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2400, 300],
      parameters: {
        method: 'GET',
        url: `=https://api.clickup.com/api/v2/list/${ABB_CLICKUP_LIST}/task`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: CLICKUP_API_KEY },
          ],
        },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'search', value: `={{ $('Code: Find/Note Tab').item.json.clickupTaskPrefix + $json.text }}` },
            { name: 'include_closed', value: 'true' },
          ],
        },
      },
    },

    // ── 11. IF task already exists ─────────────────────────────────────────
    {
      id: 'if-task-exists',
      name: 'IF: Task Exists?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [2640, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [
            {
              id: 'cond-exists',
              leftValue: `={{ $json.tasks?.length ?? 0 }}`,
              rightValue: 0,
              operator: { type: 'number', operation: 'gt' },
            },
          ],
          combinator: 'and',
        },
      },
    },

    // ── 12. Create ClickUp task (only if not duplicate) ────────────────────
    {
      id: 'http-create-task',
      name: 'HTTP: Create ClickUp Task',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2880, 460],
      parameters: {
        method: 'POST',
        url: `https://api.clickup.com/api/v2/list/${ABB_CLICKUP_LIST}/task`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: CLICKUP_API_KEY },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        contentType: 'raw',
        rawContentType: 'application/json',
        body: `={
  JSON.stringify({
    name: $('Code: Find/Note Tab').item.json.clickupTaskPrefix + $('Split: ClickUp Items').item.json.text,
    status: $('Split: ClickUp Items').item.json.status,
    description: 'Logged by Claude Code session — ' + $('Code: Find/Note Tab').item.json.datePST
  })
}`,
      },
    },

    // ── 13. Respond to webhook ─────────────────────────────────────────────
    {
      id: 'respond-webhook',
      name: 'Respond: Success',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [3120, 300],
      parameters: {
        respondWith: 'json',
        responseBody: `={{ JSON.stringify({ ok: true, date: $('Code: Parse & PST Date').first().json.datePST, business: $('Code: Parse & PST Date').first().json.business, items_logged: $('Code: Find/Note Tab').first().json.clickupItems?.length ?? 0 }) }}`,
      },
    },
  ],

  connections: {
    'Webhook: Claude Progress': {
      main: [[{ node: 'Code: Parse & PST Date', type: 'main', index: 0 }]],
    },
    'Code: Parse & PST Date': {
      main: [[{ node: 'Drive: Search for Today Doc', type: 'main', index: 0 }]],
    },
    'Drive: Search for Today Doc': {
      main: [[{ node: 'IF: Doc Exists?', type: 'main', index: 0 }]],
    },
    'IF: Doc Exists?': {
      main: [
        [{ node: 'Code: Resolve Doc ID', type: 'main', index: 0 }],   // true → doc exists
        [{ node: 'Drive: Create New Doc', type: 'main', index: 0 }],  // false → create
      ],
    },
    'Drive: Create New Doc': {
      main: [[{ node: 'Code: Resolve Doc ID', type: 'main', index: 0 }]],
    },
    'Code: Resolve Doc ID': {
      main: [[{ node: 'HTTP: Get Doc with Tabs', type: 'main', index: 0 }]],
    },
    'HTTP: Get Doc with Tabs': {
      main: [[{ node: 'Code: Find/Note Tab', type: 'main', index: 0 }]],
    },
    'Code: Find/Note Tab': {
      main: [[{ node: 'Docs: Append Session', type: 'main', index: 0 }]],
    },
    'Docs: Append Session': {
      main: [[{ node: 'Split: ClickUp Items', type: 'main', index: 0 }]],
    },
    'Split: ClickUp Items': {
      main: [[{ node: 'HTTP: Search ClickUp Task', type: 'main', index: 0 }]],
    },
    'HTTP: Search ClickUp Task': {
      main: [[{ node: 'IF: Task Exists?', type: 'main', index: 0 }]],
    },
    'IF: Task Exists?': {
      main: [
        [],                                                                          // true → skip
        [{ node: 'HTTP: Create ClickUp Task', type: 'main', index: 0 }],           // false → create
      ],
    },
    'HTTP: Create ClickUp Task': {
      main: [[{ node: 'Split: ClickUp Items', type: 'main', index: 0 }]],
    },
  },

  settings: { executionOrder: 'v1' },
};

// ── Create workflow via API ────────────────────────────────────────────────────

const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
  method: 'POST',
  headers: {
    'X-N8N-API-KEY': N8N_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(workflow),
});

if (!res.ok) {
  const err = await res.text();
  console.error('Failed:', res.status, err);
  process.exit(1);
}

const created = await res.json();
console.log(`✅ Workflow created: "${created.name}"`);
console.log(`   ID: ${created.id}`);
console.log(`   Webhook: ${N8N_BASE_URL}/webhook/claude-progress`);

// Activate it
const activateRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${created.id}/activate`, {
  method: 'POST',
  headers: { 'X-N8N-API-KEY': N8N_API_KEY },
});
const activated = await activateRes.json();
console.log(`   Active: ${activated.active}`);
console.log(`\n🎯 Webhook URL: ${N8N_BASE_URL}/webhook/claude-progress`);
console.log(`   Test with: node scripts/log-session-progress.mjs`);
