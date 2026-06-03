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
  FOLDERS_KEY,
  ASSIGNMENTS_KEY,
  DISMISSED_KEY,
  FOLDER_DROP_PREFIX,
  TRASH_DROP_ID,
  defaultDraft,
  APPOINTMENT_CATEGORIES,
  loadDismissed,
  loadFolders,
  loadAssignments,
  senderLabelForItem,
  normalizeLookup,
  cleanSenderLabel,
  senderFromThreadId,
  isVoiceStub,
  type FolderDef,
  type DraftState,
} from "@/lib/flagged-utils";
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
import { handleCalendarAfterDraft } from "@/lib/calendar-response";
import FlaggedCardInner from "./FlaggedCardInner";
import DraftReplyFooter from "./DraftReplyFooter";
import DraggableFlaggedCard from "./DraggableFlaggedCard";
import FolderTile from "./FolderTile";
import TrashDropZone from "./TrashDropZone";
import { useAgendaEvents } from "@/hooks/useAgendaEvents";

// ── Main ──

export default function FlaggedReviewSection() {
  const { toast } = useToast();
  const { data, isLoading, isFetching, error, refetch } =
    useFlaggedMessages(20);
  const { data: usageData, refetch: refetchUsage } =
    useSendSmartUsage();

  const activityRows = usageData?.recent ?? [];

  const enricher = createEnricher(activityRows);
  const { enrichedMessageFor, withActivityPreview } = enricher;

  // ── State ──

  const [folders, setFolders] = useState<FolderDef[]>(() =>
    loadFolders(),
  );
  const [assignments, setAssignments] = useState<
    Record<string, string>
  >(() => loadAssignments());
  const [dismissed, setDismissed] = useState<Set<string>>(
    () => new Set(loadDismissed()),
  );
  const [activeItem, setActiveItem] = useState<FlaggedMessage | null>(
    null,
  );
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const draftsRef = useRef<Record<string, DraftState>>({});
  useEffect(() => {
    try {
      const hasFreshState =
        localStorage.getItem(ASSIGNMENTS_KEY) ||
        localStorage.getItem(DISMISSED_KEY);
      const hasLegacyHiddenState =
        localStorage.getItem("flagged.assignments.v2") ||
        localStorage.getItem("flagged.dismissed.v1");
      if (!hasFreshState && hasLegacyHiddenState) {
        setAssignments({});
        setDismissed(new Set());
      }
    } catch {
      /* ignore */
    }
  }, []);

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
    if (
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

      if (
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

  // ── localStorage persistence ──

  useEffect(() => {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch {
      /* ignore */
    }
  }, [folders]);

  useEffect(() => {
    try {
      localStorage.setItem(
        ASSIGNMENTS_KEY,
        JSON.stringify(assignments),
      );
    } catch {
      /* ignore */
    }
  }, [assignments]);

  useEffect(() => {
    try {
      localStorage.setItem(
        DISMISSED_KEY,
        JSON.stringify(Array.from(dismissed)),
      );
    } catch {
      /* ignore */
    }
  }, [dismissed]);

  // ── Dismissal ──

  const dismissKeysFor = (m: FlaggedMessage): string[] => [m.thread_id];
  const isDismissed = (m: FlaggedMessage) =>
    dismissKeysFor(m).some((k) => dismissed.has(k));
  const dismissItem = (m: FlaggedMessage) => {
    const keys = dismissKeysFor(m);
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
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
    setAssignments((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
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
  const activityGroups = new Map<string, FlaggedMessage>();
  for (const [index, r] of activityRows
    .filter(isFlaggedActivity)
    .entries()) {
    const text = textForActivity(r);
    const explicitThreadId = (r.thread_id ?? r.threadId ?? "").trim();
    const activityId = activityThreadId(r);
    const sender =
      senderLabelForActivity(r) ||
      senderFromThreadId(explicitThreadId || activityId);
    const fallbackId =
      explicitThreadId || `activity:${r.createdAt}:${index}`;
    const displaySender =
      sender ||
      senderFromThreadId(activityId) ||
      cleanSenderLabel(r.subject) ||
      "Unknown sender";
    // Key by an actual backend thread id only. If a mock/activity row does
    // not provide one, keep it as its own card so same-name rows can stack.
    const groupKey = explicitThreadId || fallbackId;
    const existing = activityGroups.get(groupKey);
    const existingText =
      existing?.latest_message ?? existing?.preview ?? "";
    const useText =
      !existing ||
      !existingText ||
      Boolean(
        text &&
          !isVoiceStub(text) &&
          (isVoiceStub(existingText) ||
            text !== existingText),
      );
    const createdAt = new Date(r.createdAt).getTime();
    const existingAt = existing
      ? new Date(existing.updated_at).getTime()
      : 0;
    if (!existing || useText || createdAt > existingAt) {
      activityGroups.set(groupKey, {
        thread_id: existing?.thread_id ?? fallbackId,
        provider: "whatsapp",
        sender: displaySender,
        subject:
          cleanSenderLabel(r.subject) || existing?.subject || null,
        preview:
          useText ? text || r.preview : existing.preview,
        latest_message: useText
          ? text || r.latestMessage
          : existing.latest_message,
        intent_category: "misc",
        intent_confidence: 1,
        intent_reason:
          "Needs review from the Activity stream.",
        intent_source: "activity",
        intent_classified_at: r.createdAt,
        updated_at: r.createdAt,
        thread_url: null,
      });
    }
  }
  const flaggedFromActivity: FlaggedMessage[] = Array.from(
    activityGroups.values(),
  ).map(withActivityPreview);
  const all: FlaggedMessage[] = [
    ...flaggedFromList,
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
  const sorted = [...all].sort(
    (a, b) => recencyOf(b) - recencyOf(a),
  );
  // Each flagged message is rendered as its own card — no sender grouping.
  // We still de-dup exact repeats of the same message (same thread + same
  // text within the same minute) so polling doesn't double-insert.
  const seenFp = new Set<string>();
  const messageFingerprint = (m: FlaggedMessage) => {
    const text = (
      m.latest_message ??
      m.preview ??
      m.subject ??
      ""
    )
      .trim()
      .toLowerCase();
    const ts = m.updated_at
      ? Math.floor(new Date(m.updated_at).getTime() / 60000)
      : 0;
    return `${m.thread_id}|${ts}|${text}`;
  };
  const deduped: FlaggedMessage[] = [];
  for (const m of sorted) {
    if (isDismissed(m)) continue;
    const fp = messageFingerprint(m);
    if (seenFp.has(fp)) continue;
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
    setAssignments((prev) => ({
      ...prev,
      [threadId]: folderId,
    }));
  };
  const removeFromFolder = (threadId: string) => {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  };

  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const id = `f-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setFolders((prev) => [...prev, { id, name }]);
    setNewFolderName("");
    setCreateOpen(false);
  };

  const deleteFolder = (folderId: string) => {
    setFolders((prev) =>
      prev.filter((f) => f.id !== folderId),
    );
    setAssignments((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v !== folderId) next[k] = v;
      }
      return next;
    });
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
            onClick={() => {
              refetch();
              refetchUsage();
            }}
            disabled={isFetching}
            className="ml-auto gap-1.5"
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
                  // Appointment cards stay as their own decks (per thread)
                  // so they aren't buried behind a sender's misc stack.
                  // Non-appointment cards: two-pass grouping —
                  //  1) Group by thread_id, then 2) merge groups that share
                  //     the same sender label so same-contact messages stack.
                  const threadOrder: string[] = [];
                  const threadMap = new Map<string, FlaggedMessage[]>();
                  for (const m of ungrouped) {
                    const isAppt = APPOINTMENT_CATEGORIES.has(
                      (m.intent_category ?? "").toLowerCase().trim(),
                    );
                    const key = isAppt
                      ? `appt:${m.thread_id}`
                      : m.thread_id;
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
                    const isAppt = key.startsWith("appt:");
                    if (isAppt) {
                      // Appointments: never merge — one deck per thread.
                      groupOrder.push(key);
                      groupMap.set(key, items);
                      continue;
                    }
                    // Non-appointment: merge by sender label across threads.
                    const label = normalizeLookup(senderLabelForItem(items[0]));
                    let groupKey: string;
                    if (label && senderToGroup.has(label)) {
                      groupKey = senderToGroup.get(label)!;
                    } else {
                      groupKey = label || key;
                      if (label) senderToGroup.set(label, groupKey);
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
                          updateDraft(it.thread_id, {
                            open: true,
                            instruction:
                              draftState.instruction ||
                              (isAppt
                                ? "Check calendar, reply and update google calendar"
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
