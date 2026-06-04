import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bot,
  X,
  Loader2,
  Send,
  Sparkles,
  AlertTriangle,
  MessageSquareWarning,
  CalendarClock,
  LifeBuoy,
  ListChecks,
  FileText,
  Activity,
  RotateCcw,
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


const ENDPOINT =
  "https://ocpphyjkstvfespxrajk.supabase.co/functions/v1/dashboard-chat";

type Message = { role: "user" | "assistant"; content: string };

// Injected with the first user message so the AI responds in a scannable
// card-friendly format. Kept short to avoid hijacking the user's question.
const FORMAT_INSTRUCTION = [
  "",
  "---",
  "Format your reply as short sections using ### headers.",
  "Each section: one ### Header line, then 1-3 bullet points starting with -.",
  "Keep it tight — no intros, no closings, no markdown besides ### and -.",
  "Example:",
  "### 🔴 2 complaints",
  "- Emma Thompson — refund risk, needs careful reply",
  "- James O'Connor — bad experience, escalate to human",
  "### 📅 3 appointments",
  "- David Park — confirmed, June 13 at 2pm",
  "- Lisa Chen — needs time assigned",
  "Stick to what the dashboard actually shows. Don't guess.",
].join("\n");

/** Collect visible text from the dashboard DOM for context. */
function collectDashboardContext(): string {
  const root =
    document.querySelector("[data-dashboard-root]") ??
    document.querySelector("main") ??
    document.body;
  return (root?.textContent ?? "").trim().slice(0, 15000);
}

async function sendMessages(
  msgs: Message[],
): Promise<string> {
  const dashboardContext = collectDashboardContext();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: msgs, dashboardContext }),
  });
  const data = await res.json().catch(() => null);
  return data?.reply ?? "Sorry, I couldn't analyze the dashboard right now.";
}

/** Parse an assistant reply into sections (### Header ... content).
 *  Falls back to raw text if the message has no ### headers. */
function parseSections(text: string): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = [];
  const parts = text.split(/^### /m);
  // First chunk is everything before the first ### header — skip it.
  for (let i = 1; i < parts.length; i++) {
    const lines = parts[i].split("\n");
    const title = lines[0].trim();
    const body = lines.slice(1).join("\n").trim();
    if (title) sections.push({ title, body });
  }
  return sections;
}

/** Renders an assistant message as compact report cards when the content
 *  uses ### section headers. Falls back to a plain text bubble otherwise. */
function ReportCards({ text }: { text: string }) {
  const sections = parseSections(text);

  if (sections.length === 0) {
    return (
      <div className="rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed bg-muted text-foreground">
        {text}
      </div>
    );
  }

  return (
    <div className="space-y-2 max-w-full">
      {sections.map((s, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-border/60 bg-muted/70 overflow-hidden"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold text-foreground/80 border-b border-border/40 bg-muted">
            {s.title}
          </div>
          <div className="px-3 py-2 text-[12px] text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {s.body}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MiniChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change or loading state toggles.
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when panel opens.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSend = async (text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw || loading) return;

    // Inject format instruction into the first message so the AI replies
    // in a compact, card-renderable structure.
    const isFirst = messages.length === 0;
    const content = isFirst ? `${raw}\n${FORMAT_INSTRUCTION}` : raw;

    const userMsg: Message = { role: "user", content };
    const next = [...messages, userMsg];
    // Store the display version without the instruction so it looks clean.
    setMessages([...messages, { role: "user", content: raw }]);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendMessages(next);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Something went wrong reaching the assistant. Please try again.",
        },
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
            "w-[380px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-4rem)]",
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleReset}
                  title="New chat"
                  aria-label="New chat"
                >
                  <RotateCcw size={14} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
              >
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
              <div
                key={i}
                className={cn(
                  "flex",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {m.role === "assistant" ? (
                  <ReportCards text={m.content} />
                ) : (
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed",
                      "bg-primary/10 text-foreground",
                    )}
                  >
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

          {/* Compact quick-action row (visible once chat starts) */}
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
