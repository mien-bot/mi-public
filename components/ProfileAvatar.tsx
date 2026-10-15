"use client";

import { useEffect, useState } from "react";
import { MiMark } from "./MiMark";
import {
  DEFAULT_MI_PROFILE,
  PROFILE_CHANGED_EVENT,
  PROFILE_STORAGE_KEY,
  loadMiProfile,
  type MiProfile,
} from "./profilePreferences";

export function ProfileAvatar({ className = "h-9 w-9" }: { className?: string }) {
  const [profile, setProfile] = useState<MiProfile>(DEFAULT_MI_PROFILE);

  useEffect(() => {
    const refresh = () => setProfile(loadMiProfile(window.localStorage));
    refresh();
    window.addEventListener(PROFILE_CHANGED_EVENT, refresh);
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROFILE_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PROFILE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const label = profile.displayName ? `${profile.displayName}'s profile` : "Mi profile";
  if (profile.avatarDataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- local re-encoded profile PNG
      <img
        src={profile.avatarDataUrl}
        alt={label}
        className={`${className} rounded-lg border border-border bg-muted object-cover [image-rendering:pixelated]`}
      />
    );
  }

  return (
    <span
      aria-label={label}
      className={`${className} inline-flex items-center justify-center rounded-lg border border-border bg-muted/50 text-accent`}
    >
      <MiMark className="h-[72%] w-[72%]" />
    </span>
  );
}
