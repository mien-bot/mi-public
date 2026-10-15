"use client";

import { useState } from "react";

export function OpenAiApiKeyField({
  configured,
  busy = false,
  onStore,
  onClear,
}: {
  configured: boolean;
  busy?: boolean;
  onStore: (token: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function store() {
    setMessage(null);
    try {
      await onStore(token);
      setToken("");
      setMessage("OpenAI API key stored securely.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not store the OpenAI API key.");
    }
  }

  async function clear() {
    setMessage(null);
    try {
      await onClear();
      setToken("");
      setMessage("OpenAI API key cleared.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not clear the OpenAI API key.");
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="openai-api-key-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="openai-api-key-heading" className="text-sm font-medium">OpenAI API key</h3>
          <p className="text-xs text-muted-foreground">
            Used for the separately billed Codex API connection. Mi encrypts it with the
            operating system and never displays the stored value.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {configured ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="OpenAI API key"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={configured ? "Enter a new key to replace" : "Enter API key"}
          className="min-w-64 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || !token.trim()}
          onClick={() => void store()}
          className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
        >
          {configured ? "Replace" : "Store"}
        </button>
        {configured && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
