import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffFolderScan,
  namedDateFromFileName,
  rankAttachmentCandidates,
  scanDirectory,
  type FolderIndex,
  type FolderScan,
} from "./workspaceFolderScan";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-folder-scan-"));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  return root;
}

function scannedPaths(scan: FolderScan): string[] {
  return scan.status === "scanned" ? scan.files.map((file) => file.relativePath) : [];
}

describe("namedDateFromFileName", () => {
  it("reads the 26_MMDD_ convention and rejects impossible dates", () => {
    expect(namedDateFromFileName("26_0812_example-record-70 Contract_Rev3.docx")).toBe("2026-08-12");
    expect(namedDateFromFileName("26_0230_Nope.pdf")).toBeNull();
    expect(namedDateFromFileName("26_1332_Nope.pdf")).toBeNull();
    expect(namedDateFromFileName("Contract.pdf")).toBeNull();
  });
});

describe("scanDirectory", () => {
  it("reports a folder it cannot read rather than returning an empty result", () => {
    const scan = scanDirectory(path.join(os.tmpdir(), "mi-definitely-missing-folder"));
    expect(scan.status).toBe("unreachable");
  });

  it("skips Mi's own workspace, backups, and Dropbox conflicted copies", () => {
    const root = tree({
      "01_Admin/26_0812_Contract_Rev3.docx": "x",
      "Mi/AGENTS.md": "generated",
      "Mi/inbox/entry-a.json": "{}",
      ".mi-backups/old.bak": "x",
      "01_Admin/Contract (conflicted copy 2026-08-12).docx": "x",
      "desktop.ini": "x",
    });
    expect(scannedPaths(scanDirectory(root))).toEqual(["01_Admin/26_0812_Contract_Rev3.docx"]);
  });

  it("finds documents in project folders that do not use the lead scheme", () => {
    // SampleStudio and SampleCafe use 01_Drawings/03_Correspondence; HeyTea uses example-record-17;
    // Rollins Rd uses "04 Correspondence" with a space. A hardcoded path list would
    // silently collect nothing for any of them.
    const root = tree({
      "01_Drawings/26_0812_Set.pdf": "x",
      "03_Correspondence/26_0812_Letter.pdf": "x",
      "04 Correspondence/26_0812_Note.pdf": "x",
      "Some Ad Hoc Folder/26_0812_Loose.pdf": "x",
    });
    expect(scannedPaths(scanDirectory(root))).toHaveLength(4);
  });

  it("marks known document folders without excluding the others", () => {
    const root = tree({
      "06_Corr/00_Incoming/26_0812_Redline.pdf": "x",
      "Some Ad Hoc Folder/26_0812_Loose.pdf": "x",
    });
    const scan = scanDirectory(root);
    const byPath = new Map(
      scan.status === "scanned" ? scan.files.map((file) => [file.relativePath, file]) : [],
    );
    expect(byPath.get("06_Corr/00_Incoming/26_0812_Redline.pdf")?.notableFolder).toBe(true);
    expect(byPath.get("Some Ad Hoc Folder/26_0812_Loose.pdf")?.notableFolder).toBe(false);
  });
});

describe("diffFolderScan", () => {
  it("reports additions, in-place changes, and removals against the recorded index", () => {
    const root = tree({ "01_Admin/a.pdf": "one", "01_Admin/b.pdf": "two" });
    const scan = scanDirectory(root);
    const index: FolderIndex = {
      version: 1,
      scanned_at: "2026-08-10T00:00:00.000Z",
      files: {
        "01_Admin/a.pdf": { size: 3, first_seen: "2026-08-10T00:00:00.000Z" },
        "01_Admin/gone.pdf": { size: 9, first_seen: "2026-08-01T00:00:00.000Z" },
      },
    };
    const changes = diffFolderScan(scan, index);
    expect(changes.added.map((file) => file.relativePath)).toEqual(["01_Admin/b.pdf"]);
    expect(changes.changed).toHaveLength(0);
    expect(changes.removed).toEqual(["01_Admin/gone.pdf"]);
    expect(changes.lastScannedAt).toBe("2026-08-10T00:00:00.000Z");
  });

  it("reports nothing new on an unchanged second pass, so Analyze stays idempotent", () => {
    const root = tree({ "01_Admin/a.pdf": "one" });
    const scan = scanDirectory(root);
    const index: FolderIndex = {
      version: 1,
      scanned_at: "2026-08-10T00:00:00.000Z",
      files: { "01_Admin/a.pdf": { size: 3, first_seen: "2026-08-10T00:00:00.000Z" } },
    };
    expect(diffFolderScan(scan, index)).toMatchObject({ added: [], changed: [], removed: [] });
  });

  it("claims nothing changed when the folder could not be read", () => {
    const unreachable: FolderScan = { status: "unreachable", reason: "offline" };
    expect(diffFolderScan(unreachable, null)).toMatchObject({ added: [], changed: [], removed: [] });
  });
});

describe("rankAttachmentCandidates", () => {
  it("dates a file by its parent folder when the filename carries no date", () => {
    // The real client redline on 1000 W Example is exactly this shape: only the folder
    // is dated, so filename-only matching would never offer the document.
    const root = tree({
      "06_Corr/00_Incoming/26_0812_Casey Contract Redline/1000_W_Example_STUDIO_Contract_Redline.pdf": "x",
    });
    const scan = scanDirectory(root);
    const file = scan.status === "scanned" ? scan.files[0] : undefined;
    expect(file?.namedDate).toBe("2026-08-12");
    expect(file?.dateSource).toBe("folder");

    const ranked = rankAttachmentCandidates(scan.status === "scanned" ? scan.files : [], "2026-08-12");
    expect(ranked[0].file.fileName).toBe("1000_W_Example_STUDIO_Contract_Redline.pdf");
    expect(ranked[0].reason).toContain("folder dated 2026-08-12");
  });

  it("puts the meeting-dated file in the incoming folder first", () => {
    const root = tree({
      "06_Corr/00_Incoming/26_0812_Casey Contract Redline/redline.pdf": "x",
      "06_Corr/00_Incoming/26_0812_Redline.pdf": "x",
      "01_Admin/26_0806_Older.pdf": "x",
      "02_Pre-Design/Site Photos/IMG_3298.JPG": "x",
    });
    const scan = scanDirectory(root);
    const ranked = rankAttachmentCandidates(scan.status === "scanned" ? scan.files : [], "2026-08-12");
    const order = ranked.map((candidate) => candidate.file.relativePath);

    // Both 08-12 documents outrank the 08-06 one, whether the date is on the file or its folder.
    expect(order.slice(0, 2)).toEqual(expect.arrayContaining([
      "06_Corr/00_Incoming/26_0812_Redline.pdf",
      "06_Corr/00_Incoming/26_0812_Casey Contract Redline/redline.pdf",
    ]));
    expect(order.indexOf("01_Admin/26_0806_Older.pdf")).toBeGreaterThan(1);
    // An undated photo scores nothing and drops out rather than padding the list.
    expect(order).not.toContain("02_Pre-Design/Site Photos/IMG_3298.JPG");
  });
});
