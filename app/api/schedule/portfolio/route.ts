import { NextResponse } from "next/server";
import { buildPortfolioTimeline } from "@/lib/content/schedulePortfolio";

export async function GET(request: Request) {
  const year = Number(new URL(request.url).searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Choose a valid year." }, { status: 400 });
  }
  return NextResponse.json(buildPortfolioTimeline(year));
}
