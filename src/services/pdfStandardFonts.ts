import fs from "node:fs";
import path from "node:path";

/**
 * Replacement data for the base-14 fonts (Helvetica, Times, Courier…), for pdf.js renders.
 *
 * A PDF may name those fonts without embedding them, which is entirely ordinary — almost
 * anything that exports a one-page agenda does it, and so does the footer Mi stamps on its
 * own output. A real PDF viewer substitutes its own faces, so the published document is
 * fine; pdf.js instead loads replacement data from `pdfjs-dist/standard_fonts/`, and
 * without it every such glyph renders as the wrong shape. The page around the text still
 * looks normal, so the render does not read as broken — it reads as a bad document.
 *
 * That matters because Mi's PDF-publishing gate is "render every page and have a person
 * look at it". A render that garbles ordinary text either gets a good document rejected or
 * teaches the reviewer to stop trusting what they see.
 */
function resolveFontDirectory(): string | null {
  const candidates: string[] = [];
  try {
    candidates.push(path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts"));
  } catch {
    // Bundled layouts that do not expose `require.resolve` fall through to the locations
    // below. The packaged server runs from the standalone runtime root, where Next has
    // placed the external `pdfjs-dist` package beside `server.js`.
  }
  candidates.push(path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts"));
  const workerSource = process.env.MI_PDF_WORKER_SRC;
  if (workerSource) {
    // Set by the desktop shell to `<runtime>/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`
    // for the same reason this lookup exists: the packaged server cannot resolve its own
    // package layout. Three directories up from the worker is the package root.
    candidates.push(path.join(path.dirname(workerSource), "..", "..", "standard_fonts"));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
  }
  return null;
}

interface BinaryDataRequest {
  kind: "cMapUrl" | "standardFontDataUrl" | "wasmUrl";
  filename: string;
}

/**
 * A `BinaryDataFactory` that reads pdf.js's auxiliary data straight off disk.
 *
 * pdf.js picks its own factory from whether it thinks it is running under Node, and in the
 * packaged app it is wrong: the server is an Electron `utilityProcess`, so pdf.js selects
 * the browser factory, reaches for `document.baseURI`, and fails before it ever opens a
 * file. (`electron/desktopMain.js` already works around the same misdetection for the
 * worker, via `MI_PDF_WORKER_SRC`.) Supplying the factory explicitly sidesteps the guess
 * entirely and behaves identically in `next dev`, in a test, and in the packaged app.
 *
 * Only the kinds Mi actually configures resolve; anything else reports the same "not
 * provided" error pdf.js's own factories do, rather than inventing a path.
 */
export class FilesystemBinaryDataFactory {
  private readonly bases: Record<string, string | null>;

  constructor(bases: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {
    this.bases = {
      cMapUrl: bases.cMapUrl ?? null,
      standardFontDataUrl: bases.standardFontDataUrl ?? null,
      wasmUrl: bases.wasmUrl ?? null,
    };
  }

  async fetch({ kind, filename }: BinaryDataRequest): Promise<Uint8Array> {
    const base = this.bases[kind];
    if (!base) throw new Error(`Ensure that the \`${kind}\` API parameter is provided.`);
    // Resolved against the directory rather than joined blindly: the file name comes from
    // the document being rendered, so this keeps a traversal attempt inside the folder.
    const file = path.join(base, path.basename(filename));
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch {
      throw new Error(`Unable to load ${kind} data at: ${file}`);
    }
  }
}

/**
 * The pdf.js options that make standard fonts render, or `{}` when this install has no font
 * directory to point at. Empty is not an error: the render still happens exactly as it did
 * before, and the caller has nothing to decide.
 *
 * pdf.js validates the trailing slash before appending a file name, so the path carries one
 * even though this factory reads it as a directory.
 */
export function standardFontOptions(): {
  standardFontDataUrl?: string;
  BinaryDataFactory?: typeof FilesystemBinaryDataFactory;
} {
  const directory = resolveFontDirectory();
  if (!directory) return {};
  return {
    // A forward slash even on Windows: pdf.js checks for that exact character, and
    // `path.join` in the factory above normalizes it back to a real path either way.
    standardFontDataUrl: `${directory}/`,
    BinaryDataFactory: FilesystemBinaryDataFactory,
  };
}
