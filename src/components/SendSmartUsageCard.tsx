import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarChart3, RefreshCw, AlertCircle } from "lucide-react";
import { useSendSmartUsage } from "@/hooks/useSendSmartUsage";

const fmt = (n: number) => n.toLocaleString();

const formatPeriod = (period?: string) => {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, 1));
};

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

interface BarProps {
  label: string;
  used: number;
  quota: number;
}

const UsageBar = ({ label, used, quota }: BarProps) => {
  const pct = quota > 0 ? Math.min((used / quota) * 100, 100) : 0;
  const danger = pct >= 90;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">
          {fmt(used)} / {fmt(quota)}{" "}
          <span className="text-muted-foreground font-normal">
            ({Math.round(pct)}%)
          </span>
        </span>
      </div>
      <Progress
        value={pct}
        className={`h-2 ${danger ? "[&>div]:bg-destructive" : ""}`}
      />
    </div>
  );
};

const SendSmartUsageCard = () => {
  const { data, isLoading, error, refetch } = useSendSmartUsage();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 size={18} className="text-primary" />
            WhatsReply usage
            {data?.period && (
              <span className="text-sm font-normal text-muted-foreground">
                — {formatPeriod(data.period)}
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw
              size={14}
              className={isLoading ? "animate-spin" : ""}
            />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && !data ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load usage</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>{error.message}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : data ? (
          <>
            <div className="space-y-4">
              <UsageBar
                label="Messages replied"
                used={data.used.emails}
                quota={data.quota.emails}
              />
              <UsageBar
                label="AI usage"
                used={data.used.inputTokens + data.used.outputTokens}
                quota={data.quota.inputTokens + data.quota.outputTokens}
              />
            </div>

            <div className="pt-2">
              <h4 className="text-sm font-medium text-foreground mb-2">
                Recent replies
              </h4>
              {data.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No replies yet this month.
                </p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[140px]">Date</TableHead>
                        <TableHead>Last message</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead className="w-[100px]">Decision</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recent.map((r, i) => {
                        const previewText =
                          r.latestMessage?.trim() ||
                          r.preview?.trim() ||
                          "(no message preview)";
                        const isVoice = /^\[Voice message\b/.test(previewText);
                        return (
                        <TableRow key={`${r.createdAt}-${i}`}>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {formatDate(r.createdAt)}
                          </TableCell>
                          <TableCell
                            className="max-w-[240px] truncate"
                            title={previewText}
                          >
                            {isVoice ? `🎙 ${previewText}` : previewText}
                          </TableCell>
                          <TableCell
                            className="max-w-[180px] truncate text-muted-foreground"
                            title={r.senderEmail ?? undefined}
                          >
                            {r.senderEmail}
                          </TableCell>
                          <TableCell className="capitalize">
                            {r.decision}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default SendSmartUsageCard;
