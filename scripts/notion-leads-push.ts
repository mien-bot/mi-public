/**
 * Pushes every local lead's current record to the Notion Leads database —
 * creates a page if the lead has no notion_page_id yet, otherwise updates
 * the existing page. Same fields/logic as app/api/leads/route.ts and
 * app/api/leads/[slug]/route.ts; useful for a one-off backfill after adding
 * new synced fields, without needing the app's UI open.
 *
 * Usage: npx tsx scripts/notion-leads-push.ts
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not found — NOTION_API_KEY may already be in the environment.
}

import { getAllLeads, getLastSiteVisitDate, getSiteVisits } from "../lib/content/leads";
import { updateLead } from "../lib/content/leadMutations";
import { createNotionLead, updateNotionLead } from "../src/adapters/notion/leads";

async function main() {
  const leads = getAllLeads();
  for (const { slug, lead } of leads) {
    const lastSiteVisitDate = getLastSiteVisitDate(slug);
    const siteVisits = getSiteVisits(slug);
    if (lead.notion_page_id) {
      await updateNotionLead(lead.notion_page_id, lead, lastSiteVisitDate, siteVisits);
      console.log(`Updated ${slug} (${lead.notion_page_id})`);
    } else {
      const page = await createNotionLead(lead, lastSiteVisitDate, siteVisits);
      updateLead(slug, { ...lead, notion_page_id: page.id });
      console.log(`Created ${slug} -> ${page.url}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
