/**
 * Thin Notion API fetch wrapper — auth header + API version, nothing else.
 * scripts/notion-probe.ts predates this and inlines the same two headers;
 * left as-is per the plan (refactoring it to use this client is optional
 * cleanup, not required).
 */
const NOTION_VERSION = "2022-06-28";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function getNotionApiKey(): string {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new Error("NOTION_API_KEY not set — add it to .env.local first.");
  }
  return token;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, 10_000);
  return 250 * (2 ** attempt);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestSignal(signal: AbortSignal | null | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function notionError(response: Response): Promise<Error> {
  const raw = await response.text();
  let detail = "";
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown };
    detail = [parsed.code, parsed.message]
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .join(": ");
  } catch {
    detail = raw.replace(/\s+/g, " ").trim().slice(0, 500);
  }
  return new Error(
    `Notion API ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
  );
}

export async function notionFetchWithVersion<T>(
  path: string,
  init?: RequestInit,
  notionVersion = NOTION_VERSION,
  maxAttempts = MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://api.notion.com/v1${path}`, {
        ...init,
        signal: requestSignal(init?.signal),
        headers: {
          Authorization: `Bearer ${getNotionApiKey()}`,
          "Notion-Version": notionVersion,
          ...(!(init?.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch (error) {
      if (init?.signal?.aborted || attempt === maxAttempts - 1) {
        throw new Error(
          `Notion request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await sleep(250 * (2 ** attempt));
      continue;
    }
    if (response.ok) return (await response.json()) as T;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts - 1) {
      throw await notionError(response);
    }
    await sleep(retryDelay(response, attempt));
  }
  throw new Error("Notion request exhausted its retry budget.");
}

export async function notionFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return notionFetchWithVersion<T>(path, init, NOTION_VERSION);
}

/** Appending blocks is not idempotent. Re-read remote content after an uncertain response. */
export async function notionFetchOnce<T>(path: string, init: RequestInit): Promise<T> {
  return notionFetchWithVersion<T>(path, init, NOTION_VERSION, 1);
}
