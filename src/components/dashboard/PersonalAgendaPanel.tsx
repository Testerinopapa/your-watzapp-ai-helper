import { useMemo, useState } from "react";
import { format, isSameDay, isAfter, startOfDay } from "date-fns";
import {
  CalendarDays,
  Clock,
  AlertCircle,
  Trash2,
  Inbox,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePersonalAgenda, type AgendaEntry } from "@/hooks/usePersonalAgenda";
import { cn } from "@/lib/utils";

const MINT = "#73ffb8";

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

function EntryRow({
  entry,
  isConflict,
  onRemove,
}: {
  entry: AgendaEntry;
  isConflict: boolean;
  onRemove: () => void;
}) {
  const start = entry.start_time ? new Date(entry.start_time) : null;
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border p-3 transition-colors",
        isConflict
          ? "border-yellow-400/40 bg-yellow-400/5"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
      )}
    >
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-white/15 bg-[#0a1620]/70 text-white">
        {start ? (
          <>
            <span className="text-[9px] uppercase tracking-wider text-[#73ffb8]/70">
              {format(start, "MMM")}
            </span>
            <span className="text-lg font-semibold leading-none">{format(start, "d")}</span>
          </>
        ) : (
          <Clock size={16} className="text-yellow-300" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">
          {entry.contact_name ?? entry.title ?? "Untitled"}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
          {start && <span>{format(start, "EEE p")}</span>}
          {!start && <span className="text-yellow-300">Time missing</span>}
          <span>·</span>
          <span>{sourceLabel(entry.source_type)}</span>
          {isConflict && (
            <Badge
              variant="outline"
              className="border-yellow-400/40 bg-yellow-400/10 text-[10px] text-yellow-200"
            >
              <AlertCircle size={10} className="mr-1" />
              Conflict
            </Badge>
          )}
          {entry.status === "cancelled" && (
            <Badge variant="outline" className="border-white/15 bg-white/5 text-[10px] text-white/40">
              Cancelled
            </Badge>
          )}
          {entry.status === "confirmed" && (
            <Badge
              variant="outline"
              className="border-[#2dd4a8]/40 bg-[#2dd4a8]/10 text-[10px] text-[#73ffb8]"
            >
              Confirmed
            </Badge>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="opacity-0 transition-opacity group-hover:opacity-100 text-white/40 hover:bg-destructive/10 hover:text-destructive-foreground"
      >
        <Trash2 size={14} />
      </Button>
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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">{title}</p>
        <span className="text-[10px] text-white/30">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">
          {empty ?? "Nothing here."}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              isConflict={conflicts.has(e.id)}
              onRemove={() => onRemove(e.id)}
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
  const { entries, remove, upsert } = usePersonalAgenda();
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

  const addManual = () => {
    if (!title.trim()) return;
    let startISO: string | null = null;
    if (date) {
      const [hh, mm] = (time || "09:00").split(":").map(Number);
      const d = new Date(date);
      d.setHours(hh || 0, mm || 0, 0, 0);
      startISO = d.toISOString();
    }
    upsert({
      id: `manual-${crypto.randomUUID()}`,
      source_type: "manual",
      title: title.trim(),
      start_time: startISO,
      status: "booked",
      imported_at: new Date().toISOString(),
    });
    setTitle("");
    setDate("");
    setTime("");
    setShowManual(false);
  };

  return (
    <div className="space-y-5" style={{ fontFamily: "'Figtree', system-ui, sans-serif" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-white">
          <CalendarDays size={16} style={{ color: MINT }} />
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
        <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's the event?"
            className="w-full rounded-md border border-white/10 bg-[#0a1620]/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#2dd4a8]/40 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-white/10 bg-[#0a1620]/60 px-3 py-2 text-sm text-white focus:border-[#2dd4a8]/40 focus:outline-none"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-md border border-white/10 bg-[#0a1620]/60 px-3 py-2 text-sm text-white focus:border-[#2dd4a8]/40 focus:outline-none"
            />
          </div>
          <Button
            size="sm"
            onClick={addManual}
            disabled={!title.trim()}
            className="w-full bg-[#2dd4a8] text-[#0a1620] hover:bg-[#73ffb8]"
          >
            Add to agenda
          </Button>
        </div>
      )}

      <Section
        title="Today"
        entries={today}
        conflicts={conflicts}
        onRemove={remove}
        empty="Nothing scheduled for today."
      />
      <Section
        title="Upcoming"
        entries={upcoming}
        conflicts={conflicts}
        onRemove={remove}
        empty="No upcoming entries yet."
      />
      {noTime.length > 0 && (
        <Section
          title="Needs time"
          entries={noTime}
          conflicts={conflicts}
          onRemove={remove}
        />
      )}
      {past.length > 0 && (
        <Section
          title="Past"
          entries={past.slice(0, 5)}
          conflicts={conflicts}
          onRemove={remove}
        />
      )}
    </div>
  );
}
