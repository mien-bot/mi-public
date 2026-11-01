"use client";

import Link from "next/link";
import { EmptyState } from "@/components/UiState";

export default function ErrorPage({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[65vh] max-w-2xl items-center justify-center px-4 py-12">
      <EmptyState
        icon="tools"
        title="This workspace hit an unexpected problem"
        description="This workspace could not be displayed. If you just saved or deleted something, that action may have completed. Reload and check its status before trying the action again."
        action={(
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => unstable_retry()} className="tactile-control rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground">
              Try again
            </button>
            <Link href="/" className="tactile-control rounded-md border border-border bg-background px-4 py-2 text-sm hover:border-accent">
              Return to Mi
            </Link>
          </div>
        )}
      />
    </main>
  );
}
