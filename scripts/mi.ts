import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `mi` CLI entry point — a thin router into src/commands/*. Manual dispatch,
 * longest-key-first match ("notion pull" before "notion"), no CLI-framework
 * dependency, matching the existing "everything is tsx scripts/*.ts"
 * convention. All real logic lives in src/services|adapters — command
 * handlers here just parse args and print.
 *
 * .env.local must load before ANY command module is imported — several
 * (lib/content/paths.ts's DROPBOX_ROOT, src/adapters/notion/client.ts's
 * NOTION_API_KEY) read process.env at module top-level. Static `import`
 * statements are always hoisted and evaluated before this file's own code
 * runs, so command modules are loaded dynamically, after loadEnvFile(),
 * rather than via a top-level `import`.
 *
 * Usage: npm run mi -- <command> [args...] [--flags]
 */
export {}; // Forces module scope — without this, having no top-level static
// import/export (everything below is a dynamic import()) makes TypeScript
// treat this as a global script, colliding with notion-probe.ts's own
// top-level `main()` in the shared global namespace.

type CommandHandler = (args: string[]) => Promise<void> | void;

async function loadCommands(): Promise<Record<string, CommandHandler>> {
  const [{ doctorCommand }, { notionLinkCommand }, { notionPullCommand }, { dropboxLinkCommand }, { dropboxSyncCommand }] =
    await Promise.all([
      import("../src/commands/doctor"),
      import("../src/commands/notionLink"),
      import("../src/commands/notionPull"),
      import("../src/commands/dropboxLink"),
      import("../src/commands/dropboxSync"),
    ]);

  return {
    doctor: doctorCommand,
    "notion link": notionLinkCommand,
    "notion pull": notionPullCommand,
    "dropbox link": dropboxLinkCommand,
    "dropbox sync": dropboxSyncCommand,
  };
}

function resolveCommand(
  argv: string[],
  commands: Record<string, CommandHandler>,
): { handler: CommandHandler; rest: string[] } | null {
  // Try two-word commands ("notion pull") before falling back to one word ("doctor").
  const twoWord = argv.slice(0, 2).join(" ");
  if (commands[twoWord]) return { handler: commands[twoWord], rest: argv.slice(2) };

  const oneWord = argv[0];
  if (oneWord && commands[oneWord]) return { handler: commands[oneWord], rest: argv.slice(1) };

  return null;
}

export async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local not found — env vars may already be set another way.
  }

  const commands = await loadCommands();
  const argv = process.argv.slice(2);
  const resolved = resolveCommand(argv, commands);

  if (!resolved) {
    console.error("Usage: npm run mi -- <command> [args...]\n");
    console.error("Commands:");
    for (const name of Object.keys(commands)) console.error(`  ${name}`);
    process.exit(1);
  }

  await resolved.handler(resolved.rest);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
