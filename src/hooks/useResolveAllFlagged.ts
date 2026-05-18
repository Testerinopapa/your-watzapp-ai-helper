import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SEND_SMART_URL, SEND_SMART_ANON_KEY } from "@/integrations/supabase/backend";
import type { FlaggedEmail } from "./useFlaggedEmails";

const RESOLVE_URL = `${SEND_SMART_URL}/functions/v1/review-resolve`;

export function useResolveAllFlagged() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (items: FlaggedEmail[]) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");

      const results = await Promise.allSettled(
        items.map((email) =>
          fetch(RESOLVE_URL, {
            method: "POST",
            headers: {
              apikey: SEND_SMART_ANON_KEY,
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: email.id,
              thread_id: email.threadId,
              provider: email.provider,
              resolution: "dismissed",
            }),
          })
        )
      );

      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
      if (failed.length > 0 && failed.length === items.length) {
        throw new Error("Failed to clear all messages.");
      }

      return { cleared: items.length - failed.length, failed: failed.length };
    },
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: ["review-list"] });
      const previous = qc.getQueryData<{ items: FlaggedEmail[] }>(["review-list"]);
      if (previous) {
        qc.setQueryData<{ items: FlaggedEmail[] }>(["review-list"], {
          items: previous.items.filter((item) => !items.some((i) => i.id === item.id)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["review-list"], ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["review-list"] });
      qc.invalidateQueries({ queryKey: ["send-smart-usage"] });
    },
  });
}
