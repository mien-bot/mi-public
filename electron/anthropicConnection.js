const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1";
const ANTHROPIC_VERSION = "2023-06-01";

async function testAnthropicConnection(apiKey, { fetchImpl = fetch } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return {
      kind: "claude-api",
      ok: false,
      detail: "Store a Claude API key before testing this connection.",
    };
  }
  try {
    const response = await fetchImpl(ANTHROPIC_MODELS_URL, {
      method: "GET",
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": apiKey.trim(),
      },
    });
    if (!response.ok) {
      return {
        kind: "claude-api",
        ok: false,
        detail: `Claude API returned ${response.status}. Check the key and workspace access, then try again.`,
      };
    }
    return {
      kind: "claude-api",
      ok: true,
      detail: "Claude API is connected and the account can list available models.",
    };
  } catch {
    return {
      kind: "claude-api",
      ok: false,
      detail: "Could not reach the Claude API. Check this computer's network connection and try again.",
    };
  }
}

module.exports = { ANTHROPIC_MODELS_URL, ANTHROPIC_VERSION, testAnthropicConnection };
