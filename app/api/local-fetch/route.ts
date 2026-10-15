import { NextResponse } from "next/server";
import { fetchLocalUrl } from "@/electron/localFetch";

const MODES = ["auto", "http", "browser"];
const MAX_URL_LENGTH = 2_000;

/** Default-on. Set MI_LOCAL_FETCH=off to stop this machine reading the web on an agent's behalf. */
function disabled(): boolean {
  const value = (process.env.MI_LOCAL_FETCH || "").trim().toLowerCase();
  return value === "off" || value === "0" || value === "false";
}

export async function POST(request: Request) {
  if (disabled()) {
    return NextResponse.json(
      { error: "Local fetch is disabled on this machine (MI_LOCAL_FETCH)." },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.url !== "string" || body.url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "Send one http or https URL to read." }, { status: 400 });
  }
  const mode = body.mode === undefined ? "auto" : body.mode;
  if (typeof mode !== "string" || !MODES.includes(mode)) {
    return NextResponse.json({ error: "Mode must be auto, http, or browser." }, { status: 400 });
  }
  try {
    return NextResponse.json(await fetchLocalUrl({
      url: body.url,
      mode,
      refresh: body.refresh === true,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That URL could not be read locally." },
      { status: 400 },
    );
  }
}
