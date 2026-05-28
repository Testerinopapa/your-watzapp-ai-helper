import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle, Clock, Check, Loader2 } from "lucide-react";
import type { FlaggedEmail } from "@/hooks/useFlaggedEmails";
import { useResolveFlagged } from "@/hooks/useResolveFlagged";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const dtf = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ageInfo(createdAt: string) {
  const created = new Date(createdAt).getTime();
  const diffMs = Date.now() - created;
  const hours = diffMs / 3_600_000;
  const days = hours / 24;

  let label: string;
  if (hours < 1) {
    const mins = Math.max(1, Math.round(diffMs / 60_000));
    label = rtf.format(-mins, "minute");
  } else if (hours < 24) {
    label = rtf.format(-Math.round(hours), "hour");
  } else {
    label = rtf.format(-Math.round(days), "day");
  }

  let tone: "fresh" | "warn" | "stale";
  let badgeClass: string;
  let borderClass: string;

  if (days > 3) {
    tone = "stale";
    badgeClass = "bg-destructive/10 text-destructive border-destructive/20";
    borderClass = "border-l-destructive";
  } else if (days >= 1) {
    tone = "warn";
    badgeClass = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    borderClass = "border-l-amber-500";
  } else {
    tone = "fresh";
    badgeClass = "bg-secondary text-secondary-foreground border-transparent";
    borderClass = "border-l-border";
  }

  return { label, tone, badgeClass, borderClass };
}

export default function FlaggedEmailCard({ email }: { email: FlaggedEmail }) {
  const { label, badgeClass, borderClass } = ageInfo(email.createdAt);
  const displayName = email.senderName?.trim() || email.senderEmail;
  const resolve = useResolveFlagged();
  const { toast } = useToast();

  const handleResolve = () => {
    resolve.mutate({ id: email.id, threadId: email.threadId, provider: email.provider, resolution: "handled" }, {
      onSuccess: () => {
        toast({ title: "Marked as solved", description: "Removed from review queue." });
      },
      onError: (err) => {
        toast({
          title: "Couldn't mark as solved",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Card className={cn("border-l-4 transition-colors hover:border-primary/40", borderClass)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium truncate">
              <MessageCircle size={14} className="text-muted-foreground shrink-0" />
              <span className="truncate">{displayName}</span>
            </div>
            {email.senderName && (
              <p className="text-xs text-muted-foreground truncate">
                {email.senderEmail}
              </p>
            )}
          </div>
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              badgeClass,
            )}
          >
            <Clock size={11} />
            {label}
          </span>
        </div>

        <div className="space-y-1">
          <p className="font-semibold text-sm leading-snug line-clamp-1">
            {email.subject || "(no subject)"}
          </p>
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {email.snippet || email.reason || "Flagged for your review."}
          </p>
        </div>

        <div className="pt-1 border-t border-border/50 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            Received {dtf.format(new Date(email.createdAt))}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={handleResolve}
            disabled={resolve.isPending}
          >
            {resolve.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}
            I replied
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
