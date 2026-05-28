import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const FLAGGED_LIST_URL =
  "https://ocpphyjkstvfespxrajk.supabase.co/functions/v1/flagged-list";
const FLAGGED_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcHBoeWprc3R2ZmVzcHhyYWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxODExMzUsImV4cCI6MjA5Mjc1NzEzNX0.wcqrpSVkgDZRPet_4yLcF5YYISsWqRacVNOHf_eW8uY";

export interface FlaggedMessage {
  thread_id: string;
  provider: string;
  sender: string | null;
  subject: string | null;
  preview: string | null;
  latest_message: string | null;
  intent_category: "misc" | "support" | string;
  intent_confidence: number;
  intent_reason: string | null;
  intent_source: string | null;
  intent_classified_at: string | null;
  updated_at: string;
  thread_url: string | null;
}

interface FlaggedListResponse {
  ok: boolean;
  items: FlaggedMessage[];
}

export function useFlaggedMessages(limit = 20) {
  return useQuery<FlaggedMessage[]>({
    queryKey: ["flagged-messages", limit],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");

      const res = await fetch(`${FLAGGED_LIST_URL}?limit=${limit}`, {
        method: "GET",
        headers: {
          apikey: FLAGGED_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
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
