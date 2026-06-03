import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  LifeBuoy,
  Upload,
  Trash2,
  RefreshCw,
  FileText,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useSupportKnowledge } from "@/hooks/useSupportKnowledge";
import { toast } from "@/hooks/use-toast";

export default function SupportKnowledgeSection() {
  const { docs, hydrated, error, uploadDoc, deleteDoc } =
    useSupportKnowledge();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const handleUpload = async () => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) return;

    await uploadDoc(trimmedTitle, filename, trimmedContent);
    setTitle("");
    setContent("");
    setFilename(null);
    if (fileRef.current) fileRef.current.value = "";
    toast({
      title: "Document uploaded",
      description: `"${trimmedTitle}" added to support knowledge.`,
    });
  };

  const handleDelete = async (docId: string, docTitle: string) => {
    await deleteDoc(docId);
    toast({
      title: "Document removed",
      description: `"${docTitle}" removed from support knowledge.`,
    });
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    if (!title.trim()) {
      // Auto-fill title from filename (strip extension)
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }
    const reader = new FileReader();
    reader.onload = () => {
      setContent((reader.result as string) ?? "");
    };
    reader.readAsText(file);
  };

  const canUpload = title.trim().length > 0 && content.trim().length > 0;

  return (
    <section className="rounded-2xl border bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-3 p-5 border-b">
        <div className="flex items-center gap-2">
          <LifeBuoy size={18} className="text-blue-400" />
          <h2 className="font-semibold">Support Knowledge</h2>
          {hydrated && (
            <Badge variant="secondary" className="ml-1">
              {docs.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            className="gap-1.5 text-xs"
          >
            <Upload size={14} />
            {expanded ? "Close upload" : "Upload document"}
          </Button>
        </div>
      </header>

      <div className="p-5 space-y-4">
        {/* Upload area */}
        {expanded && (
          <div className="rounded-xl border border-dashed border-blue-400/30 bg-blue-400/[0.03] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Upload size={14} className="text-blue-400" />
              <span className="text-sm font-medium">
                Add support document
              </span>
            </div>

            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document title (e.g. Shipping FAQ, Return Policy)"
              className="text-sm"
            />

            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste your document content here — FAQ, policy guide, service instructions, etc. The AI will use this to answer support questions."
              rows={6}
              className="text-sm resize-y min-h-[120px]"
            />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.md,.csv"
                  onChange={handleFile}
                  className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-blue-400/10 file:text-blue-400 hover:file:bg-blue-400/20"
                />
              </div>
              <Button
                size="sm"
                onClick={handleUpload}
                disabled={!canUpload}
                className="gap-1.5 bg-blue-500 text-white hover:bg-blue-400"
              >
                <Upload size={12} />
                Upload
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Upload .txt, .md, or .csv files, or paste content directly.
              Documents are chunked at sentence boundaries for search.
            </p>
          </div>
        )}

        {/* Document list */}
        {!hydrated ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error && docs.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-destructive py-4">
            <AlertCircle size={16} />
            Could not load documents: {error}
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <FileText
              size={28}
              className="text-muted-foreground/60"
            />
            <p className="text-sm text-muted-foreground">
              No support documents yet — upload your FAQ, policy guide,
              or service instructions.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {doc.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {doc.chunk_count} chunk
                    {doc.chunk_count !== 1 ? "s" : ""}
                    {doc.filename ? ` · ${doc.filename}` : ""} ·{" "}
                    {formatDistanceToNow(new Date(doc.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => handleDelete(doc.id, doc.title)}
                  aria-label={`Delete ${doc.title}`}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
