import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, CheckCircle2, RefreshCw, Flag, Trash2 } from "lucide-react";
import { useFlaggedEmails } from "@/hooks/useFlaggedEmails";
import { useResolveAllFlagged } from "@/hooks/useResolveAllFlagged";
import { useToast } from "@/hooks/use-toast";
import FlaggedEmailCard from "./FlaggedEmailCard";
import { cn } from "@/lib/utils";

export default function FlaggedReviewSection() {
  const { items, isLoading, error, refetch, isFetching } = useFlaggedEmails();
  const resolveAll = useResolveAllFlagged();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const handleClearAll = () => {
    resolveAll.mutate(undefined, {
      onSuccess: (res) => {
        toast({
          title: "Cleared",
          description: `${res.cleared} message${res.cleared === 1 ? "" : "s"} removed from review.`,
        });
        setOpen(false);
      },
      onError: (err) => {
        toast({
          title: "Couldn't clear messages",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flag size={18} className="text-primary" />
          <h2 className="text-xl font-semibold">Flagged messages</h2>
          {!isLoading && !error && (
            <Badge variant="secondary" className="ml-1">
              {items.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isLoading && !error && items.length > 0 && (
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                >
                  <Trash2 size={14} />
                  <span className="hidden sm:inline">Clear all</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all flagged messages?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove all {items.length} message{items.length === 1 ? "" : "s"} from your review queue. You won&apos;t be able to undo this.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearAll}
                    disabled={resolveAll.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {resolveAll.isPending ? "Clearing..." : "Clear all"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Couldn't load flagged messages: {error.message}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-2">
            <CheckCircle2 className="h-8 w-8 text-primary" />
            <p className="font-medium">All caught up</p>
            <p className="text-sm text-muted-foreground">
              No messages are waiting for your review.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((email) => (
            <FlaggedEmailCard key={email.id} email={email} />
          ))}
        </div>
      )}
    </section>
  );
}
