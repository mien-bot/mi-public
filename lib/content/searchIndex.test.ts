import { describe, expect, it } from "vitest";
import type {
  Checklist,
  DrawingSetEntry,
  LibraryDocument,
  MarkupEntry,
  PermitEntry,
  ProjectDecision,
  ProjectSiteReport,
} from "@/lib/schema";
import type { PermitQaqcEngagement } from "@/lib/schema";
import type { Project } from "./projects";
import { buildSearchIndex, type SearchIndexReaders } from "./searchIndex";

const project: Project = {
  slug: "alpha-office",
  meta: {
    name: "Alpha Office",
    address: "100 Main Street",
    client: "Alpha Client",
    status: "in-progress",
    building_type: "office",
    occupancy_group: ["B"],
    start_date: "2026-01-02",
    team: [],
    dropbox_path: null,
    notion_page_id: null,
    client_id: null,
    content_location: "local",
    content_migrated_at: null,
  },
};

const markup: MarkupEntry = {
  sheet: "A-101",
  revision: 3,
  date: "2026-07-20",
  discipline: "architectural",
  file: "A-101-redlines.pdf",
  original_file: "A-101-original.pdf",
  status: "open",
  notes: "Coordinate the north exit door.",
  related_code_sections: ["IBC-1004"],
};

const drawing: DrawingSetEntry = {
  sheet: "M-201",
  revision: 2,
  phase: "cd",
  date: "2026-07-21",
  file: "M-201.pdf",
  status: "issued",
  notes: "Issued for permit mechanical plan.",
};

const permit: PermitEntry = {
  permit_type: "Building Permit",
  status: "under-review",
  submitted_date: "2026-07-22",
  approved_date: null,
  permit_number: "BP-4401",
  notes: "City review cycle one.",
};

const qaqc: Checklist = {
  checklist_id: "qaqc-v1",
  items: [
    {
      id: "QA-17",
      description: "Verify rated wall continuity",
      code_refs: ["IBC-706"],
      discipline: "architectural",
      status: "flagged",
      checked_by: null,
      checked_date: null,
      evidence: ["A-401 detail 7", "coordination review"],
    },
  ],
};

const documents: Record<"submissions" | "contracts" | "inspiration", LibraryDocument> = {
  submissions: {
    file: "permit-set.pdf",
    title: "Permit Submission Set",
    tags: ["permit", "issued"],
    added_date: "2026-07-23",
    source: "STUDIO",
    notes: "First city submission.",
  },
  contracts: {
    file: "owner-agreement.pdf",
    title: "Owner Agreement",
    tags: ["executed"],
    added_date: "2026-01-03",
    source: "Alpha Client",
    notes: "Executed agreement metadata only.",
  },
  inspiration: {
    file: "lobby-materials.jpg",
    title: "Lobby Material Palette",
    tags: ["interiors", "stone"],
    added_date: "2026-02-04",
    source: "Firm precedent",
    notes: "Warm neutral palette.",
  },
};

const qaqcEngagement: PermitQaqcEngagement = {
  name: "example-record-13",
  submitting_firm: "SampleConsultant",
  status: "in-review",
  dropbox_path: null,
  engagement_number: "03",
  rounds: [],
  notes: "Rev. 1 stamp request.",
};

const libraryDocument: LibraryDocument = {
  file: "office-standards.pdf",
  title: "Office Planning Standards",
  tags: ["office", "planning"],
  added_date: "2026-03-05",
  source: "STUDIO research",
  notes: "Tracked firm-library metadata.",
};

const decision: ProjectDecision = {
  version: 1,
  id: "decision-lobby-ceiling",
  title: "Lobby ceiling direction",
  status: "decided",
  decision_date: "2026-07-24",
  recorded_at: "2026-07-24T17:30:00.000Z",
  confirmed_by: "Alex",
  deciders: ["Alex", "Owner"],
  context: "The lobby needs a coordinated ceiling approach.",
  options: [{ label: "Wood slats", summary: "Warm finish with accessible panels." }],
  outcome: "Proceed with wood slats.",
  rationale: "It supports the approved material direction.",
  consequences: ["Coordinate sprinkler layout."],
  affected_deliverables: ["A-601"],
  sources: [{
    kind: "meeting",
    label: "Owner meeting",
    path: "meetings/2026-07-24-owner.md",
    item_id: "decision-1",
  }],
  supersedes: null,
  superseded_by: null,
};

const siteReport: ProjectSiteReport = {
  version: 1,
  id: "site-report-existing-conditions",
  title: "Existing conditions walk",
  status: "reviewed",
  origin: "manual",
  visit_date: "2026-07-25",
  created_at: "2026-07-25T17:30:00.000Z",
  updated_at: "2026-07-25T18:00:00.000Z",
  confirmed_by: "Alex",
  purpose: "Verify demolition assumptions.",
  scope: "First floor public areas.",
  participants: [
    { name: "Alex", role: "Architect" },
    { name: "Contractor", role: "General contractor" },
  ],
  conditions: {
    weather: "Clear",
    access: "Full first-floor access",
    lighting: "",
    occupancy: "Unoccupied",
    active_work: "Selective demolition",
  },
  sources: [],
  items: [{
    id: "O1",
    kind: "direct-observation",
    location: "Lobby",
    text: "Existing terrazzo continues under the reception desk.",
    attributed_to: null,
    source_refs: [],
    photo_refs: [{
      kind: "project-file",
      label: "Lobby floor photo",
      path: "site-photos/2026-07-25-lobby.jpg",
    }],
    owner: null,
    due_date: null,
  }],
  raw_notes: "Contractor opened the reception desk base.",
  professional_review_required: true,
};

function createReaders(overrides: Partial<SearchIndexReaders> = {}): SearchIndexReaders {
  return {
    getAllProjects: () => [project],
    getChecklist: () => null,
    getAllCodeSections: () => [],
    getMepFaqDocs: () => [],
    getAllLessonsLearned: () => [],
    getAllLeads: () => [],
    getAllClients: () => [],
    getAllPermitQaqcEngagements: () => [],
    getProjectDecisions: () => [{ decision, fileName: "decision.md", relativePath: "decisions/decision.md", hash: "d1" }],
    getProjectSiteReports: () => [{ report: siteReport, fileName: "report.md", relativePath: "site-reports/report.md", hash: "r1" }],
    getMarkupIndex: () => [markup],
    getDrawingIndex: () => [drawing],
    getPermits: () => [permit],
    getQaqcChecklist: () => qaqc,
    getProjectDocuments: (_slug, folder) => [documents[folder]],
    getAllLibraryCollections: () => [
      { slug: "firm-standards", name: "Firm Standards", documents: [libraryDocument] },
    ],
    ...overrides,
  };
}

describe("operational search index", () => {
  it("adds every operational source with an existing route", () => {
    const entries = buildSearchIndex(createReaders());

    expect(entries.map(({ type }) => type)).toEqual([
      "project",
      "decision",
      "site-report",
      "markup",
      "drawing",
      "permit",
      "qaqc-item",
      "submission",
      "inspiration",
      "contract",
      "library-document",
    ]);
    expect(entries.find(({ type }) => type === "markup")?.href).toBe(
      "/projects/alpha-office",
    );
    expect(entries.find(({ type }) => type === "permit")?.href).toBe(
      "/projects/alpha-office",
    );
    expect(entries.find(({ type }) => type === "drawing")?.href).toBe(
      "/projects/alpha-office/drawings",
    );
    expect(entries.find(({ type }) => type === "decision")?.href).toBe(
      "/projects/alpha-office/decisions#decision-lobby-ceiling",
    );
    expect(entries.find(({ type }) => type === "site-report")?.href).toBe(
      "/projects/alpha-office/site-reports#site-report-existing-conditions",
    );
    expect(entries.find(({ type }) => type === "qaqc-item")?.href).toBe(
      "/projects/alpha-office/qaqc",
    );
    expect(entries.find(({ type }) => type === "submission")?.href).toBe(
      "/projects/alpha-office/submissions",
    );
    expect(entries.find(({ type }) => type === "contract")?.href).toBe(
      "/projects/alpha-office/contracts",
    );
    expect(entries.find(({ type }) => type === "inspiration")?.href).toBe(
      "/projects/alpha-office/inspiration",
    );
    expect(entries.find(({ type }) => type === "library-document")?.href).toBe(
      "/library/firm-standards",
    );
  });

  it("indexes all relevant parsed metadata without binary content", () => {
    const entries = buildSearchIndex(createReaders());

    expect(entries.find(({ type }) => type === "markup")?.searchText).toContain(
      "A-101 3 2026-07-20 architectural open Coordinate the north exit door. A-101-redlines.pdf A-101-original.pdf IBC-1004",
    );
    expect(entries.find(({ type }) => type === "drawing")?.searchText).toContain(
      "M-201 cd 2 2026-07-21 issued Issued for permit mechanical plan. M-201.pdf",
    );
    expect(entries.find(({ type }) => type === "permit")?.searchText).toContain(
      "Building Permit under-review BP-4401 2026-07-22 City review cycle one.",
    );
    expect(entries.find(({ type }) => type === "qaqc-item")?.searchText).toContain(
      "QA-17 Verify rated wall continuity architectural flagged IBC-706 A-401 detail 7 coordination review",
    );
    expect(entries.find(({ type }) => type === "contract")?.searchText).toContain(
      "owner-agreement.pdf Owner Agreement executed 2026-01-03 Alpha Client Executed agreement metadata only.",
    );
    expect(entries.find(({ type }) => type === "library-document")?.searchText).toContain(
      "office-standards.pdf Office Planning Standards office planning 2026-03-05 STUDIO research Tracked firm-library metadata.",
    );
    expect(entries.find(({ type }) => type === "decision")?.searchText).toContain(
      "Lobby ceiling direction decided 2026-07-24 Alex Alex Owner",
    );
    expect(entries.find(({ type }) => type === "site-report")?.searchText).toContain(
      "Existing conditions walk reviewed manual 2026-07-25 Alex",
    );
    expect(entries.find(({ type }) => type === "site-report")?.searchText).not.toContain(
      "binary image",
    );
  });

  it("suppresses repeated source rows and preserves deterministic order", () => {
    const readers = createReaders({
      getMarkupIndex: () => [markup, markup],
      getAllLibraryCollections: () => [
        {
          slug: "firm-standards",
          name: "Firm Standards",
          documents: [libraryDocument, libraryDocument],
        },
      ],
    });
    const first = buildSearchIndex(readers);
    const second = buildSearchIndex(readers);

    expect(first).toEqual(second);
    expect(first.filter(({ type }) => type === "markup")).toHaveLength(1);
    expect(first.filter(({ type }) => type === "library-document")).toHaveLength(1);
    expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
  });

  it("handles empty and missing optional indexes without real project data", () => {
    const entries = buildSearchIndex(
      createReaders({
        getAllProjects: () => [],
        getAllLibraryCollections: () => [],
        getProjectDecisions: () => [],
        getProjectSiteReports: () => [],
      }),
    );

    expect(entries).toEqual([]);
  });

  it("indexes permit QAQC engagements as a distinct type, separate from projects/leads", () => {
    const entries = buildSearchIndex(
      createReaders({ getAllPermitQaqcEngagements: () => [{ slug: "914-example-ave", engagement: qaqcEngagement }] }),
    );

    const entry = entries.find(({ type }) => type === "qaqc-engagement");
    expect(entry).toMatchObject({
      id: "qaqc-engagement:914-example-ave",
      title: "example-record-13",
      subtitle: "Permit QAQC — SampleConsultant · in-review",
      href: "/permit-qaqc/914-example-ave",
    });
    expect(entry?.searchText).toContain("example-record-13 SampleConsultant in-review 03 Rev. 1 stamp request.");
  });

  it("excludes administrative records from project-facing search results", () => {
    const admin: Project = {
      ...project,
      slug: "example-project-18",
      meta: { ...project.meta, name: "example-record-17" },
    };
    const entries = buildSearchIndex(
      createReaders({ getAllProjects: () => [admin] }),
    );

    expect(entries.some(({ href }) => href.startsWith("/projects/example-project-18"))).toBe(false);
  });
});
