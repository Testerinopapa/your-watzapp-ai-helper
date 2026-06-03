import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarCheck,
  MessageCircle,
  Clock,
  LifeBuoy,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import {
  toneFor,
  toneStyles,
  senderLabelForItem,
  APPOINTMENT_CATEGORIES,
  SUPPORT_CATEGORIES,
} from "@/lib/flagged-utils";

export type FlaggedCardInnerProps = {
  item: FlaggedMessage;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  footer?: React.ReactNode;
  elevated?: boolean;
};

export default function FlaggedCardInner({
  item,
  trailing,
  leading,
  footer,
  elevated,
}: FlaggedCardInnerProps) {
  const isAppt = APPOINTMENT_CATEGORIES.has(
    (item.intent_category ?? "").toLowerCase().trim(),
  );
  const isSupport = SUPPORT_CATEGORIES.has(
    (item.intent_category ?? "").toLowerCase().trim(),
  );
  const tone = toneFor(item.updated_at);
  const styles = toneStyles[tone];
  const age = formatDistanceToNow(new Date(item.updated_at), {
    addSuffix: true,
  });
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
        isSupport
          ? "border-l-[#3b82f6] bg-[#0a0a1a]/95 ring-1 ring-blue-500/20 shadow-[0_8px_30px_-12px_rgba(59,130,246,0.25)]"
          : isAppt
            ? "border-l-[#f59e0b] bg-[#0a0a1a]/95 ring-1 ring-amber-500/20 shadow-[0_8px_30px_-12px_rgba(245,158,11,0.25)]"
            : styles.border,
        elevated &&
          !isAppt &&
          !isSupport &&
          "border-l-[#2dd4a8] bg-[#0a0a1a]/95 ring-1 ring-[rgba(115,255,184,0.55)] shadow-[0_20px_50px_-15px_rgba(45,212,168,0.55)]",
        elevated &&
          isSupport &&
          "border-l-[#3b82f6] ring-1 ring-blue-500/40 shadow-[0_20px_50px_-15px_rgba(59,130,246,0.55)]",
        elevated &&
          isAppt &&
          "border-l-[#f59e0b] ring-1 ring-amber-500/40 shadow-[0_20px_50px_-15px_rgba(245,158,11,0.55)]",
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 flex items-start gap-2">
            {leading}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                {isSupport ? (
                  <LifeBuoy
                    size={14}
                    className="text-blue-400 shrink-0"
                  />
                ) : isAppt ? (
                  <CalendarCheck
                    size={14}
                    className="text-amber-400 shrink-0"
                  />
                ) : (
                  <MessageCircle
                    size={14}
                    className="text-muted-foreground shrink-0"
                  />
                )}
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
                isSupport
                  ? "bg-blue-400/10 text-blue-400 border-blue-400/20"
                  : isAppt
                    ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
                    : styles.badge,
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
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] uppercase tracking-wide",
                isSupport &&
                  "border-blue-400/30 text-blue-400 bg-blue-400/5",
                isAppt &&
                  "border-amber-400/30 text-amber-400 bg-amber-400/5",
              )}
            >
              {item.intent_category}
            </Badge>
          )}
          {(item.latest_message || item.preview || item.subject) && (
            <p
              className="text-xs text-foreground/90 line-clamp-3 whitespace-pre-wrap leading-relaxed"
              title={
                item.latest_message ??
                item.preview ??
                item.subject ??
                undefined
              }
            >
              "{item.latest_message ?? item.preview ?? item.subject}"
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
              const text =
                m.latest_message ?? m.preview ?? m.subject ?? "";
              const when = m.updated_at
                ? formatDistanceToNow(new Date(m.updated_at), {
                    addSuffix: true,
                  })
                : "";
              return (
                <div
                  key={`${m.thread_id}-${idx}`}
                  className="rounded-md border border-border bg-muted/30 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {idx === 0
                        ? "Latest"
                        : `#${allMessages.length - idx}`}
                    </span>
                    <span>{when}</span>
                  </div>
                  {text ? (
                    <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {text}
                    </p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">
                      No preview available.
                    </p>
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
