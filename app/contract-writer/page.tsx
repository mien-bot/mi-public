import type { Metadata } from "next";
import { ContractWriter } from "@/components/ContractWriter";
import { MiMark } from "@/components/MiMark";

export const metadata: Metadata = { title: "Contract Writer" };

export default function ContractWriterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <MiMark className="mt-0.5 h-10 w-10 shrink-0 text-accent" />
        <div>
          <h1 className="font-display text-2xl font-light tracking-wide">Contract Writer</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Build a review-first Example Studio proposal from the three supplied contract patterns. Edit every project-specific field, inspect the complete preview, and download an unsent DOCX draft.</p>
        </div>
      </div>
      <ContractWriter />
    </div>
  );
}
