import type { ReviewFrontmatter } from "@/lib/schema";

export interface ReviewCommentSource {
  id: string;
  frontmatter: ReviewFrontmatter;
  contentMarkdown: string;
}

function section(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    line.trim().toLowerCase() === `## ${heading}`.toLowerCase()
  );
  if (start < 0) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line.trim()));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join("\n").trim();
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  // Review findings are human/AI-authored. Keep formula-like text inert when
  // the register is opened in Excel or another spreadsheet application.
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function buildReviewCommentCsv(reviews: ReviewCommentSource[]): string {
  const headers = [
    "Comment ID",
    "Date",
    "Discipline",
    "Status",
    "Sheet / Markup References",
    "Finding",
    "Recommendation",
    "Code References",
    "Mi Source",
  ];
  const rows = reviews.map((review) => [
    review.id,
    review.frontmatter.date,
    review.frontmatter.discipline,
    review.frontmatter.status,
    review.frontmatter.related_markups.join("; "),
    section(review.contentMarkdown, "Finding"),
    section(review.contentMarkdown, "Recommendation"),
    review.frontmatter.related_code_sections.join("; "),
    review.id,
  ]);
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
