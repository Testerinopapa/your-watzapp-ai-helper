import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bot, X, Loader2, Send, Sparkles, AlertTriangle,
  MessageSquareWarning, CalendarClock, LifeBuoy, ListChecks,
  FileText, Activity, RotateCcw, Copy, Check, ChevronDown,
  ChevronUp, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type QuickAction = {
  label: string;
  prompt: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number | string }>;
};

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Analyze dashboard", icon: Sparkles, prompt: "Analyze this dashboard and give me a clear summary." },
  { label: "Urgent items", icon: AlertTriangle, prompt: "Review this dashboard and tell me what needs urgent attention." },
  { label: "Complaints", icon: MessageSquareWarning, prompt: "Review the complaint cards and tell me which ones need careful handling or escalation." },
  { label: "Appointments", icon: CalendarClock, prompt: "Review the appointment cards and summarize what needs to be scheduled, rescheduled, or reviewed." },
  { label: "Support issues", icon: LifeBuoy, prompt: "Review the support cards and tell me which ones need a selected reference document or human review." },
  { label: "What to handle first?", icon: ListChecks, prompt: "Prioritize the visible dashboard items and tell me what I should handle first." },
  { label: "Today's report", icon: FileText, prompt: "Create a short daily report based on the visible dashboard." },
  { label: "Usage summary", icon: Activity, prompt: "Summarize the visible usage, replies, tokens, and activity information." },
];

const FOLLOW_UP_CHIPS = [
  "Why is this urgent?",
  "What should I do first?",
  "Summarize shorter",
  "Show only complaints",
  "Show only appointments",
];

const ENDPOINT =
  "https://ocpphyjkstvfespxrajk.supabase.co/functions/v1/dashboard-chat";

type Message = { role: "user" | "assistant"; content: string };

// Injected with the first user message. Tells the AI to produce a structured
// report in a tag-based format that the frontend parses into UI cards.
const FORMAT_INSTRUCTION = [
  "",
  "--- OUTPUT FORMAT ---",
  "Reply using the tags below. No markdown, no intro, no closing.",
  "",
  "[VERDICT]",
  "One sentence. What is the most important thing the user needs to know?",
  "Example: 1 complaint needs attention. Appointments are active but under control.",
  "[/VERDICT]",
  "",
  "[PRIORITY]",
  "1-3 items, each on its own line using this exact format:",
  "CATEGORY | URGENCY | Name — one-sentence issue. | Next: one-sentence action.",
  "Valid CATEGORY values: Complaint, Appointment, Support, Usage",
  "Valid URGENCY values: High, Medium, Low",
  "Example:",
  "Complaint | High | Emma Thompson — unhappy about shortened session, may request refund. | Next: Review manually before replying.",
  "Appointment | Medium | Several bookings being rescheduled around June 9–16. | Next: Check for conflicts before confirming.",
  "Support | Low | Lisa Chen asking about gift card balance. | Next: Look up in support docs and reply.",
  "[/PRIORITY]",
  "",
  "[SUMMARY]",
  "One line per category. Just the key stat. No fluff.",
  "Example:",
  "Complaints: 1 needs review · Appointments: 3 need attention · Support: KB loaded · Usage: Normal · Follow-ups: 0 pending",
  "[/SUMMARY]",
  "",
  "[NEXT]",
  "One clear recommended action. One sentence.",
  "Example: Review the complaint first, then confirm the appointment reschedules.",
  "[/NEXT]",
  "",
  "RULES:",
  "- Only report what the dashboard actually shows. Don't guess.",
  "- If a section has nothing to report, write \"Nothing to report\" inside the tag.",
  "- Max 3 priority items. Keep each to one line.",
  "- No markdown formatting. No bold, no italics, no bullet points.",
  "- If information is unclear, say it is unclear.",
  "",
  "--- END FORMAT ---",
].join("\n");

/** Collect visible text from the dashboard DOM for context. */
function collectDashboardContext(): string {
  const root =
    document.querySelector("[data-dashboard-root]") ??
    document.querySelector("main") ??
    document.body;
  return (root?.textContent ?? "").trim().slice(0, 15000);
}

async function sendMessages(msgs: Message[]): Promise<string> {
  const dashboardContext = collectDashboardContext();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: msgs, dashboardContext }),
  });
  const data = await res.json().catch(() => null);
  return data?.reply ?? "Sorry, I couldn't analyze the dashboard right now.";
}

// ── Tag-based parser ──

interface PriorityItem {
  category: string;
  urgency: string;
  detail: string;
  next: string;
}

interface ReportData {
  verdict: string;
  priorities: PriorityItem[];
  summary: string;
  next: string;
}

function extractTag(content: string, tag: string): string {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const m = content.match(re);
  return (m?.[1] ?? "").trim();
}

function parseReport(text: string): ReportData | null {
  const verdict = extractTag(text, "VERDICT");
  if (!verdict) return null; // no tags → fall back

  const rawPriorities = extractTag(text, "PRIORITY");
  const summary = extractTag(text, "SUMMARY");
  const next = extractTag(text, "NEXT");

  const priorities: PriorityItem[] = [];
  for (const line of rawPriorities.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Example") || trimmed.startsWith("CATEGORY")) continue;
    const parts = trimmed.split("|").map((s) => s.trim());
    if (parts.length >= 4) {
      priorities.push({
        category: parts[0],
        urgency: parts[1],
        detail: parts[2],
        next: parts.slice(3).join(" | ").replace(/^Next:\s*/i, ""),
      });
    }
  }

  return { verdict, priorities, summary, next };
}

// ── Legacy section parser (fallback for old ### format) ──

function parseSections(text: string): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = [];
  const parts = text.split(/^### /m);
  for (let i = 1; i < parts.length; i++) {
    const lines = parts[i].split("\n");
    const title = lines[0].trim();
    const body = lines.slice(1).join("\n").trim();
    if (title) sections.push({ title, body });
  }
  return sections;
}

// ── Badge colors ──

const URGENCY_COLORS: Record<string, string> = {
  High: "bg-red-500/15 text-red-400 border-red-500/30",
  Medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Low: "bg-muted text-muted-foreground border-border",
};

const CATEGORY_COLORS: Record<string, string> = {
  Complaint: "bg-red-500/10 text-red-400 border-red-500/20",
  Appointment: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Support: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Usage: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Complaint: MessageSquareWarning,
  Appointment: CalendarClock,
  Support: LifeBuoy,
  Usage: Activity,
};

// ── Report renderer ──

function ReportCards({ text, onFollowUp }: { text: string; onFollowUp: (q: string) => void }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const report = parseReport(text);
  const sections = !report ? parseSections(text) : [];

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  // Copy plain-text summary
  const handleCopy = async () => {
    const plain = report
      ? [report.verdict, "", ...report.priorities.map((p) => `${p.category} · ${p.urgency}: ${p.detail}\n${p.next}`), "", report.summary, "", `Next: ${report.next}`].join("\n")
      : text;
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  // Fallback: no tags and no ### sections → raw text
  if (!report && sections.length === 0) {
    return (
      <div className="rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed bg-muted text-foreground">
        {text}
      </div>
    );
  }

  // Legacy fallback: ### sections
  if (!report) {
    return (
      <div className="space-y-2 max-w-full">
        {sections.map((s, idx) => (
          <div key={idx} className="rounded-xl border border-border/60 bg-muted/70 overflow-hidden">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-foreground/80 border-b border-border/40 bg-muted">{s.title}</div>
            <div className="px-3 py-2 text-[12px] text-foreground/90 whitespace-pre-wrap leading-relaxed">{s.body}</div>
          </div>
        ))}
      </div>
    );
  }

  // Structured report
  return (
    <div className="space-y-3 max-w-full">
      {/* Verdict banner */}
      <div className="rounded-xl bg-primary/8 border border-primary/20 px-3 py-2.5">
        <p className="text-[12px] font-medium text-foreground/90 leading-snug">
          {report.verdict}
        </p>
      </div>

      {/* Priority cards */}
      {report.priorities.length > 0 && (
        <div className="space-y-1.5">
          {report.priorities.map((p, idx) => {
            const CatIcon = CATEGORY_ICONS[p.category] ?? FileText;
            const isOpen = expanded.has(idx);
            return (
              <div key={idx} className="rounded-xl border border-border/60 bg-muted/70 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpand(idx)}
                  className="w-full text-left px-3 py-2"
                >
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <CatIcon size={12} className={CATEGORY_COLORS[p.category]?.split(" ")[1] ?? "text-muted-foreground"} />
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border", CATEGORY_COLORS[p.category] ?? "bg-muted text-muted-foreground border-border")}>
                      {p.category}
                    </span>
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border", URGENCY_COLORS[p.urgency] ?? "bg-muted text-muted-foreground border-border")}>
                      {p.urgency} priority
                    </span>
                  </div>
                  <p className="text-[12px] text-foreground/90 leading-snug">
                    {p.detail}
                  </p>
                  {isOpen && (
                    <p className="text-[11px] text-primary/80 mt-1.5 flex items-center gap-1">
                      <ArrowRight size={10} />
                      {p.next}
                    </p>
                  )}
                </button>
                {!isOpen && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(idx)}
                    className="w-full flex items-center gap-1 px-3 pb-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown size={10} />
                    Show details
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Category summary */}
      {report.summary && (
        <div className="rounded-xl border border-border/60 bg-muted/50 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {report.summary}
          </p>
        </div>
      )}

      {/* Next step */}
      {report.next && (
        <div className="rounded-xl bg-emerald-500/8 border border-emerald-500/20 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-0.5">
            Recommended next step
          </p>
          <p className="text-[12px] text-foreground/90 leading-snug">
            {report.next}
          </p>
        </div>
      )}

      {/* Actions bar */}
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy summary"}
        </Button>
      </div>

      {/* Follow-up chips */}
      <div className="flex items-center gap-1 flex-wrap">
        {FOLLOW_UP_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onFollowUp(chip)}
            className="text-[10px] px-2 py-1 rounded-full border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ──

export default function MiniChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSend = async (text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw || loading) return;

    const isFirst = messages.length === 0;
    const content = isFirst ? `${raw}\n${FORMAT_INSTRUCTION}` : raw;

    // Store display version without the format instruction.
    setMessages((prev) => [...prev, { role: "user", content: raw }]);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendMessages([...messages, { role: "user", content }]);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong reaching the assistant. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([]);
    setInput("");
  };

  const handleFollowUp = useCallback(
    (question: string) => {
      handleSend(question);
    },
    [messages, loading],
  );

  return (
    <>
      {/* Floating button (collapsed) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center",
            "rounded-full bg-card border border-border shadow-lg",
            "hover:shadow-xl hover:border-primary/30 transition-all duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          )}
          aria-label="Open dashboard assistant"
        >
          <Bot size={22} className="text-primary" />
          <span
            aria-hidden
            className={cn(
              "absolute -top-0.5 -right-0.5 flex h-3 w-3",
              "rounded-full bg-primary animate-pulse",
            )}
          />
        </button>
      )}

      {/* Chat panel (expanded) */}
      {open && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex flex-col",
            "w-[380px] max-w-[calc(100vw-2rem)] h-[540px] max-h-[calc(100vh-4rem)]",
            "rounded-2xl border border-border bg-card shadow-2xl overflow-hidden",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                <Bot size={15} className="text-primary" />
              </div>
              <span className="text-sm font-medium">Dashboard Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleReset} title="New chat" aria-label="New chat">
                  <RotateCcw size={14} />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close assistant">
                <X size={14} />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div
            ref={bodyRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
            style={{ scrollbarWidth: "thin" }}
          >
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center gap-3 pt-2 pb-1 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                  <Bot size={22} className="text-primary" />
                </div>
                <p className="text-xs text-muted-foreground max-w-[260px]">
                  Pick a report or ask anything about your dashboard.
                </p>
                <div className="grid grid-cols-2 gap-1.5 w-full pt-1">
                  {QUICK_ACTIONS.map((a) => {
                    const Icon = a.icon;
                    return (
                      <button
                        key={a.label}
                        type="button"
                        onClick={() => handleSend(a.prompt)}
                        disabled={loading}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted hover:border-primary/40",
                          "px-2.5 py-1.5 text-[11px] font-medium text-foreground/90 transition-colors text-left",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                      >
                        <Icon size={12} className="text-primary shrink-0" />
                        <span className="truncate">{a.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" ? (
                  <ReportCards text={m.content} onFollowUp={handleFollowUp} />
                ) : (
                  <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed bg-primary/10 text-foreground">
                    {m.content}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-xl px-3 py-2 bg-muted">
                  <Loader2 size={16} className="animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          {/* Quick-action row (visible once chat starts) */}
          {messages.length > 0 && (
            <div className="border-t border-border shrink-0 px-2 py-1.5 overflow-x-auto">
              <div className="flex items-center gap-1.5 w-max">
                {QUICK_ACTIONS.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.label}
                      type="button"
                      onClick={() => handleSend(a.prompt)}
                      disabled={loading}
                      title={a.prompt}
                      className={cn(
                        "flex items-center gap-1 rounded-full border border-border bg-muted/40 hover:bg-muted hover:border-primary/40",
                        "px-2 py-1 text-[10.5px] font-medium text-foreground/90 transition-colors whitespace-nowrap",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                      )}
                    >
                      <Icon size={11} className="text-primary shrink-0" />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border shrink-0">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your dashboard…"
              disabled={loading}
              className="h-9 text-sm border-0 bg-muted/60 focus-visible:ring-0"
            />
            <Button
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={!input.trim() || loading}
              onClick={() => handleSend()}
            >
              <Send size={14} />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
