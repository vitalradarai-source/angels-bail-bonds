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

const CLICKUP_LIST_ID = "901414349243";
const GDRIVE_CRED     = { id: "9pLcah8bZziqZuRW", name: "4434 lifeline Google Drive account" };
const GDOCS_CRED      = { id: "NHKmASipLi8Aa6OM", name: "4434 Google Docs account" };

// Workflow IDs to fix
const BACKFILL_WF_ID = "ZmIN72JrIyb4h1Ra";
const AUTO_WF_ID     = "EQGK7RD48l5CoYA8";

// ── EXTRACT TEXT FROM A SPECIFIC TAB ─────────────────────────────────────────
// Google Docs API with includeTabsContent=true returns:
//   doc.tabs[] → each tab has tabProperties.title and documentTab.body.content
// We find the tab named "Angel's Bail Bond" (case-insensitive) and extract its text.

const CODE_EXTRACT_TAB = `
function extractText(content) {
  var text = '';
  for (var i = 0; i < content.length; i++) {
    var b = content[i];
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

// Also handle nested tabs (tabs can have child tabs)
function findTabByName(tabs, targetName) {
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    var title = (tab.tabProperties && tab.tabProperties.title) ? tab.tabProperties.title.toLowerCase() : '';
    if (title.indexOf('angel') !== -1 || title.indexOf('bail bond') !== -1 || title.indexOf('abb') !== -1) {
      return tab;
    }
    // Check child tabs
    if (tab.childTabs && tab.childTabs.length > 0) {
      var found = findTabByName(tab.childTabs, targetName);
      if (found) return found;
    }
  }
  return null;
}

var docItems    = $input.all();
var filterItems = $('Code: Get Google Docs').all();
var results     = [];

for (var i = 0; i < docItems.length; i++) {
  var doc      = docItems[i].json;
  var metaJson = filterItems[i] ? filterItems[i].json : {};
  var date     = metaJson.date || doc.title || ('doc-' + i);
  var tabs     = doc.tabs || [];

  // Find the Angel's Bail Bond tab
  var abbTab = findTabByName(tabs, 'angel');

  if (!abbTab) {
    // No ABB tab found — skip this doc silently
    continue;
  }

  var tabContent = abbTab.documentTab && abbTab.documentTab.body && abbTab.documentTab.body.content
    ? abbTab.documentTab.body.content
    : [];

  var text = extractText(tabContent);

  if (!text || text.length < 5) continue; // skip empty tabs

  results.push({ json: { date: date, content: text } });
}

if (results.length === 0) {
  throw new Error("No docs had an Angel's Bail Bond tab with content");
}

// Sort by date
results.sort(function(a, b) { return a.json.date.localeCompare(b.json.date); });
return results;
`.trim();

// Same extraction logic but for a single doc (used in auto workflow)
const CODE_EXTRACT_TAB_SINGLE = `
function extractText(content) {
  var text = '';
  for (var i = 0; i < content.length; i++) {
    var b = content[i];
    if (b.paragraph) {
      var elems = b.paragraph.elements || [];
      for (var j = 0; j < elems.length; j++) {
        if (elems[j].textRun) text += elems[j].textRun.content || '';
      }
    }
  }
  return text.trim();
}

function findAbbTab(tabs) {
  for (var i = 0; i < tabs.length; i++) {
    var tab   = tabs[i];
    var title = (tab.tabProperties && tab.tabProperties.title) ? tab.tabProperties.title.toLowerCase() : '';
    if (title.indexOf('angel') !== -1 || title.indexOf('bail bond') !== -1) return tab;
    if (tab.childTabs) {
      var found = findAbbTab(tab.childTabs);
      if (found) return found;
    }
  }
  return null;
}

var doc    = $input.first().json;
var date   = doc.title || 'unknown-date';
var abbTab = findAbbTab(doc.tabs || []);

if (!abbTab) {
  return [{ json: { skip: true, date: date, message: "No Angel's Bail Bond tab found" } }];
}

var content = abbTab.documentTab && abbTab.documentTab.body && abbTab.documentTab.body.content
  ? abbTab.documentTab.body.content : [];

var text = extractText(content);
return [{ json: { date: date, content: text } }];
`.trim();

async function getWorkflow(id: string) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${id}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to fetch workflow ${id}: ${JSON.stringify(data)}`);
  return data;
}

async function saveWorkflow(wf: any) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${wf.id}`, {
    method: "PUT",
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
      staticData: wf.staticData ?? null,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to save workflow ${wf.id}: ${JSON.stringify(data)}`);
  return data;
}

// ── FIX WORKFLOW 1 (BACKFILL) ─────────────────────────────────────────────────
console.log("Fixing Workflow 1 (Backfill)...");
const wf1 = await getWorkflow(BACKFILL_WF_ID);

// 1a. Update "Docs: Read Content" to include all tabs content
const readDocIdx = wf1.nodes.findIndex((n: any) => n.name === "Docs: Read Content");
if (readDocIdx !== -1) {
  wf1.nodes[readDocIdx].parameters.url =
    "=https://docs.googleapis.com/v1/documents/{{ $json.docId }}?includeTabsContent=true";
  console.log("  ✅ Docs: Read Content → added includeTabsContent=true");
}

// 1b. Replace "Code: Extract Text by Date" with tab-aware extraction
const extractIdx = wf1.nodes.findIndex((n: any) => n.name === "Code: Extract Text by Date");
if (extractIdx !== -1) {
  wf1.nodes[extractIdx].parameters.jsCode = CODE_EXTRACT_TAB;
  console.log("  ✅ Code: Extract Text by Date → now extracts Angel's Bail Bond tab only");
}

// 1c. Remove the Claude filter node — no longer needed (tab is already filtered)
//     Instead, wire Extract Text directly to ClickUp Create Task
//     Update ClickUp node to read content directly (not from Claude)
const claudeIdx = wf1.nodes.findIndex((n: any) => n.name === "Claude: Filter Angel Tasks");
if (claudeIdx !== -1) {
  // Repurpose Claude node to format/clean the content instead of filter
  wf1.nodes[claudeIdx].parameters.body = `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": "Clean and format this daily progress report for Angel's Bail Bonds.\\n\\nDATE: " + $json.date + "\\n\\nCONTENT:\\n" + $json.content + "\\n\\nRules:\\n1. Remove duplicate entries\\n2. Format as a clean markdown bullet list (- bullets)\\n3. Keep all tasks as-is, just clean up formatting\\n4. If content is empty or only whitespace, output: No activities recorded.\\n\\nOutput ONLY the bullet list. No intro, no headers."
  }]
}) }}`;
  console.log("  ✅ Claude node → repurposed to clean/format (not filter)");
}

// 1d. Fix ClickUp node to use correct date reference
const clickupIdx = wf1.nodes.findIndex((n: any) => n.name === "ClickUp: Create Daily Task");
if (clickupIdx !== -1) {
  wf1.nodes[clickupIdx].parameters.body = `={{ JSON.stringify({
  "name": $('Code: Extract Text by Date').item.json.date,
  "markdown_description": $json.content[0].text
}) }}`;
  console.log("  ✅ ClickUp: Create Daily Task → date reference fixed");
}

await saveWorkflow(wf1);
console.log("  ✅ Workflow 1 saved\n");

// ── FIX WORKFLOW 3 (AUTO) ─────────────────────────────────────────────────────
console.log("Fixing Workflow 3 (Auto)...");
const wf3 = await getWorkflow(AUTO_WF_ID);

// 3a. Update "Drive: List Progress Files" node — it was incorrectly set to Google Docs URL
//     In the auto workflow, this node reads the newly added doc (trigger gives us the file ID)
const readSingleIdx = wf3.nodes.findIndex((n: any) => n.name === "Drive: List Progress Files");
if (readSingleIdx !== -1) {
  wf3.nodes[readSingleIdx].parameters.url =
    "=https://docs.googleapis.com/v1/documents/{{ $json.id }}?includeTabsContent=true";
  wf3.nodes[readSingleIdx].credentials = { googleDocsOAuth2Api: GDOCS_CRED };
  wf3.nodes[readSingleIdx].parameters.nodeCredentialType = "googleDocsOAuth2Api";
  console.log("  ✅ Drive: List Progress Files → reads new doc with tabs");
}

// 3b. Update extract code to be tab-aware
const extractSingleIdx = wf3.nodes.findIndex((n: any) => n.name === "Code: Extract Single Doc Text");
if (extractSingleIdx !== -1) {
  wf3.nodes[extractSingleIdx].parameters.jsCode = CODE_EXTRACT_TAB_SINGLE;
  console.log("  ✅ Code: Extract Single Doc Text → tab-aware extraction");
}

// 3c. Update Claude to clean/format instead of filter
const claudeAutoIdx = wf3.nodes.findIndex((n: any) => n.name === "Claude: Filter Angel Tasks");
if (claudeAutoIdx !== -1) {
  wf3.nodes[claudeAutoIdx].parameters.body = `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": "Clean and format this daily Angel's Bail Bonds progress report.\\n\\nDATE: " + $json.date + "\\n\\nCONTENT:\\n" + $json.content + "\\n\\nRules:\\n1. Remove duplicate entries\\n2. Format as a clean markdown bullet list (- bullets)\\n3. Keep all tasks as written, just clean formatting\\n4. If empty, output: No activities recorded.\\n\\nOutput ONLY the bullet list."
  }]
}) }}`;
  console.log("  ✅ Claude node → clean/format only");
}

await saveWorkflow(wf3);
console.log("  ✅ Workflow 3 saved\n");

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Both workflows updated!

KEY CHANGE: Now reads the "Angel's Bail Bond" tab directly
from each Google Doc — no more full-doc filtering.

Run the backfill: ${N8N_BASE_URL}/workflow/${BACKFILL_WF_ID}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
