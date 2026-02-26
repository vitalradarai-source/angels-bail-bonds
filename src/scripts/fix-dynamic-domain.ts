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
//  PROBLEM: The prompts have "Angel's Bail Bonds" and "angelsbailbonds.com"
//  hardcoded in them. So when a SpyFu report for reenergized.com arrives,
//  Claude writes a report "for Angel's Bail Bonds" — completely wrong.
//
//  Think of it like a mail merge template that forgot to use the variable:
//    "Dear [NAME]" works → "Dear Angel's Bail Bonds" always = broken
//
//  THE FIX:
//  1. Extract the domain from the SpyFu email subject
//     SpyFu subjects look like: "Your SpyFu SEO report for reenergized.com"
//     We grab the domain using a simple pattern match.
//
//  2. Make the prompts GENERIC — pass the domain dynamically
//     Claude is smart enough to figure out the industry from the PDF data.
//     We don't need to hardcode "bail bonds" — Claude will read the PDF
//     and understand what kind of business it is.
//
//  3. This means the workflow now works for ANY website you schedule in SpyFu:
//     - angelsbailbonds.com → bail bonds report
//     - reenergized.com     → wellness spa report
//     - any-site.com        → whatever that business is

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

// ── SEO PROMPT — NOW GENERIC, DOMAIN PASSED IN ───────────────────────────────
const seoPrompt = `You are a senior SEO strategist with 15+ years of experience specializing in local service businesses, competitive keyword analysis, and Google Business Profile optimization across all industries and markets.

ANALYZING: {{WEBSITE}}

YOUR TASK:
Look at the SpyFu SEO report attached for {{WEBSITE}}.
First, identify what kind of business this is from the data in the report (industry, location, services).
Then provide a comprehensive, data-driven SEO strategy tailored specifically to that business type.

OUTPUT THESE SECTIONS IN THIS EXACT ORDER:

SECTION 0 — TLDR (PUT THIS FIRST):
Write 3-5 bullet points in plain English that a non-technical business owner can understand in 30 seconds. No jargon. Pretend you are texting the owner of {{WEBSITE}} who has never heard of SEO.
Start by briefly stating what type of business this appears to be based on the data.

SECTION 1 — EXECUTIVE SUMMARY:
- What type of business is {{WEBSITE}} and what is their market (local, national, e-commerce, etc.)
- Current SEO health in 3-4 sentences based on the data
- Single biggest opportunity identified from the data
- Most urgent risk or issue to address
- Overall competitive position vs top 3 rivals

SECTION 2 — KEYWORD OPPORTUNITY MATRIX:
Quick Wins (currently ranking 11-30, volume over 50 per month, low-medium competition)
High-Value Targets (volume over 200 per month, achievable rank 1-5 within 90 days)
Long-Tail Gold (high intent, conversion-focused, lower competition)
Declining Keywords (previously ranked, now dropping — urgent recovery needed)

SECTION 3 — COMPETITIVE INTELLIGENCE:
- Top 3 competitors dominating keywords {{WEBSITE}} should own
- Specific content gaps vs those competitors
- Keywords competitors rank for that {{WEBSITE}} does not
- Backlink or authority opportunities identified

SECTION 4 — LOCAL SEO BREAKDOWN (if applicable):
- City and region-specific keyword opportunities based on the data
- Near me and geo-modifier keyword patterns
- Google Business Profile keyword alignment recommendations

SECTION 5 — CONTENT STRATEGY (Top 5 Priorities):
For each: target keyword, page type, monthly search volume, content angle, internal linking opportunity

SECTION 6 — PRIORITY ACTION PLAN:
Red — CRITICAL: Do This Week (high impact, low effort)
Yellow — HIGH PRIORITY: Do This Month (high impact, medium effort)
Green — 90-DAY PLAN (high impact, higher effort)

SECTION 7 — METRICS AND BENCHMARKS:
- 3 KPIs to track
- Specific benchmark targets for the next SpyFu report
- What winning looks like in 90 days

SECTION 8 — FAQ (PUT THIS LAST):
Write 5 questions and answers the business owner of {{WEBSITE}} would ask after reading this report. Keep answers to 2-3 sentences. Use plain language. No jargon.

CRITICAL OUTPUT RULES — READ CAREFULLY:
1. Start your response DIRECTLY with an HTML tag. Your very first character must be a less-than sign.
2. Do NOT start with a code block. Do NOT write the word html before your content.
3. Do NOT include html, head, body, or style tags.
4. Do NOT include any CSS code.
5. ONLY use these HTML tags: h1 h2 h3 p strong ul ol li br hr
6. Do NOT use any markdown symbols: no pound signs, no asterisks, no dashes as separators.
7. Be specific — reference actual keywords and numbers from the SpyFu report.
8. Tailor all advice to the specific industry and business type you identify from the data.
9. End with one sentence: the single highest-ROI action to take today for {{WEBSITE}}.`;

// ── PPC PROMPT — NOW GENERIC, DOMAIN PASSED IN ───────────────────────────────
const ppcPrompt = `You are a senior Google Ads and PPC strategist with 15+ years of experience across all industries including local services, e-commerce, lead generation, and emergency service verticals.

ANALYZING: {{WEBSITE}}

YOUR TASK:
Look at the SpyFu PPC report attached for {{WEBSITE}}.
First, identify what kind of business this is from the data in the report (industry, location, services, typical customer intent).
Then provide a complete paid search strategy tailored specifically to that business type.

OUTPUT THESE SECTIONS IN THIS EXACT ORDER:

SECTION 0 — TLDR (PUT THIS FIRST):
Write 3-5 bullet points in plain English that a non-technical business owner can understand in 30 seconds. No jargon. Pretend you are texting the owner of {{WEBSITE}}.
Start by briefly stating what type of business this appears to be based on the data.

SECTION 1 — EXECUTIVE SUMMARY:
- What type of business is {{WEBSITE}} and what paid search landscape do they operate in
- Current PPC competitive landscape in 3-4 sentences
- Biggest paid search opportunity from the data
- Estimated monthly competitor ad spend in this niche
- {{WEBSITE}} current paid visibility vs. top competitors

SECTION 2 — COMPETITOR PPC INTELLIGENCE:
- Top 3-5 competitors running paid ads on relevant keywords
- Estimated monthly budgets per competitor
- Their most-used ad copy themes and angles
- Keywords they are bidding on that {{WEBSITE}} is missing

SECTION 3 — KEYWORD BID STRATEGY:
Must-Bid Keywords (high intent, proven converters for this type of business)
Opportunity Keywords (decent volume, lower competition than top terms)
Keywords to Avoid (high CPC, low conversion intent)
Negative Keywords List (at least 15 specific negatives for this industry)

SECTION 4 — AD COPY STRATEGY:
- Top 3 headline frameworks that convert for this type of business
- Unique selling point angles to test
- Recommended ad extensions (call, sitelink, callout, location if applicable)

SECTION 5 — CAMPAIGN STRUCTURE:
- Recommended campaign and ad group layout for this business type
- Geographic targeting recommendations based on the data
- Device targeting recommendations
- Dayparting recommendations

SECTION 6 — BUDGET ALLOCATION:
- Recommended starting monthly budget (conservative, medium, aggressive)
- Budget split by campaign type
- Recommended bid strategy
- Expected cost-per-lead or cost-per-sale range at each budget level

SECTION 7 — PRIORITY ACTION PLAN:
Red — LAUNCH THIS WEEK (highest ROI probability)
Yellow — OPTIMIZE THIS MONTH (bid adjustments, A/B tests)
Green — SCALE IN 90 DAYS (expand targeting, new match types, remarketing)

SECTION 8 — ROI PROJECTIONS:
- Expected monthly clicks at recommended budget
- Expected conversions (calls, leads, or sales depending on business type)
- Projected cost per conversion
- Break-even analysis

SECTION 9 — FAQ (PUT THIS LAST):
Write 5 questions and answers the business owner of {{WEBSITE}} would ask after reading this report. Keep answers to 2-3 sentences. Use plain language. No jargon.

CRITICAL OUTPUT RULES — READ CAREFULLY:
1. Start your response DIRECTLY with an HTML tag. Your very first character must be a less-than sign.
2. Do NOT start with a code block. Do NOT write the word html before your content.
3. Do NOT include html, head, body, or style tags.
4. Do NOT include any CSS code.
5. ONLY use these HTML tags: h1 h2 h3 p strong ul ol li br hr
6. Do NOT use any markdown symbols: no pound signs, no asterisks, no dashes as separators.
7. Be specific — reference actual competitor names, keywords, and CPC figures from the report.
8. Tailor all advice to the specific industry and business type you identify from the data.
9. End with one sentence: the single highest-ROI paid action to take today for {{WEBSITE}}.`;

// ── REBUILD PREPARE NODE — WITH DYNAMIC DOMAIN EXTRACTION ────────────────────
//
//  SpyFu email subjects look like one of these:
//    "Your SpyFu SEO report for reenergized.com is ready"
//    "SpyFu Domain Overview: reenergized.com"
//    "SpyFu PPC Report - angelsbailbonds.com"
//
//  We use a simple regex to find the domain: any word.tld pattern
//  Then we replace {{WEBSITE}} in both prompts with the actual domain

const newJsCode = [
  "var subject = $('Extract PDF URL').first().json.emailSubject || '';",
  "var reportType = subject.toLowerCase().indexOf('ppc') !== -1 ? 'PPC' : 'SEO';",
  "",
  "// Extract domain from SpyFu email subject",
  "// SpyFu subjects always mention the domain being analyzed",
  "// Pattern: find something that looks like a website address (word.extension)",
  "var domainMatch = subject.match(/([a-zA-Z0-9][a-zA-Z0-9-]*\\.[a-zA-Z]{2,}(?:\\.[a-zA-Z]{2,})?)/);",
  "var website = domainMatch ? domainMatch[1].toLowerCase() : 'the website';",
  "// Remove www. prefix if present",
  "website = website.replace(/^www\\./, '');",
  "// Make sure it's not 'spyfu.com' itself (sometimes it appears in the subject)",
  "if (website === 'spyfu.com') {",
  "  // Try to find the second domain match",
  "  var allMatches = subject.match(/([a-zA-Z0-9][a-zA-Z0-9-]*\\.[a-zA-Z]{2,})/g) || [];",
  "  website = allMatches.find(function(d) { return d !== 'spyfu.com'; }) || 'the website';",
  "}",
  "",
  "var seoPrompt = " + JSON.stringify(seoPrompt) + ";",
  "var ppcPrompt = " + JSON.stringify(ppcPrompt) + ";",
  "",
  "// Replace the {{WEBSITE}} placeholder with the actual domain",
  "var masterPrompt = reportType === 'PPC' ? ppcPrompt : seoPrompt;",
  "masterPrompt = masterPrompt.replace(/\\{\\{WEBSITE\\}\\}/g, website);",
  "",
  "var pdfBase64 = $json.pdfBase64 || '';",
  "",
  "return {",
  "  reportType: reportType,",
  "  masterPrompt: masterPrompt,",
  "  website: website,",
  "  pdfBase64: pdfBase64,",
  "  pdfBase64Length: pdfBase64.length,",
  "  subject: subject,",
  "  receivedAt: new Date().toISOString()",
  "};",
].join("\n");

const prepareIdx = workflow.nodes.findIndex((n: any) => n.name === "Prepare: Detect Type & Build Prompt");
if (prepareIdx !== -1) {
  workflow.nodes[prepareIdx].parameters.jsCode = newJsCode;
  console.log("✅ Prepare node updated — domain extracted dynamically from email subject");
}

// ── UPDATE FORMAT NODE — USE DYNAMIC WEBSITE IN TASK NAME ────────────────────
//
//  The ClickUp task name and Google Doc title should also show the domain,
//  not hardcoded "SpyFu SEO Report". Example:
//    "SpyFu SEO Report — reenergized.com — February 26, 2026"

const formatIdx = workflow.nodes.findIndex((n: any) => n.name === "Format Report Output");
if (formatIdx !== -1) {
  const currentCode: string = workflow.nodes[formatIdx].parameters.jsCode;
  // Update taskName to include the website domain
  const updatedCode = currentCode.replace(
    "const taskName = `SpyFu ${reportType} Report — ${date}`;",
    [
      "const website = $('Prepare: Detect Type & Build Prompt').first().json.website || '';",
      "  const websiteLabel = website && website !== 'the website' ? ` — ${website}` : '';",
      "  const taskName = `SpyFu ${reportType} Report${websiteLabel} — ${date}`;",
    ].join("\n  ")
  );
  workflow.nodes[formatIdx].parameters.jsCode = updatedCode;
  console.log("✅ Format node updated — task name now includes domain (e.g. 'SpyFu SEO Report — reenergized.com — Feb 26')");
}

// ── PUSH BACK ─────────────────────────────────────────────────────────────────
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
  console.log("\n✅ Workflow saved!");
  console.log("\nNow works for any SpyFu report:");
  console.log("  SpyFu report for reenergized.com  → 'SEO Strategy for reenergized.com'");
  console.log("  SpyFu report for angelsbailbonds.com → 'SEO Strategy for angelsbailbonds.com'");
  console.log("  SpyFu report for any-site.com     → 'SEO Strategy for any-site.com'");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
