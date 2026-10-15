export interface TerminalViewportMeasurement {
  width: number;
  height: number;
}
const MIN_TERMINAL_WIDTH = 160;
const MIN_TERMINAL_HEIGHT = 100;
const FIT_TOLERANCE_PX = 2;

/** Hidden panels report zero/tiny boxes. Fitting xterm to those boxes resizes the backing PTY
 * and forces full-screen CLIs to redraw when the tab becomes visible again. */
export function shouldFitTerminal(
  active: boolean,
  next: TerminalViewportMeasurement,
  previous: TerminalViewportMeasurement | null,
  force = false,
): boolean {
  if (!active || next.width < MIN_TERMINAL_WIDTH || next.height < MIN_TERMINAL_HEIGHT) return false;
  if (force || !previous) return true;
  return (
    Math.abs(next.width - previous.width) >= FIT_TOLERANCE_PX
    || Math.abs(next.height - previous.height) >= FIT_TOLERANCE_PX
  );
}
