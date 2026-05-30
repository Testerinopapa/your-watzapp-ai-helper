import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Mail, Apple, Link as LinkIcon, FileUp, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";

interface Provider {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
}

const COMING_SOON: Provider[] = [
  { id: "outlook", name: "Outlook / Microsoft 365", description: "Import meetings from your Microsoft calendar.", icon: Mail },
  { id: "apple_ics", name: "Apple Calendar / ICS", description: "Subscribe to an ICS feed from Apple Calendar or any ICS URL.", icon: Apple },
  { id: "calendly", name: "Calendly", description: "Pull confirmed bookings from your Calendly account.", icon: LinkIcon },
  { id: "cal_com", name: "Cal.com", description: "Import events from your Cal.com schedules.", icon: LinkIcon },
  { id: "csv", name: "CSV import", description: "Upload a CSV of appointments to bring into your agenda.", icon: FileUp },
];

export default function ConnectCalendarModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { connection, loading, syncing, connect, sync, disconnect, refresh } = useGoogleCalendar();
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connect();
    } catch (e) {
      setConnecting(false);
      toast({ title: "Couldn't start Google sign-in", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleSync = async () => {
    try {
      const res = await sync();
      toast({ title: "Synced", description: `${res.synced} event${res.synced === 1 ? "" : "s"} from Google Calendar.` });
    } catch (e) {
      toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      toast({ title: "Disconnected", description: "Google Calendar was unlinked." });
    } catch (e) {
      toast({ title: "Couldn't disconnect", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-[#2dd4a8]/20 bg-[#0a1620] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Connect a calendar</DialogTitle>
          <DialogDescription className="text-white/60">
            Bring events from your calendar or booking apps into your personal agenda.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Google Calendar — real integration */}
          <div className="flex items-start gap-3 rounded-xl border border-[#2dd4a8]/25 bg-[#2dd4a8]/[0.04] p-4 sm:col-span-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#2dd4a8]/30 bg-[#2dd4a8]/10 text-[#73ffb8]">
              <CalendarDays size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white">Google Calendar</p>
                {connection && (
                  <Badge variant="outline" className="border-[#2dd4a8]/40 bg-[#2dd4a8]/10 text-[10px] text-[#73ffb8]">
                    <CheckCircle2 size={10} className="mr-1" /> Connected
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-white/50">
                {connection
                  ? `Connected as ${connection.google_email ?? "your Google account"}. Read-only sync of the next 30 days.`
                  : "Sign in with Google to sync events from your primary calendar (read-only)."}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {!loading && !connection && (
                  <Button
                    size="sm"
                    onClick={handleConnect}
                    disabled={connecting}
                    className="bg-[#2dd4a8] text-[#0a1620] hover:bg-[#73ffb8]"
                  >
                    {connecting ? (
                      <><Loader2 size={14} className="mr-1.5 animate-spin" /> Redirecting…</>
                    ) : (
                      "Connect Google Calendar"
                    )}
                  </Button>
                )}
                {connection && (
                  <>
                    <Button
                      size="sm"
                      onClick={handleSync}
                      disabled={syncing}
                      className="bg-[#2dd4a8] text-[#0a1620] hover:bg-[#73ffb8]"
                    >
                      {syncing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCw size={14} className="mr-1.5" />}
                      Sync now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleDisconnect}
                      className="border-white/15 bg-transparent text-white/80 hover:bg-white/5"
                    >
                      Disconnect
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {COMING_SOON.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.id}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white/70">
                  <Icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{p.name}</p>
                    <Badge variant="outline" className="border-white/15 bg-white/5 text-[10px] text-white/60">
                      Coming soon
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-white/50">{p.description}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      toast({ title: `${p.name} — coming soon`, description: "We'll let you know when this integration is ready." })
                    }
                    className="mt-2 h-auto px-0 text-xs text-[#73ffb8] hover:bg-transparent hover:text-[#73ffb8]/80"
                  >
                    Notify me →
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
