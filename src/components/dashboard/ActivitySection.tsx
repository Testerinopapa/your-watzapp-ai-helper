import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Activity, AlertCircle, RefreshCw, MessageSquare, Mic } from "lucide-react";
import { useSendSmartUsage } from "@/hooks/useSendSmartUsage";

// Parses voice rows. Handles both "[Voice message 0:05] transcript..." and
// legacy/truncated "0:05" rows. Returns null when the row isn't a voice note.
const parseVoice = (text: string) => {
  const tagged = text.match(/^\[Voice message\s+(\d+:\d{2})\]\s*([\s\S]*)$/i);
  if (tagged) return { duration: tagged[1], transcript: tagged[2].trim() };
  const bareDuration = text.match(/^(\d+:\d{2})\s*([\s\S]*)$/);
  if (bareDuration) return { duration: bareDuration[1], transcript: bareDuration[2].trim() };
  return null;
};

// Static waveform bars — purely decorative, deterministic per duration so it
// doesn't reshuffle on every render.
const WAVEFORM_BARS = [3, 6, 10, 7, 12, 5, 9, 14, 8, 11, 6, 13, 9, 5, 10, 7, 12, 4, 8, 6];

const VoicePreview = ({ duration, transcript }: { duration: string; transcript: string }) => (
  <div className="mt-1.5 space-y-1.5">
    <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 pl-2 pr-3 py-1">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Mic size={11} strokeWidth={2.5} />
      </span>
      <div className="flex items-center gap-[2px] h-4">
        {WAVEFORM_BARS.map((h, idx) => (
          <span
            key={idx}
            className="w-[2px] rounded-full bg-primary/70"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-primary tabular-nums">{duration}</span>
    </div>
    {transcript && (
      <p
        className="text-sm text-muted-foreground italic line-clamp-2 pl-1 border-l-2 border-primary/30 ml-0.5"
        title={transcript}
      >
        “{transcript}”
      </p>
    )}
  </div>
);


const formatPeriod = (period?: string) => {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
};

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const decisionTone: Record<string, string> = {
  sent: "bg-primary/15 text-primary",
  flagged: "bg-accent/15 text-accent",
  skipped: "bg-muted text-muted-foreground",
};

const ActivitySection = () => {
  const { data, isLoading, error, refetch } = useSendSmartUsage();

  const replied = data?.used.emails ?? 0;
  const repliedQuota = data?.quota.emails ?? 0;
  const repliedPct = repliedQuota > 0 ? Math.min((replied / repliedQuota) * 100, 100) : 0;

  const tokensUsed = (data?.used.inputTokens ?? 0) + (data?.used.outputTokens ?? 0);
  const tokensQuota = (data?.quota.inputTokens ?? 0) + (data?.quota.outputTokens ?? 0);
  const tokensPct = tokensQuota > 0 ? Math.min((tokensUsed / tokensQuota) * 100, 100) : 0;

  return (
    <section id="activity" className="rounded-2xl border bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-3 p-5 border-b">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-primary" />
          <h2 className="font-semibold">Activity</h2>
          {data?.period && (
            <span className="text-sm text-muted-foreground">
              · {formatPeriod(data.period)}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading} className="gap-1.5">
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </header>

      <div className="p-5 space-y-6">
        {isLoading && !data ? (
          <div className="space-y-4">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load activity</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>{error.message}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : data ? (
          <>
            {/* Usage bars */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl bg-muted/40 p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Messages</span>
                  <span className="text-sm font-medium tabular-nums">
                    {replied.toLocaleString()} / {repliedQuota.toLocaleString()}
                  </span>
                </div>
                <Progress value={repliedPct} className="h-1.5" />
              </div>
              <div className="rounded-xl bg-muted/40 p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs text-muted-foreground">AI tokens</span>
                  <span className="text-sm font-medium tabular-nums">
                    {tokensUsed.toLocaleString()} / {tokensQuota.toLocaleString()}
                  </span>
                </div>
                <Progress value={tokensPct} className="h-1.5" />
              </div>
            </div>

            {/* Recent stream */}
            <div>
              <h3 className="text-sm font-medium mb-3">Recent replies</h3>
              {data.recent.length === 0 ? (
                <div className="rounded-xl border border-dashed py-10 flex flex-col items-center justify-center text-center">
                  <MessageSquare className="h-7 w-7 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No replies yet this month.</p>
                </div>
              ) : (
                <ol className="relative border-l border-border ml-2 space-y-4">
                  {data.recent.slice(0, 8).map((r, i) => {
                    const previewText =
                      r.latestMessage?.trim() ||
                      r.preview?.trim() ||
                      "(no message preview)";
                    const isVoice = /^\[Voice message\b/.test(previewText);
                    return (
                      <li key={`${r.createdAt}-${i}`} className="pl-4 relative">
                        <span className="absolute -left-1.5 top-2 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span className="text-sm font-medium truncate max-w-[60%]" title={r.senderEmail ?? undefined}>
                            {r.senderEmail}
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                decisionTone[r.decision] ?? "bg-muted text-muted-foreground"
                              }`}
                            >
                              {r.decision}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatDate(r.createdAt)}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-1" title={previewText}>
                          {isVoice ? `🎙 ${previewText}` : previewText}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
};

export default ActivitySection;
