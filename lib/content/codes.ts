import fs from "node:fs";
import path from "node:path";
import { codeSectionFrontmatterSchema, type CodeSectionFrontmatter } from "@/lib/schema";
import { readMarkdownFile, type MarkdownDoc } from "./fsUtils";
import { CODES_DIR } from "./paths";

export interface CodeSection {
  book: string;
  edition: string;
  slug: string;
  doc: MarkdownDoc<CodeSectionFrontmatter>;
}

function walkMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkMarkdownFiles(full);
    if (entry.isFile() && entry.name.endsWith(".md")) return [full];
    return [];
  });
}

/**
 * book/edition are derived from the first two path segments under codes/
 * (e.g. codes/ibc/2021/... or codes/local-amendments/chicago-il/...),
 * not from frontmatter, so URLs stay stable even though `section`/`id`
 * in frontmatter may contain dots that aren't URL-friendly.
 */
export function getAllCodeSections(): CodeSection[] {
  const files = walkMarkdownFiles(CODES_DIR);
  return files
    .map((filePath) => {
      const relative = path.relative(CODES_DIR, filePath);
      const segments = relative.split(path.sep);
      const [book, edition] = segments;
      const doc = readMarkdownFile(filePath, (data) => codeSectionFrontmatterSchema.parse(data));
      return { book, edition, slug: doc.slug, doc };
    })
    .sort((a, b) => a.doc.frontmatter.section.localeCompare(b.doc.frontmatter.section));
}

export function getCodeBookEditions(): { book: string; edition: string }[] {
  const seen = new Set<string>();
  const result: { book: string; edition: string }[] = [];
  for (const { book, edition } of getAllCodeSections()) {
    const key = `${book}/${edition}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ book, edition });
    }
  }
  return result;
}

export function getCodeSection(book: string, edition: string, slug: string): CodeSection | null {
  return (
    getAllCodeSections().find((s) => s.book === book && s.edition === edition && s.slug === slug) ??
    null
  );
}

/** Flat id -> section lookup, used to resolve checklist `code_refs`. */
export function getCodeSectionById(id: string): CodeSection | null {
  return getAllCodeSections().find((s) => s.doc.frontmatter.id === id) ?? null;
}
