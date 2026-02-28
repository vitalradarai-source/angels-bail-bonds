import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ── OAuth2 client ──────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/oauth/callback"
);
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const sheets = google.sheets({ version: "v4", auth: oauth2Client });
const drive  = google.drive({ version: "v3", auth: oauth2Client });
const docs   = google.docs({ version: "v1", auth: oauth2Client });
const gmail  = google.gmail({ version: "v1", auth: oauth2Client });

// ── Helper ─────────────────────────────────────────────────────────────────
function extractSheetId(input: string): string {
  // Accept full URL or raw ID
  const m = input.match(/\/spreadsheets\/d\/([\w-]+)/);
  return m ? m[1] : input;
}
function extractDocId(input: string): string {
  const m = input.match(/\/document\/d\/([\w-]+)/);
  return m ? m[1] : input;
}

// ── MCP Server ─────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "google-workspace",
  version: "1.0.0",
});

// ─── SHEETS ───────────────────────────────────────────────────────────────

server.tool(
  "sheets_list_tabs",
  "List all tabs/sheets inside a Google Spreadsheet",
  { spreadsheet_id: z.string().describe("Spreadsheet ID or full URL") },
  async ({ spreadsheet_id }) => {
    const id = extractSheetId(spreadsheet_id);
    const res = await sheets.spreadsheets.get({ spreadsheetId: id });
    const tabs = res.data.sheets?.map(s => ({
      title: s.properties?.title,
      sheetId: s.properties?.sheetId,
      index: s.properties?.index,
      rowCount: s.properties?.gridProperties?.rowCount,
      columnCount: s.properties?.gridProperties?.columnCount,
    })) ?? [];
    return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
  }
);

server.tool(
  "sheets_read",
  "Read data from a Google Sheet tab. Returns rows as arrays.",
  {
    spreadsheet_id: z.string().describe("Spreadsheet ID or full URL"),
    range: z.string().describe("Range like 'Sheet1!A1:Z100' or just 'Sheet1' for all data"),
  },
  async ({ spreadsheet_id, range }) => {
    const id = extractSheetId(spreadsheet_id);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const values = res.data.values ?? [];
    const headers = values[0] ?? [];
    const rows = values.slice(1).map(row =>
      Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]))
    );
    return {
      content: [{
        type: "text",
        text: `Headers: ${JSON.stringify(headers)}\nRows (${rows.length}):\n${JSON.stringify(rows, null, 2)}`,
      }],
    };
  }
);

server.tool(
  "sheets_read_raw",
  "Read raw rows from a Google Sheet (arrays, not objects). Useful for sheets without headers.",
  {
    spreadsheet_id: z.string().describe("Spreadsheet ID or full URL"),
    range: z.string().describe("Range like 'Sheet1!A1:Z100'"),
  },
  async ({ spreadsheet_id, range }) => {
    const id = extractSheetId(spreadsheet_id);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const values = res.data.values ?? [];
    return {
      content: [{
        type: "text",
        text: `${values.length} rows:\n${JSON.stringify(values, null, 2)}`,
      }],
    };
  }
);

server.tool(
  "sheets_append",
  "Append rows to a Google Sheet",
  {
    spreadsheet_id: z.string().describe("Spreadsheet ID or full URL"),
    range: z.string().describe("Range/tab name like 'Sheet1'"),
    rows: z.array(z.array(z.any())).describe("Array of rows, each row is an array of cell values"),
  },
  async ({ spreadsheet_id, range, rows }) => {
    const id = extractSheetId(spreadsheet_id);
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
    return {
      content: [{
        type: "text",
        text: `Appended ${rows.length} rows. Updated range: ${res.data.updates?.updatedRange}`,
      }],
    };
  }
);

server.tool(
  "sheets_update",
  "Update a specific range in a Google Sheet",
  {
    spreadsheet_id: z.string().describe("Spreadsheet ID or full URL"),
    range: z.string().describe("Range like 'Sheet1!A2:C5'"),
    rows: z.array(z.array(z.any())).describe("Array of rows to write"),
  },
  async ({ spreadsheet_id, range, rows }) => {
    const id = extractSheetId(spreadsheet_id);
    const res = await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
    return {
      content: [{
        type: "text",
        text: `Updated ${res.data.updatedCells} cells in ${res.data.updatedRange}`,
      }],
    };
  }
);

server.tool(
  "sheets_create",
  "Create a new Google Spreadsheet",
  {
    title: z.string().describe("Title of the new spreadsheet"),
    sheets: z.array(z.string()).optional().describe("List of tab names to create"),
  },
  async ({ title, sheets: sheetNames }) => {
    const requestBody: any = { properties: { title } };
    if (sheetNames?.length) {
      requestBody.sheets = sheetNames.map(s => ({ properties: { title: s } }));
    }
    const res = await sheets.spreadsheets.create({ requestBody });
    return {
      content: [{
        type: "text",
        text: `Created: ${res.data.spreadsheetUrl}\nID: ${res.data.spreadsheetId}`,
      }],
    };
  }
);

server.tool(
  "sheets_add_tab",
  "Add a new tab/sheet to an existing spreadsheet",
  {
    spreadsheet_id: z.string().describe("Spreadsheet ID or full URL"),
    tab_name: z.string().describe("Name for the new tab"),
  },
  async ({ spreadsheet_id, tab_name }) => {
    const id = extractSheetId(spreadsheet_id);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tab_name } } }],
      },
    });
    return { content: [{ type: "text", text: `Tab '${tab_name}' added to spreadsheet ${id}` }] };
  }
);

// ─── DRIVE ────────────────────────────────────────────────────────────────

server.tool(
  "drive_list",
  "List files in Google Drive. Filter by type or folder.",
  {
    query: z.string().optional().describe("Search query e.g. \"name contains 'bail bonds'\""),
    mime_type: z.string().optional().describe("Filter by MIME type e.g. 'application/vnd.google-apps.spreadsheet'"),
    folder_id: z.string().optional().describe("Limit to files inside this folder ID"),
    limit: z.number().optional().describe("Max results (default 20)"),
  },
  async ({ query, mime_type, folder_id, limit = 20 }) => {
    const parts: string[] = ["trashed=false"];
    if (query) parts.push(query);
    if (mime_type) parts.push(`mimeType='${mime_type}'`);
    if (folder_id) parts.push(`'${folder_id}' in parents`);
    const q = parts.join(" and ");

    const res = await drive.files.list({
      q,
      pageSize: limit,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,parents)",
      orderBy: "modifiedTime desc",
    });
    const files = res.data.files ?? [];
    return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
  }
);

server.tool(
  "drive_search",
  "Search Google Drive for files by name or content",
  {
    name: z.string().optional().describe("Search by file name"),
    full_text: z.string().optional().describe("Search by content inside files"),
    limit: z.number().optional().describe("Max results (default 10)"),
  },
  async ({ name, full_text, limit = 10 }) => {
    const parts = ["trashed=false"];
    if (name) parts.push(`name contains '${name.replace(/'/g, "\\'")}'`);
    if (full_text) parts.push(`fullText contains '${full_text.replace(/'/g, "\\'")}'`);

    const res = await drive.files.list({
      q: parts.join(" and "),
      pageSize: limit,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    });
    return { content: [{ type: "text", text: JSON.stringify(res.data.files ?? [], null, 2) }] };
  }
);

// ─── DOCS ─────────────────────────────────────────────────────────────────

server.tool(
  "docs_read",
  "Read the full text content of a Google Doc",
  { doc_id: z.string().describe("Google Doc ID or full URL") },
  async ({ doc_id }) => {
    const id = extractDocId(doc_id);
    const res = await docs.documents.get({ documentId: id });
    // Extract plain text from the document body
    const content = res.data.body?.content ?? [];
    let text = "";
    for (const el of content) {
      if (el.paragraph) {
        for (const pe of el.paragraph.elements ?? []) {
          if (pe.textRun?.content) text += pe.textRun.content;
        }
      } else if (el.table) {
        for (const row of el.table.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) {
            for (const cellEl of cell.content ?? []) {
              if (cellEl.paragraph) {
                for (const pe of cellEl.paragraph.elements ?? []) {
                  if (pe.textRun?.content) text += pe.textRun.content + "\t";
                }
                text += "\n";
              }
            }
          }
        }
      }
    }
    return {
      content: [{
        type: "text",
        text: `Title: ${res.data.title}\n\n${text}`,
      }],
    };
  }
);

server.tool(
  "docs_create",
  "Create a new Google Doc with optional content",
  {
    title: z.string().describe("Document title"),
    content: z.string().optional().describe("Initial text content to insert"),
  },
  async ({ title, content: docContent }) => {
    const createRes = await docs.documents.create({
      requestBody: { title },
    });
    const docId = createRes.data.documentId!;

    if (docContent) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{
            insertText: { location: { index: 1 }, text: docContent },
          }],
        },
      });
    }
    return {
      content: [{
        type: "text",
        text: `Created Doc: https://docs.google.com/document/d/${docId}/edit\nID: ${docId}`,
      }],
    };
  }
);

// ─── GMAIL ────────────────────────────────────────────────────────────────

server.tool(
  "gmail_send",
  "Send an email via Gmail",
  {
    to: z.string().describe("Recipient email(s), comma-separated"),
    subject: z.string().describe("Email subject"),
    body: z.string().describe("Email body (plain text or HTML)"),
    cc: z.string().optional().describe("CC email addresses, comma-separated"),
    is_html: z.boolean().optional().describe("Set true if body is HTML (default false)"),
  },
  async ({ to, subject, body, cc, is_html = false }) => {
    const contentType = is_html ? "text/html" : "text/plain";
    const ccLine = cc ? `Cc: ${cc}\r\n` : "";
    const raw = [
      `To: ${to}`,
      ccLine.trim(),
      `Subject: ${subject}`,
      `Content-Type: ${contentType}; charset=utf-8`,
      "",
      body,
    ].filter(Boolean).join("\r\n");

    const encoded = Buffer.from(raw).toString("base64url");
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encoded },
    });
    return { content: [{ type: "text", text: `Email sent to ${to}` }] };
  }
);

server.tool(
  "gmail_list",
  "List recent emails from Gmail inbox",
  {
    query: z.string().optional().describe("Gmail search query e.g. 'from:someone@gmail.com' or 'subject:bail'"),
    limit: z.number().optional().describe("Max emails to return (default 10)"),
  },
  async ({ query = "", limit = 10 }) => {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: limit,
    });
    const messages = listRes.data.messages ?? [];
    const results = await Promise.all(
      messages.map(async m => {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        });
        const headers = Object.fromEntries(
          (msg.data.payload?.headers ?? []).map(h => [h.name, h.value])
        );
        return { id: m.id, ...headers, snippet: msg.data.snippet };
      })
    );
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ── Start ──────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
