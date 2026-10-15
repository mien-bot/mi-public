"use client";

export type ChatWindowPath = "/" | "/personal" | "/leads" | "/permit-qaqc" | `/leads/${string}/chat`;

export function newChatWindowHref(path: ChatWindowPath): string {
  return `${path}${path.includes("?") ? "&" : "?"}newChat=1`;
}
export function NewChatWindowButton({
  path,
  className = "",
}: {
  path: ChatWindowPath;
  className?: string;
}) {
  function openWindow() {
    if (window.electronAPI) {
      void window.electronAPI.windows.newChat(path);
      return;
    }
    window.open(newChatWindowHref(path), "_blank", "noopener,noreferrer");
  }

  return (
    <button
      type="button"
      onClick={openWindow}
      className={className}
    >
      New window
    </button>
  );
}
