"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canonicalizeIanaTimezone,
  DETERMINISTIC_TIMEZONE_OPTIONS,
  getRuntimeTimezoneOptions,
  includeTimezoneOption,
} from "@/lib/content/timezoneOptions";
import { usePersonalTimezone } from "./usePersonalTimezone";

export function TimezoneSettings() {
  const { timezone, setTimezone, loaded } = usePersonalTimezone();
  const [draft, setDraft] = useState(timezone);
  const [message, setMessage] = useState("");
  const baseOptions = useMemo(
    () => loaded ? getRuntimeTimezoneOptions() : DETERMINISTIC_TIMEZONE_OPTIONS,
    [loaded],
  );
  const options = useMemo(
    () => includeTimezoneOption(baseOptions, draft || timezone),
    [baseOptions, draft, timezone],
  );

  useEffect(() => {
    if (!loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the editable field after async personal preference load
    setDraft(timezone);
  }, [loaded, timezone]);

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading timezone preference…</p>;
  const selected = options.find((option) => option.id === canonicalizeIanaTimezone(draft));

  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="font-medium">Display timezone</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Personal setting for Notion timestamps and local meeting inputs. Search by IANA region or
        city; canonical zone IDs keep daylight-saving changes correct.
      </p>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const canonical = canonicalizeIanaTimezone(draft);
          if (!canonical) {
            setMessage("Select a valid IANA timezone.");
            return;
          }
          setDraft(canonical);
          setTimezone(canonical)
            .then(() => setMessage(`Saved ${canonical}.`))
            .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
        }}
      >
        <input
          list="mi-timezones"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setMessage("");
          }}
          aria-label="IANA timezone"
          placeholder="Search IANA timezones"
          required
          className="min-w-72 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
        />
        <datalist id="mi-timezones">
          {options.map((option) => (
            <option key={option.id} value={option.id} label={option.label} />
          ))}
        </datalist>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background" type="submit">
          Save timezone
        </button>
      </form>
      {selected && <p className="mt-2 text-xs text-muted-foreground">Selected: {selected.label}</p>}
      {message && <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Current preference: {timezone}</p>
    </section>
  );
}
