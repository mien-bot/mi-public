"use client";

import { useState } from "react";

interface ClaudeSubscriptionTokenFieldProps {
  configured: boolean;
  busy?: boolean;
  onStore: (token: string) => Promise<void>;
  onClear: () => Promise<void>;
}

export function ClaudeSubscriptionTokenField({
  configured,
  busy = false,
  onStore,
  onClear,
}: ClaudeSubscriptionTokenFieldProps) {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function store() {
    setMessage(null);
    try {
      await onStore(token);
      setToken("");
      setMessage("Claude subscription token stored securely.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not store the Claude subscription token.");
    }
  }

  async function clear() {
    setMessage(null);
    try {
      await onClear();
      setToken("");
      setMessage("Claude subscription token cleared.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not clear the Claude subscription token.");
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="claude-subscription-token-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="claude-subscription-token-heading" className="text-sm font-medium">
            Claude subscription token
          </h2>
          <p className="text-xs text-muted-foreground">
            Generate this token with <code>claude setup-token</code>. Mi stores it with your
            operating system&apos;s secure credential storage and never displays the stored value.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {configured ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Claude subscription token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={configured ? "Enter a new token to replace" : "Enter token"}
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
