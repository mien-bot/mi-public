import { describe, expect, it, vi } from "vitest";

const { testOpenAiConnection } = require("./openAiConnection");

describe("OpenAI API connection test", () => {
  it("never sends the key anywhere except the authorization header", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-5.6-sol" }] }),
    }));
    const result = await testOpenAiConnection("  secret-key  ", { fetchImpl });
    expect(result).toMatchObject({ kind: "openai-api", ok: true, model: "gpt-5.6-sol" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer secret-key" },
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("returns safe status details for missing and rejected keys", async () => {
    await expect(testOpenAiConnection("", { fetchImpl: vi.fn() })).resolves.toMatchObject({ ok: false });
    const result = await testOpenAiConnection("secret-key", {
      fetchImpl: vi.fn(async () => ({ ok: false, status: 401 })),
    });
    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining("401") });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});
