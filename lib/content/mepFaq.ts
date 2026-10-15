import path from "node:path";
import { mepFaqFrontmatterSchema, type MepFaqFrontmatter } from "@/lib/schema";
import { listFiles, readMarkdownFile, type MarkdownDoc } from "./fsUtils";
import { REFERENCE_DIR } from "./paths";

const MEP_FAQ_DIR = path.join(REFERENCE_DIR, "mep-faq");

export function getMepFaqDocs(): MarkdownDoc<MepFaqFrontmatter>[] {
  return listFiles(MEP_FAQ_DIR, ".md").map((file) =>
    readMarkdownFile(path.join(MEP_FAQ_DIR, file), (data) => mepFaqFrontmatterSchema.parse(data)),
  );
}
