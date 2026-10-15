import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getProject, getProjectSlugs } from "@/lib/content";
import { projectAgentWorkspaceDir } from "@/lib/content/agentProposalInbox";
import { REPO_ROOT } from "@/lib/content/paths";
import { renameDurably } from "@/lib/content/durableRename";
import { recordAudit } from "@/src/audit/log";
import { isWriteAllowed } from "@/src/policies/approvals";
import { attachPrivatePdfToNotionTask, type NotionAttachmentResult } from "@/src/adapters/notion/taskAttachment";
import {
  finalizeStagedPdf,
  preflightPdfOutput,
  stageAndRenderPdf,
  type PdfPreflight,
  type StagedPdf,
} from "@/src/services/approvedPdfOutput";
import {
  applyNotionTaskUpdate,
  NotionTaskUpdateError,
  notionTaskChangeSchema,
  previewNotionTaskUpdate,
  verifyNotionTaskPreservedAfterAttachment,
  type NotionTaskApplyResult,
  type NotionTaskPreview,
} from "@/src/services/notionTaskUpdate";
import { z } from "zod";

const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const ACTIVE_TASK_LOCKS = new Set<string>();
const approvalSchema = z.object({
  session_id: z.string().min(1).max(200),
  confirming_message_id: z.string().min(1).max(200),
  confirming_message_timestamp: z.string().datetime({ offset: true }),
  confirming_message_text: z.string().min(1).max(500),
  change_summary_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const visualReviewSchema = z.object({
  passed: z.literal(true),
  page_count: z.number().int().positive(),
  render_manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

interface PreviewState {
  token: string;
  createdAt: string;
  status: "previewed" | "pdf-staged" | "applying" | "applied" | "needs-review";
  preview: NotionTaskPreview;
  actor: string;
  session: string;
  summaryHash: string;
  pdfPreflight?: PdfPreflight;
  stagedPdf?: StagedPdf;
  approval?: z.infer<typeof approvalSchema>;
  result?: CombinedResult;
  error?: string;
}

interface CombinedResult extends NotionTaskApplyResult {
  pdf?: {
    absolutePath: string;
    pageCount: number;
    sha256: string;
    overwritten: boolean;
    branding: { applied: boolean; reason: string; pagesStamped: number };
  };
  attachment?: NotionAttachmentResult;
  postAttachmentVerification?: {
    unspecifiedPropertiesUnchanged: boolean;
    projectRelationIntact: boolean;
    lastEditedTime: string;
  };
}

function modeAllowed(request: Request, slug: string): boolean {
  const secret = process.env.MI_TERMINAL_CAPABILITY_SECRET;
  const supplied = request.headers.get("x-mi-terminal-capability");
  const configured = secret
    ? crypto.createHmac("sha256", secret).update(slug).digest("hex")
    : null;
  return request.headers.get("x-mi-agent-mode") === "terminal-agent"
    && Boolean(configured && supplied)
    && supplied!.length === configured!.length
    && crypto.timingSafeEqual(Buffer.from(supplied!), Buffer.from(configured!));
}

function boundedHeader(request: Request, name: string, fallback: string): string {
  const value = request.headers.get(name)?.trim();
  return value && value.length <= 200 && !/[\r\n]/.test(value) ? value : fallback;
}

function stateDirectory(): string {
  return path.join(REPO_ROOT, ".mi", "notion-task-updates");
}

function statePath(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new NotionTaskUpdateError("Invalid confirmation token.", 400);
  return path.join(stateDirectory(), `${token}.json`);
}

function writeState(state: PreviewState): void {
  const target = statePath(state.token);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameDurably(temporary, target);
}

function readState(token: string): PreviewState {
  const target = statePath(token);
  if (!fs.existsSync(target)) throw new NotionTaskUpdateError("Confirmation token was not found. Preview the update again.", 404);
  const state = JSON.parse(fs.readFileSync(target, "utf8")) as PreviewState;
  if (Date.now() - Date.parse(state.createdAt) > PREVIEW_TTL_MS) {
    throw new NotionTaskUpdateError("Confirmation token expired. Fetch the task and preview the update again.", 409);
  }
  return state;
}

function projectNotionId(slug: string): string {
  if (!getProjectSlugs().includes(slug)) throw new NotionTaskUpdateError("Project not found.", 404);
  const notionPageId = getProject(slug).meta.notion_page_id;
  if (!notionPageId) {
    throw new NotionTaskUpdateError(
      "This Mi project has no human-confirmed Notion page link. Link the exact project before updating a task.",
      409,
    );
  }
  return notionPageId;
}

function hashSummary(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactApprovalPhrase(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/g, "").replace(/\s+/g, " ");
  return /^(confirm|confirmed|approved|apply exactly what you showed|yes,? proceed with the notion update(?: and pdf)?)$/.test(normalized);
}

function validateApproval(request: Request, state: PreviewState, input: unknown): z.infer<typeof approvalSchema> {
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) throw new NotionTaskUpdateError(`approval.${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`);
  const approval = parsed.data;
  const session = boundedHeader(request, "x-mi-agent-session", "");
  if (!session || session !== state.session || approval.session_id !== state.session) {
    throw new NotionTaskUpdateError("Approval belongs to a different terminal-agent session.", 403);
  }
  if (approval.change_summary_hash !== state.summaryHash) {
    throw new NotionTaskUpdateError("Approval does not match the exact proposed payload and output path.", 409);
  }
  const confirmedAt = Date.parse(approval.confirming_message_timestamp);
  if (confirmedAt < Date.parse(state.createdAt) || confirmedAt > Date.now() + 60_000) {
    throw new NotionTaskUpdateError("Confirmation must immediately follow this preview and have a valid timestamp.", 409);
  }
  if (!exactApprovalPhrase(approval.confirming_message_text)) {
    throw new NotionTaskUpdateError("The user response is ambiguous. Ask for an explicit confirmation of the exact preview.", 403);
  }
  if (state.approval && JSON.stringify(state.approval) !== JSON.stringify(approval)) {
    throw new NotionTaskUpdateError("This preview is already bound to a different confirming message.", 409);
  }
  return approval;
}

function errorResponse(cause: unknown): NextResponse {
  const error = cause instanceof Error ? cause.message : "Notion task update failed.";
  const status = cause instanceof NotionTaskUpdateError ? cause.status : 502;
  const details = cause instanceof NotionTaskUpdateError ? cause.details : undefined;
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

function exactChange(state: PreviewState, input: unknown): void {
  const parsed = notionTaskChangeSchema.safeParse(input);
  if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(state.preview.change)) {
    throw new NotionTaskUpdateError("The change file differs from the exact preview. Preview and confirm it again.", 409);
  }
}

function acquireTaskLock(taskPageId: string): () => void {
  const key = hashSummary(taskPageId);
  if (ACTIVE_TASK_LOCKS.has(key)) {
    throw new NotionTaskUpdateError("Another update for this exact Notion task is already in progress.", 409);
  }
  ACTIVE_TASK_LOCKS.add(key);
  return () => ACTIVE_TASK_LOCKS.delete(key);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!modeAllowed(request, slug)) {
    return NextResponse.json({ error: "Mi chat mode is review-card-only. This route requires Mi's scoped terminal capability." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  try {
    const notionPageId = projectNotionId(slug);
    const parsed = notionTaskChangeSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new NotionTaskUpdateError(`${issue.path.join(".") || "change"}: ${issue.message}`);
    }
    if (parsed.data.project_slug !== slug) throw new NotionTaskUpdateError("change.project_slug must exactly match the current Mi project.", 409);
    if (!isWriteAllowed("task", "content")) {
      throw new NotionTaskUpdateError(
        "Notion task-content writes are disabled in this computer's mi.config.yaml. Add task: [content] only if STUDIO approves this capability.",
        403,
      );
    }
    if (parsed.data.pdf?.attach_to_task && !isWriteAllowed("task", "attachment")) {
      throw new NotionTaskUpdateError(
        "Private Notion task attachments are disabled in this computer's mi.config.yaml.",
        403,
      );
    }
    const preview = await previewNotionTaskUpdate(parsed.data, notionPageId);
    const pdfPreflight = parsed.data.pdf
      ? preflightPdfOutput(parsed.data.pdf, projectAgentWorkspaceDir(slug))
      : undefined;
    const token = crypto.randomBytes(32).toString("hex");
    const actor = boundedHeader(request, "x-mi-agent-actor", process.env.USERNAME || process.env.USER || "unknown");
    const session = boundedHeader(request, "x-mi-agent-session", "");
    if (!session) throw new NotionTaskUpdateError("Mi must supply an authoritative terminal-agent session ID.", 403);
    const summary = {
      project_slug: slug,
      task: preview.task,
      operation: preview.plan.operation,
      changed_fields: preview.plan.changedFields,
      before_hash: preview.plan.beforeHash,
      after_hash: preview.plan.afterHash,
      before: preview.plan.beforeContent,
      after: preview.plan.afterContent,
      preserved_properties: ["date", "time", "status", "attendance", "project relations", "task type", "name"],
      pdf: pdfPreflight ? {
        source_path: pdfPreflight.sourcePath,
        output_path: pdfPreflight.outputPath,
        overwrite: pdfPreflight.targetExists,
        attach_to_task: pdfPreflight.attachRequested,
        public_link_created: false,
      } : null,
    };
    const summaryHash = hashSummary(summary);
    writeState({ token, createdAt: new Date().toISOString(), status: "previewed", preview, actor, session, summaryHash, pdfPreflight });
    return NextResponse.json({
      confirmation_required: true,
      confirmation_token: token,
      expires_in_seconds: PREVIEW_TTL_MS / 1_000,
      change_summary_hash: summaryHash,
      task: preview.task,
      change_summary: summary,
      capabilities: {
        notion_reads: "available",
        notion_writes: "available-after-exact-confirmation",
        exact_output_directory_write: pdfPreflight ? "available-after-exact-confirmation" : "not-requested",
        notion_attachment_upload: parsed.data.pdf?.attach_to_task ? "available-with-private-upload-or-explicit-unsupported-result" : "not-requested",
      },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!modeAllowed(request, slug)) {
    return NextResponse.json({ error: "Mi chat mode cannot apply direct Notion or Dropbox mutations." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const token = typeof body?.confirmation_token === "string" ? body.confirmation_token : "";
    const state = readState(token);
    if (state.preview.change.project_slug !== slug) throw new NotionTaskUpdateError("Confirmation token belongs to a different Mi project.", 403);
    exactChange(state, body?.change);
    if (state.status === "applied" && state.result) return NextResponse.json({ applied: true, already_applied: true, ...state.result });
    const approval = validateApproval(request, state, body?.approval);
    state.approval = approval;
    const action = body?.action;

    if (action === "stage_pdf") {
      if (!state.pdfPreflight || !state.preview.change.pdf) throw new NotionTaskUpdateError("This preview has no approved PDF output.");
      if (state.status === "pdf-staged" && state.stagedPdf) {
        return NextResponse.json({ staged: true, already_staged: true, visual_review_required: true, ...state.stagedPdf });
      }
      if (state.status !== "previewed") throw new NotionTaskUpdateError("This operation cannot stage a PDF in its current state.", 409);
      const confirmedSnapshot = await previewNotionTaskUpdate(state.preview.change, projectNotionId(slug));
      if (confirmedSnapshot.plan.beforeHash !== state.preview.plan.beforeHash
        || confirmedSnapshot.protectedPropertiesHash !== state.preview.protectedPropertiesHash) {
        throw new NotionTaskUpdateError(
          "Conflict: the Notion task changed after confirmation. No PDF was staged; preview the combined operation again.",
          409,
        );
      }
      state.stagedPdf = await stageAndRenderPdf(state.pdfPreflight, path.join(stateDirectory(), token));
      state.status = "pdf-staged";
      writeState(state);
      return NextResponse.json({ staged: true, already_staged: false, visual_review_required: true, ...state.stagedPdf });
    }

    if (action !== "apply") throw new NotionTaskUpdateError("Choose action=stage_pdf or action=apply.");
    if (state.preview.change.pdf) {
      const review = visualReviewSchema.safeParse(body?.visual_review);
      if (!state.stagedPdf || state.status !== "pdf-staged" || !review.success
        || review.data.page_count !== state.stagedPdf.pageCount
        || review.data.render_manifest_hash !== state.stagedPdf.renderManifestHash) {
        throw new NotionTaskUpdateError("Render every staged PDF page, inspect it, and submit the exact passing visual-review manifest before apply.", 409);
      }
    } else if (state.status !== "previewed") {
      throw new NotionTaskUpdateError("This one-task update is not ready to apply.", 409);
    }
    const releaseTaskLock = acquireTaskLock(state.preview.task.id);
    try {
      state.status = "applying";
      writeState(state);
      const partial: Record<string, unknown> = {};
      try {
        let pdf: CombinedResult["pdf"];
        if (state.pdfPreflight && state.stagedPdf && state.preview.change.pdf) {
          pdf = finalizeStagedPdf(state.stagedPdf, state.pdfPreflight, state.preview.change.pdf.overwrite);
          partial.pdf = pdf;
        }
        const notion = await applyNotionTaskUpdate(state.preview, projectNotionId(slug));
        partial.notion = notion;
        let attachment: NotionAttachmentResult | undefined;
        let postAttachmentVerification: CombinedResult["postAttachmentVerification"];
        if (pdf && state.preview.change.pdf?.attach_to_task) {
          attachment = await attachPrivatePdfToNotionTask(notion.pageId, pdf.absolutePath);
          partial.attachment = attachment;
          postAttachmentVerification = await verifyNotionTaskPreservedAfterAttachment(state.preview, projectNotionId(slug));
        }
        const result: CombinedResult = { ...notion, pdf, attachment, postAttachmentVerification };
        state.status = "applied";
        state.result = result;
        state.error = undefined;
        writeState(state);
        recordAudit({
          command: "notion task terminal operation confirmed",
          actor: state.actor,
          slug,
          diff: {
            task_id: result.pageId,
            session: state.session,
            confirming_message_id: approval.confirming_message_id,
            confirming_message_timestamp: approval.confirming_message_timestamp,
            operation: result.operation,
            before_hash: result.beforeHash,
            after_hash: result.afterHash,
            change_summary_hash: state.summaryHash,
            changed_fields: [...result.changedFields, ...(attachment?.status === "attached" ? ["attachment"] : [])],
            pdf_path_hash: pdf ? hashSummary(pdf.absolutePath) : null,
            verification: result.verification,
          },
          applied: true,
        });
        try {
          revalidatePath(`/projects/${slug}`);
          revalidatePath(`/projects/${slug}/schedule`);
        } catch {
          // Cache refresh is not part of the external mutation and must not turn a verified
          // success into a misleading failure or invite a duplicate retry.
        }
        return NextResponse.json({ applied: true, already_applied: false, ...result });
      } catch (cause) {
        state.status = "needs-review";
        state.error = cause instanceof Error ? cause.message : "Terminal operation failed.";
        writeState(state);
        recordAudit({
          command: "notion task terminal operation failed",
          actor: state.actor,
          slug,
          diff: {
            task_id: state.preview.task.id,
            session: state.session,
            confirming_message_id: approval.confirming_message_id,
            operation: state.preview.plan.operation,
            before_hash: state.preview.plan.beforeHash,
            proposed_after_hash: state.preview.plan.afterHash,
            change_summary_hash: state.summaryHash,
            partial_fields: Object.keys(partial),
            error_type: cause instanceof NotionTaskUpdateError ? "notion-task-update" : "external-service",
            error_status: cause instanceof NotionTaskUpdateError ? cause.status : 502,
          },
          applied: false,
        });
        throw new NotionTaskUpdateError(state.error, cause instanceof NotionTaskUpdateError ? cause.status : 502, {
          partial_completion: partial,
          rollback_attempted: false,
        });
      }
    } finally {
      releaseTaskLock();
    }
  } catch (cause) {
    return errorResponse(cause);
  }
}
