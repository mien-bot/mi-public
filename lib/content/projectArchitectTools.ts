import fs from "node:fs";
import path from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import {
  architectToolkitSchema,
  architectToolOperationSchema,
  type ArchitectToolkit,
  type ArchitectToolOperation,
} from "@/lib/architectTools";
import {
  readCurrentHash,
  writeFileAtomically,
  type AtomicWriteResult,
} from "./atomicContentWrite";
import { contentDir } from "./projects";

const EMPTY_TOOLKIT: ArchitectToolkit = {
  version: 1,
  occupancy_studies: [],
  workplace_programs: [],
  outline_specifications: [],
  products: [],
  epds: [],
  chicago_site_studies: [],
  time_reconstructions: [],
};
const MAX_TOOLKIT_FILE_BYTES = 5_000_000;

export function projectArchitectToolkitPath(slug: string): string {
  return path.join(contentDir(slug), "architect-tools", "toolkit.yaml");
}

export function getProjectArchitectToolkit(slug: string): ArchitectToolkit {
  const filePath = projectArchitectToolkitPath(slug);
  if (!fs.existsSync(filePath)) return structuredClone(EMPTY_TOOLKIT);
  if (fs.statSync(filePath).size > MAX_TOOLKIT_FILE_BYTES) {
    throw new Error(`Architect Tools exceeds the ${MAX_TOOLKIT_FILE_BYTES.toLocaleString()} byte safety limit.`);
  }
  return architectToolkitSchema.parse(loadYaml(fs.readFileSync(filePath, "utf8")) ?? {});
}

export function getProjectArchitectToolkitWithHash(slug: string): {
  toolkit: ArchitectToolkit;
  hash: string | null;
} {
  const filePath = projectArchitectToolkitPath(slug);
  return {
    toolkit: getProjectArchitectToolkit(slug),
    hash: readCurrentHash(filePath),
  };
}

function operationTarget(operation: ArchitectToolOperation): keyof ArchitectToolkit {
  switch (operation.kind) {
    case "add-occupancy-study": return "occupancy_studies";
    case "add-workplace-program": return "workplace_programs";
    case "add-outline-specification": return "outline_specifications";
    case "add-product": return "products";
    case "add-epd": return "epds";
    case "add-chicago-site-study": return "chicago_site_studies";
    case "add-time-reconstruction": return "time_reconstructions";
  }
}

export function previewArchitectToolOperation(
  toolkitInput: ArchitectToolkit,
  operationInput: ArchitectToolOperation,
): ArchitectToolkit {
  const toolkit = architectToolkitSchema.parse(toolkitInput);
  const operation = architectToolOperationSchema.parse(operationInput);
  const target = operationTarget(operation);
  const records = toolkit[target] as Array<{ id: string }>;
  if (records.some((record) => record.id === operation.value.id)) {
    throw new Error(`A ${operation.value.id} record already exists.`);
  }
  const next = structuredClone(toolkit) as Record<string, unknown>;
  next[target] = [...records, operation.value];
  return architectToolkitSchema.parse(next);
}

export function applyProjectArchitectToolOperation(input: {
  slug: string;
  operation: ArchitectToolOperation;
  expectedHash: string | null;
}): { toolkit: ArchitectToolkit; hash: string; write: AtomicWriteResult } {
  const current = getProjectArchitectToolkit(input.slug);
  const next = previewArchitectToolOperation(current, input.operation);
  const serialized = dumpYaml(next, {
    lineWidth: 110,
    noRefs: true,
    sortKeys: false,
  });
  const write = writeFileAtomically(projectArchitectToolkitPath(input.slug), serialized, {
    expectedHash: input.expectedHash,
  });
  return {
    toolkit: next,
    hash: readCurrentHash(write.filePath) as string,
    write,
  };
}
