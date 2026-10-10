/**
 * Creates (or reuses) a Composio-managed auth config for every tool slug and
 * prints SQL to store the ids in Supabase `tools.composio_auth_config_id`.
 *
 * Run: node --env-file=.env scripts/setup-composio-auth-configs.mjs
 */
import { Composio } from "@composio/core";

const SLUGS = [
  "gmail", "googlecalendar", "googlesheets", "slack", "discord", "notion",
  "github", "linear", "jira", "trello", "reddit", "linkedin", "spotify",
  "instagram", "twitter",
];

if (!process.env.COMPOSIO_API_KEY) throw new Error("COMPOSIO_API_KEY missing");
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

const ok = [];
const failed = [];

for (const slug of SLUGS) {
  try {
    const existing = await composio.authConfigs.list({ toolkit: slug });
    const reuse = existing.items?.find((c) => c.toolkit?.slug === slug && c.status !== "DISABLED");
    if (reuse) {
      ok.push([slug, reuse.id, "reused"]);
      continue;
    }
    const created = await composio.authConfigs.create(slug, { type: "use_composio_managed_auth" });
    ok.push([slug, created.id, "created"]);
  } catch (e) {
    failed.push([slug, e?.cause?.details?.message ?? e?.message ?? String(e)]);
  }
}

console.log("\n-- Results");
for (const [slug, id, how] of ok) console.log(`-- ${slug}: ${id} (${how})`);
for (const [slug, why] of failed) console.log(`-- ${slug}: FAILED - ${why}`);

console.log("\n-- Run in Supabase SQL editor:");
for (const [slug, id] of ok) {
  console.log(`update tools set composio_auth_config_id = '${id}' where slug = '${slug}';`);
}
if (failed.length) {
  console.log(`update tools set composio_auth_config_id = null where slug in (${failed.map(([s]) => `'${s}'`).join(", ")});`);
}
