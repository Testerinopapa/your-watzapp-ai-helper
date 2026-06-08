import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { handleCalendarAfterDraft } from "@/lib/calendar-response";
import { collectInboundAppointmentMessages } from "@/lib/inbound-appointment-messages";

const RECEIPTS_KEY = "calendar.inbound-them.receipts.v1";
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
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return null;
  }
}

function writeReceipts(userId: string, receipts: Set<string>) {
  try {
    const bounded = Array.from(receipts).slice(-MAX_RECEIPTS);
    localStorage.setItem(storageKey(userId), JSON.stringify(bounded));
  } catch {
    /* cache failures should not block processing */
  }
}

/**
 * Routes inbound (contact-authored) WhatsApp messages that contain a clear
 * booking date+time through the same handleCalendarAfterDraft pipeline used
 * by AI-drafted appointment replies and outbound user messages. Only
 * high-confidence date+time extractions trigger a write to avoid silently
 * creating wrong calendar events.
 *
 * First activation baselines existing inbound history into receipts so we
 * don't retroactively process older messages on first dashboard load.
 */
export function useInboundAppointmentMessages(
  items: FlaggedMessage[] | undefined,
  toast: Toast,
) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const runningRef = useRef(false);

  useEffect(() => {
    if (!userId || items === undefined || runningRef.current) return;

    const candidates = collectInboundAppointmentMessages(items);
    const stored = readReceipts(userId);
    const receipts = stored ?? new Set<string>();

    if (stored === null) {
      // Baseline: mark everything currently visible as already processed so
      // we don't retroactively create agenda events for old messages on
      // first dashboard load. Real-time new messages will pass the receipt
      // check naturally.
      for (const c of candidates) receipts.add(c.key);
      writeReceipts(userId, receipts);
      return;
    }

    const pending = candidates.filter((c) => !receipts.has(c.key));
    if (pending.length === 0) return;

    runningRef.current = true;
    void (async () => {
      try {
        for (const c of pending) {
          await handleCalendarAfterDraft({
            item: c.item,
            incomingMessage: c.text,
            userInstruction: "",
            draftText: c.text, // inbound message text doubles as the source for date extraction
            calendarPayload: null,
            toast,
          });
          receipts.add(c.key);
          writeReceipts(userId, receipts);
        }
      } finally {
        runningRef.current = false;
      }
    })();
  }, [items, toast, userId]);
}
