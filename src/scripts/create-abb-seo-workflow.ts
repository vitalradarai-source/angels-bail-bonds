/**
 * Angels Bail Bonds — SEO Content Generator Workflow
 *
 * Creates an n8n workflow that:
 *  1. Reads keywords from ABB Google Sheets (Keyword Inventory + SERPROBOT rankings)
 *  2. Fetches related keyword suggestions from DataForSEO
 *  3. Scores keywords using volume, KD, and SERPROBOT rank opportunities
 *  4. Generates YMYL / EEAT-quality bail bonds blog content via Claude
 *  5. Posts as a draft to WordPress and writes status back to Google Sheets
 *
 * Google Sheets used:
 *  - Sheet1 (Keywords used in drafts):  1I3YIGuO13tc8ElRhZyQHmgj04m3NVBkmvC_iouM3XHo
 *  - Sheet3 (Keyword Inventory):        139W8Bw6F9-ujDi3eEFw77RzMZYd6fQEO7kUZbLshNYA
 *  - Sheet4 (Keyword bank / SERPROBOT): 1qsR83Vg7R-yatxuQGAwlzCamWdImbY5sl3Jd6107fHs
 */

import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;

// ── Sheet IDs ──────────────────────────────────────────────────────────────
const SHEET_DRAFTS_CHECKLIST = '1I3YIGuO13tc8ElRhZyQHmgj04m3NVBkmvC_iouM3XHo';
const SHEET_KEYWORD_INVENTORY = '139W8Bw6F9-ujDi3eEFw77RzMZYd6fQEO7kUZbLshNYA';
const SHEET_KEYWORD_BANK      = '1qsR83Vg7R-yatxuQGAwlzCamWdImbY5sl3Jd6107fHs';

// ── WordPress ──────────────────────────────────────────────────────────────
// TODO: Replace with the actual Angels Bail Bonds WordPress URL
const WP_URL = 'https://angelsbailbonds.com';

// ── Helpers ────────────────────────────────────────────────────────────────
async function n8nPost(path: string, body: object) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1${path}`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

// ── Bail Bonds System Prompts ──────────────────────────────────────────────

const PROMPT_TOC_SYSTEM = `You are an SEO content strategist specializing in bail bonds and legal services — a YMYL (Your Money or Your Life) niche requiring high E-E-A-T signals.

Your task is to create a clear, SEO-friendly table of contents for a bail bonds blog article based on a target keyword.

Guidelines:
- Structure content for stressed families or individuals who urgently need bail bond information
- Prioritize practical, actionable sections (e.g. "How to get a bail bond in under 2 hours", "What documents you need")
- Always include a local element when the keyword is location-specific (e.g. City of Industry, Hermosa Beach)
- Include sections that build trust and authority: licensing, years in service, 24/7 availability
- Include a FAQ section if appropriate — matches PAA (People Also Ask) search intent
- 4–6 sections total, no overlap
- Use clear, natural H2 headings that match search intent
- Avoid fluff sections; every section must deliver value to someone in a bail emergency`;

const PROMPT_TOC_USER = `Create a table of contents for a bail bonds blog article targeting:

Primary keyword: {{ $json["Suggested Keyword"] }}
Seed keyword: {{ $json["Keyword"] }}
Search volume: {{ $json["Search Volume"] }}
Competition level: {{ $json["Competition"] }}
SERPROBOT current rank: {{ $json["serprobot_rank"] }}

Requirements:
- 4–6 sections, no duplicates
- Align with emergency / local service search intent
- Structure must support a comprehensive, trustworthy article about bail bonds in California
- Return as a JSON array: { "blogSections": [{ "title": "...", "description": "..." }, ...] }`;

const PROMPT_CONTENT_SYSTEM = `You are an expert bail bonds content writer producing YMYL content for Angels Bail Bonds — a licensed, family-owned California bail bond agency serving communities since 1958.

Your content must meet Google's E-E-A-T standards:
- **Experience**: Write as if from a licensed bail agent who has handled thousands of cases
- **Expertise**: Cite California bail laws (Penal Code §§ 1268–1306), industry regulations, and accurate bail bond fee structures (typically 10% non-refundable premium)
- **Authoritativeness**: Reference credible sources (CA Courts, CDOI, DBO, county sheriff departments)
- **Trustworthiness**: Be transparent about costs, timelines, and what clients should expect

Content rules:
- Address the urgent, emotional state of the reader — they are scared and need clear guidance
- Always mention: 24/7 availability, licensed bail agent, fast release times
- Local SEO: use location-specific details (sheriff station addresses, court information) when available
- Avoid keyword stuffing; write naturally for humans first
- Include at least one inline link per section (to authoritative sources)
- Format in clean HTML with proper H2/H3/P tags`;

const PROMPT_CONTENT_USER = `Write the content for this bail bonds blog article section:

Section Title: {{ $json.title }}
Section Description: {{ $json.description }}

Requirements:
- 200–350 words for standard sections; 400–500 for core "how it works" sections
- Include accurate bail bond facts (10% premium, CA law references where applicable)
- Write for someone urgently searching for bail bond help in California
- End each section with a subtle call-to-action or trust signal
- Cite at least one authoritative source (CA courts, CDOI, sheriff dept, etc.)`;

const PROMPT_EDITOR_SYSTEM = `You are an expert bail bonds content editor at Angels Bail Bonds.

You receive a list of section titles and content blocks. Your job is to assemble them into a polished, publication-ready HTML blog article.

Rules:
- Wrap each section in proper H2 headings + paragraphs
- Add a compelling intro paragraph before the first section (2–3 sentences, urgency + trust)
- Add at least one inline hyperlink per section (to a cited source)
- Ensure smooth transitions between sections
- Keep the tone: urgent yet reassuring, professional, compassionate
- Final word count target: 1,200–1,800 words
- Output clean HTML only (no markdown, no commentary)`;

const PROMPT_EEAT_SYSTEM = `You are an E-E-A-T enhancement specialist for bail bonds content — a YMYL niche with strict quality standards.

Given a draft bail bonds article, you will:

1. **"From Experience" Block**: Write 3–5 sentences from the perspective of a licensed California bail agent with 20+ years of experience. Make it personal, authentic, and empathetic to families in crisis.

2. **Sources List**: Extract and list all sources cited in the article. Add 2–3 additional high-authority sources:
   - CA Department of Insurance: https://www.insurance.ca.gov/
   - CA Courts bail information: https://www.courts.ca.gov/
   - CA Penal Code bail sections: https://leginfo.legislature.ca.gov/

3. **Author Footer**: Create a bio for:
   "Angel Ferrer — Licensed California Bail Agent | Angels Bail Bonds | CA DOI License #[license] | Serving communities since 1958 | Available 24/7: (xxx) xxx-xxxx"
   Use placeholders for specific numbers the client should fill in.

4. **Fact-Check Summary**: Verify these bail bonds facts are correctly stated in the article:
   - Bail bond premium: 10% of the full bail amount (non-refundable, set by CA law)
   - Bail bond agents are licensed by the CA Department of Insurance
   - Angels Bail Bonds has been serving since 1958
   - Service is available 24/7
   Flag any errors or missing trust signals.

Return clearly labeled sections: FROM_EXPERIENCE, SOURCES, AUTHOR_FOOTER, FACT_CHECK.`;

const PROMPT_EDITOR2_SYSTEM = `You are the final editor for Angels Bail Bonds blog content.

Assemble the article + EEAT enhancements into one clean, professional HTML article ready for WordPress:
- "From Experience" block appears after the intro paragraph
- All cited sources in a <h2>Sources</h2> section at the end
- Author footer as an <aside> or <div class="author-bio"> at the very end
- Clean semantic HTML: h1 (title), h2 (sections), h3 (subsections), p (paragraphs), ul/ol (lists), a (links)
- No system prompt text, no labels, no commentary — just clean HTML
- Preserve all inline links from the content editor`;

const PROMPT_META_SYSTEM = `You are an SEO metadata specialist for bail bonds content.

Given the blog title and content, generate:
1. slug: SEO-friendly URL (lowercase, dashes, no stop words, include location if present)
2. metaTitle: Max 60 characters — include primary keyword + "Angels Bail Bonds" or location
3. metaDescription: Max 160 characters — compelling, includes keyword + call-to-action
4. focusKeyword: The single most important keyword for this article
5. keywords: 5–8 keywords array

Output as clean JSON.`;

const PROMPT_IMAGE_SYSTEM = `You are a visual content specialist for a bail bonds agency.

Given the article title and content, generate:
1. imagePrompt: Vivid DALL-E prompt — professional, trustworthy imagery.
   Style: realistic photo-illustration, modern, warm lighting.
   Subject ideas: courthouse exterior at dawn, family outside a jail, a trusted bail agent on the phone, California skyline with a courthouse.
   Avoid: anything that looks criminal, mugshots, handcuffs, prison bars.
2. altText: Max 20 words, descriptive, includes keyword.

Output as JSON.`;

// ── Scoring Code (replaces existing "Code in JavaScript") ─────────────────
const SCORING_CODE = `// Angels Bail Bonds — Keyword Opportunity Scorer
// Input: items with Suggested Keyword, Search Volume, CPC, Competition, serprobot_rank
// Output: same items + score (higher = better content opportunity)

function toNum(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function kdPenalty(kd) {
  // KD 0-20 = easy, 21-40 = moderate, 41-60 = hard, 61+ = very hard
  if (kd <= 20) return 1.0;
  if (kd <= 40) return 0.7;
  if (kd <= 60) return 0.45;
  return 0.2;
}
function rankBonus(rank) {
  // rank 0 = not tracked, 1-4 = already winning, 5-15 = opportunity, 16-30 = reachable, 31+ = long shot
  if (!rank || rank === 0) return 0.8;  // not tracked — medium opportunity
  if (rank >= 1 && rank <= 4)  return 0.1; // already ranking — low priority
  if (rank >= 5 && rank <= 15) return 1.5; // near top — high opportunity
  if (rank >= 16 && rank <= 30) return 1.2; // reachable
  return 0.6; // too far back
}
function compWeight(comp) {
  const c = String(comp ?? '').toUpperCase().trim();
  if (c === 'LOW')    return 1.0;
  if (c === 'MEDIUM') return 0.6;
  if (c === 'HIGH')   return 0.25;
  return 0.5;
}

const items = $input.all();
const scored = items.map(item => {
  const vol  = toNum(item.json['Search Volume']);
  const kd   = toNum(item.json['kd'] || 0);
  const rank = toNum(item.json['serprobot_rank'] || 0);
  const comp = item.json['Competition'] || '';
  const score = vol * kdPenalty(kd) * rankBonus(rank) * compWeight(comp);
  return { ...item, json: { ...item.json, score: Math.round(score) } };
});

return scored;`;

// ── Enrichment Code (new node — merges Sheet3 keywords + Sheet4 SERPROBOT) ─
const ENRICH_CODE = `// Merge Keyword Inventory (Sheet3) + SERPROBOT Rankings (Sheet4)
// Input stream 1: Sheet3 rows (Keyword, Volume, KD, Presence in SERPROBOT List?)
// Input stream 2: Sheet4 rows (Keyword, Latest rank, L-Vol, G-Vol)

const inventoryItems = $input.all(); // All come through as a flat stream after Merge node

// Separate by which stream they came from using a flag field
// Sheet3 rows have 'KD' column; Sheet4 rows have 'Latest' column
const inventory = inventoryItems.filter(i => i.json['KD'] !== undefined);
const rankings  = inventoryItems.filter(i => i.json['Latest'] !== undefined);

// Build a map of keyword → SERPROBOT rank
const rankMap = {};
for (const r of rankings) {
  const kw = String(r.json['Keyword'] || r.json[''] || '').toLowerCase().trim();
  const latest = String(r.json['Latest'] || '').replace('★','').replace('↑','').trim();
  const rank = Number(latest);
  if (kw && Number.isFinite(rank)) rankMap[kw] = rank;
}

// Enrich inventory keywords with SERPROBOT rank
const enriched = inventory.map(item => {
  const kw = String(item.json['Keyword'] || '').toLowerCase().trim();
  const serproRank = rankMap[kw] ?? 0;
  const vol = Number(item.json['Volume']) || 0;
  const kd  = Number(item.json['KD']) || 0;

  // Skip if already ranking #1-4 (already optimized)
  if (serproRank >= 1 && serproRank <= 4) return null;

  return {
    json: {
      Keyword: item.json['Keyword'],
      Volume: vol,
      KD: kd,
      serprobot_rank: serproRank,
      serprobot_presence: item.json['Presence in SERPROBOT List?'] || 'Not present',
    }
  };
}).filter(Boolean);

return enriched.length > 0 ? enriched : inventory.map(i => ({ json: { ...i.json, serprobot_rank: 0 } }));`;

// ── Build Workflow JSON ────────────────────────────────────────────────────
function buildWorkflow() {
  const nodes: any[] = [];
  const connections: Record<string, any> = {};

  function conn(from: string, to: string, fromIdx = 0, toIdx = 0) {
    if (!connections[from]) connections[from] = { main: [] };
    while (connections[from].main.length <= fromIdx) connections[from].main.push([]);
    connections[from].main[fromIdx].push({ node: to, type: 'main', index: toIdx });
  }
  function aiConn(model: string, agent: string) {
    if (!connections[model]) connections[model] = { ai_languageModel: [[]] };
    connections[model].ai_languageModel[0].push({ node: agent, type: 'ai_languageModel', index: 0 });
  }
  function toolConn(tool: string, agent: string) {
    if (!connections[tool]) connections[tool] = { ai_tool: [[]] };
    connections[tool].ai_tool[0].push({ node: agent, type: 'ai_tool', index: 0 });
  }
  function parserConn(parser: string, agent: string) {
    if (!connections[parser]) connections[parser] = { ai_outputParser: [[]] };
    connections[parser].ai_outputParser[0].push({ node: agent, type: 'ai_outputParser', index: 0 });
  }

  // ── Claude model factory ─────────────────────────────────────────────────
  let modelIdx = 0;
  function claudeModel(x: number, y: number): string {
    const name = `Claude claude-opus-4-6 ${++modelIdx > 1 ? modelIdx : ''}`.trim();
    nodes.push({
      id: `model-${modelIdx}`,
      name,
      type: '@n8n/n8n-nodes-langchain.lmChatOpenRouter',
      typeVersion: 1,
      position: [x, y],
      parameters: { model: 'anthropic/claude-opus-4-6', options: {} },
    });
    return name;
  }

  // ── Row 1: Trigger + Keyword Pipeline (y=0..200) ──────────────────────────

  // Schedule Trigger
  nodes.push({
    id: 'schedule-trigger',
    name: 'Schedule Trigger',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [-800, 80],
    parameters: { rule: { interval: [{ field: 'weeks', weeksInterval: 1 }] } },
  });

  // Manual Trigger (for testing)
  nodes.push({
    id: 'manual-trigger',
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [-800, 240],
    parameters: {},
  });

  // Google Sheets — ABB Keyword Inventory (Sheet3, City of Industry tab)
  nodes.push({
    id: 'gs-keywords',
    name: 'ABB Keyword Inventory',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: [-560, 80],
    parameters: {
      documentId: {
        __rl: true, value: SHEET_KEYWORD_INVENTORY,
        mode: 'id',
      },
      sheetName: { __rl: true, value: 'City of Industry', mode: 'name' },
      options: {},
    },
  });

  // Google Sheets — SERPROBOT Rankings (Sheet4, clean list)
  nodes.push({
    id: 'gs-rankings',
    name: 'SERPROBOT Rankings',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: [-560, 240],
    parameters: {
      documentId: { __rl: true, value: SHEET_KEYWORD_BANK, mode: 'id' },
      sheetName: { __rl: true, value: 'clean list- SERPROBOT', mode: 'name' },
      options: {},
    },
  });

  // Merge — combine both sheets
  nodes.push({
    id: 'merge-inputs',
    name: 'Merge Keyword Sources',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [-300, 160],
    parameters: { mode: 'combine', combineBy: 'combineAll', options: {} },
  });

  // Code — Enrich & score keyword data
  nodes.push({
    id: 'enrich-keywords',
    name: 'Enrich Keywords',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-80, 160],
    parameters: { jsCode: ENRICH_CODE },
  });

  // HTTP Request — DataForSEO keyword suggestions
  nodes.push({
    id: 'dataforseo',
    name: 'HTTP Keyword Suggestions',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [180, 160],
    parameters: {
      method: 'POST',
      url: 'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBasicAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '=[{\n  "location_name": "United States",\n  "language_code": "en",\n  "keywords": ["{{ $json.Keyword }}"]\n}]\n',
      options: {},
    },
  });

  // Code — Extract DataForSEO suggestions
  nodes.push({
    id: 'extract-suggestions',
    name: 'Extract Suggestions',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [420, 160],
    parameters: {
      jsCode: `const tasks = $json.tasks;
const output = [];
if (tasks?.[0]?.result) {
  const keyword = tasks[0].data?.keywords?.[0] || $json.Keyword || '';
  const rank    = $json.serprobot_rank ?? 0;
  for (const sug of tasks[0].result) {
    output.push({
      Keyword:              keyword,
      'Suggested Keyword':  sug.keyword,
      'Search Volume':      sug.search_volume || 0,
      CPC:                  sug.cpc || 0,
      Competition:          sug.competition_level || sug.competition || 'MEDIUM',
      kd:                   $json.KD || 0,
      serprobot_rank:       rank,
    });
  }
}
return output.length > 0 ? output : [{ Keyword: $json.Keyword, 'Suggested Keyword': $json.Keyword, 'Search Volume': $json.Volume || 0, CPC: 0, Competition: 'MEDIUM', kd: $json.KD || 0, serprobot_rank: $json.serprobot_rank || 0 }];`,
    },
  });

  // Google Sheets — Write keyword suggestions to ABB Sheet3 "Content Pipeline" tab
  nodes.push({
    id: 'gs-suggestions',
    name: 'Log Keyword Suggestions',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: [660, 160],
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: SHEET_KEYWORD_INVENTORY, mode: 'id' },
      sheetName: { __rl: true, value: 'Content Pipeline', mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          Keyword:             "={{ $json.Keyword }}",
          'Suggested Keyword': "={{ $json['Suggested Keyword'] }}",
          'Search Volume':     "={{ $json['Search Volume'] }}",
          CPC:                 "={{ $json['CPC'] }}",
          Competition:         "={{ $json['Competition'] }}",
          'SERPROBOT Rank':    "={{ $json['serprobot_rank'] }}",
        },
      },
      options: {},
    },
  });

  // Code — Score keywords (enriched scoring logic)
  nodes.push({
    id: 'score-keywords',
    name: 'Score Keywords',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [900, 160],
    parameters: { jsCode: SCORING_CODE },
  });

  // Sort
  nodes.push({
    id: 'sort',
    name: 'Sort by Score',
    type: 'n8n-nodes-base.sort',
    typeVersion: 1,
    position: [1120, 160],
    parameters: { sortFieldsUi: { sortField: [{ fieldName: 'score', order: 'descending' }] }, options: {} },
  });

  // Limit to top 3
  nodes.push({
    id: 'limit',
    name: 'Top 3 Keywords',
    type: 'n8n-nodes-base.limit',
    typeVersion: 1,
    position: [1340, 160],
    parameters: { maxItems: 3 },
  });

  // Loop Over Items
  nodes.push({
    id: 'loop',
    name: 'Loop Over Items',
    type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3,
    position: [200, 400],
    parameters: { options: {} },
  });

  // ── Row 2: Content Generation Pipeline (y=400..700) ──────────────────────

  // Search in Tavily (for TOC research)
  nodes.push({
    id: 'tavily1',
    name: 'Bail Bonds SERP Research',
    type: '@tavily/n8n-nodes-tavily.tavilyTool',
    typeVersion: 1,
    position: [200, 640],
    parameters: {},
  });

  // Table of Contents Agent
  nodes.push({
    id: 'toc',
    name: 'Table of Contents',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [460, 400],
    parameters: {
      text: PROMPT_TOC_USER,
      options: { systemMessage: PROMPT_TOC_SYSTEM },
    },
  });
  const tocModel = claudeModel(460, 640);
  aiConn(tocModel, 'Table of Contents');
  toolConn('Bail Bonds SERP Research', 'Table of Contents');

  // Create the Sections (structured section list)
  nodes.push({
    id: 'create-sections',
    name: 'Create the Sections',
    type: 'n8n-nodes-base.openAi',
    typeVersion: 1.8,
    position: [700, 400],
    parameters: {
      resource: 'chat',
      model: { value: 'gpt-4o-mini' },
      messages: {
        values: [{
          role: 'user',
          content: `=You are given a table of contents outline for a bail bonds blog article.
Expand it into a detailed JSON structure.

Outline: {{ $json.output }}

For each section, provide:
- "title": exact H2 title
- "description": 2-3 sentence description of what this section should cover, specific to bail bonds in California

Return ONLY a JSON object: { "blogSections": [{ "title": "...", "description": "..." }, ...] }`,
        }],
      },
    },
  });

  // Split Out sections
  nodes.push({
    id: 'split-sections',
    name: 'Split Out Sections',
    type: 'n8n-nodes-base.splitOut',
    typeVersion: 1,
    position: [940, 480],
    parameters: { fieldToSplitOut: 'message.content.blogSections', options: {} },
  });

  // Generate Content per section
  nodes.push({
    id: 'gen-content',
    name: 'Generate Section Content',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [1180, 400],
    parameters: {
      text: PROMPT_CONTENT_USER,
      options: { systemMessage: PROMPT_CONTENT_SYSTEM },
    },
  });
  // Search for research inside content gen
  nodes.push({
    id: 'tavily2',
    name: 'Section Research',
    type: '@tavily/n8n-nodes-tavily.tavilyTool',
    typeVersion: 1,
    position: [1180, 640],
    parameters: {},
  });
  const contentModel = claudeModel(1420, 640);
  aiConn(contentModel, 'Generate Section Content');
  toolConn('Section Research', 'Generate Section Content');

  // Merge sections back
  nodes.push({
    id: 'merge-sections',
    name: 'Merge Sections',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [1540, 480],
    parameters: { mode: 'combine', combineBy: 'combineByPosition', options: {} },
  });

  // Aggregate all sections
  nodes.push({
    id: 'aggregate',
    name: 'Aggregate Sections',
    type: 'n8n-nodes-base.aggregate',
    typeVersion: 1,
    position: [1760, 480],
    parameters: {
      fieldsToAggregate: {
        fieldToAggregate: [{ fieldToAggregate: 'title' }, { fieldToAggregate: 'output' }],
      },
      options: {},
    },
  });

  // ── Row 3: EEAT + Editorial Pipeline (y=700..1000) ───────────────────────

  // Content Editor
  nodes.push({
    id: 'editor',
    name: 'Content Editor',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [200, 800],
    parameters: {
      text: `=List of section titles: {{ $json.title }}
List of section content: {{ $json.output }}`,
      options: { systemMessage: PROMPT_EDITOR_SYSTEM },
    },
  });
  const editorModel = claudeModel(200, 1040);
  aiConn(editorModel, 'Content Editor');

  // EEAT Agent
  nodes.push({
    id: 'eeat',
    name: 'EEAT Enhancement',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [540, 800],
    parameters: {
      text: `=Here is the full bail bonds article draft:
{{ $json.output }}

Apply all four EEAT enhancements as instructed. This is YMYL content for a real licensed bail bonds agency — accuracy and trustworthiness are critical.`,
      options: { systemMessage: PROMPT_EEAT_SYSTEM },
    },
  });
  const eeatModel = claudeModel(540, 1040);
  aiConn(eeatModel, 'EEAT Enhancement');

  // Content Editor 2 — final assembly
  nodes.push({
    id: 'editor2',
    name: 'Final Article Assembly',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [880, 800],
    parameters: {
      text: `=Article Draft:
{{ $('Content Editor').item.json.output }}

EEAT Enhancements:
{{ $json.output }}

Assemble into one clean, professional HTML article ready for WordPress.`,
      options: { systemMessage: PROMPT_EDITOR2_SYSTEM },
    },
  });
  const editor2Model = claudeModel(880, 1040);
  aiConn(editor2Model, 'Final Article Assembly');

  // ── Row 4: Title + Meta + Image + WordPress (y=1000..1300) ───────────────

  // Title Maker
  nodes.push({
    id: 'title',
    name: 'Title Maker',
    type: 'n8n-nodes-base.openAi',
    typeVersion: 1.8,
    position: [1200, 800],
    parameters: {
      resource: 'chat',
      model: { value: 'gpt-4o-mini' },
      messages: {
        values: [{
          role: 'user',
          content: `=Create an SEO-optimized blog article title for this bail bonds article.

Target keyword: {{ $('Loop Over Items').item.json['Suggested Keyword'] }}
Article content excerpt: {{ $('Final Article Assembly').item.json.output.slice(0, 500) }}

Requirements:
- Max 65 characters
- Include the primary keyword naturally
- Include a location or urgency signal when appropriate
- Examples of good titles: "How to Get a Bail Bond in City of Industry — Fast & Affordable", "24/7 Bail Bonds: What to Do When a Loved One Is Arrested in LA County"
- Return ONLY the title, nothing else`,
        }],
      },
    },
  });

  // Structured Output Parser for metadata
  nodes.push({
    id: 'meta-parser',
    name: 'Meta Output Parser',
    type: '@n8n/n8n-nodes-langchain.outputParserStructured',
    typeVersion: 1.2,
    position: [1680, 1040],
    parameters: {
      schemaType: 'manual',
      inputSchema: `{"type":"object","properties":{"slug":{"type":"string"},"metaTitle":{"type":"string"},"metaDescription":{"type":"string"},"focusKeyword":{"type":"string"},"keywords":{"type":"array","items":{"type":"string"}}},"required":["slug","metaTitle","metaDescription","focusKeyword","keywords"]}`,
    },
  });

  // Blog Metadata Agent
  nodes.push({
    id: 'metadata',
    name: 'Generate Blog Metadata',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [1540, 800],
    parameters: {
      text: `=Title: {{ $json.message.content }}
Article content: {{ $('Final Article Assembly').item.json.output }}`,
      options: { systemMessage: PROMPT_META_SYSTEM },
    },
  });
  const metaModel = claudeModel(1540, 1040);
  aiConn(metaModel, 'Generate Blog Metadata');
  parserConn('Meta Output Parser', 'Generate Blog Metadata');

  // Structured Output Parser for image
  nodes.push({
    id: 'image-parser',
    name: 'Image Output Parser',
    type: '@n8n/n8n-nodes-langchain.outputParserStructured',
    typeVersion: 1.2,
    position: [200, 1280],
    parameters: {
      schemaType: 'manual',
      inputSchema: `{"type":"object","properties":{"imagePrompt":{"type":"string"},"altText":{"type":"string"}},"required":["imagePrompt","altText"]}`,
    },
  });

  // Image Prompt Agent
  nodes.push({
    id: 'image-prompt',
    name: 'Generate Image Prompt',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [200, 1080],
    parameters: {
      text: `=Title: {{ $('Title Maker').item.json.message.content }}
Article excerpt: {{ $('Final Article Assembly').item.json.output.slice(0, 800) }}`,
      options: { systemMessage: PROMPT_IMAGE_SYSTEM },
    },
  });
  const imageModel = claudeModel(460, 1280);
  aiConn(imageModel, 'Generate Image Prompt');
  parserConn('Image Output Parser', 'Generate Image Prompt');

  // Generate Featured Image (DALL-E)
  nodes.push({
    id: 'gen-image',
    name: 'Generate Featured Image',
    type: 'n8n-nodes-base.openAi',
    typeVersion: 1.8,
    position: [560, 1080],
    parameters: {
      resource: 'image',
      operation: 'generate',
      prompt: "={{ $json.output.imagePrompt }}",
      options: { size: '1792x1024', quality: 'standard', style: 'natural' },
    },
  });

  // Resize Image
  nodes.push({
    id: 'resize',
    name: 'Resize Image',
    type: 'n8n-nodes-base.editImage',
    typeVersion: 1,
    position: [780, 1080],
    parameters: { operation: 'resize', width: 1200, height: 630, options: {} },
  });

  // Upload Image to WordPress
  nodes.push({
    id: 'wp-upload',
    name: 'Upload Image To WP',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [980, 1080],
    parameters: {
      method: 'POST',
      url: `=${WP_URL}/wp-json/wp/v2/media`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'wordpressApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'content-disposition', value: '=attachment; filename={{ $binary.data.fileName }}.{{ $binary.data.fileExtension }}' },
          { name: 'content-type',        value: '={{ $binary.data.mimeType }}' },
        ],
      },
      sendBody: true,
      contentType: 'binaryData',
      inputDataFieldName: 'data',
      options: {},
    },
  });

  // Update Image Meta
  nodes.push({
    id: 'wp-image-meta',
    name: 'Update Image Meta',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1200, 1080],
    parameters: {
      method: 'POST',
      url: `=${WP_URL}/wp-json/wp/v2/media/{{ $json.id }}`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'wordpressApi',
      sendBody: true,
      bodyParameters: {
        parameters: [
          { name: 'title',       value: "={{ $('Title Maker').item.json.message.content }}" },
          { name: 'slug',        value: "={{ $('Generate Blog Metadata').item.json.output.slug }}" },
          { name: 'alt_text',    value: "={{ $('Generate Image Prompt').item.json.output.altText }}" },
          { name: 'caption',     value: "={{ $('Title Maker').item.json.message.content }}" },
          { name: 'description', value: "=Professional bail bonds photography for Angels Bail Bonds article: {{ $('Title Maker').item.json.message.content }}" },
        ],
      },
      options: {},
    },
  });

  // Post to WordPress (draft)
  nodes.push({
    id: 'wp-post',
    name: 'Post Blog To WP',
    type: 'n8n-nodes-base.wordpress',
    typeVersion: 1,
    position: [1420, 1080],
    parameters: {
      title:            "={{ $('Title Maker').item.json.message.content }}",
      additionalFields: {
        authorId:  '=1',
        content:   "={{ $('Final Article Assembly').item.json.output }}",
        slug:      "={{ $('Generate Blog Metadata').item.json.output.slug }}",
        status:    'draft',
        excerpt:   "={{ $('Generate Blog Metadata').item.json.output.metaDescription }}",
        categories: '=1',
      },
    },
  });

  // Set Featured Image
  nodes.push({
    id: 'wp-featured',
    name: 'Set Featured Image',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1640, 1080],
    parameters: {
      method: 'POST',
      url: `=${WP_URL}/wp-json/wp/v2/posts/{{ $json.id }}`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'wordpressApi',
      sendBody: true,
      bodyParameters: {
        parameters: [
          { name: 'featured_media', value: "={{ $('Update Image Meta').item.json.id }}" },
        ],
      },
      options: {},
    },
  });

  // Update Status in Google Sheets (Sheet3 — mark keyword as processed)
  nodes.push({
    id: 'gs-status',
    name: 'Update Content Status',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: [1860, 1080],
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: SHEET_KEYWORD_INVENTORY, mode: 'id' },
      sheetName: { __rl: true, value: 'Content Pipeline', mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          'Suggested Keyword': "={{ $('Loop Over Items').item.json['Suggested Keyword'] }}",
          'Status':            '=Published (Draft)',
          'WP Post ID':        '={{ $json.id }}',
          'WP URL':            `=https://angelsbailbonds.com/?p={{ $json.id }}`,
          'Published At':      "={{ $now }}",
          'Title':             "={{ $('Title Maker').item.json.message.content }}",
          'Meta Description':  "={{ $('Generate Blog Metadata').item.json.output.metaDescription }}",
        },
      },
      options: {},
    },
  });

  // Sticky Notes
  nodes.push({
    id: 'note1',
    name: 'Note: Keyword Pipeline',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-820, -60],
    parameters: { content: '## 📊 Keyword Input\n\nReads from:\n- **Sheet3**: Keyword Inventory (City of Industry tab)\n- **Sheet4**: SERPROBOT Rankings\n\nEnriches and scores keywords. Skips keywords already ranking #1–#4. Prioritizes rank #5–#30 opportunities.', color: 5 },
  });
  nodes.push({
    id: 'note2',
    name: 'Note: Content Pipeline',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [180, 340],
    parameters: { content: '## ✍️ Content Generation\n\nUses Claude claude-opus-4-6 (via OpenRouter) for all AI steps.\n\nBail bonds YMYL/EEAT prompts — experience, expertise, authority, trust signals built in.', color: 4 },
  });
  nodes.push({
    id: 'note3',
    name: 'Note: WordPress',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [960, 960],
    parameters: { content: `## 🌐 WordPress Setup\n\n**TODO**: \n1. Set \`${WP_URL}\` in the WP nodes above (replace with actual URL)\n2. Add WordPress API credentials in n8n\n3. Set correct category IDs for bail bonds posts\n\nAll posts created as **drafts** — review before publishing.`, color: 6 },
  });

  // ── Connections ────────────────────────────────────────────────────────────

  // Triggers → keyword read
  conn('Schedule Trigger',     'ABB Keyword Inventory');
  conn('Manual Trigger',       'ABB Keyword Inventory');
  conn('ABB Keyword Inventory', 'Merge Keyword Sources', 0, 0);
  conn('SERPROBOT Rankings',    'Merge Keyword Sources', 0, 1);
  conn('Merge Keyword Sources', 'Enrich Keywords');
  conn('Enrich Keywords',       'HTTP Keyword Suggestions');
  conn('HTTP Keyword Suggestions', 'Extract Suggestions');
  conn('Extract Suggestions',   'Log Keyword Suggestions');
  conn('Log Keyword Suggestions', 'Score Keywords');
  conn('Score Keywords',        'Sort by Score');
  conn('Sort by Score',         'Top 3 Keywords');
  conn('Top 3 Keywords',        'Loop Over Items');

  // Loop → content
  conn('Loop Over Items',       'Table of Contents', 0, 0);

  // TOC → sections
  conn('Table of Contents',     'Create the Sections');
  conn('Create the Sections',   'Split Out Sections');
  conn('Split Out Sections',    'Merge Sections',          0, 0);
  conn('Generate Section Content', 'Merge Sections',       0, 1);
  conn('Merge Sections',        'Aggregate Sections');

  // Aggregate → editor pipeline
  conn('Aggregate Sections',    'Content Editor');
  conn('Content Editor',        'EEAT Enhancement');
  conn('EEAT Enhancement',      'Final Article Assembly');

  // Editorial → title + meta
  conn('Final Article Assembly', 'Title Maker');
  conn('Title Maker',           'Generate Blog Metadata');
  conn('Title Maker',           'Generate Image Prompt');

  // Image pipeline
  conn('Generate Image Prompt', 'Generate Featured Image');
  conn('Generate Featured Image', 'Resize Image');
  conn('Resize Image',          'Upload Image To WP');
  conn('Upload Image To WP',    'Update Image Meta');
  conn('Update Image Meta',     'Post Blog To WP');
  conn('Post Blog To WP',       'Set Featured Image');
  conn('Set Featured Image',    'Update Content Status');
  conn('Update Content Status', 'Loop Over Items');  // loop back

  return {
    name: 'Angels Bail Bonds — SEO Content Generator',
    active: false,
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
      saveManualExecutions: true,
      callerPolicy: 'workflowsFromSameOwner',
    },
  };
}

// ── Create the workflow ────────────────────────────────────────────────────
async function main() {
  console.log('Building Angels Bail Bonds SEO workflow...');
  const workflow = buildWorkflow();
  console.log(`Node count: ${workflow.nodes.length}`);

  const result = await n8nPost('/workflows', workflow);
  console.log('\n✅ Workflow created!');
  console.log(`ID:   ${result.id}`);
  console.log(`Name: ${result.name}`);
  console.log(`URL:  ${N8N_BASE_URL}/workflow/${result.id}`);
  console.log('\nNext steps:');
  console.log('1. Open the workflow in n8n and review the node layout');
  console.log('2. Add WordPress API credentials (n8n → Settings → Credentials)');
  console.log('3. Update WordPress URL in the WP nodes (currently: ' + WP_URL + ')');
  console.log('4. Ensure DataForSEO, OpenRouter, Google Sheets, Tavily credentials are connected');
  console.log('5. Add a "Content Pipeline" tab to Sheet3 (will be created automatically on first run)');
  console.log('6. Run manually to test — all posts publish as Drafts');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
