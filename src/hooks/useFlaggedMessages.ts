import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const FLAGGED_SUPABASE_URL = "https://ocpphyjkstvfespxrajk.supabase.co";
export const FLAGGED_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcHBoeWprc3R2ZmVzcHhyYWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxODExMzUsImV4cCI6MjA5Mjc1NzEzNX0.wcqrpSVkgDZRPet_4yLcF5YYISsWqRacVNOHf_eW8uY";
const FLAGGED_LIST_URL = `${FLAGGED_SUPABASE_URL}/functions/v1/flagged-list`;

// External project client used only for realtime subscription on thread_states.
// (flagged-list / thread_states live on a different Supabase project than the
// app's main client, so we need a dedicated client to subscribe.)
let externalClient: ReturnType<typeof createClient> | null = null;
export function getFlaggedRealtimeClient() {
  if (!externalClient) {
    externalClient = createClient(FLAGGED_SUPABASE_URL, FLAGGED_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return externalClient;
}

export interface FlaggedMessage {
  thread_id: string;
  provider: string;
  sender: string | null;
  subject: string | null;
  preview: string | null;
  latest_message: string | null;
  intent_category: "misc" | "support" | string;
  intent_subcategory?: string | null;
  intent_confidence: number;
  intent_urgency?: "low" | "medium" | "high" | string | null;
  customer_goal?: string | null;
  business_action?: string | null;
  intent_reason: string | null;
  intent_review_reason?: string | null;
  intent_source: string | null;
  intent_classified_at: string | null;
  snapshot_captured_at?: string | null;
  scan_captured_at?: string | null;
  needs_human_review?: boolean | null;
  appointment_payload?: unknown;
  calendar_payload?: unknown;
  appointment?: unknown;
  calendar?: unknown;
  schedule?: unknown;
  updated_at: string;
  thread_url: string | null;
  recent_messages?: Array<{
    body: string | null;
    from_me?: boolean | null;
    captured_at: string | null;
    msg_type?: string | null;
    source?: string | null;
    appointment_payload?: unknown;
    calendar_payload?: unknown;
    appointment?: unknown;
    calendar?: unknown;
    schedule?: unknown;
    [key: string]: unknown;
  }>;
}

interface FlaggedListResponse {
  ok: boolean;
  items: FlaggedMessage[];
}

export function useFlaggedMessages(limit = 20) {
  const { session, loading } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user?.id ?? null;

  // Subscribe to thread_states changes on the external project and
  // invalidate the query whenever a row for this user changes.
  useEffect(() => {
    if (!userId) return;
    const client = getFlaggedRealtimeClient();
    const channel = client.channel(
      `flagged-thread-states-${userId}-${Math.random().toString(36).slice(2, 8)}`,
    );
    channel.on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      {
        event: "*",
        schema: "public",
        table: "thread_states",
        filter: `user_id=eq.${userId}`,
      },
      () => {
        queryClient.invalidateQueries({ queryKey: ["flagged-messages"] });
      },
    );
    channel.subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return useQuery<FlaggedMessage[]>({
    queryKey: ["flagged-messages", limit, userId],
    enabled: !loading && !!session,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      // Don't spam retries on auth errors
      if (/unauthorized|not signed in/i.test(String(error?.message))) return false;
      return failureCount < 2;
    },
    queryFn: async () => {
      // Always pull a fresh token at request time so we don't send an expired JWT.
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      const token = current?.access_token ?? session?.access_token;
      if (!token) throw new Error("Not signed in");

      const res = await fetch(`${FLAGGED_LIST_URL}?limit=${limit}`, {
        method: "GET",
        headers: {
          apikey: FLAGGED_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const body = (await res.json()) as FlaggedListResponse;
      return body.items ?? [];
    },
  });
}


