export interface ClaudeApiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeApiRequest {
  system: string;
  messages: ClaudeApiMessage[];
  model?: string;
  maxTokens?: number;
}

export interface ClaudeApiResult {
  model: string;
  text: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

export class ClaudeApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ClaudeApiError";
    this.status = status;
  }
}

const CLAUDE_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARACTERS = 30_000;
const MAX_SYSTEM_CHARACTERS = 60_000;
const MAX_TOTAL_CHARACTERS = 120_000;

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new ClaudeApiError(`${label} is required.`);
  if (value.length > maximum) throw new ClaudeApiError(`${label} is too large.`);
  return value;
}

function validatedModel(value: string | undefined): string {
  const model = value?.trim() || process.env.MI_CLAUDE_API_MODEL?.trim() || DEFAULT_MODEL;
  if (!/^claude-[a-z0-9][a-z0-9-]{1,79}$/i.test(model)) {
    throw new ClaudeApiError("Select a valid Claude API model.");
  }
  return model;
}

function validatedApiKey(value: string | undefined): string {
  const apiKey = value?.trim();
  if (!apiKey || apiKey.length > 16_384 || /[\0\r\n]/.test(apiKey)) {
    throw new ClaudeApiError("Claude API is not configured.");
  }
  return apiKey;
}

function safeUpstreamError(status: number): ClaudeApiError {
  if (status === 401 || status === 403) return new ClaudeApiError("Claude API authentication failed.", status);
  if (status === 429) return new ClaudeApiError("Claude API rate limit reached. Try again later.", status);
  if (status >= 500) return new ClaudeApiError("Claude API is temporarily unavailable.", status);
  return new ClaudeApiError("Claude API rejected the request.", status);
}

export async function callClaudeApi(
  input: ClaudeApiRequest,
  {
    apiKey = process.env.ANTHROPIC_API_KEY,
    fetchImplementation = fetch,
    timeoutMs = 45_000,
  }: {
    apiKey?: string;
    fetchImplementation?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<ClaudeApiResult> {
  const key = validatedApiKey(apiKey);
  const system = boundedText(input.system, "System prompt", MAX_SYSTEM_CHARACTERS);
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > MAX_MESSAGES) {
    throw new ClaudeApiError(`Claude messages must contain between 1 and ${MAX_MESSAGES} entries.`);
  }
  const messages = input.messages.map((message, index) => {
    if (message?.role !== "user" && message?.role !== "assistant") {
      throw new ClaudeApiError(`Message ${index + 1} has an invalid role.`);
    }
    return {
      role: message.role,
      content: boundedText(message.content, `Message ${index + 1}`, MAX_MESSAGE_CHARACTERS),
    };
  });
  const totalCharacters = system.length + messages.reduce((total, message) => total + message.content.length, 0);
  if (totalCharacters > MAX_TOTAL_CHARACTERS) throw new ClaudeApiError("Claude request is too large.");

  const maxTokens = input.maxTokens ?? 4_096;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8_192) {
    throw new ClaudeApiError("Claude maxTokens must be between 1 and 8192.");
  }
  const model = validatedModel(input.model);

  let response: Response;
  try {
    response = await fetchImplementation(CLAUDE_MESSAGES_ENDPOINT, {
      method: "POST",
      headers: {
        "anthropic-version": CLAUDE_API_VERSION,
        "content-type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ClaudeApiError("Claude API could not be reached.");
  }
  if (!response.ok) throw safeUpstreamError(response.status);

  const payload = await response.json().catch(() => null) as {
    content?: Array<{ type?: string; text?: string }>;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  } | null;
  const text = payload?.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new ClaudeApiError("Claude API returned no text.");

  return {
    model: typeof payload?.model === "string" ? payload.model : model,
    text,
    usage: {
      inputTokens: Number.isFinite(payload?.usage?.input_tokens) ? payload!.usage!.input_tokens! : null,
      outputTokens: Number.isFinite(payload?.usage?.output_tokens) ? payload!.usage!.output_tokens! : null,
    },
  };
}
