import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;
const WORKFLOW_ID  = "ZmIN72JrIyb4h1Ra"; // Angel Bail Bonds — Daily Progress Backfill

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const wf = await getRes.json();
if (!getRes.ok) { console.error("❌", wf); process.exit(1); }
console.log(`✅ Fetched: ${wf.name}`);

console.log("\nCurrent nodes:");
wf.nodes.forEach((n: any) => console.log(`  "${n.name}" [${n.type.split('.')[1]}]`));

// ── 1. Update Claude node — extract actual dates + categories ─────────────────
const claudeIdx = wf.nodes.findIndex((n: any) =>
  n.name.toLowerCase().includes("claude")
);
if (claudeIdx === -1) { console.error("❌ Claude node not found"); process.exit(1); }

const claudeNodeName = wf.nodes[claudeIdx].name;
console.log(`\nUpdating Claude node: "${claudeNodeName}"`);

// The Claude node body expression — update to return dates with categories
const currentBody = wf.nodes[claudeIdx].parameters.body as string;

// Rebuild the body with updated prompt
wf.nodes[claudeIdx].parameters.body = `={{ JSON.stringify({
  "model": "${process.env.ANTHROPIC_MODEL || 'claude-opus-4-6'}",
  "max_tokens": 4096,
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "Project: " + $json.projectName + "\\nList ID: " + $json.listId + "\\n\\n=== PROJECT TAB CONTENT ===\\n" + $json.tabContent + "\\n\\n=== SEAN'S TASK TAB (cross-reference) ===\\n" + ($json.seanTaskContent || '(none)') + "\\n\\nExtract all tasks for " + $json.projectName + " organized by actual date.\\n\\nIMPORTANT:\\n- Use the actual dates written INSIDE the document (MM/DD/YYYY format) — NOT the document filename\\n- A single document may contain entries for multiple different dates\\n- The content is organized into sections: Completed, In Progress, To-do, Blockage, Questions and Suggestions\\n- Include any tasks from Sean's Task tab that belong to this project\\n- Skip empty sections\\n\\nReturn ONLY valid JSON (no markdown, no code fences):\\n{\\n  \\"projectName\\": \\"...(project name)\\",\\n  \\"listId\\": \\"...(list id)\\",\\n  \\"dates\\": [\\n    {\\n      \\"date\\": \\"MM/DD/YYYY\\",\\n      \\"completed\\": [\\"task 1\\", \\"task 2\\"],\\n      \\"inProgress\\": [\\"task 3\\"],\\n      \\"todo\\": [],\\n      \\"blockage\\": [],\\n      \\"questionsSuggestions\\": []\\n    }\\n  ]\\n}"
      }
    ]
  }]
}) }}`;

console.log("✅ Claude prompt updated — extracts actual dates with categories");

// ── 2. Add "Code: Split by Date" node after Claude ────────────────────────────
const clickupNode = wf.nodes.find((n: any) =>
  n.name.toLowerCase().includes("clickup")
);
const splitNodeName = "Code: Split by Date";

// Remove existing split node if any
const existingSplitIdx = wf.nodes.findIndex((n: any) => n.name === splitNodeName);
if (existingSplitIdx !== -1) wf.nodes.splice(existingSplitIdx, 1);

const splitNode = {
  id: "code-split-by-date",
  name: splitNodeName,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [
    Math.round((wf.nodes[claudeIdx].position[0] + clickupNode.position[0]) / 2),
    wf.nodes[claudeIdx].position[1],
  ],
  parameters: {
    mode: "runOnceForAllItems",
    jsCode: `
// Split Claude's response (which covers one doc+project) into one item per actual date.
// Each item: { date, projectName, listId, completed, inProgress, todo, blockage, questionsSuggestions }
var results = [];

for (var item of $input.all()) {
  // Claude returns content as an array of text blocks
  var text = '';
  try {
    var content = item.json.message?.content || item.json.content || [];
    text = content[0]?.text || JSON.stringify(item.json);
  } catch(e) {
    text = JSON.stringify(item.json);
  }

  // Extract JSON from Claude's text response
  var claudeData;
  try {
    var jsonMatch = text.match(/\\{[\\s\\S]*\\}/);
    claudeData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch(e) {
    console.log('Parse error for: ' + text.slice(0, 200));
    claudeData = {};
  }

  var projectName = claudeData.projectName || 'Unknown Project';
  var listId      = claudeData.listId || '';
  var dates       = claudeData.dates || [];

  if (dates.length === 0) {
    console.log('No dates found for project: ' + projectName);
    continue;
  }

  for (var d of dates) {
    if (!d.date) continue;

    // Build markdown description with categories
    var lines = [];
    if (d.completed && d.completed.length > 0) {
      lines.push('**Completed:**');
      for (var t of d.completed) lines.push('- ' + t);
      lines.push('');
    }
    if (d.inProgress && d.inProgress.length > 0) {
      lines.push('**In Progress:**');
      for (var t of d.inProgress) lines.push('- ' + t);
      lines.push('');
    }
    if (d.todo && d.todo.length > 0) {
      lines.push('**To-do:**');
      for (var t of d.todo) lines.push('- ' + t);
      lines.push('');
    }
    if (d.blockage && d.blockage.length > 0) {
      lines.push('**Blockage:**');
      for (var t of d.blockage) lines.push('- ' + t);
      lines.push('');
    }
    if (d.questionsSuggestions && d.questionsSuggestions.length > 0) {
      lines.push('**Questions & Suggestions:**');
      for (var t of d.questionsSuggestions) lines.push('- ' + t);
      lines.push('');
    }

    results.push({
      json: {
        date: d.date,
        projectName: projectName,
        listId: listId,
        description: lines.join('\\n').trim(),
      }
    });
  }
}

console.log('Split into ' + results.length + ' date items');
return results;
`.trim(),
  },
};

wf.nodes.push(splitNode);
console.log("✅ Added 'Code: Split by Date' node");

// ── 3. Update ClickUp node to use $json.date and $json.description ────────────
const clickupIdx = wf.nodes.findIndex((n: any) =>
  n.name.toLowerCase().includes("clickup")
);
wf.nodes[clickupIdx].parameters.url =
  `=https://api.clickup.com/api/v2/list/{{ $json.listId }}/task`;
wf.nodes[clickupIdx].parameters.body =
  `={{ JSON.stringify({
  "name": $json.date,
  "markdown_description": $json.description
}) }}`;
console.log(`✅ ClickUp node updated — uses $json.date and $json.description`);

// ── 4. Update connections — Claude → Split → ClickUp ─────────────────────────
// Find what Claude connects to currently
const claudeName = wf.nodes[claudeIdx].name;
const clickupName = wf.nodes[clickupIdx].name;

// Insert split node between Claude and ClickUp
wf.connections[claudeName] = {
  main: [[{ node: splitNodeName, type: "main", index: 0 }]],
};
wf.connections[splitNodeName] = {
  main: [[{ node: clickupName, type: "main", index: 0 }]],
};
console.log(`✅ Connections: ${claudeName} → ${splitNodeName} → ${clickupName}`);

// ── 5. Deactivate + save ──────────────────────────────────────────────────────
await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/deactivate`, {
  method: "POST", headers: { "X-N8N-API-KEY": N8N_API_KEY },
});

const putRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings, staticData: wf.staticData ?? null,
  }),
});
const putData = await putRes.json();
if (putRes.ok) console.log("✅ Saved — ready to run");
else console.error("❌ Save failed:", JSON.stringify(putData, null, 2));
