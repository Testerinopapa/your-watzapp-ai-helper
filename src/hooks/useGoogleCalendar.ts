import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface GoogleCalendarConnection {
  google_email: string | null;
  scope: string | null;
  connected_at: string;
}

export const GOOGLE_CALENDAR_SCOPE_ERROR =
  "Google Calendar permission is missing. Please reconnect Google Calendar and approve read-only calendar access.";

async function parseFunctionError(error: unknown) {
  const context = (error as { context?: Response })?.context;
  if (context) {
    try {
      const body = await context.clone().json();
      if (typeof body?.message === "string") return body.message;
      if (body?.error === "calendar_scope_missing") return GOOGLE_CALENDAR_SCOPE_ERROR;
    } catch (_) {
      // Fall back to the SDK error message below.
    }
  }
  return (error as Error)?.message ?? "Google Calendar request failed.";
}

export function useGoogleCalendar() {
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setConnection(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("google_oauth_tokens")
      .select("google_email, scope, created_at")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    setConnection(
      data ? { google_email: data.google_email, scope: data.scope, connected_at: data.created_at } : null,
    );
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connect = useCallback(async () => {
    const redirectTo = `${window.location.origin}/dashboard`;
    const { data, error } = await supabase.functions.invoke("google-oauth-start", {
      body: { redirect_to: redirectTo },
    });
    if (error) throw error;
    if (data?.url) {
      window.location.href = data.url;
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-sync", { body: {} });
      if (error) throw new Error(await parseFunctionError(error));
      return data as { synced: number };
    } finally {
      setSyncing(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const { error } = await supabase.functions.invoke("google-oauth-disconnect", { body: {} });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  return { connection, loading, syncing, connect, sync, disconnect, refresh };
}
