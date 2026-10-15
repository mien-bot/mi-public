import { describe, expect, it } from "vitest";
import {
  DEFAULT_MI_PROFILE,
  PROFILE_STORAGE_KEY,
  loadMiProfile,
  parseMiProfile,
  quantizeAvatarChannel,
  saveMiProfile,
} from "./profilePreferences";

describe("Mi profile preferences", () => {
  it("falls back safely for malformed or non-PNG avatar data", () => {
    expect(parseMiProfile("not-json")).toEqual(DEFAULT_MI_PROFILE);
    expect(parseMiProfile(JSON.stringify({
      displayName: " Alex ",
      avatarDataUrl: "https://example.com/avatar.png",
    }))).toEqual({ displayName: "Alex", avatarDataUrl: null });
  });

  it("normalizes and stores a local re-encoded PNG", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const avatarDataUrl = "data:image/png;base64,aGVsbG8=";

    saveMiProfile(storage, { displayName: "  STUDIO Partner  ", avatarDataUrl });

    expect(values.has(PROFILE_STORAGE_KEY)).toBe(true);
    expect(loadMiProfile(storage)).toEqual({ displayName: "STUDIO Partner", avatarDataUrl });
  });

  it("reduces portrait colors to a restrained pixel-art palette", () => {
    expect([0, 26, 80, 180, 255].map(quantizeAvatarChannel)).toEqual([0, 51, 102, 204, 255]);
  });
});
