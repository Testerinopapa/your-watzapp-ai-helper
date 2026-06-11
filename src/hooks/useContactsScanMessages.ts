import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  FLAGGED_SUPABASE_URL,
  FLAGGED_ANON_KEY,
} from "./useFlaggedMessages";

const CONTACTS_URL = `${FLAGGED_SUPABASE_URL}/functions/v1/message-batches?view=contacts`;

export interface ScanMessage {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender: string | null;
  from_me: boolean | null;
  msg_timestamp: number | null;
  body: string | null;
  normalized_body: string | null;
  raw_body: string | null;
  msg_type: string | null;
  ack: number | null;
  has_reaction: boolean | null;
  is_forwarded: boolean | null;
  has_media: boolean | null;
  caption: string | null;
  mime_type: string | null;
  transcription: string | null;
  created_at: string;
}

interface ContactsResponse {
  ok: boolean;
  threads: Array<{
    thread_id: string;
    provider: string | null;
    sender: string | null;
    subject: string | null;
  }>;
  messages: ScanMessage[];
}

/**
 * Fetches the full message-batches?view=contacts payload.
 * Indexed by thread_id for O(1) cross-reference with flagged-list data.
 *
 * Use `contactsByThread` to look up PTT/audio transcripts that the
 * flagged-list endpoint doesn't forward.
 */
export function useContactsScanMessages() {
  const query = useQuery<ContactsResponse>({
    queryKey: ["contacts-scan-messages"],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");

      const res = await fetch(CONTACTS_URL, {
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
        } catch { /* ignore */ }
        throw new Error(message);
      }

      return (await res.json()) as ContactsResponse;
    },
  });

  /** Messages indexed by thread_id. Built lazily on access. */
  const byThread = (() => {
    if (!query.data?.messages) return new Map<string, ScanMessage[]>();
    const map = new Map<string, ScanMessage[]>();
    for (const m of query.data.messages) {
      const list = map.get(m.thread_id);
      if (list) list.push(m);
      else map.set(m.thread_id, [m]);
    }
    return map;
  })();

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    byThread,
  };
}
