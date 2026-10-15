/**
 * Reads a JSON API response without assuming there is a body to parse.
 *
 * A route handler that throws before returning sends an empty body, and calling `.json()` on
 * that surfaces the parser's own words -- "Unexpected end of JSON input" -- which tells a user
 * nothing about what failed. This reports the transport failure instead, and keeps the server's
 * own error message whenever there is one.
 */
export async function readJsonResponse<T = Record<string, unknown>>(
  response: Response,
  fallbackMessage = "The request failed.",
): Promise<T> {
  const raw = await response.text();
  let body: T | null = null;
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as T;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const reportedError = (body as { error?: unknown } | null)?.error;
    const serverMessage = typeof reportedError === "string" && reportedError ? reportedError : null;
    throw new Error(
      serverMessage
        ?? `${fallbackMessage} The local server returned ${response.status} without a readable message.`,
    );
  }
  if (!body) {
    throw new Error(`${fallbackMessage} The local server returned an empty response.`);
  }
  return body;
}
