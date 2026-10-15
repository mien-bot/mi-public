import { NextResponse } from "next/server";
import {
  captureProjectTerminalProposalReply,
  getProjectSlugs,
  listAgentProposalInbox,
  resolveAgentInboxProposals,
} from "@/lib/content";

const MAX_TERMINAL_PROPOSAL_BYTES = 1_000_000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  return NextResponse.json({ records: listAgentProposalInbox(slug) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (
    typeof body?.rawReply !== "string"
    || !["file", "terminal"].includes(body?.source)
    || Buffer.byteLength(body.rawReply, "utf8") > MAX_TERMINAL_PROPOSAL_BYTES
  ) {
    return NextResponse.json(
      { error: "Send one file or terminal proposal source smaller than 1 MB." },
      { status: 400 },
    );
  }
  try {
    const result = captureProjectTerminalProposalReply({
      projectSlug: slug,
      rawReply: body.rawReply,
      source: body.source === "file" ? "mi-project-terminal-file" : "mi-project-terminal",
    });
    if (result.status === "none") {
      return NextResponse.json(
        { error: "No Mi proposal envelope was found in the selected source." },
        { status: 400 },
      );
    }
    if (result.status === "invalid") {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (result.status === "conflict") {
      return NextResponse.json({ error: result.error, proposalIds: result.proposalIds }, { status: 409 });
    }
    if (result.status === "duplicate") {
      return NextResponse.json({ captured: false, duplicate: true, ...result });
    }
    return NextResponse.json({ captured: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The terminal proposals could not be saved." },
      { status: 409 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  // One id or many: dismissing the remainder of an envelope has to be a single
  // write, because each write invalidates the expectedHash the client is holding.
  const proposalIds: unknown = Array.isArray(body?.proposalIds)
    ? body.proposalIds
    : typeof body?.proposalId === "string"
      ? [body.proposalId]
      : null;
  if (
    body?.confirmed !== true ||
    typeof body.envelopeId !== "string" ||
    !Array.isArray(proposalIds) ||
    proposalIds.length === 0 ||
    !proposalIds.every((id) => typeof id === "string" && id.length > 0) ||
    typeof body.expectedHash !== "string" ||
    !["applied", "dismissed"].includes(body.status) ||
    (body.reason !== undefined && typeof body.reason !== "string")
  ) {
    return NextResponse.json(
      { error: "Closing an inbox draft requires its exact IDs, hash, status, and confirmation." },
      { status: 400 },
    );
  }
  try {
    const hash = resolveAgentInboxProposals({
      slug,
      envelopeId: body.envelopeId,
      proposalIds: proposalIds as string[],
      status: body.status,
      reason: body.reason,
      expectedHash: body.expectedHash,
    });
    return NextResponse.json({ resolved: true, hash });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The inbox draft could not be closed." },
      { status: 409 },
    );
  }
}
