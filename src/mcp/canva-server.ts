import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const CLIENT_ID = process.env.CANVA_CLIENT_ID!;
const CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET!;
const REDIRECT_URI = process.env.CANVA_REDIRECT_URI!;
const API_BASE = process.env.CANVA_API_BASE_URL || "https://api.canva.com/rest/v1";
const TOKENS_FILE = path.resolve(__dirname, "../../../.canva-tokens.json");

interface TokenStore {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  code_verifier?: string;
}

function loadTokens(): TokenStore {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

function saveTokens(tokens: Partial<TokenStore>) {
  const existing = loadTokens();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify({ ...existing, ...tokens }, null, 2));
}

async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Not authenticated. Run canva_get_auth_url then canva_exchange_code first.");
  }

  // Token still valid
  if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) {
    return tokens.access_token;
  }

  // Refresh the token
  const res = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  const data = await res.json();
  saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

async function canvaFetch(endpoint: string, options: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Canva API error ${res.status}: ${text}`);
  }
  return res.json();
}

const server = new McpServer({
  name: "canva-angels-bail-bonds",
  version: "1.0.0",
});

// ── AUTH ─────────────────────────────────────────────────────────────────────

server.tool(
  "canva_get_auth_url",
  "Generate the Canva OAuth authorization URL. Open it in your browser to authorize the integration.",
  {},
  async () => {
    const code_verifier = crypto.randomBytes(32).toString("base64url");
    const code_challenge = crypto.createHash("sha256").update(code_verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");

    saveTokens({ code_verifier });

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      code_challenge,
      code_challenge_method: "S256",
      state,
      redirect_uri: REDIRECT_URI,
      scope: "profile:read design:meta:read design:content:read design:content:write asset:read asset:write folder:read",
    });

    const url = `https://www.canva.com/api/oauth/authorize?${params}`;
    return {
      content: [{
        type: "text",
        text: `Open this URL in your browser to authorize Canva:\n\n${url}\n\nAfter authorizing, copy the 'code' value from the redirect URL and use canva_exchange_code.`,
      }],
    };
  }
);

server.tool(
  "canva_exchange_code",
  "Exchange the Canva OAuth authorization code for access tokens",
  { code: z.string().describe("The authorization code from the redirect URL") },
  async ({ code }) => {
    const tokens = loadTokens();
    if (!tokens.code_verifier) {
      throw new Error("No code_verifier found. Run canva_get_auth_url first.");
    }

    const res = await fetch("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: tokens.code_verifier,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed: ${text}`);
    }

    const data = await res.json();
    saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      code_verifier: undefined,
    });

    return {
      content: [{ type: "text", text: "Canva authenticated successfully! All Canva tools are now available." }],
    };
  }
);

// ── USER ──────────────────────────────────────────────────────────────────────

server.tool(
  "canva_get_user",
  "Get the authenticated Canva user profile and capabilities",
  {},
  async () => {
    const data = await canvaFetch("/users/me");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── DESIGNS ───────────────────────────────────────────────────────────────────

server.tool(
  "canva_list_designs",
  "List Canva designs for the authenticated user",
  {
    query: z.string().optional().describe("Search query to filter designs by title"),
    limit: z.number().optional().describe("Max results (default 20)"),
  },
  async ({ query, limit = 20 }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query) params.set("query", query);
    const data = await canvaFetch(`/designs?${params}`);
    const designs = (data.items || []).map((d: any) => ({
      id: d.id,
      title: d.title,
      created_at: d.created_at,
      updated_at: d.updated_at,
      edit_url: d.urls?.edit_url,
      view_url: d.urls?.view_url,
    }));
    return { content: [{ type: "text", text: JSON.stringify(designs, null, 2) }] };
  }
);

server.tool(
  "canva_get_design",
  "Get details of a specific Canva design",
  { designId: z.string().describe("The design ID") },
  async ({ designId }) => {
    const data = await canvaFetch(`/designs/${designId}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "canva_create_design",
  "Create a new blank Canva design",
  {
    title: z.string().optional().describe("Design title"),
    designType: z.enum(["doc", "whiteboard", "presentation"]).optional().describe("Preset design type"),
    width: z.number().optional().describe("Custom width in px (use with height for custom size)"),
    height: z.number().optional().describe("Custom height in px (use with width for custom size)"),
    unit: z.enum(["px", "cm", "mm", "in", "pt"]).optional().describe("Unit for custom dimensions (default: px)"),
  },
  async ({ title, designType, width, height, unit = "px" }) => {
    const body: any = {};
    if (title) body.title = title;
    if (designType) {
      body.design_type = { type: "preset", name: designType };
    } else if (width && height) {
      body.design_type = { type: "custom", width, height, unit };
    }

    const data = await canvaFetch("/designs", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      content: [{
        type: "text",
        text: `Design created!\nID: ${data.design?.id}\nTitle: ${data.design?.title}\nEdit URL: ${data.design?.urls?.edit_url}`,
      }],
    };
  }
);

// ── EXPORTS ───────────────────────────────────────────────────────────────────

server.tool(
  "canva_export_design",
  "Export a Canva design to PDF, PNG, JPG, SVG, PPTX, GIF, or MP4",
  {
    designId: z.string().describe("The design ID to export"),
    format: z.enum(["pdf", "png", "jpg", "svg", "pptx", "gif", "mp4"]).describe("Export format"),
  },
  async ({ designId, format }) => {
    const job = await canvaFetch(`/designs/${designId}/exports`, {
      method: "POST",
      body: JSON.stringify({ format: { type: format } }),
    });

    const jobId = job.job?.id;
    if (!jobId) throw new Error("Export job failed to start.");

    // Poll for completion (max 40s)
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await canvaFetch(`/exports/${jobId}`);
      if (status.job?.status === "success") {
        const urls = status.job?.urls || [];
        return {
          content: [{
            type: "text",
            text: `Export complete!\nFormat: ${format}\nDownload URLs:\n${urls.join("\n")}`,
          }],
        };
      }
      if (status.job?.status === "failed") {
        throw new Error(`Export failed: ${JSON.stringify(status.job?.error)}`);
      }
    }

    throw new Error("Export timed out after 40 seconds.");
  }
);

// ── ASSETS ────────────────────────────────────────────────────────────────────

server.tool(
  "canva_list_assets",
  "List assets uploaded to Canva",
  {
    query: z.string().optional().describe("Search query to filter assets by name"),
  },
  async ({ query }) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    const data = await canvaFetch(`/assets?${params}`);
    const assets = (data.items || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      created_at: a.created_at,
      thumbnail: a.thumbnail?.url,
    }));
    return { content: [{ type: "text", text: JSON.stringify(assets, null, 2) }] };
  }
);

server.tool(
  "canva_get_asset",
  "Get details of a specific Canva asset",
  { assetId: z.string().describe("The asset ID") },
  async ({ assetId }) => {
    const data = await canvaFetch(`/assets/${assetId}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── START ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
