import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { handleCalendarAfterDraft } from "@/lib/calendar-response";
import { collectOutboundAppointmentMessages } from "@/lib/outbound-appointment-messages";

const RECEIPTS_KEY = "calendar.outbound-you.receipts.v1";
const MAX_RECEIPTS = 500;

type Toast = (opts: {
  title: string;
  description: string;
  variant?: "default" | "destructive";
}) => void;

function storageKey(userId: string) {
  return `${RECEIPTS_KEY}:${userId}`;
}

function readReceipts(userId: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return null;
  }
}

function writeReceipts(userId: string, receipts: Set<string>) {
  try {
    const bounded = Array.from(receipts).slice(-MAX_RECEIPTS);
    localStorage.setItem(storageKey(userId), JSON.stringify(bounded));
  } catch {
    // A failed cache write should not block calendar processing.
  }
}

/**
 * Routes newly observed WhatsApp messages authored by "You" through the same
 * create/cancel/reschedule handler used after an AI-authored appointment reply.
 */
export function useOutboundAppointmentMessages(
  items: FlaggedMessage[] | undefined,
  toast: Toast,
) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const runningRef = useRef(false);

  useEffect(() => {
    if (!userId || items === undefined || runningRef.current) return;

    const candidates = collectOutboundAppointmentMessages(items);
    const stored = readReceipts(userId);

    // First activation establishes a baseline. Replaying historical outbound
    // confirmations or cancellations would mutate calendars unexpectedly.
    if (stored === null) {
      writeReceipts(userId, new Set(candidates.map((candidate) => candidate.key)));
      return;
    }

    const pending = candidates.filter((candidate) => !stored.has(candidate.key));
    if (pending.length === 0) return;

    runningRef.current = true;
    void (async () => {
      const receipts = new Set(stored);
      try {
        for (const candidate of pending) {
          await handleCalendarAfterDraft({
            item: candidate.item,
            incomingMessage: candidate.incomingMessage,
            userInstruction: "",
            draftText: candidate.text,
            toast,
          });
          receipts.add(candidate.key);
          writeReceipts(userId, receipts);
        }
      } finally {
        runningRef.current = false;
      }
    })();
  }, [items, toast, userId]);
}
