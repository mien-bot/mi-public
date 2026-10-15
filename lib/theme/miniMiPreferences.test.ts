import { describe, expect, it } from "vitest";
import { DEFAULT_MINI_MI, MINI_MI_CHARACTERS, MINI_MI_STORAGE_KEY, readMiniMiPreference, writeMiniMiPreference, type MiniMiPreference } from "./preferences";

describe("Mini Mi character preferences", () => {
  it("keeps the robot and animations as the default for missing or corrupt storage", () => {
    for (const raw of [null, "{", "null", "[]", '"owl"', '{"character":"removed","animations":"true"}']) {
      expect(readMiniMiPreference({ getItem: () => raw })).toEqual(DEFAULT_MINI_MI);
    }
    expect(readMiniMiPreference()).toEqual(DEFAULT_MINI_MI);
    expect(readMiniMiPreference({ getItem: () => { throw Error("blocked"); } })).toEqual(DEFAULT_MINI_MI);
  });
  it.each(MINI_MI_CHARACTERS)("round-trips %s and an explicit animation opt-out independently of workspace styles", character => {
    const values = new Map<string, string>([["mi-theme-preset", "jade"]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(writeMiniMiPreference(storage, { character, animations: false })).toBe(true);
    expect(readMiniMiPreference(storage)).toEqual({ ...DEFAULT_MINI_MI, character, animations: false });
    expect(values.get("mi-theme-preset")).toBe("jade");
    expect(values.has(MINI_MI_STORAGE_KEY)).toBe(true);
  });
  it("validates fields independently and normalizes invalid writes", () => {
    expect(readMiniMiPreference({ getItem: () => '{"character":"owl","animations":1}' })).toEqual({ ...DEFAULT_MINI_MI, character: "owl", animations: true });
    expect(readMiniMiPreference({ getItem: () => '{"character":"unknown","animations":false}' })).toEqual({ ...DEFAULT_MINI_MI, character: "robot", animations: false });
    let raw = "";
    writeMiniMiPreference({ setItem: (_, value) => { raw = value; } }, { character: "unknown", animations: "yes" } as unknown as MiniMiPreference);
    expect(JSON.parse(raw)).toEqual(DEFAULT_MINI_MI);
  });
  it("reports unavailable persistence instead of claiming the change was saved", () => {
    expect(writeMiniMiPreference(null, DEFAULT_MINI_MI)).toBe(false);
    expect(writeMiniMiPreference({ setItem: () => { throw Error("quota"); } }, DEFAULT_MINI_MI)).toBe(false);
  });
  it("migrates old settings and preserves explicit quiet, hidden, size, snooze and empty favorites", () => {
    const value = readMiniMiPreference({ getItem: () => '{"character":"owl","animations":true}' });
    expect(value).toEqual({ ...DEFAULT_MINI_MI, character: "owl" });
    expect(readMiniMiPreference({ getItem: () => '{"behavior":"quiet","size":"large","snoozedUntil":12345,"favorites":[]}' })).toMatchObject({ behavior: "quiet", size: "large", snoozedUntil: 12345, favorites: [] });
    expect(readMiniMiPreference({ getItem: () => '{"behavior":"hidden","favorites":["happy","happy","unknown"]}' })).toMatchObject({ behavior: "hidden", favorites: ["happy"] });
  });
});
