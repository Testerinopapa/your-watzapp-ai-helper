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
  Info,
  ChevronDown,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import {
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

// ── Helpers ──────────────────────────────────────────────────────────
const PHONE_RE = /[+\d][\s\d\-+()]{6,}$/;

function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return raw;
  const last = digits.slice(-4);
  const cc = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : "";
  return `${cc}••• ••• ${last}`;
}

function presentSender(raw: string): { label: string; isUnknown: boolean } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { label: "Unrecognized contact", isUnknown: true };
  // If sender is essentially a phone number, mask it.
  if (PHONE_RE.test(trimmed) && !/[A-Za-zÀ-ÿ]/.test(trimmed)) {
    return { label: maskPhone(trimmed), isUnknown: false };
  }
  // Strip trailing phone embedded after a name ("Emma +447…")
  const stripped = trimmed.replace(/[\s]*[+\d][\s\d\-+()]{6,}$/, "").trim();
  return { label: stripped || trimmed, isUnknown: false };
}

function humanIntentTitle(item: FlaggedMessage): string {
  const cat = (item.intent_category ?? "").toLowerCase();
  const sub = (item.intent_subcategory ?? "").toLowerCase();
  const blob = `${cat} ${sub}`;
  if (APPOINTMENT_CATEGORIES.has(cat) || /appointment|booking|reservation/.test(blob)) {
    if (/reschedul/.test(blob)) return "Reschedule request";
    if (/cancel/.test(blob)) return "Cancellation request";
    if (/confirm/.test(blob)) return "Appointment confirmation";
    return "New appointment request";
  }
  if (COMPLAINT_CATEGORIES.has(cat) || /complaint|refund|negative/.test(blob)) {
    if (/refund/.test(blob)) return "Refund request";
    return "Complaint";
  }
  if (SUPPORT_CATEGORIES.has(cat) || /support|help|faq|question|inquiry/.test(blob)) {
    return "Support question";
  }
  const fallback = item.intent_subcategory || item.intent_category;
  if (!fallback) return "New message";
  return fallback
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortSummary(item: FlaggedMessage): string | null {
  const candidates = [
    item.customer_goal,
    item.business_action,
    item.intent_review_reason,
    item.intent_reason,
  ];
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t) return t.length > 140 ? `${t.slice(0, 137)}…` : t;
  }
  // Last resort: latest message, stripped, single line.
  const msg = (item.latest_message ?? item.preview ?? item.subject ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!msg) return null;
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

export default function FlaggedCardInner({
  item,
  trailing,
  leading,
  footer,
  elevated,
  supportDocLabel,
}: FlaggedCardInnerProps) {
  const cat = (item.intent_category ?? "").toLowerCase().trim();
  const isAppt = APPOINTMENT_CATEGORIES.has(cat);
  const isSupport = SUPPORT_CATEGORIES.has(cat);
  const isComplaint = COMPLAINT_CATEGORIES.has(cat);
  const tone = toneFor(item.updated_at);
  const age = formatDistanceToNow(new Date(item.updated_at), { addSuffix: true });

  const rawSender = senderLabelForItem(item);
  const { label: senderLabel, isUnknown } = presentSender(rawSender);

  const itemWithBacklog = item as FlaggedMessage & {
    backlog_count?: number;
    backlog_items?: FlaggedMessage[];
  };
  const backlogItems = itemWithBacklog.backlog_items ?? [];
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const allMessages = [item, ...backlogItems];

  const lastIngestMs = Math.max(
    item.snapshot_captured_at ? +new Date(item.snapshot_captured_at) : 0,
    item.scan_captured_at ? +new Date(item.scan_captured_at) : 0,
  );
  const classifiedMs = item.intent_classified_at
    ? +new Date(item.intent_classified_at)
    : 0;
  const classifying = lastIngestMs > 0 && classifiedMs < lastIngestMs;

  const title = humanIntentTitle(item);
  const summary = shortSummary(item);
  const urgency = (item.intent_urgency ?? "").toLowerCase();

  // Accent classes — calm, single accent per type, no neon glow.
  const accent = isComplaint
    ? "border-l-red-500/70"
    : isAppt
      ? "border-l-amber-400/70"
      : isSupport
        ? "border-l-sky-400/70"
        : "border-l-emerald-400/60";

  const Icon = isComplaint
    ? AlertTriangle
    : isSupport
      ? LifeBuoy
      : isAppt
        ? CalendarCheck
        : MessageCircle;

  const iconColor = isComplaint
    ? "text-red-400"
    : isSupport
      ? "text-sky-400"
      : isAppt
        ? "text-amber-400"
        : "text-emerald-400";

  return (
    <Card
      data-thread-id={item.thread_id}
      data-customer-name={senderLabel.replace(/[\s]*[+\d][\s\d\-+()]{6,}$/, "").trim()}
      className={cn(
        "border-l-4 border border-border/60 bg-card/95 transition-colors",
        accent,
        elevated && "ring-1 ring-border shadow-md",
      )}
    >
      <CardContent className="p-5 space-y-3">
        {/* Top row: avatar + name + time */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 flex items-center gap-3">
            {leading}
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60",
                iconColor,
              )}
            >
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "truncate text-sm font-medium",
                    isUnknown && "text-muted-foreground italic font-normal",
                  )}
                >
                  {senderLabel}
                </span>
                {classifying && (
                  <Loader2
                    size={11}
                    className="animate-spin text-muted-foreground/70 shrink-0"
                  />
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock size={10} />
                <span>{age}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetailsOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="rounded-full p-1 text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="View details"
              title="View details"
            >
              <Info size={14} />
            </button>
            {trailing}
          </div>
        </div>

        {/* Middle: human-readable title + short summary */}
        <div className="space-y-1.5 pl-12">
          <h3 className="text-[15px] font-semibold leading-tight text-foreground">
            {title}
          </h3>
          {summary && (
            <p className="text-[13px] text-muted-foreground line-clamp-2 leading-snug">
              {summary}
            </p>
          )}
        </div>

        {/* Bottom: primary action */}
        {footer && <div className="pl-12 pt-1">{footer}</div>}
      </CardContent>

      {/* Details / Debug dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon size={16} className={iconColor} />
              <span>{senderLabel}</span>
              <Badge variant="secondary" className="ml-1 text-[10px] font-normal">
                {title}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {supportDocLabel && (
              <div className="flex items-center gap-2 text-xs text-sky-400">
                <FileText size={12} />
                <span>{supportDocLabel}</span>
              </div>
            )}

            {item.customer_goal && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Customer goal
                </div>
                <p className="text-[13px] text-foreground/90">{item.customer_goal}</p>
              </div>
            )}

            {item.business_action && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Next action
                </div>
                <p className="text-[13px] text-foreground/90">{item.business_action}</p>
              </div>
            )}

            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Recent messages
                <span className="ml-2 text-muted-foreground/60">
                  {allMessages.length} total
                </span>
              </div>
              <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-1">
                {allMessages.map((m, idx) => {
                  const text = m.latest_message ?? m.preview ?? m.subject ?? "";
                  const when = m.updated_at
                    ? formatDistanceToNow(new Date(m.updated_at), { addSuffix: true })
                    : "";
                  return (
                    <div
                      key={`${m.thread_id}-${idx}`}
                      className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1"
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
                        <p className="text-xs italic text-muted-foreground">
                          No preview available.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Debug details — collapsed */}
            <div className="border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => setDebugOpen((o) => !o)}
                className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  size={12}
                  className={cn("transition-transform", debugOpen && "rotate-180")}
                />
                Debug details
              </button>
              {debugOpen && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono text-muted-foreground">
                  <div>category</div>
                  <div className="text-foreground/80 truncate">{item.intent_category || "—"}</div>
                  <div>subcategory</div>
                  <div className="text-foreground/80 truncate">{item.intent_subcategory || "—"}</div>
                  <div>confidence</div>
                  <div className="text-foreground/80">
                    {typeof item.intent_confidence === "number"
                      ? `${Math.round(item.intent_confidence * 100)}%`
                      : "—"}
                  </div>
                  <div>urgency</div>
                  <div className="text-foreground/80">{urgency || "—"}</div>
                  <div>source</div>
                  <div className="text-foreground/80 truncate">{item.intent_source || "—"}</div>
                  <div>thread_id</div>
                  <div className="text-foreground/80 truncate" title={item.thread_id}>
                    {item.thread_id}
                  </div>
                  {item.intent_reason && (
                    <>
                      <div>reason</div>
                      <div className="text-foreground/80 col-span-1 break-words">
                        {item.intent_reason}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
