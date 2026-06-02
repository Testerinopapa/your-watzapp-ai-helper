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
import { supabase } from "@/integrations/supabase/client";
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

  const logAppointmentSync = (step: string, details?: Record<string, unknown>) => {
    console.info(`[appointment-drawer] ${step}`, {
      thread_id: item?.thread_id,
      sender: item?.sender,
      existing_local_id: existing?.id,
      existing_local_status: existing?.status,
      ...details,
    });
  };

  if (!item) return null;

  const composedStart = (() => {
    if (!selectedDate) return null;
    const [hh, mm] = time.split(":").map(Number);
    const d = new Date(selectedDate);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d.toISOString();
  })();

  const save = async (nextStatus?: AgendaStatus) => {
    const finalStatus = nextStatus ?? status;
    logAppointmentSync("save started", {
      requested_status: nextStatus ?? null,
      final_status: finalStatus,
      composed_start: composedStart,
      has_thread_id: Boolean(item.thread_id),
    });
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
      status: finalStatus,
      notes,
      imported_at: existing?.imported_at ?? new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    };
    upsert(entry);
    logAppointmentSync("local agenda upserted", {
      local_entry_id: entry.id,
      final_status: finalStatus,
    });
    if (nextStatus) setStatus(nextStatus);

    // If cancelling, also sync to the agenda_events DB row and Google Calendar
    if (finalStatus === "cancelled") {
      logAppointmentSync("cancel sync started", {
        thread_id: item.thread_id ?? null,
        sender: item.sender ?? null,
        composed_start: composedStart,
      });

      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        logAppointmentSync("auth user lookup completed", {
          has_user: Boolean(userData.user),
          user_id: userData.user?.id ?? null,
          error: userErr?.message ?? null,
        });
        if (userData.user) {
          // Pre-sync Google Calendar so source_event_id is fresh.
          try {
            await supabase.functions.invoke("google-calendar-sync", { body: {} });
            logAppointmentSync("google-calendar-sync invoked");
          } catch (syncErr) {
            logAppointmentSync("google-calendar-sync skipped", {
              error: (syncErr as Error)?.message ?? null,
            });
          }

          // 1) Try thread_id match first.
          let dbRow:
            | { id: string; source_event_id: string | null; status: string | null; title: string | null }
            | null = null;

          if (item.thread_id) {
            const { data: byThread, error: threadErr } = await supabase
              .from("agenda_events")
              .select("id, source_event_id, status, title, start_time")
              .eq("user_id", userData.user.id)
              .eq("thread_id", item.thread_id)
              .neq("status", "cancelled")
              .order("start_time", { ascending: true })
              .limit(1);
            logAppointmentSync("thread_id lookup completed", {
              thread_id: item.thread_id,
              count: byThread?.length ?? 0,
              rows: byThread ?? null,
              error: threadErr?.message ?? null,
            });
            if (byThread && byThread.length > 0) dbRow = byThread[0];
          } else {
            logAppointmentSync("thread_id lookup skipped: no thread_id on item");
          }

          // 2) Fallback: time-window match around composedStart (±12h).
          if (!dbRow && composedStart) {
            const target = new Date(composedStart).getTime();

            const lo = new Date(target - 12 * 60 * 60 * 1000).toISOString();
            const hi = new Date(target + 12 * 60 * 60 * 1000).toISOString();
            const { data: byTime } = await supabase
              .from("agenda_events")
              .select("id, source_event_id, status, title, start_time")
              .eq("user_id", userData.user.id)
              .neq("status", "cancelled")
              .gte("start_time", lo)
              .lte("start_time", hi)
              .limit(50);
            if (byTime && byTime.length > 0) {
              const sorted = [...byTime].sort(
                (a, b) =>
                  Math.abs(new Date(a.start_time!).getTime() - target) -
                  Math.abs(new Date(b.start_time!).getTime() - target),
              );
              dbRow = sorted[0];
              logAppointmentSync("time-window fallback matched", {
                row_id: dbRow.id,
              });
            }
          }

          // 3) Last-resort: contact-name fallback over next 180 days.
          if (!dbRow && item.sender) {
            const now = new Date().toISOString();
            const horizon = new Date(
              Date.now() + 180 * 24 * 60 * 60 * 1000,
            ).toISOString();
            const { data: byContact } = await supabase
              .from("agenda_events")
              .select("id, source_event_id, status, title, start_time")
              .eq("user_id", userData.user.id)
              .neq("status", "cancelled")
              .eq("contact_name", item.sender)
              .gte("start_time", now)
              .lte("start_time", horizon)
              .order("start_time", { ascending: true })
              .limit(500);
            if (byContact && byContact.length > 0) {
              const target = composedStart
                ? new Date(composedStart).getTime()
                : Date.now();
              const sorted = [...byContact].sort(
                (a, b) =>
                  Math.abs(new Date(a.start_time!).getTime() - target) -
                  Math.abs(new Date(b.start_time!).getTime() - target),
              );
              dbRow = sorted[0];
              logAppointmentSync("contact-name fallback matched", {
                row_id: dbRow.id,
              });
            }
          }

          logAppointmentSync("agenda_events lookup completed", {
            found: Boolean(dbRow),
            row_id: dbRow?.id ?? null,
            row_status: dbRow?.status ?? null,
            has_source_event_id: Boolean(dbRow?.source_event_id),
            source_event_id: dbRow?.source_event_id ?? null,
          });

          if (dbRow && dbRow.status !== "cancelled") {
            const { error: updateErr } = await supabase
              .from("agenda_events")
              .update({ status: "cancelled", source_event_id: null })
              .eq("id", dbRow.id);

            logAppointmentSync("agenda_events cancellation update completed", {
              row_id: dbRow.id,
              error: updateErr?.message ?? null,
            });

            if (dbRow.source_event_id) {
              const { data: pushData, error: pushErr } =
                await supabase.functions.invoke("google-calendar-push", {
                  body: {
                    agenda_event_id: dbRow.id,
                    action: "delete",
                    source_event_id: dbRow.source_event_id,
                  },
                });
              const errCode = (pushData as { error?: string } | null)?.error;
              logAppointmentSync("google calendar delete invoke completed", {
                row_id: dbRow.id,
                source_event_id: dbRow.source_event_id,
                push_data: pushData ?? null,
                push_error: pushErr?.message ?? null,
                function_error_code: errCode ?? null,
              });
              if (pushErr || errCode) {
                toast({
                  title: "Marked cancelled locally",
                  description:
                    errCode === "not_connected"
                      ? "Connect Google Calendar to remove it there too."
                      : "Google Calendar removal skipped.",
                });
                return;
              }
              toast({
                title: "Cancelled & removed from Google Calendar",
                description: `${dbRow.title || "Appointment"} has been cancelled.`,
              });
              return;
            }
            logAppointmentSync("no source_event_id on matched row");
            toast({
              title: "Marked cancelled locally",
              description: "No Google Calendar event id on this row.",
            });
            return;
          }
          logAppointmentSync("cancel sync skipped: no matching agenda_events row");
        }
      } catch (e) {
        console.warn("[appointment-drawer] failed to cancel event", e);
        toast({
          title: "Marked cancelled locally",
          description:
            (e as Error)?.message?.slice(0, 120) ?? "Could not update calendar.",
          variant: "destructive",
        });
        return;
      }
    }

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
