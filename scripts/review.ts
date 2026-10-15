import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewDestinationKindSchema, type ReviewDestinationKind } from "@/lib/content/reviewInbox";
import {
  confirmBulkReviewCards,
  previewBulkApply,
  readGlobalReviewInbox,
  readWorkspaceReviewSummary,
  type ReviewCardView,
} from "@/lib/content/reviewInboxService";
import type { WorkspaceKind } from "@/lib/content/workspaceOutbox";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const HELP = `Mi review inbox

Usage:
  mi review list [--project <slug> | --lead <slug> | --qaqc <slug>]
  mi review confirm (--project <slug> | --lead <slug> | --qaqc <slug>)
                    (--all | --card <id> [--card <id> ...])
                    [--destination <kind>] [--reviewed-by <name>] [--yes]

\`list\` shows what is waiting, with the card ids and destinations \`confirm\` takes.

\`confirm\` prints the combined effect of writing every named card and stops there.
Nothing is written until you re-run the same command with --yes, which records the
confirmation against your name. It refuses a set the app would refuse: more than one
workspace, a card that is no longer pending, a destination some card cannot reach, or
two cards proposing different values for one field.

This confirms Mi's own review cards -- notes, record fields and meeting notes. Schedule
and time entries proposed by a project agent are confirmed on the project's page in Mi,
where a Notion write can be reviewed against the live record.

Examples:
  mi review list
  mi review list --project example-record-35
  mi review confirm --project example-record-35 --all
  mi review confirm --project example-record-35 --all --yes
`;

export interface ReviewCommandOptions {
  help: boolean;
  action: "list" | "confirm";
  workspace: { kind: WorkspaceKind; slug: string } | null;
  cardIds: string[];
  all: boolean;
  destination: ReviewDestinationKind | null;
  reviewedBy: string;
  confirmed: boolean;
}

const WORKSPACE_FLAGS: Record<string, WorkspaceKind> = {
  "--project": "project",
  "--lead": "lead",
  "--qaqc": "permit-qaqc",
  "--permit-qaqc": "permit-qaqc",
};

export function parseReviewArgs(argv: string[]): ReviewCommandOptions {
  const empty: ReviewCommandOptions = {
    help: true,
    action: "list",
    workspace: null,
    cardIds: [],
    all: false,
    destination: null,
    reviewedBy: "",
    confirmed: false,
  };
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return empty;

  const action = argv[0];
  if (action !== "list" && action !== "confirm") {
    throw new Error("Use `mi review list` or `mi review confirm`.");
  }

  const options: ReviewCommandOptions = { ...empty, help: false, action };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const kind = WORKSPACE_FLAGS[flag];
    if (kind) {
      const slug = argv[index + 1] ?? "";
      if (!SLUG.test(slug)) throw new Error(`${flag} needs a valid workspace slug.`);
      if (options.workspace) throw new Error("Name exactly one workspace.");
      options.workspace = { kind, slug };
      index += 1;
    } else if (flag === "--card") {
      const id = argv[index + 1] ?? "";
      if (!id || id.startsWith("--")) throw new Error("--card needs a card id from `mi review list`.");
      options.cardIds.push(id);
      index += 1;
    } else if (flag === "--destination") {
      const parsed = reviewDestinationKindSchema.safeParse(argv[index + 1]);
      if (!parsed.success) {
        throw new Error(`--destination must be one of: ${reviewDestinationKindSchema.options.join(", ")}.`);
      }
      options.destination = parsed.data;
      index += 1;
    } else if (flag === "--reviewed-by") {
      options.reviewedBy = (argv[index + 1] ?? "").trim().slice(0, 200);
      index += 1;
    } else if (flag === "--all") {
      options.all = true;
    } else if (flag === "--yes") {
      options.confirmed = true;
    } else {
      throw new Error(`Unknown option for \`mi review\`: ${flag}`);
    }
  }

  if (action === "confirm") {
    if (!options.workspace) throw new Error("`mi review confirm` needs --project, --lead, or --qaqc.");
    if (options.all && options.cardIds.length > 0) throw new Error("Use --all or --card, not both.");
    if (!options.all && options.cardIds.length === 0) throw new Error("Name --all or at least one --card.");
  }
  return options;
}

/**
 * The one destination every named card can actually be written to.
 *
 * Mirrors the app: a bulk confirmation offers only destinations shared by the whole set,
 * so one command can never mean two different writes. When the set shares more than one,
 * the choice is the person's to make rather than Mi's to guess.
 */
export function resolveSharedDestination(views: ReviewCardView[]): {
  destination: ReviewDestinationKind | null;
  choices: { kind: ReviewDestinationKind; label: string; record: string }[];
} {
  if (views.length === 0) return { destination: null, choices: [] };
  const choices = views[0].destinations
    .filter((option) =>
      option.available
      && views.every((view) =>
        view.destinations.some((candidate) => candidate.ref.kind === option.ref.kind && candidate.available)))
    .map((option) => ({ kind: option.ref.kind, label: option.label, record: option.record }));
  return { destination: choices.length === 1 ? choices[0].kind : null, choices };
}

function reviewer(supplied: string): string {
  const value = supplied || process.env.MI_REVIEWED_BY || process.env.USERNAME || process.env.USER || "";
  // An unnamed reviewer is recorded as unnamed rather than as nobody: the audit line has to
  // say a person did this even when Mi does not know which person.
  return value.trim() || "Unnamed Mi user";
}

function describe(view: ReviewCardView): string {
  const title = view.content?.title || view.card.source.file_name;
  const kind = view.card.entry_kind ?? "entry";
  return `  ${view.card.id}\n    ${title}\n    ${kind} · ${view.card.status} · ${view.workspace.label}`;
}

function listCommand(options: ReviewCommandOptions): number {
  const views = options.workspace
    ? readWorkspaceReviewSummary(options.workspace.kind, options.workspace.slug, { limit: 500 }).pending
    : readGlobalReviewInbox().views.filter((view) => view.card.status === "pending");

  if (views.length === 0) {
    process.stdout.write("Nothing is waiting for confirmation.\n");
    return 0;
  }
  process.stdout.write(`${views.length} pending card(s):\n\n`);
  for (const view of views) {
    process.stdout.write(`${describe(view)}\n`);
    const available = view.destinations.filter((option) => option.available);
    process.stdout.write(
      available.length > 0
        ? `    destinations: ${available.map((option) => `${option.ref.kind} → ${option.record}`).join(", ")}\n\n`
        : "    destinations: none available\n\n",
    );
  }
  process.stdout.write("Confirm with: mi review confirm --project <slug> --all --yes\n");
  return 0;
}

function confirmCommand(options: ReviewCommandOptions): number {
  const workspace = options.workspace;
  if (!workspace) throw new Error("`mi review confirm` needs --project, --lead, or --qaqc.");
  const summary = readWorkspaceReviewSummary(workspace.kind, workspace.slug, { limit: 500 });
  const pending = summary.pending;

  const selected = options.all
    ? pending
    : options.cardIds.map((id) => {
      const view = pending.find((candidate) => candidate.card.id === id);
      if (!view) throw new Error(`No pending card ${id} in ${workspace.kind}/${workspace.slug}.`);
      return view;
    });

  if (selected.length === 0) {
    process.stdout.write("Nothing is pending in that workspace.\n");
    return 0;
  }

  const shared = resolveSharedDestination(selected);
  const destination = options.destination ?? shared.destination;
  if (!destination) {
    if (shared.choices.length === 0) {
      throw new Error(
        "No one destination can take every selected card. Run `mi review list` to see each card's "
        + "own destinations, and confirm the odd ones out separately.",
      );
    }
    throw new Error(
      `These cards share ${shared.choices.length} destinations. Add --destination with one of: `
      + `${shared.choices.map((choice) => `${choice.kind} (${choice.record})`).join(", ")}.`,
    );
  }

  const plan = previewBulkApply({
    kind: workspace.kind,
    slug: workspace.slug,
    cardIds: selected.map((view) => view.card.id),
    destinationKind: destination,
  });

  process.stdout.write(`${plan.effects.length} card(s) would be written to ${workspace.kind}/${workspace.slug}:\n\n`);
  for (const effect of plan.effects) {
    process.stdout.write(`  ${effect.title}\n    → ${effect.record}\n    ${effect.summary}\n\n`);
  }
  for (const blocker of plan.blockers) process.stderr.write(`Blocked: ${blocker}\n`);

  if (!plan.allowed) {
    process.stderr.write("\nNothing was written.\n");
    return 1;
  }
  if (!options.confirmed) {
    process.stdout.write("Nothing has been written. Re-run the same command with --yes to confirm all of it.\n");
    return 0;
  }

  const outcome = confirmBulkReviewCards({
    previewFingerprint: plan.fingerprint,
    kind: workspace.kind,
    slug: workspace.slug,
    cardIds: selected.map((view) => view.card.id),
    destinationKind: destination,
    reviewedBy: reviewer(options.reviewedBy),
  });
  const failures = outcome.applied.filter((item) => !item.applied);
  for (const item of outcome.applied) {
    process.stdout.write(`${item.applied ? "Applied" : "Not applied"}: ${item.message}\n`);
  }
  process.stdout.write(
    `\n${outcome.applied.length - failures.length} of ${outcome.applied.length} confirmed as `
    + `${reviewer(options.reviewedBy)}.\n`,
  );
  return failures.length === 0 ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseReviewArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  return options.action === "list" ? listCommand(options) : confirmCommand(options);
}

const isDirectExecution =
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
