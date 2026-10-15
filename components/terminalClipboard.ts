export type TerminalClipboardAction = "copy" | "paste" | null;

type TerminalClipboardKey = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey" | "type"
>;

export function terminalClipboardAction(
  event: TerminalClipboardKey,
  hasSelection: boolean,
  applePlatform: boolean,
): TerminalClipboardAction {
  if (event.type !== "keydown" || event.altKey) return null;
  const key = event.key.toLowerCase();
  const primaryModifier = applePlatform ? event.metaKey : event.ctrlKey;

  if (primaryModifier && key === "v") return "paste";
  if (primaryModifier && key === "c" && (applePlatform || event.shiftKey || hasSelection)) {
    return "copy";
  }
  if (!applePlatform && event.shiftKey && key === "insert") return "paste";
  if (!applePlatform && event.ctrlKey && key === "insert" && hasSelection) return "copy";
  return null;
}
