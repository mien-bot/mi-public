import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { load as loadYaml } from "js-yaml";
import { marked } from "marked";
import { isConflictedCopyName } from "./dropboxConflicts";

export function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listFiles(dir: string, extension?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !extension || name.endsWith(extension))
    // A Dropbox conflicted-copy file matches the extension filter too (e.g.
    // "schedule (Partner's conflicted copy).yaml" still ends in ".yaml") but must never be
    // parsed as real content -- see components/DataConflictBanner.tsx for where it's surfaced.
    .filter((name) => !isConflictedCopyName(name))
    .sort();
}

export interface MarkdownDoc<TFrontmatter> {
  slug: string;
  frontmatter: TFrontmatter;
  contentMarkdown: string;
  contentHtml: string;
}

export function readMarkdownFile<TFrontmatter>(
  filePath: string,
  parseFrontmatter: (raw: unknown) => TFrontmatter,
): MarkdownDoc<TFrontmatter> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const slug = path.basename(filePath).replace(/\.mdx?$/, "");
  return {
    slug,
    frontmatter: parseFrontmatter(data),
    contentMarkdown: content,
    contentHtml: marked.parse(content, { async: false }) as string,
  };
}

export function readYamlFile<T>(filePath: string, parse: (raw: unknown) => T): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = loadYaml(raw);
  return parse(data);
}

export function readYamlFileIfExists<T>(
  filePath: string,
  parse: (raw: unknown) => T,
  fallback: T,
): T {
  if (!fs.existsSync(filePath)) return fallback;
  return readYamlFile(filePath, parse);
}
