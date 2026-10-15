"use client";

import { useRouter } from "next/navigation";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";

/**
 * Deletes a whole workspace folder — a library collection, or Mi's record of a project.
 *
 * Wraps DeleteRecordButton with the typed-name confirmation those two deserve: a slug is
 * easy to mis-click out of a list, a name is not something anyone types by accident. On
 * success it navigates away, because the page it was rendered on no longer describes
 * anything.
 *
 * `note` is where each caller states plainly what is *not* deleted. For a project that
 * matters a great deal: Mi removes its own folder and leaves the Dropbox content archive
 * and any linked Notion page exactly where they are, and someone about to confirm needs to
 * know that before they click rather than after.
 */
export function DeleteWorkspaceButton({
  endpoint,
  name,
  label,
  note,
  redirectTo,
}: {
  endpoint: string;
  /** The exact text the person must type back before Delete is enabled. */
  name: string;
  label: string;
  note?: string;
  redirectTo: string;
}) {
  const router = useRouter();

  async function run() {
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, expectedName: name }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "It could not be deleted.");
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-status-danger-foreground/30 p-4">
      <h2 className="font-medium">{label}</h2>
      {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-3">
        <DeleteRecordButton
          label={label}
          prompt="This cannot be undone from inside Mi."
          recoverableNote="A recoverable copy is kept in .mi-backups on disk."
          requireTypedName={name}
          onDelete={run}
        />
      </div>
    </div>
  );
}
