import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Flag,
  MessageCircle,
  Clock,
  RefreshCw,
  FolderOpen,
  Folder,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  useFlaggedMessages,
  getFlaggedRealtimeClient,
  type FlaggedMessage,
} from "@/hooks/useFlaggedMessages";
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

const GROUP_STORAGE_KEY = "flagged.groupedThreadIds.v1";
const FOLDER_DROPPABLE_ID = "flagged-folder-drop";

const loadGrouped = (): string[] => {
  try {
    const raw = localStorage.getItem(GROUP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

type FlaggedCardContentProps = {
  item: FlaggedMessage;
  trailing?: React.ReactNode;
  elevated?: boolean;
};

function FlaggedCardInner({ item, trailing, elevated }: FlaggedCardContentProps) {
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
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium truncate">
              <MessageCircle size={14} className="text-muted-foreground shrink-0" />
              <span className="truncate">{item.sender ?? "Unknown sender"}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate">{item.provider}</p>
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
              {typeof item.intent_confidence === "number" &&
                ` · ${Math.round(item.intent_confidence * 100)}%`}
            </Badge>
          )}
          {item.intent_reason && (
            <p className="text-[11px] text-muted-foreground/80 italic line-clamp-3 pt-1">
              {item.intent_reason}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DraggableFlaggedCard({ item }: { item: FlaggedMessage }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.thread_id,
    data: { item },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "touch-none cursor-grab active:cursor-grabbing transition-all",
        "hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(45,212,168,0.45)]",
        isDragging && "opacity-40",
      )}
    >
      <FlaggedCardInner item={item} />
    </div>
  );
}

function FolderDropZone({
  count,
  onOpen,
  isAnyDragging,
}: {
  count: number;
  onOpen: () => void;
  isAnyDragging: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: FOLDER_DROPPABLE_ID });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      aria-label={`Open group (${count})`}
      className={cn(
        "ml-2 group relative inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all",
        "border-[rgba(45,212,168,0.35)] bg-[rgba(15,23,42,0.6)] text-foreground",
        "hover:border-[rgba(115,255,184,0.6)] hover:shadow-[0_0_18px_rgba(115,255,184,0.25)]",
        isAnyDragging && "ring-2 ring-[rgba(45,212,168,0.45)]",
        isOver &&
          "scale-[1.06] border-[rgba(115,255,184,0.9)] shadow-[0_0_28px_rgba(115,255,184,0.55)] bg-[rgba(45,212,168,0.12)]",
      )}
    >
      {isOver ? (
        <FolderOpen size={14} className="text-[#73ffb8]" />
      ) : (
        <Folder size={14} className="text-[#2dd4a8]" />
      )}
      <span>Group</span>
      {count > 0 && (
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[#2dd4a8] text-[10px] font-bold text-[#0a0a1a] px-1">
          {count}
        </span>
      )}
    </button>
  );
}

export default function FlaggedReviewSection() {
  const { user } = useAuth();
  const { data, isLoading, isFetching, error, refetch } = useFlaggedMessages(20);

  const [groupedIds, setGroupedIds] = useState<string[]>(() => loadGrouped());
  const [activeItem, setActiveItem] = useState<FlaggedMessage | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(groupedIds));
    } catch {
      // ignore
    }
  }, [groupedIds]);

  useEffect(() => {
    if (!user?.id) return;
    const client = getFlaggedRealtimeClient();
    const channel = client
      .channel(`flagged-thread-states-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "thread_states",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          refetch();
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [user?.id, refetch]);

  const all: FlaggedMessage[] = data ?? [];
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

  const groupedSet = useMemo(() => new Set(groupedIds), [groupedIds]);
  const items = deduped.filter((m) => !groupedSet.has(m.thread_id));
  const groupedItems = deduped.filter((m) => groupedSet.has(m.thread_id));

  const addToGroup = (threadId: string) => {
    setGroupedIds((prev) => (prev.includes(threadId) ? prev : [...prev, threadId]));
  };
  const removeFromGroup = (threadId: string) => {
    setGroupedIds((prev) => prev.filter((id) => id !== threadId));
  };

  const handleDragStart = (e: DragStartEvent) => {
    const item = (e.active.data.current as { item?: FlaggedMessage } | undefined)?.item;
    if (item) setActiveItem(item);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    if (e.over?.id === FOLDER_DROPPABLE_ID && activeItem) {
      addToGroup(activeItem.thread_id);
    }
    setActiveItem(null);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveItem(null)}
    >
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Flag size={18} className="text-primary" />
          <h2 className="text-xl font-semibold">Flagged messages</h2>
          {!isLoading && (
            <Badge variant="secondary" className="ml-1">
              {items.length}
            </Badge>
          )}

          <FolderDropZone
            count={groupedItems.length}
            onOpen={() => setFolderOpen(true)}
            isAnyDragging={activeItem !== null}
          />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="ml-auto gap-1.5"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

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
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {groupedItems.length > 0
              ? "All flagged threads are in your group."
              : "No flagged threads"}
          </p>
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
                {items.map((item) => (
                  <DraggableFlaggedCard key={item.thread_id} item={item} />
                ))}
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

        <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderOpen size={18} className="text-[#2dd4a8]" />
                Grouped flagged messages
                <Badge variant="secondary">{groupedItems.length}</Badge>
              </DialogTitle>
            </DialogHeader>

            {groupedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Drag flagged cards onto the Group button to collect them here.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {groupedItems.map((item) => (
                  <FlaggedCardInner
                    key={item.thread_id}
                    item={item}
                    trailing={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeFromGroup(item.thread_id)}
                        aria-label="Remove from group"
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
