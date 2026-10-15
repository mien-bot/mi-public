/**
 * Recovering the spacebar from a Windows IME.
 *
 * With an IME active in the language bar -- Microsoft Pinyin and friends, *including* their
 * English mode -- Chromium reports keys the IME claims as `keyCode: 229` with `key: "Process"`.
 * xterm.js hands those to its composition helper, which sends nothing itself and instead waits
 * to see what the IME writes into the hidden textarea. Letters arrive that way. The spacebar
 * frequently does not: it is the IME's own commit key, so the IME eats it and inserts nothing,
 * and the keystroke is simply lost between the keyboard and the shell.
 *
 * That is invisible at a plain prompt (a missing space in a command line reads as a typo) and
 * maddening inside an interactive agent, where the space bar stops working for whole sentences.
 *
 * `code` is the physical key and stays accurate no matter what the IME claims, so a swallowed
 * space is identifiable. `isComposing` is the guard that keeps this from breaking real IME use:
 * while a candidate window is open, space *should* select a candidate rather than reach the
 * shell, and `isComposing` is true for exactly that window.
 */
export function isImeClaimedSpace(event: Pick<
  KeyboardEvent,
  "type" | "code" | "keyCode" | "isComposing"
>): boolean {
  return event.type === "keydown"
    && event.code === "Space"
    && event.keyCode === 229
    && !event.isComposing;
}

/**
 * How long to wait before deciding the IME really did drop the space.
 *
 * xterm's own fallback reads the textarea back on a 0ms timer, so this has to be later than
 * that: if the IME did deliver the space, xterm sends it and this must stay quiet rather than
 * add a second one. Short enough to be imperceptible while typing.
 */
export const IME_SPACE_GRACE_MS = 12;
