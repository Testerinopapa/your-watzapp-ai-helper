import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "settings.ai-calendar-writes-enabled";

/** Default to enabled — if no value is stored, mutations are allowed. */
function readValue(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function writeValue(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // ignore
  }
}

function subscribe(callback: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/**
 * Controls whether the AI is allowed to write to the user's calendar
 * (create/update/cancel/delete Google Calendar events via agenda_events).
 *
 * When disabled:
 *  - Calendar reads still work (draft context still sees events)
 *  - Agenda push calls are skipped
 *  - Existing events are not modified or deleted
 *
 * The toggle persists across sessions via localStorage.
 */
export function useCalendarWritePermission() {
  const enabled = useSyncExternalStore(subscribe, readValue, readValue);

  const setEnabled = useCallback((value: boolean) => {
    writeValue(value);
    // useSyncExternalStore doesn't know about same-tab writes, so force a
    // re-render by dispatching a synthetic storage event.
    window.dispatchEvent(
      new StorageEvent("storage", { key: STORAGE_KEY, newValue: String(value) }),
    );
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  return { enabled, setEnabled, toggle };
}
