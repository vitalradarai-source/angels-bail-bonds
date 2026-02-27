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

const BACKFILL_WF_ID = "ZmIN72JrIyb4h1Ra";
const AUTO_WF_ID     = "EQGK7RD48l5CoYA8";

// ── PROJECT → CLICKUP LIST MAPPING ───────────────────────────────────────────
// Used inside n8n Code nodes as a serialised constant
const PROJECT_MAP_JSON = JSON.stringify([
  { keywords: ["angel", "bail bond", "abb"],               listId: "901414349243", name: "Angel's Bail Bonds" },
  { keywords: ["reenergized", "re-energized", "re energized", "reenergize"], listId: "901414349241", name: "ReEnergized" },
  { keywords: ["vital radar", "vitalradar", "vital"],       listId: "901414349248", name: "Vital Radar" },
  { keywords: ["bullion"],                                  listId: "901414349255", name: "BullionDealer" },
  { keywords: ["boundless"],                                listId: "901414349254", name: "Boundless Global" },
  { keywords: ["principal", "psc"],                         listId: "901414349261", name: "Principal Stones" },
]);

// ── CODE: EXTRACT ALL TABS (used in backfill, runOnceForAllItems) ─────────────
const CODE_EXTRACT_ALL_TABS = `
var PROJECT_MAP = ${PROJECT_MAP_JSON};

// ── helpers ─────────────────────────────────────────────────────────────────
function extractText(content) {
  var text = '';
  for (var i = 0; i < (content || []).length; i++) {
    var b = content[i];
    if (b.paragraph) {
      (b.paragraph.elements || []).forEach(function(el) {
        if (el.textRun) text += el.textRun.content || '';
      });
    } else if (b.table) {
      (b.table.tableRows || []).forEach(function(row) {
        (row.tableCells || []).forEach(function(cell) {
          (cell.content || []).forEach(function(cb) {
            if (cb.paragraph) {
              (cb.paragraph.elements || []).forEach(function(el) {
                if (el.textRun) text += el.textRun.content || '';
              });
            }
          });
        });
        text += '\\n';
      });
    }
  }
  return text.trim();
}

function matchProject(tabTitle) {
  var lower = (tabTitle || '').toLowerCase();
  for (var i = 0; i < PROJECT_MAP.length; i++) {
    var proj = PROJECT_MAP[i];
    for (var k = 0; k < proj.keywords.length; k++) {
      if (lower.indexOf(proj.keywords[k]) !== -1) return proj;
    }
  }
  return null;
}

function getAllTabs(tabs, result) {
  (tabs || []).forEach(function(tab) {
    result.push(tab);
    if (tab.childTabs) getAllTabs(tab.childTabs, result);
  });
  return result;
}

// ── process each doc ─────────────────────────────────────────────────────────
var docItems    = $input.all();
var filterItems = $('Code: Get Google Docs').all();
var output      = [];

for (var d = 0; d < docItems.length; d++) {
  var doc  = docItems[d].json;
  var meta = filterItems[d] ? filterItems[d].json : {};
  var date = meta.date || doc.title || ('doc-' + d);
  var allTabs = getAllTabs(doc.tabs || [], []);

  // Collect per-project content and Sean's Task content
  var projectContents = {};  // listId → text
  var projectNames    = {};  // listId → project name
  var seanTaskContent = '';

  allTabs.forEach(function(tab) {
    var title   = (tab.tabProperties && tab.tabProperties.title) ? tab.tabProperties.title : '';
    var content = (tab.documentTab && tab.documentTab.body && tab.documentTab.body.content)
                  ? tab.documentTab.body.content : [];
    var text    = extractText(content);
    if (!text) return;

    var lowerTitle = title.toLowerCase();

    // Sean's Task → store separately for cross-project classification
    if (lowerTitle.indexOf("sean") !== -1) {
      seanTaskContent = text;
      return;
    }

    // Meetings → skip (no dedicated ClickUp list)
    if (lowerTitle.indexOf("meeting") !== -1) return;

    var proj = matchProject(title);
    if (proj) {
      projectContents[proj.listId] = (projectContents[proj.listId] || '') + '\\n' + text;
      projectNames[proj.listId]    = proj.name;
    }
  });

  // Emit one item per project that has content
  PROJECT_MAP.forEach(function(proj) {
    var content = (projectContents[proj.listId] || '').trim();
    if (!content && !seanTaskContent) return;

    output.push({ json: {
      date:             date,
      project:          proj.name,
      listId:           proj.listId,
      projectContent:   content,
      seanTaskContent:  seanTaskContent,
      hasProjectTab:    !!content,
    }});
  });
}

if (output.length === 0) throw new Error('No project content found in any doc');
return output;
`.trim();

// ── CODE: EXTRACT ALL TABS SINGLE DOC (used in auto workflow) ────────────────
const CODE_EXTRACT_ALL_TABS_SINGLE = `
var PROJECT_MAP = ${PROJECT_MAP_JSON};

function extractText(content) {
  var text = '';
  for (var i = 0; i < (content || []).length; i++) {
    var b = content[i];
    if (b.paragraph) {
      (b.paragraph.elements || []).forEach(function(el) {
        if (el.textRun) text += el.textRun.content || '';
      });
    }
  }
  return text.trim();
}

function matchProject(tabTitle) {
  var lower = (tabTitle || '').toLowerCase();
  for (var i = 0; i < PROJECT_MAP.length; i++) {
    var proj = PROJECT_MAP[i];
    for (var k = 0; k < proj.keywords.length; k++) {
      if (lower.indexOf(proj.keywords[k]) !== -1) return proj;
    }
  }
  return null;
}

function getAllTabs(tabs, result) {
  (tabs || []).forEach(function(tab) {
    result.push(tab);
    if (tab.childTabs) getAllTabs(tab.childTabs, result);
  });
  return result;
}

var doc     = $input.first().json;
var date    = doc.title || 'unknown-date';
var allTabs = getAllTabs(doc.tabs || [], []);

var projectContents = {};
var projectNames    = {};
var seanTaskContent = '';

allTabs.forEach(function(tab) {
  var title   = (tab.tabProperties && tab.tabProperties.title) ? tab.tabProperties.title : '';
  var content = (tab.documentTab && tab.documentTab.body && tab.documentTab.body.content)
                ? tab.documentTab.body.content : [];
  var text    = extractText(content);
  if (!text) return;

  var lowerTitle = title.toLowerCase();
  if (lowerTitle.indexOf("sean") !== -1) { seanTaskContent = text; return; }
  if (lowerTitle.indexOf("meeting") !== -1) return;

  var proj = matchProject(title);
  if (proj) {
    projectContents[proj.listId] = (projectContents[proj.listId] || '') + '\\n' + text;
    projectNames[proj.listId]    = proj.name;
  }
});

var output = [];
PROJECT_MAP.forEach(function(proj) {
  var content = (projectContents[proj.listId] || '').trim();
  if (!content && !seanTaskContent) return;
  output.push({ json: {
    date: date, project: proj.name, listId: proj.listId,
    projectContent: content, seanTaskContent: seanTaskContent,
    hasProjectTab: !!content,
  }});
});

return output.length > 0 ? output : [{ json: { skip: true, date: date } }];
`.trim();

// ── CLAUDE BODY: format + check Sean's Task ───────────────────────────────────
const CLAUDE_BODY = `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": "You are organizing a daily progress report.\\n\\nPROJECT: " + $json.project + "\\nDATE: " + $json.date + "\\n\\n" +
      ($json.hasProjectTab
        ? "PROJECT TAB CONTENT:\\n" + $json.projectContent + "\\n\\n"
        : "No dedicated project tab found for this date.\\n\\n") +
      ($json.seanTaskContent
        ? "SEAN'S TASK TAB (check if any items belong to " + $json.project + "):\\n" + $json.seanTaskContent + "\\n\\n"
        : "") +
      "INSTRUCTIONS:\\n" +
      "1. Combine the project tab content with any relevant items from Sean's Task that belong to " + $json.project + "\\n" +
      "2. Remove exact duplicates\\n" +
      "3. Format as a clean markdown bullet list (- bullets)\\n" +
      "4. Exclude items that clearly belong to other projects\\n" +
      "5. If there is nothing for this project, output exactly: No activities recorded.\\n\\n" +
      "Output ONLY the bullet list. No intro, no headers, no project name."
  }]
}) }}`;

// ── CLICKUP BODY: create task with dynamic listId ────────────────────────────
const CLICKUP_BODY = `={{ JSON.stringify({
  "name": $('Code: Extract All Tabs').item.json.date,
  "markdown_description": $json.content[0].text
}) }}`;

const CLICKUP_BODY_AUTO = `={{ JSON.stringify({
  "name": $('Code: Extract All Project Tabs').item.json.date,
  "markdown_description": $json.content[0].text
}) }}`;

// ── FETCH / SAVE HELPERS ─────────────────────────────────────────────────────
async function getWorkflow(id: string) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${id}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Fetch failed: ${JSON.stringify(data)}`);
  return data;
}

async function saveWorkflow(wf: any) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${wf.id}`, {
    method: "PUT",
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: wf.name, nodes: wf.nodes, connections: wf.connections,
      settings: wf.settings, staticData: wf.staticData ?? null,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Save failed: ${JSON.stringify(data)}`);
  return data;
}

// ═════════════════════════════════════════════════════════════════════════════
// FIX WORKFLOW 1 — BACKFILL
// ═════════════════════════════════════════════════════════════════════════════
console.log("Updating Workflow 1 (Backfill) for all projects...");
const wf1 = await getWorkflow(BACKFILL_WF_ID);

// Update "Docs: Read Content" — already has includeTabsContent=true from previous fix
const readDocIdx = wf1.nodes.findIndex((n: any) => n.name === "Docs: Read Content");
if (readDocIdx !== -1) {
  wf1.nodes[readDocIdx].parameters.url =
    "=https://docs.googleapis.com/v1/documents/{{ $json.docId }}?includeTabsContent=true";
}

// Replace "Code: Extract Text by Date" with all-tabs extractor
const extractIdx = wf1.nodes.findIndex((n: any) => n.name === "Code: Extract Text by Date");
if (extractIdx !== -1) {
  wf1.nodes[extractIdx].parameters.jsCode = CODE_EXTRACT_ALL_TABS;
  console.log("  ✅ Code: Extract Text by Date → extracts ALL project tabs + Sean's Task");
}

// Update Claude node — now formats per project and checks Sean's Task
const claudeIdx = wf1.nodes.findIndex((n: any) => n.name === "Claude: Filter Angel Tasks");
if (claudeIdx !== -1) {
  wf1.nodes[claudeIdx].parameters.body = CLAUDE_BODY;
  console.log("  ✅ Claude: Filter Angel Tasks → formats per project, classifies Sean's Task");
}

// Update ClickUp node — uses dynamic listId from the extract node
const clickupIdx = wf1.nodes.findIndex((n: any) => n.name === "ClickUp: Create Daily Task");
if (clickupIdx !== -1) {
  wf1.nodes[clickupIdx].parameters.url =
    `=https://api.clickup.com/api/v2/list/{{ $('Code: Extract Text by Date').item.json.listId }}/task`;
  wf1.nodes[clickupIdx].parameters.body = CLICKUP_BODY;
  console.log("  ✅ ClickUp: Create Daily Task → dynamic listId per project");
}

await saveWorkflow(wf1);
console.log("  ✅ Workflow 1 saved\n");

// ═════════════════════════════════════════════════════════════════════════════
// FIX WORKFLOW 3 — AUTO
// ═════════════════════════════════════════════════════════════════════════════
console.log("Updating Workflow 3 (Auto) for all projects...");
const wf3 = await getWorkflow(AUTO_WF_ID);

// Update "Drive: List Progress Files" to read doc with all tabs
const readSingleIdx = wf3.nodes.findIndex((n: any) => n.name === "Drive: List Progress Files");
if (readSingleIdx !== -1) {
  wf3.nodes[readSingleIdx].parameters.url =
    "=https://docs.googleapis.com/v1/documents/{{ $json.id }}?includeTabsContent=true";
}

// Replace single-tab extractor with all-tabs version, rename for clarity
const extractSingleIdx = wf3.nodes.findIndex((n: any) => n.name === "Code: Extract Single Doc Text");
if (extractSingleIdx !== -1) {
  wf3.nodes[extractSingleIdx].name = "Code: Extract All Project Tabs";
  wf3.nodes[extractSingleIdx].parameters.jsCode = CODE_EXTRACT_ALL_TABS_SINGLE;
  console.log("  ✅ Code: Extract Single Doc Text → renamed & updated for all projects");

  // Also fix connection that referenced old name
  if (wf3.connections["Code: Extract Single Doc Text"]) {
    wf3.connections["Code: Extract All Project Tabs"] = wf3.connections["Code: Extract Single Doc Text"];
    delete wf3.connections["Code: Extract Single Doc Text"];
  }
}

// Update Claude node
const claudeAutoIdx = wf3.nodes.findIndex((n: any) => n.name === "Claude: Filter Angel Tasks");
if (claudeAutoIdx !== -1) {
  wf3.nodes[claudeAutoIdx].parameters.body = `={{ JSON.stringify({
  "model": "${ANTHROPIC_MODEL}",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": "Organize daily progress for " + $json.project + " on " + $json.date + ".\\n\\n" +
      ($json.hasProjectTab ? "PROJECT TAB:\\n" + $json.projectContent + "\\n\\n" : "") +
      ($json.seanTaskContent ? "SEAN'S TASK TAB (check for " + $json.project + " items):\\n" + $json.seanTaskContent + "\\n\\n" : "") +
      "Remove duplicates. Markdown bullet list only. If nothing for this project: No activities recorded."
  }]
}) }}`;
  console.log("  ✅ Claude node updated for all projects");
}

// Update ClickUp node — dynamic listId
const clickupAutoIdx = wf3.nodes.findIndex((n: any) => n.name === "ClickUp: Create Daily Task");
if (clickupAutoIdx !== -1) {
  wf3.nodes[clickupAutoIdx].parameters.url =
    `=https://api.clickup.com/api/v2/list/{{ $('Code: Extract All Project Tabs').item.json.listId }}/task`;
  wf3.nodes[clickupAutoIdx].parameters.body = CLICKUP_BODY_AUTO;
  console.log("  ✅ ClickUp node → dynamic listId per project");
}

await saveWorkflow(wf3);
console.log("  ✅ Workflow 3 saved\n");

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Both workflows updated for ALL projects!

WHAT HAPPENS PER GOOGLE DOC (per date):
  Each doc's tabs are read and matched to ClickUp lists:

  Tab                 → ClickUp List
  ─────────────────────────────────────
  Angel's Bail Bond   → 901414349243
  ReEnergized         → 901414349241
  Vital Radar         → 901414349248
  BullionDealer       → 901414349255
  Boundless Global    → 901414349254
  Principal Stones    → 901414349261
  Sean's Task         → Claude classifies → correct project
  Meetings            → skipped

  Result: one ClickUp task per project per date,
          content in description (not comments)

Run backfill: ${N8N_BASE_URL}/workflow/${BACKFILL_WF_ID}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
