"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActivityIndicator } from "@/components/UiState";

export function DropboxDocumentsRefresh() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [completed, setCompleted] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (refreshing || !requested.current) return;
    requested.current = false;
    setCompleted(true);
    const timer = window.setTimeout(() => setCompleted(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [refreshing]);

  return (
    <button
      type="button"
      disabled={refreshing}
      onClick={() => {
        requested.current = true;
        setCompleted(false);
        startTransition(() => router.refresh());
      }}
      className="tactile-control rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-accent disabled:opacity-50"
    >
      {refreshing ? <ActivityIndicator label="Reading Dropbox…" /> : completed ? <ActivityIndicator state="success" label="Dropbox refreshed" /> : "Refresh Dropbox"}
    </button>
  );
}
