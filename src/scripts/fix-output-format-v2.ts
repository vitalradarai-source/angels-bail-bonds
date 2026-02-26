import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";
const GOOGLE_DRIVE_FOLDER_ID = "1I0BspHZEJNBTFb04Oq585LsQrFd7sny5";

// ── WHAT WE ARE FIXING ────────────────────────────────────────────────────────
//
//  PROBLEM: Claude wraps its HTML output in a "code fence" like this:
//    ```html
//    <html><head><style>body { font-family... }</style></head>
//    <body>actual content</body>
//    </html>
//    ```
//
//  This is like if you asked someone to write a letter and they put it
//  inside a sealed zip-lock bag. The letter is fine, but the bag is in the way.
//
//  THREE different problems to fix:
//  1. Strip the ```html ... ``` wrapper (the "zip-lock bag")
//  2. Strip the <style> CSS code (CSS is for web browsers, not for emails/docs)
//  3. Strip <html><head><body> wrapper tags (we only need the content inside)
//
//  THEN fix each destination:
//  - Email      → clean HTML already looks great, just remove the junk above
//  - Google Docs → use Google Drive API to import HTML → becomes a real formatted doc
//  - ClickUp    → convert HTML to markdown that ClickUp renders as formatted text

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

// ── FIX 1: PREPARE NODE — TELL CLAUDE "NO CODE FENCES" ───────────────────────
//
//  The prompts already say "output HTML", but Claude still wraps it in ```html
//  We need to add a VERY explicit instruction to NOT do that.

const prepareIdx = workflow.nodes.findIndex((n: any) => n.name === "Prepare: Detect Type & Build Prompt");
if (prepareIdx !== -1) {
  const currentCode: string = workflow.nodes[prepareIdx].parameters.jsCode;

  // Add a critical rule to both prompts: no code fences, no style/html/head/body tags
  const noCodeFenceRule = [
    "  CRITICAL OUTPUT RULES — YOU MUST FOLLOW THESE:",
    "  - Start your response DIRECTLY with content. Do NOT write ```html or ``` anywhere.",
    "  - Do NOT include <html>, <head>, <body>, or <style> tags.",
    "  - ONLY use these tags: <h1> <h2> <h3> <p> <strong> <ul> <ol> <li> <br> <hr>",
    "  - Your very first character should be a < from an HTML tag, nothing else before it.",
    "  - The output goes DIRECTLY into an email. There is no browser. No CSS is needed.",
  ].join("\\n");

  // Inject the rule into both prompt strings in the Code node
  // We find "CRITICAL STYLE RULES" in each prompt and add our rule before it
  const updated = currentCode.replace(
    /## CRITICAL STYLE RULES/g,
    "## CRITICAL STYLE RULES\n" + noCodeFenceRule
  );

  if (updated !== currentCode) {
    workflow.nodes[prepareIdx].parameters.jsCode = updated;
    console.log("✅ Fix 1: Added 'no code fences, no style tags' to both prompts");
  } else {
    console.log("⚠️  Fix 1: Could not inject rule (heading not found) — skipping prompt update");
  }
}

// ── FIX 2: FORMAT NODE — STRIP JUNK + BUILD CLEAN VERSIONS FOR EACH DESTINATION
//
//  Even after fixing the prompt, Claude sometimes still adds the code fence.
//  So we ALSO strip it in the Format node as a safety net.
//
//  Think of it like a coffee filter: even if the beans are good, we still
//  run the coffee through the filter to catch any grounds.
//
//  This node now creates THREE versions of the analysis:
//
//  analysisHtml     → clean HTML (no code fence, no CSS, no wrapper tags)
//                     Used in: Email (Gmail renders HTML as real formatting)
//
//  analysisMarkdown → HTML converted to Markdown syntax
//                     Used in: ClickUp (ClickUp renders markdown as bold/headers)
//
//  analysisPlain    → HTML stripped to plain readable text
//                     Used in: Google Docs (as fallback)

const formatIdx = workflow.nodes.findIndex((n: any) => n.name === "Format Report Output");
if (formatIdx !== -1) {
  workflow.nodes[formatIdx].parameters.jsCode = `
const rawAnalysis = $json.content?.[0]?.text || 'Analysis failed — no output from Claude.';
const reportType = $('Prepare: Detect Type & Build Prompt').first().json.reportType;
const receivedAt = $('Prepare: Detect Type & Build Prompt').first().json.receivedAt;
const subject = $('Prepare: Detect Type & Build Prompt').first().json.subject;
const date = new Date(receivedAt).toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric'
});

// ── STEP 1: Strip the code fence wrapper ──────────────────────────────────────
// Claude sometimes outputs: \`\`\`html\\n<content>\\n\`\`\`
// We need just the <content> part
let html = rawAnalysis.trim();
// Remove opening code fence (handles: \`\`\`html, \`\`\`HTML, \`\`\` etc.)
html = html.replace(/^\`\`\`[a-zA-Z]*\\s*/m, '');
// Remove closing code fence
html = html.replace(/\\s*\`\`\`\\s*$/m, '');
html = html.trim();

// ── STEP 2: Strip <style> CSS blocks ─────────────────────────────────────────
// Claude sometimes adds CSS like: <style>body { font-family: Arial... }</style>
// We don't need CSS in emails or Google Docs — strip it all
html = html.replace(/<style[^>]*>[\\s\\S]*?<\\/style>/gi, '');

// ── STEP 3: Strip <html>, <head>, <body> wrapper tags ────────────────────────
// Keep content inside <body>, but remove the wrapper tags themselves
html = html.replace(/<head[^>]*>[\\s\\S]*?<\\/head>/gi, ''); // remove entire <head>
html = html.replace(/<\\/?html[^>]*>/gi, '');  // remove <html> and </html>
html = html.replace(/<\\/?body[^>]*>/gi, '');  // remove <body> and </body>
html = html.trim();

// This is now clean HTML — no code fence, no CSS, no wrapper tags
const analysisHtml = html;

// ── STEP 4: Convert HTML → Markdown (for ClickUp) ────────────────────────────
// ClickUp renders markdown: **bold**, # Heading, • bullets
// We convert our HTML tags into markdown equivalents
let md = html;
// Block elements first (order matters: process inner tags before outer)
md = md.replace(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/gi, (_, t) => '\\n# ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
md = md.replace(/<h2[^>]*>([\\s\\S]*?)<\\/h2>/gi, (_, t) => '\\n## ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
md = md.replace(/<h3[^>]*>([\\s\\S]*?)<\\/h3>/gi, (_, t) => '\\n### ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
md = md.replace(/<strong[^>]*>([\\s\\S]*?)<\\/strong>/gi, (_, t) => '**' + t.replace(/<[^>]+>/g, '') + '**');
md = md.replace(/<b[^>]*>([\\s\\S]*?)<\\/b>/gi, (_, t) => '**' + t.replace(/<[^>]+>/g, '') + '**');
md = md.replace(/<em[^>]*>([\\s\\S]*?)<\\/em>/gi, (_, t) => '*' + t.replace(/<[^>]+>/g, '') + '*');
md = md.replace(/<li[^>]*>([\\s\\S]*?)<\\/li>/gi, (_, t) => '• ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
md = md.replace(/<p[^>]*>([\\s\\S]*?)<\\/p>/gi, (_, t) => t.replace(/<[^>]+>/g, '') + '\\n\\n');
md = md.replace(/<br\\s*\\/?>/gi, '\\n');
md = md.replace(/<hr[^>]*>/gi, '\\n---\\n');
md = md.replace(/<[^>]+>/g, ''); // strip any remaining tags
md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
md = md.replace(/\\n{3,}/g, '\\n\\n').trim();
const analysisMarkdown = md;

// ── STEP 5: Convert HTML → Plain Text (fallback for Google Docs) ───────────────
let plain = html;
plain = plain.replace(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/gi, (_, t) => '\\n' + t.replace(/<[^>]+>/g, '').trim().toUpperCase() + '\\n' + '='.repeat(50) + '\\n');
plain = plain.replace(/<h2[^>]*>([\\s\\S]*?)<\\/h2>/gi, (_, t) => '\\n' + t.replace(/<[^>]+>/g, '').trim() + '\\n' + '-'.repeat(40) + '\\n');
plain = plain.replace(/<h3[^>]*>([\\s\\S]*?)<\\/h3>/gi, (_, t) => '\\n' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
plain = plain.replace(/<strong[^>]*>([\\s\\S]*?)<\\/strong>/gi, (_, t) => t.replace(/<[^>]+>/g, ''));
plain = plain.replace(/<li[^>]*>([\\s\\S]*?)<\\/li>/gi, (_, t) => '  • ' + t.replace(/<[^>]+>/g, '').trim() + '\\n');
plain = plain.replace(/<p[^>]*>([\\s\\S]*?)<\\/p>/gi, (_, t) => t.replace(/<[^>]+>/g, '') + '\\n\\n');
plain = plain.replace(/<br\\s*\\/?>/gi, '\\n');
plain = plain.replace(/<hr[^>]*>/gi, '\\n' + '─'.repeat(50) + '\\n');
plain = plain.replace(/<[^>]+>/g, '');
plain = plain.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
plain = plain.replace(/\\n{3,}/g, '\\n\\n').trim();
const analysisPlain = plain;

const taskName = \`SpyFu \${reportType} Report — \${date}\`;

return {
  taskName,
  reportType,
  date,
  analysisHtml,      // for email (clean HTML)
  analysisMarkdown,  // for ClickUp (markdown)
  analysisPlain,     // for Google Docs plain text fallback
  analysis: analysisHtml, // keep 'analysis' pointing to HTML (email node uses this)
  taskDescription: \`SpyFu \${reportType} Analysis — \${date}\\n\\n\${analysisMarkdown}\`,
};
`;
  console.log("✅ Fix 2: Format node updated — strips code fence, CSS, wrapper tags. Produces HTML + Markdown + Plain Text versions.");
}

// ── FIX 3: CLICKUP — USE MARKDOWN IN DESCRIPTION ─────────────────────────────
//
//  ClickUp renders markdown in task descriptions:
//  **bold** shows as bold, # Heading shows as a heading, • shows as bullet
//
//  We send the markdown version of the analysis.

const clickupIdx = workflow.nodes.findIndex((n: any) => n.name === "ClickUp: Create Analysis Task");
if (clickupIdx !== -1) {
  workflow.nodes[clickupIdx].parameters.body = [
    "={{ JSON.stringify({",
    "  \"name\": $('Format Report Output').first().json.taskName,",
    "  \"markdown_description\": $('Format Report Output').first().json.taskDescription,",
    "  \"priority\": 2",
    "}) }}",
  ].join("\n");
  console.log("✅ Fix 3: ClickUp — now sends markdown_description (renders as bold/headers/bullets)");
}

// ── FIX 4: GOOGLE DOCS — IMPORT HTML VIA DRIVE API ───────────────────────────
//
//  The current approach inserts raw text into a Google Doc.
//  The BETTER approach: tell Google Drive to CREATE a doc FROM the HTML file.
//
//  How it works:
//  - Google Drive has a feature: "upload an HTML file and convert it to a Google Doc"
//  - When you upload HTML to Drive and say mimeType = Google Doc, it auto-converts
//  - Headings become real Heading 1/2/3, bold becomes real bold, etc.
//
//  We do this by:
//  1. Replacing "Google Docs: Create Report" with a Drive API multipart upload
//     that creates the doc directly from our HTML content
//  2. Removing "Google Docs: Write Content" (no longer needed)
//
//  The multipart upload sends TWO pieces at once:
//    Part 1: the file metadata (name, type, folder)
//    Part 2: the actual HTML content
//  Google Drive handles the rest.

const BOUNDARY = "spyfu_report_v1";

// Replace the Google Docs: Create Report node with a Drive API create-from-HTML
const docsCreateIdx = workflow.nodes.findIndex((n: any) => n.name === "Google Docs: Create Report");
if (docsCreateIdx !== -1) {
  const oldPos = workflow.nodes[docsCreateIdx].position;
  workflow.nodes[docsCreateIdx] = {
    id: workflow.nodes[docsCreateIdx].id,
    name: "Google Drive: Create Formatted Doc",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: oldPos,
    parameters: {
      method: "POST",
      // uploadType=multipart means we send metadata + file content together
      url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleDocsOAuth2Api",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: "Content-Type",
            // boundary tells Google where one part ends and the next begins
            value: `multipart/related; boundary=${BOUNDARY}`,
          },
        ],
      },
      sendBody: true,
      contentType: "raw",
      rawContentType: `multipart/related; boundary=${BOUNDARY}`,
      // The body is two "parts" glued together with the boundary string
      // Part 1: metadata — tells Drive the file name, type, and folder
      // Part 2: content — the actual HTML that becomes the document
      body: [
        `={{ [`,
        `  '--${BOUNDARY}',`,
        `  'Content-Type: application/json; charset=UTF-8',`,
        `  '',`,
        `  JSON.stringify({`,
        `    name: $('Format Report Output').first().json.taskName,`,
        `    mimeType: 'application/vnd.google-apps.document',`,
        `    parents: ['${GOOGLE_DRIVE_FOLDER_ID}']`,
        `  }),`,
        `  '--${BOUNDARY}',`,
        `  'Content-Type: text/html; charset=UTF-8',`,
        `  '',`,
        `  '<html><body>' + $('Format Report Output').first().json.analysisHtml + '</body></html>',`,
        `  '--${BOUNDARY}--'`,
        `].join('\\r\\n') }}`,
      ].join("\n"),
      options: {},
    },
  };
  console.log("✅ Fix 4a: Replaced Google Docs: Create Report with Drive API multipart upload");
}

// Update connections: anything pointing to "Google Docs: Create Report" → now points to "Google Drive: Create Formatted Doc"
for (const [nodeName, conns] of Object.entries(workflow.connections) as any) {
  for (const branch of conns.main || []) {
    for (const conn of branch || []) {
      if (conn.node === "Google Docs: Create Report") {
        conn.node = "Google Drive: Create Formatted Doc";
      }
    }
  }
}
if (workflow.connections["Google Docs: Create Report"]) {
  workflow.connections["Google Drive: Create Formatted Doc"] = workflow.connections["Google Docs: Create Report"];
  delete workflow.connections["Google Docs: Create Report"];
}

// Remove the "Google Docs: Write Content" node — no longer needed
const docsWriteIdx = workflow.nodes.findIndex((n: any) => n.name === "Google Docs: Write Content");
if (docsWriteIdx !== -1) {
  workflow.nodes.splice(docsWriteIdx, 1);
  // Remove its connections too
  delete workflow.connections["Google Docs: Write Content"];
  // Also remove any reference to it from other nodes' outgoing connections
  for (const [nodeName, conns] of Object.entries(workflow.connections) as any) {
    for (const branch of conns.main || []) {
      for (let i = branch.length - 1; i >= 0; i--) {
        if (branch[i].node === "Google Docs: Write Content") {
          branch.splice(i, 1);
        }
      }
    }
  }
  console.log("✅ Fix 4b: Removed Google Docs: Write Content (no longer needed)");
}

// ── PUSH ALL FIXES BACK TO N8N ────────────────────────────────────────────────
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
  console.log("\n✅ All fixes saved to n8n!");
  console.log("\nFinal workflow nodes:");
  console.log("  " + putData.nodes.map((n: any) => n.name).join("\n  → "));
  console.log("\nWhat each destination will look like:");
  console.log("  📧 Email      → clean HTML (real headings, bold, bullets) — no code fence");
  console.log("  📋 ClickUp    → markdown rendered as formatted text (headers, bold, bullets)");
  console.log("  📄 Google Docs → properly formatted document (Drive converts HTML to Doc format)");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
