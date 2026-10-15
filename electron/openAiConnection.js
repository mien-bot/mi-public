const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const CODEX_API_MODEL = "gpt-5.6-sol";

async function testOpenAiConnection(apiKey, { fetchImpl = fetch } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return {
      kind: "openai-api",
      ok: false,
      model: CODEX_API_MODEL,
      detail: "Store an OpenAI API key before testing this connection.",
    };
  }
  try {
    const response = await fetchImpl(OPENAI_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (!response.ok) {
      return {
        kind: "openai-api",
        ok: false,
        model: CODEX_API_MODEL,
        detail: `OpenAI API returned ${response.status}. Check the key and project access, then try again.`,
      };
    }
    const body = await response.json();
    const modelAvailable = Array.isArray(body?.data)
      && body.data.some((candidate) => candidate?.id === CODEX_API_MODEL);
    return {
      kind: "openai-api",
      ok: true,
      model: CODEX_API_MODEL,
      detail: modelAvailable
        ? `OpenAI API is connected and ${CODEX_API_MODEL} is available.`
        : `OpenAI API is connected. ${CODEX_API_MODEL} was not listed for this project.`,
    };
  } catch {
    return {
      kind: "openai-api",
      ok: false,
      model: CODEX_API_MODEL,
      detail: "Could not reach the OpenAI API. Check this computer's network connection and try again.",
    };
  }
}

module.exports = { CODEX_API_MODEL, OPENAI_MODELS_URL, testOpenAiConnection };
