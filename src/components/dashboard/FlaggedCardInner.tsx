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
  FileText,
  AlertTriangle,
  Loader2,
  Target,
  Zap,
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
  COMPLAINT_CATEGORIES,
} from "@/lib/flagged-utils";

export type FlaggedCardInnerProps = {
  item: FlaggedMessage;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  footer?: React.ReactNode;
  elevated?: boolean;
  supportDocLabel?: string | null;
};

export default function FlaggedCardInner({
  item,
  trailing,
  leading,
  footer,
  elevated,
  supportDocLabel,
}: FlaggedCardInnerProps) {
  const isAppt = APPOINTMENT_CATEGORIES.has(
    (item.intent_category ?? "").toLowerCase().trim(),
  );
  const isSupport = SUPPORT_CATEGORIES.has(
    (item.intent_category ?? "").toLowerCase().trim(),
  );
  const isComplaint = COMPLAINT_CATEGORIES.has(
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

  // "Analyzing conversation…" hint: a newer snapshot/scan landed but
  // classify-intent hasn't written intent_classified_at yet.
  const lastIngestMs = Math.max(
    item.snapshot_captured_at ? +new Date(item.snapshot_captured_at) : 0,
    item.scan_captured_at ? +new Date(item.scan_captured_at) : 0,
  );
  const classifiedMs = item.intent_classified_at
    ? +new Date(item.intent_classified_at)
    : 0;
  const classifying = lastIngestMs > 0 && classifiedMs < lastIngestMs;

  const urgency = (item.intent_urgency ?? "").toLowerCase();
  const urgencyStyle =
    urgency === "high"
      ? "bg-red-400/10 text-red-400 border-red-400/20"
      : urgency === "medium"
        ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
        : urgency === "low"
          ? "bg-muted text-muted-foreground border-border"
          : null;

  const intentLabel = item.intent_subcategory || item.intent_category;

  return (
    <Card
      data-thread-id={item.thread_id}
      data-customer-name={senderLabel.replace(/[\s]*[+\d][\s\d\-+()]{6,}$/, "").trim()}
      className={cn(
        "border-l-4 transition-colors",
        isComplaint &&
          tone === "fresh" &&
          "animate-pulse",
        isComplaint
          ? "border-l-[#ef4444] bg-[#0a0a1a]/95 ring-1 ring-red-500/20 shadow-[0_8px_30px_-12px_rgba(239,68,68,0.25)]"
          : isSupport
            ? "border-l-[#3b82f6] bg-[#0a0a1a]/95 ring-1 ring-blue-500/20 shadow-[0_8px_30px_-12px_rgba(59,130,246,0.25)]"
            : isAppt
              ? "border-l-[#f59e0b] bg-[#0a0a1a]/95 ring-1 ring-amber-500/20 shadow-[0_8px_30px_-12px_rgba(245,158,11,0.25)]"
              : styles.border,
        elevated &&
          !isAppt &&
          !isSupport &&
          !isComplaint &&
          "border-l-[#2dd4a8] bg-[#0a0a1a]/95 ring-1 ring-[rgba(115,255,184,0.55)] shadow-[0_20px_50px_-15px_rgba(45,212,168,0.55)]",
        elevated &&
          isComplaint &&
          "border-l-[#ef4444] ring-1 ring-red-500/40 shadow-[0_20px_50px_-15px_rgba(239,68,68,0.55)]",
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
                {isComplaint ? (
                  <AlertTriangle
                    size={14}
                    className="text-red-400 shrink-0"
                  />
                ) : isSupport ? (
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
            {isSupport && supportDocLabel && (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/30 bg-blue-400/5 px-1.5 py-0.5 text-[10px] text-blue-400 shrink-0 max-w-[120px]">
                <FileText size={10} />
                <span className="truncate">{supportDocLabel}</span>
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                isComplaint
                  ? "bg-red-400/10 text-red-400 border-red-400/20"
                  : isSupport
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
          <div className="flex items-center gap-1.5 flex-wrap">
            {intentLabel && (
              <Badge
                variant="outline"
                data-intent-badge=""
                className={cn(
                  "text-[10px] uppercase tracking-wide",
                  isComplaint &&
                    "border-red-400/30 text-red-400 bg-red-400/5",
                  isSupport &&
                    "border-blue-400/30 text-blue-400 bg-blue-400/5",
                  isAppt &&
                    "border-amber-400/30 text-amber-400 bg-amber-400/5",
                )}
              >
                {intentLabel}
              </Badge>
            )}
            {urgencyStyle && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  urgencyStyle,
                )}
                title={`Urgency: ${urgency}`}
              >
                <Zap size={9} />
                {urgency}
              </span>
            )}
            {typeof item.intent_confidence === "number" && item.intent_confidence > 0 && (
              <span className="text-[10px] text-muted-foreground/70">
                {Math.round(item.intent_confidence * 100)}% conf
              </span>
            )}
            {classifying && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground italic">
                <Loader2 size={10} className="animate-spin" />
                Analyzing conversation…
              </span>
            )}
          </div>
          {isComplaint && (() => {
            const cat = (item.intent_category ?? "").toLowerCase();
            let riskLabel = "";
            let riskColor = "border-red-400/20 bg-red-400/5 text-red-400";
            if (cat.includes("high_risk")) { riskLabel = "High risk"; }
            else if (cat.includes("medium_risk")) { riskLabel = "Medium risk"; riskColor = "border-orange-400/20 bg-orange-400/5 text-orange-400"; }
            else if (cat.includes("low_risk")) { riskLabel = "Low risk"; riskColor = "border-amber-400/20 bg-amber-400/5 text-amber-400"; }
            else if (cat.includes("refund")) { riskLabel = "Refund risk"; }
            else { riskLabel = "Needs attention"; riskColor = "border-red-400/15 bg-red-400/[0.03] text-red-400/80"; }
            return riskLabel ? (
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium", riskColor)}>
                <AlertTriangle size={9} />
                {riskLabel}
              </span>
            ) : null;
          })()}
          {isComplaint && item.intent_reason && (() => {
            const reason = (item.intent_reason ?? "").toLowerCase();
            let summary = "";
            if (/frustrated|angry|upset|irritated|annoyed/i.test(reason)) summary = "Customer seems frustrated";
            else if (/bad experience|disappointed|unhappy|terrible|awful|horrible|worst/i.test(reason)) summary = "Customer had a poor experience";
            else if (/refund|charge|billed|payment/i.test(reason)) summary = "Refund or payment concern";
            else summary = (item.intent_reason ?? "").slice(0, 80);
            return summary ? (
              <p className="text-[11px] text-red-300/70 italic">{summary}</p>
            ) : null;
          })()}
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
          {item.customer_goal && (
            <p className="text-[11px] text-foreground/80 pt-1 flex items-start gap-1">
              <Target size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span><span className="text-muted-foreground">Customer goal:</span> {item.customer_goal}</span>
            </p>
          )}
          {item.business_action && (
            <p className="text-[11px] text-foreground/80 flex items-start gap-1">
              <CalendarCheck size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span><span className="text-muted-foreground">Next action:</span> {item.business_action}</span>
            </p>
          )}
          {(item.intent_review_reason || item.intent_reason) && (
            <p className="text-[11px] text-muted-foreground/80 italic line-clamp-3 pt-1">
              {item.intent_review_reason ?? item.intent_reason}
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
