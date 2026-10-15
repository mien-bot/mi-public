import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { buildContractDocx, safeContractFilename } from "@/lib/contracts/docx";
import { contractDraftInputSchema } from "@/lib/contracts/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || body.confirmed !== true) {
    return NextResponse.json({ error: "Confirm the local draft download first." }, { status: 409 });
  }

  try {
    const draft = contractDraftInputSchema.parse(body.draft);
    const bytes = await buildContractDocx(draft);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeContractFilename(draft.projectName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "The contract draft is invalid." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Mi could not prepare the contract draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
