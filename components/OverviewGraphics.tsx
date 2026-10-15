import type { ReactNode } from "react";
import Link from "next/link";
import { AppIcon, type AppIconName } from "./AppIcon";

/**
 * The small drawn pieces the project overview is built from.
 *
 * Every one of these renders a number the page already had — it does not compute, estimate,
 * or smooth anything. A ring that shows 62 means the health score is 62, and a bar segment
 * that is a third of the width means a third of the milestones. Nothing here draws a value
 * that is unmeasured: those states get their own explicit treatment rather than an
 * empty-looking zero, because a project with no evidence and a project scoring zero are very
 * different things and must not look alike.
 *
 * Server components, all of them: they are markup and CSS, no client JavaScript. The
 * Cinematic motion level's count-up and ring sweep are deliberately built out of a
 * registered custom property and a second decorative circle rather than a client
 * component, so that stays true — see the "Cinematic ambient motion" block in
 * app/globals.css, which also records the one narrow exception the count-up makes to the
 * honesty rule above.
 */

type StatusTone = "success" | "warning" | "danger" | "neutral" | "accent";

const TONE_STROKE: Record<StatusTone, string> = {
  success: "var(--status-success)",
  warning: "var(--status-warning)",
  danger: "var(--status-danger)",
  neutral: "var(--status-neutral)",
  accent: "var(--accent)",
};

const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
  neutral: "text-muted-foreground",
  accent: "text-accent",
};

/**
 * A whole-number figure that counts up to its true value at the Cinematic motion level and
 * simply *is* its true value at every other level.
 *
 * The moving digits are painted by a CSS `counter()` on a pseudo-element (see
 * `.metric-counter` in app/globals.css) — which is what lets every caller stay a server
 * component with no client JavaScript. The real figure is always in the DOM as text, so
 * assistive tech, find-in-page and copy/paste get the honest number even mid-animation.
 *
 * Only for integers. Anything formatted — currency, "3/8", a date — should be rendered
 * plainly instead; a counter cannot interpolate it, and a half-typed dollar figure would
 * be a genuinely misleading thing to show.
 */
export function MetricCounter({ value, className = "" }: { value: number; className?: string }) {
  const whole = Number.isFinite(value) ? Math.round(value) : 0;
  return (
    <span
      className={`metric-counter tabular-nums ${className}`}
      style={{ "--mi-count-to": whole } as React.CSSProperties}
    >
      <span className="sr-only">{whole}</span>
    </span>
  );
}

/**
 * The health score as a ring. `measured` false is the unmeasured/partial case: the track is
 * drawn as a dashed outline with no filled arc at all, so a project Mi cannot score reads as
 * "not measured" rather than as a bad score.
 */
export function HealthRing({
  score,
  tone,
  measured,
  label,
  title,
}: {
  score: number;
  tone: StatusTone;
  measured: boolean;
  label: string;
  title?: string;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, score)) / 100;

  return (
    <div className="flex items-center gap-3" title={title}>
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            strokeWidth="5"
            stroke="var(--border-strong)"
            strokeDasharray={measured ? undefined : "3 5"}
            opacity={measured ? 0.45 : 0.9}
          />
          {measured && (
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              stroke={TONE_STROKE[tone]}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - filled)}
              className="health-ring-arc"
              style={{ "--health-ring-circumference": `${circumference}` } as React.CSSProperties}
            />
          )}
          {/* Purely decorative, and only drawn at Cinematic: a short dash orbiting the same
              radius. It carries no value — the arc above is the score — so it is safe for
              it to be the one thing here that moves forever. */}
          {measured && (
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="round"
              stroke={TONE_STROKE[tone]}
              strokeDasharray="7 300"
              opacity={0.7}
              className="health-ring-sweep"
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          {measured ? (
            <span className={`font-display text-lg font-light leading-none ${TONE_TEXT[tone]}`}>
              <MetricCounter value={score} />
            </span>
          ) : (
            <>
              <span aria-hidden="true" className="font-display text-lg font-light leading-none text-muted-foreground">—</span>
              <span className="sr-only">No health score: {label}</span>
            </>
          )}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Health</p>
        <p className="mt-0.5 text-sm leading-tight">{label}</p>
      </div>
    </div>
  );
}

/**
 * A stat with an icon and room for a drawn detail underneath. `tone` colors only the icon,
 * never the value: the number stays foreground-colored so a red icon cannot be misread as
 * the figure itself being an error.
 */
export function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "accent",
  children,
  delayMs,
  action,
}: {
  icon: AppIconName;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatusTone;
  children?: ReactNode;
  delayMs?: number;
  /**
   * Where to go to fill this in. Naming a gap without offering the way to close it is the
   * difference between a report and a workspace, so every card that can read "not recorded"
   * carries one.
   */
  action?: { href: string; label: string };
}) {
  return (
    <div
      className="stat-card card-hover holo-sheen animate-fade-in-up flex flex-col overflow-hidden rounded-lg border border-border bg-card p-3.5"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <div className="flex items-center gap-2">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-background/60 ${TONE_TEXT[tone]}`}>
          <AppIcon name={icon} className="mode-icon h-3.5 w-3.5" />
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 text-sm">{value}</div>
      {children && <div className="mt-2.5">{children}</div>}
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-2 inline-flex w-fit items-center gap-1 text-xs text-link underline-offset-2 hover:underline"
        >
          {action.label}
          <span aria-hidden="true">&rarr;</span>
        </Link>
      )}
    </div>
  );
}

export interface BarSegment {
  key: string;
  count: number;
  tone: StatusTone;
  label: string;
}

/**
 * Proportional counts as one bar. Renders nothing at all when every segment is zero — a bar
 * of pure track reads as "measured and empty", which is not what an unpopulated schedule
 * means.
 */
export function SegmentBar({ segments }: { segments: readonly BarSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return null;
  const shown = segments.filter((segment) => segment.count > 0);

  return (
    <div className="meter-sheen flex h-1.5 w-full overflow-hidden rounded-full bg-border/60" role="img" aria-label={shown.map((s) => `${s.count} ${s.label}`).join(", ")}>
      {shown.map((segment) => (
        <span
          key={segment.key}
          className="segment-bar-fill h-full"
          style={{ width: `${(segment.count / total) * 100}%`, background: TONE_STROKE[segment.tone] }}
          title={`${segment.count} ${segment.label}`}
        />
      ))}
    </div>
  );
}

/** A single percentage as a slim meter. */
export function MiniMeter({ percent, tone = "accent", label }: { percent: number; tone?: StatusTone; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${clamped}% ${label}`}>
      <span className="meter-sheen h-1.5 flex-1 overflow-hidden rounded-full bg-border/60">
        <span
          className="segment-bar-fill block h-full rounded-full"
          style={{ width: `${clamped}%`, background: TONE_STROKE[tone] }}
        />
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        <MetricCounter value={clamped} />%
      </span>
    </div>
  );
}

/**
 * A small count as filled/empty pips, for quantities where the exact number matters less
 * than "some / none / a lot". Caps the drawn pips and states the overflow numerically.
 */
export function CountPips({ filled, total, label }: { filled: number; total: number; label: string }) {
  const cap = 8;
  const drawn = Math.min(total, cap);
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={`${filled} of ${total} ${label}`}>
      <span className="flex gap-1">
        {Array.from({ length: drawn }, (_, index) => (
          <span
            key={index}
            className={`animate-ink-bloom h-1.5 w-1.5 rounded-full ${index < filled ? "bg-accent" : "bg-border-strong"}`}
            style={{ animationDelay: `${index * 45}ms`, animationFillMode: "backwards" }}
          />
        ))}
      </span>
      {total > cap && <span className="font-mono text-[10px] text-muted-foreground">+{total - cap}</span>}
    </div>
  );
}

/** A confirmed/missing shared source, with the state readable without relying on color. */
export function SourceChip({ label, connected }: { label: string; connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
        connected ? "border-status-success/40 text-foreground" : "border-border text-muted-foreground"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-status-success" : "bg-border-strong"}`}
        aria-hidden="true"
      />
      {label}
      <span className="sr-only">{connected ? " linked" : " not linked"}</span>
    </span>
  );
}
