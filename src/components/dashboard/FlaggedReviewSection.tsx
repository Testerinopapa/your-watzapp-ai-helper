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

const DRAG_MIME = "application/x-flagged-thread-id";
const GROUP_STORAGE_KEY = "flagged.groupedThreadIds.v1";

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

type FlaggedCardProps = {
  item: FlaggedMessage;
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  trailing?: React.ReactNode;
};

function FlaggedCard({ item, draggable, onDragStart, onDragEnd, trailing }: FlaggedCardProps) {
  const tone = toneFor(item.updated_at);
  const styles = toneStyles[tone];
  const age = formatDistanceToNow(new Date(item.updated_at), { addSuffix: true });

  return (
    <Card
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData(DRAG_MIME, item.thread_id);
        e.dataTransfer.setData("text/plain", item.thread_id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(item.thread_id);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={cn(
        "border-l-4 transition-all hover:border-primary/40",
        draggable && "cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(45,212,168,0.45)]",
        styles.border,
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

export default function FlaggedReviewSection() {
  const { user } = useAuth();
  const { data, isLoading, isFetching, error, refetch } = useFlaggedMessages(20);

  const [groupedIds, setGroupedIds] = useState<string[]>(() => loadGrouped());
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [isOverFolder, setIsOverFolder] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(groupedIds));
    } catch {
      // ignore quota errors
    }
  }, [groupedIds]);

  // Realtime: re-fetch whenever thread_states changes for this user.
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

  const handleFolderDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!isOverFolder) setIsOverFolder(true);
    }
  };
  const handleFolderDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (id) {
      e.preventDefault();
      addToGroup(id);
    }
    setIsOverFolder(false);
    setIsDraggingCard(false);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Flag size={18} className="text-primary" />
        <h2 className="text-xl font-semibold">Flagged messages</h2>
        {!isLoading && (
          <Badge variant="secondary" className="ml-1">
            {items.length}
          </Badge>
        )}

        {/* Folder drop zone */}
        <button
          type="button"
          onClick={() => setFolderOpen(true)}
          onDragOver={handleFolderDragOver}
          onDragEnter={handleFolderDragOver}
          onDragLeave={() => setIsOverFolder(false)}
          onDrop={handleFolderDrop}
          aria-label={`Open group (${groupedItems.length})`}
          className={cn(
            "ml-2 group relative inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all",
            "border-[rgba(45,212,168,0.35)] bg-[rgba(15,23,42,0.6)] text-foreground",
            "hover:border-[rgba(115,255,184,0.6)] hover:shadow-[0_0_18px_rgba(115,255,184,0.25)]",
            isDraggingCard && "ring-2 ring-[rgba(45,212,168,0.45)] ring-offset-0",
            isOverFolder && "scale-[1.06] border-[rgba(115,255,184,0.9)] shadow-[0_0_28px_rgba(115,255,184,0.55)] bg-[rgba(45,212,168,0.12)]",
          )}
        >
          {isOverFolder ? (
            <FolderOpen size={14} className="text-[#73ffb8]" />
          ) : (
            <Folder size={14} className="text-[#2dd4a8]" />
          )}
          <span>Group</span>
          {groupedItems.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[#2dd4a8] text-[10px] font-bold text-[#0a0a1a] px-1">
              {groupedItems.length}
            </span>
          )}
        </button>

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
                <FlaggedCard
                  key={item.thread_id}
                  item={item}
                  draggable
                  onDragStart={() => setIsDraggingCard(true)}
                  onDragEnd={() => {
                    setIsDraggingCard(false);
                    setIsOverFolder(false);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Fade overlay so cards softly disappear behind the divider */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-xl"
            style={{
              background:
                "linear-gradient(to bottom, hsl(var(--background) / 0) 0%, hsl(var(--background) / 0.7) 55%, hsl(var(--background) / 0.95) 100%)",
            }}
          />
          {/* Neon mint hairline divider */}
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

      {/* Grouped view dialog */}
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
                <FlaggedCard
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
  );
}
