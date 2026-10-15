import { describe, expect, it, vi } from "vitest";
import { callClaudeApi } from "./claudeApi";

describe("Claude API boundary", () => {
  it("sends the API key only to Anthropic and returns a minimal result", async () => {
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "x-api-key": "fake-api-key" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "claude-sonnet-5",
        max_tokens: 512,
        system: "Stay read-only.",
        messages: [{ role: "user", content: "Summarize this." }],
      });
      return new Response(JSON.stringify({
        model: "claude-sonnet-5",
        content: [{ type: "text", text: "Summary" }],
        usage: { input_tokens: 10, output_tokens: 2 },
      }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(callClaudeApi({
      system: "Stay read-only.",
      messages: [{ role: "user", content: "Summarize this." }],
      maxTokens: 512,
    }, {
      apiKey: "fake-api-key",
      fetchImplementation,
    })).resolves.toEqual({
      model: "claude-sonnet-5",
      text: "Summary",
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("rejects oversized input and never exposes an upstream error body", async () => {
    await expect(callClaudeApi({
      system: "System",
      messages: [{ role: "user", content: "x".repeat(30_001) }],
    }, { apiKey: "fake-api-key" })).rejects.toThrow("Message 1 is too large.");

    const fetchImplementation = vi.fn(async () => new Response(
      "secret upstream detail containing fake-api-key",
      { status: 401 },
    )) as unknown as typeof fetch;
    const promise = callClaudeApi({
      system: "System",
      messages: [{ role: "user", content: "Hello" }],
    }, {
      apiKey: "fake-api-key",
      fetchImplementation,
    });
    await expect(promise).rejects.toThrow("Claude API authentication failed.");
    await expect(promise).rejects.not.toThrow("fake-api-key");
  });

  it("requires an explicit server-side key and valid model identifier", async () => {
    await expect(callClaudeApi({
      system: "System",
      messages: [{ role: "user", content: "Hello" }],
    }, { apiKey: "" })).rejects.toThrow("Claude API is not configured.");

    await expect(callClaudeApi({
      system: "System",
      messages: [{ role: "user", content: "Hello" }],
      model: "https://example.com",
    }, { apiKey: "fake-api-key" })).rejects.toThrow("Select a valid Claude API model.");
  });
});
