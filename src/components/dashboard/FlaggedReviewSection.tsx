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
  type FolderDef,
  type DraftState,
} from "@/lib/flagged-utils";
import { useFlaggedState } from "@/hooks/useFlaggedState";

import {
  createEnricher,
  senderLabelForActivity,
  textForActivity,
  activityThreadId,
  isFlaggedActivity,
} from "@/lib/enrichment";
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

// ── Main ──

export default function FlaggedReviewSection() {
  const { toast } = useToast();
  const { docs: supportDocs } = useSupportKnowledge();
  const { data, isLoading, isFetching, error, refetch } =
    useFlaggedMessages(20);
  const { data: usageData, refetch: refetchUsage } =
    useSendSmartUsage();

  const activityRows = usageData?.recent ?? [];

  const enricher = createEnricher(activityRows);
  const { enrichedMessageFor, withActivityPreview } = enricher;

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
            thread_id: item.thread_id,
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
    const dbEvent = agendaByThread.get(threadId);
    if (dbEvent) {
      const sourceEventId = dbEvent.source_event_id;
      const sourceType = dbEvent.source_type;
      try {
        await removeDbAgenda(dbEvent.id);
      } catch (e) {
        console.warn("agenda_events delete failed (continuing)", e);
      }
      if (sourceType === "google_calendar" && sourceEventId) {
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

  const flaggedFromList: FlaggedMessage[] = (data ?? []).map(
    withActivityPreview,
  );
  const flaggedRecentMessageCards: FlaggedMessage[] = [];
  for (const item of flaggedFromList) {
    const messages = item.recent_messages ?? [];
    for (const [index, message] of messages.entries()) {
      const text = (message.body ?? "").trim();
      const capturedAt = message.captured_at ?? item.updated_at;
      if (!text || !capturedAt || message.from_me) continue;
      flaggedRecentMessageCards.push({
        ...item,
        thread_id: `${item.thread_id}#recent:${capturedAt}:${index}`,
        preview: text,
        latest_message: text,
        updated_at: capturedAt,
        intent_classified_at: item.intent_classified_at ?? capturedAt,
        intent_reason:
          item.intent_reason || "Earlier inbound message from this flagged thread.",
      });
    }
  }
  // Build per-message cards from the Activity stream. We include BOTH
  // explicitly-flagged activity rows AND any other recent activity rows
  // whose sender matches a contact already surfaced in the flagged list
  // — so e.g. "Maria" gets every recent message of hers stacked into
  // her deck, not just the one row the flagged backend returns.
  const flaggedContactKeys = new Set(
    flaggedFromList.map((m) => contactKeyForItem(m)).filter(Boolean),
  );
  const flaggedFromActivity: FlaggedMessage[] = [];
  for (const [index, r] of activityRows.entries()) {
    const text = textForActivity(r);
    const explicitThreadId = (r.thread_id ?? r.threadId ?? "").trim();
    const activityId = activityThreadId(r);
    const sender =
      senderLabelForActivity(r) ||
      senderFromThreadId(explicitThreadId || activityId);
    const displaySender =
      sender ||
      senderFromThreadId(activityId) ||
      cleanSenderLabel(r.subject) ||
      "Unknown sender";
    const ck = normalizeLookup(displaySender);
    const matchesFlaggedContact = ck && flaggedContactKeys.has(ck);
    if (!isFlaggedActivity(r) && !matchesFlaggedContact) continue;
    // Unique per-message id so each inbound becomes its own card.
    const cardId = explicitThreadId
      ? `${explicitThreadId}#${r.createdAt}:${index}`
      : `activity:${r.createdAt}:${index}`;
    flaggedFromActivity.push(
      withActivityPreview({
        thread_id: cardId,
        provider: "whatsapp",
        sender: displaySender,
        subject: cleanSenderLabel(r.subject) || null,
        preview: text || r.preview,
        latest_message: text || r.latestMessage,
        intent_category: "misc",
        intent_confidence: 1,
        intent_reason: matchesFlaggedContact
          ? "Earlier message from a flagged contact."
          : "Needs review from the Activity stream.",
        intent_source: "activity",
        intent_classified_at: r.createdAt,
        updated_at: r.createdAt,
        thread_url: null,
      }),
    );
  }
  const all: FlaggedMessage[] = [
    ...flaggedFromList,
    ...flaggedRecentMessageCards,
    ...flaggedFromActivity,
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
  const sorted = [...all].sort((a, b) => {
    const ur = urgencyRank(b) - urgencyRank(a);
    if (ur !== 0) return ur;
    return recencyOf(b) - recencyOf(a);
  });
  // Precompute the latest updated_at per base thread so a fresh inbound
  // on Maria's main thread re-surfaces every stacked recent-message card
  // even though each card carries its own (older) captured_at timestamp.
  const latestUpdateByBase = new Map<string, number>();
  for (const m of all) {
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
                    if (senderToGroup.has(ck)) {
                      groupKey = senderToGroup.get(ck)!;
                    } else {
                      groupKey = ck;
                      senderToGroup.set(ck, groupKey);
                    }
                    if (!groupMap.has(groupKey)) {
                      groupMap.set(groupKey, []);
                      groupOrder.push(groupKey);
                    }
                    groupMap.get(groupKey)!.push(...items);
                  }
                  return groupOrder.map((key) => {

                    const groupItems = groupMap.get(key)!;
                    const main = groupItems[0];
                    return (
                      <DraggableFlaggedCard
                        key={key}
                        items={groupItems}
                        folders={folders}
                        onMoveTo={moveToFolder}
                        supportDocLabel={(() => {
                          const ds = drafts[groupItems[0]?.thread_id];
                          if (!ds?.supportDocId || ds.supportDocId === "all") return null;
                          return supportDocs.find((d) => d.id === ds.supportDocId)?.title?.slice(0, 24) ?? null;
                        })()}
                        onDelete={(it) => {
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
                              enrichedMessage={enrichedMessageFor(it)}
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
