import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const COMPARISON_WORKFLOW_ID = "af9BFNgHLS1LgmIG";
const SPYFU_WORKFLOW_ID      = "9Xw3q2PtO1LPC4JH"; // working SpyFu workflow

// ── STEP 1: Grab Gmail credential ID from the working SpyFu workflow ──────────
const spyfuRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${SPYFU_WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const spyfuWorkflow = await spyfuRes.json();
if (!spyfuRes.ok) { console.error("❌ Failed to fetch SpyFu workflow:", spyfuWorkflow); process.exit(1); }

// Find any node with gmailOAuth2 credentials
let gmailCred: { id: string; name: string } | null = null;
for (const node of spyfuWorkflow.nodes) {
  if (node.credentials?.gmailOAuth2) {
    gmailCred = node.credentials.gmailOAuth2;
    console.log(`✅ Found Gmail cred in SpyFu node "${node.name}": ID="${gmailCred!.id}" Name="${gmailCred!.name}"`);
    break;
  }
}

if (!gmailCred) {
  console.error("❌ No Gmail credential found in SpyFu workflow");
  // Print all credentials used
  for (const node of spyfuWorkflow.nodes) {
    if (node.credentials) console.log(`  Node "${node.name}" creds:`, JSON.stringify(node.credentials));
  }
  process.exit(1);
}

// ── STEP 2: Fetch the comparison workflow ────────────────────────────────────
const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${COMPARISON_WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched comparison workflow:", workflow.name);

// ── STEP 3: Update all Gmail credential references ────────────────────────────
let updatedCount = 0;
for (const node of workflow.nodes) {
  if (node.credentials?.gmailOAuth2) {
    const old = JSON.stringify(node.credentials.gmailOAuth2);
    node.credentials.gmailOAuth2 = { id: gmailCred.id, name: gmailCred.name };
    console.log(`  ✅ "${node.name}": ${old} → ${JSON.stringify(node.credentials.gmailOAuth2)}`);
    updatedCount++;
  }
}
console.log(`\nUpdated ${updatedCount} node(s).`);

// ── STEP 4: Save ──────────────────────────────────────────────────────────────
const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${COMPARISON_WORKFLOW_ID}`, {
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
  console.log("\n✅ Comparison workflow saved with correct Gmail credentials!");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
