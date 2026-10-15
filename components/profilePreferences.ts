export const PROFILE_STORAGE_KEY = "mi.profile.v1";
export const PROFILE_CHANGED_EVENT = "mi-profile-changed";
export const MAX_PROFILE_DATA_URL_LENGTH = 300_000;

export interface MiProfile {
  displayName: string;
  avatarDataUrl: string | null;
}

export const DEFAULT_MI_PROFILE: MiProfile = {
  displayName: "",
  avatarDataUrl: null,
};

export function quantizeAvatarChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value / 51) * 51));
}

function validAvatar(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_PROFILE_DATA_URL_LENGTH
    && /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(value);
}

export function parseMiProfile(value: string | null): MiProfile {
  if (!value) return DEFAULT_MI_PROFILE;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      displayName: typeof parsed.displayName === "string"
        ? parsed.displayName.trim().slice(0, 60)
        : "",
      avatarDataUrl: validAvatar(parsed.avatarDataUrl) ? parsed.avatarDataUrl : null,
    };
  } catch {
    return DEFAULT_MI_PROFILE;
  }
}

export function loadMiProfile(storage: Pick<Storage, "getItem">): MiProfile {
  return parseMiProfile(storage.getItem(PROFILE_STORAGE_KEY));
}

export function saveMiProfile(
  storage: Pick<Storage, "setItem">,
  profile: MiProfile,
): MiProfile {
  const normalized: MiProfile = {
    displayName: profile.displayName.trim().slice(0, 60),
    avatarDataUrl: validAvatar(profile.avatarDataUrl) ? profile.avatarDataUrl : null,
  };
  storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
