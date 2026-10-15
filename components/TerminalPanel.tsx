"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { terminalFileLinkProvider, terminalWebLink } from "./terminalLinks";
import "@xterm/xterm/css/xterm.css";
import { terminalClipboardAction } from "./terminalClipboard";
import { IME_SPACE_GRACE_MS, isImeClaimedSpace } from "./terminalImeSpace";
import {
  latestTerminalProposalBlock,
  projectSlugFromTerminalCwd,
  terminalBufferText,
} from "./terminalProposalCapture";
import { shouldFitTerminal, type TerminalViewportMeasurement } from "./terminalSizing";
import { THEME_PREFERENCE_EVENT } from "@/lib/theme/preferences";
import { workspaceDisplayName } from "./workspacePanes";
import { PdfBrandExport } from "./PdfBrandExport";
import { TerminalViewGuard } from "./TerminalViewGuard";
import { currentTerminalTheme } from "./terminalTheme";
import { ResolvedTerminalWorkspace } from "./ResolvedTerminalWorkspace";

type TerminalPanelProps = {
  cwd: string;
  compact?: boolean;
  active?: boolean;
  onPopOut?: () => void;
  chromeless?: boolean;
  session?: string;
};

export function TerminalPanel(props: TerminalPanelProps) {
  return <ResolvedTerminalWorkspace workspace={props.cwd}>{cwd => <ResolvedTerminalPanel {...props} cwd={cwd} />}</ResolvedTerminalWorkspace>;
}

function ResolvedTerminalPanel(props: TerminalPanelProps) {
  const sessionKey = `workspace:${props.cwd.replaceAll("\\", "/")}${!props.session || props.session === "1" ? "" : `:session:${props.session}`}`;
  return <TerminalViewGuard key={sessionKey} sessionKey={sessionKey}><TerminalView {...props} /></TerminalViewGuard>;
}

const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 18;
const TERMINAL_FONT_SIZE_KEY = "mi.terminal.font-size.v1";
/** Only used before the document can be read (SSR, or a computed value that comes back
 * empty); the live answer is always --mi-code-font, which Settings > Appearance drives. */
const FALLBACK_CODE_FONT = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';

/** The Coding font choice, resolved off <html>. xterm needs a concrete family string --
 * it measures glyphs itself and cannot take a CSS variable. */
function currentCodeFont(): string {
  if (typeof window === "undefined") return FALLBACK_CODE_FONT;
  const value = window.getComputedStyle(document.documentElement)
    .getPropertyValue("--mi-code-font")
    .trim();
  return value || FALLBACK_CODE_FONT;
}

/**
 * Real shell, not a sandboxed command runner — this is meant for running
 * `codex`, `claude`, `git`, npm scripts, etc. inside the given project's
 * folder. Only works inside the Electron app (see electron/main.js); in a
 * plain browser tab there's no local process to attach to.
 */
function TerminalView({
  cwd,
  compact = false,
  active = true,
  onPopOut,
  chromeless = false,
  session = "1",
}: {
  cwd: string;
  compact?: boolean;
  active?: boolean;
  /** Renders the titlebar's "open in a pinned window" control when provided. */
  onPopOut?: () => void;
  /** Inside a pop-out card the window's own titlebar already frames the shell, so the
   *  panel drops its border, radius, and shadow instead of drawing a card inside a card. */
  chromeless?: boolean;
  session?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef<number | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<((force?: boolean) => void) | null>(null);
  const activeRef = useRef(active);
  const followOutputRef = useRef(true);
  const fontSizeRef = useRef(DEFAULT_FONT_SIZE);
  const copySelectionRef = useRef<() => void>(() => undefined);
  const pasteClipboardRef = useRef<() => void>(() => undefined);
  const captureProposalsRef = useRef<() => Promise<void>>(async () => undefined);
  const lastCapturedProposalRef = useRef<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [fontPreferenceLoaded, setFontPreferenceLoaded] = useState(false);
  const [followOutput, setFollowOutput] = useState(true);
  const [hasSelection, setHasSelection] = useState(false);
  const [clipboardMessage, setClipboardMessage] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [proposalCapture, setProposalCapture] = useState<{
    state: "idle" | "saving" | "saved" | "error";
    message: string;
  }>({ state: "idle", message: "" });
  const [status, setStatus] = useState<"connecting" | "running" | "exited" | "error">("connecting");
  // Server-rendered HTML can't know about window.electronAPI (client-only
  // global injected by Electron's preload script), so this always starts
  // false to match SSR output, then flips after mount — the standard
  // hydration-safe pattern for client-only globals.
  const [mounted, setMounted] = useState(false);
  const projectSlug = projectSlugFromTerminalCwd(cwd);

  async function chooseProposalFile() {
    if (!projectSlug || !window.electronAPI) return;
    setProposalCapture({ state: "saving", message: "Choose a proposal JSON file…" });
    let selected: Awaited<ReturnType<typeof window.electronAPI.terminal.pickProposalFile>>;
    try {
      selected = await window.electronAPI.terminal.pickProposalFile(projectSlug);
    } catch (error) {
      setProposalCapture({
        state: "error",
        message: error instanceof Error ? error.message : "The proposal file could not be opened.",
      });
      return;
    }
    if (selected.canceled) {
      setProposalCapture({ state: "idle", message: "" });
      return;
    }

    const fileContext = `${selected.path} · modified ${new Date(selected.mtime).toLocaleString()}`;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/agent-inbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawReply: selected.rawReply, source: "file" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "The proposal file could not be validated.");
      setProposalCapture({
        state: "saved",
        message: body.duplicate
          ? `Already in Mi: ${fileContext}. No duplicate cards were created.`
          : `${body.proposalCount} review card${body.proposalCount === 1 ? "" : "s"} loaded from ${fileContext}. Nothing has been applied yet.`,
      });
    } catch (error) {
      setProposalCapture({
        state: "error",
        message: `${fileContext}: ${error instanceof Error ? error.message : "The proposal file could not be validated."}`,
      });
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-hydration flag, see comment above
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      const saved = Number(window.localStorage.getItem(TERMINAL_FONT_SIZE_KEY));
      if (Number.isInteger(saved) && saved >= MIN_FONT_SIZE && saved <= MAX_FONT_SIZE) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a renderer-only preference after hydration
        setFontSize(saved);
      }
    } catch {
      // A disabled storage backend should not prevent the terminal from opening.
    }
    setFontPreferenceLoaded(true);
  }, [mounted]);

  useEffect(() => {
    if (!fontPreferenceLoaded) return;
    try {
      window.localStorage.setItem(TERMINAL_FONT_SIZE_KEY, String(fontSize));
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
  }, [fontPreferenceLoaded, fontSize]);

  useEffect(() => {
    followOutputRef.current = followOutput;
    if (followOutput) terminalRef.current?.scrollToBottom();
  }, [followOutput]);

  useEffect(() => {
    activeRef.current = active;
    if (!active) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        fitRef.current?.(true);
        terminalRef.current?.focus();
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [active]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
    const term = terminalRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    const frame = requestAnimationFrame(() => fitRef.current?.(true));
    return () => cancelAnimationFrame(frame);
  }, [fontSize]);

  // Settings > Appearance > Coding font, applied to a live shell. Changing the family
  // changes the cell size, so the pty has to be re-measured or the remote side keeps
  // wrapping at the old column count.
  useEffect(() => {
    if (!mounted) return;
    let frame: number | null = null;
    let disposed = false;
    let version = 0;

    async function syncCodeFont() {
      const term = terminalRef.current;
      if (!term) return;
      const request = ++version;
      term.options.theme = currentTerminalTheme();
      const family = currentCodeFont();
      try { await document.fonts.load(`${fontSizeRef.current}px ${family.split(",")[0]}`); } catch { /* Use the declared fallback. */ }
      if (disposed || request !== version || terminalRef.current !== term) return;
      // Reset xterm's glyph measurement after a bundled face finishes loading.
      term.options.fontFamily = "monospace";
      term.options.fontFamily = family;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitRef.current?.(true));
    }

    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { void syncCodeFont(); });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mi-theme", "data-mi-display", "data-mi-preset", "data-mi-code-font"] });
    schedule();
    window.addEventListener(THEME_PREFERENCE_EVENT, schedule);
    window.addEventListener("storage", schedule);
    return () => {
      disposed = true;
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener(THEME_PREFERENCE_EVENT, schedule);
      window.removeEventListener("storage", schedule);
    };
  }, [mounted, generation, cwd, session]);

  useEffect(() => {
    if (!mounted) return;
    const api = window.electronAPI;
    if (!api || !containerRef.current) return;

    const linkContainer = containerRef.current;
    const linkHandler = {
      allowNonHttpProtocols: true,
      activate(event: MouseEvent, text: string) {
        event.preventDefault();
        setLinkMessage("");
        if (!api.terminal.openLink) {
          setLinkMessage("Restart Mi to enable opening terminal links.");
          return;
        }
        void api.terminal.openLink(text).then(result => {
          if (result.opened === "revealed") setLinkMessage("Shown in its folder. This file type is not opened automatically.");
        }).catch((error: unknown) => {
          setLinkMessage(error instanceof Error ? error.message : "This link could not be opened.");
        });
      },
      hover(_event: MouseEvent, text: string) {
        linkContainer.title = terminalWebLink(text) ?? text;
      },
      leave() { linkContainer.removeAttribute("title"); },
    };
    const term = new Terminal({
      convertEol: false,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorWidth: 1,
      customGlyphs: true,
      fontSize: fontSizeRef.current,
      fontFamily: currentCodeFont(),
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0.2,
      lineHeight: 1.24,
      minimumContrastRatio: 4.5,
      rescaleOverlappingGlyphs: true,
      rightClickSelectsWord: true,
      scrollOnUserInput: false,
      scrollSensitivity: 1,
      scrollback: 5000,
      smoothScrollDuration: 0,
      theme: currentTerminalTheme(),
      linkHandler,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon(linkHandler.activate, linkHandler));
    term.registerLinkProvider(terminalFileLinkProvider(() => term.buffer.active, () => term.cols, linkHandler));
    term.open(containerRef.current);
    terminalRef.current = term;

    let terminalId: number | null = null;
    let disposed = false;
    let lastPtyCols = term.cols;
    let lastPtyRows = term.rows;
    let outputFrame: number | null = null;
    let outputWriting = false;
    let awaitingCreate = true;
    let pendingOutput = "";
    let lastFitMeasurement: TerminalViewportMeasurement | null = null;
    // How many IME-claimed spacebar presses are waiting to see whether they reach the shell on
    // their own, and what the hidden textarea held when the first of them arrived. Counted
    // rather than flagged so a fast double space cannot collapse into one; see
    // terminalImeSpace.ts and the key handler below.
    let imeSpaceCount = 0;
    let imeSpaceTextarea = "";
    let imeSpaceTimer: number | null = null;
    const pendingData = new Map<number, string>();
    // Electron owns one durable PTY per workspace. This component is a view
    // that may detach and reattach as the user navigates around Mi.
    const sessionKey = `workspace:${cwd.replaceAll("\\", "/")}${session === "1" ? "" : `:session:${session}`}`;

    const writeTerminalData = (data: string) => {
      // Background windows suspend animation frames. Bound their pending paint
      // buffer while the main process continues recording the full transcript.
      pendingOutput = (pendingOutput + data).slice(-512_000);
      if (outputFrame !== null || outputWriting || disposed) return;
      // Interactive agents often split one visual update across several PTY
      // chunks. Paint those chunks together on the next frame so xterm never
      // exposes the half-drawn state as a visible flash.
      outputFrame = requestAnimationFrame(() => {
        outputFrame = null;
        const output = pendingOutput;
        pendingOutput = "";
        outputWriting = true;
        term.write(output, () => {
          outputWriting = false;
          if (disposed) return;
          if (pendingOutput) writeTerminalData("");
          if (followOutputRef.current) term.scrollToBottom();
        });
      });
    };

    const offData = api.terminal.onData(({ id, data }) => {
      if (id === terminalId) {
        writeTerminalData(data);
      } else if (awaitingCreate) {
        const buffered = (pendingData.get(id) ?? "") + data;
        pendingData.set(id, buffered.slice(-64_000));
      }
    });

    const offExit = api.terminal.onExit(({ id, exitCode }) => {
      if (id !== terminalId) return;
      term.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`);
      terminalId = null;
      terminalIdRef.current = null;
      setStatus("exited");
    });

    const onInput = term.onData((data) => {
      // xterm sent something for these keystrokes after all, so there is nothing to recover.
      imeSpaceCount = 0;
      if (terminalId !== null) api.terminal.write(terminalId, data);
    });

    let clipboardMessageTimer: number | null = null;
    const showClipboardMessage = (message: string) => {
      setClipboardMessage(message);
      if (clipboardMessageTimer !== null) window.clearTimeout(clipboardMessageTimer);
      clipboardMessageTimer = window.setTimeout(() => setClipboardMessage(""), 1800);
    };
    const copySelection = async () => {
      const selection = term.getSelection();
      if (!selection) return;
      try {
        await navigator.clipboard.writeText(selection);
        showClipboardMessage("Copied");
      } catch {
        showClipboardMessage("Copy unavailable");
      }
    };
    const pasteClipboard = async () => {
      try {
        const value = await navigator.clipboard.readText();
        if (value) term.paste(value);
        showClipboardMessage(value ? "Pasted" : "Clipboard empty");
      } catch {
        showClipboardMessage("Paste unavailable");
      }
    };
    copySelectionRef.current = () => void copySelection();
    pasteClipboardRef.current = () => void pasteClipboard();
    captureProposalsRef.current = async () => {
      if (!projectSlug) return;
      const terminalText = term.getSelection() || terminalBufferText(term.buffer.active);
      const rawReply = latestTerminalProposalBlock(terminalText);
      if (!rawReply) {
        setProposalCapture({
          state: "error",
          message: "No complete Mi proposal block found. Ask the agent to restate the proposals, then try again.",
        });
        return;
      }
      if (lastCapturedProposalRef.current === rawReply) {
        setProposalCapture({
          state: "saved",
          message: "These review cards were already sent to Mi. Nothing has been applied yet.",
        });
        return;
      }
      setProposalCapture({ state: "saving", message: "Validating terminal proposals…" });
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/agent-inbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawReply, source: "terminal" }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || "The terminal proposals could not be saved.");
        lastCapturedProposalRef.current = rawReply;
        setProposalCapture({
          state: "saved",
          message: body.duplicate
            ? "These review cards are already pending in Mi. No duplicates were created."
            : `${body.proposalCount} review card${body.proposalCount === 1 ? "" : "s"} sent to Mi. Nothing has been applied yet.`,
        });
      } catch (error) {
        setProposalCapture({
          state: "error",
          message: error instanceof Error ? error.message : "The terminal proposals could not be saved.",
        });
      }
    };

    const helperTextarea = () =>
      containerRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea") ?? null;

    term.attachCustomKeyEventHandler((event) => {
      const action = terminalClipboardAction(
        event,
        term.hasSelection(),
        /Mac|iPhone|iPad/i.test(navigator.platform),
      );
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (action === "copy") void copySelection();
        else void pasteClipboard();
        return false;
      }

      // This handler runs before xterm's composition helper, which is the only place the
      // decision is still recoverable. The key is not swallowed here -- xterm still gets it,
      // and this only steps in afterwards if nothing arrived: neither xterm sending data nor
      // the IME writing into the textarea, which is the same evidence xterm itself reads.
      if (isImeClaimedSpace(event)) {
        if (imeSpaceCount === 0) imeSpaceTextarea = helperTextarea()?.value ?? "";
        imeSpaceCount += 1;
        if (imeSpaceTimer !== null) window.clearTimeout(imeSpaceTimer);
        imeSpaceTimer = window.setTimeout(() => {
          imeSpaceTimer = null;
          const missing = imeSpaceCount;
          imeSpaceCount = 0;
          if (missing === 0 || terminalId === null) return;
          if ((helperTextarea()?.value ?? "") !== imeSpaceTextarea) return;
          api.terminal.write(terminalId, " ".repeat(missing));
        }, IME_SPACE_GRACE_MS);
      }
      return true;
    });

    term.attachCustomWheelEventHandler((event) => {
      if (event.deltaY < 0 && term.buffer.active.baseY > 0) {
        followOutputRef.current = false;
        setFollowOutput(false);
      }
      return true;
    });

    const fit = (force = false) => {
      const container = containerRef.current;
      if (!container) return;
      const measurement = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
      if (!shouldFitTerminal(activeRef.current, measurement, lastFitMeasurement, force)) return;
      lastFitMeasurement = measurement;
      fitAddon.fit();
      if (
        terminalId !== null
        && term.cols > 0
        && term.rows > 0
        && (term.cols !== lastPtyCols || term.rows !== lastPtyRows)
      ) {
        lastPtyCols = term.cols;
        lastPtyRows = term.rows;
        api.terminal.resize(terminalId, term.cols, term.rows);
      }
    };
    fitRef.current = fit;
    fit(true);

    const onScroll = term.onScroll((viewportY) => {
      const atBottom = viewportY >= term.buffer.active.baseY;
      if (atBottom === followOutputRef.current) return;
      followOutputRef.current = atBottom;
      setFollowOutput(atBottom);
    });
    const onSelectionChange = term.onSelectionChange(() => setHasSelection(term.hasSelection()));

    setStatus("connecting");
    api.terminal.create(cwd, term.cols, term.rows, sessionKey)
      .then(({ id, replay }) => {
        awaitingCreate = false;
        if (disposed) {
          return;
        }
        terminalId = id;
        terminalIdRef.current = id;
        if (replay) writeTerminalData(replay);
        const buffered = pendingData.get(id);
        if (buffered) writeTerminalData(buffered);
        pendingData.clear();
        setStatus("running");
        fit(true);
        term.focus();
      })
      .catch((error: unknown) => {
        awaitingCreate = false;
        pendingData.clear();
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        term.writeln(`\r\n\x1b[31mUnable to start terminal: ${message}\x1b[0m`);
        setStatus("error");
      });

    let resizeTimer: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (!activeRef.current) return;
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => fit(false), 120);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      if (outputFrame !== null) cancelAnimationFrame(outputFrame);
      if (imeSpaceTimer !== null) window.clearTimeout(imeSpaceTimer);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (clipboardMessageTimer !== null) window.clearTimeout(clipboardMessageTimer);
      resizeObserver.disconnect();
      onInput.dispose();
      onScroll.dispose();
      onSelectionChange.dispose();
      offData();
      offExit();
      // Navigation and collapsed panels only detach the view. The named PTY
      // and its bounded replay buffer remain alive in Electron.
      terminalIdRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      copySelectionRef.current = () => undefined;
      pasteClipboardRef.current = () => undefined;
      captureProposalsRef.current = async () => undefined;
      term.dispose();
      linkContainer.removeAttribute("title");
    };
  }, [mounted, cwd, generation, projectSlug, session]);

  if (!mounted || !window.electronAPI) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Terminal is only available in the desktop app (<code>npm run electron:dev</code>) — a plain
        browser tab has no local shell to attach to.
      </div>
    );
  }

  const workspaceLabel = workspaceDisplayName(cwd);

  return (
    <section
      className={`mi-terminal-shell flex min-h-0 flex-col overflow-y-auto ${
        chromeless ? "mi-terminal-shell-flush h-full" : "rounded-xl border"
      } ${compact && !chromeless ? "h-full" : ""}`}
    >
      <div className="mi-terminal-titlebar flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-muted/50 font-mono text-[11px] text-accent" aria-hidden="true">
            &gt;_
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground">Terminal</span>
              <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Native shell</span>
            </div>
            <p className="truncate text-[10px] capitalize text-muted-foreground">{workspaceLabel}</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <PdfBrandExport />
          {projectSlug && (
            <div className="flex items-center rounded-md border border-accent/50 bg-accent/10">
              <button
                type="button"
                onClick={() => void chooseProposalFile()}
                disabled={proposalCapture.state === "saving"}
                title="Choose an exact JSON file, validate it, and create Mi review cards"
                className="h-7 px-2 text-[10px] text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                {proposalCapture.state === "saving" ? "Loading…" : "Send proposal file to Mi"}
              </button>
              <button
                type="button"
                onClick={() => void captureProposalsRef.current()}
                disabled={proposalCapture.state === "saving"}
                title="Fallback: validate proposals reconstructed from visible terminal output"
                className="h-7 border-l border-accent/40 px-2 text-[10px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                Use terminal output
              </button>
            </div>
          )}
          <div className="flex items-center rounded-md border border-border bg-background/60" aria-label="Terminal clipboard controls">
            <button
              type="button"
              onClick={() => copySelectionRef.current()}
              disabled={!hasSelection}
              title="Copy selected text (Ctrl+C or Ctrl+Shift+C)"
              className="h-7 px-2 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => pasteClipboardRef.current()}
              title="Paste into terminal (Ctrl+V or Ctrl+Shift+V)"
              className="h-7 border-l border-border px-2 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Paste
            </button>
          </div>
          <span className="sr-only" aria-live="polite">{clipboardMessage}</span>
          <div className="flex items-center rounded-md border border-border bg-background/60" aria-label="Terminal text size">
            <button
              type="button"
              onClick={() => setFontSize((value) => Math.max(MIN_FONT_SIZE, value - 1))}
              disabled={fontSize <= MIN_FONT_SIZE}
              aria-label="Decrease terminal text size"
              title="Decrease text size"
              className="grid h-7 w-7 place-items-center text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
              aria-label="Reset terminal text size"
              title="Reset text size"
              className="min-w-10 text-center text-[9px] tabular-nums text-muted-foreground transition-colors hover:text-foreground"
            >
              {fontSize}px
            </button>
            <button
              type="button"
              onClick={() => setFontSize((value) => Math.min(MAX_FONT_SIZE, value + 1))}
              disabled={fontSize >= MAX_FONT_SIZE}
              aria-label="Increase terminal text size"
              title="Increase text size"
              className="grid h-7 w-7 place-items-center text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFollowOutput((value) => !value)}
            aria-pressed={followOutput}
            title={followOutput ? "Pause automatic scrolling" : "Resume following output"}
            className={`h-7 w-24 shrink-0 rounded-md border px-2 text-[10px] transition-colors ${
              followOutput
                ? "border-accent/50 bg-accent/10 text-foreground"
                : "border-border text-muted-foreground hover:border-accent/40"
            }`}
          >
            {followOutput ? "Auto-follow on" : "Jump to latest"}
          </button>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2 py-1 text-[10px] text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "running"
                  ? "bg-emerald-400"
                  : status === "connecting"
                    ? "animate-pulse bg-accent"
                    : "bg-[#738697]"
              }`}
              aria-hidden="true"
            />
            {status === "running" ? "Background session" : status}
          </div>
          {onPopOut && (
            <button
              type="button"
              onClick={onPopOut}
              aria-label="Open terminal in a pinned window"
              title="Open in a pinned window"
              className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-accent/60 hover:bg-muted/50 hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                <path d="M14 4h6v6" />
                <path d="m13 11 7-7" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const id = terminalIdRef.current;
              if (id !== null) window.electronAPI?.terminal.kill(id);
              terminalIdRef.current = null;
              setFollowOutput(true);
              lastCapturedProposalRef.current = null;
              setProposalCapture({ state: "idle", message: "" });
              setGeneration((value) => value + 1);
            }}
            aria-label="Restart shell"
            title="Restart shell"
            className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-accent/60 hover:bg-muted/50 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M20 6v5h-5" />
              <path d="M18.5 15a7 7 0 1 1-.5-7.5L20 10" />
            </svg>
          </button>
        </div>
      </div>
      {linkMessage && <p role="status" className="shrink-0 border-b border-border px-3 py-2 text-xs text-foreground">{linkMessage}</p>}
      {projectSlug && proposalCapture.state !== "idle" && (
        <div
          role={proposalCapture.state === "error" ? "alert" : "status"}
          className={`flex items-center justify-between gap-3 border-b px-3 py-2 text-xs ${
            proposalCapture.state === "error"
              ? "border-red-400/30 bg-red-500/10 text-red-600 dark:text-red-300"
              : "border-accent/30 bg-accent/10 text-foreground"
          }`}
        >
          <span className="break-all">{proposalCapture.message}</span>
          {proposalCapture.state === "saved" && (
            <a
              href={`/projects/${encodeURIComponent(projectSlug)}#project-agent-proposal-inbox`}
              className="shrink-0 underline underline-offset-2 hover:text-foreground"
            >
              Review cards
            </a>
          )}
        </div>
      )}
      <div
        className={`mi-terminal mi-terminal-surface ${compact ? "min-h-48 flex-1 shrink-0" : "h-[70vh]"}`}
        onClick={() => containerRef.current
          ?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
          ?.focus()}
      >
        {/* FitAddon measures its parent. Keep that box unpadded and independent
            of xterm's rows so fitting cannot grow its own ResizeObserver target. */}
        <div ref={containerRef} className="mi-terminal-viewport" />
      </div>
    </section>
  );
}
