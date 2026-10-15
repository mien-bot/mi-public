import { getAllProjects, getProjectSlugs } from "@/lib/content";
import { pullProjectFromNotion } from "@/src/services/notionSync";

const USAGE = [
  "Usage: npm run mi -- notion pull <slug> [--apply]",
  "       npm run mi -- notion pull --all [--apply]",
].join("\n");

export interface NotionPullOptions {
  all: boolean;
  apply: boolean;
  help: boolean;
  slug: string | null;
}

export function parseNotionPullArgs(args: string[]): NotionPullOptions {
  const unknownOptions = args.filter(
    (arg) => arg.startsWith("-") && !["--all", "--apply", "--help", "-h"].includes(arg),
  );
  if (unknownOptions.length > 0) {
    throw new Error(`Unknown option(s): ${unknownOptions.join(", ")}\n${USAGE}`);
  }

  const positional = args.filter((arg) => !arg.startsWith("-"));
  if (positional.length > 1) throw new Error(`Expected one project slug.\n${USAGE}`);

  const all = args.includes("--all");
  const slug = positional[0] ?? null;
  if (all && slug) throw new Error(`Choose either a project slug or --all, not both.\n${USAGE}`);

  return {
    all,
    apply: args.includes("--apply"),
    help: args.includes("--help") || args.includes("-h"),
    slug,
  };
}

export async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  if (values.length === 0) return;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), values.length));
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex++];
        await operation(value);
      }
    }),
  );
}

export async function notionPullCommand(args: string[]): Promise<void> {
  const options = parseNotionPullArgs(args);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.all && !options.slug) throw new Error(USAGE);

  const slugs = options.all
    ? getAllProjects()
        .filter((project) => project.meta.notion_page_id)
        .map((project) => project.slug)
    : [options.slug as string];

  if (options.all && slugs.length === 0) {
    console.log("No projects have a notion_page_id yet — run `npm run mi -- notion link <slug>` first.");
    return;
  }

  const knownSlugs = new Set(getProjectSlugs());
  const failures: string[] = [];
  const validSlugs = slugs.filter((slug) => {
    if (knownSlugs.has(slug)) return true;
    failures.push(`No project at projects/${slug}/.`);
    return false;
  });

  await mapWithConcurrency(validSlugs, options.apply ? 1 : 4, async (slug) => {
    try {
      await pullProjectFromNotion(slug, { apply: options.apply });
    } catch (error) {
      failures.push(`projects/${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  if (failures.length > 0) {
    throw new Error(`Notion pull failed for ${failures.length} project(s):\n- ${failures.join("\n- ")}`);
  }
}
