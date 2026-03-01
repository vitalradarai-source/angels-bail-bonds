/**
 * Patches the "Claude Session Progress Logger" n8n workflow (ID: EHsVxqcoGkHMajHC)
 * Fixes:
 *  1. Google Drive nodes had invalid operations for typeVersion 3 — replaced with HTTP Request
 *  2. ClickUp Create Task body used invalid expression syntax — fixed to ={{ JSON.stringify(...) }}
 *  3. Split done output was not connected to Respond node — added connection
 *  4. webhookId was missing from webhook node — added
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '../.env'), 'utf8');
const N8N_API_KEY   = env.match(/N8N_API_KEY=(.+)/)[1].trim();
const N8N_BASE_URL  = env.match(/N8N_BASE_URL=(.+)/)[1].trim();
const CLICKUP_API_KEY = env.match(/CLICKUP_API_KEY=(.+)/)[1].trim();

const WORKFLOW_ID    = 'EHsVxqcoGkHMajHC';
const DRIVE_FOLDER_ID = '1JQeh1AMB02E1gIl_tqHKvvc3GQoHRbws';
const ABB_CLICKUP_LIST = '901414349243';
const GOOGLE_DRIVE_CRED = { id: '9pLcah8bZziqZuRW', name: '4434 lifeline Google Drive account' };
const GOOGLE_DOCS_CRED  = { id: 'NHKmASipLi8Aa6OM', name: '4434 Google Docs account' };

const headers = { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' };

// ── Fetch current workflow ──────────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, { headers });
if (!getRes.ok) { console.error('GET failed', await getRes.text()); process.exit(1); }
const wf = await getRes.json();
console.log('Fetched workflow:', wf.name, '| Active:', wf.active);

// ── Deactivate ─────────────────────────────────────────────────────────────
await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, { method: 'POST', headers });
console.log('Deactivated');

// ── Build fixed nodes ───────────────────────────────────────────────────────
const nodes = [
  // 1. Webhook
  {
    id: 'webhook-node',
    name: 'Webhook: Claude Progress',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    webhookId: 'claude-progress',
    position: [0, 300],
    parameters: {
      path: 'claude-progress',
      httpMethod: 'POST',
      responseMode: 'responseNode',
      options: {},
    },
  },

  // 2. Parse + PST date
  {
    id: 'code-parse',
    name: 'Code: Parse & PST Date',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [240, 300],
    parameters: {
      jsCode: `
const body = $input.first().json.body || $input.first().json;

const now = new Date();
const pst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
const mm = String(pst.getMonth() + 1).padStart(2, '0');
const dd = String(pst.getDate()).padStart(2, '0');
const yy = String(pst.getFullYear()).slice(2);
const datePST = body.date_pst || (mm + '/' + dd + '/' + yy);          // 03/01/26
const docName = body.date_pst
  ? body.date_pst.replace(/(\\d{2})\\/(\\d{2})\\/(\\d{2})/, function(_, m, d, y) { return m + '/' + d + '/20' + y; })
  : (mm + '/' + dd + '/20' + yy);                                      // 03/01/2026

const business = body.business || 'Angelsbailbonds';
const tabKeywords = (business.toLowerCase().includes('angel') || business.toLowerCase().includes('bail'))
  ? ['angel', 'bail bond', 'abb', 'angelsbailbonds']
  : null;

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

  // 3. HTTP Request: Search Google Drive for today's doc
  {
    id: 'http-search-drive',
    name: 'HTTP: Search Drive',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [480, 300],
    credentials: { googleDriveOAuth2Api: GOOGLE_DRIVE_CRED },
    parameters: {
      method: 'GET',
      url: 'https://www.googleapis.com/drive/v3/files',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendQuery: true,
      queryParameters: {
        parameters: [
          {
            name: 'q',
            value: `={{ "'" + "${DRIVE_FOLDER_ID}" + "' in parents and name='" + $json.docName + "' and mimeType='application/vnd.google-apps.document' and trashed=false" }}`,
          },
          { name: 'fields', value: 'files(id,name)' },
          { name: 'spaces', value: 'drive' },
        ],
      },
    },
  },

  // 4. IF: Doc Exists?
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
            leftValue: '={{ $json.files && $json.files.length > 0 }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },

  // 5a. HTTP Request: Create Doc in Drive folder (if missing)
  {
    id: 'http-create-doc',
    name: 'HTTP: Create Doc in Drive',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [960, 460],
    credentials: { googleDriveOAuth2Api: GOOGLE_DRIVE_CRED },
    parameters: {
      method: 'POST',
      url: 'https://www.googleapis.com/drive/v3/files',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }],
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: `={{ JSON.stringify({ name: $('Code: Parse & PST Date').item.json.docName, mimeType: 'application/vnd.google-apps.document', parents: ['${DRIVE_FOLDER_ID}'] }) }}`,
    },
  },

  // 5b. Code: Resolve Doc ID from either branch
  {
    id: 'merge-doc-id',
    name: 'Code: Resolve Doc ID',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1200, 300],
    parameters: {
      jsCode: `
const item = $input.first().json;
const parsed = $('Code: Parse & PST Date').first().json;
// Drive search returns files[0].id; Drive create returns id
const docId = (item.files && item.files[0]) ? item.files[0].id : item.id;
return [{ json: { ...parsed, docId } }];
`,
    },
  },

  // 6. HTTP Request: Get doc with tabs content
  {
    id: 'http-get-doc',
    name: 'HTTP: Get Doc with Tabs',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1440, 300],
    credentials: { googleDriveOAuth2Api: GOOGLE_DRIVE_CRED },
    parameters: {
      method: 'GET',
      url: '={{ "https://docs.googleapis.com/v1/documents/" + $json.docId + "?includeTabsContent=true" }}',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
    },
  },

  // 7. Code: Find/Note tab, build session text, build ClickUp items
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
  for (var i = 0; i < tabs.length; i++) {
    var title = (tabs[i].documentTab && tabs[i].documentTab.properties && tabs[i].documentTab.properties.title || '').toLowerCase();
    if (keywords.some(function(k) { return title.includes(k); })) {
      tabId = tabs[i].documentTab && tabs[i].documentTab.properties && tabs[i].documentTab.properties.index;
      tabTitle = (tabs[i].documentTab && tabs[i].documentTab.properties && tabs[i].documentTab.properties.title) || business;
      break;
    }
  }
  if (tabId === null && tabs.length > 0) {
    tabId = (tabs[0].documentTab && tabs[0].documentTab.properties && tabs[0].documentTab.properties.index) || 0;
    tabTitle = (tabs[0].documentTab && tabs[0].documentTab.properties && tabs[0].documentTab.properties.title) || business;
  }
} else {
  for (var i = 0; i < tabs.length; i++) {
    var title = (tabs[i].documentTab && tabs[i].documentTab.properties && tabs[i].documentTab.properties.title || '').toLowerCase();
    if (title.includes('claude')) {
      tabId = (tabs[i].documentTab && tabs[i].documentTab.properties && tabs[i].documentTab.properties.index) || 0;
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
lines.push('-----------------------------------------');
lines.push('Claude Code Session - ' + d.datePST + ' PST');
lines.push('-----------------------------------------');

function fmt(emoji, label, arr) {
  lines.push(emoji + ' ' + label);
  if (!arr || arr.length === 0) { lines.push('  - (none)'); }
  else { arr.forEach(function(t) { lines.push('  - ' + t); }); }
  lines.push('');
}

fmt('DONE', 'COMPLETED',   d.completed);
fmt('WIP',  'IN PROGRESS', d.in_progress);
fmt('TODO', 'TODO',        d.todo);
fmt('BLOCKED', 'BLOCKERS', d.blockers);
fmt('Q',    'QUESTIONS',   d.questions);

const sessionText = lines.join('\\n');

// All ClickUp items
const clickupItems = [];
(d.completed   || []).forEach(function(t) { clickupItems.push({ text: t, status: 'complete' }); });
(d.in_progress || []).forEach(function(t) { clickupItems.push({ text: t, status: 'in progress' }); });
(d.todo        || []).forEach(function(t) { clickupItems.push({ text: t, status: 'to do' }); });
(d.blockers    || []).forEach(function(t) { clickupItems.push({ text: '[BLOCKER] ' + t, status: 'blocked' }); });
(d.questions   || []).forEach(function(t) { clickupItems.push({ text: '[Q] ' + t, status: 'to do' }); });

return [{
  json: {
    datePST:   parsed.datePST,
    docName:   parsed.docName,
    business:  parsed.business,
    docId:     $('Code: Resolve Doc ID').first().json.docId,
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

  // 8. HTTP Request: Append session text to Google Doc via batchUpdate
  {
    id: 'docs-append',
    name: 'Docs: Append Session',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1920, 300],
    credentials: { googleDriveOAuth2Api: GOOGLE_DRIVE_CRED },
    parameters: {
      method: 'POST',
      url: '={{ "https://docs.googleapis.com/v1/documents/" + $json.docId + ":batchUpdate" }}',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }],
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: '={{ JSON.stringify({ requests: [{ insertText: { endOfSegmentLocation: { segmentId: "" }, text: $json.sessionText } }] }) }}',
    },
  },

  // 9. Split ClickUp items one by one
  {
    id: 'split-items',
    name: 'Split: ClickUp Items',
    type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3,
    position: [2160, 300],
    parameters: { batchSize: 1, options: {} },
  },

  // 10. HTTP: Search ClickUp for existing task (dedup)
  {
    id: 'http-search-clickup',
    name: 'HTTP: Search ClickUp Task',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2400, 300],
    parameters: {
      method: 'GET',
      url: `https://api.clickup.com/api/v2/list/${ABB_CLICKUP_LIST}/task`,
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Authorization', value: CLICKUP_API_KEY }],
      },
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'search', value: "={{ $('Code: Find/Note Tab').item.json.clickupTaskPrefix + $json.text }}" },
          { name: 'include_closed', value: 'true' },
        ],
      },
    },
  },

  // 11. IF: Task already exists?
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
            leftValue: '={{ ($json.tasks || []).length }}',
            rightValue: 0,
            operator: { type: 'number', operation: 'gt' },
          },
        ],
        combinator: 'and',
      },
    },
  },

  // 12. HTTP: Create ClickUp task (only if not duplicate)
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
      body: "={{ JSON.stringify({ name: $('Code: Find/Note Tab').item.json.clickupTaskPrefix + $('Split: ClickUp Items').item.json.text, status: $('Split: ClickUp Items').item.json.status, description: 'Logged by Claude Code session - ' + $('Code: Find/Note Tab').item.json.datePST }) }}",
    },
  },

  // 13. Respond to webhook
  {
    id: 'respond-webhook',
    name: 'Respond: Success',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [3120, 300],
    parameters: {
      respondWith: 'json',
      responseBody: "={{ JSON.stringify({ ok: true, date: $('Code: Parse & PST Date').first().json.datePST, business: $('Code: Parse & PST Date').first().json.business, items_logged: $('Code: Find/Note Tab').first().json.clickupItems.length }) }}",
      options: {},
    },
  },
];

const connections = {
  'Webhook: Claude Progress': {
    main: [[{ node: 'Code: Parse & PST Date', type: 'main', index: 0 }]],
  },
  'Code: Parse & PST Date': {
    main: [[{ node: 'HTTP: Search Drive', type: 'main', index: 0 }]],
  },
  'HTTP: Search Drive': {
    main: [[{ node: 'IF: Doc Exists?', type: 'main', index: 0 }]],
  },
  'IF: Doc Exists?': {
    main: [
      [{ node: 'Code: Resolve Doc ID', type: 'main', index: 0 }],   // true → doc found
      [{ node: 'HTTP: Create Doc in Drive', type: 'main', index: 0 }], // false → create
    ],
  },
  'HTTP: Create Doc in Drive': {
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
    main: [
      [{ node: 'HTTP: Search ClickUp Task', type: 'main', index: 0 }], // output 0: loop
      [{ node: 'Respond: Success', type: 'main', index: 0 }],           // output 1: done
    ],
  },
  'HTTP: Search ClickUp Task': {
    main: [[{ node: 'IF: Task Exists?', type: 'main', index: 0 }]],
  },
  'IF: Task Exists?': {
    main: [
      [],                                                                          // true → skip (task exists)
      [{ node: 'HTTP: Create ClickUp Task', type: 'main', index: 0 }],           // false → create
    ],
  },
  'HTTP: Create ClickUp Task': {
    main: [[{ node: 'Split: ClickUp Items', type: 'main', index: 0 }]], // loop back
  },
};

// ── PUT fixed workflow ──────────────────────────────────────────────────────
const putBody = {
  name: wf.name,
  nodes,
  connections,
  settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
  staticData: null,
};

const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(putBody),
});

if (!putRes.ok) {
  console.error('PUT failed:', putRes.status, await putRes.text());
  process.exit(1);
}
const updated = await putRes.json();
const wh = updated.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
console.log('PUT OK — webhookId:', wh?.webhookId);
console.log('Nodes:', updated.nodes.map(n => n.name).join(', '));

// ── Reactivate ─────────────────────────────────────────────────────────────
const activateRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/activate`, {
  method: 'POST',
  headers,
});
const activated = await activateRes.json();
console.log('Activated! active:', activated.active);
console.log('\nWorkflow is ready. Test with:');
console.log(`  node scripts/log-session-progress.mjs '{"business":"Angelsbailbonds","completed":["test"],"in_progress":[],"todo":[],"blockers":[],"questions":[]}'`);
