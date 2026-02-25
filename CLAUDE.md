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
| ClickUp       | CLICKUP_API_KEY     | Connected |

- n8n instance: https://n8n.srv1329589.hstgr.cloud
- Trigger.dev project ID: proj_ylumvpynnyjymaslqmhw (prod key)

## MCP Servers Built
Both registered in ~/.claude.json for this project. Restart Claude Code to activate.

### n8n MCP (`src/mcp/n8n-server.ts`)
Tools: list_workflows, get_workflow, set_workflow_active, list_executions, get_execution, trigger_webhook

### ClickUp MCP (`src/mcp/clickup-server.ts`)
Tools: list_spaces, list_folders, list_lists, list_tasks, get_task, create_task, update_task, search_tasks, add_comment

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

## Chat Log Summary
- 2026-02-26: Initial setup — local folder, GitHub repo, CLAUDE.md, auto-save cron
- 2026-02-26: Connected APIs — Trigger.dev, n8n, Anthropic/Claude, ClickUp
- 2026-02-26: Built n8n MCP server (6 tools) — registered with Claude Code
- 2026-02-26: Built ClickUp MCP server (9 tools) — registered with Claude Code
- **Next:** Restart Claude Code to activate both MCP servers, then continue adding APIs
