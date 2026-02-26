import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY!;
const CLICKUP_LIST_ID = "901414340773";

console.log("🧪 Testing ClickUp task creation...\n");

const body = {
  name: "SpyFu SEO Report — February 26, 2026",
  description: "## SpyFu SEO Analysis\n**Received:** February 26, 2026\n**Analyzed by:** Claude AI\n\nThis is a test task created by the automation system.",
  priority: 2,
};

console.log("Sending to ClickUp:");
console.log(JSON.stringify(body, null, 2));

const res = await fetch(`https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`, {
  method: "POST",
  headers: {
    Authorization: CLICKUP_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const data = await res.json();

if (res.ok) {
  console.log("\n✅ Task created successfully!");
  console.log(`   Task ID:   ${data.id}`);
  console.log(`   Task Name: ${data.name}`);
  console.log(`   Status:    ${data.status?.status}`);
  console.log(`   URL:       ${data.url}`);
} else {
  console.error("\n❌ Failed:");
  console.error(JSON.stringify(data, null, 2));
}
