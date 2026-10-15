/**
 * Validates every piece of content under projects/, codes/, and
 * reference/mep-faq/ against the zod schemas in lib/schema.ts, and confirms
 * every `code_refs` / `related_code_sections` id used anywhere resolves to a
 * real code section. Run via `npm run validate-content`.
 *
 * Content here is hand-edited by non-engineers (architects/PMs), so this is
 * meant to catch a bad edit as a clear list of errors instead of a confusing
 * runtime failure inside the Next.js build.
 */
import {
  getAllCodeSections,
  getAllLibraryCollections,
  getAllProjects,
  getBudget,
  getChecklist,
  getClient,
  getClientSlugs,
  getDrawingIndex,
  getProjectDeliverables,
  getLead,
  getLeadSlugs,
  getLessonsLearned,
  getMarkupIndex,
  getMepFaqDocs,
  getMepNotes,
  getPermitQaqcEngagement,
  getPermitQaqcSlugs,
  getPermits,
  getProgressLog,
  getProject,
  getProjectDocuments,
  getProjectDecisions,
  getProjectSiteReports,
  getProjectQuestions,
  getProjectSlugs,
  getQaqcChecklist,
  getReviews,
  getSchedule,
  PROJECT_DOCUMENT_FOLDERS,
} from "../lib/content";

const errors: string[] = [];

function tryRun(label: string, fn: () => void) {
  try {
    fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`${label}:\n${message}`);
  }
}

console.log("Validating codes library...");
let codeSectionIds = new Set<string>();
tryRun("codes/", () => {
  const sections = getAllCodeSections();
  codeSectionIds = new Set(sections.map((s) => s.doc.frontmatter.id));
  console.log(`  ${sections.length} code section(s) found.`);
});

function checkRefs(label: string, refs: string[]) {
  for (const ref of refs) {
    if (!codeSectionIds.has(ref)) {
      errors.push(`${label}: references unresolved code_refs id "${ref}"`);
    }
  }
}

console.log("Validating reference/mep-faq...");
tryRun("reference/mep-faq/", () => {
  const docs = getMepFaqDocs();
  console.log(`  ${docs.length} MEP FAQ doc(s) found.`);
});

console.log("Validating library/...");
tryRun("library/", () => {
  const collections = getAllLibraryCollections();
  console.log(`  ${collections.length} collection(s) found.`);
});

console.log("Validating clients...");
let clientSlugs = new Set<string>();
tryRun("clients/", () => {
  clientSlugs = new Set(getClientSlugs());
  for (const slug of clientSlugs) tryRun(`clients/${slug}.yaml`, () => getClient(slug));
  console.log(`  ${clientSlugs.size} client(s) found.`);
});

console.log("Validating leads...");
tryRun("leads/", () => {
  const leadSlugs = getLeadSlugs();
  const projectSlugSet = new Set(getProjectSlugs());
  for (const slug of leadSlugs) {
    tryRun(`leads/${slug}/lead.yaml`, () => {
      const { lead } = getLead(slug);
      if (lead.converted_project_slug && !projectSlugSet.has(lead.converted_project_slug)) {
        errors.push(
          `leads/${slug}/lead.yaml: converted_project_slug "${lead.converted_project_slug}" does not resolve to a project`,
        );
      }
    });
  }
  console.log(`  ${leadSlugs.length} lead(s) found.`);
});

console.log("Validating permit-qaqc...");
tryRun("permit-qaqc/", () => {
  const slugs = getPermitQaqcSlugs();
  for (const slug of slugs) {
    tryRun(`permit-qaqc/${slug}/qaqc.yaml`, () => getPermitQaqcEngagement(slug));
  }
  console.log(`  ${slugs.length} permit QAQC engagement(s) found.`);
});

console.log("Validating projects...");
for (const slug of getProjectSlugs()) {
  tryRun(`projects/${slug}/project.yaml`, () => {
    const project = getProject(slug);
    if (project.meta.client_id && !clientSlugs.has(project.meta.client_id)) {
      errors.push(`projects/${slug}/project.yaml: client_id "${project.meta.client_id}" does not resolve to a client in clients/`);
    }
  });
  tryRun(`projects/${slug}/progress-log/`, () => getProgressLog(slug));

  tryRun(`projects/${slug}/reviews/`, () => {
    const reviews = getReviews(slug);
    for (const review of reviews) {
      checkRefs(`projects/${slug}/reviews/${review.slug}.md`, review.frontmatter.related_code_sections);
    }
  });

  tryRun(`projects/${slug}/markups/index.yaml`, () => {
    const markups = getMarkupIndex(slug);
    for (const markup of markups) {
      checkRefs(
        `projects/${slug}/markups/index.yaml (${markup.sheet} rev.${markup.revision})`,
        markup.related_code_sections,
      );
    }
  });

  tryRun(`projects/${slug}/drawings/index.yaml`, () => getDrawingIndex(slug));
  tryRun(`projects/${slug}/deliverables/index.yaml`, () => getProjectDeliverables(slug));
  tryRun(`projects/${slug}/mep/`, () => getMepNotes(slug));
  tryRun(`projects/${slug}/permits/status.yaml`, () => getPermits(slug));
  tryRun(`projects/${slug}/schedule/schedule.yaml`, () => getSchedule(slug));
  tryRun(`projects/${slug}/budget/budget.yaml`, () => getBudget(slug));
  tryRun(`projects/${slug}/lessons-learned/lessons.md`, () => getLessonsLearned(slug));

  tryRun(`projects/${slug}/checklists/code-compliance.yaml`, () => {
    const checklist = getChecklist(slug);
    for (const item of checklist?.items ?? []) {
      checkRefs(`projects/${slug}/checklists/code-compliance.yaml (${item.id})`, item.code_refs);
    }
  });

  tryRun(`projects/${slug}/qaqc/qaqc.yaml`, () => {
    const qaqc = getQaqcChecklist(slug);
    for (const item of qaqc?.items ?? []) {
      checkRefs(`projects/${slug}/qaqc/qaqc.yaml (${item.id})`, item.code_refs);
    }
  });

  tryRun(`projects/${slug}/questions/questions.md`, () => getProjectQuestions(slug));

  tryRun(`projects/${slug}/decisions/`, () => {
    const decisions = getProjectDecisions(slug);
    const byId = new Map(decisions.map((document) => [document.decision.id, document.decision]));
    for (const { decision } of decisions) {
      if (decision.supersedes) {
        const previous = byId.get(decision.supersedes);
        if (!previous) {
          errors.push(
            `projects/${slug}/decisions/ (${decision.id}): supersedes missing decision "${decision.supersedes}"`,
          );
        } else if (previous.superseded_by !== decision.id) {
          errors.push(
            `projects/${slug}/decisions/ (${decision.id}): replacement link is not reciprocal`,
          );
        }
      }
      if (decision.superseded_by) {
        const replacement = byId.get(decision.superseded_by);
        if (!replacement) {
          errors.push(
            `projects/${slug}/decisions/ (${decision.id}): superseded_by missing decision "${decision.superseded_by}"`,
          );
        } else if (replacement.supersedes !== decision.id) {
          errors.push(
            `projects/${slug}/decisions/ (${decision.id}): supersession link is not reciprocal`,
          );
        }
      }
    }
  });

  tryRun(`projects/${slug}/site-reports/`, () => {
    getProjectSiteReports(slug);
  });

  for (const folder of PROJECT_DOCUMENT_FOLDERS) {
    tryRun(`projects/${slug}/${folder}/index.yaml`, () => getProjectDocuments(slug, folder));
  }
}

const projectCount = getAllProjects().length;
console.log(`  ${projectCount} project(s) found.`);

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} content error(s):\n`);
  for (const error of errors) {
    console.error(`- ${error}\n`);
  }
  process.exit(1);
}

console.log("\n✓ All content valid.");
