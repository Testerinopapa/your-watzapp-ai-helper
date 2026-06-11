import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { handleCalendarAfterDraft } from "@/lib/calendar-response";
import { collectOutboundAppointmentMessages } from "@/lib/outbound-appointment-messages";

const RECEIPTS_KEY = "calendar.outbound-you.receipts.v3";
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
    const receipts = stored ?? new Set<string>();

    console.log("[flagged][outbound-hook] collected candidates", {
      candidate_count: candidates.length,
      candidate_keys: candidates.map((c) => ({
        key: c.key.slice(0, 120),
        has_payload: !!c.calendarPayload,
        text_preview: c.text.slice(0, 80),
      })),
      stored_is_null: stored === null,
      receipt_count: receipts.size,
      running_ref: runningRef.current,
    });

    if (stored === null) {
      // First activation: baseline structured-payload messages (they may have
      // already been acted on by the backend). Text-only calendar candidates are
      // NOT baselined — the collector now filters with needsCalendarContext, so
      // every text candidate we see is a legitimate calendar action that should
      // flow through at least once.
      let baselineStructured = 0;
      for (const candidate of candidates) {
        if (candidate.calendarPayload) {
          receipts.add(candidate.key);
          baselineStructured += 1;
        }
      }
      console.log("[flagged][outbound-hook] first activation baseline", {
        baseline_structured: baselineStructured,
        text_kept_for_processing: candidates.length - baselineStructured,
        total: candidates.length,
      });
      writeReceipts(userId, receipts);
    }

    const pending = candidates.filter((candidate) => !receipts.has(candidate.key));

    if (candidates.length > 0) {
      const skippedCount = candidates.length - pending.length;
      console.log("[flagged][outbound-hook] receipt filter result", {
        total_candidates: candidates.length,
        skipped: skippedCount,
        pending: pending.length,
        pending_keys: pending.map((c) => ({
          text_preview: c.text.slice(0, 80),
          has_payload: !!c.calendarPayload,
          payload_intent: c.calendarPayload?.intent ?? null,
        })),
      });
    }

    if (pending.length === 0) return;

    // Guard against duplicate calendar events: if an outbound scheduling
    // message was already acted on in a prior session (or on another device),
    // the thread will have an active (non-cancelled) agenda_event. Query once
    // for all pending threads and skip the ones that already have coverage.
    runningRef.current = true;
    void (async () => {
      try {
        const uniqueThreads = [...new Set(pending.map((c) => c.item.thread_id))];
        const { data: existingEvents } = await supabase
          .from("agenda_events")
          .select("id, thread_id, status, start_time")
          .eq("user_id", userId)
          .in("thread_id", uniqueThreads)
          .neq("status", "cancelled")
          .limit(uniqueThreads.length + 1); // +1 so we know if result overflows

        const threadsWithEvents = new Set(
          (existingEvents ?? []).map((e) => e.thread_id),
        );

        const alreadyHandled =
          threadsWithEvents.size > 0
            ? pending.filter((c) => threadsWithEvents.has(c.item.thread_id))
            : [];
        const trulyPending = pending.filter(
          (c) => !threadsWithEvents.has(c.item.thread_id),
        );

        if (alreadyHandled.length > 0) {
          console.log(
            "[flagged][outbound-hook] skipping threads with existing agenda_events",
            {
              skipped_threads: [...new Set(alreadyHandled.map((c) => c.item.thread_id))],
              skipped_count: alreadyHandled.length,
              remaining: trulyPending.length,
            },
          );
          // Add to receipts so they don't incur this DB query again.
          for (const c of alreadyHandled) receipts.add(c.key);
          writeReceipts(userId, receipts);
        }

        for (const candidate of trulyPending) {
          await handleCalendarAfterDraft({
            item: candidate.item,
            incomingMessage: candidate.incomingMessage,
            userInstruction: "",
            draftText: candidate.text,
            calendarPayload: candidate.calendarPayload,
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
