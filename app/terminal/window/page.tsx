import { Suspense } from "react";
import { TerminalPaneWindow } from "@/components/TerminalPaneWindow";

export const metadata = { title: "Terminal" };

/** The pop-out terminal card (electron/desktopMain.js's terminal pane window). It covers the
 * app chrome the same way the compact chat window does. */
export default function TerminalPaneWindowPage() {
  return (
    <Suspense fallback={null}>
      <TerminalPaneWindow />
    </Suspense>
  );
}
