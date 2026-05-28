import { useAuth } from "@/contexts/AuthContext";
import { useSendSmartUsage } from "@/hooks/useSendSmartUsage";
import { useFlaggedEmails } from "@/hooks/useFlaggedEmails";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Flag,
  MessageSquare,
  Sparkles,
  Download,
  KeyRound,
  HelpCircle,
  LayoutDashboard,
  Activity,
} from "lucide-react";
import { useExtensionDownload } from "@/hooks/use-extension-download";

const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "review", label: "Review queue", icon: Flag },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "extension", label: "Connect", icon: KeyRound },
  { id: "setup", label: "Install guide", icon: Download },
  { id: "help", label: "Help", icon: HelpCircle },
];

const SidebarRail = () => {
  const { user } = useAuth();
  const { data, isLoading } = useSendSmartUsage();
  const { items } = useFlaggedEmails();
  const { handleDownload } = useExtensionDownload();

  const initials =
    (user?.user_metadata?.full_name as string | undefined)
      ?.split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ||
    user?.email?.[0]?.toUpperCase() ||
    "?";

  const used = data?.used.emails ?? 0;
  const quota = data?.quota.emails ?? 0;
  const pct = quota > 0 ? Math.min((used / quota) * 100, 100) : 0;

  return (
    <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
      {/* Identity */}
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground font-semibold">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.user_metadata?.full_name || user?.email?.split("@")[0]}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
            <CheckCircle2 size={12} />
            Active
          </Badge>
          <span className="text-xs text-muted-foreground">Free plan</span>
        </div>
      </div>

      {/* Quick stats */}
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            This month
          </span>
          <Sparkles size={14} className="text-primary" />
        </div>

        {isLoading && !data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-2xl font-bold tabular-nums">{used.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">of {quota.toLocaleString()}</span>
              </div>
              <Progress value={pct} className="h-1.5" />
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                <MessageSquare size={12} />
                Messages replied
              </p>
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Flag size={13} className="text-primary" />
                In review
              </span>
              <span className="text-sm font-semibold tabular-nums">{items.length}</span>
            </div>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="hidden lg:block rounded-2xl border bg-card p-2">
        {navItems.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <item.icon size={15} />
            {item.label}
          </a>
        ))}
      </nav>

      {/* CTA */}
      <Button onClick={handleDownload} className="w-full gap-2" size="lg">
        <Download size={16} />
        Download extension
      </Button>
    </aside>
  );
};

export default SidebarRail;
