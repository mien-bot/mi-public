import { getAllProjects, getChecklist, getMarkupIndex, getReviews } from "./projects";

export interface ChecklistCitation {
  projectSlug: string;
  projectName: string;
  itemId: string;
  itemDescription: string;
}

export interface ReviewCitation {
  projectSlug: string;
  projectName: string;
  reviewSlug: string;
  reviewDate: string;
}

export interface MarkupCitation {
  projectSlug: string;
  projectName: string;
  sheet: string;
  revision: number;
}

export interface CodeSectionCitations {
  checklistItems: ChecklistCitation[];
  reviews: ReviewCitation[];
  markups: MarkupCitation[];
}

interface CitationProject {
  slug: string;
  meta: { name: string };
}

interface CitationReaders {
  checklist(slug: string): ReturnType<typeof getChecklist>;
  reviews(slug: string): ReturnType<typeof getReviews>;
  markups(slug: string): ReturnType<typeof getMarkupIndex>;
}

/**
 * Reverse lookup for a code section id: everything across every project that
 * cites it (checklist items, review notes, markup entries). This is what
 * makes the checklist -> codes join in the schema bidirectional in the UI —
 * a code section page shows who relies on it, not just the other direction.
 */
export function getCodeSectionCitations(codeId: string): CodeSectionCitations {
  return collectCodeSectionCitations(codeId, getAllProjects(), {
    checklist: getChecklist,
    reviews: getReviews,
    markups: getMarkupIndex,
  });
}

/** Dependency-injected core so citation behavior is testable without seeded placeholder projects. */
export function collectCodeSectionCitations(
  codeId: string,
  projects: CitationProject[],
  readers: CitationReaders,
): CodeSectionCitations {
  const checklistItems: ChecklistCitation[] = [];
  const reviews: ReviewCitation[] = [];
  const markups: MarkupCitation[] = [];

  for (const project of projects) {
    const checklist = readers.checklist(project.slug);
    for (const item of checklist?.items ?? []) {
      if (item.code_refs.includes(codeId)) {
        checklistItems.push({
          projectSlug: project.slug,
          projectName: project.meta.name,
          itemId: item.id,
          itemDescription: item.description,
        });
      }
    }

    for (const review of readers.reviews(project.slug)) {
      if (review.frontmatter.related_code_sections.includes(codeId)) {
        reviews.push({
          projectSlug: project.slug,
          projectName: project.meta.name,
          reviewSlug: review.slug,
          reviewDate: review.frontmatter.date,
        });
      }
    }

    for (const markup of readers.markups(project.slug)) {
      if (markup.related_code_sections.includes(codeId)) {
        markups.push({
          projectSlug: project.slug,
          projectName: project.meta.name,
          sheet: markup.sheet,
          revision: markup.revision,
        });
      }
    }
  }

  return { checklistItems, reviews, markups };
}
