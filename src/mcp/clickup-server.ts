import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const API_KEY = process.env.CLICKUP_API_KEY!;
const BASE = "https://api.clickup.com/api/v2";
const TEAM_ID = "1293152";
const ANGELS_SPACE_ID = "90090599325";

async function cu(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: API_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp API error ${res.status}: ${text}`);
  }
  return res.json();
}

const server = new McpServer({
  name: "clickup-angels-bail-bonds",
  version: "1.0.0",
});

// List spaces in the workspace
server.tool(
  "list_spaces",
  "List all ClickUp spaces in the workspace",
  {},
  async () => {
    const data = await cu(`/team/${TEAM_ID}/space`);
    const spaces = data.spaces.map((s: any) => ({ id: s.id, name: s.name }));
    return { content: [{ type: "text", text: JSON.stringify(spaces, null, 2) }] };
  }
);

// List folders in a space
server.tool(
  "list_folders",
  "List folders in a ClickUp space",
  {
    spaceId: z.string().optional().describe(`Space ID (defaults to Angels Bail Bonds: ${ANGELS_SPACE_ID})`),
  },
  async ({ spaceId = ANGELS_SPACE_ID }) => {
    const data = await cu(`/space/${spaceId}/folder`);
    const folders = data.folders.map((f: any) => ({ id: f.id, name: f.name, taskCount: f.task_count }));
    return { content: [{ type: "text", text: JSON.stringify(folders, null, 2) }] };
  }
);

// List lists in a space (folderless)
server.tool(
  "list_lists",
  "List task lists in a ClickUp space or folder",
  {
    spaceId: z.string().optional().describe(`Space ID (defaults to Angels Bail Bonds: ${ANGELS_SPACE_ID})`),
    folderId: z.string().optional().describe("Folder ID (if listing lists inside a folder)"),
  },
  async ({ spaceId = ANGELS_SPACE_ID, folderId }) => {
    const endpoint = folderId
      ? `/folder/${folderId}/list`
      : `/space/${spaceId}/list`;
    const data = await cu(endpoint);
    const lists = data.lists.map((l: any) => ({
      id: l.id,
      name: l.name,
      taskCount: l.task_count,
      status: l.status?.status,
    }));
    return { content: [{ type: "text", text: JSON.stringify(lists, null, 2) }] };
  }
);

// List tasks in a list
server.tool(
  "list_tasks",
  "List tasks in a ClickUp list",
  {
    listId: z.string().describe("The list ID to fetch tasks from"),
    status: z.string().optional().describe("Filter by status (e.g. 'open', 'in progress', 'complete')"),
    assigneeId: z.string().optional().describe("Filter by assignee user ID"),
    page: z.number().optional().describe("Page number for pagination (default 0)"),
  },
  async ({ listId, status, assigneeId, page = 0 }) => {
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set("statuses[]", status);
    if (assigneeId) params.set("assignees[]", assigneeId);
    const data = await cu(`/list/${listId}/task?${params}`);
    const tasks = data.tasks.map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status?.status,
      priority: t.priority?.priority,
      assignees: t.assignees?.map((a: any) => a.username),
      dueDate: t.due_date ? new Date(Number(t.due_date)).toLocaleDateString() : null,
      url: t.url,
    }));
    return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
  }
);

// Get a single task
server.tool(
  "get_task",
  "Get full details of a ClickUp task",
  { taskId: z.string().describe("The task ID") },
  async ({ taskId }) => {
    const data = await cu(`/task/${taskId}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// Create a task
server.tool(
  "create_task",
  "Create a new task in a ClickUp list",
  {
    listId: z.string().describe("The list ID to create the task in"),
    name: z.string().describe("Task name"),
    description: z.string().optional().describe("Task description"),
    status: z.string().optional().describe("Task status"),
    priority: z.number().optional().describe("Priority: 1=urgent, 2=high, 3=normal, 4=low"),
    dueDate: z.string().optional().describe("Due date as ISO string (e.g. 2026-03-01)"),
    assignees: z.array(z.number()).optional().describe("Array of user IDs to assign"),
  },
  async ({ listId, name, description, status, priority, dueDate, assignees }) => {
    const body: any = { name };
    if (description) body.description = description;
    if (status) body.status = status;
    if (priority) body.priority = priority;
    if (dueDate) body.due_date = new Date(dueDate).getTime();
    if (assignees) body.assignees = assignees;

    const data = await cu(`/list/${listId}/task`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      content: [{
        type: "text",
        text: `Task created: "${data.name}" (ID: ${data.id})\nURL: ${data.url}`,
      }],
    };
  }
);

// Update a task
server.tool(
  "update_task",
  "Update an existing ClickUp task",
  {
    taskId: z.string().describe("The task ID to update"),
    name: z.string().optional().describe("New task name"),
    description: z.string().optional().describe("New description"),
    status: z.string().optional().describe("New status"),
    priority: z.number().optional().describe("New priority: 1=urgent, 2=high, 3=normal, 4=low"),
    dueDate: z.string().optional().describe("New due date as ISO string"),
  },
  async ({ taskId, name, description, status, priority, dueDate }) => {
    const body: any = {};
    if (name) body.name = name;
    if (description) body.description = description;
    if (status) body.status = status;
    if (priority) body.priority = priority;
    if (dueDate) body.due_date = new Date(dueDate).getTime();

    const data = await cu(`/task/${taskId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return {
      content: [{
        type: "text",
        text: `Task updated: "${data.name}" — status: ${data.status?.status}`,
      }],
    };
  }
);

// Search tasks across workspace
server.tool(
  "search_tasks",
  "Search for tasks across the Angels Bail Bonds ClickUp space",
  { query: z.string().describe("Search query string") },
  async ({ query }) => {
    const data = await cu(`/team/${TEAM_ID}/task?query=${encodeURIComponent(query)}&space_ids[]=${ANGELS_SPACE_ID}`);
    const tasks = (data.tasks || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status?.status,
      list: t.list?.name,
      url: t.url,
    }));
    return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
  }
);

// Add a comment to a task
server.tool(
  "add_comment",
  "Add a comment to a ClickUp task",
  {
    taskId: z.string().describe("The task ID"),
    comment: z.string().describe("The comment text"),
  },
  async ({ taskId, comment }) => {
    await cu(`/task/${taskId}/comment`, {
      method: "POST",
      body: JSON.stringify({ comment_text: comment }),
    });
    return { content: [{ type: "text", text: `Comment added to task ${taskId}.` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
