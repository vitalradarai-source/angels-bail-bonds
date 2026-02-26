import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

// ── Fetch current workflow ─────────────────────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) {
  console.error("❌ Fetch failed:", JSON.stringify(workflow, null, 2));
  process.exit(1);
}

// ── Find the Claude node ───────────────────────────────────────────────────────
const claudeIndex = workflow.nodes.findIndex((n: any) => n.name === "Claude: Analyze Report");
if (claudeIndex === -1) {
  console.error("❌ Could not find 'Claude: Analyze Report' node");
  process.exit(1);
}

console.log("✅ Found node:", workflow.nodes[claudeIndex].name);
console.log("   Current body params:", JSON.stringify(workflow.nodes[claudeIndex].parameters, null, 2));

// ── The problem explained ─────────────────────────────────────────────────────
//
//  n8n HTTP Request with contentType: "json" validates the body as STATIC JSON
//  before sending. But our body is an n8n EXPRESSION: ={{ JSON.stringify({...}) }}
//  That expression is not itself valid JSON — it's code that PRODUCES JSON.
//  So n8n rejects it with "JSON parameter needs to be valid JSON".
//
//  Fix: Use contentType: "raw" + set Content-Type header manually.
//  "raw" mode tells n8n: "send the body exactly as the expression evaluates to".
//  No pre-validation. The expression runs, produces a JSON string, and it gets sent.
//
//  LESSON — Two ways to send JSON in HTTP requests:
//  1. "JSON mode" — n8n builds + validates the body for you (good for static values)
//  2. "Raw mode" — you build the body yourself, n8n just sends it (good for expressions)

// ── Build the body expression as a string ─────────────────────────────────────
//
//  We build the JSON.stringify expression carefully.
//  The body string starts with ={{ and ends with }} — this is n8n's expression syntax.
//  Inside, we use $json.pdfBase64 and $json.masterPrompt (output from Prepare node).
//
//  NOTE: We use the model from .env. Haiku is much cheaper than Sonnet/Opus,
//  which matters here since master prompts are very long.
const bodyExpression = [
  "={{ JSON.stringify({",
  '  "model": "' + ANTHROPIC_MODEL + '",',
  '  "max_tokens": 4096,',
  '  "messages": [',
  "    {",
  '      "role": "user",',
  '      "content": [',
  "        {",
  '          "type": "document",',
  '          "source": {',
  '            "type": "base64",',
  '            "media_type": "application/pdf",',
  '            "data": $json.pdfBase64',
  "          }",
  "        },",
  "        {",
  '          "type": "text",',
  '          "text": $json.masterPrompt',
  "        }",
  "      ]",
  "    }",
  "  ]",
  "}) }}",
].join("\n");

console.log("\n   New body expression (preview):\n" + bodyExpression.slice(0, 200) + "...");

// ── Replace the Claude node ────────────────────────────────────────────────────
const originalNode = workflow.nodes[claudeIndex];

workflow.nodes[claudeIndex] = {
  id: originalNode.id,
  name: originalNode.name,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: originalNode.position,
  parameters: {
    method: "POST",
    url: "https://api.anthropic.com/v1/messages",

    // ── Headers ───────────────────────────────────────────────────────────────
    // We send the API key in x-api-key (Anthropic's auth format),
    // anthropic-version is required by the API,
    // content-type tells the server we're sending JSON.
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "x-api-key",          value: ANTHROPIC_API_KEY },
        { name: "anthropic-version",  value: "2023-06-01" },
        { name: "content-type",       value: "application/json" },
      ],
    },

    // ── Body ──────────────────────────────────────────────────────────────────
    // contentType: "raw" = n8n sends body as-is without trying to parse it.
    // The expression ={{ JSON.stringify({...}) }} evaluates at runtime to a
    // valid JSON string that the Anthropic API accepts.
    sendBody: true,
    contentType: "raw",
    rawContentType: "application/json",
    body: bodyExpression,

    options: {},
  },
};

console.log("\n✅ Node updated — switching from contentType:json to contentType:raw");

// ── Push updated workflow back ─────────────────────────────────────────────────
const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: {
    "X-N8N-API-KEY": N8N_API_KEY,
    "Content-Type": "application/json",
  },
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
  console.log("✅ Workflow saved!");
  console.log(`   URL: ${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`);
} else {
  console.error("❌ Save failed:", JSON.stringify(putData, null, 2));
}
