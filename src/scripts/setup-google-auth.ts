/**
 * One-time Google OAuth2 setup.
 * Run this once to get your refresh token, then add it to .env.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create a project (or use existing)
 *   3. Enable APIs: Google Sheets, Google Drive, Google Docs, Gmail
 *   4. Create OAuth2 credentials → Desktop App
 *   5. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env
 *   6. Run: npx tsx src/scripts/setup-google-auth.ts
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as http from "http";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.resolve(__dirname, "../../.env");
dotenv.config({ path: ENV_PATH });

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env");
  console.log(`
Steps to get these:
  1. Go to https://console.cloud.google.com/apis/credentials
  2. Create OAuth 2.0 Client ID → Desktop App
  3. Add to .env:
       GOOGLE_CLIENT_ID=your_client_id
       GOOGLE_CLIENT_SECRET=your_client_secret
`);
  process.exit(1);
}

const REDIRECT_URI = "http://localhost:3000/oauth/callback";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent", // force consent to always get a refresh token
});

console.log("\n🔐 Google OAuth2 Setup\n");
console.log("Opening your browser to authenticate...");
console.log("If it doesn't open automatically, go to:\n");
console.log(`  ${authUrl}\n`);

// Open browser on macOS
const { exec } = await import("child_process");
exec(`open "${authUrl}"`);

// Start local HTTP server to capture callback
const code = await new Promise<string>((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost:3000");
    if (url.pathname === "/oauth/callback") {
      const code = url.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>✅ Authentication successful!</h2>
          <p>You can close this tab and return to the terminal.</p>
          </body></html>
        `);
        server.close();
        resolve(code);
      } else {
        reject(new Error("No code in callback"));
      }
    }
  });
  server.listen(3000, () => {
    console.log("⏳ Waiting for Google authentication...\n");
  });
  setTimeout(() => reject(new Error("Timeout — no callback received in 5 minutes")), 300_000);
});

console.log("✅ Got authorization code — exchanging for tokens...");
const { tokens } = await oauth2Client.getToken(code);

if (!tokens.refresh_token) {
  console.error("❌ No refresh token returned. Try revoking access at https://myaccount.google.com/permissions and running again.");
  process.exit(1);
}

console.log("✅ Got refresh token!\n");

// Append to .env
const envContent = fs.readFileSync(ENV_PATH, "utf-8");
const lines = envContent.split("\n").filter(l =>
  !l.startsWith("GOOGLE_REFRESH_TOKEN=") && !l.startsWith("GOOGLE_REDIRECT_URI=")
);
lines.push(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
lines.push(`GOOGLE_REDIRECT_URI=${REDIRECT_URI}`);
fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n");

console.log("✅ Saved to .env:");
console.log(`   GOOGLE_REFRESH_TOKEN=${tokens.refresh_token.slice(0, 20)}...`);
console.log(`   GOOGLE_REDIRECT_URI=${REDIRECT_URI}`);
console.log("\n🎉 Google Workspace MCP server is ready to use!");
console.log("   Restart Claude Code to activate the MCP server.\n");
