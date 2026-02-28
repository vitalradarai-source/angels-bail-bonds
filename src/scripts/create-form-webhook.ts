/**
 * Creates an n8n workflow that receives form submissions via webhook
 * and emails all 3 recipients via the connected Gmail account.
 *
 * Forms handled:
 *   - Contact Form
 *   - Quick Bail Quote Form
 *   - Online Bail Bond Application
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL   = process.env.N8N_BASE_URL!;
const N8N_API_KEY    = process.env.N8N_API_KEY!;
const GMAIL_CRED_ID  = "2RYuDpJiAcnEWzpj";
const GMAIL_CRED_NAME = "4434 Gmail account";
const RECIPIENTS     = "4434lifeline@gmail.com";
const CC_RECIPIENTS  = "lifefullycharged@gmail.com,sean@angelsbailbonds.com";
const WEBHOOK_PATH   = "form-submission";

// ── Nodes ─────────────────────────────────────────────────────────────────
const webhookNode = {
  id: "webhook-trigger",
  name: "Form Webhook",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: [240, 300],
  parameters: {
    httpMethod: "POST",
    path: WEBHOOK_PATH,
    responseMode: "responseNode",
    options: {},
  },
  webhookId: WEBHOOK_PATH,
};

const gmailNode = {
  id: "gmail-send",
  name: "Gmail: Send to Team",
  type: "n8n-nodes-base.gmail",
  typeVersion: 2.1,
  position: [500, 300],
  credentials: {
    gmailOAuth2: { id: GMAIL_CRED_ID, name: GMAIL_CRED_NAME },
  },
  parameters: {
    sendTo: RECIPIENTS,
    subject: `={{
      $json.form_source === 'Quick Bail Quote Form'
        ? '🚨 New Bail Quote Request — ' + ($json.defendant_name || 'Unknown')
        : $json.form_source === 'Online Bail Bond Application'
          ? '📋 New Bail Bond Application — ' + ($json.defendant_name || 'Unknown')
          : '📩 New Contact Message — ' + ($json.from_name || 'Unknown')
    }}`,
    emailType: "html",
    message: `={{
      (function() {
        var d = $json;
        var src = d.form_source || 'Website Form';
        var rows = '';
        var fields = Object.keys(d);
        for (var i = 0; i < fields.length; i++) {
          var k = fields[i];
          if (k === 'form_source') continue;
          var label = k.replace(/_/g, ' ').replace(/\\b\\w/g, function(c){ return c.toUpperCase(); });
          rows += '<tr><td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;border-bottom:1px solid #eee;">' + label + '</td><td style="padding:6px 12px;color:#222;border-bottom:1px solid #eee;">' + (d[k] || '—') + '</td></tr>';
        }
        return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">' +
          '<div style="background:#1a365d;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">' +
          '<h2 style="margin:0;font-size:20px;">New Submission: ' + src + '</h2>' +
          '<p style="margin:4px 0 0;opacity:0.8;font-size:13px;">bailbondsdomesticviolence.com</p>' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #ddd;border-top:none;">' + rows + '</table>' +
          '<div style="background:#f5f5f5;padding:12px 24px;font-size:12px;color:#888;border-radius:0 0 8px 8px;border:1px solid #ddd;border-top:none;">' +
          'Sent automatically from the website contact form.' +
          '</div></div>';
      })()
    }}`,
    options: {
      ccList: CC_RECIPIENTS,
    },
  },
};

const respondNode = {
  id: "respond-webhook",
  name: "Respond to Webhook",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position: [760, 300],
  parameters: {
    respondWith: "json",
    responseBody: `={{ JSON.stringify({ ok: true }) }}`,
    options: {},
  },
};

// ── Connections ───────────────────────────────────────────────────────────
const connections = {
  "Form Webhook": {
    main: [[{ node: "Gmail: Send to Team", type: "main", index: 0 }]],
  },
  "Gmail: Send to Team": {
    main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]],
  },
};

const workflow = {
  name: "Form Submissions Handler",
  nodes: [webhookNode, gmailNode, respondNode],
  connections,
  settings: { executionOrder: "v1" },
  staticData: null,
};

// ── Create or update ──────────────────────────────────────────────────────
// Check if workflow already exists
const listRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows?limit=100`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const listData = await listRes.json();
const existing = listData.data?.find((w: any) => w.name === "Form Submissions Handler");

let workflowId: string;

if (existing) {
  console.log(`✅ Workflow already exists (ID: ${existing.id}) — updating...`);
  workflowId = existing.id;

  await fetch(`${N8N_BASE_URL}/api/v1/workflows/${workflowId}/deactivate`, {
    method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });

  const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: "PUT",
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(workflow),
  });
  const putData = await putRes.json();
  if (!putRes.ok) { console.error("❌ Update failed:", putData); process.exit(1); }
  console.log("✅ Updated");
} else {
  const createRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(workflow),
  });
  const createData = await createRes.json();
  if (!createRes.ok) { console.error("❌ Create failed:", createData); process.exit(1); }
  workflowId = createData.id;
  console.log(`✅ Created workflow (ID: ${workflowId})`);
}

// ── Activate ──────────────────────────────────────────────────────────────
const actRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${workflowId}/activate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
if (!actRes.ok) {
  console.error("⚠️  Could not activate — activate manually in n8n UI");
} else {
  console.log("✅ Activated");
}

const webhookUrl = `${N8N_BASE_URL}/webhook/${WEBHOOK_PATH}`;
console.log(`\n🎯 Webhook URL:\n   ${webhookUrl}\n`);
console.log(`Recipients: ${RECIPIENTS}`);
console.log(`CC:         ${CC_RECIPIENTS}`);
console.log(`\nAdd to cali-bond-swift/.env.local:\n  VITE_FORM_WEBHOOK_URL=${webhookUrl}`);
