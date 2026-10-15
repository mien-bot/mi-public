import type { ReactNode } from "react";
import { EmptyState } from "@/components/UiState";
import { MetricCounter } from "@/components/OverviewGraphics";

export const advancedListControlClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent";

export function formatListValueLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part ? `${part[0].toLocaleUpperCase()}${part.slice(1)}` : "")
    .join(" ");
}

export function formatListDate(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function AdvancedListToolbar({
  children,
  columnsClassName = "md:grid-cols-2 xl:grid-cols-4",
}: {
  children: ReactNode;
  columnsClassName?: string;
}) {
  return (
    <div className={`grid gap-3 rounded-lg border border-border bg-card p-4 ${columnsClassName}`}>
      {children}
    </div>
  );
}

export function AdvancedListField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function AdvancedListSummary({
  shown,
  total,
  noun,
  filtersActive = false,
  onClear,
}: {
  shown: number;
  total: number;
  noun: string;
  filtersActive?: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <p aria-live="polite">
        Showing <span className="font-medium text-foreground">{shown}</span> of {total} {noun}
        {total === 1 ? "" : "s"}.
      </p>
      {filtersActive && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

export function AdvancedListEmpty({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <EmptyState
      compact
      icon="search"
      title="Nothing to show"
      description={children}
    />
  );
}

export function ListMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="stat-card card-hover holo-sheen animate-fade-in-up overflow-hidden rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {/* A plain count animates up at the Cinematic motion level; anything already
          formatted (currency, "3/8") is printed as-is, because a counter cannot
          interpolate it and a half-typed dollar figure would genuinely mislead. */}
      <p className="mt-1 text-xl font-medium tabular-nums">
        {typeof value === "number" ? <MetricCounter value={value} /> : value}
      </p>
      {detail ? <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
