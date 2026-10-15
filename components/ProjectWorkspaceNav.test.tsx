import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DAILY_WORKSPACE_ITEMS,
  PROJECT_RECORD_ITEMS,
  PROJECT_TOOL_ITEMS,
  ProjectWorkspaceNav,
  projectWorkspaceActivePath,
} from "./ProjectWorkspaceNav";

describe("ProjectWorkspaceNav", () => {
  it("keeps the daily workspace focused without deleting specialist destinations", () => {
    expect(DAILY_WORKSPACE_ITEMS.map(([label]) => label)).toEqual([
      "Overview",
      "Plan",
      "Knowledge",
      "Files",
      "Activity",
    ]);
    // Terminal is a workspace mode in the header alongside Talk to Mi, not a tool under More.
    expect(PROJECT_TOOL_ITEMS.map(([, route]) => route)).toEqual([
      "architect-tools",
      "dropbox",
    ]);
    expect(PROJECT_RECORD_ITEMS).toHaveLength(14);
    expect(PROJECT_RECORD_ITEMS.map(([, route]) => route)).toEqual(expect.arrayContaining(["meetings", "decisions", "analysis"]));
    expect(PROJECT_RECORD_ITEMS.map(([, route]) => route)).toContain("contracts");
    expect(PROJECT_RECORD_ITEMS.map(([, route]) => route)).toContain("deliverables");
  });

  it("offers Talk to Mi and Terminal as peers, each poppable into a pinned window", () => {
    const markup = renderToStaticMarkup(<ProjectWorkspaceNav slug="test-project" />);

    expect(markup).toContain("Talk to Mi");
    expect(markup).toContain("Edit project");
    expect(markup).toContain("/projects/test-project/details");
    expect(markup).toContain("/review?workspace=project%2Ftest-project");
    expect(markup).toContain("Terminal");
    expect(markup).toContain("/projects/test-project/terminal");
    expect(markup).toContain("Open Talk to Mi in a pinned window");
    expect(markup).toContain("Open Terminal in a pinned window");
    // "Chat only" was a third, near-duplicate entry point; the pop-out control replaces it.
    expect(markup).not.toContain("Chat only");
  });

  it("names the active specialist section without expanding tools over its content", () => {
    const markup = renderToStaticMarkup(
      <ProjectWorkspaceNav slug="test-project" active="/architect-tools" />,
    );

    expect(markup).toContain("More project tools");
    expect(markup).toContain("<details");
    expect(markup).not.toContain(" open=\"\"");
    expect(markup).toContain("More project tools · Architect tools");
    expect(markup).toContain("/projects/test-project/architect-tools");
    expect(markup).toContain("/projects/test-project/dropbox");
    expect(markup).toContain("/projects/test-project/site-reports");
  });

  it("derives one stable active destination for every nested project page", () => {
    expect(projectWorkspaceActivePath("/projects/test-project", "test-project")).toBe("");
    expect(projectWorkspaceActivePath("/projects/test-project/schedule", "test-project")).toBe("/schedule");
    expect(projectWorkspaceActivePath("/projects/test-project/site-reports/draft", "test-project"))
      .toBe("/site-reports");
    expect(projectWorkspaceActivePath("/projects/another-project/schedule", "test-project")).toBe("");
  });
});
