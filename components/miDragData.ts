export const MI_DRAG_MIME = "application/x-mi-drag-item";

export type MiDragData = {
  kind: "schedule-entry" | "project-milestone" | "portfolio-project";
  id: string;
  mode?: "move" | "resize" | "duplicate";
};

function kindMime(kind: MiDragData["kind"]): string {
  return `${MI_DRAG_MIME}-${kind}`;
}

export function setMiDragData(dataTransfer: DataTransfer, value: MiDragData): void {
  dataTransfer.effectAllowed = value.mode === "duplicate" ? "copy" : "move";
  dataTransfer.setData(MI_DRAG_MIME, JSON.stringify(value));
  // The values themselves are protected during dragenter/dragover in Chromium, but the list
  // of MIME types remains visible. This marker lets a target accept the drag before drop.
  dataTransfer.setData(kindMime(value.kind), "1");
  // Chromium requires a broadly supported payload before it will consistently start a drag
  // from interactive elements such as buttons. text/plain also keeps OS drag feedback useful.
  dataTransfer.setData("text/plain", value.id);
}

export function hasMiDragKind(dataTransfer: DataTransfer, kind: MiDragData["kind"]): boolean {
  return Array.from(dataTransfer.types ?? []).includes(kindMime(kind));
}

export function readMiDragData(dataTransfer: DataTransfer): MiDragData | null {
  try {
    const parsed = JSON.parse(dataTransfer.getData(MI_DRAG_MIME)) as Partial<MiDragData>;
    if (
      (parsed.kind === "schedule-entry" || parsed.kind === "project-milestone" || parsed.kind === "portfolio-project")
      && typeof parsed.id === "string"
      && parsed.id.length > 0
      && (parsed.mode === undefined || parsed.mode === "move" || parsed.mode === "resize" || parsed.mode === "duplicate")
    ) {
      return parsed as MiDragData;
    }
  } catch {
    // Foreign/native drops are intentionally ignored by structured Mi drop zones.
  }
  return null;
}
