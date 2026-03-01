/**
 * Claude Session Progress Logger
 * Logs session tasks to Google Docs + ClickUp via n8n webhook
 *
 * Usage:
 *   node scripts/log-session-progress.mjs                    ← interactive / uses DATA below
 *   node scripts/log-session-progress.mjs '{"business":...}' ← pass JSON directly
 *
 * Called by Claude Code at end of every session as a skill.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '../.env'), 'utf8');
const N8N_BASE_URL = env.match(/N8N_BASE_URL=(.+)/)[1].trim();
const WEBHOOK_URL = `${N8N_BASE_URL}/webhook/claude-progress`;

// ── PST date helper ────────────────────────────────────────────────────────────
function getPSTDate() {
  const pst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const mm = String(pst.getMonth() + 1).padStart(2, '0');
  const dd = String(pst.getDate()).padStart(2, '0');
  const yy = String(pst.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy}`;
}

// ── Session data (Claude Code fills this in before calling) ───────────────────
// When calling programmatically, pass JSON as first argument instead.
const DEFAULT_DATA = {
  business: 'Angelsbailbonds',
  completed: [],
  in_progress: [],
  todo: [],
  blockers: [],
  questions: [],
};

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  let data = { ...DEFAULT_DATA };

  // Accept JSON argument from command line
  if (process.argv[2]) {
    try {
      const parsed = JSON.parse(process.argv[2]);
      data = { ...data, ...parsed };
    } catch {
      console.error('❌ Invalid JSON argument');
      process.exit(1);
    }
  }

  // Auto-set PST date if not provided
  if (!data.date_pst) {
    data.date_pst = getPSTDate();
  }

  const total = data.completed.length + data.in_progress.length +
                data.todo.length + data.blockers.length + data.questions.length;

  if (total === 0) {
    console.log('⚠️  No tasks to log. Pass data via JSON argument.');
    console.log('   Example:');
    console.log(`   node scripts/log-session-progress.mjs '${JSON.stringify({
      business: 'Angelsbailbonds',
      completed: ['Fix Gmail rate limit', 'Build blog system'],
      in_progress: ['SEO Content Generator'],
      todo: ['Connect n8n credentials'],
      blockers: [],
      questions: [],
    })}'`);
    return;
  }

  console.log(`\n📋 Logging session progress for ${data.business} — ${data.date_pst} PST`);
  console.log(`   ✅ Completed:   ${data.completed.length}`);
  console.log(`   🔄 In Progress: ${data.in_progress.length}`);
  console.log(`   📋 Todo:        ${data.todo.length}`);
  console.log(`   🚫 Blockers:    ${data.blockers.length}`);
  console.log(`   ❓ Questions:   ${data.questions.length}`);
  console.log(`   Total items:   ${total}\n`);

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    console.error(`❌ Webhook error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log(`✅ Logged successfully!`);
  console.log(`   Date: ${result.date}`);
  console.log(`   Business: ${result.business}`);
  console.log(`   ClickUp tasks logged: ${result.items_logged}`);
  console.log(`\n   📄 Google Doc updated in Drive folder`);
  console.log(`   ✔️  ClickUp tasks created (no duplicates)`);
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
