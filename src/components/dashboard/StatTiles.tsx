import { useSendSmartUsage } from "@/hooks/useSendSmartUsage";
import { useFlaggedEmails } from "@/hooks/useFlaggedEmails";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Flag, Cpu, Clock } from "lucide-react";

const StatTiles = () => {
  const { data, isLoading } = useSendSmartUsage();
  const { items } = useFlaggedEmails();

  const replied = data?.used.emails ?? 0;
  const tokens = (data?.used.inputTokens ?? 0) + (data?.used.outputTokens ?? 0);
  const lastReplyIso = data?.recent?.[0]?.createdAt;
  const lastReply = lastReplyIso
    ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        Math.round((new Date(lastReplyIso).getTime() - Date.now()) / 60000),
        "minute",
      )
    : "—";

  const tiles = [
    {
      label: "Replies sent",
      value: replied.toLocaleString(),
      icon: MessageSquare,
      tint: "from-primary/15 to-primary/5 text-primary",
    },
    {
      label: "In review",
      value: items.length.toLocaleString(),
      icon: Flag,
      tint: "from-accent/15 to-accent/5 text-accent",
    },
    {
      label: "AI tokens",
      value: tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens.toString(),
      icon: Cpu,
      tint: "from-primary/15 to-accent/5 text-primary",
    },
    {
      label: "Last reply",
      value: lastReply,
      icon: Clock,
      tint: "from-muted to-muted/40 text-muted-foreground",
    },
  ];

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div id="usage" className="grid grid-cols-2 lg:grid-cols-4 gap-3 scroll-mt-20">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={`rounded-2xl border bg-gradient-to-br ${t.tint} p-4 transition-transform hover:-translate-y-0.5`}
        >
          <t.icon size={16} className="mb-3" />
          <p className="text-2xl font-bold tabular-nums text-foreground truncate">
            {t.value}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{t.label}</p>
        </div>
      ))}
    </div>
  );
};

export default StatTiles;
