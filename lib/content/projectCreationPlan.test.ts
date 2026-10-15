import { describe, expect, it } from "vitest";
import {
  buildProjectCreationPlan,
  parseNotionProjectScopes,
  projectSlugFromName,
  safeDropboxFolder,
  safeDropboxFolderList,
} from "./projectCreationPlan";

describe("project slug suggestions", () => {
  const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  it("reproduces how real project slugs were written by hand", () => {
    expect(projectSlugFromName("26_0804_ABC Clinic")).toBe("26-0804-abc-clinic");
    expect(projectSlugFromName("example-record-55")).toBe("example-record-55");
    expect(projectSlugFromName("example-record-67")).toBe("example-record-67");
  });

  it("produces a value the form's own pattern accepts", () => {
    for (const name of ["26_0804_ABC Clinic", "  Café Renovation!! ", "A/B — Phase 2", "1001 N. Example St"]) {
      expect(projectSlugFromName(name)).toMatch(SLUG_PATTERN);
    }
  });

  it("folds punctuation, accents, and repeated separators instead of emitting them", () => {
    expect(projectSlugFromName("Café  Renovation!!")).toBe("cafe-renovation");
    expect(projectSlugFromName("A/B — Phase 2")).toBe("a-b-phase-2");
    expect(projectSlugFromName("1001 N. Example St")).toBe("1001-n-example-st");
  });

  it("returns an empty string when a name carries nothing usable, rather than a bare separator", () => {
    expect(projectSlugFromName("")).toBe("");
    expect(projectSlugFromName("   ")).toBe("");
    expect(projectSlugFromName("___")).toBe("");
  });
});

describe("project creation planning", () => {
  it("extends the firm's real Project Template folder with the confirmed 2026-07-27 conventions", () => {
    const plan = buildProjectCreationPlan({
      name: "Demo",
      slug: "26-020-demo",
      client: "",
      location: "",
      status: "not-started",
      workflow: "architecture",
      projectType: null,
      scopes: [],
      dropboxFolder: "26-020 Demo",
    });
    expect(plan.dropbox.folders).toEqual([
      "00_Reference",
      "01_Admin", "02_Pre-Design", "03_Production", "04_Presentation", "05_Plot", "06_Corr", "07_Specs",
      "08_3DModels", "09_SitePhotos",
    ]);
    expect(plan.dropbox.files.map((f) => f.relativePath)).toEqual(["README.md", ".dropboxignore"]);
  });

  it("lets a caller override the profile's default folders entirely", () => {
    const plan = buildProjectCreationPlan({
      name: "Demo",
      slug: "26-021-demo",
      client: "",
      location: "",
      status: "not-started",
      workflow: "architecture",
      projectType: null,
      scopes: [],
      dropboxFolder: "26-021 Demo",
      customFolders: ["01_Admin", "08_Renderings"],
    });
    expect(plan.dropbox.folders).toEqual(["01_Admin", "08_Renderings"]);
  });

  it("keeps photography intentionally smaller than architecture", () => {
    const base = {
      name: "Campaign photos",
      slug: "26-010-campaign-photos",
      client: "",
      location: "",
      status: "not-started" as const,
      projectType: "Photography" as const,
      scopes: [],
      dropboxFolder: "26-010 Campaign Photos",
    };
    const photography = buildProjectCreationPlan({ ...base, workflow: "photography" });
    const architecture = buildProjectCreationPlan({
      ...base,
      workflow: "architecture",
      projectType: "Commercial",
    });

    expect(photography.dropbox.folders).toEqual([
      "example-record-17",
      "01_Source",
      "02_Selects-Edits",
      "03_Deliverables",
      "04_Releases-Licensing",
      "99_Archive",
    ]);
    expect(architecture.dropbox.folders.length).toBeGreaterThan(photography.dropbox.folders.length);
    expect(photography.dropbox.folders.join(" ")).not.toMatch(/Permit|MEP|Specification/);
  });

  it("provides a dedicated STUDIO marketing profile with web, media, publishing, and analytics folders", () => {
    const plan = buildProjectCreationPlan({
      name: "26_0805_STUDIO Marketing",
      slug: "26-0805-studio-marketing",
      client: "STUDIO",
      location: "",
      status: "in-progress",
      workflow: "marketing",
      projectType: "Marketing",
      scopes: ["Marketing", "Web Design", "Photography", "Content", "Campaigns"],
      dropboxFolder: "26_0805_STUDIO Marketing",
    });

    expect(plan.project.workflowLabel).toBe("STUDIO marketing");
    expect(plan.notion).toMatchObject({
      projectType: "Marketing",
      scopes: ["Marketing", "Web Design", "Photography", "Content", "Campaigns"],
    });
    expect(plan.dropbox.folders).toEqual(expect.arrayContaining([
      "01_Brand-Standards",
      "03_Website",
      "06_Photography-Video",
      "09_Published-Deliverables",
      "10_Analytics",
    ]));
  });

  it("uses only explicit Notion classifications and scopes", () => {
    const plan = buildProjectCreationPlan({
      name: "Residence",
      slug: "26-011-residence",
      client: "Owner",
      location: "Chicago",
      status: "not-started",
      workflow: "architecture",
      projectType: null,
      scopes: ["SD", "DD"],
      dropboxFolder: "26-011 Residence",
    });
    expect(plan.notion.projectType).toBeNull();
    expect(plan.notion.scopes).toEqual(["SD", "DD"]);
  });

  it("rejects unsafe Dropbox names and unconfirmed scope values", () => {
    expect(safeDropboxFolder("../escape")).toBeNull();
    expect(safeDropboxFolder("Project/Child")).toBeNull();
    expect(safeDropboxFolder("Project 26")).toBe("Project 26");
    expect(parseNotionProjectScopes(["SD", "Invented"])).toBeNull();
    expect(parseNotionProjectScopes(["Marketing", "Other"])).toEqual(["Marketing", "Other"]);
    expect(parseNotionProjectScopes(["SD", "SD", "CA"])).toEqual(["SD", "CA"]);
  });

  it("validates an edited folder list, allowing nested paths but rejecting traversal", () => {
    expect(safeDropboxFolderList(["01_Admin", "03_Design/01_SD"])).toEqual(["01_Admin", "03_Design/01_SD"]);
    expect(safeDropboxFolderList(["01_Admin", "01_Admin"])).toEqual(["01_Admin"]);
    expect(safeDropboxFolderList(["../escape"])).toBeNull();
    expect(safeDropboxFolderList(["ok", "nested/../escape"])).toBeNull();
    expect(safeDropboxFolderList([])).toBeNull();
    expect(safeDropboxFolderList("not-an-array")).toBeNull();
    expect(safeDropboxFolderList([123])).toBeNull();
  });
});
