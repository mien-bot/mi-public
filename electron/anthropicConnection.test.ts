import { describe, expect, it, vi } from "vitest";

const { ANTHROPIC_MODELS_URL, ANTHROPIC_VERSION, testAnthropicConnection } = require("./anthropicConnection");

describe("Claude API connection test", () => {
  it("sends the key only in the required API header", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await testAnthropicConnection("  secret-key  ", { fetchImpl });

    expect(result).toMatchObject({ kind: "claude-api", ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(ANTHROPIC_MODELS_URL, {
      method: "GET",
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": "secret-key",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("returns safe status details for missing and rejected keys", async () => {
    await expect(testAnthropicConnection("", { fetchImpl: vi.fn() })).resolves.toMatchObject({ ok: false });
    const result = await testAnthropicConnection("secret-key", {
      fetchImpl: vi.fn(async () => ({ ok: false, status: 401 })),
    });
    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining("401") });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});
