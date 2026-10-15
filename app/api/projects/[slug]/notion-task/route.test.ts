import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  root: `${process.cwd()}/.tmp/mi-notion-route-${process.pid}-${Date.now()}`,
  apply: vi.fn(),
  attach: vi.fn(),
}));

vi.mock("@/lib/content", () => ({
  getProjectSlugs: () => ["demo"],
  getProject: () => ({ meta: { notion_page_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }),
}));
vi.mock("@/lib/content/paths", () => ({ REPO_ROOT: mocks.root }));
vi.mock("@/lib/content/agentProposalInbox", () => ({ projectAgentWorkspaceDir: () => path.join(mocks.root, "Mi") }));
vi.mock("@/src/audit/log", () => ({ recordAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/adapters/notion/taskAttachment", () => ({
  attachPrivatePdfToNotionTask: mocks.attach,
}));
vi.mock("@/src/services/notionTaskUpdate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/services/notionTaskUpdate")>();
  return {
    ...actual,
    previewNotionTaskUpdate: vi.fn(async (change) => ({
      change,
      task: {
        id: "44444444444444444444444444444444",
        url: "https://www.notion.so/task",
        name: "Work on Example.",
        lastEditedTime: "2026-08-11T12:00:00.000Z",
        projectPageIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      },
      plan: {
        operation: "append_content",
        beforeContent: "",
        afterContent: "Agenda\n7:00 PM–midnight",
        beforeHash: "before",
        afterHash: "after",
        replacements: [],
        append: { sectionTitle: "Agenda", content: "7:00 PM–midnight" },
        changedFields: ["content"],
      },
      protectedPropertiesHash: "protected",
    })),
    applyNotionTaskUpdate: mocks.apply,
    verifyNotionTaskPreservedAfterAttachment: vi.fn(async () => ({
      unspecifiedPropertiesUnchanged: true,
      projectRelationIntact: true,
      lastEditedTime: "2026-08-11T12:02:00.000Z",
    })),
  };
});

import { PATCH, POST } from "./route";

const change = {
  version: 1,
  project_slug: "demo",
  task_page_id: "44444444444444444444444444444444",
  expected_last_edited_time: "2026-08-11T12:00:00.000Z",
  operation: "append_content",
  append_content: { section_title: "Agenda", content: "7:00 PM–midnight" },
  property_patch: {},
};

function onePagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 45 >>\nstream\nBT /F1 18 Tf 40 120 Td (Meeting agenda) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function request(method: "POST" | "PATCH", body: unknown, authorized = true): Request {
  return new Request("http://localhost/api/projects/demo/notion-task", {
    method,
    headers: authorized ? {
      "content-type": "application/json",
      "x-mi-agent-mode": "terminal-agent",
      "x-mi-terminal-capability": crypto.createHmac("sha256", "test-secret").update("demo").digest("hex"),
      "x-mi-agent-session": "session-1",
      "x-mi-agent-actor": "test-agent",
    } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("project-scoped Notion task route", () => {
  beforeAll(() => {
    process.env.MI_TERMINAL_CAPABILITY_SECRET = "test-secret";
    mocks.apply.mockResolvedValue({
      pageId: change.task_page_id,
      pageUrl: "https://www.notion.so/task",
      changedFields: ["content"],
      operation: "append_content",
      beforeHash: "before",
      afterHash: "after",
      verification: {
        requestedContentPresent: true,
        unspecifiedPropertiesUnchanged: true,
        projectRelationIntact: true,
        verifiedLastEditedTime: "2026-08-11T12:01:00.000Z",
      },
    });
    mocks.attach.mockResolvedValue({
      status: "attached",
      fileName: "agenda.pdf",
      blockId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      privateUpload: true,
      publicLinkCreated: false,
    });
  });
  afterAll(() => {
    delete process.env.MI_TERMINAL_CAPABILITY_SECRET;
    fs.rmSync(mocks.root, { recursive: true, force: true });
  });

  it("keeps Mi chat mode blocked", async () => {
    const response = await POST(request("POST", change, false), { params: Promise.resolve({ slug: "demo" }) });
    expect(response.status).toBe(403);
  });

  it("rejects apply before unambiguous conversational confirmation, then applies the exact payload once", async () => {
    const previewResponse = await POST(request("POST", change), { params: Promise.resolve({ slug: "demo" }) });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    const base = {
      action: "apply",
      confirmation_token: preview.confirmation_token,
      change,
      approval: {
        session_id: "session-1",
        confirming_message_id: "message-1",
        confirming_message_timestamp: new Date().toISOString(),
        confirming_message_text: "Maybe",
        change_summary_hash: preview.change_summary_hash,
      },
    };
    const rejected = await PATCH(request("PATCH", base), { params: Promise.resolve({ slug: "demo" }) });
    expect(rejected.status).toBe(403);
    const applied = await PATCH(request("PATCH", {
      ...base,
      approval: { ...base.approval, confirming_message_text: "Confirm." },
    }), { params: Promise.resolve({ slug: "demo" }) });
    const appliedBody = await applied.json();
    expect({ status: applied.status, body: appliedBody }).toMatchObject({
      status: 200,
      body: { applied: true, changedFields: ["content"] },
    });
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });

  it("stages, renders, visually gates, finalizes, updates, and privately attaches the approved PDF", async () => {
    const workspace = path.join(mocks.root, "Mi");
    const source = path.join(workspace, "scratchpad", "agenda.pdf");
    const outputDirectory = path.join(mocks.root, "external-approved");
    const output = path.join(outputDirectory, "agenda.pdf");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(outputDirectory, { recursive: true });
    const combinedChange = {
      ...change,
      pdf: { source_path: source, output_path: output, overwrite: false, attach_to_task: true },
    };
    const previewResponse = await POST(request("POST", combinedChange), { params: Promise.resolve({ slug: "demo" }) });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    const approval = {
      session_id: "session-1",
      confirming_message_id: "message-pdf-1",
      confirming_message_timestamp: new Date().toISOString(),
      confirming_message_text: "Yes, proceed with the Notion update and PDF.",
      change_summary_hash: preview.change_summary_hash,
    };
    fs.writeFileSync(source, onePagePdf());
    const stagedResponse = await PATCH(request("PATCH", {
      action: "stage_pdf",
      confirmation_token: preview.confirmation_token,
      change: combinedChange,
      approval,
    }), { params: Promise.resolve({ slug: "demo" }) });
    expect(stagedResponse.status).toBe(200);
    const staged = await stagedResponse.json();
    expect(staged.renderedPages).toHaveLength(1);
    expect(fs.statSync(staged.renderedPages[0]).size).toBeGreaterThan(100);
    expect(fs.existsSync(output)).toBe(false);

    const appliedResponse = await PATCH(request("PATCH", {
      action: "apply",
      confirmation_token: preview.confirmation_token,
      change: combinedChange,
      approval,
      visual_review: {
        passed: true,
        page_count: staged.pageCount,
        render_manifest_hash: staged.renderManifestHash,
      },
    }), { params: Promise.resolve({ slug: "demo" }) });
    expect(appliedResponse.status).toBe(200);
    expect(await appliedResponse.json()).toMatchObject({
      applied: true,
      pdf: { absolutePath: output, pageCount: 1, overwritten: false },
      attachment: { status: "attached", privateUpload: true, publicLinkCreated: false },
      verification: { unspecifiedPropertiesUnchanged: true, projectRelationIntact: true },
    });
    expect(fs.existsSync(output)).toBe(true);
  });
});
