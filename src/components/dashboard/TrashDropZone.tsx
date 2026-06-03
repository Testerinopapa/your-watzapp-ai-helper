import { useDroppable } from "@dnd-kit/core";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRASH_DROP_ID } from "@/lib/flagged-utils";

export default function TrashDropZone({
  isAnyDragging,
}: {
  isAnyDragging: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: TRASH_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      aria-label="Drop here to delete"
      className={cn(
        "rounded-xl border border-dashed px-4 py-3 flex items-center justify-center gap-2 text-sm transition-all select-none",
        "border-destructive/40 text-destructive/80 bg-destructive/[0.04]",
        isAnyDragging &&
          !isOver &&
          "border-destructive/60 bg-destructive/[0.08]",
        isOver &&
          "scale-[1.02] border-destructive text-destructive bg-destructive/15 shadow-[0_0_28px_hsl(var(--destructive)/0.45)]",
        !isAnyDragging && "opacity-60",
      )}
    >
      <Trash2 size={16} />
      <span className="font-medium">
        {isOver ? "Release to delete" : "Drag here to delete"}
      </span>
    </div>
  );
}
