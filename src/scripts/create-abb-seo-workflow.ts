/**
 * Angels Bail Bonds — SEO Content Generator Workflow
 *
 * Reads keywords directly from ABB Google Sheets (no DataForSEO expansion).
 * Uses SerpAPI for SERP research, Claude API for all AI content generation.
 * Outputs articles as Google Docs + logs status back to Sheet3.
 *
 * Site: https://bailbondsdomesticviolence.com (Lovable.dev / React)
 *
 * Google Sheets:
 *  - Sheet3 Keyword Inventory: 139W8Bw6F9-ujDi3eEFw77RzMZYd6fQEO7kUZbLshNYA
 *  - Sheet4 Keyword Bank (SERPROBOT): 1qsR83Vg7R-yatxuQGAwlzCamWdImbY5sl3Jd6107fHs
 */

import dotenv from 'dotenv';
dotenv.config();

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY  = process.env.N8N_API_KEY!;

const SHEET_KEYWORD_INVENTORY = '139W8Bw6F9-ujDi3eEFw77RzMZYd6fQEO7kUZbLshNYA';
const SHEET_KEYWORD_BANK      = '1qsR83Vg7R-yatxuQGAwlzCamWdImbY5sl3Jd6107fHs';
const SITE_URL                = 'https://bailbondsdomesticviolence.com';
const GDRIVE_FOLDER_ID        = ''; // Optional: paste Drive folder ID here

async function n8nPost(path: string, body: object) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1${path}`, {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`n8n ${path} → ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

// ── Prompts ────────────────────────────────────────────────────────────────

const P_TOC_SYS = `You are an SEO content strategist specializing in bail bonds — a YMYL niche requiring high E-E-A-T.

Your task: create a focused, SEO-friendly table of contents for a bail bonds blog article.

Rules:
- Write for stressed families urgently searching for help in California
- 4–6 sections, no overlap, no fluff
- Always include: a local angle (when keyword is city-specific), a trust/licensing section, a FAQ
- Every section must deliver actionable value to someone in a bail emergency
- Use natural H2 headings that match search intent
- Return a JSON object: { "blogSections": [{ "title": "...", "description": "..." }] }`;

const P_TOC_USER = `Create a table of contents for a bail bonds blog article.

Primary keyword: {{ $json.Keyword }}
Monthly search volume: {{ $json.Volume }}
Keyword difficulty: {{ $json.KD }}
Current SERPROBOT rank: {{ $json.serprobot_rank || 'Not tracked' }}
SERP context from research:
{{ $json.serp_context }}

Return JSON: { "blogSections": [{ "title": "...", "description": "2-3 sentence brief" }] }`;

const P_CONTENT_SYS = `You are an expert bail bonds content writer for Angels Bail Bonds — a licensed, family-owned California bail bond agency serving communities since 1958.

E-E-A-T requirements:
- Experience: Write as a licensed bail agent who has handled thousands of cases
- Expertise: Reference CA Penal Code §§ 1268–1306, 10% non-refundable premium (set by CA law), CDOI licensing
- Authority: Cite CA Courts (courts.ca.gov), CA Dept of Insurance (insurance.ca.gov), county sheriff departments
- Trust: 24/7 availability, licensed, family-owned, fast release times

Content rules:
- Address the urgent emotional state of the reader — they are scared and need clear guidance
- Local SEO: use location-specific details (sheriff station, court info) when available
- Format: clean HTML — h2, h3, p, ul, a tags. Min one inline link per section
- 200–400 words per section`;

const P_CONTENT_USER = `Write the content for this bail bonds article section.

Section Title: {{ $json.title }}
Section Description: {{ $json.description }}
Primary keyword: {{ $('Loop Over Items').item.json.Keyword }}`;

const P_EDITOR_SYS = `You are an expert bail bonds content editor at Angels Bail Bonds.

Given section titles + content blocks, assemble a polished HTML article:
- Add a compelling 2–3 sentence intro (urgency + trust signal) before the first section
- Wrap each section in proper H2 + paragraphs
- Ensure smooth transitions, inline links in every section
- Target: 1,200–1,800 words total
- Tone: urgent yet reassuring, professional, compassionate
- Output clean HTML only — no markdown, no commentary`;

const P_EEAT_SYS = `You are an E-E-A-T enhancement specialist for YMYL bail bonds content.

Given a draft article, produce four clearly labeled blocks:

FROM_EXPERIENCE:
Write 3–5 sentences from a licensed California bail agent with 20+ years experience. Personal, authentic, empathetic to families in crisis.

SOURCES:
List all sources cited in the article, plus add:
- https://www.insurance.ca.gov/ (CA Dept of Insurance — bail agent licensing)
- https://www.courts.ca.gov/ (CA Courts — bail procedures)
- https://leginfo.legislature.ca.gov/ (CA Penal Code bail sections)

AUTHOR_FOOTER:
"Angel Ferrer — Licensed California Bail Agent | Angels Bail Bonds | CA DOI License #[INSERT] | Serving communities since 1958 | 24/7: [INSERT PHONE]"

FACT_CHECK:
Verify these are correct in the article:
• Bail bond premium = 10% of full bail (non-refundable, CA law)
• Bail agents licensed by CA Dept of Insurance
• Angels Bail Bonds serving since 1958
• 24/7 service
Flag any errors.`;

const P_EDITOR2_SYS = `You are the final editor for Angels Bail Bonds blog content.

Assemble the article + EEAT enhancements into one clean publication-ready HTML article:
- FROM_EXPERIENCE block appears after the intro paragraph
- All cited sources in <h2>Sources</h2> at the end
- Author footer as <div class="author-bio"> at the very end
- Semantic HTML throughout: h1 (title used externally), h2 (sections), p, ul, a
- No labels, no commentary — clean HTML only`;

const P_META_SYS = `You are an SEO metadata specialist for bail bonds content.

Given the article title and content, return clean JSON with:
- slug: lowercase, dashes, no stop words, include location if present
- metaTitle: max 60 chars, includes keyword + location or brand
- metaDescription: max 160 chars, compelling, includes keyword + CTA
- focusKeyword: single most important keyword
- keywords: array of 5–8 keywords`;

const P_IMAGE_SYS = `You are a visual content specialist for a bail bonds agency.

Given the title and content excerpt, return JSON with:
- imagePrompt: DALL-E prompt — professional, trustworthy, warm lighting. Subjects: courthouse at dawn, family outside jail, bail agent on phone, California skyline. NO handcuffs, mugshots, or prison bars.
- altText: max 20 words, descriptive, includes keyword`;

// ── Keyword scoring (no DataForSEO — uses sheet data directly) ────────────
const SCORING_CODE = `// Score keywords from ABB Google Sheets
// Fields available: Keyword, Volume, KD, serprobot_rank, serprobot_presence

function kdPenalty(kd) {
  const n = Number(kd) || 0;
  if (n <= 20) return 1.0;
  if (n <= 40) return 0.7;
  if (n <= 60) return 0.45;
  return 0.2;
}

function rankBonus(rank) {
  const r = Number(rank) || 0;
  if (r === 0)             return 0.8;  // not tracked — medium opportunity
  if (r >= 1 && r <= 4)   return 0.1;  // already winning — skip
  if (r >= 5 && r <= 15)  return 1.5;  // near top page — high priority
  if (r >= 16 && r <= 30) return 1.2;  // reachable
  return 0.6;
}

return $input.all().map(item => {
  const vol   = Number(item.json.Volume)          || 0;
  const kd    = Number(item.json.KD)              || 0;
  const rank  = Number(item.json.serprobot_rank)  || 0;
  const score = Math.round(vol * kdPenalty(kd) * rankBonus(rank));
  return { ...item, json: { ...item.json, score } };
});`;

// ── Keyword enrichment (merge Sheet3 + Sheet4) ────────────────────────────
const ENRICH_CODE = `// Merge Keyword Inventory (Sheet3) with SERPROBOT Rankings (Sheet4)
// Sheet3 rows have 'KD'; Sheet4 rows have 'Latest'

const all = $input.all();
const inventory = all.filter(i => i.json['KD'] !== undefined && i.json['Keyword']);
const rankings  = all.filter(i => i.json['Latest'] !== undefined);

// Build rank map: keyword → current rank number
const rankMap = {};
for (const r of rankings) {
  const kw     = String(r.json['Keyword'] || '').toLowerCase().trim();
  const latest = String(r.json['Latest'] || '').replace(/[★↑↓]/g, '').trim();
  const rank   = Number(latest);
  if (kw && Number.isFinite(rank) && rank > 0) rankMap[kw] = rank;
}

// Enrich inventory keywords; filter out keywords already ranking #1-4
const enriched = inventory
  .map(item => {
    const kw   = String(item.json['Keyword'] || '').toLowerCase().trim();
    const rank = rankMap[kw] ?? 0;
    if (rank >= 1 && rank <= 4) return null; // already optimised
    return {
      json: {
        Keyword:             item.json['Keyword'],
        Volume:              Number(item.json['Volume']) || 0,
        KD:                  Number(item.json['KD'])     || 0,
        serprobot_rank:      rank,
        serprobot_presence:  item.json['Presence in SERPROBOT List?'] || 'Not present',
      }
    };
  })
  .filter(Boolean);

return enriched.length > 0 ? enriched : inventory.map(i => ({
  json: { ...i.json, serprobot_rank: 0, serprobot_presence: 'Not present' }
}));`;

// ── SerpAPI context extraction ─────────────────────────────────────────────
const SERP_EXTRACT_CODE = `// Extract useful SERP context from SerpAPI response to pass to Claude
const data = $json;

const organic = (data.organic_results || []).slice(0, 5).map(r => ({
  title: r.title,
  snippet: r.snippet,
  link: r.link,
}));

const paa = (data.related_questions || []).slice(0, 5).map(q => q.question);

const related = (data.related_searches || []).slice(0, 5).map(s => s.query);

const context = [
  organic.length ? 'TOP RESULTS:\\n' + organic.map(r => \`- \${r.title}: \${r.snippet}\`).join('\\n') : '',
  paa.length    ? '\\nPEOPLE ALSO ASK:\\n' + paa.map(q => \`- \${q}\`).join('\\n')                    : '',
  related.length? '\\nRELATED SEARCHES:\\n' + related.map(s => \`- \${s}\`).join('\\n')                : '',
].filter(Boolean).join('\\n');

return [{ json: { ...item.json, serp_context: context || 'No SERP data available' } }];`;

// ── Build Workflow ─────────────────────────────────────────────────────────
function buildWorkflow() {
  const nodes: any[] = [];
  const connections: Record<string, any> = {};

  function conn(from: string, to: string, fromPort = 0, toPort = 0) {
    if (!connections[from]) connections[from] = { main: [] };
    while (connections[from].main.length <= fromPort) connections[from].main.push([]);
    connections[from].main[fromPort].push({ node: to, type: 'main', index: toPort });
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

  // Claude model factory — native Anthropic node
  let mIdx = 0;
  function claudeNode(x: number, y: number, label?: string): string {
    const name = label || `Claude Model ${++mIdx}`;
    nodes.push({
      id: `claude-${mIdx}`,
      name,
      type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
      typeVersion: 1.3,
      position: [x, y],
      parameters: {
        model: 'claude-opus-4-6',
        options: { maxTokens: 8192 },
      },
      // credentials connected in n8n UI
    });
    return name;
  }

  // SerpAPI tool factory — used as AI tool by agents
  function serpTool(x: number, y: number, label: string): string {
    nodes.push({
      id: `serp-${label.replace(/\s/g, '-').toLowerCase()}`,
      name: label,
      type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
      typeVersion: 1.1,
      position: [x, y],
      parameters: {
        url: 'https://serpapi.com/search.json',
        sendQuery: true,
        parametersUi: {
          parameter: [
            {
              name: 'q',
              value: "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('query', 'The search query to look up on Google', 'string') }}",
            },
            { name: 'api_key', value: '={{ $env.SERP_API_KEY }}' },
            { name: 'num',     value: '10' },
            { name: 'gl',      value: 'us' },
            { name: 'hl',      value: 'en' },
          ],
        },
        options: {
          response: { response: { responseFormat: 'json' } },
        },
      },
    });
    return label;
  }

  // ── Row 1: Triggers + Keyword Pipeline (y=80) ────────────────────────────

  nodes.push({
    id: 'trigger-schedule',
    name: 'Schedule Trigger',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [-800, 80],
    parameters: { rule: { interval: [{ field: 'weeks', weeksInterval: 1 }] } },
  });

  nodes.push({
    id: 'trigger-manual',
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [-800, 240],
    parameters: {},
  });

  // Read Sheet3 — Keyword Inventory (City of Industry tab)
  nodes.push({
    id: 'gs-keywords',
    name: 'ABB Keyword Inventory',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: [-560, 80],
    parameters: {
      documentId: { __rl: true, value: SHEET_KEYWORD_INVENTORY, mode: 'id' },
      sheetName:  { __rl: true, value: 'City of Industry', mode: 'name' },
      options: {},
    },
  });

  // Read Sheet4 — SERPROBOT Rankings
  nodes.push({
    id: 'gs-rankings',
    name: 'SERPROBOT Rankings',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: [-560, 240],
    parameters: {
      documentId: { __rl: true, value: SHEET_KEYWORD_BANK, mode: 'id' },
      sheetName:  { __rl: true, value: 'clean list- SERPROBOT', mode: 'name' },
      options: {},
    },
  });

  // Merge both sheet reads
  nodes.push({
    id: 'merge-sources',
    name: 'Merge Keyword Sources',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [-300, 160],
    parameters: { mode: 'combine', combineBy: 'combineAll', options: {} },
  });

  // Enrich: cross-reference Sheet3 + Sheet4, filter already-ranked #1-4
  nodes.push({
    id: 'enrich',
    name: 'Enrich Keywords',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-60, 160],
    parameters: { jsCode: ENRICH_CODE },
  });

  // Score keywords using volume × KD penalty × rank bonus
  nodes.push({
    id: 'score',
    name: 'Score Keywords',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [180, 160],
    parameters: { jsCode: SCORING_CODE },
  });

  nodes.push({
    id: 'sort',
    name: 'Sort by Score',
    type: 'n8n-nodes-base.sort',
    typeVersion: 1,
    position: [400, 160],
    parameters: { sortFieldsUi: { sortField: [{ fieldName: 'score', order: 'descending' }] }, options: {} },
  });

  nodes.push({
    id: 'limit',
    name: 'Top 3 Keywords',
    type: 'n8n-nodes-base.limit',
    typeVersion: 1,
    position: [620, 160],
    parameters: { maxItems: 3 },
  });

  nodes.push({
    id: 'loop',
    name: 'Loop Over Items',
    type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3,
    position: [860, 160],
    parameters: { options: {} },
  });

  // ── Row 2: SERP Research (y=380) ─────────────────────────────────────────

  // SerpAPI call for the keyword (HTTP Request — not an agent tool, feeds context)
  nodes.push({
    id: 'serp-call',
    name: 'SerpAPI SERP Research',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1100, 160],
    parameters: {
      method: 'GET',
      url: 'https://serpapi.com/search.json',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'q',       value: '={{ $json.Keyword }}' },
          { name: 'api_key', value: '={{ $env.SERP_API_KEY }}' },
          { name: 'num',     value: '10' },
          { name: 'gl',      value: 'us' },
          { name: 'hl',      value: 'en' },
        ],
      },
      options: {},
    },
  });

  // Extract useful context from SERP response
  nodes.push({
    id: 'serp-extract',
    name: 'Extract SERP Context',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1340, 160],
    parameters: { jsCode: SERP_EXTRACT_CODE },
  });

  // ── Row 3: Content Generation Pipeline (y=380..640) ──────────────────────

  // SerpAPI as AI tool (for agents that need live research)
  const serpToolTOC  = serpTool(1580, 560, 'SerpAPI Research');
  const serpToolEEAT = serpTool(400,  880, 'SerpAPI Fact Check');

  // Table of Contents Agent
  nodes.push({
    id: 'toc',
    name: 'Table of Contents',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [1580, 380],
    parameters: {
      text: P_TOC_USER,
      options: { systemMessage: P_TOC_SYS },
    },
  });
  const tocModel = claudeNode(1820, 560, 'Claude — TOC');
  aiConn(tocModel, 'Table of Contents');
  toolConn(serpToolTOC, 'Table of Contents');

  // Create Sections (expand TOC into detailed section briefs)
  nodes.push({
    id: 'create-sections',
    name: 'Create Section Briefs',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [1820, 380],
    parameters: {
      text: `=You are given a table of contents outline for a bail bonds article.
Expand each section into a detailed brief.

Outline: {{ $json.output }}
Primary keyword: {{ $('Loop Over Items').item.json.Keyword }}
SERP context: {{ $('Extract SERP Context').item.json.serp_context }}

Return JSON: { "blogSections": [{ "title": "exact H2 title", "description": "2-3 sentence content brief specific to bail bonds in California" }] }`,
      options: {
        systemMessage: `You are a bail bonds content strategist. Expand table of contents outlines into detailed, specific content briefs for California bail bonds articles. Be precise and actionable — describe exactly what each section should cover.`,
      },
    },
  });
  const sectionModel = claudeNode(2060, 560, 'Claude — Sections');
  aiConn(sectionModel, 'Create Section Briefs');

  // Split sections into individual items
  nodes.push({
    id: 'split',
    name: 'Split Out Sections',
    type: 'n8n-nodes-base.splitOut',
    typeVersion: 1,
    position: [2060, 380],
    parameters: { fieldToSplitOut: 'message.content.blogSections', options: {} },
  });

  // Generate content per section
  nodes.push({
    id: 'gen-content',
    name: 'Generate Section Content',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [2300, 380],
    parameters: {
      text: P_CONTENT_USER,
      options: { systemMessage: P_CONTENT_SYS },
    },
  });
  const contentModel = claudeNode(2300, 560, 'Claude — Content');
  aiConn(contentModel, 'Generate Section Content');

  // Merge + Aggregate all sections
  nodes.push({
    id: 'merge-sections',
    name: 'Merge Sections',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [2540, 460],
    parameters: { mode: 'combine', combineBy: 'combineByPosition', options: {} },
  });

  nodes.push({
    id: 'aggregate',
    name: 'Aggregate Sections',
    type: 'n8n-nodes-base.aggregate',
    typeVersion: 1,
    position: [2760, 460],
    parameters: {
      fieldsToAggregate: {
        fieldToAggregate: [{ fieldToAggregate: 'title' }, { fieldToAggregate: 'output' }],
      },
      options: {},
    },
  });

  // ── Row 4: Editorial + EEAT (y=640..880) ─────────────────────────────────

  nodes.push({
    id: 'editor',
    name: 'Content Editor',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [860, 640],
    parameters: {
      text: `=Section titles: {{ $json.title }}
Section content: {{ $json.output }}`,
      options: { systemMessage: P_EDITOR_SYS },
    },
  });
  const editorModel = claudeNode(860, 880, 'Claude — Editor');
  aiConn(editorModel, 'Content Editor');

  nodes.push({
    id: 'eeat',
    name: 'EEAT Enhancement',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [1120, 640],
    parameters: {
      text: `=Article draft:
{{ $json.output }}

Apply all four EEAT enhancements. This is YMYL content for a real licensed California bail bond agency — accuracy and trust signals are critical.`,
      options: { systemMessage: P_EEAT_SYS },
    },
  });
  const eeatModel = claudeNode(1120, 880, 'Claude — EEAT');
  aiConn(eeatModel, 'EEAT Enhancement');
  toolConn(serpToolEEAT, 'EEAT Enhancement');

  nodes.push({
    id: 'editor2',
    name: 'Final Article Assembly',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [1380, 640],
    parameters: {
      text: `=Article draft:
{{ $('Content Editor').item.json.output }}

EEAT enhancements:
{{ $json.output }}

Assemble into one clean, professional HTML article.`,
      options: { systemMessage: P_EDITOR2_SYS },
    },
  });
  const editor2Model = claudeNode(1380, 880, 'Claude — Final');
  aiConn(editor2Model, 'Final Article Assembly');

  // ── Row 5: Title + Meta + Image + Output (y=640 continue) ────────────────

  nodes.push({
    id: 'title',
    name: 'Title Maker',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [1640, 640],
    parameters: {
      text: `=Write a single SEO-optimized blog title.

Target keyword: {{ $('Loop Over Items').item.json.Keyword }}
Article excerpt: {{ $('Final Article Assembly').item.json.output.slice(0, 600) }}

Rules:
- Max 65 characters
- Include the keyword naturally
- Include urgency or location signal when appropriate
- Return ONLY the title, nothing else`,
      options: {
        systemMessage: `You are an SEO title writer for a bail bonds agency. Write compelling, keyword-optimized titles for bail bonds blog posts. Examples: "24/7 Bail Bonds in City of Industry — Fast, Licensed & Affordable", "How Bail Bonds Work in California: A Step-by-Step Guide"`,
      },
    },
  });
  const titleModel = claudeNode(1640, 880, 'Claude — Title');
  aiConn(titleModel, 'Title Maker');

  // Metadata parser
  nodes.push({
    id: 'meta-parser',
    name: 'Meta Output Parser',
    type: '@n8n/n8n-nodes-langchain.outputParserStructured',
    typeVersion: 1.2,
    position: [1900, 880],
    parameters: {
      schemaType: 'manual',
      inputSchema: JSON.stringify({
        type: 'object',
        properties: {
          slug:            { type: 'string' },
          metaTitle:       { type: 'string' },
          metaDescription: { type: 'string' },
          focusKeyword:    { type: 'string' },
          keywords:        { type: 'array', items: { type: 'string' } },
        },
        required: ['slug', 'metaTitle', 'metaDescription', 'focusKeyword', 'keywords'],
      }),
    },
  });

  nodes.push({
    id: 'metadata',
    name: 'Generate Blog Metadata',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [1900, 640],
    parameters: {
      text: `=Title: {{ $json.output }}
Article: {{ $('Final Article Assembly').item.json.output }}`,
      options: { systemMessage: P_META_SYS },
    },
  });
  const metaModel = claudeNode(2140, 880, 'Claude — Meta');
  aiConn(metaModel, 'Generate Blog Metadata');
  parserConn('Meta Output Parser', 'Generate Blog Metadata');

  // ── Row 6: Save to Google Docs ───────────────────────────────────────────

  nodes.push({
    id: 'gdocs-create',
    name: 'Create Article Google Doc',
    type: 'n8n-nodes-base.googleDocs',
    typeVersion: 2,
    position: [3100, 640],
    parameters: {
      operation: 'create',
      title: "={{ $('Title Maker').item.json.output }}",
      content: `=# {{ $('Title Maker').item.json.output }}

---
Keyword: {{ $('Loop Over Items').item.json.Keyword }}
Volume: {{ $('Loop Over Items').item.json.Volume }}
SERPROBOT Rank: {{ $('Loop Over Items').item.json.serprobot_rank || 'Not tracked' }}
Score: {{ $('Loop Over Items').item.json.score }}
Meta Title: {{ $('Generate Blog Metadata').item.json.output.metaTitle }}
Meta Description: {{ $('Generate Blog Metadata').item.json.output.metaDescription }}
Slug: {{ $('Generate Blog Metadata').item.json.output.slug }}
Focus Keyword: {{ $('Generate Blog Metadata').item.json.output.focusKeyword }}
Keywords: {{ $('Generate Blog Metadata').item.json.output.keywords.join(', ') }}
Site: ${SITE_URL}
Generated: {{ $now }}
Image: (add manually)

---

{{ $('Final Article Assembly').item.json.output }}`,
    },
  });

  // Log status back to Sheet3 — Content Pipeline tab
  nodes.push({
    id: 'gs-status',
    name: 'Update Content Status',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    position: [3340, 640],
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: SHEET_KEYWORD_INVENTORY, mode: 'id' },
      sheetName:  { __rl: true, value: 'Content Pipeline', mode: 'name' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          Keyword:           "={{ $('Loop Over Items').item.json.Keyword }}",
          Status:            '=Ready for Review',
          'Google Doc URL':  '={{ $json.documentUrl || $json.id }}',
          'Generated At':    '={{ $now }}',
          Title:             "={{ $('Title Maker').item.json.output }}",
          Slug:              "={{ $('Generate Blog Metadata').item.json.output.slug }}",
          'Meta Description':"={{ $('Generate Blog Metadata').item.json.output.metaDescription }}",
          'Focus Keyword':   "={{ $('Generate Blog Metadata').item.json.output.focusKeyword }}",
          'SERPROBOT Rank':  "={{ $('Loop Over Items').item.json.serprobot_rank || 'N/A' }}",
          Volume:            "={{ $('Loop Over Items').item.json.Volume }}",
          Score:             "={{ $('Loop Over Items').item.json.score }}",
        },
      },
      options: {},
    },
  });

  // ── Sticky Notes ──────────────────────────────────────────────────────────
  nodes.push({
    id: 'note-input',
    name: 'Note: Keyword Input',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-820, -40],
    parameters: {
      content: `## 📊 Keyword Input (Manual Research)
Reads directly from your Google Sheets — no DataForSEO.

**Sheet3** (Keyword Inventory — City of Industry tab):
Keyword, Volume, KD, Presence in SERPROBOT List?

**Sheet4** (clean list — SERPROBOT):
Keyword, Latest rank, L-Vol, G-Vol

Enrichment cross-references both sheets.
Skips keywords already ranking **#1–4**.
Prioritises **#5–30** opportunities.`,
      color: 5,
    },
  });

  nodes.push({
    id: 'note-ai',
    name: 'Note: AI + Research',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [840, -40],
    parameters: {
      content: `## 🤖 AI + Research
**AI**: Claude claude-opus-4-6 (native Anthropic API)
Set credentials in n8n: *anthropicApi*

**Research**: SerpAPI
- Pre-content SERP call enriches keyword with top results + PAA
- SerpAPI also available as live tool inside TOC + EEAT agents
Set env var: \`SERP_API_KEY\` in n8n

**Output**: Google Docs + status → Sheet3 Content Pipeline tab
Site: ${SITE_URL} (Lovable.dev — review Docs then publish)`,
      color: 4,
    },
  });

  // ── Connections ────────────────────────────────────────────────────────────

  // Triggers
  conn('Schedule Trigger',        'ABB Keyword Inventory');
  conn('Manual Trigger',          'ABB Keyword Inventory');

  // Keyword pipeline
  conn('ABB Keyword Inventory',   'Merge Keyword Sources', 0, 0);
  conn('SERPROBOT Rankings',       'Merge Keyword Sources', 0, 1);
  conn('Merge Keyword Sources',   'Enrich Keywords');
  conn('Enrich Keywords',         'Score Keywords');
  conn('Score Keywords',          'Sort by Score');
  conn('Sort by Score',           'Top 3 Keywords');
  conn('Top 3 Keywords',          'Loop Over Items');

  // Loop → SERP research → content
  conn('Loop Over Items',         'SerpAPI SERP Research', 0, 0);
  conn('SerpAPI SERP Research',   'Extract SERP Context');
  conn('Extract SERP Context',    'Table of Contents');
  conn('Table of Contents',       'Create Section Briefs');
  conn('Create Section Briefs',   'Split Out Sections');
  conn('Split Out Sections',      'Merge Sections',     0, 0);
  conn('Generate Section Content','Merge Sections',     0, 1);
  conn('Merge Sections',          'Aggregate Sections');

  // Aggregate → editorial
  conn('Aggregate Sections',      'Content Editor');
  conn('Content Editor',          'EEAT Enhancement');
  conn('EEAT Enhancement',        'Final Article Assembly');
  conn('Final Article Assembly',  'Title Maker');
  conn('Title Maker',             'Generate Blog Metadata');

  // Docs + status (no image generation)
  conn('Generate Blog Metadata',  'Create Article Google Doc');
  conn('Create Article Google Doc','Update Content Status');
  conn('Update Content Status',   'Loop Over Items');  // loop back

  return {
    name: 'Angels Bail Bonds — SEO Content Generator',
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
      saveManualExecutions: true,
      callerPolicy: 'workflowsFromSameOwner',
    },
  };
}

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Building Angels Bail Bonds SEO workflow...');
  const wf = buildWorkflow();
  console.log(`Nodes: ${wf.nodes.length}`);

  const result = await n8nPost('/workflows', wf);
  console.log('\n✅ Workflow created!');
  console.log(`ID:   ${result.id}`);
  console.log(`Name: ${result.name}`);
  console.log(`URL:  ${N8N_BASE_URL}/workflow/${result.id}`);
  console.log('\nCredentials to connect in n8n:');
  console.log('  • anthropicApi   → Claude claude-opus-4-6');
  console.log('  • SERP_API_KEY   → add to n8n environment variables');
  console.log('  • googleSheetsOAuth2Api → Google Sheets (both keyword sheets)');
  console.log('  • googleDocsOAuth2Api   → Google Docs (article output)');
  console.log('  • googleDriveOAuth2Api  → Google Drive (image storage)');
  console.log('  (Image generation not included — add manually when ready)');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
