"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TIMEZONE, isValidIanaTimezone } from "@/lib/content/timezone";

export const TIMEZONE_STORAGE_KEY = "mi:personal-timezone";

export function usePersonalTimezone() {
  const [timezone, setTimezoneState] = useState(DEFAULT_TIMEZONE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const local = window.localStorage.getItem(TIMEZONE_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe local preference load
    if (local && isValidIanaTimezone(local)) setTimezoneState(local);
    if (window.electronAPI?.preferences) {
      window.electronAPI.preferences.getTimezone().then((value) => {
        if (isValidIanaTimezone(value)) {
          setTimezoneState(value);
          window.localStorage.setItem(TIMEZONE_STORAGE_KEY, value);
        }
        setLoaded(true);
      });
    } else {
      setLoaded(true);
    }
  }, []);

  const setTimezone = useCallback(async (value: string) => {
    if (!isValidIanaTimezone(value)) throw new Error("Select a valid IANA timezone.");
    setTimezoneState(value);
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, value);
    await window.electronAPI?.preferences?.setTimezone(value);
  }, []);

  return { timezone, setTimezone, loaded };
}
