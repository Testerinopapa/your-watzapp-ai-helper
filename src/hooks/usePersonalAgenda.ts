import { useCallback, useEffect, useState } from "react";

/**
 * Local-only personal agenda. Phase 1 stores entries in localStorage so users
 * can mark appointments as "added to my agenda" without any backend changes.
 *
 * In a later phase this can be swapped for a real table without touching the
 * UI: the shape mirrors the normalized agenda/event model proposed in the
 * roadmap (source_type, start_time, etc.).
 */

export type AgendaSource =
  | "whatsapp"
  | "manual"
  | "google_calendar"
  | "outlook"
  | "apple_ics"
  | "calendly"
  | "cal_com"
  | "csv";

export type AgendaStatus =
  | "booked"
  | "pending"
  | "needs_confirmation"
  | "imported"
  | "conflict"
  | "cancelled"
  | "confirmed";

export interface AgendaEntry {
  id: string;
  source_type: AgendaSource;
  source_event_id?: string | null;
  thread_id?: string | null;
  contact_name?: string | null;
  contact_channel?: string | null;
  title?: string | null;
  description?: string | null;
  start_time?: string | null; // ISO
  end_time?: string | null;   // ISO
  timezone?: string | null;
  status: AgendaStatus;
  notes?: string | null;
  imported_at: string;
  last_synced_at?: string | null;
}

const STORAGE_KEY = "lovable.personalAgenda.v1";

function read(): AgendaEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgendaEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: AgendaEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent("personal-agenda:change"));
}

export function usePersonalAgenda() {
  const [entries, setEntries] = useState<AgendaEntry[]>(() => read());

  useEffect(() => {
    const onChange = () => setEntries(read());
    window.addEventListener("personal-agenda:change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("personal-agenda:change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const upsert = useCallback((entry: AgendaEntry) => {
    const current = read();
    const idx = current.findIndex((e) => e.id === entry.id);
    if (idx >= 0) current[idx] = entry;
    else current.unshift(entry);
    write(current);
  }, []);

  const remove = useCallback((id: string) => {
    write(read().filter((e) => e.id !== id));
  }, []);

  const findByThreadId = useCallback(
    (threadId?: string | null) =>
      threadId ? entries.find((e) => e.thread_id === threadId) : undefined,
    [entries],
  );

  return { entries, upsert, remove, findByThreadId };
}
