import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/AppIcon";

export type NoticeTone = "info" | "success" | "warning" | "danger";
export type ActivityState = "loading" | "success" | "error";

export function ActivityIndicator({
  state = "loading",
  label,
  className = "",
}: {
  state?: ActivityState;
  label: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 ${
        state === "success"
          ? "text-status-success-foreground"
          : state === "error"
            ? "text-status-danger-foreground"
            : ""
      } ${className}`}
    >
      <span className="activity-indicator" aria-hidden="true">
        {state === "loading" ? (
          <span className="activity-spinner" />
        ) : state === "success" ? (
          <span className="activity-check">✓</span>
        ) : (
          <span className="font-bold">!</span>
        )}
      </span>
      <span>{label}</span>
    </span>
  );
}

const NOTICE_TONES: Record<NoticeTone, { panel: string; icon: string; defaultIcon: AppIconName }> = {
  info: {
    panel: "border-accent/30 bg-accent/5",
    icon: "bg-accent/10 text-accent",
    defaultIcon: "info",
  },
  success: {
    panel: "border-status-success-foreground/35 bg-status-success/30",
    icon: "bg-status-success text-status-success-foreground",
    defaultIcon: "checklist",
  },
  warning: {
    panel: "border-status-warning-foreground/40 bg-status-warning/30",
    icon: "bg-status-warning text-status-warning-foreground",
    defaultIcon: "questions",
  },
  danger: {
    panel: "border-status-danger-foreground/40 bg-status-danger/30",
    icon: "bg-status-danger text-status-danger-foreground",
    defaultIcon: "info",
  },
};

export function StatusNotice({
  tone = "info",
  title,
  children,
  icon,
  actions,
  className = "",
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  icon?: AppIconName;
  actions?: ReactNode;
  className?: string;
}) {
  const styles = NOTICE_TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`animate-fade-in-up rounded-xl border p-4 ${styles.panel} ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className={`mode-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${styles.icon}`}>
          <AppIcon name={icon ?? styles.defaultIcon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          {title ? <p className="font-medium text-foreground">{title}</p> : null}
          <div className={`${title ? "mt-1 " : ""}leading-6 text-muted-foreground`}>{children}</div>
          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon = "overview",
  action,
  compact = false,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: AppIconName;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`empty-state overflow-hidden rounded-xl border border-dashed border-border bg-card/40 ${compact ? "p-4" : "p-6"} ${className}`}>
      <div className={`relative z-10 flex ${compact ? "items-center" : "flex-col items-start"} gap-3`}>
        <span className={`mode-icon flex shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent ${compact ? "h-9 w-9" : "h-11 w-11"}`}>
          <AppIcon name={icon} className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description ? <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div> : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
