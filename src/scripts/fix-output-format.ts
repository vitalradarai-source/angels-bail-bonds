import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

// ── WHAT WE ARE FIXING ────────────────────────────────────────────────────────
//
//  PROBLEM 1: Claude outputs markdown (#, ##, **, ---) instead of HTML
//  WHY: The prompt stored inside n8n still says "format as clean markdown"
//       The .md files on disk were updated, but the n8n workflow was never updated.
//       Think of it like updating a recipe on your computer but the chef is still
//       reading the old printed recipe on the wall.
//
//  PROBLEM 2: Even if we fix Claude, different places need different formats:
//    - Email    → needs HTML (Gmail renders HTML, looks beautiful)
//    - ClickUp  → needs plain text (their API stores plain text in description)
//    - Google Docs → needs plain text (insertText API only accepts plain text)
//
//  THE FIX:
//  Step 1: Tell Claude to output HTML (update the prompts in the Prepare node)
//  Step 2: In the Format node, also create a "plain text" version by stripping
//          HTML tags — this is used for ClickUp and Google Docs
//  Step 3: Update Google Docs to use the plain text version
//  Step 4: Update ClickUp to use clean plain text description

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

// ── FIX 1: PREPARE NODE — UPDATE PROMPTS TO OUTPUT HTML ──────────────────────
const prepareIdx = workflow.nodes.findIndex((n: any) => n.name === "Prepare: Detect Type & Build Prompt");
if (prepareIdx !== -1) {
  // The SEO master prompt — updated to:
  // 1. Output HTML not markdown
  // 2. Include TLDR section (plain English bullets first)
  // 3. Include FAQ section (plain English Q&A last)
  const seoPrompt = `You are a senior SEO strategist with 15+ years of experience specializing in local service businesses, emergency services, and high-intent verticals. You have deep expertise in the bail bonds industry, local search optimization, Google Business Profile, and competitive keyword analysis in California markets.

---

## BUSINESS CONTEXT

- **Business:** Angel's Bail Bonds
- **Website:** www.angelsbailbonds.com
- **Industry:** Bail Bonds — Local Emergency Legal Service
- **Service Area:** California (multiple cities and counties)
- **Customer Profile:** Person in urgent need, searching on mobile, ready to call immediately
- **Primary Conversion Goal:** Phone call or form submission within minutes of search
- **Competition Level:** Extremely high — bail bonds is one of the most competitive local service niches in California
- **Average Deal Value:** High (bond fees are 10% of bail amount, often $500–$5,000+)

---

## YOUR TASK

Analyze the attached SpyFu SEO keyword report for www.angelsbailbonds.com.
Provide a comprehensive, data-driven SEO strategy with specific, actionable recommendations.

---

## REQUIRED SECTIONS — OUTPUT IN THIS EXACT ORDER

### SECTION 0 — TLDR (OUTPUT THIS FIRST)
Write 3-5 bullet points in plain English that a non-technical business owner can understand in 30 seconds. No jargon. Pretend you are texting a friend who runs a bail bonds business.
Example style: "Your website is invisible when someone Googles 'bail bonds near me' — that's costing you phone calls every day."

### 1. EXECUTIVE SUMMARY
- Current SEO health in 3-4 sentences
- Single biggest opportunity identified from the data
- Most urgent risk or issue to address
- Overall competitive position vs top 3 rivals

### 2. KEYWORD OPPORTUNITY MATRIX
Quick Wins (currently ranking 11-30, volume over 50/mo, low-medium competition)
High-Value Targets (volume over 200/mo, achievable rank 1-5 within 90 days)
Long-Tail Gold (high intent, conversion-focused, lower competition)
Declining Keywords (previously ranked, now dropping — urgent recovery needed)

### 3. COMPETITIVE INTELLIGENCE
- Top 3 competitors dominating keywords Angel's Bail Bonds should own
- Specific content gaps vs those competitors
- Keywords competitors rank for that Angel's does not
- Backlink or authority opportunities identified

### 4. LOCAL SEO BREAKDOWN
- City/county-specific keyword opportunities
- "Near me" and geo-modifier keyword patterns
- Google Business Profile keyword alignment recommendations

### 5. CONTENT STRATEGY (Top 5 Priorities)
For each: target keyword, page type, monthly search volume, content angle, internal linking opportunity

### 6. PRIORITY ACTION PLAN
Red — CRITICAL: Do This Week (high impact, low effort)
Yellow — HIGH PRIORITY: Do This Month (high impact, medium effort)
Green — 90-DAY PLAN (high impact, higher effort)

### 7. METRICS AND BENCHMARKS
- 3 KPIs to track
- Specific benchmark targets for the next SpyFu report
- What "winning" looks like in 90 days

### SECTION 8 — FAQ (OUTPUT THIS LAST)
Write 5 questions and answers a non-technical business owner would ask after reading this report. Keep answers to 2-3 sentences. Use plain language. No jargon.

---

## CRITICAL STYLE RULES

- ONLY output clean HTML using these tags: <h1> <h2> <h3> <p> <strong> <ul> <li> <ol> <br>
- Do NOT use any markdown symbols: no # no ## no ** no * no --- no backticks
- Be specific — reference actual keywords and numbers from the report
- Write for someone who has NEVER heard of SEO before — explain all terms
- End with one sentence: the single highest-ROI action to take today
`;

  const ppcPrompt = `You are a senior Google Ads and PPC strategist with 15+ years of experience in high-CPC emergency service verticals including bail bonds, legal services, and personal injury. You understand that bail bonds Google Ads campaigns operate in one of the most expensive local niches ($15-$60+ CPC) and every dollar must drive a phone call.

---

## BUSINESS CONTEXT

- **Business:** Angel's Bail Bonds
- **Website:** www.angelsbailbonds.com
- **Industry:** Bail Bonds — Local Emergency Legal Service
- **Service Area:** California (multiple cities and counties)
- **Customer Behavior:** Emergency need → immediate Google search on mobile → calls within 2 minutes of clicking
- **Primary Goal:** Inbound phone calls (not form fills — calls close faster)
- **Average Deal Value:** $500-$5,000+ (10% of bail amount)
- **Competition:** Extremely high CPC — competitors spend heavily, ads run 24/7

---

## YOUR TASK

Analyze the attached SpyFu PPC/keyword report for www.angelsbailbonds.com.
Provide a complete paid search strategy with specific, actionable campaign recommendations.

---

## REQUIRED SECTIONS — OUTPUT IN THIS EXACT ORDER

### SECTION 0 — TLDR (OUTPUT THIS FIRST)
Write 3-5 bullet points in plain English that a non-technical business owner can understand in 30 seconds. No jargon. Pretend you are texting a friend who runs a bail bonds business.
Example style: "Your competitors are spending $5,000/month on Google Ads and showing up before you every time someone searches for bail bonds."

### 1. EXECUTIVE SUMMARY
- Current PPC competitive landscape in 3-4 sentences
- Biggest paid search opportunity from the data
- Estimated monthly competitor ad spend in this niche
- Angel's current paid visibility vs. top competitors

### 2. COMPETITOR PPC INTELLIGENCE
- Top 3-5 competitors running paid ads on our keywords
- Estimated monthly budgets per competitor
- Their most-used ad copy themes and angles
- Keywords they are bidding on that we are missing

### 3. KEYWORD BID STRATEGY
Must-Bid Keywords (high intent, proven converters in bail bonds)
Opportunity Keywords (decent volume, lower competition than top terms)
Keywords to Avoid (high CPC, low conversion intent)
Negative Keywords List (at least 15 specific negatives for bail bonds campaigns)

### 4. AD COPY STRATEGY
- Top 3 headline frameworks that convert in bail bonds
- Unique selling point angles to test (speed, trust, price)
- Recommended ad extensions (call, sitelink, callout, location)

### 5. CAMPAIGN STRUCTURE
- Recommended campaign and ad group layout
- Geographic targeting priorities
- Device targeting (mobile bid adjustments)
- Dayparting recommendations

### 6. BUDGET ALLOCATION
- Recommended starting monthly budget (conservative, medium, aggressive)
- Budget split by campaign type
- Recommended bid strategy
- Expected cost-per-call range at each budget level

### 7. PRIORITY ACTION PLAN
Red — LAUNCH THIS WEEK (highest ROI probability)
Yellow — OPTIMIZE THIS MONTH (bid adjustments, A/B tests)
Green — SCALE IN 90 DAYS (expand locations, new match types, remarketing)

### 8. ROI PROJECTIONS
- Expected monthly clicks at recommended budget
- Expected calls
- Projected cost per call
- Break-even analysis

### SECTION 9 — FAQ (OUTPUT THIS LAST)
Write 5 questions and answers a non-technical business owner would ask after reading this report. Keep answers to 2-3 sentences. Use plain language. No jargon.

---

## CRITICAL STYLE RULES

- ONLY output clean HTML using these tags: <h1> <h2> <h3> <p> <strong> <ul> <li> <ol> <br>
- Do NOT use any markdown symbols: no # no ## no ** no * no --- no backticks
- Be specific — reference actual competitor names, keywords, and CPC figures from the report
- Mobile-first mindset — most bail bonds searches happen on phones at night
- Write for someone who has NEVER run Google Ads before — explain all terms
- End with one sentence: the single highest-ROI paid action to take today
`;

  // Rebuild the Prepare node code with the updated prompts
  // We replace the entire jsCode with a cleaner version
  workflow.nodes[prepareIdx].parameters.jsCode = [
    "var subject = $('Extract PDF URL').first().json.emailSubject || '';",
    "var reportType = subject.toLowerCase().indexOf('ppc') !== -1 ? 'PPC' : 'SEO';",
    "",
    "var seoPrompt = " + JSON.stringify(seoPrompt) + ";",
    "var ppcPrompt = " + JSON.stringify(ppcPrompt) + ";",
    "var masterPrompt = reportType === 'PPC' ? ppcPrompt : seoPrompt;",
    "",
    "var pdfBase64 = $json.pdfBase64 || '';",
    "",
    "return {",
    "  reportType: reportType,",
    "  masterPrompt: masterPrompt,",
    "  pdfBase64: pdfBase64,",
    "  pdfBase64Length: pdfBase64.length,",
    "  subject: subject,",
    "  receivedAt: new Date().toISOString()",
    "};",
  ].join("\n");

  console.log("✅ Fix 1: Prepare node prompts updated — Claude will now output HTML with TLDR + FAQ");
}

// ── FIX 2: FORMAT NODE — ADD PLAIN TEXT VERSION FOR DOCS + CLICKUP ──────────
//
//  Claude now outputs HTML like: <h1>Title</h1><p>Content</p><strong>Bold</strong>
//
//  Email loves HTML — it renders beautifully.
//  But Google Docs insertText and ClickUp description just need PLAIN TEXT.
//
//  So we strip HTML tags in the Format node:
//    <h1>Title</h1>  →  Title
//    <strong>Bold</strong>  →  Bold
//    <li>Item</li>  →  • Item
//    <p>Text</p>  →  Text\n
//
//  This gives clean, readable text with no stray symbols.

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

// analysisHtml — used in the email (Gmail renders HTML natively)
const analysisHtml = rawAnalysis;

// analysisPlain — used in Google Docs and ClickUp (plain text, no symbols)
// We strip HTML tags and convert common elements to readable text
const analysisPlain = rawAnalysis
  // Convert list items to bullet points before stripping tags
  .replace(/<li[^>]*>/gi, '• ')
  .replace(/<\\/li>/gi, '\\n')
  // Add newlines after block elements
  .replace(/<\\/(h1|h2|h3|h4|p|div|br)>/gi, '\\n')
  .replace(/<br\\s*\\/?>/gi, '\\n')
  // Strip all remaining HTML tags
  .replace(/<[^>]+>/g, '')
  // Clean up HTML entities
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"')
  // Collapse 3+ blank lines into 2 max
  .replace(/\\n{3,}/g, '\\n\\n')
  .trim();

const taskName = \`SpyFu \${reportType} Report — \${date}\`;

// ClickUp description: short header + plain text analysis
const taskDescription = \`SpyFu \${reportType} Analysis\\nReceived: \${date}\\nAnalyzed by: Claude AI\\n\\n\${analysisPlain}\`;

return {
  taskName,
  taskDescription,
  reportType,
  analysisHtml,
  analysisPlain,
  // Keep 'analysis' pointing to HTML for email compatibility
  analysis: analysisHtml,
  date,
};
`;
  console.log("✅ Fix 2: Format node updated — now produces both HTML (email) and plain text (Docs + ClickUp)");
}

// ── FIX 3: GOOGLE DOCS WRITE CONTENT — USE PLAIN TEXT ────────────────────────
const docsWriteIdx = workflow.nodes.findIndex((n: any) => n.name === "Google Docs: Write Content");
if (docsWriteIdx !== -1) {
  workflow.nodes[docsWriteIdx].parameters.body = [
    "={{ JSON.stringify({",
    "  requests: [{",
    "    insertText: {",
    "      location: { index: 1 },",
    "      text: $('Format Report Output').first().json.analysisPlain",
    "    }",
    "  }]",
    "}) }}",
  ].join("\n");
  console.log("✅ Fix 3: Google Docs Write Content — now inserts plain text (no HTML tags, no markdown symbols)");
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
  console.log("\nSummary of what will happen next run:");
  console.log("  📧 Email      → beautiful HTML with headings, bold, bullet points");
  console.log("  📋 ClickUp    → clean plain text, no # or ** symbols");
  console.log("  📄 Google Docs → clean plain text, no # or ** symbols");
  console.log("  🤖 Claude     → told to output HTML + TLDR at top + FAQ at bottom");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
