import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AgendaEntry } from "./usePersonalAgenda";

/**
 * Loads synced/server-side agenda events (e.g. from Google Calendar) from the
 * `agenda_events` table for the signed-in user. Read-only here — entries are
 * removed by disconnecting the source.
 */
export function useAgendaEvents() {
  const [entries, setEntries] = useState<AgendaEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setEntries([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("agenda_events")
      .select("id, source_type, source_event_id, thread_id, title, description, start_time, end_time, timezone, status, notes, imported_at, last_synced_at")
      .eq("user_id", userData.user.id)
      .neq("status", "cancelled")
      .order("start_time", { ascending: true });
    if (error) {
      console.error("agenda_events load failed", error);
      setEntries([]);
    } else {
      setEntries(
        (data ?? []).map((r) => ({
          id: r.id,
          source_type: r.source_type as AgendaEntry["source_type"],
          source_event_id: r.source_event_id,
          thread_id: r.thread_id,
          title: r.title,
          description: r.description,
          start_time: r.start_time,
          end_time: r.end_time,
          timezone: r.timezone,
          status: (r.status as AgendaEntry["status"]) ?? "imported",
          notes: r.notes,
          imported_at: r.imported_at,
          last_synced_at: r.last_synced_at,
        })),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = useCallback(async (id: string) => {
    const previous = entries.find((e) => e.id === id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    const { error } = await supabase.from("agenda_events").delete().eq("id", id);
    if (error) {
      console.error("agenda_events delete failed", error);
      if (previous) {
        setEntries((prev) => [...prev, previous]);
      }
    }
  }, [entries]);

  return { entries, loading, refresh: load, remove };
}
