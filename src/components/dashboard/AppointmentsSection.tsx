import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CalendarDays, RefreshCw, MessageCircle, Sparkles, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useFlaggedMessages, type FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { cn } from "@/lib/utils";

const APPOINTMENT_CATEGORIES = new Set(["appointment", "booking", "reservation"]);

function isAppointment(m: FlaggedMessage): boolean {
  return APPOINTMENT_CATEGORIES.has((m.intent_category ?? "").toLowerCase().trim());
}

export default function AppointmentsSection() {
  const { data, isLoading, isFetching, error, refetch } = useFlaggedMessages(50);

  const all = data ?? [];
  const recencyOf = (m: FlaggedMessage) => {
    const candidates = [m.intent_classified_at, m.updated_at].filter(Boolean) as string[];
    return Math.max(...candidates.map((s) => new Date(s).getTime()));
  };
  const sorted = [...all].filter(isAppointment).sort((a, b) => recencyOf(b) - recencyOf(a));
  // De-dupe by sender
  const seen = new Set<string>();
  const items: FlaggedMessage[] = [];
  for (const m of sorted) {
    const key = m.sender ?? m.thread_id;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(m);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="text-primary" />
          <h2 className="text-xl font-semibold">Appointments booked by your agent</h2>
          {!isLoading && !error && (
            <Badge variant="secondary" className="ml-1">
              {items.length}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Couldn't load appointments: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <p className="font-medium">No appointments yet</p>
            <p className="text-sm text-muted-foreground">
              When your agent spots an appointment request, it'll show up here.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => {
            const age = formatDistanceToNow(new Date(item.updated_at), { addSuffix: true });
            return (
              <Card key={item.thread_id} className="border-l-4 border-l-primary/40 hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageCircle size={14} className="text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{item.sender ?? "Unknown"}</span>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Clock size={11} />
                      {age}
                    </span>
                  </div>
                  {item.subject && (
                    <p className="text-sm font-medium line-clamp-2">{item.subject}</p>
                  )}
                  {(item.preview || item.latest_message) && (
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {item.preview ?? item.latest_message}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.intent_category && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        {item.intent_category}
                        {typeof item.intent_confidence === "number" &&
                          ` · ${Math.round(item.intent_confidence * 100)}%`}
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">{item.provider}</span>
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
