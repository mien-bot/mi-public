"use client";

import { useMemo, useState, type ReactNode } from "react";
import { activeProposalAction, sharedProposalActions } from "@/components/proposalBatchActions";
import {
  ProposalCard,
  type ProposalAction,
  type ProposalDiffRow,
  type ProposalOutcome,
} from "@/components/ProposalReview";

export interface ProposalListItem {
  id: string;
  kindLabel: string;
  title: string;
  reason?: string;
  summary?: string;
  diffRows: ProposalDiffRow[];
  actions: ProposalAction[];
  extraFields?: ReactNode;
  defaultExpanded?: boolean;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * A list of proposal cards with one shared confirmation across them.
 *
 * Mi drafts changes a handful at a time -- a week of schedule entries, a batch of time
 * entries -- and confirming them one card at a time is the slowest part of using it. This
 * adds a single pass over a chosen set without loosening what confirmation means: the
 * review step is mandatory and opens every selected card, so the values are on screen
 * before the one button that writes appears.
 *
 * Changing the selection or the action drops that review, for the same reason the mailbox's
 * bulk plan is dropped on every selection change (`components/ReviewInboxBrowser.tsx`): a
 * review shown above a set it no longer describes is how someone confirms a write they
 * never actually read.
 *
 * The run is sequential and stops at the first failure. Each proposal is an independent
 * write to Notion or to Mi's own records, so pressing on after one fails usually means
 * repeating a systemic failure seven more times -- and leaves a half-applied set nobody
 * asked for. What did apply stays applied and is reported by count.
 */
export function ProposalCardList({
  items,
  className = "mt-2 space-y-2",
}: {
  items: ProposalListItem[];
  className?: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [chosenActionKey, setChosenActionKey] = useState("");
  const [reviewed, setReviewed] = useState(false);
  // Two lists rather than one: a card the person has never touched should still honour its
  // own `defaultExpanded`, which a single "these are open" list would silently override.
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const [closedIds, setClosedIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, ProposalOutcome>>({});
  const [batchMessage, setBatchMessage] = useState("");

  const selectable = useMemo(
    () => items.filter((item) => item.actions.some((action) => !action.disabled)),
    [items],
  );
  const settled = (id: string) => outcomes[id]?.status === "applied";
  const openForBatch = selectable.filter((item) => !settled(item.id));

  const selectedItems = items.filter((item) => selected.includes(item.id) && !settled(item.id));
  const available = sharedProposalActions(selectedItems);
  const activeAction = activeProposalAction(available, chosenActionKey);
  const activeActionKey = activeAction?.key ?? "";

  function changeSelection(next: string[]) {
    setSelected(next);
    setReviewed(false);
    setBatchMessage("");
  }

  function toggle(id: string) {
    changeSelection(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  function open(ids: string[]) {
    setOpenedIds((current) => [...new Set([...current, ...ids])]);
    setClosedIds((current) => current.filter((value) => !ids.includes(value)));
  }

  function close(ids: string[]) {
    setClosedIds((current) => [...new Set([...current, ...ids])]);
    setOpenedIds((current) => current.filter((value) => !ids.includes(value)));
  }

  function review() {
    setReviewed(true);
    setBatchMessage("");
    open(selected);
  }

  async function confirmAll() {
    if (!activeAction || selectedItems.length === 0) return;
    setRunning(true);
    setBatchMessage("");
    const total = selectedItems.length;
    let applied = 0;
    for (const item of selectedItems) {
      const action = item.actions.find((candidate) => candidate.key === activeAction.key);
      if (!action) continue;
      setOutcomes((current) => ({ ...current, [item.id]: { status: "applying", message: "" } }));
      try {
        const result = await action.run();
        setOutcomes((current) => ({
          ...current,
          [item.id]: {
            status: result.ok ? "applied" : "review",
            message: result.message,
            completedLabel: action.completedLabel ?? "Applied",
          },
        }));
        if (!result.ok) {
          setBatchMessage(
            `Applied ${applied} of ${total}, then stopped at “${item.title}”: ${result.message} `
            + "Nothing after it was touched.",
          );
          setRunning(false);
          setSelected([]);
          setReviewed(false);
          return;
        }
        applied += 1;
        close([item.id]);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "The confirmed change could not be applied.";
        setOutcomes((current) => ({ ...current, [item.id]: { status: "error", message } }));
        setBatchMessage(
          `Applied ${applied} of ${total}, then stopped at “${item.title}”: ${message} `
          + "Nothing after it was touched.",
        );
        setRunning(false);
        setSelected([]);
        setReviewed(false);
        return;
      }
    }
    setBatchMessage(`Confirmed ${applied} ${plural(applied, "proposal", "proposals")}.`);
    setSelected([]);
    setReviewed(false);
    setRunning(false);
  }

  const allSelected = openForBatch.length > 0 && openForBatch.every((item) => selected.includes(item.id));
  const showBatchBar = openForBatch.length > 1;

  return (
    <div className={className}>
      {showBatchBar && (
        <section className="rounded-lg border border-border bg-card/40 p-3" aria-label="Confirm several at once">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={running}
              onClick={() => changeSelection(allSelected ? [] : openForBatch.map((item) => item.id))}
              className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
            >
              {allSelected ? "Deselect all" : `Select all ${openForBatch.length}`}
            </button>
            <span className="text-xs text-muted-foreground">
              {selected.length === 0
                ? "Tick the ones to confirm together, or confirm any card on its own."
                : `${selectedItems.length} selected`}
            </span>
          </div>

          {selectedItems.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              {available.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  These proposals have no one action in common — for example, some need a Notion link
                  and some do not. Confirm those individually, or deselect the odd ones out.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {available.length === 1 ? (
                      <span className="text-xs">
                        All {selectedItems.length} will run{" "}
                        <span className="font-medium">{available[0].label}</span>.
                      </span>
                    ) : (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Action
                        <select
                          value={activeActionKey}
                          disabled={running}
                          onChange={(event) => {
                            setChosenActionKey(event.target.value);
                            setReviewed(false);
                            setBatchMessage("");
                          }}
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                        >
                          {/* A select whose value matches no option displays the first one, so
                              without this placeholder an unchosen batch would read as "Dismiss"
                              -- naming an action nobody picked, on every selected proposal. */}
                          {!activeAction && <option value="">Choose an action…</option>}
                          {available.map((action) => (
                            <option key={action.key} value={action.key}>{action.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={running || !activeAction}
                      onClick={review}
                      className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
                    >
                      {reviewed ? "Reopen all" : `Show all ${selectedItems.length}`}
                    </button>
                    {!activeAction && (
                      <span className="text-xs text-muted-foreground">
                        Choose what to do with all {selectedItems.length} first.
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => changeSelection([])}
                      disabled={running}
                      className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      Clear selection
                    </button>
                  </div>

                  {reviewed && activeAction && (
                    <div className="mt-3 rounded-md border border-accent/50 bg-accent/5 p-3">
                      <p className="text-xs text-muted-foreground">
                        Every one of these is open below. Read them, then confirm once.
                      </p>
                      <ul className="mt-2 space-y-1">
                        {selectedItems.map((item) => (
                          <li key={item.id} className="text-xs">
                            <span className="font-medium">{item.title}</span>
                            {" — "}
                            <span className="text-muted-foreground">{item.kindLabel}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => void confirmAll()}
                        className="mt-3 rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-50"
                      >
                        {running
                          ? "Confirming…"
                          : `${activeAction.label} — all ${selectedItems.length}`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {batchMessage && <p className="mt-2 text-xs">{batchMessage}</p>}
        </section>
      )}

      {items.map((item) => (
        <ProposalCard
          key={item.id}
          kindLabel={item.kindLabel}
          title={item.title}
          summary={item.summary}
          reason={item.reason}
          diffRows={item.diffRows}
          actions={item.actions}
          extraFields={item.extraFields}
          defaultExpanded={item.defaultExpanded}
          expanded={showBatchBar
            ? openedIds.includes(item.id)
              || (Boolean(item.defaultExpanded) && !closedIds.includes(item.id))
            : undefined}
          onExpandedChange={showBatchBar ? (next) => (next ? open([item.id]) : close([item.id])) : undefined}
          outcome={outcomes[item.id] ?? null}
          selection={showBatchBar && selectable.some((candidate) => candidate.id === item.id)
            ? { selected: selected.includes(item.id), onToggle: () => toggle(item.id), disabled: running }
            : undefined}
        />
      ))}
    </div>
  );
}
