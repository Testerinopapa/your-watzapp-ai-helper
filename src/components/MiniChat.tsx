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
} from "lucide-react";
import { cn } from "@/lib/utils";

type QuickAction = {
  label: string;
  prompt: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
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
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: Message = { role: "user", content };
    const next = [...messages, userMsg];
    setMessages(next);
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

          {/* Body */}
          <div
            ref={bodyRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
            style={{ scrollbarWidth: "thin" }}
          >
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Bot size={24} className="text-primary" />
                </div>
                <p className="text-sm text-muted-foreground max-w-[260px]">
                  I can analyze your dashboard — flagged messages, appointments,
                  complaints, and more.
                </p>
                <Button
                  size="sm"
                  onClick={() => handleSend("Analyze this dashboard for me.")}
                  className="gap-1.5"
                >
                  <Sparkles size={13} />
                  Analyze this dashboard
                </Button>
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
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed",
                    m.role === "user"
                      ? "bg-primary/10 text-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {m.content}
                </div>
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
