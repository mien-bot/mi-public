import { NextResponse } from "next/server";
import { buildPortfolioSnapshot } from "@/lib/content/portfolioAnalytics";

/**
 * Read-only. Lets the Electron main process (plain Node, can't require() this .ts module
 * directly -- see electron/agentContext.js's header comment for the same constraint) fetch
 * the portfolio briefing over the local server it already runs, for electron/firmHarness.js
 * to embed into the firm-wide chat workspace's PORTFOLIO_CONTEXT.md.
 */
export async function GET() {
  const snapshot = buildPortfolioSnapshot();
  return NextResponse.json({ briefing: snapshot.briefing });
}
