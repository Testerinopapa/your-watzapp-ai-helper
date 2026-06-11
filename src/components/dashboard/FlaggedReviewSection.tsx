import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Flag,
  RefreshCw,
  FolderOpen,
  FolderPlus,
  GripVertical,
  MoreVertical,
  Inbox,
  X,
  Archive,
  Eye,
  EyeOff,
  CalendarCheck,
  CalendarX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useFlaggedMessages,
  FLAGGED_SUPABASE_URL,
  FLAGGED_ANON_KEY,
  type FlaggedMessage,
} from "@/hooks/useFlaggedMessages";
import { useSendSmartUsage } from "@/hooks/useSendSmartUsage";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  FOLDER_DROP_PREFIX,
  TRASH_DROP_ID,
  defaultDraft,
  APPOINTMENT_CATEGORIES,
  SUPPORT_CATEGORIES,
  COMPLAINT_CATEGORIES,
  senderLabelForItem,
  contactKeyForItem,
  normalizeLookup,
  cleanSenderLabel,
  senderFromThreadId,
  baseThreadId,
  isVoiceStub,
  VOICE_ENVELOPE_RE,
  bestTextForMessage,
  type FolderDef,
  type DraftState,
} from "@/lib/flagged-utils";
import { useFlaggedState } from "@/hooks/useFlaggedState";

import { createEnricher } from "@/lib/enrichment";
import {
  needsCalendarContext,
  buildCalendarInstruction,
} from "@/lib/calendar-draft";
import {
  needsSupportContext,
  buildSupportInstruction,
} from "@/lib/support-draft";
import { handleCalendarAfterDraft } from "@/lib/calendar-response";
import FlaggedCardInner from "./FlaggedCardInner";
import DraftReplyFooter from "./DraftReplyFooter";
import DraggableFlaggedCard from "./DraggableFlaggedCard";
import FolderTile from "./FolderTile";
import TrashDropZone from "./TrashDropZone";
import { useAgendaEvents } from "@/hooks/useAgendaEvents";
import { useSupportKnowledge } from "@/hooks/useSupportKnowledge";
import { useOutboundAppointmentMessages } from "@/hooks/useOutboundAppointmentMessages";
import { useCalendarWritePermission } from "@/hooks/useCalendarWritePermission";
import { useContactsScanMessages } from "@/hooks/useContactsScanMessages";
import type { ScanMessage } from "@/hooks/useContactsScanMessages";

// ── Main ──

export default function FlaggedReviewSection() {
  const { toast } = useToast();
  const { docs: supportDocs } = useSupportKnowledge();
  const { data, isLoading, isFetching, error, refetch } =
    useFlaggedMessages(20);
  const { data: usageData, refetch: refetchUsage } =
    useSendSmartUsage();
  const { byThread: contactsByThread } =
    useContactsScanMessages();

  const calendarWrite = useCalendarWritePermission();

  const activityRows = usageData?.recent ?? [];

  const enricher = createEnricher(activityRows);
  const { enrichedMessageFor, withActivityPreview } = enricher;
  useOutboundAppointmentMessages(data, toast);

  // ── State ──
  // Folders / assignments / dismissals are cloud-backed (synced across browsers).
  const {
    folders,
    assignments,
    dismissed,
    addFolder,
    deleteFolder: deleteFolderRemote,
    assignToFolder,
    unassignFromFolder,
    dismissThreads,
  } = useFlaggedState();

  const [activeItem, setActiveItem] = useState<FlaggedMessage | null>(
    null,
  );
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [maskPhoneNumbers, setMaskPhoneNumbers] = useState(false);
  const draftsRef = useRef<Record<string, DraftState>>({});

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);


  const updateDraft = (
    threadId: string,
    patch: Partial<DraftState>,
  ) =>
    setDrafts((prev) => ({
      ...prev,
      [threadId]: { ...defaultDraft, ...prev[threadId], ...patch },
    }));

  const friendlyError = (status: number, raw: string): string => {
    if (status === 401)
      return "Session expired — please sign in again.";
    if (status === 402)
      return "Plan limit reached. Upgrade to continue drafting.";
    if (status === 429)
      return "Too many requests — try again in a moment.";
    if (status === 502)
      return "AI service is unavailable right now. Please retry.";
    return raw || `Request failed (${status})`;
  };

  // ── Draft generation ──

  const callDraftFunction = async (item: FlaggedMessage) => {
    const id = item.thread_id;
    const enriched = enrichedMessageFor(item);
    const incomingMessage = (
      enriched ??
      item.latest_message ??
      item.preview ??
      item.subject ??
      ""
    )
      .trim()
      .slice(0, 4000);
    const userInstruction = (drafts[id]?.instruction ?? "")
      .trim()
      .slice(0, 2000);
    if (!incomingMessage || !userInstruction) return;

    let instruction = userInstruction;
    // intent_category is the authoritative signal — check it first so a
    // "support" message that happens to mention scheduling words ("booking
    // page isn't working") doesn't get pulled into the calendar pipeline.
    if (needsSupportContext(item)) {
      const supportInstruction = await buildSupportInstruction({
        item,
        incomingMessage,
        userInstruction,
        supportDocId: drafts[id]?.supportDocId ?? null,
        updateDraft,
        toast,
      });
      if (supportInstruction === null) return;
      instruction = supportInstruction;
    } else if (
      needsCalendarContext(item, incomingMessage, userInstruction)
    ) {
      const calendarInstruction = await buildCalendarInstruction({
        item,
        incomingMessage,
        userInstruction,
        updateDraft,
        toast,
      });
      if (calendarInstruction === null) return;
      instruction = calendarInstruction;
    }

    updateDraft(id, {
      loading: true,
      error: null,
      phase: "generating",
      sentAt: null,
    });

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");

      const provider = (item.provider || "whatsapp").trim();

      const res = await fetch(
        `${FLAGGED_SUPABASE_URL}/functions/v1/draft-whatsapp-manual`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: FLAGGED_ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            thread_id: baseThreadId(item.thread_id),
            provider,
            incomingMessage,
            incoming_message: incomingMessage,
            instruction,
            autoSend: true,
            auto_send: true,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const msg = friendlyError(res.status, text);
        toast({
          title: "Draft failed",
          description: msg,
          variant: "destructive",
        });
        throw new Error(msg);
      }
      const body = await res.json().catch(() => null);
      const draft =
        (
          body &&
          (body.draft ?? body.reply ?? body.text ?? body.message)
        ) ??
        (typeof body === "string" ? body : "");
      const draftId: string | null =
        (body && (body.draft_id ?? body.draftId)) ?? null;
      if (!draft) throw new Error("No draft returned");

      updateDraft(id, {
        loading: false,
        draft: String(draft),
        error: null,
        draftId,
        phase: "sent",
        sentAt: new Date().toISOString(),
      });

      if (needsSupportContext(item)) {
        console.log("[flagged][support] draft sent", {
          thread_id: item.thread_id,
          sender: item.sender,
          intent_category: item.intent_category,
          intent_reason: item.intent_reason,
          draft: String(draft).slice(0, 300),
        });
      } else if (COMPLAINT_CATEGORIES.has((item.intent_category ?? "").toLowerCase().trim())) {
        console.log("[flagged][complaint] draft sent", {
          thread_id: item.thread_id,
          sender: item.sender,
          intent_category: item.intent_category,
          intent_reason: item.intent_reason,
          draft: String(draft).slice(0, 300),
        });
      } else if (
        needsCalendarContext(item, incomingMessage, userInstruction)
      ) {
        await handleCalendarAfterDraft({
          item,
          incomingMessage,
          userInstruction,
          draftText: String(draft),
          toast,
        });
      }
    } catch (e) {
      updateDraft(id, {
        loading: false,
        error:
          (e as Error)?.message ?? "Failed to generate draft",
        phase: "error",
      });
    }
  };

  const generateDraft = (item: FlaggedMessage) =>
    callDraftFunction(item);
  const retryDraft = (item: FlaggedMessage) =>
    callDraftFunction(item);

  // ── dnd-kit sensors ──

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  // ── Dismissal ──
  // Persistence (folders / assignments / dismissals) lives in useFlaggedState,
  // which writes to the DB + mirrors to localStorage for instant paint.

  // Dismissals always collapse onto the BASE thread id so a "Clear all"
  // doesn't leave dozens of frozen per-message ids in the DB that can never
  // be revived. The comparison uses the latest updated_at across every card
  // sharing the base thread (computed below, once `all` is built) — so any
  // fresh inbound on Maria's thread re-surfaces her entire stacked deck.
  const dismissKeysFor = (m: FlaggedMessage): string[] => [baseThreadId(m.thread_id)];
  const dismissItem = (m: FlaggedMessage) => {
    dismissThreads(dismissKeysFor(m));
  };

  const clearAll = () => {
    const ids = Array.from(new Set(deduped.map((m) => baseThreadId(m.thread_id))));
    if (ids.length === 0) return;
    dismissThreads(ids);
    toast({
      title: "Flagged messages cleared",
      description: `${ids.length} item${ids.length === 1 ? "" : "s"} dismissed from review.`,
    });
  };


  // ── Deep delete ──
  // Removes the card from review AND tears down anything we own for the
  // thread: folder assignment, any draft state, and (for appointment threads)
  // the linked agenda_event row + Google Calendar event. The flagged_messages
  // table lives on an external project with no delete endpoint, so client-side
  // dismissal is the deepest action available for that layer.
  const { entries: agendaEntries, remove: removeDbAgenda } = useAgendaEvents();
  const agendaByThread = new Map<string, (typeof agendaEntries)[number]>();
  for (const e of agendaEntries) {
    if (e.thread_id) agendaByThread.set(e.thread_id, e);
  }

  const deepDeleteItem = async (item: FlaggedMessage) => {
    const threadId = item.thread_id;

    // 1. Hide locally.
    dismissItem(item);

    // 2. Clear folder assignment + any open draft state.
    unassignFromFolder(threadId);
    setDrafts((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });


    // 3. If linked to an agenda_event, delete it and push delete to Google.
    //    Respect the AI calendar writes toggle — if disabled, only remove
    //    the local DB row, don't touch Google Calendar.
    const dbEvent = agendaByThread.get(threadId);
    if (dbEvent) {
      const calendarWritesEnabled = (() => {
        try {
          const raw = localStorage.getItem("settings.ai-calendar-writes-enabled");
          if (raw === null) return true;
          return raw === "true";
        } catch {
          return true;
        }
      })();
      const sourceEventId = dbEvent.source_event_id;
      const sourceType = dbEvent.source_type;
      try {
        await removeDbAgenda(dbEvent.id);
      } catch (e) {
        console.warn("agenda_events delete failed (continuing)", e);
      }
      if (
        sourceType === "google_calendar" &&
        sourceEventId &&
        calendarWritesEnabled
      ) {
        supabase.functions
          .invoke("google-calendar-push", {
            body: {
              agenda_event_id: dbEvent.id,
              action: "delete",
              source_event_id: sourceEventId,
            },
          })
          .catch((e) => {
            console.warn(
              "google-calendar-push delete failed (continuing)",
              e,
            );
          });
      }
    }
  };


  // ── Dedup / sort / group pipeline ──

  // Picks the message's own send timestamp from common backend field names.
  // WhatsApp/extension payloads sometimes use seconds-since-epoch (timestamp,
  // t) and sometimes ISO strings (sent_at, message_timestamp). Returns an
  // ISO string or null if no plausible value is present.
  const pickSendTimestamp = (msg: Record<string, unknown>): string | null => {
    const candidates: Array<unknown> = [
      msg.message_timestamp,
      msg.sent_at,
      msg.timestamp,
      msg.t,
      msg.ts,
      msg.send_ts,
    ];
    for (const v of candidates) {
      if (v == null) continue;
      if (typeof v === "string" && v.trim()) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        // Heuristic: < 1e12 => seconds-since-epoch, else ms.
        const ms = v < 1e12 ? v * 1000 : v;
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
    }
    return null;
  };


  const flaggedFromList: FlaggedMessage[] = (data ?? []).map(
    withActivityPreview,
  );

  // ── CONTACTS PTT MERGE ────────────────────────────────────────────────
  // The flagged-list endpoint does NOT forward transcription or include PTT
  // entries in recent_messages (confirmed via logs — allKeys never includes
  // "transcription"). We cross-reference with message-batches?view=contacts
  // which returns full ScanMessage objects including the Whisper transcript.
  //
  // For each flagged thread we inject any PTT/audio messages from the
  // contacts endpoint that aren't already represented in recent_messages.
  if (contactsByThread.size > 0) {
    const ptlInjected: string[] = [];

    for (const item of flaggedFromList) {
      const base = baseThreadId(item.thread_id);
      const contactsMsgs = contactsByThread.get(base);
      if (!contactsMsgs || contactsMsgs.length === 0) continue;

      const recent = (item.recent_messages ?? []) as Array<
        FlaggedMessage["recent_messages"] extends (infer A)[] | undefined
          ? A
          : Record<string, unknown>
      >;
      // Build a set of "already covered" timestamps so we don't duplicate
      const coveredTs = new Set<number>();
      for (const rm of recent) {
        const ts = rm?.captured_at ? new Date(rm.captured_at).getTime() : 0;
        if (ts) coveredTs.add(ts);
      }

      const toInject: typeof recent = [];

      for (const cm of contactsMsgs) {
        const mt = (cm.msg_type ?? "").toLowerCase();
        if (mt !== "ptt" && mt !== "audio") continue;
        const transcript = (cm.transcription ?? "").trim();
        if (!transcript) continue;

        // Convert msg_timestamp (Unix seconds) to ms and compare
        const cmMs = cm.msg_timestamp ? cm.msg_timestamp * 1000 : 0;
        // Check if any recent_messages entry is within 500ms of this
        // contacts message — if so, it's already covered
        const alreadyCovered = cmMs > 0 && Array.from(coveredTs).some(
          (t) => Math.abs(t - cmMs) < 500,
        );
        if (alreadyCovered) continue;

        // Create a synthetic recent_messages entry carrying the transcript
        const capturedAt = cmMs
          ? new Date(cmMs).toISOString()
          : item.updated_at;
        toInject.push({
          body: transcript,
          from_me: cm.from_me,
          captured_at: capturedAt,
          msg_type: cm.msg_type,
          transcription: transcript,
          normalized_body: cm.normalized_body,
          raw_body: cm.raw_body,
          caption: cm.caption,
          has_media: cm.has_media,
          mime_type: cm.mime_type,
        } as typeof recent[number]);
        if (cmMs) coveredTs.add(cmMs);
      }

      if (toInject.length > 0) {
        // Prepend so transcript entries sort before older chat entries
        item.recent_messages = [...toInject, ...recent];
        ptlInjected.push(
          `${item.sender ?? base} (+${toInject.length} PTT)`,
        );
      }
    }

    if (ptlInjected.length > 0) {
      console.log(
        "%c📞 Injected PTT transcripts from contacts endpoint:",
        "color:#3b82f6;font-weight:bold",
        ptlInjected,
      );
    }
  }
  // ── END CONTACTS PTT MERGE ────────────────────────────────────────────

  // ── PIPELINE TRACE LOGGING ──────────────────────────────────────────────
  // Logs every entry at each stage of the card pipeline so we can see:
  //   1. Raw API shape (does flagged-list include transcription?)
  //   2. Post-enrichment shape (did withActivityPreview clean voice stubs?)
  //   3. Per-message gate (why does each message get skipped or kept?)
  // Remove this block once the root cause is confirmed.
  if ((data ?? []).length > 0) {
    console.group(
      `%c🔍 Flagged Pipeline Trace — ${data!.length} items`,
      "color:#2dd4a8;font-weight:bold",
    );
    const voiceRe = VOICE_ENVELOPE_RE;
    for (const raw of data!) {
      const base = baseThreadId(raw.thread_id);
      const recent = raw.recent_messages ?? [];
      const hasAnyVoice = recent.some(
        (m) => (m.msg_type === "ptt" || m.msg_type === "audio") || (m.body && voiceRe.test(m.body)),
      );
      if (!hasAnyVoice && recent.length === 0 && !voiceRe.test(raw.latest_message ?? raw.preview ?? "")) continue;

      console.group(`Thread ${base}`);
      console.log("sender:", raw.sender);
      console.log("latest_message:", JSON.stringify(raw.latest_message));
      console.log("preview:", JSON.stringify(raw.preview));

      // Show the full shape of each recent_messages entry
      if (recent.length > 0) {
        console.log(`recent_messages (${recent.length}):`);
        console.table(
          recent.map((m, i) => ({
            i,
            msg_type: m.msg_type ?? "—",
            body: (m.body ?? "").slice(0, 60),
            transcription: (m as Record<string, unknown>).transcription ?? "—",
            normalized_body: (m as Record<string, unknown>).normalized_body ?? "—",
            raw_body: (m as Record<string, unknown>).raw_body ?? "—",
            caption: (m as Record<string, unknown>).caption ?? "—",
            from_me: m.from_me ?? "—",
            captured_at: m.captured_at?.slice(0, 19) ?? "—",
          })),
        );
      } else {
        console.log("recent_messages: [] (empty)");
      }

      // Now log what withActivityPreview did
      const enriched = withActivityPreview(raw);
      console.log("after enrichment:");
      console.log("  latest_message:", JSON.stringify(enriched.latest_message));
      console.log("  preview:", JSON.stringify(enriched.preview));
      console.log("  is latest_message a voice stub?", voiceRe.test(enriched.latest_message ?? ""));
      console.log("  is latest_message empty?", !(enriched.latest_message ?? "").trim());

      // Simulate what happens in the per-message loop
      for (const [i, m] of recent.entries()) {
        const bt = bestTextForMessage(m as Parameters<typeof bestTextForMessage>[0]);
        const reason = !bt
          ? "SKIPPED: no text from bestTextForMessage"
          : !(m.captured_at ?? raw.updated_at)
            ? "SKIPPED: no captured_at"
            : "→ card";
        console.log(
          `  recent[${i}] bestTextForMessage: ${JSON.stringify(bt)} — ${reason}`,
        );
      }

      console.groupEnd();
    }
    console.groupEnd();
  }
  // ── END PIPELINE TRACE ──────────────────────────────────────────────────

  const flaggedRecentMessageCards: FlaggedMessage[] = [];
  for (const item of flaggedFromList) {
    const messages = item.recent_messages ?? [];
    const latestText = (item.latest_message ?? item.preview ?? "").trim();
    const latestAlreadyInRecent = messages.some(
      (message) => (bestTextForMessage(message) ?? "") === latestText,
    );
    if (latestText && item.updated_at && !latestAlreadyInRecent && !isVoiceStub(latestText)) {
      // The parent's latest_message and from_me are written together by the
      // backend — they're paired by definition. Determine from_me strictly
      // from (1) a body-match in recent_messages, or (2) the parent's own
      // from_me. Do NOT fall back to "latest captured recent_message" — that
      // may be a different message and produces a "You" label on the
      // contact's text (or vice versa). If neither signal is present, skip
      // synthesis rather than render a mispaired card.
      const bodyMatch = messages.find(
        (message) => (bestTextForMessage(message) ?? "") === latestText,
      );
      const parentFromMe = (item as FlaggedMessage & { from_me?: boolean | null })
        .from_me;
      const resolvedFromMe =
        bodyMatch?.from_me ?? (parentFromMe ?? null);
      if (resolvedFromMe === null) {
        // Can't reliably attribute author — don't synthesize a card.
        // The per-recent-message loop below will still surface any
        // entries that did come through with explicit from_me.
      } else {
        const fromMe = !!resolvedFromMe;
        flaggedRecentMessageCards.push({
          ...item,
          thread_id: `${item.thread_id}#recent:${item.updated_at}:latest${fromMe ? ":me" : ""}`,
          preview: latestText,
          latest_message: latestText,
          intent_classified_at: item.intent_classified_at ?? item.updated_at,
          intent_reason:
            item.intent_reason ||
            (fromMe
              ? "Latest outbound message you sent in this flagged thread."
              : "Latest message from this flagged thread."),
          ...({ _fromMe: fromMe } as Partial<FlaggedMessage>),
        });
      }
    }
    for (const [index, message] of messages.entries()) {
      const rawText = bestTextForMessage(message);
      if (!rawText) continue;

      const capturedAt = message.captured_at ?? item.updated_at;
      if (!capturedAt) continue;

      // Prefer the message's own send timestamp over captured_at so re-scans
      // of an older WhatsApp thread don't reshuffle the stack out of send
      // order. Tries common backend field names; falls back to captured_at.
      const sendTs = pickSendTimestamp(message) ?? capturedAt;
      const fromMe = !!message.from_me;

      const text = rawText;

      flaggedRecentMessageCards.push({
        ...item,
        thread_id: `${item.thread_id}#recent:${capturedAt}:${index}${fromMe ? ":me" : ""}`,
        preview: text,
        latest_message: text,
        updated_at: sendTs,
        // Per-message cards must sort by the message's own WhatsApp order,
        // not the parent thread's classification time. Otherwise every card
        // in a stack shares the same recency and can appear out of order.
        intent_classified_at: sendTs,
        intent_reason:
          item.intent_reason ||
          (fromMe
            ? "Outbound message you sent in this flagged thread."
            : "Earlier inbound message from this flagged thread."),
        // Marker consumed by FlaggedCardInner to render the gold "your message" treatment.
        ...({ _fromMe: fromMe } as Partial<FlaggedMessage>),
      });
    }
  }
  const recentCardBaseIds = new Set(
    flaggedRecentMessageCards.map((m) => baseThreadId(m.thread_id)),
  );
  const all: FlaggedMessage[] = [
    ...flaggedFromList.filter(
      (item) => !recentCardBaseIds.has(baseThreadId(item.thread_id)),
    ),
    ...flaggedRecentMessageCards,
  ];
  const recencyOf = (m: FlaggedMessage) => {
    const candidates = [
      m.intent_classified_at,
      m.updated_at,
    ].filter(Boolean) as string[];
    return Math.max(
      ...candidates.map((s) => new Date(s).getTime()),
    );
  };
  const urgencyRank = (m: FlaggedMessage) => {
    const u = (m.intent_urgency ?? "").toLowerCase();
    if (u === "high") return 3;
    if (u === "medium") return 2;
    if (u === "low") return 1;
    return 0;
  };
  const displayOrderOf = (m: FlaggedMessage) => {
    const threadId = m.thread_id;
    if (threadId.includes("#recent:")) {
      return m.updated_at ? new Date(m.updated_at).getTime() : 0;
    }
    return recencyOf(m);
  };
  const sorted = [...all].sort((a, b) => {
    const ur = urgencyRank(b) - urgencyRank(a);
    if (ur !== 0) return ur;
    return displayOrderOf(b) - displayOrderOf(a);
  });
  // Precompute the latest updated_at per base thread so a fresh inbound
  // on Maria's main thread re-surfaces every stacked recent-message card
  // even though each card carries its own (older) captured_at timestamp.
  // IMPORTANT: derive this from the raw parent threads (flaggedFromList),
  // because synthetic recent-message cards in `all` have their `updated_at`
  // rewritten to the message's own (often older) captured_at. Using `all`
  // here causes previously-dismissed threads to stay hidden forever even
  // after a new inbound updates the parent thread.
  const latestUpdateByBase = new Map<string, number>();
  for (const m of flaggedFromList) {
    const base = baseThreadId(m.thread_id);
    const ts = m.updated_at ? new Date(m.updated_at).getTime() : 0;
    const prev = latestUpdateByBase.get(base) ?? 0;
    if (ts > prev) latestUpdateByBase.set(base, ts);
  }
  const isDismissed = (m: FlaggedMessage) => {
    const base = baseThreadId(m.thread_id);
    const dismissedAt = dismissed.get(base);
    if (dismissedAt === undefined) return false;
    const latest = latestUpdateByBase.get(base) ?? 0;
    return latest <= dismissedAt;
  };
  // Drop exact repeats only (same card id OR identical thread+text+timestamp).
  const seenIds = new Set<string>();
  const seenFp = new Set<string>();
  const messageFingerprint = (m: FlaggedMessage) => {
    const text = (m.latest_message ?? m.preview ?? m.subject ?? "")
      .trim()
      .toLowerCase();
    return `${m.thread_id}|${m.updated_at ?? ""}|${text}`;
  };
  const deduped: FlaggedMessage[] = [];
  for (const m of sorted) {
    if (isDismissed(m)) continue;
    if (seenIds.has(m.thread_id)) continue;
    const fp = messageFingerprint(m);
    if (seenFp.has(fp)) continue;
    seenIds.add(m.thread_id);
    seenFp.add(fp);
    deduped.push(m);
  }

  // ── Folder helpers ──

  const folderIds = new Set(folders.map((f) => f.id));
  const ungrouped = deduped.filter((m) => {
    const fid = assignments[m.thread_id];
    return !fid || !folderIds.has(fid);
  });

  const countByFolder = (() => {
    const map: Record<string, number> = {};
    for (const m of deduped) {
      const fid = assignments[m.thread_id];
      if (fid && folderIds.has(fid)) {
        map[fid] = (map[fid] ?? 0) + 1;
      }
    }
    return map;
  })();

  const itemsInFolder = (folderId: string) =>
    deduped.filter(
      (m) => assignments[m.thread_id] === folderId,
    );

  const moveToFolder = (
    threadId: string,
    folderId: string,
  ) => {
    assignToFolder(threadId, folderId);
  };
  const removeFromFolder = (threadId: string) => {
    unassignFromFolder(threadId);
  };

  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const id = `f-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    addFolder({ id, name });
    setNewFolderName("");
    setCreateOpen(false);
  };

  const deleteFolder = (folderId: string) => {
    deleteFolderRemote(folderId);
    if (openFolderId === folderId) setOpenFolderId(null);
  };


  // ── Drag handlers ──

  const handleDragStart = (e: DragStartEvent) => {
    const item = (
      e.active.data.current as
        | { item?: FlaggedMessage }
        | undefined
    )?.item;
    if (item) setActiveItem(item);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    if (typeof overId === "string" && activeItem) {
      if (overId === TRASH_DROP_ID) {
        const item = activeItem;
        void deepDeleteItem(item);
        toast({
          title: "Flagged message deleted",
          description: `${
            item.sender ?? "Thread"
          } removed from review.`,
        });
      } else if (overId.startsWith(FOLDER_DROP_PREFIX)) {
        const folderId = overId.slice(
          FOLDER_DROP_PREFIX.length,
        );
        moveToFolder(activeItem.thread_id, folderId);
      }
    }
    setActiveItem(null);
  };

  const openFolder =
    folders.find((f) => f.id === openFolderId) ?? null;
  const openFolderItems = openFolder
    ? itemsInFolder(openFolder.id)
    : [];

  // ── Render ──

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveItem(null)}
    >
      <section className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Flag size={18} className="text-primary" />
          <h2 className="text-xl font-semibold">
            Flagged messages
          </h2>
          {!isLoading && (
            <Badge variant="secondary" className="ml-1">
              {ungrouped.length}
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="ml-2 gap-1.5 border-[rgba(45,212,168,0.4)] text-[#2dd4a8] hover:text-[#73ffb8] hover:border-[rgba(115,255,184,0.7)] hover:bg-[rgba(45,212,168,0.08)]"
          >
            <FolderPlus size={14} />
            <span>Create folder</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            disabled={deduped.length === 0 || isFetching}
            className="ml-auto gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Archive size={14} />
            <span className="hidden sm:inline">Clear all</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              refetch();
              refetchUsage();
            }}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw
              size={14}
              className={isFetching ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={calendarWrite.toggle}
            className="gap-1.5"
            title={
              calendarWrite.enabled
                ? "AI can create/update/cancel calendar events"
                : "AI calendar writes are blocked"
            }
          >
            {calendarWrite.enabled ? (
              <CalendarCheck size={14} className="text-[#2dd4a8]" />
            ) : (
              <CalendarX size={14} className="text-muted-foreground" />
            )}
            <span className="hidden sm:inline">
              {calendarWrite.enabled ? "Calendar auto" : "Calendar off"}
            </span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMaskPhoneNumbers((v) => !v)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
            title={maskPhoneNumbers ? "Show phone numbers" : "Mask phone numbers"}
          >
            {maskPhoneNumbers ? <Eye size={14} /> : <EyeOff size={14} />}
            <span className="hidden sm:inline">
              {maskPhoneNumbers ? "Show" : "Mask"}
            </span>
          </Button>
        </div>

        {/* Folder bar */}
        {folders.length > 0 && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {folders.map((f) => (
                <FolderTile
                  key={f.id}
                  folder={f}
                  count={countByFolder[f.id] ?? 0}
                  onOpen={() => setOpenFolderId(f.id)}
                  onDelete={() => deleteFolder(f.id)}
                  isAnyDragging={activeItem !== null}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/70 italic flex items-center gap-1.5">
              <GripVertical
                size={11}
                className="text-[#2dd4a8]"
              />
              Drag cards into folders to group related reviews —
              or use the
              <MoreVertical size={11} className="inline" /> menu
              on each card.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1].map((i) => (
              <Card
                key={i}
                className="border-l-4 border-l-border"
              >
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">
            Couldn't load flagged messages:{" "}
            {(error as Error).message}
          </p>
        ) : ungrouped.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Inbox size={16} className="text-[#2dd4a8]" />
            {deduped.length > 0
              ? "All flagged threads are organized in folders."
              : "No flagged threads"}
          </div>
        ) : (
          <div className="relative">
            <div
              className="flagged-scroll max-h-[640px] md:max-h-[560px] overflow-y-auto pr-2 pb-10 pt-6 -mt-6"
              style={{
                scrollbarWidth: "thin",
                scrollbarColor:
                  "rgba(115,255,184,0.25) transparent",
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(() => {
                  // Two-pass grouping for ALL cards (appointment and misc
                  // alike) so the stacked deck-behind-card effect applies
                  // consistently:
                  //  1) Group by thread_id
                  //  2) Merge thread groups that share the same sender label
                  //     so a contact's messages stack into one deck.
                  // Per-card visuals (amber appt accent, Manage Appointment
                  // CTA) stay correct because they're resolved per-item in
                  // FlaggedCardInner / renderFooter from each item's own
                  // intent_category — not from the group key.
                  const threadOrder: string[] = [];
                  const threadMap = new Map<string, FlaggedMessage[]>();
                  for (const m of ungrouped) {
                    const key = m.thread_id;
                    if (!threadMap.has(key)) {
                      threadMap.set(key, []);
                      threadOrder.push(key);
                    }
                    threadMap.get(key)!.push(m);
                  }

                  const groupOrder: string[] = [];
                  const groupMap = new Map<string, FlaggedMessage[]>();
                  const senderToGroup = new Map<string, string>();
                  for (const key of threadOrder) {
                    const items = threadMap.get(key)!;
                    const ck = contactKeyForItem(items[0]);
                    let groupKey: string;
                    // Guard: a blank contact key means no sender label AND
                    // no phone digits in thread_id. Do NOT merge — each
                    // such thread stays in its own deck to prevent wrong-chat
                    // sends when generating drafts.
                    if (!ck) {
                      groupKey = key;
                    } else if (senderToGroup.has(ck)) {
                      groupKey = senderToGroup.get(ck)!;
                    } else {
                      groupKey = ck;
                      senderToGroup.set(ck, groupKey);
                    }
                    if (!groupMap.has(groupKey)) {
                      groupMap.set(groupKey, []);
                      groupOrder.push(groupKey);
                    } else {
                      // When a contact key maps to an existing group but the
                      // thread_id differs, the sender label matched across
                      // distinct chats. Log so operators can investigate.
                      const existingItems = groupMap.get(groupKey)!;
                      const existingThreads = new Set(
                        existingItems.map((m) => baseThreadId(m.thread_id)),
                      );
                      const incomingBase = baseThreadId(items[0].thread_id);
                      if (
                        !existingThreads.has(incomingBase) &&
                        ck
                      ) {
                        console.log(
                          "[flagged][grouping] merging distinct threads by sender",
                          {
                            contact_key: ck.slice(0, 40),
                            existing_threads: [...existingThreads].map((t) =>
                              t.slice(0, 40),
                            ),
                            incoming_thread: incomingBase.slice(0, 40),
                            sender: items[0].sender,
                          },
                        );
                      }
                    }
                    groupMap.get(groupKey)!.push(...items);
                  }
                  return groupOrder.map((key) => {

                    const groupItems = [...groupMap.get(key)!].sort(
                      (a, b) =>
                        displayOrderOf(a) - displayOrderOf(b) ||
                        a.thread_id.localeCompare(b.thread_id),
                    );
                    const main = groupItems[0];
                    return (
                      <DraggableFlaggedCard
                        key={key}
                        items={groupItems}
                        folders={folders}
                        onMoveTo={moveToFolder}
                        maskPhoneNumbers={maskPhoneNumbers}
                        supportDocLabel={(() => {
                          const ds = drafts[groupItems[0]?.thread_id];
                          if (!ds?.supportDocId || ds.supportDocId === "all") return null;
                          return supportDocs.find((d) => d.id === ds.supportDocId)?.title?.slice(0, 24) ?? null;
                        })()}
                        onDelete={(it) => {
                          // Delete the whole deck for this contact, not just
                          // the clicked card — otherwise sibling cards from
                          // the same contact remain and the contact appears
                          // un-deleted on the next render.
                          const bases = Array.from(
                            new Set(groupItems.map((g) => baseThreadId(g.thread_id))),
                          );
                          dismissThreads(bases);
                          for (const g of groupItems) {
                            unassignFromFolder(g.thread_id);
                          }
                          void deepDeleteItem(it);
                          toast({
                            title: "Flagged message deleted",
                            description: `${
                              it.sender ?? "Thread"
                            } removed from review.`,
                          });
                        }}
                        isExpanded={(it) =>
                          !!drafts[it.thread_id]?.open
                        }
                        onActivate={(it) => {
                          const draftState =
                            drafts[it.thread_id] ?? defaultDraft;
                          if (draftState.open) return;
                          const isAppt = APPOINTMENT_CATEGORIES.has(
                            (it.intent_category ?? "")
                              .toLowerCase()
                              .trim(),
                          );
                          const isSupport = SUPPORT_CATEGORIES.has(
                            (it.intent_category ?? "")
                              .toLowerCase()
                              .trim(),
                          );
                          const isComplaint = COMPLAINT_CATEGORIES.has(
                            (it.intent_category ?? "")
                              .toLowerCase()
                              .trim(),
                          );
                          updateDraft(it.thread_id, {
                            open: true,
                            instruction:
                              draftState.instruction ||
                              (isComplaint
                                ? "Acknowledge the customer's frustration. Apologize sincerely. Offer a clear next step. If refunds or serious issues are involved, escalate to human."
                                : isAppt
                                  ? "Check calendar, reply and update google calendar"
                                  : isSupport
                                    ? "Answer using the support knowledge base. Only use documented information."
                                    : ""),
                          });
                        }}
                        onDeactivate={(it) => {
                          updateDraft(it.thread_id, {
                            open: false,
                            error: null,
                          });
                        }}
                        renderFooter={(it) => {
                          const draftState =
                            drafts[it.thread_id] ?? defaultDraft;
                          const isAppt = APPOINTMENT_CATEGORIES.has(
                            (it.intent_category ?? "")
                              .toLowerCase()
                              .trim(),
                          );
                          const isSupport = SUPPORT_CATEGORIES.has(
                            (it.intent_category ?? "")
                              .toLowerCase()
                              .trim(),
                          );
                          const isComplaint = COMPLAINT_CATEGORIES.has(
                            (it.intent_category ?? "")
                              .toLowerCase()
                              .trim(),
                          );
                          return (
                            <DraftReplyFooter
                              item={it}
                              enrichedMessage={
                                it.thread_id.includes("#recent:")
                                  ? null
                                  : enrichedMessageFor(it)
                              }
                              state={draftState}
                              onChange={(patch) =>
                                updateDraft(it.thread_id, patch)
                              }
                              onClose={() =>
                                updateDraft(it.thread_id, {
                                  open: false,
                                  error: null,
                                })
                              }
                              onGenerate={() => generateDraft(it)}
                              onRetry={() => retryDraft(it)}
                              isAppointment={isAppt}
                              isSupport={isSupport}
                              isComplaint={isComplaint}
                              supportDocs={supportDocs.map((d) => ({ id: d.id, title: d.title }))}
                              supportDocId={draftState.supportDocId}
                            />
                          );
                        }}
                      />
                    );
                  });
                })()}
              </div>

            </div>

            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-xl"
              style={{
                background:
                  "linear-gradient(to bottom, hsl(var(--background) / 0) 0%, hsl(var(--background) / 0.7) 55%, hsl(var(--background) / 0.95) 100%)",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
              style={{
                background:
                  "linear-gradient(to right, transparent 0%, rgba(45,212,168,0.55) 50%, transparent 100%)",
                boxShadow:
                  "0 0 12px rgba(115,255,184,0.35)",
              }}
            />
          </div>
        )}

        {(deduped.length > 0 || activeItem) && (
          <TrashDropZone
            isAnyDragging={activeItem !== null}
          />
        )}

        {/* Create folder dialog */}
        <Dialog
          open={createOpen}
          onOpenChange={setCreateOpen}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderPlus
                  size={18}
                  className="text-[#2dd4a8]"
                />
                Create new folder
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 pt-1">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) =>
                  setNewFolderName(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") createFolder();
                }}
                placeholder="e.g. Possible spam, Appointments…"
              />
              <p className="text-[11px] text-muted-foreground">
                Folders help you group flagged reviews. They
                live on this device.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={createFolder}
                disabled={!newFolderName.trim()}
                className="bg-[#2dd4a8] text-[#0a0a1a] hover:bg-[#73ffb8]"
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Folder contents dialog */}
        <Dialog
          open={openFolder !== null}
          onOpenChange={(o) =>
            !o && setOpenFolderId(null)
          }
        >
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderOpen
                  size={18}
                  className="text-[#2dd4a8]"
                />
                {openFolder?.name}
                <Badge variant="secondary">
                  {openFolderItems.length}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            {openFolderItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Drag flagged cards onto this folder to collect
                them here.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {openFolderItems.map((item) => (
                  <FlaggedCardInner
                    key={item.thread_id}
                    item={item}
                    trailing={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          removeFromFolder(
                            item.thread_id,
                          )
                        }
                        aria-label="Remove from folder"
                      >
                        <X size={12} />
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </section>

      <DragOverlay
        dropAnimation={{
          duration: 180,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        {activeItem ? (
          <div
            className="w-[320px] max-w-[80vw] rotate-[-1.5deg] scale-[1.02] pointer-events-none"
            style={{ opacity: 0.95 }}
          >
            <FlaggedCardInner item={activeItem} elevated />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
