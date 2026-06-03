import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ExternalLink,
  Sparkles,
  Loader2,
  Copy,
  Check,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import type { DraftState } from "@/lib/flagged-utils";

export default function DraftReplyFooter({
  item,
  enrichedMessage,
  state,
  onChange,
  onClose,
  onGenerate,
  onRetry,
  isAppointment = false,
}: {
  item: FlaggedMessage;
  enrichedMessage?: string | null;
  state: DraftState;
  onChange: (patch: Partial<DraftState>) => void;
  onClose: () => void;
  onGenerate: () => void;
  onRetry: () => void;
  isAppointment?: boolean;
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
  const canGenerate =
    hasIncoming && trimmedInstruction.length > 0 && !state.loading;
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
          onClick={() => {
            if (isAppointment && !state.instruction) {
              onChange({
                open: true,
                instruction:
                  "Check calendar, reply and update google calendar",
              });
            } else {
              onChange({ open: true });
            }
          }}
          className={cn(
            "h-7 gap-1.5 text-[11px]",
            isAppointment
              ? "text-amber-400 hover:text-amber-300 hover:bg-amber-400/8"
              : "text-[#2dd4a8] hover:text-[#73ffb8] hover:bg-[rgba(45,212,168,0.08)]",
          )}
        >
          <Sparkles size={12} />
          {isAppointment ? "Manage Appointment" : "Draft reply"}
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
          {isAppointment
            ? "Appointment instructions"
            : "How should we reply?"}
        </label>
        <Textarea
          id={`draft-instr-${item.thread_id}`}
          value={state.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
          placeholder={
            isAppointment
              ? "Check calendar, reply and update google calendar"
              : "e.g. Politely confirm and propose Tuesday at 10am."
          }
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
          className={cn(
            "h-7 gap-1.5 text-[11px]",
            isAppointment
              ? "bg-amber-500 text-black hover:bg-amber-400"
              : "bg-[#2dd4a8] text-[#0a0a1a] hover:bg-[#73ffb8]",
          )}
        >
          {state.loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          {state.loading
            ? "Generating…"
            : state.draft
              ? isAppointment
                ? "Regenerate & manage"
                : "Regenerate & send"
              : isAppointment
                ? "Manage Appointment"
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
          <p className="text-[11px] text-destructive flex-1">
            {state.error}
          </p>
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
                  ·{" "}
                  {formatDistanceToNow(new Date(state.sentAt), {
                    addSuffix: true,
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
