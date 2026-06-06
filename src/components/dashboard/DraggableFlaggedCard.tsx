import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Folder, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import type { FolderDef } from "@/lib/flagged-utils";
import FlaggedCardInner from "./FlaggedCardInner";

const INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, [role='menuitem'], [role='dialog'], [data-no-drag]";

// Map common intent categories to an accent color used as the
// left-border tint on each card in the stack.
const intentAccent = (category?: string | null): string => {
  const c = (category ?? "").toLowerCase();
  if (c.includes("appoint") || c.includes("booking") || c.includes("reservation")) return "#f59e0b"; // amber
  if (c.includes("complaint") || c.includes("negative") || c.includes("refund")) return "#ef4444"; // red
  if (c.includes("support") || c.includes("help") || c.includes("faq")) return "#3b82f6"; // blue
  if (c.includes("reschedule")) return "#38bdf8"; // sky
  if (c.includes("cancel")) return "#f43f5e"; // rose
  if (c.includes("follow")) return "#a78bfa"; // violet
  if (c.includes("question") || c.includes("inquiry")) return "#2dd4a8"; // teal
  if (c.includes("confirm")) return "#4ade80"; // green
  if (c.includes("mock")) return "#c084fc"; // purple
  return "#2dd4a8";
};

export default function DraggableFlaggedCard({
  items,
  folders,
  onMoveTo,
  onDelete,
  onActivate,
  isExpanded,
  renderFooter,
  supportDocLabel,
  maskPhoneNumbers,
}: {
  items: FlaggedMessage[];
  folders: FolderDef[];
  onMoveTo: (threadId: string, folderId: string) => void;
  onDelete?: (item: FlaggedMessage) => void;
  onActivate?: (item: FlaggedMessage) => void;
  isExpanded?: (item: FlaggedMessage) => boolean;
  renderFooter?: (item: FlaggedMessage) => React.ReactNode;
  supportDocLabel?: string | null;
  maskPhoneNumbers?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  // If the stack shrinks (e.g. messages dismissed), keep index valid.
  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(0);
  }, [items.length, activeIndex]);

  const current = items[activeIndex] ?? items[0];
  const behind = items.filter((_, i) => i !== activeIndex);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: current.thread_id,
    data: { item: current },
  });

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setRefs = (node: HTMLDivElement | null) => {
    wrapperRef.current = node;
    setNodeRef(node);
  };

  const expanded = isExpanded?.(current) ?? false;

  const handleFocusClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE_SELECTOR)) return;
    if (target.closest("[data-deck-card]")) return; // back-card click handled separately
    onActivate?.(current);
    window.requestAnimationFrame(() => {
      wrapperRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  const dragListeners = listeners
    ? Object.fromEntries(
        Object.entries(listeners).map(([key, handler]) => [
          key,
          (event: React.SyntheticEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(INTERACTIVE_SELECTOR)) return;
            if (target?.closest("[data-deck-card]")) return;
            (handler as (e: React.SyntheticEvent) => void)(event);
          },
        ]),
      )
    : {};

  const liftActive = isHovered && !isDragging && !expanded;

  return (
    <div
      ref={setRefs}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleFocusClick}
      {...attributes}
      {...dragListeners}
      className={cn(
        "group/card relative cursor-grab active:cursor-grabbing touch-pan-y transition-all duration-300 ease-out will-change-transform outline-none",
        isDragging && "opacity-40",
        liftActive && "-rotate-[1.5deg] scale-[1.02] z-10",
        expanded && "md:col-span-2 lg:col-span-3 z-20 animate-scale-in",
      )}
    >
      {/* Stacked deck behind — one single clickable area that rotates the deck forward */}
      {behind.length > 0 && !expanded && (
        <div
          role="button"
          tabIndex={0}
          data-deck-card
          data-no-drag
          aria-label={`Rotate deck — ${behind.length} more message${behind.length === 1 ? "" : "s"} from this sender`}
          title="Click to bring the next message forward"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setActiveIndex((idx) => (idx + 1) % items.length);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setActiveIndex((idx) => (idx + 1) % items.length);
            }
          }}
          className="absolute inset-0 -z-0 cursor-pointer group/deck focus:outline-none transition-transform duration-300 ease-out hover:scale-[1.03] hover:-translate-y-0.5"
        >
          {behind.slice(0, 3).map((it, i) => {
            const depth = i + 1;
            const tx = depth * 12;
            const ty = -depth * 10;
            const scale = 1 - depth * 0.03;
            const opacity = 0.85 - depth * 0.18;
            const rotate = depth * 1.2;
            const color = intentAccent(it.intent_category);
            return (
              <div
                key={it.thread_id}
                aria-hidden
                className="absolute inset-0 rounded-lg border bg-card shadow-[0_6px_20px_-10px_rgba(0,0,0,0.6)] transition-shadow duration-300 ease-out group-hover/deck:shadow-[0_14px_32px_-10px_rgba(45,212,168,0.55)] group-focus-visible/deck:ring-2 group-focus-visible/deck:ring-ring"
                style={{
                  transform: `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rotate}deg)`,
                  opacity,
                  borderLeftColor: color,
                  borderColor: "hsl(var(--border))",
                  borderLeftWidth: 4,
                  zIndex: -depth,
                }}
              />
            );
          })}
        </div>
      )}

      <div className="relative z-[1]">
        <FlaggedCardInner
          item={current}
          footer={renderFooter?.(current)}
          elevated={liftActive || expanded}
          supportDocLabel={supportDocLabel}
          maskPhoneNumbers={maskPhoneNumbers}
          trailing={
            <div className="flex items-center gap-1">
              {items.length > 1 && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                  title={`${activeIndex + 1} of ${items.length} from this sender`}
                >
                  {activeIndex + 1}/{items.length}
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-[#73ffb8]"
                    aria-label="More actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical size={12} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                    Move to folder
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {folders.length === 0 ? (
                    <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
                  ) : (
                    folders.map((f) => (
                      <DropdownMenuItem
                        key={f.id}
                        onClick={() => onMoveTo(current.thread_id, f.id)}
                      >
                        <Folder size={12} className="mr-2 text-[#2dd4a8]" />
                        {f.name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  data-no-drag
                  aria-label="Delete flagged message"
                  title="Delete (removes linked calendar event too)"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(current);
                  }}
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
          }
        />
      </div>
    </div>
  );
}
