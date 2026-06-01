import { useMemo, useState } from "react";
import { format, isSameDay, isAfter, startOfDay } from "date-fns";
import {
  CalendarDays,
  Clock,
  AlertCircle,
  Trash2,
  Inbox,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePersonalAgenda, type AgendaEntry } from "@/hooks/usePersonalAgenda";
import { useAgendaEvents } from "@/hooks/useAgendaEvents";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MINT = "#2dd4a8";
const MINT_BRIGHT = "#73ffb8";

const fontHeading = { fontFamily: "'Outfit', system-ui, sans-serif" } as const;
const fontBody = { fontFamily: "'Figtree', system-ui, sans-serif" } as const;

function sourceLabel(s: AgendaEntry["source_type"]): string {
  switch (s) {
    case "whatsapp": return "WhatsApp";
    case "manual": return "Manual";
    case "google_calendar": return "Google";
    case "outlook": return "Outlook";
    case "apple_ics": return "Apple / ICS";
    case "calendly": return "Calendly";
    case "cal_com": return "Cal.com";
    case "csv": return "CSV";
  }
}

function sourceInitials(entry: AgendaEntry): string {
  if (entry.contact_name) {
    const parts = entry.contact_name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  }
  if (entry.title) {
    const parts = entry.title.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  }
  return "?";
}

function sourceColor(s: AgendaEntry["source_type"]): string {
  switch (s) {
    case "google_calendar": return "#4285f4";
    case "outlook": return "#0078d4";
    case "apple_ics": return "#555555";
    case "whatsapp": return MINT_BRIGHT;
    case "manual": return "#f59e0b";
    case "calendly": return "#006bff";
    case "cal_com": return MINT;
    case "csv": return "#a855f7";
  }
}

function detectConflicts(entries: AgendaEntry[]): Set<string> {
  const conflicting = new Set<string>();
  const sorted = entries
    .filter((e) => e.start_time && e.status !== "cancelled")
    .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime());
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = new Date(sorted[i].start_time!).getTime();
      const b = new Date(sorted[j].start_time!).getTime();
      if (Math.abs(a - b) < 30 * 60 * 1000) {
        conflicting.add(sorted[i].id);
        conflicting.add(sorted[j].id);
      }
    }
  }
  return conflicting;
}

function AgendaCard({
  entry,
  isConflict,
  onRemove,
  featured = false,
}: {
  entry: AgendaEntry;
  isConflict: boolean;
  onRemove: () => void;
  featured?: boolean;
}) {
  const start = entry.start_time ? new Date(entry.start_time) : null;
  const tz = entry.timezone || undefined;
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    start ? new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(start) : null;
  const monthLabel = fmt({ month: "short" })?.toUpperCase() ?? "---";
  const dayNum = fmt({ day: "numeric" }) ?? "?";
  const dayLabel = fmt({ weekday: "short" }) ?? "---";
  const timeStr = fmt({ hour: "numeric", minute: "2-digit", hour12: true });
  const initials = sourceInitials(entry);
  const srcColor = sourceColor(entry.source_type);

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border border-white/10 text-left",
        "bg-gradient-to-br from-[#0d1b2a] via-[#102a3a] to-[#1b4332]",
        "shadow-[0_8px_30px_-12px_rgba(45,212,168,0.25)] hover:shadow-[0_12px_40px_-12px_rgba(115,255,184,0.35)]",
        "transition-all duration-300 hover:-translate-y-0.5",
        featured ? "p-6" : "p-5",
      )}
      style={fontBody}
    >
      {/* glow blob */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full opacity-40 blur-3xl transition-opacity duration-500 group-hover:opacity-70"
        style={{ background: `radial-gradient(closest-side, ${MINT_BRIGHT}, transparent)` }}
      />
      {/* subtle grid pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="relative flex h-full flex-col gap-4">
        <div className="flex items-start gap-4">
          {/* Calendar tile */}
          <div
            className={cn(
              "shrink-0 overflow-hidden rounded-xl border border-white/15 bg-[#0a1620]/70 backdrop-blur",
              featured ? "w-20" : "w-16",
            )}
          >
            <div
              className="px-2 py-1 text-center text-[10px] font-semibold tracking-widest text-[#0a1620]"
              style={{ background: `linear-gradient(135deg, ${MINT_BRIGHT}, ${MINT})` }}
            >
              {monthLabel}
            </div>
            <div className="px-2 py-2 text-center">
              <div
                className={cn(
                  "leading-none text-white",
                  featured ? "text-3xl" : "text-2xl",
                )}
                style={{ ...fontHeading, fontWeight: 700 }}
              >
                {dayNum}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-white/60">
                {dayLabel}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {/* Avatar */}
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-semibold"
                style={{ ...fontHeading, color: srcColor }}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate text-white",
                    featured ? "text-lg" : "text-base",
                  )}
                  style={{ ...fontHeading, fontWeight: 600 }}
                >
                  {entry.contact_name ?? entry.title ?? "Untitled"}
                </p>
                <p className="truncate text-[11px] text-white/50">
                  {sourceLabel(entry.source_type)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            {timeStr && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#2dd4a8]/30 bg-[#2dd4a8]/10 px-2 py-0.5 text-[10px] font-medium text-[#73ffb8]">
                <Clock size={10} />
                {timeStr}
              </span>
            )}
            {entry.status === "confirmed" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#73ffb8]/40 bg-[#73ffb8]/10 px-2 py-0.5 text-[10px] font-medium text-[#73ffb8]">
                Confirmed
              </span>
            )}
            {entry.status === "cancelled" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/40">
                Cancelled
              </span>
            )}
            {isConflict && (
              <span className="inline-flex items-center gap-1 rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 text-[10px] font-medium text-yellow-200">
                <AlertCircle size={10} />
                Conflict
              </span>
            )}
          </div>
        </div>

        {entry.description && (
          <p
            className={cn(
              "text-white/60",
              featured ? "text-sm line-clamp-3" : "text-xs line-clamp-2",
            )}
          >
            {entry.description}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-white/80"
            style={fontHeading}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: srcColor, boxShadow: `0 0 8px ${srcColor}` }}
            />
            {sourceLabel(entry.source_type)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 text-white/40 hover:bg-destructive/10 hover:text-destructive-foreground"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  entries,
  conflicts,
  onRemove,
  empty,
}: {
  title: string;
  entries: AgendaEntry[];
  conflicts: Set<string>;
  onRemove: (id: string) => void;
  empty?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p
          className="text-[10px] uppercase tracking-[0.25em] text-[#73ffb8]/70"
          style={fontHeading}
        >
          {title}
        </p>
        <span className="text-[10px] text-white/30">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#2dd4a8]/20 bg-[#0a1620]/40 px-6 py-8 text-center">
          <Sparkles size={18} className="text-[#73ffb8]/40" />
          <p className="text-xs text-white/40">
            {empty ?? "Nothing here."}
          </p>
        </div>
      ) : (
        <div className="grid auto-rows-[minmax(0,1fr)] grid-cols-1 gap-3 sm:grid-cols-2">
          {entries.map((e, i) => (
            <AgendaCard
              key={e.id}
              entry={e}
              isConflict={conflicts.has(e.id)}
              onRemove={() => onRemove(e.id)}
              featured={i === 0 && entries.length === 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PersonalAgendaPanel({
  onConnectClick,
}: {
  onConnectClick?: () => void;
}) {
  const { entries: localEntries, remove: removeLocal } = usePersonalAgenda();
  const { entries: dbEntries, remove: removeDb, refresh: refreshDb } = useAgendaEvents();
  const { toast } = useToast();
  const entries = useMemo(() => {
    const seen = new Set<string>();
    const all: AgendaEntry[] = [];
    for (const e of [...dbEntries, ...localEntries]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      all.push(e);
    }
    return all;
  }, [localEntries, dbEntries]);
  const dbEntriesById = useMemo(
    () => new Map(dbEntries.map((e) => [e.id, e])),
    [dbEntries],
  );
  const remove = async (id: string) => {
    const dbEntry = dbEntriesById.get(id);
    if (dbEntry) {
      // Remove locally first for instant UI feedback, then clean up Google
      // Calendar in the background so the user never waits on the network.
      await removeDb(id);
      if (dbEntry.source_type === "google_calendar" && dbEntry.source_event_id) {
        supabase.functions
          .invoke("google-calendar-push", {
            body: {
              agenda_event_id: id,
              action: "delete",
              source_event_id: dbEntry.source_event_id,
            },
          })
          .catch((e) => {
            console.warn("google-calendar-push delete failed (continuing)", e);
          });
      }
      return;
    }
    return removeLocal(id);
  };
  const confirmRemove = (id: string) => setPendingDelete(id);
  const conflicts = useMemo(() => detectConflicts(entries), [entries]);
  const now = new Date();
  const todayStart = startOfDay(now);

  const today = entries.filter(
    (e) => e.start_time && isSameDay(new Date(e.start_time), now) && e.status !== "cancelled",
  );
  const upcoming = entries.filter(
    (e) =>
      e.start_time &&
      isAfter(new Date(e.start_time), now) &&
      !isSameDay(new Date(e.start_time), now) &&
      e.status !== "cancelled",
  );
  const past = entries.filter(
    (e) => e.start_time && new Date(e.start_time) < todayStart && e.status !== "cancelled",
  );
  const noTime = entries.filter((e) => !e.start_time && e.status !== "cancelled");

  const [showManual, setShowManual] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const addManual = async () => {
    if (!title.trim()) return;
    let startISO: string | null = null;
    if (date) {
      const [hh, mm] = (time || "09:00").split(":").map(Number);
      const d = new Date(date);
      d.setHours(hh || 0, mm || 0, 0, 0);
      startISO = d.toISOString();
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        toast({ title: "Please sign in", variant: "destructive" });
        return;
      }

      // Insert into agenda_events so we get a DB id and can sync to Google
      const { data: inserted, error: insErr } = await supabase
        .from("agenda_events")
        .insert({
          user_id: userData.user.id,
          source_type: "manual",
          title: title.trim(),
          start_time: startISO,
          status: "booked",
          imported_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      await refreshDb();

      // Push to Google Calendar if we have a start time
      if (startISO && inserted?.id) {
        const { data: pushData, error: pushErr } = await supabase.functions.invoke(
          "google-calendar-push",
          { body: { agenda_event_id: inserted.id, action: "upsert" } },
        );
        const errCode = (pushData as { error?: string } | null)?.error;
        if (pushErr || errCode) {
          if (errCode === "calendar_scope_missing" || errCode === "reauth_required") {
            toast({
              title: "Reconnect Google Calendar",
              description: "We need write access to push events. Click Connect to re-authorize.",
              variant: "destructive",
            });
          } else if (errCode === "not_connected") {
            toast({
              title: "Saved locally",
              description: "Connect Google Calendar to sync this event.",
            });
          } else {
            toast({
              title: "Couldn't sync to Google",
              description: pushErr?.message ?? errCode ?? "Unknown error",
              variant: "destructive",
            });
          }
        } else {
          toast({ title: "Added", description: "Synced to Google Calendar." });
          await refreshDb();
        }
      } else {
        toast({ title: "Added to agenda" });
      }

      setTitle("");
      setDate("");
      setTime("");
      setShowManual(false);
    } catch (e) {
      toast({
        title: "Couldn't add event",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" style={fontBody}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-white">
          <CalendarDays size={16} style={{ color: MINT_BRIGHT }} />
          <p className="text-sm font-medium">Your personal agenda</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowManual((v) => !v)}
            className="gap-1 text-white/70 hover:bg-white/5 hover:text-white"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">Add</span>
          </Button>
          {onConnectClick && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onConnectClick}
              className="gap-1 text-white/70 hover:bg-white/5 hover:text-white"
            >
              <Inbox size={14} />
              <span className="hidden sm:inline">Connect</span>
            </Button>
          )}
        </div>
      </div>

      {showManual && (
        <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's the event?"
            className="w-full rounded-lg border border-white/10 bg-[#0a1620]/60 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#2dd4a8]/40 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0a1620]/60 px-3 py-2.5 text-sm text-white focus:border-[#2dd4a8]/40 focus:outline-none"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0a1620]/60 px-3 py-2.5 text-sm text-white focus:border-[#2dd4a8]/40 focus:outline-none"
            />
          </div>
          <Button
            size="sm"
            onClick={addManual}
            disabled={!title.trim() || saving}
            className="w-full bg-[#2dd4a8] text-[#0a1620] hover:bg-[#73ffb8]"
          >
            {saving ? "Saving…" : "Add to agenda"}
          </Button>
        </div>
      )}

      <Section
        title="Today"
        entries={today}
        conflicts={conflicts}
        onRemove={confirmRemove}
        empty="Nothing scheduled for today."
      />
      <Section
        title="Upcoming"
        entries={upcoming}
        conflicts={conflicts}
        onRemove={confirmRemove}
        empty="No upcoming entries yet."
      />
      {noTime.length > 0 && (
        <Section
          title="Needs time"
          entries={noTime}
          conflicts={conflicts}
          onRemove={confirmRemove}
        />
      )}
      {past.length > 0 && (
        <Section
          title="Past"
          entries={past.slice(0, 5)}
          conflicts={conflicts}
          onRemove={confirmRemove}
        />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="border-destructive/40 bg-[#0a1620]/95 backdrop-blur-md shadow-[0_0_40px_-10px_hsl(0_70%_55%/0.4)] animate-fade-in">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 size={18} />
              Delete appointment?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              This action cannot be undone. The appointment will be removed from your agenda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setPendingDelete(null)}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) remove(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
