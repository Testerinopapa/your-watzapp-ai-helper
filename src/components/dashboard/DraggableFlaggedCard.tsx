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
  );
}
