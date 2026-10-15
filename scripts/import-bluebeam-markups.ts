/**
 * Bluebeam Markups List CSV importer — dependency-free, preview-first.
 *
 * Populates a project's markups/index.yaml from a Bluebeam Revu "Markups
 * List" CSV export. Preview (the default) never writes anything; applying
 * requires two deliberate controls (--apply plus --confirm-project <slug>).
 * See docs/bluebeam-markup-import.md for full field-mapping and safety
 * documentation.
 *
 * Usage (preview — default, read-only):
 *   npx tsx scripts/import-bluebeam-markups.ts \
 *     --project <slug> --csv <path-inside-that-project's-markups/-folder> \
 *     --map-sheet="Page Label" --map-date="Date Created" \
 *     --revision 3 --discipline architectural --file "originals/round-3.csv" \
 *     --map-status=Status --status-map "Open=open,Void=addressed,ToDo=open" \
 *     [--map-notes=Comments]
 *
 * Usage (apply — writes markups/index.yaml, requires explicit confirmation):
 *   npx tsx scripts/import-bluebeam-markups.ts \
 *     --project <slug> --csv <...> [...same mapping flags...] \
 *     --apply --confirm-project <slug>
 *
 * Run --help for the full flag reference.
 */
import { parseCliArgs } from "../lib/bluebeam/cliArgs";
import { applyImport, buildPreview, type PreviewResult } from "../lib/bluebeam/importer";
import type { ResolvedMarkupRow, UnresolvedMarkupRow } from "../lib/bluebeam/types";

const HELP = `Bluebeam Markups List CSV importer (preview-first, no writes by default)

Required:
  --project <slug>            Target project slug. Must already exist. Never inferred.
  --csv <path>                Path to the CSV, resolved inside projects/<slug>/markups/.

Field mapping (each field is EITHER a --map-<field>=<CSV column> OR a fixed
--<field>=<value> applied to every row — never both, never guessed):
  --map-sheet / --sheet
  --map-revision / --revision
  --map-date / --date                 Accepts YYYY-MM-DD or M/D/YYYY (time suffix discarded).
  --map-discipline / --discipline     One of: architectural, structural, mep, mechanical,
                                       electrical, plumbing, civil. Never inferred from a sheet prefix.
  --map-file / --file
  --map-status / --status             If --map-status is used, --status-map is required.
  --status-map "Raw=schema,Raw2=schema2"   e.g. "Open=open,Void=addressed,ToDo=open"
                                       (schema values: open, addressed, superseded)
  --map-notes / --notes                        (optional)
  --map-original-file / --original-file        (optional)
  --map-related-code-sections / --related-code-sections   (optional, comma-separated column)

Apply controls (omit both to preview only — the default, no writes):
  --apply                      Write projects/<slug>/markups/index.yaml.
  --confirm-project <slug>     Must exactly match --project. Required together with --apply.

  Apply always fails, without writing anything, if any unresolved row or
  within-batch identity conflict exists. There is no flag to apply only a
  resolved subset — partial application is not supported.

  -h, --help                   Show this help.
`;

function printPreview(preview: PreviewResult, opts: { apply: boolean }): void {
  console.log(`Project:        ${preview.projectSlug} (${preview.projectDir})`);
  console.log(`CSV source:     ${preview.csvAbsolutePath}`);
  console.log(`Target index:   ${preview.targetIndexPath}`);
  console.log(`Existing entries: ${preview.existingEntryCount}`);
  console.log(`CSV data rows:  ${preview.totalDataRows}`);
  console.log(`Skipped blank physical lines: ${preview.skippedBlankRowNumbers.length}`);
  if (preview.skippedBlankRowNumbers.length > 0) {
    console.log(`  line(s): ${preview.skippedBlankRowNumbers.join(", ")}`);
  }
  console.log("");
  console.log(`Additions:  ${preview.additions.length}`);
  for (const row of preview.additions) {
    console.log(`  row ${row.rowNumber}: sheet=${row.entry.sheet} rev=${row.entry.revision} file=${row.entry.file} status=${row.entry.status}`);
  }
  console.log(`Updates:    ${preview.updates.length}`);
  for (const update of preview.updates) {
    console.log(
      `  row ${update.incoming.rowNumber}: sheet=${update.incoming.entry.sheet} rev=${update.incoming.entry.revision} file=${update.incoming.entry.file} — status ${update.existing.status} -> ${update.incoming.entry.status}`,
    );
  }
  console.log(`Duplicates (identical, no-op): ${preview.duplicates.length}`);
  for (const row of preview.duplicates) {
    console.log(`  row ${row.rowNumber}: sheet=${row.entry.sheet} rev=${row.entry.revision} file=${row.entry.file}`);
  }
  console.log(`Within-batch conflicts: ${preview.withinBatchConflicts.length}`);
  for (const conflict of preview.withinBatchConflicts) {
    console.log(`  identity "${conflict.identity}" — rows ${conflict.rows.map((r: ResolvedMarkupRow) => r.rowNumber).join(", ")} (ambiguous, must be resolved manually)`);
  }
  console.log(`Unresolved rows: ${preview.unresolved.length}`);
  for (const row of preview.unresolved as UnresolvedMarkupRow[]) {
    console.log(`  row ${row.rowNumber}:`);
    for (const reason of row.reasons) console.log(`    - ${reason}`);
  }
  console.log("");
  if (!opts.apply) {
    console.log("Preview only — no files were written. Re-run with --apply --confirm-project <slug> to write.");
  }
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help || !args.project || !args.csv) {
    console.log(HELP);
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  if (!args.apply) {
    const outcome = buildPreview({ projectSlug: args.project, csvPathArg: args.csv, mapping: args.mapping });
    if (!outcome.ok) {
      console.error(`Preview failed: ${outcome.error.kind}`);
      if ("message" in outcome.error) console.error(outcome.error.message);
      if ("issues" in outcome.error) for (const issue of outcome.error.issues) console.error(`  - ${issue}`);
      process.exitCode = 1;
      return;
    }
    printPreview(outcome.result, { apply: false });
    return;
  }

  if (!args.confirmProject) {
    console.error("--apply requires --confirm-project <slug> as a second, deliberate control.");
    process.exitCode = 1;
    return;
  }

  const outcome = applyImport({
    projectSlug: args.project,
    csvPathArg: args.csv,
    mapping: args.mapping,
    confirmProjectSlug: args.confirmProject,
  });

  if (!outcome.ok) {
    console.error(`Apply failed: ${outcome.error.kind}`);
    if ("message" in outcome.error) console.error(outcome.error.message);
    if ("issues" in outcome.error) for (const issue of outcome.error.issues) console.error(`  - ${issue}`);
    if (outcome.error.kind === "blocked-by-unresolved") printPreview(outcome.error.preview, { apply: true });
    process.exitCode = 1;
    return;
  }

  printPreview(outcome.result.preview, { apply: true });
  console.log(`Wrote ${outcome.result.writtenIndexPath}`);
  console.log(`  ${outcome.result.addedCount} added, ${outcome.result.updatedCount} updated, ${outcome.result.finalEntryCount} total entries.`);
  console.log(`Backup: ${outcome.result.backupPath}`);
}

main();
