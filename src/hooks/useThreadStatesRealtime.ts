import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendSmartBackend } from "@/integrations/supabase/backend";

/**
 * Subscribes to realtime changes on public.thread_states for the current
 * user on the send-smart-backend project. On any change, invalidates the
 * review-list and usage-get React Query caches so the UI refreshes.
 */
export function useThreadStatesRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof sendSmartBackend.channel> | null = null;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session) return;

      // Bridge the dashboard JWT into the backend client so realtime
      // RLS authorizes against the same user_id.
      try {
        await sendSmartBackend.realtime.setAuth(session.access_token);
      } catch {
        // ignore — best effort
      }

      const userId = session.user.id;
      channel = sendSmartBackend
        .channel(`thread-states:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "thread_states",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            qc.invalidateQueries({ queryKey: ["review-list"] });
            qc.invalidateQueries({ queryKey: ["send-smart-usage"] });
            window.dispatchEvent(new CustomEvent("thread-states:changed"));
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) sendSmartBackend.removeChannel(channel);
    };
  }, [qc]);
}
