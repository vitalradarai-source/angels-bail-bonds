import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const N8N_BASE_URL = process.env.N8N_BASE_URL!;
const N8N_API_KEY = process.env.N8N_API_KEY!;

async function n8nFetch(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1${endpoint}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n API error ${res.status}: ${text}`);
  }
  return res.json();
}

const server = new McpServer({
  name: "n8n-angels-bail-bonds",
  version: "1.0.0",
});

// List all workflows
server.tool(
  "list_workflows",
  "List all workflows in n8n",
  {},
  async () => {
    const data = await n8nFetch("/workflows");
    const workflows = data.data.map((w: any) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      updatedAt: w.updatedAt,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(workflows, null, 2) }],
    };
  }
);

// Get a specific workflow
server.tool(
  "get_workflow",
  "Get details of a specific n8n workflow",
  { id: z.string().describe("The workflow ID") },
  async ({ id }) => {
    const data = await n8nFetch(`/workflows/${id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Activate or deactivate a workflow
server.tool(
  "set_workflow_active",
  "Activate or deactivate an n8n workflow",
  {
    id: z.string().describe("The workflow ID"),
    active: z.boolean().describe("True to activate, false to deactivate"),
  },
  async ({ id, active }) => {
    const data = await n8nFetch(`/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
    return {
      content: [
        {
          type: "text",
          text: `Workflow "${data.name}" is now ${data.active ? "active" : "inactive"}.`,
        },
      ],
    };
  }
);

// List recent executions
server.tool(
  "list_executions",
  "List recent workflow executions in n8n",
  {
    workflowId: z.string().optional().describe("Filter by workflow ID (optional)"),
    limit: z.number().optional().describe("Max number of results (default 20)"),
  },
  async ({ workflowId, limit = 20 }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (workflowId) params.set("workflowId", workflowId);
    const data = await n8nFetch(`/executions?${params}`);
    const executions = data.data.map((e: any) => ({
      id: e.id,
      workflowId: e.workflowId,
      status: e.status,
      startedAt: e.startedAt,
      stoppedAt: e.stoppedAt,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(executions, null, 2) }],
    };
  }
);

// Get a specific execution
server.tool(
  "get_execution",
  "Get details of a specific n8n execution",
  { id: z.string().describe("The execution ID") },
  async ({ id }) => {
    const data = await n8nFetch(`/executions/${id}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Trigger a workflow via webhook
server.tool(
  "trigger_webhook",
  "Trigger an n8n workflow via its webhook URL",
  {
    webhookPath: z.string().describe("The webhook path (e.g. /webhook/my-hook)"),
    payload: z.record(z.any()).optional().describe("JSON payload to send"),
  },
  async ({ webhookPath, payload = {} }) => {
    const url = `${N8N_BASE_URL}${webhookPath}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    return {
      content: [
        {
          type: "text",
          text: `Webhook response (${res.status}): ${text}`,
        },
      ],
    };
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
