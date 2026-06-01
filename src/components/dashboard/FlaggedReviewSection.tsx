import { useEffect, useRef, useState } from "react";
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
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { extractDateTime, looksLikeConfirmation } from "@/lib/extractDateTime";
import {
  useFlaggedMessages,
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
const DISMISSED_KEY = "flagged.dismissed.v1";
const FOLDER_DROP_PREFIX = "folder-drop:";
const TRASH_DROP_ID = "flagged-trash-drop";

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

const DEFAULT_FOLDERS: FolderDef[] = [
  { id: "needs-review", name: "Needs review" },
  { id: "follow-up", name: "Follow-up" },
];

const ISO_TIMESTAMP_LABEL_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})(?::\d+)?$/i;

const cleanSenderLabel = (value: string | null | undefined) => {
  const cleaned = (value ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !cleaned ||
    /^unknown sender$/i.test(cleaned) ||
    /^activity:/i.test(cleaned) ||
    ISO_TIMESTAMP_LABEL_RE.test(cleaned)
  ) return "";
  return cleaned;
};

const senderFromThreadId = (threadId: string | null | undefined) => {
  const raw = (threadId ?? "").split("|")[0]?.replace(/^\w+:/, "") ?? "";
  return cleanSenderLabel(raw);
};

const senderLabelForItem = (item: Pick<FlaggedMessage, "sender" | "subject" | "thread_id">) =>
  cleanSenderLabel(item.sender) || cleanSenderLabel(item.subject) || senderFromThreadId(item.thread_id);

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
  const senderLabel = senderLabelForItem(item) || "Unknown sender";
  const itemWithBacklog = item as FlaggedMessage & {
    backlog_count?: number;
    backlog_items?: FlaggedMessage[];
  };
  const backlog = itemWithBacklog.backlog_count ?? 0;
  const backlogItems = itemWithBacklog.backlog_items ?? [];
  const [backlogOpen, setBacklogOpen] = useState(false);
  const allMessages = [item, ...backlogItems];

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
                <span className="truncate">{senderLabel}</span>
                {backlog > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBacklogOpen(true);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="ml-1 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={`View ${backlog} earlier message${backlog === 1 ? "" : "s"} from this sender`}
                  >
                    <Badge
                      variant="secondary"
                      className="h-5 px-1.5 text-[10px] font-semibold cursor-pointer hover:bg-secondary/70"
                    >
                      +{backlog}
                    </Badge>
                  </button>
                )}
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
          {(item.latest_message || item.preview || item.subject) && (
            <p
              className="text-xs text-foreground/90 line-clamp-3 whitespace-pre-wrap leading-relaxed"
              title={item.latest_message ?? item.preview ?? item.subject ?? undefined}
            >
              “{item.latest_message ?? item.preview ?? item.subject}”
            </p>
          )}
          {item.intent_reason && (
            <p className="text-[11px] text-muted-foreground/80 italic line-clamp-3 pt-1">
              {item.intent_reason}
            </p>
          )}
        </div>

        {footer}
      </CardContent>

      <Dialog open={backlogOpen} onOpenChange={setBacklogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Messages from {senderLabel}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {allMessages.length} total
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
            {allMessages.map((m, idx) => {
              const text = m.latest_message ?? m.preview ?? m.subject ?? "";
              const when = m.updated_at
                ? formatDistanceToNow(new Date(m.updated_at), { addSuffix: true })
                : "";
              return (
                <div
                  key={`${m.thread_id}-${idx}`}
                  className="rounded-md border border-border bg-muted/30 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {idx === 0 ? "Latest" : `#${allMessages.length - idx}`}
                    </span>
                    <span>{when}</span>
                  </div>
                  {text ? (
                    <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {text}
                    </p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">No preview available.</p>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// =====================================================================
// Draft reply panel
// =====================================================================

type DraftPhase =
  | "idle"
  | "generating"
  | "sent"
  | "error";

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
}: {
  item: FlaggedMessage;
  enrichedMessage?: string | null;
  state: DraftState;
  onChange: (patch: Partial<DraftState>) => void;
  onClose: () => void;
  onGenerate: () => void;
  onRetry: () => void;
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
          disabled={state.loading}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={!canGenerate}
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
          {state.phase === "error" && (
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
// Trash drop zone
// =====================================================================

function TrashDropZone({ isAnyDragging }: { isAnyDragging: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: TRASH_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      aria-label="Drop here to delete"
      className={cn(
        "rounded-xl border border-dashed px-4 py-3 flex items-center justify-center gap-2 text-sm transition-all select-none",
        "border-destructive/40 text-destructive/80 bg-destructive/[0.04]",
        isAnyDragging && !isOver && "border-destructive/60 bg-destructive/[0.08]",
        isOver &&
          "scale-[1.02] border-destructive text-destructive bg-destructive/15 shadow-[0_0_28px_hsl(var(--destructive)/0.45)]",
        !isAnyDragging && "opacity-60",
      )}
    >
      <Trash2 size={16} />
      <span className="font-medium">
        {isOver ? "Release to delete" : "Drag here to delete"}
      </span>
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

  const normalizeLookup = (s: string | null | undefined) =>
    cleanSenderLabel(s)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const normalizePhone = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const threadContactKey = (threadId: string | null | undefined) => normalizeLookup(senderFromThreadId(threadId));
  const lookupKeysForFlagged = (item: FlaggedMessage) => {
    const keys = [
      item.thread_id,
      item.sender,
      item.subject,
      senderLabelForItem(item),
      threadContactKey(item.thread_id),
      normalizePhone(item.sender),
      normalizePhone(item.thread_id),
    ];
    return Array.from(new Set(keys.map(normalizeLookup).filter(Boolean)));
  };
  const lookupKeysForActivity = (r: NonNullable<typeof usageData>["recent"][number]) => {
    const keys = [
      r.thread_id,
      r.threadId,
      r.senderEmail,
      r.sender,
      r.contactName,
      r.subject,
      senderLabelForActivity(r),
      threadContactKey(r.thread_id ?? r.threadId),
      normalizePhone(r.senderEmail),
      normalizePhone(r.thread_id ?? r.threadId),
    ];
    return Array.from(new Set(keys.map(normalizeLookup).filter(Boolean)));
  };

  const textForActivity = (r: NonNullable<typeof usageData>["recent"][number]) =>
    (r.latestMessage ?? r.preview ?? "").trim();

  const activityThreadId = (r: NonNullable<typeof usageData>["recent"][number]) =>
    (
      (r.thread_id ?? r.threadId) ||
      cleanSenderLabel(r.senderEmail) ||
      cleanSenderLabel(r.sender) ||
      cleanSenderLabel(r.contactName) ||
      cleanSenderLabel(r.subject) ||
      ""
    ).trim();

  const activityRows = usageData?.recent ?? [];

  const senderLabelForActivity = (
    r: NonNullable<typeof usageData>["recent"][number],
    rows: NonNullable<typeof usageData>["recent"] = activityRows,
  ) => {
    const direct =
      cleanSenderLabel(r.senderEmail) ||
      cleanSenderLabel(r.sender) ||
      cleanSenderLabel(r.contactName) ||
      cleanSenderLabel(r.subject) ||
      senderFromThreadId(r.thread_id ?? r.threadId);
    if (direct) return direct;

    const currentAt = r.createdAt ? new Date(r.createdAt).getTime() : 0;
    const neighbor = rows
      .map((candidate) => ({
        label:
          cleanSenderLabel(candidate.senderEmail) ||
          cleanSenderLabel(candidate.sender) ||
          cleanSenderLabel(candidate.contactName) ||
          cleanSenderLabel(candidate.subject) ||
          senderFromThreadId(candidate.thread_id ?? candidate.threadId),
        distance: Math.abs(new Date(candidate.createdAt).getTime() - currentAt),
      }))
      .filter((candidate) => candidate.label && candidate.distance <= 2 * 60 * 1000)
      .sort((a, b) => a.distance - b.distance)[0];
    return neighbor?.label ?? "";
  };

  const isFlaggedActivity = (r: NonNullable<typeof usageData>["recent"][number]) => {
    const decision = (r.decision ?? "").toLowerCase();
    return decision.includes("flagged") || decision.includes("review");
  };

  // Build a multi-key lookup from the Activity feed so flagged cards can be
  // refreshed by exact thread id, contact name, sender label, or phone number.
  // Some WhatsApp rows expose names while others expose phone/thread ids; a
  // sender-only map was why Dominique updated while other cards stayed stale.
  const enrichedByKey = (() => {
    const map = new Map<string, { text: string; createdAt: number; flagged: boolean }>();
    for (const r of activityRows) {
      const text = textForActivity(r);
      if (!text) continue;
      const createdAt = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      const flagged = isFlaggedActivity(r);
      for (const key of lookupKeysForActivity(r)) {
        const existing = map.get(key);
        if (!existing) {
          map.set(key, { text, createdAt, flagged });
          continue;
        }
        const existingIsStub = isVoiceStub(existing.text);
        const candidateIsStub = isVoiceStub(text);
        // Prefer real Activity transcripts over voice stubs, then panel-owned
        // review/flagged rows, then newest entry. Activity uses "review" for
        // these pills, while the old flagged endpoint often stays stale.
        if (existingIsStub && !candidateIsStub) {
          map.set(key, { text, createdAt, flagged });
        } else if (existingIsStub === candidateIsStub && flagged && !existing.flagged) {
          map.set(key, { text, createdAt, flagged });
        } else if (existingIsStub === candidateIsStub && flagged === existing.flagged && createdAt > existing.createdAt) {
          map.set(key, { text, createdAt, flagged });
        }
      }
    }
    return map;
  })();

  function isVoiceStub(text: string | null | undefined) {
    const t = (text ?? "").trim();
    if (!t) return true;
    return /^\[voice message[^\]]*\]\s*(\d+×|x\d+)?\s*$/i.test(t);
  }

  const activityCandidateFor = (item: FlaggedMessage) =>
    lookupKeysForFlagged(item)
      .map((key) => enrichedByKey.get(key))
      .filter((c): c is { text: string; createdAt: number; flagged: boolean } => Boolean(c))
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  const enrichedMessageFor = (item: FlaggedMessage): string | null => {
    const current = (item.latest_message ?? item.preview ?? "").trim();
    const candidate = activityCandidateFor(item);
    if (!candidate) return null;
    // Always replace voice-message stubs with a real transcript when we have one.
    if (isVoiceStub(current) && !isVoiceStub(candidate.text)) {
      return candidate.text;
    }

    // The Activity endpoint is the reliable stream; if it has a different real
    // latest message for this flagged contact/thread, let it win immediately.
    if (!isVoiceStub(candidate.text) && candidate.text !== current) {
      return candidate.text;
    }

    return null;
  };

  const withActivityPreview = (item: FlaggedMessage): FlaggedMessage => {
    const enriched = enrichedMessageFor(item);
    const activityCreatedAt = activityCandidateFor(item)?.createdAt ?? 0;
    if (!enriched && !activityCreatedAt) return item;
    return {
      ...item,
      preview: enriched ?? item.preview,
      latest_message: enriched ?? item.latest_message,
      updated_at: activityCreatedAt
        ? new Date(Math.max(new Date(item.updated_at).getTime(), activityCreatedAt)).toISOString()
        : item.updated_at,
    };
  };

  const [folders, setFolders] = useState<FolderDef[]>(() => loadFolders());
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    loadAssignments(),
  );
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(loadDismissed()));
  const [activeItem, setActiveItem] = useState<FlaggedMessage | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const draftsRef = useRef<Record<string, DraftState>>({});
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);


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

      updateDraft(id, {
        loading: false,
        draft: String(draft),
        error: null,
        draftId,
        phase: "sent",
        sentAt: new Date().toISOString(),
      });

      // ── Push confirmed booking to Google Calendar ──
      const isScheduling = needsCalendarContext(item, incomingMessage, userInstruction);
      if (isScheduling && looksLikeConfirmation(String(draft))) {
        const extracted = extractDateTime(
          String(draft),
          userInstruction,
          item.subject,
        );
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
        const title =
          item.subject?.trim() ||
          (item.sender ? `Appointment with ${item.sender}` : "Appointment");

        const eventRow: Record<string, unknown> = {
          source_type: "whatsapp",
          source_event_id: item.thread_id,
          thread_id: item.thread_id,
          contact_name: item.sender ?? null,
          contact_channel: item.provider ?? null,
          title,
          description: (item.preview ?? item.latest_message ?? null) as string | null,
          start_time: extracted?.date.toISOString() ?? null,
          timezone: extracted ? tz : null,
          status: "confirmed",
          imported_at: new Date().toISOString(),
        };

        try {
          const { data: userData } = await supabase.auth.getUser();
          if (userData.user) {
            eventRow.user_id = userData.user.id;

            const { data: inserted, error: insErr } = await supabase
              .from("agenda_events")
              .upsert(eventRow as never, {
                onConflict: "user_id,source_type,source_event_id",
                ignoreDuplicates: false,
              })
              .select("id")
              .single();

            if (insErr) throw insErr;

            if (inserted?.id && extracted) {
              const { data: pushData, error: pushErr } =
                await supabase.functions.invoke("google-calendar-push", {
                  body: { agenda_event_id: inserted.id, action: "upsert" },
                });
              const errCode =
                (pushData as { error?: string } | null)?.error;
              if (pushErr || errCode) {
                console.warn(
                  "[flagged] calendar push failed after draft",
                  pushErr ?? errCode,
                );
                toast({
                  title: extracted
                    ? "Saved to agenda (Google sync skipped)"
                    : "Added to agenda",
                  description:
                    errCode === "not_connected"
                      ? "Connect Google Calendar to sync."
                      : "Calendar event saved locally.",
                });
              } else {
                toast({
                  title: "Confirmed & synced to Google Calendar",
                  description: `${title} added to your calendar.`,
                });
              }
            } else if (inserted?.id) {
              toast({
                title: "Added to agenda (needs time)",
                description: `${title} — set a time in the Agenda panel to sync to Google.`,
              });
            }
          }
        } catch (e) {
          console.warn("[flagged] failed to push booking to calendar", e);
          toast({
            title: "Reply sent, calendar update skipped",
            description:
              (e as Error)?.message?.slice(0, 120) ??
              "Could not update calendar.",
            variant: "destructive",
          });
        }
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
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(dismissed)));
    } catch {
      /* ignore */
    }
  }, [dismissed]);

  const dismissKeysFor = (m: FlaggedMessage): string[] => {
    const keys = [m.thread_id];
    const sk = normalizeLookup(m.sender ?? "");
    if (sk) keys.push(`sender:${sk}`);
    return keys;
  };
  const isDismissed = (m: FlaggedMessage) => dismissKeysFor(m).some((k) => dismissed.has(k));
  const dismissItem = (m: FlaggedMessage) => {
    const keys = dismissKeysFor(m);
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  };

  const flaggedFromList: FlaggedMessage[] = (data ?? []).map(withActivityPreview);
  const activityGroups = new Map<string, FlaggedMessage>();
  for (const [index, r] of activityRows.filter(isFlaggedActivity).entries()) {
    const text = textForActivity(r);
    const realThreadId = activityThreadId(r);
    const sender = senderLabelForActivity(r) || senderFromThreadId(realThreadId);
    if (!sender) continue;
    const fallbackId = realThreadId || `activity:${r.createdAt}:${index}`;
    const groupKey = normalizeLookup(sender || fallbackId) || fallbackId;
    const existing = activityGroups.get(groupKey);
    const existingText = existing?.latest_message ?? existing?.preview ?? "";
    const useText =
      !existing ||
      !existingText ||
      Boolean(text && !isVoiceStub(text) && (isVoiceStub(existingText) || text !== existingText));
    const createdAt = new Date(r.createdAt).getTime();
    const existingAt = existing ? new Date(existing.updated_at).getTime() : 0;
    if (!existing || useText || createdAt > existingAt) {
      activityGroups.set(groupKey, {
        thread_id: existing?.thread_id ?? fallbackId,
        provider: "whatsapp",
        sender,
        subject: cleanSenderLabel(r.subject) || existing?.subject || null,
        preview: useText ? text || r.preview : existing.preview,
        latest_message: useText ? text || r.latestMessage : existing.latest_message,
        intent_category: "misc",
        intent_confidence: 1,
        intent_reason: "Needs review from the Activity stream.",
        intent_source: "activity",
        intent_classified_at: r.createdAt,
        updated_at: r.createdAt,
        thread_url: null,
      });
    }
  }
  const flaggedFromActivity: FlaggedMessage[] = Array.from(activityGroups.values()).map(withActivityPreview);
  const all: FlaggedMessage[] = [...flaggedFromList, ...flaggedFromActivity];
  const recencyOf = (m: FlaggedMessage) => {
    const candidates = [m.intent_classified_at, m.updated_at].filter(Boolean) as string[];
    return Math.max(...candidates.map((s) => new Date(s).getTime()));
  };
  const sorted = [...all].sort((a, b) => recencyOf(b) - recencyOf(a));
  // One pill per sender. Newest message wins (sorted desc); older messages from
  // the same sender become a backlog count surfaced on the pill.
  const groups = new Map<
    string,
    FlaggedMessage & {
      backlog_count?: number;
      backlog_items?: FlaggedMessage[];
      _seen?: Set<string>;
    }
  >();
  const messageFingerprint = (m: FlaggedMessage) => {
    const text = (m.latest_message ?? m.preview ?? m.subject ?? "").trim().toLowerCase();
    // Round timestamps to the nearest minute so the same message arriving from
    // both the flagged-list and activity sources is treated as one.
    const ts = m.updated_at ? Math.floor(new Date(m.updated_at).getTime() / 60000) : 0;
    return `${ts}|${text}`;
  };
  for (const m of sorted) {
    if (isDismissed(m)) continue;
    const senderKey = normalizeLookup(senderLabelForItem(m) || m.sender || "");
    const key = senderKey || m.thread_id;
    const fp = messageFingerprint(m);
    const existing = groups.get(key);
    if (!existing) {
      const seen = new Set<string>();
      seen.add(fp);
      groups.set(key, { ...m, backlog_count: 0, backlog_items: [], _seen: seen });
    } else {
      if (existing._seen?.has(fp)) continue; // duplicate of an already-tracked message
      existing._seen?.add(fp);
      existing.backlog_count = (existing.backlog_count ?? 0) + 1;
      existing.backlog_items = [...(existing.backlog_items ?? []), m];
    }
  }
  const deduped: FlaggedMessage[] = Array.from(groups.values());

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
    if (typeof overId === "string" && activeItem) {
      if (overId === TRASH_DROP_ID) {
        const item = activeItem;
        dismissItem(item);
        toast({
          title: "Flagged message deleted",
          description: `${item.sender ?? "Thread"} removed from review.`,
          action: (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDismissed((prev) => {
                  const next = new Set(prev);
                  for (const k of dismissKeysFor(item)) next.delete(k);
                  return next;
                })
              }
            >
              Undo
            </Button>
          ),
        });
      } else if (overId.startsWith(FOLDER_DROP_PREFIX)) {
        const folderId = overId.slice(FOLDER_DROP_PREFIX.length);
        moveToFolder(activeItem.thread_id, folderId);
      }
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

        {(deduped.length > 0 || activeItem) && (
          <TrashDropZone isAnyDragging={activeItem !== null} />
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
