import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Flag, MessageCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useFlaggedMessages, type FlaggedMessage } from "@/hooks/useFlaggedMessages";

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

const truncate = (s: string | null, n = 160) =>
  !s ? "" : s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

export default function FlaggedReviewSection() {
  const { data, isLoading, error } = useFlaggedMessages(20);
  const items: FlaggedMessage[] = data ?? [];

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
          No messages need review right now.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => {
            const tone = toneFor(item.updated_at);
            const styles = toneStyles[tone];
            const snippet = truncate(item.latest_message ?? item.preview ?? "");
            const age = formatDistanceToNow(new Date(item.updated_at), {
              addSuffix: true,
            });
            return (
              <Card
                key={item.thread_id}
                className={cn(
                  "border-l-4 transition-colors hover:border-primary/40",
                  styles.border,
                )}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                        <MessageCircle
                          size={14}
                          className="text-muted-foreground shrink-0"
                        />
                        <span className="truncate">
                          {item.sender ?? "Unknown sender"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.provider}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        styles.badge,
                      )}
                    >
                      <Clock size={11} />
                      {age}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="font-semibold text-sm leading-snug line-clamp-1">
                      {item.subject ?? "(no subject)"}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {snippet}
                    </p>
                    {item.intent_reason && (
                      <p className="text-[11px] text-muted-foreground/80 italic line-clamp-2 pt-1">
                        Flagged: {item.intent_reason}
                        {typeof item.intent_confidence === "number" &&
                          ` · ${(item.intent_confidence * 100).toFixed(0)}% ${item.intent_category}`}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
