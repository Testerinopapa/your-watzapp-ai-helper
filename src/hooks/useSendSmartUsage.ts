import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SEND_SMART_URL =
  "https://ocpphyjkstvfespxrajk.supabase.co/functions/v1/usage-get";
const SEND_SMART_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jcHBoeWprc3R2ZmVzcHhyYWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxODExMzUsImV4cCI6MjA5Mjc1NzEzNX0.wcqrpSVkgDZRPet_4yLcF5YYISsWqRacVNOHf_eW8uY";

export interface SendSmartUsageRecent {
  createdAt: string;
  subject: string | null;
  senderEmail: string | null;
  sender?: string | null;
  contactName?: string | null;
  threadId?: string | null;
  thread_id?: string | null;
  decision: string;
  latestMessage: string | null;
  preview: string | null;
}

export interface SendSmartUsageData {
  period: string;
  quota: { emails: number; inputTokens: number; outputTokens: number };
  used: { emails: number; inputTokens: number; outputTokens: number };
  recent: SendSmartUsageRecent[];
}

export function useSendSmartUsage() {
  const query = useQuery<SendSmartUsageData>({
    queryKey: ["send-smart-usage"],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Not signed in");
      }

      const res = await fetch(SEND_SMART_URL, {
        method: "GET",
        headers: {
          apikey: SEND_SMART_ANON_KEY,
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

      return (await res.json()) as SendSmartUsageData;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
