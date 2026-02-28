# Angel's Bail Bonds — Claude Project Memory

## Project Overview
- **Project:** Angel's Bail Bonds
- **Owner:** Emmanuel Pableo / Angelo Ferrer (4434lifeline@gmail.com)
- **GitHub:** https://github.com/vitalradarai-source/angels-bail-bonds
- **Local path:** ~/Workspaces/angels-bail-bonds/
- **ClickUp Space:** Angels Bail Bonds (Space ID: 90090599325, Team: Sean Plotkin's Team ID: 1293152)

## Setup Details
- Git auto-save: commits + pushes to GitHub every 5 minutes via cron
- Chat history saved to: ~/.claude/projects/-Users-emmanuelpableo/memory/
- Created: 2026-02-26

## Project Purpose
Bail bonds business management system — automating workflows, client management,
task tracking, and AI-powered operations for Angel's Bail Bonds.

## API Keys Connected (stored in .env — never committed)
| Service       | Env Var             | Status    |
|---------------|---------------------|-----------|
| Trigger.dev   | TRIGGER_SECRET_KEY  | Connected |
| n8n           | N8N_API_KEY         | Connected |
| n8n           | N8N_BASE_URL        | Connected |
| Anthropic     | ANTHROPIC_API_KEY   | Connected |
| Anthropic     | ANTHROPIC_MODEL     | `claude-opus-4-6` — used by all workflows and scripts project-wide |
| ClickUp       | CLICKUP_API_KEY     | Connected |
| SerpAPI       | SERP_API_KEY        | Connected — use for workflow research |
| SerpRobot     | SERPROBOT_API_KEY   | Connected — ⚠️ 10 paid credits only, free endpoints safe |
| Canva Apps SDK  | CANVA_APP_ID, CANVA_APP_ORIGIN | Connected |
| Canva Connect API | CANVA_CLIENT_ID, CANVA_CLIENT_SECRET | Connected — OAuth 2.0 + PKCE |

- n8n instance: https://n8n.srv1329589.hstgr.cloud
- Trigger.dev project ID: proj_ylumvpynnyjymaslqmhw (prod key)

## MCP Servers Built
Both registered in ~/.claude.json for this project. Restart Claude Code to activate.

### n8n MCP (`src/mcp/n8n-server.ts`)
Tools: list_workflows, get_workflow, set_workflow_active, list_executions, get_execution, trigger_webhook

### ClickUp MCP (`src/mcp/clickup-server.ts`)
Tools: list_spaces, list_folders, list_lists, list_tasks, get_task, create_task, update_task, search_tasks, add_comment

### Canva MCP (`src/mcp/canva-server.ts`)
Tools: canva_get_auth_url, canva_exchange_code, canva_get_user, canva_list_designs, canva_get_design, canva_create_design, canva_export_design, canva_list_assets, canva_get_asset
Note: OAuth flow required on first use — run canva_get_auth_url then canva_exchange_code

## Key Files & Structure
```
angels-bail-bonds/
├── .env                        # API keys (not on GitHub)
├── .gitignore                  # Protects .env and logs
├── trigger.config.ts           # Trigger.dev config
├── package.json                # Dependencies + mcp scripts
├── src/
│   ├── mcp/
│   │   ├── n8n-server.ts       # n8n MCP server
│   │   └── clickup-server.ts   # ClickUp MCP server
│   └── trigger/
│       └── example.ts          # Trigger.dev example task
├── CLAUDE.md                   # This file
└── README.md                   # GitHub overview
```

## Workflow Conventions
- Auto-save cron: every 5 min commits + pushes all changes
- Run MCP servers: `npm run mcp:n8n` / `npm run mcp:clickup`
- Run Trigger.dev: `npx trigger.dev@latest dev --env-file .env`
- When reopening this project, Claude reads this file for full context

## Key Workflows in n8n
| Workflow | ID | Description |
|---|---|---|
| Complete SEO Automation | oszuSu23QtjeucvlR1aGp | Original (Dutch cycling site) — reference only |
| Angels Bail Bonds SEO Content Generator | xnUQkL4nkbGvGIic | **Active** — ABB keyword sheets → Claude content → Google Docs |
| SpyFu Report Analyzer | 9Xw3q2PtO1LPC4JH | SEO/PPC report via email |

## ABB SEO Workflow (xnUQkL4nkbGvGIic) — Key Details
- **Site**: https://bailbondsdomesticviolence.com (Lovable.dev / React — NOT WordPress)
- **Keyword input**: Sheet3 (City of Industry tab) + Sheet4 (SERPROBOT clean list)
- **Scoring**: Volume × KD_penalty × SERPROBOT_rank_bonus (skips #1-4 ranked, prioritizes #5-30)
- **AI**: Claude claude-opus-4-6 via OpenRouter for all content agents
- **Output**: Google Docs (1 doc per article) + status logged to Sheet3 "Content Pipeline" tab
- **Credentials needed in n8n**: DataForSEO, OpenRouter, Google Sheets, Google Drive, Google Docs, Tavily

## Google Sheets — Keyword Research
| Sheet | ID | Purpose |
|---|---|---|
| Keywords used in drafts | 1I3YIGuO13tc8ElRhZyQHmgj04m3NVBkmvC_iouM3XHo | Exact keywords per page with intent/placement |
| Domestic Violence Keyword Bank | 1jYTxX73TLMmt03YB2ia__ayS5Lp2KTIOgNzMoCE64qo | FAQ keyword bank |
| Keyword Inventory | 139W8Bw6F9-ujDi3eEFw77RzMZYd6fQEO7kUZbLshNYA | Keyword + Volume + KD (by city) |
| Keyword Bank (SERPROBOT/SEMRush) | 1qsR83Vg7R-yatxuQGAwlzCamWdImbY5sl3Jd6107fHs | Full keyword bank with current rankings |

## Chat Log Summary
- 2026-02-26: Initial setup — local folder, GitHub repo, CLAUDE.md, auto-save cron
- 2026-02-26: Connected APIs — Trigger.dev, n8n, Anthropic/Claude, ClickUp
- 2026-02-26: Built n8n MCP server (6 tools) — registered with Claude Code
- 2026-02-26: Built ClickUp MCP server (9 tools) — registered with Claude Code
- 2026-02-26: Added SERP API key to .env
- 2026-02-26: Anthropic model switched to claude-sonnet-4-6 with max_tokens 8192 (was Haiku/4096 — reports were cut off)
- 2026-02-27: ANTHROPIC_MODEL env var set to claude-opus-4-6 — all workflows and scripts now read from process.env.ANTHROPIC_MODEL
- 2026-02-26: Added Canva Apps SDK (App ID) + Connect API (Client ID + Secret) to .env
- 2026-02-26: Built Canva MCP server (9 tools) — registered with Claude Code
- 2026-02-26: Added SerpRobot API (rank tracking, 10 paid credits — use manually only)
- 2026-02-26: Built SpyFu Report Analyzer workflow in n8n (ID: 9Xw3q2PtO1LPC4JH)
- 2026-02-26: Master prompts created for SEO + PPC analysis (src/prompts/)
- 2026-02-28: Built ABB SEO Content Generator workflow (ID: xnUQkL4nkbGvGIic)
  - Incorporates all 4 keyword research Google Sheets
  - Outputs to Google Docs (not WordPress — site is Lovable.dev)
  - YMYL/EEAT bail bonds prompts for Claude claude-opus-4-6
