import { describe, expect, it } from "vitest";
import { ROOT_PROJECT_VALUE } from "./chatTypes";
import {
  createProjectChatOpenDetail,
  getProjectChatPanelContext,
} from "./projectChatUi";

describe("embedded project chat UI contract", () => {
  it("keeps the workspace action on the exact project", () => {
    expect(createProjectChatOpenDetail("example-record-35")).toEqual({
      slug: "example-record-35",
      tab: "chat",
    });
  });

  it("can open the advanced terminal tab without changing project context", () => {
    expect(createProjectChatOpenDetail("example-record-35", "terminal")).toEqual({
      slug: "example-record-35",
      tab: "terminal",
    });
  });

  it("identifies a project overview as embedded and returns the exact back link", () => {
    expect(
      getProjectChatPanelContext({
        pathname: "/projects/example-record-35",
        projectSlug: "example-record-35",
        projectName: "SampleStudio",
      }),
    ).toEqual({
      embeddedInProject: true,
      projectName: "SampleStudio",
      projectHref: "/projects/example-record-35",
    });
  });

  it("stays embedded on an exact project subroute", () => {
    expect(
      getProjectChatPanelContext({
        pathname: "/projects/example-record-35/schedule",
        projectSlug: "example-record-35",
        projectName: "SampleStudio",
      }).embeddedInProject,
    ).toBe(true);
  });

  it("does not attach to a different project with a shared slug prefix", () => {
    expect(
      getProjectChatPanelContext({
        pathname: "/projects/example-record-35-annex",
        projectSlug: "example-record-35",
        projectName: "SampleStudio",
      }).embeddedInProject,
    ).toBe(false);
  });

  it("supports explicit home chat while retaining an exact back link", () => {
    expect(
      getProjectChatPanelContext({
        pathname: "/",
        projectSlug: "example-project-59",
        projectName: "1002 S Example Blvd",
      }),
    ).toEqual({
      embeddedInProject: false,
      projectName: "1002 S Example Blvd",
      projectHref: "/projects/example-project-59",
    });
  });

  it("keeps root or missing context visibly unassociated with a project", () => {
    for (const projectSlug of [ROOT_PROJECT_VALUE, null]) {
      expect(
        getProjectChatPanelContext({
          pathname: "/projects/example-record-35",
          projectSlug,
          projectName: null,
        }),
      ).toEqual({
        embeddedInProject: false,
        projectName: null,
        projectHref: null,
      });
    }
  });
});
