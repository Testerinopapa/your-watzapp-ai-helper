import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SEND_SMART_URL, SEND_SMART_ANON_KEY } from "@/integrations/supabase/backend";
import type { FlaggedEmail } from "./useFlaggedEmails";

const RESOLVE_URL = `${SEND_SMART_URL}/functions/v1/review-resolve`;

interface ResolveArgs {
  id: string;
  threadId?: string;
  provider?: string;
  resolution?: "handled" | "dismissed";
}

export function useResolveFlagged() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, threadId, provider, resolution = "handled" }: ResolveArgs) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");

      const res = await fetch(RESOLVE_URL, {
        method: "POST",
        headers: {
          apikey: SEND_SMART_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, thread_id: threadId, provider, resolution }),
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
      return { id };
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["review-list"] });
      const previous = qc.getQueryData<{ items: FlaggedEmail[] }>(["review-list"]);
      if (previous) {
        qc.setQueryData<{ items: FlaggedEmail[] }>(["review-list"], {
          items: previous.items.filter((item) => item.id !== id),
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
