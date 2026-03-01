/**
 * Connects credentials to the Angels Bail Bonds SEO Content Generator workflow
 * Workflow ID: VAu7yE52Hl9HpKcK
 *
 * Changes:
 *  1. Assign Anthropic API cred to all lmChatAnthropic nodes
 *  2. Assign Google Docs cred to Create Article Google Doc
 *  3. Replace Google Sheets nodes with HTTP Request + Code parse nodes (Drive OAuth2)
 *  4. Replace Update Content Status (Sheets append) with HTTP Request
 *  5. Hardcode SERP_API_KEY in SerpAPI nodes (replaces $env.SERP_API_KEY)
 *  6. Fix: both triggers also connect to SERPROBOT Rankings (currently orphaned)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '../.env'), 'utf8');
const N8N_API_KEY     = env.match(/N8N_API_KEY=(.+)/)[1].trim();
const N8N_BASE_URL    = env.match(/N8N_BASE_URL=(.+)/)[1].trim();
const SERP_API_KEY    = env.match(/SERP_API_KEY=(.+)/)[1].trim();

const WORKFLOW_ID = 'VAu7yE52Hl9HpKcK';

const ANTHROPIC_CRED  = { id: 'GDV8zoUgYm4AKhyk', name: 'Anthropic API' };
const DRIVE_CRED      = { id: '9pLcah8bZziqZuRW', name: '4434 lifeline Google Drive account' };
const DOCS_CRED       = { id: 'NHKmASipLi8Aa6OM', name: '4434 Google Docs account' };

// Sheets
const ABB_SHEET_ID      = '139W8Bw6F9-ujDi3eEFw77RzMZYd6fQEO7kUZbLshNYA';
const SERPROBOT_SHEET_ID = '1qsR83Vg7R-yatxuQGAwlzCamWdImbY5sl3Jd6107fHs';

const h = { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' };

// ── Fetch workflow ─────────────────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, { headers: h });
const wf = await getRes.json();
console.log('Fetched:', wf.name, '| active:', wf.active);

await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, { method: 'POST', headers: h });
console.log('Deactivated');

// ── Build updated nodes ────────────────────────────────────────────────────
const nodes = [];

for (const node of wf.nodes) {
  const n = JSON.parse(JSON.stringify(node)); // deep clone

  // ── 1. Assign Anthropic credential to all Claude LM nodes ───────────────
  if (n.type === '@n8n/n8n-nodes-langchain.lmChatAnthropic') {
    n.credentials = { anthropicApi: ANTHROPIC_CRED };
    console.log(`  ✅ Anthropic cred → ${n.name}`);
    nodes.push(n);
    continue;
  }

  // ── 2. Google Docs create node — assign Docs cred ───────────────────────
  if (n.name === 'Create Article Google Doc') {
    // Replace with HTTP Request to Docs API (create then append content)
    // Keep same id/name/position so connections stay intact
    n.type = 'n8n-nodes-base.httpRequest';
    n.typeVersion = 4.2;
    n.credentials = { googleDriveOAuth2Api: DRIVE_CRED };
    n.parameters = {
      method: 'POST',
      url: 'https://docs.googleapis.com/v1/documents',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }],
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      // Create doc with title — returns {documentId, title, ...}
      body: `={{ JSON.stringify({ title: $('Title Maker').item.json.output }) }}`,
    };
    console.log(`  ✅ Replaced Create Article Google Doc → HTTP Request (Docs API create)`);
    nodes.push(n);

    // Also add a "Write Doc Content" node right after
    // We'll wire it in connections below
    nodes.push({
      id: 'write-doc-content',
      name: 'Write Doc Content',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [n.position[0] + 60, n.position[1] + 120],
      credentials: { googleDriveOAuth2Api: DRIVE_CRED },
      parameters: {
        method: 'POST',
        url: `={{ "https://docs.googleapis.com/v1/documents/" + $json.documentId + ":batchUpdate" }}`,
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleDriveOAuth2Api',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'Content-Type', value: 'application/json' }],
        },
        sendBody: true,
        contentType: 'raw',
        rawContentType: 'application/json',
        body: `={{ JSON.stringify({ requests: [{ insertText: { endOfSegmentLocation: { segmentId: "" }, text: "# " + $('Title Maker').item.json.output + "\\n\\n---\\nKeyword: " + $('Loop Over Items').item.json.Keyword + "\\nVolume: " + $('Loop Over Items').item.json.Volume + "\\nSERPROBOT Rank: " + ($('Loop Over Items').item.json.serprobot_rank || 'Not tracked') + "\\nScore: " + $('Loop Over Items').item.json.score + "\\nMeta Title: " + $('Generate Blog Metadata').item.json.output.metaTitle + "\\nMeta Description: " + $('Generate Blog Metadata').item.json.output.metaDescription + "\\nSlug: " + $('Generate Blog Metadata').item.json.output.slug + "\\nSite: https://bailbondsdomesticviolence.com\\n\\n" + $('Final Article Assembly').item.json.output } }] }) }}`,
      },
    });
    console.log(`  ✅ Added Write Doc Content node`);
    continue;
  }

  // ── 3a. Replace ABB Keyword Inventory with HTTP Request ─────────────────
  if (n.name === 'ABB Keyword Inventory') {
    n.type = 'n8n-nodes-base.httpRequest';
    n.typeVersion = 4.2;
    n.credentials = { googleDriveOAuth2Api: DRIVE_CRED };
    n.parameters = {
      method: 'GET',
      url: `https://sheets.googleapis.com/v4/spreadsheets/${ABB_SHEET_ID}/values/City%20of%20Industry`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendQuery: true,
      queryParameters: {
        parameters: [{ name: 'majorDimension', value: 'ROWS' }],
      },
    };
    nodes.push(n);

    // Add parse node immediately after
    nodes.push({
      id: 'parse-abb-keywords',
      name: 'Parse: ABB Keywords',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [n.position[0] + 60, n.position[1] + 120],
      parameters: {
        jsCode: `
const rows = $json.values || [];
if (rows.length < 2) return [];
const headers = rows[0].map(h => h.trim());
return rows.slice(1)
  .filter(row => row.some(cell => cell && cell.toString().trim()))
  .map(row => ({
    json: Object.fromEntries(headers.map((h, i) => [h, (row[i] || '').toString().trim()]))
  }));
`,
      },
    });
    console.log(`  ✅ Replaced ABB Keyword Inventory → HTTP Request + Parse node`);
    continue;
  }

  // ── 3b. Replace SERPROBOT Rankings with HTTP Request ────────────────────
  if (n.name === 'SERPROBOT Rankings') {
    n.type = 'n8n-nodes-base.httpRequest';
    n.typeVersion = 4.2;
    n.credentials = { googleDriveOAuth2Api: DRIVE_CRED };
    n.parameters = {
      method: 'GET',
      url: `https://sheets.googleapis.com/v4/spreadsheets/${SERPROBOT_SHEET_ID}/values/clean%20list-%20SERPROBOT`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendQuery: true,
      queryParameters: {
        parameters: [{ name: 'majorDimension', value: 'ROWS' }],
      },
    };
    nodes.push(n);

    // Add parse node immediately after
    nodes.push({
      id: 'parse-serprobot',
      name: 'Parse: SERPROBOT',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [n.position[0] + 60, n.position[1] + 120],
      parameters: {
        jsCode: `
const rows = $json.values || [];
if (rows.length < 2) return [];
const headers = rows[0].map(h => h.trim());
return rows.slice(1)
  .filter(row => row.some(cell => cell && cell.toString().trim()))
  .map(row => ({
    json: Object.fromEntries(headers.map((h, i) => [h, (row[i] || '').toString().trim()]))
  }));
`,
      },
    });
    console.log(`  ✅ Replaced SERPROBOT Rankings → HTTP Request + Parse node`);
    continue;
  }

  // ── 4. Replace Update Content Status (Sheets append) ────────────────────
  if (n.name === 'Update Content Status') {
    n.type = 'n8n-nodes-base.httpRequest';
    n.typeVersion = 4.2;
    n.credentials = { googleDriveOAuth2Api: DRIVE_CRED };
    n.parameters = {
      method: 'POST',
      url: `https://sheets.googleapis.com/v4/spreadsheets/${ABB_SHEET_ID}/values/Content%20Pipeline:append`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }],
      },
      sendQuery: true,
      queryParameters: {
        parameters: [{ name: 'valueInputOption', value: 'USER_ENTERED' }],
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: `={{ JSON.stringify({ range: "Content Pipeline", majorDimension: "ROWS", values: [[ $('Loop Over Items').item.json.Keyword, "Ready for Review", "https://docs.google.com/document/d/" + $('Write Doc Content').item.json.documentId, new Date().toISOString() ]] }) }}`,
    };
    console.log(`  ✅ Replaced Update Content Status → HTTP Request (Sheets API append)`);
    nodes.push(n);
    continue;
  }

  // ── 5. Fix SERP_API_KEY in SerpAPI nodes ────────────────────────────────
  if (n.name === 'SerpAPI SERP Research') {
    const params = n.parameters.queryParameters?.parameters || [];
    for (const p of params) {
      if (p.name === 'api_key') {
        p.value = SERP_API_KEY;
        console.log(`  ✅ SERP_API_KEY hardcoded → ${n.name}`);
      }
    }
    nodes.push(n);
    continue;
  }

  if (n.name === 'SerpAPI Research' || n.name === 'SerpAPI Fact Check') {
    const params = n.parameters.parametersUi?.parameter || [];
    for (const p of params) {
      if (p.name === 'api_key') {
        p.value = SERP_API_KEY;
        console.log(`  ✅ SERP_API_KEY hardcoded → ${n.name}`);
      }
    }
    nodes.push(n);
    continue;
  }

  // ── Default: keep node as-is ─────────────────────────────────────────────
  nodes.push(n);
}

// ── Build updated connections ──────────────────────────────────────────────
const conns = JSON.parse(JSON.stringify(wf.connections));

// Fix: both triggers connect to SERPROBOT Rankings (currently orphaned)
// Schedule Trigger and Manual Trigger only went to ABB Keyword Inventory
for (const trigger of ['Schedule Trigger', 'Manual Trigger']) {
  if (conns[trigger]) {
    const existing = conns[trigger].main[0] || [];
    const alreadyHasSerprobot = existing.some(e => e.node === 'SERPROBOT Rankings');
    if (!alreadyHasSerprobot) {
      conns[trigger].main[0] = [...existing, { node: 'SERPROBOT Rankings', type: 'main', index: 0 }];
      console.log(`  ✅ ${trigger} → SERPROBOT Rankings connection added`);
    }
  }
}

// Wire: ABB Keyword Inventory → Parse: ABB Keywords → Merge Keyword Sources
conns['ABB Keyword Inventory'] = { main: [[{ node: 'Parse: ABB Keywords', type: 'main', index: 0 }]] };
conns['Parse: ABB Keywords'] = { main: [[{ node: 'Merge Keyword Sources', type: 'main', index: 0 }]] };

// Wire: SERPROBOT Rankings → Parse: SERPROBOT → Merge Keyword Sources
conns['SERPROBOT Rankings'] = { main: [[{ node: 'Parse: SERPROBOT', type: 'main', index: 0 }]] };
conns['Parse: SERPROBOT'] = { main: [[{ node: 'Merge Keyword Sources', type: 'main', index: 1 }]] };

// Wire: Create Article Google Doc → Write Doc Content → Update Content Status
conns['Create Article Google Doc'] = { main: [[{ node: 'Write Doc Content', type: 'main', index: 0 }]] };
conns['Write Doc Content'] = { main: [[{ node: 'Update Content Status', type: 'main', index: 0 }]] };

console.log('\nConnections updated');

// ── PUT workflow ───────────────────────────────────────────────────────────
const putBody = {
  name: wf.name,
  nodes,
  connections: conns,
  settings: wf.settings,
  staticData: wf.staticData || null,
};

const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: 'PUT',
  headers: h,
  body: JSON.stringify(putBody),
});

if (!putRes.ok) {
  const err = await putRes.text();
  console.error('PUT failed:', putRes.status, err.slice(0, 300));
  process.exit(1);
}

const updated = await putRes.json();
console.log('\nPUT OK — node count:', updated.nodes.length);

// Summarize credentials connected
const credSummary = {};
for (const node of updated.nodes) {
  for (const [k, v] of Object.entries(node.credentials || {})) {
    credSummary[k] = (credSummary[k] || 0) + 1;
  }
}
console.log('Credentials assigned:', JSON.stringify(credSummary));

// ── Do NOT activate yet — user should test manually first ─────────────────
console.log('\n✅ Workflow updated but NOT activated yet.');
console.log('   Review in n8n UI then run manually to test end-to-end.');
console.log(`   n8n URL: https://n8n.srv1329589.hstgr.cloud/workflow/${WORKFLOW_ID}`);
