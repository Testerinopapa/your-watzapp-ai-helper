import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CalendarCheck,
  RefreshCw,
  Sparkles,
  Clock,
  ArrowUpRight,
  CheckCircle2,
  Plug,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useFlaggedMessages, type FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { usePersonalAgenda } from "@/hooks/usePersonalAgenda";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import AppointmentDrawer from "./AppointmentDrawer";
import PersonalAgendaPanel from "./PersonalAgendaPanel";
import ConnectCalendarModal from "./ConnectCalendarModal";

const APPOINTMENT_CATEGORIES = new Set(["appointment", "booking", "reservation"]);

function isAppointment(m: FlaggedMessage): boolean {
  return APPOINTMENT_CATEGORIES.has((m.intent_category ?? "").toLowerCase().trim());
}

const MINT = "#2dd4a8";
const MINT_BRIGHT = "#73ffb8";

// Distinct font stack for this section
const fontHeading = { fontFamily: "'Outfit', system-ui, sans-serif" } as const;
const fontBody = { fontFamily: "'Figtree', system-ui, sans-serif" } as const;

function initialsOf(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function recencyDate(m: FlaggedMessage): Date {
  const candidates = [m.intent_classified_at, m.updated_at].filter(Boolean) as string[];
  return new Date(Math.max(...candidates.map((s) => new Date(s).getTime())));
}

function AppointmentCard({
  item,
  featured = false,
  onClick,
  inAgenda = false,
}: {
  item: FlaggedMessage;
  featured?: boolean;
  onClick?: () => void;
  inAgenda?: boolean;
}) {
  const when = recencyDate(item);
  const age = formatDistanceToNow(when, { addSuffix: true });
  const dayLabel = format(when, "EEE");
  const dayNum = format(when, "d");
  const monthLabel = format(when, "MMM").toUpperCase();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border border-white/10 text-left",
        "bg-gradient-to-br from-[#0d1b2a] via-[#102a3a] to-[#1b4332]",
        "shadow-[0_8px_30px_-12px_rgba(45,212,168,0.25)] hover:shadow-[0_12px_40px_-12px_rgba(115,255,184,0.35)]",
        "transition-all duration-300 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4a8]",
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
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-semibold text-[#73ffb8]"
                style={fontHeading}
              >
                {initialsOf(item.sender)}
              </div>
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate text-white",
                    featured ? "text-lg" : "text-base",
                  )}
                  style={{ ...fontHeading, fontWeight: 600 }}
                >
                  {item.sender ?? "Unknown"}
                </p>
                <p className="truncate text-[11px] text-white/50">
                  {item.provider}
                </p>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#2dd4a8]/30 bg-[#2dd4a8]/10 px-2 py-0.5 text-[10px] font-medium text-[#73ffb8]">
              <Clock size={10} />
              {age}
            </span>
            {inAgenda && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#73ffb8]/40 bg-[#73ffb8]/10 px-2 py-0.5 text-[10px] font-medium text-[#73ffb8]">
                <CheckCircle2 size={10} />
                In agenda
              </span>
            )}
          </div>
        </div>

        {item.subject && (
          <p
            className={cn(
              "text-white/90",
              featured ? "text-base line-clamp-2" : "text-sm line-clamp-2",
            )}
            style={{ ...fontHeading, fontWeight: 500 }}
          >
            {item.subject}
          </p>
        )}

        {(item.preview || item.latest_message) && (
          <p
            className={cn(
              "text-white/60",
              featured ? "text-sm line-clamp-4" : "text-xs line-clamp-3",
            )}
          >
            “{item.preview ?? item.latest_message}”
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {item.intent_category && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-white/80"
              style={fontHeading}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: MINT_BRIGHT, boxShadow: `0 0 8px ${MINT_BRIGHT}` }}
              />
              {item.intent_category}
              {typeof item.intent_confidence === "number" &&
                ` · ${Math.round(item.intent_confidence * 100)}%`}
            </span>
          )}
          <ArrowUpRight
            size={16}
            className="text-white/30 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#73ffb8]"
          />
        </div>
      </div>
    </button>
  );
}

export default function AppointmentsSection() {
  const { data, isLoading, isFetching, error, refetch } = useFlaggedMessages(50);
  const { findByThreadId } = usePersonalAgenda();
  const [selected, setSelected] = useState<FlaggedMessage | null>(null);
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [tab, setTab] = useState<"booked" | "agenda">("booked");

  const openCard = (m: FlaggedMessage) => {
    setSelected(m);
    setOpen(true);
  };

  const all = data ?? [];
  const sorted = [...all]
    .filter(isAppointment)
    .sort((a, b) => recencyDate(b).getTime() - recencyDate(a).getTime());
  const seen = new Set<string>();
  const items: FlaggedMessage[] = [];
  for (const m of sorted) {
    const key = m.sender ?? m.thread_id;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(m);
  }

  const [featured, ...rest] = items;

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-[#2dd4a8]/20 p-6 md:p-8"
      style={{
        background:
          "radial-gradient(1200px 400px at 0% 0%, rgba(45,212,168,0.18), transparent 60%), radial-gradient(800px 300px at 100% 100%, rgba(115,255,184,0.12), transparent 60%), linear-gradient(135deg, #0a1620 0%, #0d1b2a 40%, #102822 100%)",
        ...fontBody,
      }}
    >
      {/* Dotted backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(115,255,184,0.8) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2dd4a8]/40 bg-[#0a1620]"
            style={{ boxShadow: `inset 0 0 20px ${MINT}33, 0 0 24px ${MINT}33` }}
          >
            <CalendarCheck size={18} style={{ color: MINT_BRIGHT }} />
          </div>
          <div>
            <p
              className="text-[10px] uppercase tracking-[0.25em] text-[#73ffb8]/70"
              style={fontHeading}
            >
              Agent · Live bookings
            </p>
            <h2
              className="text-xl text-white md:text-2xl"
              style={{ ...fontHeading, fontWeight: 700, letterSpacing: "-0.01em" }}
            >
              Appointments booked for you
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isLoading && !error && (
            <span
              className="hidden items-center gap-2 rounded-full border border-[#2dd4a8]/30 bg-[#2dd4a8]/10 px-3 py-1 text-xs font-medium text-[#73ffb8] sm:inline-flex"
              style={fontHeading}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: MINT_BRIGHT, boxShadow: `0 0 8px ${MINT_BRIGHT}` }}
              />
              {items.length} booked
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConnectOpen(true)}
            className="gap-1.5 text-white/70 hover:bg-white/5 hover:text-white"
          >
            <Plug size={14} />
            <span className="hidden sm:inline">Connect</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5 text-white/70 hover:bg-white/5 hover:text-white"
          >
            <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "booked" | "agenda")} className="relative mt-6">
        <TabsList className="bg-[#0a1620]/60 border border-white/10">
          <TabsTrigger
            value="booked"
            className="data-[state=active]:bg-[#2dd4a8]/15 data-[state=active]:text-[#73ffb8] text-white/60"
          >
            Booked by agent
          </TabsTrigger>
          <TabsTrigger
            value="agenda"
            className="data-[state=active]:bg-[#2dd4a8]/15 data-[state=active]:text-[#73ffb8] text-white/60"
          >
            Personal agenda
          </TabsTrigger>
        </TabsList>

        <TabsContent value="booked" className="mt-5">
          {error && (
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Couldn't load appointments: {(error as Error).message}
              </AlertDescription>
            </Alert>
          )}

          {isLoading && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:grid-rows-2">
              <div className="col-span-2 row-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <Skeleton className="h-6 w-1/2 bg-white/10" />
                <Skeleton className="mt-4 h-4 w-3/4 bg-white/10" />
                <Skeleton className="mt-2 h-4 w-2/3 bg-white/10" />
              </div>
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:col-span-2"
                >
                  <Skeleton className="h-4 w-2/3 bg-white/10" />
                  <Skeleton className="mt-2 h-3 w-1/2 bg-white/10" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && !error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#2dd4a8]/30 bg-[#0a1620]/40 px-6 py-12 text-center">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${MINT_BRIGHT}, ${MINT})`,
                  boxShadow: `0 0 30px ${MINT}66`,
                }}
              >
                <Sparkles className="h-6 w-6 text-[#0a1620]" />
              </div>
              <p className="text-white" style={{ ...fontHeading, fontWeight: 600 }}>
                No appointments yet
              </p>
              <p className="text-sm text-white/60">
                When your agent locks one in, it'll land here in real time.
              </p>
            </div>
          )}

          {!isLoading && !error && items.length > 0 && (
            <div className="grid auto-rows-[minmax(0,1fr)] grid-cols-2 gap-4 md:grid-cols-4">
              {featured && (
                <div className="col-span-2 row-span-2 md:col-span-2">
                  <AppointmentCard
                    item={featured}
                    featured
                    inAgenda={!!findByThreadId(featured.thread_id)}
                    onClick={() => openCard(featured)}
                  />
                </div>
              )}
              {rest.map((item, idx) => (
                <div
                  key={item.thread_id}
                  className={cn(
                    "col-span-2 md:col-span-2",
                    idx >= 2 && idx % 3 === 2 && "md:col-span-2",
                  )}
                >
                  <AppointmentCard
                    item={item}
                    inAgenda={!!findByThreadId(item.thread_id)}
                    onClick={() => openCard(item)}
                  />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="agenda" className="mt-5">
          <PersonalAgendaPanel onConnectClick={() => setConnectOpen(true)} />
        </TabsContent>
      </Tabs>

      <AppointmentDrawer item={selected} open={open} onOpenChange={setOpen} />
      <ConnectCalendarModal open={connectOpen} onOpenChange={setConnectOpen} />
    </section>
  );
}
