import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SEND_SMART_URL, SEND_SMART_ANON_KEY } from "@/integrations/supabase/backend";
import type { FlaggedEmail } from "./useFlaggedEmails";

const RESOLVE_URL = `${SEND_SMART_URL}/functions/v1/review-resolve`;
const REVIEW_LIST_URL = `${SEND_SMART_URL}/functions/v1/review-list`;

const PAGE_SIZE = 50;
const RESOLVE_CONCURRENCY = 10;

interface RawItem {
  id: string;
  thread_id?: string;
  provider?: string;
}

async function fetchFlaggedPage(accessToken: string): Promise<RawItem[]> {
  const url = new URL(REVIEW_LIST_URL);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("_", Date.now().toString());

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      apikey: SEND_SMART_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Cache-Control": "no-cache",
    },
  });
  if (!res.ok) throw new Error(`Failed to load flagged messages (${res.status})`);
  const body = (await res.json()) as { items?: RawItem[] };
  return (body.items ?? []).filter((item) => Boolean(item?.id));
}

async function resolveOne(item: RawItem, accessToken: string): Promise<boolean> {
  const res = await fetch(RESOLVE_URL, {
    method: "POST",
    headers: {
      apikey: SEND_SMART_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: item.id,
      thread_id: item.thread_id ?? item.id,
      provider: item.provider ?? "",
      resolution: "dismissed",
    }),
  });
  return res.ok;
}

export function useResolveAllFlagged() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");

      let cleared = 0;
      let failed = 0;
      let total = 0;

      // The backend caps review-list at 50 and may ignore offset, so clear the
      // current page, then fetch again until no flagged messages remain.
      for (let page = 0; page < 100; page++) {
        const items = await fetchFlaggedPage(session.access_token);
        if (items.length === 0) break;

        let clearedThisPage = 0;
        total += items.length;

        for (let i = 0; i < items.length; i += RESOLVE_CONCURRENCY) {
          const batch = items.slice(i, i + RESOLVE_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map((item) => resolveOne(item, session.access_token)),
          );
          for (const r of results) {
            if (r.status === "fulfilled" && r.value) {
              cleared++;
              clearedThisPage++;
            } else {
              failed++;
            }
          }
        }

        if (clearedThisPage === 0) break;
      }

      if (cleared === 0 && failed > 0) {
        throw new Error("Failed to clear messages.");
      }

      return { cleared, failed, total };
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["review-list"] });
      const previous = qc.getQueryData<{ items: FlaggedEmail[] }>(["review-list"]);
      qc.setQueryData<{ items: FlaggedEmail[] }>(["review-list"], { items: [] });
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
