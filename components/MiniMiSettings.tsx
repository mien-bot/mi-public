"use client";

import { useId, useState } from "react";
import { MINI_MI_CHARACTERS, MINI_MI_LABELS, MINI_MI_REACTION_CHOICES, writeMiniMiPreference, type MiniMiPreference } from "@/lib/theme/preferences";
import { MINI_MI_ACTIVITIES, useMiniMiMotion, useMiniMiPreference, type MiniMiActivity } from "@/lib/theme/useMiniMi";
import { MiAvatar } from "./MiAvatar";
import { clearStoredLauncherPosition } from "./chatLauncherPosition";
import { MiniMiFocus } from "./MiniMiFocus";

export function MiniMiSettings() {
  const preference = useMiniMiPreference();
  const motion = useMiniMiMotion();
  const [activity, setActivity] = useState<MiniMiActivity>("idle");
  const [replay, setReplay] = useState(0);
  const [error, setError] = useState(false);
  const id = useId();
  function choose(patch: Partial<MiniMiPreference>) {
    try { setError(!writeMiniMiPreference(window.localStorage, { ...preference, ...patch })); }
    catch { setError(true); }
  }
  return <section className="border-t border-border p-5 sm:p-6" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`} className="font-display text-lg">Mini Mi companion</h3>
    <p className="mt-1 text-sm text-muted-foreground">Choose your little studio helper. Drafting buddy is the default.</p>
    <fieldset className="mt-4">
      <legend className="sr-only">Mini Mi character</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MINI_MI_CHARACTERS.map((character, i) => <label key={character} className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-border bg-background/50 p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
          <MiAvatar character={character} animated={false} className="h-20 w-[72px] text-accent" />
          <span className="text-center text-xs font-medium">{String.fromCharCode(65 + i)} · {MINI_MI_LABELS[character]}</span>
          <input type="radio" name={`${id}-character`} value={character} aria-label={MINI_MI_LABELS[character]} checked={preference.character === character} onChange={() => choose({ character })} className="accent-accent" />
        </label>)}
      </div>
    </fieldset>
    <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={preference.animations} onChange={event => choose({ animations: event.target.checked })} className="accent-accent" />Animate Mini Mi</label>
    <div className="mt-4 flex flex-wrap items-end gap-4 text-sm">
      <label>Companion behavior<select aria-label="Companion behavior" value={preference.behavior} onChange={e => choose({ behavior: e.target.value as MiniMiPreference["behavior"] })} className="mt-1 block rounded border border-border bg-card p-2"><option value="playful">Playful · occasional idle activities</option><option value="quiet">Quiet · no idle activities</option><option value="hidden">Hidden</option></select></label>
      <label>Size<select aria-label="Companion size" value={preference.size} onChange={e => choose({ size: e.target.value as MiniMiPreference["size"] })} className="mt-1 block rounded border border-border bg-card p-2"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <button type="button" onClick={() => { try { clearStoredLauncherPosition(localStorage); window.dispatchEvent(new Event("mi-launcher-reset")); } catch { setError(true); } }} className="rounded border border-border px-3 py-2 text-xs">Reset position</button>
      <button type="button" onClick={() => choose({ snoozedUntil: Date.now()+3600000 })} className="rounded border border-border px-3 py-2 text-xs">Snooze for 1 hour</button>
      {preference.behavior !== "hidden" && <button type="button" onClick={() => choose({ behavior: "hidden" })} className="rounded border border-border px-3 py-2 text-xs">Hide Mini Mi</button>}
      {(preference.snoozedUntil > 0 || preference.behavior === "hidden") && <button type="button" onClick={() => choose({ snoozedUntil: 0, behavior: preference.behavior === "hidden" ? "quiet" : preference.behavior })} className="rounded border border-border px-3 py-2 text-xs">Show Mini Mi now</button>}
    </div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">Occasional looks, doodles, snack breaks, and bored moments when idle. Thinking and working poses accompany a chat response. Minimal motion and your device’s reduced-motion setting keep Mi still.</p>
    {error && <p role="alert" className="mt-2 text-sm text-danger">This browser could not save your character preference. Check local storage access and try again.</p>}
    <details className="mt-4 rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Favorite click reactions · {preference.favorites.length}</summary>
      <p className="mt-2 text-xs text-muted-foreground">Selected reactions rotate before repeating. Select none for no click reactions; one favorite will replay each time. Saved-work celebrations use Happy only when selected.</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{MINI_MI_REACTION_CHOICES.map(value => <label key={value} className="flex items-center gap-2 text-xs capitalize"><input type="checkbox" checked={preference.favorites.includes(value)} onChange={e => choose({ favorites: e.target.checked ? [...preference.favorites, value] : preference.favorites.filter(item => item !== value) })} className="accent-accent" />{value === "breakdancing" ? "Break dancing" : value}</label>)}</div>
      <div className="mt-3 flex gap-3 text-xs"><button type="button" onClick={() => choose({ favorites: MINI_MI_REACTION_CHOICES })}>Select all reactions</button><button type="button" onClick={() => choose({ favorites: [] })}>Clear reactions</button></div>
    </details>
    <details className="mt-4 rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Focus and breaks</summary><div className="mt-3"><MiniMiFocus /></div></details>
    <details className="mt-4 rounded-xl border border-border p-4">
      <summary className="cursor-pointer text-sm font-medium">Try the animations</summary>
      <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
        <MiAvatar key={replay} character={preference.character} activity={activity} animated={motion} className="mi-avatar-preview h-28 w-[100px] shrink-0 text-accent" />
        <div className="w-full min-w-0 flex-1">
          <div className="flex flex-wrap gap-2" aria-label="Mini Mi animation previews">
            {MINI_MI_ACTIVITIES.map(value => <button key={value} type="button" aria-pressed={activity === value} onClick={() => { setActivity(value); setReplay(n => n + 1); }} className="rounded-md border border-border px-3 py-2 text-xs capitalize aria-pressed:border-accent aria-pressed:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent">{value === "breakdancing" ? "Break dancing" : value}</button>)}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{motion ? "Click any pose to replay it. Each press of the corner companion plays a different reaction and toggles suggestions. Singing is silent; emotions are just for fun." : "Motion is off. You can still preview each pose."}</p>
        </div>
      </div>
    </details>
  </section>;
}
