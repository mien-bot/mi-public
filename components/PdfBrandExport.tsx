"use client";

import { useRef, useState } from "react";
import { MiMark } from "./MiMark";
import { ProjectPdfSave } from "./ProjectPdfSave";

export function PdfBrandExport({ darkSurface = false, projectSlug }: { darkSurface?: boolean; projectSlug?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [brandedFile, setBrandedFile] = useState<File | undefined>();
  async function exportPdf(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("Choose a PDF smaller than 20 MB.");
      const response = await fetch("/api/pdf/brand", {
        method: "POST", headers: { "Content-Type": "application/pdf" }, body: file,
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "The Mi mark could not be added.");
      }
      const blob = await response.blob();
      setBrandedFile(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-mi.pdf`, { type: "application/pdf" }));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${file.name.replace(/\.pdf$/i, "")}-mi.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("Branded copy exported. Review its pages before sharing.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "PDF export failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="PDF to brand" onChange={(event) => void exportPdf(event.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()}
        title="Choose an existing PDF and save a copy with the Mi mark. This does not export terminal history."
        className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${darkSurface ? "border-[#75aed7]/40 bg-[#75aed7]/10 text-[#dbe7ef] hover:bg-[#75aed7]/20" : "border-accent/40 bg-accent/10 text-foreground hover:bg-accent/20"}`}>
        <MiMark className="h-4 w-4" />
        {busy ? "Adding Mi mark…" : "Add Mi mark to PDF"}
      </button>
      {message && <span role="status" className={`max-w-96 text-sm ${darkSurface ? "text-[#9fb0bd]" : "text-muted-foreground"}`}>{message}</span>}
      {projectSlug && brandedFile && <div className="w-full"><ProjectPdfSave key={brandedFile.name + brandedFile.lastModified} slug={projectSlug} suppliedFile={brandedFile} /></div>}
    </div>
  );
}
