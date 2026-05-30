import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  X as XIcon,
  MessageCircle,
  Trash2,
  Plus,
  AlertCircle,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  type AgendaEntry,
  type AgendaStatus,
  usePersonalAgenda,
} from "@/hooks/usePersonalAgenda";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const MINT = "#73ffb8";

function recencyDate(m: FlaggedMessage): Date {
  const c = [m.intent_classified_at, m.updated_at].filter(Boolean) as string[];
  return new Date(Math.max(...c.map((s) => new Date(s).getTime())));
}

function statusLabel(s: AgendaStatus): string {
  switch (s) {
    case "booked": return "Booked";
    case "pending": return "Pending";
    case "needs_confirmation": return "Needs confirmation";
    case "imported": return "Imported";
    case "conflict": return "Conflict";
    case "cancelled": return "Cancelled";
    case "confirmed": return "Confirmed";
  }
}

function statusTone(s: AgendaStatus): string {
  switch (s) {
    case "confirmed":
    case "booked":
      return "border-[#2dd4a8]/40 bg-[#2dd4a8]/10 text-[#73ffb8]";
    case "needs_confirmation":
    case "pending":
      return "border-yellow-400/30 bg-yellow-400/10 text-yellow-200";
    case "conflict":
      return "border-destructive/40 bg-destructive/10 text-destructive-foreground";
    case "cancelled":
      return "border-white/15 bg-white/5 text-white/50 line-through";
    case "imported":
      return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  }
}

interface Props {
  item: FlaggedMessage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AppointmentDrawer({ item, open, onOpenChange }: Props) {
  const isMobile = useIsMobile();
  const { entries, upsert, remove, findByThreadId } = usePersonalAgenda();

  const existing = findByThreadId(item?.thread_id);

  const detected = item ? recencyDate(item) : new Date();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(detected);
  const [time, setTime] = useState<string>(format(detected, "HH:mm"));
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  const [status, setStatus] = useState<AgendaStatus>(existing?.status ?? "booked");

  // Keep local state in sync when switching cards
  useMemo(() => {
    if (!item) return;
    const base = existing?.start_time ? parseISO(existing.start_time) : recencyDate(item);
    setSelectedDate(base);
    setTime(format(base, "HH:mm"));
    setNotes(existing?.notes ?? "");
    setStatus(existing?.status ?? "booked");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.thread_id]);

  const conflicts = useMemo(() => {
    if (!selectedDate || !item) return [];
    const [hh, mm] = time.split(":").map(Number);
    const start = new Date(selectedDate);
    start.setHours(hh || 0, mm || 0, 0, 0);
    const startMs = start.getTime();
    return entries.filter((e) => {
      if (e.thread_id === item.thread_id) return false;
      if (!e.start_time) return false;
      const diff = Math.abs(new Date(e.start_time).getTime() - startMs);
      return diff < 30 * 60 * 1000; // within 30 min
    });
  }, [entries, selectedDate, time, item]);

  if (!item) return null;

  const composedStart = (() => {
    if (!selectedDate) return null;
    const [hh, mm] = time.split(":").map(Number);
    const d = new Date(selectedDate);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d.toISOString();
  })();

  const save = (nextStatus?: AgendaStatus) => {
    const entry: AgendaEntry = {
      id: existing?.id ?? `wa-${item.thread_id}`,
      source_type: "whatsapp",
      thread_id: item.thread_id,
      contact_name: item.sender,
      contact_channel: item.provider,
      title: item.subject ?? `Appointment with ${item.sender ?? "contact"}`,
      description: item.preview ?? item.latest_message ?? null,
      start_time: composedStart,
      end_time: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: nextStatus ?? status,
      notes,
      imported_at: existing?.imported_at ?? new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    };
    upsert(entry);
    if (nextStatus) setStatus(nextStatus);
    toast({
      title: existing ? "Agenda entry updated" : "Added to personal agenda",
      description: composedStart ? format(new Date(composedStart), "PPP p") : "Time missing",
    });
  };

  const removeEntry = () => {
    if (!existing) return;
    remove(existing.id);
    toast({ title: "Removed from personal agenda" });
  };

  const handleReply = () => {
    if (item.thread_url) window.open(item.thread_url, "_blank", "noopener,noreferrer");
    else toast({ title: "No thread link available" });
  };

  const side = isMobile ? "bottom" : "right";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn(
          "border-[#2dd4a8]/20 p-0 text-white",
          "bg-gradient-to-br from-[#0a1620] via-[#0d1b2a] to-[#102822]",
          isMobile ? "h-[92vh] rounded-t-3xl" : "w-full sm:max-w-md",
        )}
      >
        <div className="flex h-full flex-col overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-[#0a1620]/95 px-6 py-4 backdrop-blur">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[#73ffb8]/70">
                Appointment
              </p>
              <h2 className="truncate text-lg font-semibold">{item.sender ?? "Unknown"}</h2>
              <p className="text-xs text-white/50 capitalize">{item.provider}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="text-white/60 hover:bg-white/10 hover:text-white"
            >
              <XIcon size={18} />
            </Button>
          </div>

          <div className="space-y-5 px-6 py-5">
            {/* Status + category */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("border", statusTone(status))} variant="outline">
                {statusLabel(status)}
              </Badge>
              {item.intent_category && (
                <Badge variant="outline" className="border-white/15 bg-white/5 text-white/80">
                  {item.intent_category}
                  {typeof item.intent_confidence === "number" &&
                    ` · ${Math.round(item.intent_confidence * 100)}%`}
                </Badge>
              )}
              {existing && (
                <Badge variant="outline" className="border-[#2dd4a8]/40 bg-[#2dd4a8]/10 text-[#73ffb8]">
                  In personal agenda
                </Badge>
              )}
            </div>

            {/* Original message */}
            {(item.subject || item.preview || item.latest_message) && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                {item.subject && (
                  <p className="mb-1 text-sm font-medium text-white">{item.subject}</p>
                )}
                <p className="text-xs leading-relaxed text-white/60">
                  “{item.preview ?? item.latest_message}”
                </p>
              </div>
            )}

            {/* AI reasoning */}
            {item.intent_reason && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-white/40">
                  AI reasoning
                </p>
                <p className="text-xs text-white/70">{item.intent_reason}</p>
              </div>
            )}

            {/* Calendar */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-white/50">Date</p>
                {!selectedDate && (
                  <span className="text-[10px] text-yellow-300">Time missing</span>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0a1620]/60 p-2">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="p-2 pointer-events-auto text-white [&_button]:text-white/80 [&_.rdp-day_selected]:!bg-[#2dd4a8] [&_.rdp-day_selected]:!text-[#0a1620]"
                />
              </div>
            </div>

            {/* Time */}
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-white/50">
                Time
              </label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="border-white/10 bg-white/[0.04] text-white"
              />
            </div>

            {/* Conflicts */}
            {conflicts.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-yellow-400/30 bg-yellow-400/10 p-3 text-xs text-yellow-100">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Conflicts with {conflicts.length} other entr{conflicts.length === 1 ? "y" : "ies"}</p>
                  <ul className="mt-1 space-y-0.5 text-yellow-200/80">
                    {conflicts.slice(0, 3).map((c) => (
                      <li key={c.id}>
                        · {c.contact_name ?? c.title}
                        {c.start_time && ` — ${format(new Date(c.start_time), "p")}`}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-white/50">
                Notes
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any context, prep notes, or reminders…"
                rows={3}
                className="border-white/10 bg-white/[0.04] text-white"
              />
            </div>
          </div>

          {/* Footer actions */}
          <div className="sticky bottom-0 mt-auto space-y-2 border-t border-white/10 bg-[#0a1620]/95 px-6 py-4 backdrop-blur">
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => save()}
                className="bg-[#2dd4a8] text-[#0a1620] hover:bg-[#73ffb8]"
                style={{ boxShadow: `0 0 24px ${MINT}55` }}
              >
                <Plus size={14} />
                {existing ? "Save changes" : "Add to agenda"}
              </Button>
              <Button
                variant="outline"
                onClick={() => save("confirmed")}
                className="border-[#2dd4a8]/40 bg-transparent text-[#73ffb8] hover:bg-[#2dd4a8]/10"
              >
                <CheckCircle2 size={14} />
                Confirm
              </Button>
              <Button
                variant="outline"
                onClick={handleReply}
                className="border-white/15 bg-transparent text-white/80 hover:bg-white/10"
              >
                <MessageCircle size={14} />
                Reply
              </Button>
              <Button
                variant="outline"
                onClick={() => save("cancelled")}
                className="border-white/15 bg-transparent text-white/60 hover:bg-white/10"
              >
                <XIcon size={14} />
                Cancel
              </Button>
            </div>
            {existing && (
              <Button
                variant="ghost"
                onClick={removeEntry}
                className="w-full text-xs text-white/40 hover:bg-destructive/10 hover:text-destructive-foreground"
              >
                <Trash2 size={12} />
                Remove from personal agenda
              </Button>
            )}
            <div className="flex items-center justify-center gap-1 pt-1 text-[10px] text-white/30">
              <CalendarIcon size={10} />
              External calendar sync coming soon
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
