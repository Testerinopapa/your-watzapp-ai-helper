import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SEND_SMART_URL, SEND_SMART_ANON_KEY } from "@/integrations/supabase/backend";
import type { FlaggedEmail } from "./useFlaggedEmails";

const RESOLVE_URL = `${SEND_SMART_URL}/functions/v1/review-resolve`;
const REVIEW_LIST_URL = `${SEND_SMART_URL}/functions/v1/review-list`;

const PAGE_SIZE = 50;
const RESOLVE_CONCURRENCY = 10;
const MAX_DRAIN_PASSES = 100;

interface RawItem {
  id: string;
  thread_id?: string;
  provider?: string;
}

async function fetchFlaggedPage(accessToken: string): Promise<RawItem[]> {
  const url = new URL(REVIEW_LIST_URL);
  url.searchParams.set("limit", String(PAGE_SIZE));

  const res = await fetch(url.toString(), {
    headers: {
      apikey: SEND_SMART_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to load flagged messages (${res.status})`);
  const body = (await res.json()) as { items?: RawItem[] };
  return body.items ?? [];
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

      // The backend currently exposes only the first 50 review items and does
      // not honor offset pagination, so drain the queue by repeatedly fetching
      // the next visible page after each batch is resolved.
      for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
        const page = await fetchFlaggedPage(session.access_token);
        if (page.length === 0) break;
        total += page.length;

        for (let i = 0; i < page.length; i += RESOLVE_CONCURRENCY) {
          const batch = page.slice(i, i + RESOLVE_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map((item) => resolveOne(item, session.access_token)),
          );
          for (const r of results) {
            if (r.status === "fulfilled" && r.value) cleared++;
            else failed++;
          }
        }

        if (page.length < PAGE_SIZE) break;
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
