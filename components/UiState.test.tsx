import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityIndicator, EmptyState, StatusNotice } from "./UiState";

describe("shared UI states", () => {
  it("uses a polite status role for non-destructive notices", () => {
    const markup = renderToStaticMarkup(
      <StatusNotice tone="warning" title="Review needed">Check the shared record.</StatusNotice>,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Review needed");
    expect(markup).toContain("border-status-warning-foreground/40");
  });

  it("uses an alert role for failures", () => {
    const markup = renderToStaticMarkup(<StatusNotice tone="danger">Save failed.</StatusNotice>);
    expect(markup).toContain('role="alert"');
  });

  it("renders a contextual empty state and optional action", () => {
    const markup = renderToStaticMarkup(
      <EmptyState title="No matching projects" description="Clear the filters to see everything." action={<button>Clear filters</button>} />,
    );
    expect(markup).toContain("No matching projects");
    expect(markup).toContain("Clear filters");
  });

  it("announces loading and confirmed completion without relying on color", () => {
    const loading = renderToStaticMarkup(<ActivityIndicator label="Checking Notion" />);
    const success = renderToStaticMarkup(<ActivityIndicator state="success" label="Notion checked" />);
    expect(loading).toContain('role="status"');
    expect(loading).toContain("activity-spinner");
    expect(success).toContain("Notion checked");
    expect(success).toContain("✓");
  });
});
