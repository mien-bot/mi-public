"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { ArchitecturalDrawing } from "./ArchitecturalLoader";
import { MiniMiSettings } from "./MiniMiSettings";
import {
  applyThemeToDocument,
  DEFAULT_THEME_GRAPHICS,
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_MOTION,
  DEFAULT_THEME_PREFERENCE,
  DEFAULT_THEME_PRESET,
  DEFAULT_THEME_TYPOGRAPHY,
  DEFAULT_THEME_CODE_FONT,
  notifyThemePreferenceChanged,
  readStoredThemePreference,
  resolveThemeMode,
  THEME_CODE_FONTS,
  THEME_CODE_FONT_LABELS,
  THEME_GRAPHICS,
  THEME_GRAPHICS_LABELS,
  THEME_MODE_LABELS,
  THEME_MODES,
  THEME_MOTION_LABELS,
  THEME_MOTIONS,
  THEME_PRESET_LABELS,
  THEME_PRESETS,
  THEME_STYLES,
  THEME_TYPOGRAPHIES,
  THEME_TYPOGRAPHY_LABELS,
  writeStoredThemePreference,
  type ThemeCodeFont,
  type ThemeGraphics,
  type ThemeMode,
  type ThemeMotion,
  type ThemePreference,
  type ThemePreset,
  type ThemeTypography,
} from "@/lib/theme/preferences";
// One subscriber for the whole app, so this panel and the analysis diagrams that read the
// Motion level (lib/theme/useThemeMotion.ts) can never drift apart on which events count.
import { subscribeToThemePreference as subscribeToPreferenceChanges } from "@/lib/theme/useThemeMotion";

const getStoredMode = (): ThemeMode => readStoredThemePreference(window.localStorage).mode;
const getStoredPreset = (): ThemePreset => readStoredThemePreference(window.localStorage).preset;
const getStoredTypography = (): ThemeTypography => readStoredThemePreference(window.localStorage).typography;
const getStoredCodeFont = (): ThemeCodeFont => readStoredThemePreference(window.localStorage).codeFont;
const getStoredGraphics = (): ThemeGraphics => readStoredThemePreference(window.localStorage).graphics;
const getStoredMotion = (): ThemeMotion => readStoredThemePreference(window.localStorage).motion;
const getServerMode = (): ThemeMode => DEFAULT_THEME_MODE;
const getServerPreset = (): ThemePreset => DEFAULT_THEME_PRESET;
const getServerTypography = (): ThemeTypography => DEFAULT_THEME_TYPOGRAPHY;
const getServerCodeFont = (): ThemeCodeFont => DEFAULT_THEME_CODE_FONT;
const getServerGraphics = (): ThemeGraphics => DEFAULT_THEME_GRAPHICS;
const getServerMotion = (): ThemeMotion => DEFAULT_THEME_MOTION;

function subscribeToPrefersDark(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

const getPrefersDark = (): boolean => window.matchMedia("(prefers-color-scheme: dark)").matches;
const getServerPrefersDark = (): boolean => false;

function applyAndPersist(preference: ThemePreference) {
  writeStoredThemePreference(window.localStorage, preference);
  applyThemeToDocument(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
  notifyThemePreferenceChanged();
}

type ChoiceMeta<T extends string> = Record<T, { label: string; description: string }>;

function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  labels,
  groupId,
  onChange,
  compact = false,
  swatch,
}: {
  legend: string;
  value: T;
  options: readonly T[];
  labels: ChoiceMeta<T>;
  groupId: string;
  onChange: (value: T) => void;
  compact?: boolean;
  /**
   * Renders each option's own accent beside its name. With eight presets, a list of names
   * alone makes you click through all of them to find out what "Jade" actually looks like.
   */
  swatch?: (option: T) => string | null;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className={`mt-2 grid gap-2 ${compact ? "sm:grid-cols-3" : ""}`}>
        {options.map((option) => {
          const meta = labels[option];
          const inputId = `${groupId}-${option}`;
          return (
            <label
              key={option}
              htmlFor={inputId}
              className="appearance-choice card-hover flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background/75 p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
            >
              <input
                id={inputId}
                type="radio"
                name={groupId}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
                className="mt-0.5 accent-accent"
              />
              {swatch?.(option) ? (
                <span
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-border-strong"
                  style={{ background: swatch(option) ?? undefined }}
                />
              ) : null}
              <span>
                <span className="block font-medium">{meta.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{meta.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AppearanceSettings() {
  const [previous, setPrevious] = useState<ThemePreference | null>(null);
  const mode = useSyncExternalStore(subscribeToPreferenceChanges, getStoredMode, getServerMode);
  const preset = useSyncExternalStore(subscribeToPreferenceChanges, getStoredPreset, getServerPreset);
  const typography = useSyncExternalStore(subscribeToPreferenceChanges, getStoredTypography, getServerTypography);
  const codeFont = useSyncExternalStore(subscribeToPreferenceChanges, getStoredCodeFont, getServerCodeFont);
  const graphics = useSyncExternalStore(subscribeToPreferenceChanges, getStoredGraphics, getServerGraphics);
  const motion = useSyncExternalStore(subscribeToPreferenceChanges, getStoredMotion, getServerMotion);
  const prefersDark = useSyncExternalStore(subscribeToPrefersDark, getPrefersDark, getServerPrefersDark);
  // Which half of each preset's light/dark token pair the swatches should show.
  const resolved = resolveThemeMode(mode, prefersDark);
  const modeGroupId = useId();
  const presetGroupId = useId();
  const typographyGroupId = useId();
  const codeFontGroupId = useId();
  const graphicsGroupId = useId();
  const motionGroupId = useId();

  const preference: ThemePreference = { mode, preset, typography, codeFont, graphics, motion };
  const choosePreference = useCallback((next: ThemePreference) => {
    setPrevious(readStoredThemePreference(window.localStorage));
    applyAndPersist(next);
  }, []);
  const patchPreference = useCallback((patch: Partial<ThemePreference>) => {
    choosePreference({ ...readStoredThemePreference(window.localStorage), ...patch });
  }, [choosePreference]);
  const handleReset = useCallback(() => choosePreference(DEFAULT_THEME_PREFERENCE), [choosePreference]);
  const isDefault = Object.entries(DEFAULT_THEME_PREFERENCE)
    .every(([key, value]) => preference[key as keyof ThemePreference] === value);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="appearance-heading">
      <div className="appearance-hero border-b border-border p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-accent">Visual system</p>
            <h2 id="appearance-heading" className="mt-1 font-display text-2xl font-light">Make Mi feel like your workspace</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Color, type, graphics, and motion apply live on this device. Nothing is uploaded or sent to Notion or Dropbox.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
          {previous && <button type="button" onClick={() => { applyAndPersist(previous); setPrevious(null); }} className="rounded-md border border-border px-3 py-2 text-xs">Undo last change</button>}
          <button
            type="button"
            onClick={handleReset}
            disabled={isDefault}
            className="tactile-control rounded-md border border-border bg-background/70 px-3 py-2 text-xs font-medium hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset appearance
          </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="Workspace styles">
          {THEME_STYLES.map(style => <button key={style.name} type="button"
            aria-pressed={Object.entries(style.preference).every(([key, value]) => preference[key as keyof ThemePreference] === value)}
            onClick={() => choosePreference(style.preference)}
            className="tactile-surface rounded-xl border border-border bg-background/75 p-4 text-left hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent/5">
            <span aria-hidden="true" className="mb-3 block h-1 w-9 rounded-full" style={{ background: `var(--mi-${style.preference.preset}-accent-${resolved})` }} />
            <span className="block text-sm font-medium">{style.name}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{style.description}</span>
          </button>)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Three starting points. Keep your preferred display mode or customize below.</p>
      </div>

      <ThemePreviewSwatch preference={preference} />
      <details className="border-t border-border px-5 py-3 sm:px-6">
        <summary className="cursor-pointer text-sm text-muted-foreground">Preview loading animation</summary>
        <div className="mx-auto mt-3 max-w-xs text-accent"><ArchitecturalDrawing key={`${graphics}:${motion}`} /></div>
        <p className="mb-2 text-center text-xs text-muted-foreground">A plan drawn in layers. Minimal motion keeps the drawing still.</p>
      </details>
      <div className="grid gap-7 p-5 sm:p-6">
        <ChoiceGroup compact legend="Display" value={mode} options={THEME_MODES} labels={THEME_MODE_LABELS} groupId={modeGroupId} onChange={(value) => patchPreference({ mode: value })} />
        <details>
        <summary className="cursor-pointer text-sm font-medium">Customize color palette · {THEME_PRESET_LABELS[preset].label}</summary>
        <div className="mt-3"><ChoiceGroup
          compact
          legend="Color palette"
          value={preset}
          options={THEME_PRESETS}
          labels={THEME_PRESET_LABELS}
          groupId={presetGroupId}
          onChange={(value) => patchPreference({ preset: value })}
          /* Reads each preset's own token for the currently resolved mode, so the dots
             show the colours you would actually get rather than a second hardcoded copy
             of the palette that could drift from app/globals.css. */
          swatch={(option) => `var(--mi-${option}-accent-${resolved})`}
        /></div>
        </details>
      </div>

      <MiniMiSettings />
      <details className="border-t border-border p-5 sm:p-6">
        <summary className="cursor-pointer font-display text-lg font-light">Customize fonts, graphics & motion</summary>
        <p className="mt-1 text-sm text-muted-foreground">Adjust these independently, or choose a style above.</p>
        <div className="mt-5 grid gap-7">
          <ChoiceGroup compact legend="Typography" value={typography} options={THEME_TYPOGRAPHIES} labels={THEME_TYPOGRAPHY_LABELS} groupId={typographyGroupId} onChange={(value) => patchPreference({ typography: value })} />
          <div>
            <ChoiceGroup compact legend="Coding font" value={codeFont} options={THEME_CODE_FONTS} labels={THEME_CODE_FONT_LABELS} groupId={codeFontGroupId} onChange={(value) => patchPreference({ codeFont: value })} />
            <p className="mt-2.5 overflow-x-auto rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs leading-6 text-muted-foreground">
              <span className="text-foreground">projects/25-1111/schedule.yaml</span> — 0O1lI |&gt;= != =&gt; ~~ 3.14
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Sets the terminal, code, paths, and IDs everywhere — and the whole interface when Typography is Code. Fonts are included for offline use; Consolas uses the installed Windows font.
            </p>
          </div>
          <ChoiceGroup compact legend="Graphic style" value={graphics} options={THEME_GRAPHICS} labels={THEME_GRAPHICS_LABELS} groupId={graphicsGroupId} onChange={(value) => patchPreference({ graphics: value })} />
          <ChoiceGroup compact legend="Motion" value={motion} options={THEME_MOTIONS} labels={THEME_MOTION_LABELS} groupId={motionGroupId} onChange={(value) => patchPreference({ motion: value })} />
        </div>
      </details>
    </section>
  );
}

function ThemePreviewSwatch({ preference }: { preference: ThemePreference }) {
  const prefersDark = useSyncExternalStore(subscribeToPrefersDark, getPrefersDark, getServerPrefersDark);
  const resolved = resolveThemeMode(preference.mode, prefersDark);

  return (
    <div className="border-t border-border bg-background/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Live preview</p>
          <p id="appearance-preview-caption" className="mt-1 text-xs text-muted-foreground">
            {THEME_PRESET_LABELS[preference.preset].label} · {preference.mode === "dim" ? "Dim" : resolved} · {THEME_TYPOGRAPHY_LABELS[preference.typography].label} · {THEME_CODE_FONT_LABELS[preference.codeFont].label} · {THEME_GRAPHICS_LABELS[preference.graphics].label} · {THEME_MOTION_LABELS[preference.motion].label}
          </p>
        </div>
        <span className="status-chip status-chip-success">Ready</span>
      </div>
      <div className="appearance-preview mt-3 overflow-hidden rounded-xl border border-border bg-card text-foreground" aria-describedby="appearance-preview-caption">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">MI / PROJECT-26 / LIVE</span>
          <span className="flex gap-1" aria-hidden="true"><i /><i /><i /></span>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="font-display text-lg font-light">Sample project workspace</p>
            <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
              Confirmed Notion and Dropbox links stay explicit. Dynamic feedback shows what Mi is reading, reviewing, and applying.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="status-chip status-chip-success">Notion linked</span>
            <button type="button" tabIndex={-1} aria-hidden="true" className="tactile-control rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground">Review sync</button>
          </div>
        </div>
      </div>
    </div>
  );
}
