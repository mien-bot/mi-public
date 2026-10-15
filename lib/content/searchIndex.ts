import { getAllClients } from "./clients";
import { getAllCodeSections } from "./codes";
import { getAllLeads } from "./leads";
import { getAllLibraryCollections } from "./library";
import { getMepFaqDocs } from "./mepFaq";
import { getAllPermitQaqcEngagements } from "./permitQaqc";
import { getProjectDecisions } from "./projectDecisions";
import { getProjectSiteReports } from "./projectSiteReports";
import { getProjectArchitectToolkit } from "./projectArchitectTools";
import {
  PROJECT_DOCUMENT_FOLDERS,
  getAllLessonsLearned,
  getAllProjects,
  getChecklist,
  getDrawingIndex,
  getMarkupIndex,
  getPermits,
  getProjectDocuments,
  getQaqcChecklist,
  type ProjectDocumentFolder,
} from "./projects";
import { isPortfolioProject } from "./projectVisibility";

export type SearchEntryType =
  | "project-file"
  | "handoff"
  | "project"
  | "code"
  | "mep-faq"
  | "lessons-learned"
  | "checklist-item"
  | "lead"
  | "client"
  | "markup"
  | "drawing"
  | "permit"
  | "qaqc-item"
  | "submission"
  | "contract"
  | "inspiration"
  | "library-document"
  | "qaqc-engagement"
  | "decision"
  | "site-report"
  | "architect-tool";

export interface SearchEntry {
  id: string;
  type: SearchEntryType;
  title: string;
  subtitle: string;
  href: string;
  searchText: string;
}

export interface SearchIndexReaders {
  getAllProjects: typeof getAllProjects;
  getChecklist: typeof getChecklist;
  getAllCodeSections: typeof getAllCodeSections;
  getMepFaqDocs: typeof getMepFaqDocs;
  getAllLessonsLearned: typeof getAllLessonsLearned;
  getAllLeads: typeof getAllLeads;
  getAllClients: typeof getAllClients;
  getMarkupIndex: typeof getMarkupIndex;
  getDrawingIndex: typeof getDrawingIndex;
  getPermits: typeof getPermits;
  getQaqcChecklist: typeof getQaqcChecklist;
  getProjectDocuments: typeof getProjectDocuments;
  getAllLibraryCollections: typeof getAllLibraryCollections;
  getAllPermitQaqcEngagements: typeof getAllPermitQaqcEngagements;
  getProjectDecisions: typeof getProjectDecisions;
  getProjectSiteReports: typeof getProjectSiteReports;
  getProjectArchitectToolkit?: typeof getProjectArchitectToolkit;
}

const DEFAULT_READERS: SearchIndexReaders = {
  getAllProjects,
  getChecklist,
  getAllCodeSections,
  getMepFaqDocs,
  getAllLessonsLearned,
  getAllLeads,
  getAllClients,
  getMarkupIndex,
  getDrawingIndex,
  getPermits,
  getQaqcChecklist,
  getProjectDocuments,
  getAllLibraryCollections,
  getAllPermitQaqcEngagements,
  getProjectDecisions,
  getProjectSiteReports,
  getProjectArchitectToolkit,
};

const PROJECT_DOCUMENT_SEARCH: Record<
  ProjectDocumentFolder,
  { type: "submission" | "contract" | "inspiration"; label: string }
> = {
  submissions: { type: "submission", label: "Submission" },
  contracts: { type: "contract", label: "Contract" },
  inspiration: { type: "inspiration", label: "Inspiration" },
};

type SearchValue = string | number | null | undefined | readonly string[];

function joinSearchText(...values: SearchValue[]): string {
  return values
    .flatMap((value) => {
      if (value === null || value === undefined) return [];
      return Array.isArray(value) ? value : [String(value)];
    })
    .join(" ");
}

/**
 * Pure index builder used by focused tests. Reader order is preserved, and
 * stable source IDs suppress repeated metadata rows without merging distinct files.
 */
export function buildSearchIndex(readers: SearchIndexReaders): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: SearchEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    entries.push(entry);
  };
  const projects = readers.getAllProjects().filter((project) =>
    isPortfolioProject({ slug: project.slug, name: project.meta.name }),
  );

  // Preserve the original search-entry order before appending operational sources.
  for (const project of projects) {
    add({
      id: `project:${project.slug}`,
      type: "project",
      title: project.meta.name,
      subtitle: project.meta.address,
      href: `/projects/${project.slug}`,
      searchText: joinSearchText(
        project.meta.name,
        project.meta.address,
        project.meta.client,
        project.meta.building_type,
        project.meta.occupancy_group,
      ),
    });

    const checklist = readers.getChecklist(project.slug);
    for (const item of checklist?.items ?? []) {
      add({
        id: `checklist:${project.slug}:${item.id}`,
        type: "checklist-item",
        title: item.description,
        subtitle: `${project.meta.name} checklist`,
        href: `/projects/${project.slug}/checklist`,
        searchText: joinSearchText(item.description, item.id, item.discipline, item.code_refs),
      });
    }
  }

  for (const section of readers.getAllCodeSections()) {
    const { frontmatter, contentMarkdown } = section.doc;
    add({
      id: `code:${section.book}:${section.edition}:${section.slug}`,
      type: "code",
      title: `${frontmatter.section} — ${frontmatter.title}`,
      subtitle: frontmatter.citation,
      href: `/codes/${section.book}/${section.edition}/${section.slug}`,
      searchText: joinSearchText(
        frontmatter.title,
        frontmatter.citation,
        frontmatter.id,
        frontmatter.applicability_tags,
        contentMarkdown,
      ),
    });
  }

  for (const doc of readers.getMepFaqDocs()) {
    add({
      id: `mep-faq:${doc.slug}`,
      type: "mep-faq",
      title: `MEP FAQ — ${doc.frontmatter.discipline}`,
      subtitle: "Cross-project MEP knowledge",
      href: `/reference/mep-faq#${doc.frontmatter.discipline}`,
      searchText: joinSearchText(doc.frontmatter.discipline, doc.contentMarkdown),
    });
  }

  for (const lesson of readers.getAllLessonsLearned()) {
    add({
      id: `lessons-learned:${lesson.projectSlug}`,
      type: "lessons-learned",
      title: `${lesson.projectName} — Lessons Learned`,
      subtitle: "Lessons Learned",
      href: "/lessons-learned",
      searchText: joinSearchText(lesson.projectName, lesson.doc.contentMarkdown),
    });
  }

  for (const { slug, lead } of readers.getAllLeads()) {
    add({
      id: `lead:${slug}`,
      type: "lead",
      title: lead.name,
      subtitle: `Lead — ${lead.source}`,
      href: `/leads/${slug}`,
      searchText: joinSearchText(lead.name, lead.source, lead.notes),
    });
  }

  for (const { slug, engagement } of readers.getAllPermitQaqcEngagements()) {
    add({
      id: `qaqc-engagement:${slug}`,
      type: "qaqc-engagement",
      title: engagement.name,
      subtitle: `Permit QAQC — ${engagement.submitting_firm} · ${engagement.status}`,
      href: `/permit-qaqc/${slug}`,
      searchText: joinSearchText(
        engagement.name,
        engagement.submitting_firm,
        engagement.status,
        engagement.engagement_number,
        engagement.notes,
      ),
    });
  }

  for (const { slug, client } of readers.getAllClients()) {
    add({
      id: `client:${slug}`,
      type: "client",
      title: client.name,
      subtitle: "Client",
      href: `/clients/${slug}`,
      searchText: joinSearchText(client.name, client.industry, client.short_summary),
    });
  }

  for (const project of projects) {
    for (const document of readers.getProjectDecisions(project.slug)) {
      const decision = document.decision;
      add({
        id: `decision:${project.slug}:${decision.id}`,
        type: "decision",
        title: decision.title,
        subtitle: `${project.meta.name} · Decision · ${decision.status}`,
        href: `/projects/${project.slug}/decisions#${decision.id}`,
        searchText: joinSearchText(
          project.meta.name,
          project.slug,
          decision.id,
          decision.title,
          decision.status,
          decision.decision_date,
          decision.confirmed_by,
          decision.deciders,
          decision.context,
          decision.options.map((option) => `${option.label} ${option.summary}`),
          decision.outcome,
          decision.rationale,
          decision.consequences,
          decision.affected_deliverables,
          decision.sources.map((source) =>
            joinSearchText(source.kind, source.label, source.path, source.url, source.item_id, source.notes),
          ),
          decision.supersedes,
          decision.superseded_by,
        ),
      });
    }

    for (const document of readers.getProjectSiteReports(project.slug)) {
      const report = document.report;
      add({
        id: `site-report:${project.slug}:${report.id}`,
        type: "site-report",
        title: report.title,
        subtitle: `${project.meta.name} · Site report · ${report.status}`,
        href: `/projects/${project.slug}/site-reports#${report.id}`,
        searchText: joinSearchText(
          project.meta.name,
          project.slug,
          report.id,
          report.title,
          report.status,
          report.origin,
          report.visit_date,
          report.confirmed_by,
          report.purpose,
          report.scope,
          report.participants.map((participant) => `${participant.name} ${participant.role}`),
          Object.values(report.conditions),
          report.sources.map((source) =>
            joinSearchText(source.kind, source.label, source.path, source.url, source.item_id, source.notes),
          ),
          report.items.map((item) =>
            joinSearchText(
              item.id,
              item.kind,
              item.location,
              item.text,
              item.attributed_to,
              item.owner,
              item.due_date,
              item.source_refs.map((source) =>
                joinSearchText(source.kind, source.label, source.path, source.item_id, source.notes),
              ),
              item.photo_refs.map((photo) =>
                joinSearchText(photo.kind, photo.label, photo.path, photo.notes),
              ),
            ),
          ),
          report.raw_notes,
        ),
      });
    }

    const architectTools = readers.getProjectArchitectToolkit?.(project.slug);
    if (architectTools) {
      for (const study of architectTools.occupancy_studies) {
        add({
          id: `architect-tool:${project.slug}:${study.id}`,
          type: "architect-tool",
          title: study.title,
          subtitle: `${project.meta.name} · Occupancy study · ${study.status}`,
          href: `/projects/${project.slug}/architect-tools`,
          searchText: joinSearchText(
            study.id,
            study.title,
            study.jurisdiction,
            study.code_edition,
            study.areas.map((area) => `${area.name} ${area.area_sf} ${area.basis}`),
            study.assumptions,
          ),
        });
      }
      for (const program of architectTools.workplace_programs) {
        add({
          id: `architect-tool:${project.slug}:${program.id}`,
          type: "architect-tool",
          title: program.title,
          subtitle: `${project.meta.name} · Workplace program`,
          href: `/projects/${project.slug}/architect-tools`,
          searchText: joinSearchText(
            program.id,
            program.title,
            program.work_policy,
            program.zones.map((zone) => zone.name),
            program.rooms.map((room) => room.name),
            program.assumptions,
            program.tradeoffs,
          ),
        });
      }
      for (const spec of architectTools.outline_specifications) {
        add({
          id: `architect-tool:${project.slug}:${spec.id}`,
          type: "architect-tool",
          title: `${spec.section_number} — ${spec.section_title}`,
          subtitle: `${project.meta.name} · Outline specification`,
          href: `/projects/${project.slug}/architect-tools`,
          searchText: joinSearchText(
            spec.id,
            spec.title,
            spec.division,
            spec.section_number,
            spec.section_title,
            spec.part_1_general,
            spec.part_2_products,
            spec.part_3_execution,
          ),
        });
      }
      for (const product of architectTools.products) {
        add({
          id: `architect-tool:${project.slug}:${product.id}`,
          type: "architect-tool",
          title: `${product.manufacturer} ${product.product_name}`,
          subtitle: `${project.meta.name} · Product · ${product.status}`,
          href: `/projects/${project.slug}/architect-tools`,
          searchText: joinSearchText(
            product.id,
            product.category,
            product.manufacturer,
            product.product_name,
            product.model,
            product.notes,
          ),
        });
      }
      for (const study of architectTools.chicago_site_studies) {
        add({
          id: `architect-tool:${project.slug}:${study.id}`,
          type: "architect-tool",
          title: study.title,
          subtitle: `${project.meta.name} · Chicago site intelligence · ${study.status}`,
          href: `/projects/${project.slug}/architect-tools`,
          searchText: joinSearchText(
            study.id,
            study.address,
            study.pin,
            study.zoning_district,
            study.findings.map((finding) =>
              `${finding.category} ${finding.status} ${finding.summary}`,
            ),
            study.gaps,
          ),
        });
      }
    }

    for (const markup of readers.getMarkupIndex(project.slug)) {
      add({
        id: `markup:${project.slug}:${markup.file}`,
        type: "markup",
        title: `${markup.sheet} rev.${markup.revision}`,
        subtitle: `${project.meta.name} · ${markup.discipline} markup · ${markup.status}`,
        href: `/projects/${project.slug}`,
        searchText: joinSearchText(
          project.meta.name,
          project.slug,
          markup.sheet,
          markup.revision,
          markup.date,
          markup.discipline,
          markup.status,
          markup.notes,
          markup.file,
          markup.original_file,
          markup.related_code_sections,
        ),
      });
    }

    for (const drawing of readers.getDrawingIndex(project.slug)) {
      add({
        id: `drawing:${project.slug}:${drawing.phase}:${drawing.file}`,
        type: "drawing",
        title: `${drawing.sheet} rev.${drawing.revision}`,
        subtitle: `${project.meta.name} · ${drawing.phase.toUpperCase()} drawing · ${drawing.status}`,
        href: `/projects/${project.slug}/drawings`,
        searchText: joinSearchText(
          project.meta.name,
          project.slug,
          drawing.sheet,
          drawing.phase,
          drawing.revision,
          drawing.date,
          drawing.status,
          drawing.notes,
          drawing.file,
        ),
      });
    }

    for (const permit of readers.getPermits(project.slug)) {
      const identity = JSON.stringify([
        permit.permit_type,
        permit.permit_number,
        permit.submitted_date,
        permit.approved_date,
      ]);
      add({
        id: `permit:${project.slug}:${identity}`,
        type: "permit",
        title: permit.permit_number
          ? `${permit.permit_type} — ${permit.permit_number}`
          : permit.permit_type,
        subtitle: `${project.meta.name} · Permit · ${permit.status}`,
        href: `/projects/${project.slug}`,
        searchText: joinSearchText(
          project.meta.name,
          project.slug,
          permit.permit_type,
          permit.status,
          permit.permit_number,
          permit.submitted_date,
          permit.approved_date,
          permit.notes,
        ),
      });
    }

    for (const item of readers.getQaqcChecklist(project.slug)?.items ?? []) {
      add({
        id: `qaqc:${project.slug}:${item.id}`,
        type: "qaqc-item",
        title: item.description,
        subtitle: `${project.meta.name} · QA/QC · ${item.id}`,
        href: `/projects/${project.slug}/qaqc`,
        searchText: joinSearchText(
          project.meta.name,
          project.slug,
          item.id,
          item.description,
          item.discipline,
          item.status,
          item.code_refs,
          item.evidence,
        ),
      });
    }

    for (const folder of PROJECT_DOCUMENT_FOLDERS) {
      const config = PROJECT_DOCUMENT_SEARCH[folder];
      for (const document of readers.getProjectDocuments(project.slug, folder)) {
        add({
          id: `project-document:${project.slug}:${folder}:${document.file}`,
          type: config.type,
          title: document.title || document.file,
          subtitle: `${project.meta.name} · ${config.label}`,
          href: `/projects/${project.slug}/${folder}`,
          searchText: joinSearchText(
            project.meta.name,
            project.slug,
            folder,
            document.file,
            document.title,
            document.tags,
            document.added_date,
            document.source,
            document.notes,
          ),
        });
      }
    }
  }

  for (const collection of readers.getAllLibraryCollections()) {
    for (const document of collection.documents) {
      add({
        id: `library-document:${collection.slug}:${document.file}`,
        type: "library-document",
        title: document.title || document.file,
        subtitle: `${collection.slug} · Firm library`,
        href: `/library/${collection.slug}`,
        searchText: joinSearchText(
          collection.slug,
          document.file,
          document.title,
          document.tags,
          document.added_date,
          document.source,
          document.notes,
        ),
      });
    }
  }

  return entries;
}

/** Small, in-memory site-wide index — fine at this repo's scale (<20 projects). */
export function getSearchIndex(): SearchEntry[] {
  return buildSearchIndex(DEFAULT_READERS);
}
