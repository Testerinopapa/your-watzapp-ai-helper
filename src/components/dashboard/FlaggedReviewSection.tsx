import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flag, MessageCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface FlaggedItem {
  id: string;
  sender: string;
  email: string;
  subject: string;
  snippet: string;
  age: string;
  tone: "fresh" | "warn" | "stale";
}

const items: FlaggedItem[] = [
  {
    id: "1",
    sender: "Sample sender",
    email: "sender@example.com",
    subject: "Sample flagged subject",
    snippet: "Preview of the message that has been flagged for your review.",
    age: "2h ago",
    tone: "fresh",
  },
  {
    id: "2",
    sender: "Another sender",
    email: "another@example.com",
    subject: "Awaiting your reply",
    snippet: "This message needs a manual response before it can be sent.",
    age: "1d ago",
    tone: "warn",
  },
  {
    id: "3",
    sender: "Older thread",
    email: "older@example.com",
    subject: "Still waiting",
    snippet: "Flagged a few days ago and still in the review queue.",
    age: "4d ago",
    tone: "stale",
  },
];

const toneStyles: Record<FlaggedItem["tone"], { badge: string; border: string }> = {
  fresh: {
    badge: "bg-secondary text-secondary-foreground border-transparent",
    border: "border-l-border",
  },
  warn: {
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    border: "border-l-amber-500",
  },
  stale: {
    badge: "bg-destructive/10 text-destructive border-destructive/20",
    border: "border-l-destructive",
  },
};

export default function FlaggedReviewSection() {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Flag size={18} className="text-primary" />
        <h2 className="text-xl font-semibold">Flagged messages</h2>
        <Badge variant="secondary" className="ml-1">
          {items.length}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => {
          const styles = toneStyles[item.tone];
          return (
            <Card
              key={item.id}
              className={cn("border-l-4 transition-colors hover:border-primary/40", styles.border)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                      <MessageCircle size={14} className="text-muted-foreground shrink-0" />
                      <span className="truncate">{item.sender}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{item.email}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      styles.badge,
                    )}
                  >
                    <Clock size={11} />
                    {item.age}
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="font-semibold text-sm leading-snug line-clamp-1">{item.subject}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.snippet}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
