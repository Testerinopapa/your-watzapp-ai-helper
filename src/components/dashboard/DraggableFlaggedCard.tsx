import { useRef, useState } from "react";
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
import { MoreVertical, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import type { FolderDef } from "@/lib/flagged-utils";
import FlaggedCardInner from "./FlaggedCardInner";

const INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, [role='menuitem'], [role='dialog'], [data-no-drag]";

export default function DraggableFlaggedCard({
  item,
  folders,
  onMoveTo,
  onActivate,
  expanded,
  footer,
}: {
  item: FlaggedMessage;
  folders: FolderDef[];
  onMoveTo: (threadId: string, folderId: string) => void;
  onActivate?: () => void;
  expanded?: boolean;
  footer?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.thread_id,
    data: { item },
  });

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setRefs = (node: HTMLDivElement | null) => {
    wrapperRef.current = node;
    setNodeRef(node);
  };

  const handleFocusClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE_SELECTOR)) return;
    onActivate?.();
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
            (handler as (e: React.SyntheticEvent) => void)(event);
          },
        ]),
      )
    : {};

  const liftActive = isHovered && !isDragging && !expanded;
  // Intent accent palette for the decorative "deck" behind the card.
  const INTENT_ACCENTS = [
    "#f59e0b", // appointment - amber
    "#38bdf8", // reschedule - sky
    "#a78bfa", // follow-up - violet
    "#2dd4a8", // question - teal
    "#f43f5e", // cancel - rose
    "#4ade80", // confirmation - green
  ];
  const activeAccent = (item.intent_category ?? "").toLowerCase().includes("appoint")
    ? "#f59e0b"
    : "#2dd4a8";
  // Stable per-thread selection so the deck doesn't shuffle on re-render.
  const seed = Array.from(item.thread_id).reduce((a, c) => a + c.charCodeAt(0), 0);
  const deckColors = INTENT_ACCENTS.filter((c) => c !== activeAccent);
  const stack = [0, 1, 2].map((i) => deckColors[(seed + i) % deckColors.length]);

  return (
    <div
      ref={setRefs}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleFocusClick}
      {...attributes}
      {...dragListeners}
      className={cn(
        "group/card relative cursor-grab active:cursor-grabbing touch-none transition-all duration-300 ease-out will-change-transform outline-none",
        isDragging && "opacity-40",
        liftActive && "-rotate-[1.5deg] scale-[1.02] z-10",
        expanded && "md:col-span-2 lg:col-span-3 z-20 animate-scale-in",
      )}
    >
      {/* Decorative "deck of cards" behind the main card */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
        {stack.map((color, i) => {
          const depth = i + 1;
          const tx = depth * 5; // px right
          const ty = -depth * 4; // px up
          const scale = 1 - depth * 0.025;
          const opacity = 0.55 - depth * 0.13;
          const rotate = depth * 0.6;
          return (
            <div
              key={i}
              className="absolute inset-0 rounded-lg border border-l-4 bg-[#0a0a1a]/80 shadow-[0_6px_20px_-10px_rgba(0,0,0,0.6)]"
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

      <div className="relative z-[1]">
      <FlaggedCardInner
        item={item}
        footer={footer}
        elevated={liftActive || expanded}
        trailing={
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
                <DropdownMenuItem disabled>
                  No folders yet
                </DropdownMenuItem>
              ) : (
                folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onClick={() => onMoveTo(item.thread_id, f.id)}
                  >
                    <Folder
                      size={12}
                      className="mr-2 text-[#2dd4a8]"
                    />
                    {f.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      </div>
    </div>
  );
}
