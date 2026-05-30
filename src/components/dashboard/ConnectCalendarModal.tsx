import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Mail, Apple, Link as LinkIcon, FileUp } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Provider {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  status: "coming_soon"; // Phase 3: no real integrations yet
}

const PROVIDERS: Provider[] = [
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Sync events from your Google account in both directions.",
    icon: CalendarDays,
    status: "coming_soon",
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    description: "Import meetings from your Microsoft calendar.",
    icon: Mail,
    status: "coming_soon",
  },
  {
    id: "apple_ics",
    name: "Apple Calendar / ICS",
    description: "Subscribe to an ICS feed from Apple Calendar or any ICS URL.",
    icon: Apple,
    status: "coming_soon",
  },
  {
    id: "calendly",
    name: "Calendly",
    description: "Pull confirmed bookings from your Calendly account.",
    icon: LinkIcon,
    status: "coming_soon",
  },
  {
    id: "cal_com",
    name: "Cal.com",
    description: "Import events from your Cal.com schedules.",
    icon: LinkIcon,
    status: "coming_soon",
  },
  {
    id: "csv",
    name: "CSV import",
    description: "Upload a CSV of appointments to bring into your agenda.",
    icon: FileUp,
    status: "coming_soon",
  },
];

export default function ConnectCalendarModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-[#2dd4a8]/20 bg-[#0a1620] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Connect a calendar</DialogTitle>
          <DialogDescription className="text-white/60">
            Bring events from your calendar or booking apps into your personal agenda.
            Integrations are being built — pick one to be notified.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {PROVIDERS.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.id}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#2dd4a8]/30 bg-[#2dd4a8]/10 text-[#73ffb8]">
                  <Icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{p.name}</p>
                    <Badge
                      variant="outline"
                      className="border-white/15 bg-white/5 text-[10px] text-white/60"
                    >
                      Coming soon
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-white/50">{p.description}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      toast({
                        title: `${p.name} — coming soon`,
                        description: "We'll let you know when this integration is ready.",
                      })
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

        <p className="mt-2 text-center text-[11px] text-white/30">
          Need a provider not listed? Reply to support and we'll prioritise it.
        </p>
      </DialogContent>
    </Dialog>
  );
}
