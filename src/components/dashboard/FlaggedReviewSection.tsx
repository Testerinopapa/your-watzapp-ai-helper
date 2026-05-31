import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Flag,
  MessageCircle,
  Clock,
  RefreshCw,
  FolderOpen,
  Folder,
  FolderPlus,
  X,
  GripVertical,
  MoreVertical,
  Inbox,
  Trash2,
  ExternalLink,
  Sparkles,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  useFlaggedMessages,
  getFlaggedRealtimeClient,
  FLAGGED_SUPABASE_URL,
  FLAGGED_ANON_KEY,
  type FlaggedMessage,
} from "@/hooks/useFlaggedMessages";
import { useSendSmartUsage } from "@/hooks/useSendSmartUsage";
import { useAuth } from "@/contexts/AuthContext";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

type Tone = "fresh" | "stale";

const toneStyles: Record<Tone, { badge: string; border: string }> = {
  fresh: {
    badge: "bg-secondary text-secondary-foreground border-transparent",
    border: "border-l-border",
  },
  stale: {
    badge: "bg-destructive/10 text-destructive border-destructive/20",
    border: "border-l-destructive",
  },
};

const toneFor = (updatedAt: string): Tone => {
  const age = Date.now() - new Date(updatedAt).getTime();
  return age < 24 * 60 * 60 * 1000 ? "fresh" : "stale";
};

type FolderDef = { id: string; name: string };

const FOLDERS_KEY = "flagged.folders.v2";
const ASSIGNMENTS_KEY = "flagged.assignments.v2";
const FOLDER_DROP_PREFIX = "folder-drop:";

const DEFAULT_FOLDERS: FolderDef[] = [
  { id: "needs-review", name: "Needs review" },
  { id: "follow-up", name: "Follow-up" },
];

function loadFolders(): FolderDef[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) return DEFAULT_FOLDERS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (f): f is FolderDef =>
          f && typeof f.id === "string" && typeof f.name === "string",
      );
    }
    return DEFAULT_FOLDERS;
  } catch {
    return DEFAULT_FOLDERS;
  }
}

function loadAssignments(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ASSIGNMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// =====================================================================
// Card UI
// =====================================================================

type FlaggedCardInnerProps = {
  item: FlaggedMessage;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  footer?: React.ReactNode;
  elevated?: boolean;
};

function FlaggedCardInner({ item, trailing, leading, footer, elevated }: FlaggedCardInnerProps) {
  const tone = toneFor(item.updated_at);
  const styles = toneStyles[tone];
  const age = formatDistanceToNow(new Date(item.updated_at), { addSuffix: true });

  return (
    <Card
      className={cn(
        "border-l-4 transition-colors",
        styles.border,
        elevated &&
          "border-l-[#2dd4a8] bg-[#0a0a1a]/95 ring-1 ring-[rgba(115,255,184,0.55)] shadow-[0_20px_50px_-15px_rgba(45,212,168,0.55)]",
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 flex items-start gap-2">
            {leading}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                <MessageCircle size={14} className="text-muted-foreground shrink-0" />
                <span className="truncate">{item.sender ?? "Unknown sender"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                styles.badge,
              )}
            >
              <Clock size={11} />
              {age}
            </span>
            {trailing}
          </div>
        </div>

        <div className="space-y-1">
          {item.intent_category && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {item.intent_category}
            </Badge>
          )}
          {item.intent_reason && (
            <p className="text-[11px] text-muted-foreground/80 italic line-clamp-3 pt-1">
              {item.intent_reason}
            </p>
          )}
        </div>

        {footer}
      </CardContent>
    </Card>
  );
}

// =====================================================================
// Draft reply panel
// =====================================================================

type DraftPhase =
  | "idle"
  | "generating"
  | "waiting"
  | "sent"
  | "error"
  | "timeout";

type DraftState = {
  open: boolean;
  instruction: string;
  draft: string;
  loading: boolean;
  error: string | null;
  draftId: string | null;
  phase: DraftPhase;
  sentAt: string | null;
};

const defaultDraft: DraftState = {
  open: false,
  instruction: "",
  draft: "",
  loading: false,
  error: null,
  draftId: null,
  phase: "idle",
  sentAt: null,
};

function DraftReplyFooter({
  item,
  enrichedMessage,
  state,
  onChange,
  onClose,
  onGenerate,
  onRetry,
  onCancel,
}: {
  item: FlaggedMessage;
  enrichedMessage?: string | null;
  state: DraftState;
  onChange: (patch: Partial<DraftState>) => void;
  onClose: () => void;
  onGenerate: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const incoming = (
    enrichedMessage ??
    item.latest_message ??
    item.preview ??
    item.subject ??
    ""
  ).trim();
  const hasIncoming = incoming.length > 0;
  const trimmedInstruction = state.instruction.trim();
  const canGenerate = hasIncoming && trimmedInstruction.length > 0 && !state.loading;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!state.draft) return;
    try {
      await navigator.clipboard.writeText(state.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  if (!state.open) {
    return (
      <div className="flex items-center justify-between gap-2 pt-1">
        {item.thread_url ? (
          <a
            href={item.thread_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink size={11} />
            Open thread
          </a>
        ) : (
          <span />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ open: true })}
          className="h-7 gap-1.5 text-[11px] text-[#2dd4a8] hover:text-[#73ffb8] hover:bg-[rgba(45,212,168,0.08)]"
        >
          <Sparkles size={12} />
          Draft reply
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-1 rounded-lg border border-border bg-muted/40 p-3 space-y-2.5">
      <div className="space-y-1">
        <span className="block text-[11px] font-medium text-muted-foreground">
          Incoming message
        </span>
        {hasIncoming ? (
          <div className="rounded-md border border-border bg-background p-2.5 text-xs whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {incoming}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-background/50 p-2.5 text-[11px] text-muted-foreground italic">
            No message text available.
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor={`draft-instr-${item.thread_id}`}
          className="block text-[11px] font-medium text-muted-foreground mb-1"
        >
          How should we reply?
        </label>
        <Textarea
          id={`draft-instr-${item.thread_id}`}
          value={state.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
          placeholder="e.g. Politely confirm and propose Tuesday at 10am."
          maxLength={2000}
          rows={3}
          className="text-xs bg-background"
          disabled={state.loading || state.phase === "waiting"}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={!canGenerate || state.phase === "waiting"}
          className="h-7 gap-1.5 text-[11px] bg-[#2dd4a8] text-[#0a0a1a] hover:bg-[#73ffb8]"
        >
          {state.loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          {state.loading
            ? "Generating…"
            : state.draft
              ? "Regenerate & send"
              : "Generate & send"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={state.loading}
          className="h-7 text-[11px]"
        >
          Close
        </Button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {trimmedInstruction.length}/2000
        </span>
      </div>

      {state.error && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2">
          <p className="text-[11px] text-destructive flex-1">{state.error}</p>
          {(state.phase === "error" || state.phase === "timeout") && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRetry}
              className="h-6 text-[11px] text-destructive hover:text-destructive"
            >
              <RefreshCw size={11} className="mr-1" />
              Retry
            </Button>
          )}
        </div>
      )}

      {state.draft && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">
              Suggested draft
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6 gap-1 text-[11px] text-[#2dd4a8] hover:text-[#73ffb8] hover:bg-[rgba(45,212,168,0.08)]"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div
            className="rounded-md border border-border bg-background p-2.5 text-xs whitespace-pre-wrap leading-relaxed"
            aria-readonly
          >
            {state.draft}
          </div>

          {state.phase === "waiting" && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/60 p-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 size={11} className="animate-spin text-[#2dd4a8]" />
                Queued — waiting for WhatsApp Web…
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancel}
                className="h-6 text-[11px] text-muted-foreground hover:text-destructive"
              >
                Cancel
              </Button>
            </div>
          )}

          {state.phase === "sent" && (
            <div className="flex items-center gap-1.5 rounded-md border border-[rgba(45,212,168,0.35)] bg-[rgba(45,212,168,0.08)] p-2 text-[11px] text-[#2dd4a8]">
              <CheckCircle2 size={12} />
              Sent
              {state.sentAt && (
                <span className="text-muted-foreground">
                  · {formatDistanceToNow(new Date(state.sentAt), { addSuffix: true })}
                </span>
              )}
            </div>
          )}

          {state.phase === "timeout" && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                Extension didn't pick this up — is WhatsApp Web open? The draft
                is still queued.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function DraggableFlaggedCard({
  item,
  folders,
  onMoveTo,
  footer,
}: {
  item: FlaggedMessage;
  folders: FolderDef[];
  onMoveTo: (threadId: string, folderId: string) => void;
  footer?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging, setActivatorNodeRef } =
    useDraggable({ id: item.thread_id, data: { item } });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/card relative transition-all",
        isDragging && "opacity-40",
      )}
    >
      <FlaggedCardInner
        item={item}
        footer={footer}
        leading={
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={setActivatorNodeRef}
                  type="button"
                  aria-label="Drag to folder"
                  className={cn(
                    "touch-none mt-0.5 -ml-1 rounded p-0.5 text-muted-foreground/60",
                    "cursor-grab active:cursor-grabbing",
                    "hover:text-[#73ffb8] hover:bg-[rgba(45,212,168,0.08)] transition-colors",
                  )}
                  {...listeners}
                  {...attributes}
                >
                  <GripVertical size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px]">
                Drag to folder
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
        trailing={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-[#73ffb8]"
                aria-label="More actions"
              >
                <MoreVertical size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Move to folder
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {folders.length === 0 ? (
                <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
              ) : (
                folders.map((f) => (
                  <DropdownMenuItem key={f.id} onClick={() => onMoveTo(item.thread_id, f.id)}>
                    <Folder size={12} className="mr-2 text-[#2dd4a8]" />
                    {f.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    </div>
  );
}

// =====================================================================
// Folder drop zone
// =====================================================================

function FolderTile({
  folder,
  count,
  onOpen,
  onDelete,
  isAnyDragging,
}: {
  folder: FolderDef;
  count: number;
  onOpen: () => void;
  onDelete: () => void;
  isAnyDragging: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${FOLDER_DROP_PREFIX}${folder.id}`,
    data: { folderId: folder.id },
  });

  const isEmpty = count === 0;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/folder relative rounded-xl border px-3 py-2.5 transition-all cursor-pointer select-none",
        "bg-[rgba(15,23,42,0.55)] border-[rgba(45,212,168,0.3)]",
        "hover:border-[rgba(115,255,184,0.55)] hover:shadow-[0_0_18px_rgba(115,255,184,0.18)]",
        isEmpty && "border-dashed",
        isAnyDragging && !isOver && "border-[rgba(45,212,168,0.55)] shadow-[0_0_12px_rgba(45,212,168,0.2)]",
        isOver &&
          "scale-[1.04] border-[rgba(115,255,184,0.95)] shadow-[0_0_28px_rgba(115,255,184,0.55)] bg-[rgba(45,212,168,0.12)]",
      )}
      onClick={onOpen}
      role="button"
      aria-label={`Open folder ${folder.name}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isOver ? (
          <FolderOpen size={16} className="text-[#73ffb8] shrink-0" />
        ) : (
          <Folder size={16} className="text-[#2dd4a8] shrink-0" />
        )}
        <span className="text-sm font-medium truncate">{folder.name}</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full px-1.5 text-[10px] font-bold transition-colors",
            count > 0
              ? "bg-[#2dd4a8] text-[#0a0a1a]"
              : "bg-[rgba(45,212,168,0.15)] text-[#2dd4a8]",
          )}
        >
          {count}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete folder ${folder.name}`}
          className="opacity-0 group-hover/folder:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <p
        className={cn(
          "text-[10px] mt-1 transition-colors",
          isOver
            ? "text-[#73ffb8]"
            : isEmpty
              ? "text-muted-foreground/70"
              : "text-muted-foreground/60",
        )}
      >
        {isOver ? "Release to add" : isEmpty ? "Drop cards here" : `${count} card${count === 1 ? "" : "s"} grouped`}
      </p>
    </div>
  );
}

// =====================================================================
// Main
// =====================================================================

export default function FlaggedReviewSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data, isLoading, isFetching, error, refetch } = useFlaggedMessages(20);
  const { data: usageData, refetch: refetchUsage } = useSendSmartUsage();

  // Build a sender -> richest recent message text map from the Activity feed
  // so we can substitute "[Voice message] 1×" stubs with the real transcript.
  const normalizeSender = (s: string | null | undefined) =>
    (s ?? "").trim().toLowerCase();
  const enrichedBySender = useMemo(() => {
    // Keep the freshest (latest createdAt) non-empty activity entry per sender,
    // preferring entries that have a real transcript over voice-message stubs.
    const map = new Map<string, { text: string; createdAt: number }>();
    for (const r of usageData?.recent ?? []) {
      const key = normalizeSender(r.senderEmail);
      if (!key) continue;
      const text = (r.latestMessage ?? r.preview ?? "").trim();
      if (!text) continue;
      const createdAt = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { text, createdAt });
        continue;
      }
      const existingIsStub = isVoiceStub(existing.text);
      const candidateIsStub = isVoiceStub(text);
      // Prefer real transcript over stub; otherwise prefer the newer entry.
      if (existingIsStub && !candidateIsStub) {
        map.set(key, { text, createdAt });
      } else if (existingIsStub === candidateIsStub && createdAt > existing.createdAt) {
        map.set(key, { text, createdAt });
      }
    }
    return map;
  }, [usageData]);

  function isVoiceStub(text: string | null | undefined) {
    const t = (text ?? "").trim();
    if (!t) return true;
    return /^\[voice message[^\]]*\]\s*(\d+×|x\d+)?\s*$/i.test(t);
  }

  const enrichedMessageFor = (item: FlaggedMessage): string | null => {
    const current = (item.latest_message ?? item.preview ?? "").trim();
    const key = normalizeSender(item.sender);
    const candidate = enrichedBySender.get(key);
    if (!candidate) return null;

    // Always replace voice-message stubs with a real transcript if we have one.
    if (isVoiceStub(current) && !isVoiceStub(candidate.text)) {
      return candidate.text;
    }

    // Otherwise, replace the flagged-list preview when the Activity feed has
    // a strictly newer message for this sender — the flagged list can be
    // stale for some threads while Activity reflects the latest inbound.
    const itemTs = Math.max(
      item.intent_classified_at ? new Date(item.intent_classified_at).getTime() : 0,
      item.updated_at ? new Date(item.updated_at).getTime() : 0,
    );
    if (
      candidate.createdAt > itemTs &&
      candidate.text &&
      candidate.text !== current
    ) {
      return candidate.text;
    }

    return null;
  };

  const withActivityPreview = (item: FlaggedMessage): FlaggedMessage => {
    const enriched = enrichedMessageFor(item);
    if (!enriched) return item;

    const candidate = enrichedBySender.get(normalizeSender(item.sender));
    const currentUpdatedAt = item.updated_at ? new Date(item.updated_at).getTime() : 0;
    const hasFreshActivityTime =
      candidate &&
      Number.isFinite(candidate.createdAt) &&
      candidate.createdAt > currentUpdatedAt;

    return {
      ...item,
      preview: enriched,
      latest_message: enriched,
      updated_at: hasFreshActivityTime
        ? new Date(candidate.createdAt).toISOString()
        : item.updated_at,
    };
  };

  const [folders, setFolders] = useState<FolderDef[]>(() => loadFolders());
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    loadAssignments(),
  );
  const [activeItem, setActiveItem] = useState<FlaggedMessage | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const draftsRef = useRef<Record<string, DraftState>>({});
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  // Timeout handles keyed by thread_id
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // draft_id -> thread_id reverse index for realtime updates
  const draftToThreadRef = useRef<Record<string, string>>({});

  const clearTimeoutFor = (threadId: string) => {
    const t = timeoutsRef.current[threadId];
    if (t) {
      clearTimeout(t);
      delete timeoutsRef.current[threadId];
    }
  };

  const updateDraft = (threadId: string, patch: Partial<DraftState>) =>
    setDrafts((prev) => ({
      ...prev,
      [threadId]: { ...defaultDraft, ...prev[threadId], ...patch },
    }));

  const friendlyError = (status: number, raw: string): string => {
    if (status === 401) return "Session expired — please sign in again.";
    if (status === 402) return "Plan limit reached. Upgrade to continue drafting.";
    if (status === 429) return "Too many requests — try again in a moment.";
    if (status === 502) return "AI service is unavailable right now. Please retry.";
    return raw || `Request failed (${status})`;
  };

  const needsCalendarContext = (item: FlaggedMessage, incomingMessage: string, userInstruction: string) => {
    const text = `${item.intent_category ?? ""} ${incomingMessage} ${userInstruction}`.toLowerCase();
    return /appointment|calendar|schedule|scheduled|booking|booked|meeting|meet|call|slot|available|availability|confirm|confirmed|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}[/-]\d{1,2}\b/.test(text);
  };

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
    const userInstruction = (drafts[id]?.instruction ?? "").trim().slice(0, 2000);
    if (!incomingMessage || !userInstruction) return;

    // For scheduling-related messages, first sync Google Calendar into
    // agenda_events, then prepend the user's busy blocks to the instruction.
    // If we can't verify the calendar, do not draft a positive confirmation.
    let instruction = userInstruction;
    if (needsCalendarContext(item, incomingMessage, userInstruction)) {
      try {
        const { error: syncError } = await supabase.functions.invoke("google-calendar-sync", { body: {} });
        if (syncError) {
          throw new Error(syncError.message || "Calendar sync failed");
        }

        const nowIso = new Date().toISOString();
        const horizonIso = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: events } = await supabase
          .from("agenda_events")
          .select("title, start_time, end_time, timezone, location")
          .gte("end_time", nowIso)
          .lte("start_time", horizonIso)
          .order("start_time", { ascending: true })
          .limit(250);

        if (events === null) {
          throw new Error("Calendar events could not be loaded");
        }

        const tz =
          Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
        const fmt = new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: tz,
        });
        const fmtTime = new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: tz,
        });

        const lines = (events ?? [])
          .filter((e) => e.start_time && e.end_time)
          .map((e) => {
            const startDate = new Date(e.start_time as string);
            const endDate = new Date(e.end_time as string);
            const start = fmt.format(startDate);
            const end = fmtTime.format(endDate);
            const loc = e.location ? ` @ ${e.location}` : "";
            const title = e.title?.trim() || "(busy)";
            return `- ${start}–${end} (${startDate.toISOString()} to ${endDate.toISOString()}) — ${title}${loc}`;
          });

        const calendarBlock =
          lines.length > 0
            ? `CALENDAR CONTEXT — freshly synced from Google Calendar at ${new Date().toISOString()}. Current timezone: ${tz}. The user is ALREADY BUSY at these times in the next 30 days. Treat each block as fully booked and unavailable:\n${lines.join(
                "\n",
              )}`
            : `CALENDAR CONTEXT — freshly synced from Google Calendar at ${new Date().toISOString()}. User has no scheduled events in the next 30 days (${tz}). Any reasonable time can be proposed.`;

        const calendarRules =
          lines.length > 0
            ? `\n\nHARD RULES FOR THIS REPLY (must follow):\n1. NEVER confirm, accept, or propose any time that overlaps a CALENDAR CONTEXT block above — those slots are already booked.\n2. If the incoming message proposes a specific time, first check it against the CALENDAR CONTEXT. If it conflicts (even partially), DO NOT confirm. Politely say that slot is taken and offer the nearest free alternative.\n3. If unsure whether a slot is free, ask the contact for an alternative instead of guessing.\n4. Only confirm a time when you can verify it does NOT overlap any CALENDAR CONTEXT block.`
            : "";

        instruction = `${calendarBlock}\n\n---\n\n${userInstruction}${calendarRules}`.slice(
          0,
          8000,
        );

      } catch (err) {
        console.warn("[flagged] failed to load calendar context", err);
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Calendar could not be verified.";
        updateDraft(id, {
          loading: false,
          error: `Calendar could not be verified, so I stopped before drafting: ${message}`,
          phase: "error",
        });
        toast({
          title: "Calendar not verified",
          description: "I stopped the draft so we don't confirm an already-booked slot.",
          variant: "destructive",
        });
        return;
      }
    }

    clearTimeoutFor(id);
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
        (body && (body.draft ?? body.reply ?? body.text ?? body.message)) ??
        (typeof body === "string" ? body : "");
      const draftId: string | null =
        (body && (body.draft_id ?? body.draftId)) ?? null;
      if (!draft) throw new Error("No draft returned");

      if (draftId) {
        draftToThreadRef.current[draftId] = id;
      }

      updateDraft(id, {
        loading: false,
        draft: String(draft),
        error: null,
        draftId,
        phase: draftId ? "waiting" : "idle",
      });

      // 60s client-side timeout — show warning if no terminal state
      if (draftId) {
        timeoutsRef.current[id] = setTimeout(() => {
          setDrafts((prev) => {
            const cur = prev[id];
            if (!cur || cur.phase !== "waiting") return prev;
            return {
              ...prev,
              [id]: {
                ...cur,
                phase: "timeout",
                error:
                  "Extension didn't pick this up — is WhatsApp Web open?",
              },
            };
          });
        }, 60_000);
      }
    } catch (e) {
      updateDraft(id, {
        loading: false,
        error: (e as Error)?.message ?? "Failed to generate draft",
        phase: "error",
      });
    }
  };

  const generateDraft = (item: FlaggedMessage) => callDraftFunction(item);
  const retryDraft = (item: FlaggedMessage) => callDraftFunction(item);

  const cancelPendingSend = async (item: FlaggedMessage) => {
    const id = item.thread_id;
    const cur = drafts[id];
    if (!cur?.draftId) return;
    clearTimeoutFor(id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const res = await fetch(
        `${FLAGGED_SUPABASE_URL}/functions/v1/cancel-pending-send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: FLAGGED_ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            thread_id: item.thread_id,
            provider: (item.provider || "whatsapp").trim(),
            draft_id: cur.draftId,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Cancel failed (${res.status})`);
      }
      updateDraft(id, { phase: "idle", error: null });
      toast({ title: "Cancelled", description: "Pending send cancelled." });
    } catch (e) {
      updateDraft(id, {
        phase: "error",
        error: (e as Error)?.message ?? "Failed to cancel",
      });
    }
  };

  // Clear all timeouts on unmount
  useEffect(() => {
    return () => {
      for (const t of Object.values(timeoutsRef.current)) clearTimeout(t);
      timeoutsRef.current = {};
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch {
      /* ignore */
    }
  }, [folders]);

  useEffect(() => {
    try {
      localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
    } catch {
      /* ignore */
    }
  }, [assignments]);

  useEffect(() => {
    if (!user?.id) return;
    const client = getFlaggedRealtimeClient();
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;

    const applyRow = (row: Record<string, unknown> | undefined, source: string) => {
      if (!row) return;
      const threadId = row.thread_id as string | undefined;
      if (!threadId) return;
      const status = row.status_value as string | undefined;
      const lastKey = row.last_auto_sent_message_key as string | undefined;
      const lastAt = row.last_auto_sent_at as string | undefined;
      const lastError = row.last_error as string | undefined;

      console.log("[flagged] thread_states update", source, {
        threadId,
        status,
        lastKey,
        lastAt,
        lastError,
      });

      setDrafts((prev) => {
        const cur = prev[threadId];
        if (!cur || !cur.draftId || cur.phase !== "waiting") return prev;

        const keyMatches = lastKey && lastKey === cur.draftId;
        const looksSent =
          status === "sent" ||
          status === "delivered" ||
          status === "completed" ||
          !!keyMatches;

        if (looksSent) {
          clearTimeoutFor(threadId);
          return {
            ...prev,
            [threadId]: {
              ...cur,
              phase: "sent",
              sentAt: lastAt ?? new Date().toISOString(),
              error: null,
            },
          };
        }
        if (lastError) {
          clearTimeoutFor(threadId);
          return {
            ...prev,
            [threadId]: { ...cur, phase: "error", error: lastError },
          };
        }
        return prev;
      });
    };

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          client.realtime.setAuth(session.access_token);
        }
      } catch {
        /* ignore */
      }
      if (cancelled) return;

      channel = client
        .channel(`flagged-thread-states-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "thread_states",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            applyRow(
              (payload.new ?? payload.old) as Record<string, unknown> | undefined,
              "realtime",
            );
            refetch();
            refetchUsage();
          },
        )
        .subscribe((status) => {
          console.log("[flagged] realtime status:", status);
        });
    })();

    // Polling fallback — every 4s, check thread_states for any draft in
    // "waiting" phase via REST. This sidesteps realtime entirely if the
    // subscription isn't delivering events.
    const pollId = setInterval(async () => {
      const waitingThreadIds = Object.entries(draftsRef.current)
        .filter(([, d]) => (d as DraftState).phase === "waiting" && (d as DraftState).draftId)
        .map(([tid]) => tid);
      if (waitingThreadIds.length === 0) return;

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const inList = waitingThreadIds
          .map((t) => `"${t.replace(/"/g, '\\"')}"`)
          .join(",");
        const url =
          `${FLAGGED_SUPABASE_URL}/rest/v1/thread_states` +
          `?select=thread_id,status_value,last_auto_sent_message_key,last_auto_sent_at,last_error` +
          `&thread_id=in.(${encodeURIComponent(inList)})`;

        const res = await fetch(url, {
          headers: {
            apikey: FLAGGED_ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        if (!res.ok) return;
        const rows = (await res.json()) as Record<string, unknown>[];
        for (const r of rows) applyRow(r, "poll");
      } catch (e) {
        console.log("[flagged] poll error", e);
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      if (channel) client.removeChannel(channel);
    };
  }, [user?.id, refetch, refetchUsage]);


  const all: FlaggedMessage[] = (data ?? []).map(withActivityPreview);
  const recencyOf = (m: FlaggedMessage) => {
    const candidates = [m.intent_classified_at, m.updated_at].filter(Boolean) as string[];
    return Math.max(...candidates.map((s) => new Date(s).getTime()));
  };
  const sorted = [...all].sort((a, b) => recencyOf(b) - recencyOf(a));
  const seen = new Set<string>();
  const deduped: FlaggedMessage[] = [];
  for (const m of sorted) {
    const key = m.sender ?? m.thread_id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const ungrouped = deduped.filter((m) => {
    const fid = assignments[m.thread_id];
    return !fid || !folderIds.has(fid);
  });

  const countByFolder = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of deduped) {
      const fid = assignments[m.thread_id];
      if (fid && folderIds.has(fid)) {
        map[fid] = (map[fid] ?? 0) + 1;
      }
    }
    return map;
  }, [deduped, assignments, folderIds]);

  const itemsInFolder = (folderId: string) =>
    deduped.filter((m) => assignments[m.thread_id] === folderId);

  const moveToFolder = (threadId: string, folderId: string) => {
    setAssignments((prev) => ({ ...prev, [threadId]: folderId }));
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
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setFolders((prev) => [...prev, { id, name }]);
    setNewFolderName("");
    setCreateOpen(false);
  };

  const deleteFolder = (folderId: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setAssignments((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v !== folderId) next[k] = v;
      }
      return next;
    });
    if (openFolderId === folderId) setOpenFolderId(null);
  };

  const handleDragStart = (e: DragStartEvent) => {
    const item = (e.active.data.current as { item?: FlaggedMessage } | undefined)?.item;
    if (item) setActiveItem(item);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    if (typeof overId === "string" && overId.startsWith(FOLDER_DROP_PREFIX) && activeItem) {
      const folderId = overId.slice(FOLDER_DROP_PREFIX.length);
      moveToFolder(activeItem.thread_id, folderId);
    }
    setActiveItem(null);
  };

  const openFolder = folders.find((f) => f.id === openFolderId) ?? null;
  const openFolderItems = openFolder ? itemsInFolder(openFolder.id) : [];

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
          <h2 className="text-xl font-semibold">Flagged messages</h2>
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
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
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
              <GripVertical size={11} className="text-[#2dd4a8]" />
              Drag cards into folders to group related reviews — or use the
              <MoreVertical size={11} className="inline" /> menu on each card.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1].map((i) => (
              <Card key={i} className="border-l-4 border-l-border">
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
            Couldn't load flagged messages: {(error as Error).message}
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
              className="flagged-scroll max-h-[640px] md:max-h-[560px] overflow-y-auto pr-2 pb-10"
              style={{
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(115,255,184,0.25) transparent",
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ungrouped.map((item) => {
                  const draftState = drafts[item.thread_id] ?? defaultDraft;
                  return (
                    <DraggableFlaggedCard
                      key={item.thread_id}
                      item={item}
                      folders={folders}
                      onMoveTo={moveToFolder}
                      footer={
                        <DraftReplyFooter
                          item={item}
                          enrichedMessage={enrichedMessageFor(item)}
                          state={draftState}
                          onChange={(patch) => updateDraft(item.thread_id, patch)}
                          onClose={() =>
                            updateDraft(item.thread_id, { open: false, error: null })
                          }
                          onGenerate={() => generateDraft(item)}
                          onRetry={() => retryDraft(item)}
                          onCancel={() => cancelPendingSend(item)}
                        />
                      }
                    />
                  );
                })}
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
                boxShadow: "0 0 12px rgba(115,255,184,0.35)",
              }}
            />
          </div>
        )}

        {/* Create folder dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderPlus size={18} className="text-[#2dd4a8]" />
                Create new folder
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 pt-1">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createFolder();
                }}
                placeholder="e.g. Possible spam, Appointments…"
              />
              <p className="text-[11px] text-muted-foreground">
                Folders help you group flagged reviews. They live on this device.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
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
        <Dialog open={openFolder !== null} onOpenChange={(o) => !o && setOpenFolderId(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderOpen size={18} className="text-[#2dd4a8]" />
                {openFolder?.name}
                <Badge variant="secondary">{openFolderItems.length}</Badge>
              </DialogTitle>
            </DialogHeader>

            {openFolderItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Drag flagged cards onto this folder to collect them here.
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
                        onClick={() => removeFromFolder(item.thread_id)}
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

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
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
