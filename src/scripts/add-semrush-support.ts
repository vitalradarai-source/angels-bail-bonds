import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;
const WORKFLOW_ID = "9Xw3q2PtO1LPC4JH";

// ── WHAT WE ARE ADDING ────────────────────────────────────────────────────────
//
//  The SpyFu workflow currently only handles SpyFu emails.
//  This script extends it to also handle SEMrush PDF reports.
//
//  HOW IT WORKS:
//  1. You email yourself with subject like:
//       "SEMrush SEO Report for angelsbailbonds.com" + PDF attached
//       "SEMrush PPC Report for angelsbailbonds.com" + PDF attached
//
//  2. The Gmail trigger picks it up
//
//  3. The updated Filter lets it through (subject contains "spyfu" OR "semrush")
//
//  4. The updated Prepare node detects the source and uses the right prompt:
//       SpyFu email  → SpyFu-specific analysis prompt
//       SEMrush email → SEMrush-specific analysis prompt
//
//  5. Claude reads the PDF and writes a full SEO or PPC strategy report
//
//  6. ClickUp task created:
//       "SEMrush SEO Report — angelsbailbonds.com — Feb 27, 2026"

const getRes = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": N8N_API_KEY },
});
const workflow = await getRes.json();
if (!getRes.ok) { console.error("❌", workflow); process.exit(1); }
console.log("✅ Fetched:", workflow.name);

// ── SEMrush SEO PROMPT ────────────────────────────────────────────────────────
const semrushSeoPrompt = `You are a senior SEO strategist with 15+ years of experience specializing in local service businesses, competitive keyword analysis, and Google Business Profile optimization across all industries and markets.

ANALYZING: {{WEBSITE}}
DATA SOURCE: SEMrush

YOUR TASK:
Look at the SEMrush SEO report attached for {{WEBSITE}}.
First, identify what kind of business this is from the data in the report (industry, location, services).
Then provide a comprehensive, data-driven SEO strategy tailored specifically to that business type.

OUTPUT THESE SECTIONS IN THIS EXACT ORDER:

SECTION 0 — TLDR (PUT THIS FIRST):
Write 3-5 bullet points in plain English that a non-technical business owner can understand in 30 seconds. No jargon. Pretend you are texting the owner of {{WEBSITE}} who has never heard of SEO.
Start by briefly stating what type of business this appears to be based on the data.

SECTION 1 — EXECUTIVE SUMMARY:
- What type of business is {{WEBSITE}} and what is their market (local, national, e-commerce, etc.)
- Current SEO health in 3-4 sentences based on the SEMrush data
- Single biggest opportunity identified from the data
- Most urgent risk or issue to address
- Overall competitive position vs top 3 rivals

SECTION 2 — KEYWORD OPPORTUNITY MATRIX:
Quick Wins (currently ranking 11-30, volume over 50 per month, low-medium competition)
High-Value Targets (volume over 200 per month, achievable rank 1-5 within 90 days)
Long-Tail Gold (high intent, conversion-focused, lower competition)
Declining Keywords (previously ranked, now dropping — urgent recovery needed)
Reference actual keyword difficulty scores and search volumes from the SEMrush data.

SECTION 3 — ORGANIC TRAFFIC ANALYSIS:
- Current estimated monthly organic traffic from SEMrush
- Top traffic-driving pages and their keywords
- Traffic trend (growing, declining, stable) based on the data
- Biggest traffic opportunity pages to optimize

SECTION 4 — COMPETITIVE INTELLIGENCE:
- Top 3 competitors dominating keywords {{WEBSITE}} should own
- Specific content gaps vs those competitors
- Keywords competitors rank for that {{WEBSITE}} does not
- Backlink authority comparison (Domain Authority / Authority Score if shown)

SECTION 5 — LOCAL SEO BREAKDOWN (if applicable):
- City and region-specific keyword opportunities based on the data
- Near me and geo-modifier keyword patterns
- Google Business Profile keyword alignment recommendations

SECTION 6 — BACKLINK PROFILE (if data available):
- Current backlink count and quality overview
- Toxic or low-quality links to disavow
- Top link-building opportunities identified

SECTION 7 — CONTENT STRATEGY (Top 5 Priorities):
For each: target keyword, page type, monthly search volume, content angle, internal linking opportunity

SECTION 8 — PRIORITY ACTION PLAN:
Red — CRITICAL: Do This Week (high impact, low effort)
Yellow — HIGH PRIORITY: Do This Month (high impact, medium effort)
Green — 90-DAY PLAN (high impact, higher effort)

SECTION 9 — METRICS AND BENCHMARKS:
- 3 KPIs to track
- Specific benchmark targets for the next SEMrush report
- What winning looks like in 90 days

SECTION 10 — FAQ (PUT THIS LAST):
Write 5 questions and answers the business owner of {{WEBSITE}} would ask after reading this report. Keep answers to 2-3 sentences. Use plain language. No jargon.

CRITICAL OUTPUT RULES — READ CAREFULLY:
1. Start your response DIRECTLY with an HTML tag. Your very first character must be a less-than sign.
2. Do NOT start with a code block. Do NOT write the word html before your content.
3. Do NOT include html, head, body, or style tags.
4. Do NOT include any CSS code.
5. ONLY use these HTML tags: h1 h2 h3 p strong ul ol li br hr
6. Do NOT use any markdown symbols: no pound signs, no asterisks, no dashes as separators.
7. Be specific — reference actual keywords, traffic numbers, and scores from the SEMrush report.
8. Tailor all advice to the specific industry and business type you identify from the data.
9. End with one sentence: the single highest-ROI action to take today for {{WEBSITE}}.`;

// ── SEMrush PPC PROMPT ────────────────────────────────────────────────────────
const semrushPpcPrompt = `You are a senior Google Ads and PPC strategist with 15+ years of experience across all industries including local services, e-commerce, lead generation, and emergency service verticals.

ANALYZING: {{WEBSITE}}
DATA SOURCE: SEMrush

YOUR TASK:
Look at the SEMrush PPC report attached for {{WEBSITE}}.
First, identify what kind of business this is from the data in the report (industry, location, services, typical customer intent).
Then provide a complete paid search strategy tailored specifically to that business type.

OUTPUT THESE SECTIONS IN THIS EXACT ORDER:

SECTION 0 — TLDR (PUT THIS FIRST):
Write 3-5 bullet points in plain English that a non-technical business owner can understand in 30 seconds. No jargon. Pretend you are texting the owner of {{WEBSITE}}.
Start by briefly stating what type of business this appears to be based on the data.

SECTION 1 — EXECUTIVE SUMMARY:
- What type of business is {{WEBSITE}} and what paid search landscape do they operate in
- Current PPC competitive landscape in 3-4 sentences based on SEMrush data
- Biggest paid search opportunity from the data
- Estimated monthly competitor ad spend in this niche (use SEMrush traffic cost data)
- {{WEBSITE}} current paid visibility vs. top competitors

SECTION 2 — COMPETITOR PPC INTELLIGENCE:
- Top 3-5 competitors running paid ads on relevant keywords
- Estimated monthly budgets per competitor (from SEMrush traffic cost data)
- Their most-used ad copy themes and angles
- Keywords they are bidding on that {{WEBSITE}} is missing

SECTION 3 — KEYWORD BID STRATEGY:
Must-Bid Keywords (high intent, proven converters for this type of business)
Opportunity Keywords (decent volume, lower competition than top terms)
Keywords to Avoid (high CPC, low conversion intent)
Negative Keywords List (at least 15 specific negatives for this industry)
Reference actual CPC data from the SEMrush report.

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
7. Be specific — reference actual competitor names, keywords, and CPC figures from the SEMrush report.
8. Tailor all advice to the specific industry and business type you identify from the data.
9. End with one sentence: the single highest-ROI paid action to take today for {{WEBSITE}}.`;

// ── UPDATE FILTER NODE — ALLOW SpyFu OR SEMrush ───────────────────────────────
//
//  Old filter: checks sender email === "support@spyfu.com"
//  New filter: checks subject contains "spyfu" OR "semrush"
//
//  This means:
//    SpyFu auto-email    → subject has "spyfu"  → passes ✅
//    Your SEMrush email  → subject has "semrush" → passes ✅
//    All other emails    → blocked ❌

const filterIdx = workflow.nodes.findIndex((n: any) => n.name === "Filter: SpyFu Only");
if (filterIdx !== -1) {
  workflow.nodes[filterIdx].parameters = {
    conditions: {
      options: {
        caseSensitive: false,
        leftValue: "",
        typeValidation: "loose",
      },
      conditions: [
        {
          id: "condition-spyfu-or-semrush",
          leftValue: "={{ $json.subject }}",
          rightValue: "spyfu",
          operator: {
            type: "string",
            operation: "contains",
            singleValue: true,
          },
        },
        {
          id: "condition-semrush-subject",
          leftValue: "={{ $json.subject }}",
          rightValue: "semrush",
          operator: {
            type: "string",
            operation: "contains",
            singleValue: true,
          },
        },
      ],
      combinator: "or",  // ← pass if EITHER condition matches
    },
    options: {},
  };
  console.log("✅ Filter updated — now passes SpyFu OR SEMrush emails");
}

// ── UPDATE PREPARE NODE — DETECT SOURCE + USE RIGHT PROMPT ───────────────────
//
//  The Prepare node now:
//  1. Detects whether the email is from SpyFu or SEMrush (by subject)
//  2. Detects SEO vs PPC (by subject)
//  3. Extracts the domain from the subject line
//  4. Picks the right prompt (spyfu-seo, spyfu-ppc, semrush-seo, semrush-ppc)
//  5. Replaces {{WEBSITE}} with the actual domain

const spyfuSeoPrompt = workflow.nodes.find((n: any) => n.name === "Prepare: Detect Type & Build Prompt")
  ?.parameters?.jsCode?.match(/var seoPrompt = ([\s\S]+?);[\n\r]/)?.[1] || null;

// Build the new Prepare node JS code
const newPrepareCode = [
  "var subject = $('Extract PDF URL').first().json.emailSubject || '';",
  "var subjectLower = subject.toLowerCase();",
  "",
  "// Detect source: SpyFu or SEMrush",
  "var source = subjectLower.indexOf('semrush') !== -1 ? 'SEMrush' : 'SpyFu';",
  "",
  "// Detect report type: PPC or SEO",
  "var reportType = subjectLower.indexOf('ppc') !== -1 ? 'PPC' : 'SEO';",
  "",
  "// Extract domain from subject line",
  "// Works for subjects like:",
  "//   'Your SpyFu SEO report for angelsbailbonds.com is ready'",
  "//   'SEMrush SEO Report for angelsbailbonds.com'",
  "var domainMatch = subject.match(/([a-zA-Z0-9][a-zA-Z0-9-]*\\.[a-zA-Z]{2,}(?:\\.[a-zA-Z]{2,})?)/);",
  "var website = domainMatch ? domainMatch[1].toLowerCase() : 'the website';",
  "website = website.replace(/^www\\./, '');",
  "// Make sure it's not 'spyfu.com' or 'semrush.com' itself",
  "var skipDomains = ['spyfu.com', 'semrush.com'];",
  "if (skipDomains.indexOf(website) !== -1) {",
  "  var allMatches = subject.match(/([a-zA-Z0-9][a-zA-Z0-9-]*\\.[a-zA-Z]{2,})/g) || [];",
  "  website = allMatches.find(function(d) { return skipDomains.indexOf(d) === -1; }) || 'the website';",
  "}",
  "",
  "// SpyFu prompts",
  "var spyfuSeoPrompt = " + JSON.stringify(
    // Reuse the existing SpyFu SEO prompt from the workflow
    workflow.nodes.find((n: any) => n.name === "Prepare: Detect Type & Build Prompt")
      ?.parameters?.jsCode?.match(/var seoPrompt = (["'`])([\s\S]*?)\1;/)?.[2] || ""
  ) + ";",
  "var spyfuPpcPrompt = " + JSON.stringify(
    workflow.nodes.find((n: any) => n.name === "Prepare: Detect Type & Build Prompt")
      ?.parameters?.jsCode?.match(/var ppcPrompt = (["'`])([\s\S]*?)\1;/)?.[2] || ""
  ) + ";",
  "",
  "// SEMrush prompts",
  "var semrushSeoPrompt = " + JSON.stringify(semrushSeoPrompt) + ";",
  "var semrushPpcPrompt = " + JSON.stringify(semrushPpcPrompt) + ";",
  "",
  "// Pick the right prompt based on source + type",
  "var masterPrompt;",
  "if (source === 'SEMrush' && reportType === 'PPC') {",
  "  masterPrompt = semrushPpcPrompt;",
  "} else if (source === 'SEMrush') {",
  "  masterPrompt = semrushSeoPrompt;",
  "} else if (reportType === 'PPC') {",
  "  masterPrompt = spyfuPpcPrompt;",
  "} else {",
  "  masterPrompt = spyfuSeoPrompt;",
  "}",
  "",
  "// Replace {{WEBSITE}} placeholder with actual domain",
  "masterPrompt = masterPrompt.replace(/\\{\\{WEBSITE\\}\\}/g, website);",
  "",
  "var pdfBase64 = $json.pdfBase64 || '';",
  "",
  "return {",
  "  source: source,",
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
  workflow.nodes[prepareIdx].parameters.jsCode = newPrepareCode;
  console.log("✅ Prepare node updated — detects SpyFu vs SEMrush, picks right prompt");
}

// ── UPDATE FORMAT NODE — INCLUDE SOURCE IN TASK NAME ─────────────────────────
//
//  Old: "SpyFu SEO Report — angelsbailbonds.com — Feb 27, 2026"
//  New: "SEMrush SEO Report — angelsbailbonds.com — Feb 27, 2026"
//       "SpyFu SEO Report — angelsbailbonds.com — Feb 27, 2026"

const formatIdx = workflow.nodes.findIndex((n: any) => n.name === "Format Report Output");
if (formatIdx !== -1) {
  let formatCode: string = workflow.nodes[formatIdx].parameters.jsCode;

  // Add source variable and update task name to use it
  if (!formatCode.includes("const source =")) {
    formatCode = formatCode.replace(
      "const reportType = $('Prepare: Detect Type & Build Prompt').first().json.reportType;",
      [
        "const reportType = $('Prepare: Detect Type & Build Prompt').first().json.reportType;",
        "  const source = $('Prepare: Detect Type & Build Prompt').first().json.source || 'SpyFu';",
      ].join("\n")
    );
  }

  // Update task name to use source instead of hardcoded "SpyFu"
  formatCode = formatCode.replace(
    /const taskName = `SpyFu \$\{reportType\}/,
    "const taskName = `${source} ${reportType}"
  );

  workflow.nodes[formatIdx].parameters.jsCode = formatCode;
  console.log("✅ Format node updated — task name now shows SEMrush or SpyFu as source");
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
  console.log("\n✅ Workflow saved! SEMrush support added.");
  console.log("\nHow to use:");
  console.log("  SpyFu  → arrives automatically by email as before");
  console.log("  SEMrush → email yourself with subject:");
  console.log("            'SEMrush SEO Report for angelsbailbonds.com' + PDF attached");
  console.log("            'SEMrush PPC Report for angelsbailbonds.com' + PDF attached");
  console.log("\nTask names will show:");
  console.log("  SpyFu SEO Report — angelsbailbonds.com — Feb 27, 2026");
  console.log("  SEMrush SEO Report — angelsbailbonds.com — Feb 27, 2026");
} else {
  console.error("❌", JSON.stringify(putData, null, 2));
}
