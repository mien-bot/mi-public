import { NextResponse } from "next/server";
import { getUnifiedProjectList } from "@/lib/notion/projectMap";

export function GET() {
  return NextResponse.json(
    { projects: getUnifiedProjectList() },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
