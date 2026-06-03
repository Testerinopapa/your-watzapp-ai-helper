import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SUPPORT_DOCS_CACHE_KEY } from "@/lib/flagged-utils";

export interface SupportDoc {
  id: string;
  title: string;
  filename: string | null;
  chunk_count: number;
  created_at: string;
}

export interface SupportDocChunk {
  id: string;
  doc_id: string;
  chunk_index: number;
  content: string;
}

/** Cache helpers — localStorage mirrors the DB for instant paint on mount. */
function loadCachedDocs(): SupportDoc[] {
  try {
    const raw = localStorage.getItem(SUPPORT_DOCS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedDocs(docs: SupportDoc[]) {
  try {
    localStorage.setItem(SUPPORT_DOCS_CACHE_KEY, JSON.stringify(docs));
  } catch {
    /* ignore */
  }
}

/** Split text into chunks at sentence boundaries, targeting ~500 chars each. */
function chunkContent(text: string, maxLen = 500): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";

  for (const s of sentences) {
    if (current.length + s.length > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += (current ? " " : "") + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // If any chunk is still too long, hard-split at maxLen.
  const result: string[] = [];
  for (const c of chunks) {
    if (c.length <= maxLen * 2) {
      result.push(c);
    } else {
      for (let i = 0; i < c.length; i += maxLen) {
        result.push(c.slice(i, i + maxLen));
      }
    }
  }
  return result;
}

/**
 * DB-backed support knowledge state.
 *
 * Docs and chunks live in `support_docs` / `support_doc_chunks`. All writes
 * are optimistic: state updates immediately, the DB call runs in the
 * background, and on failure we revert. localStorage mirrors as a paint cache.
 */
export function useSupportKnowledge() {
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  const [docs, setDocs] = useState<SupportDoc[]>(() => loadCachedDocs());
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docsRef = useRef(docs);
  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  // Mirror to localStorage cache.
  useEffect(() => {
    writeCachedDocs(docs);
  }, [docs]);

  // Hydrate from DB after auth is ready.
  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      setHydrated(true);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error: loadErr } = await supabase
        .from("support_docs")
        .select("id,title,filename,chunk_count,created_at")
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (loadErr) {
        console.error("support_docs load failed", loadErr);
        setError(loadErr.message);
        setHydrated(true);
        return;
      }
      setDocs((data ?? []) as SupportDoc[]);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  // ── Upload ──

  const uploadDoc = useCallback(
    async (title: string, filename: string | null, content: string) => {
      if (!userId || !title.trim() || !content.trim()) return;

      const chunks = chunkContent(content.trim());
      // Build optimistic doc.
      const optimistic: SupportDoc = {
        id: `opt-${Date.now()}`,
        title: title.trim(),
        filename,
        chunk_count: chunks.length,
        created_at: new Date().toISOString(),
      };
      const prev = docsRef.current;
      setDocs((p) => [optimistic, ...p]);

      try {
        const { data: inserted, error: insErr } = await supabase
          .from("support_docs")
          .insert({
            user_id: userId,
            title: title.trim(),
            filename,
            content: content.trim(),
            chunk_count: chunks.length,
          })
          .select("id,title,filename,chunk_count,created_at")
          .single();

        if (insErr) throw insErr;
        if (!inserted) throw new Error("No row returned");

        // Insert chunks in bulk.
        const chunkRows = chunks.map((c, i) => ({
          doc_id: inserted.id,
          user_id: userId,
          chunk_index: i,
          content: c,
        }));

        const { error: chunkErr } = await supabase
          .from("support_doc_chunks")
          .insert(chunkRows);

        if (chunkErr) throw chunkErr;

        // Replace optimistic with real row.
        setDocs((p) =>
          p.map((d) =>
            d.id === optimistic.id
              ? (inserted as unknown as SupportDoc)
              : d,
          ),
        );
      } catch (e) {
        setDocs(prev);
        setError((e as Error).message);
      }
    },
    [userId],
  );

  // ── Delete ──

  const deleteDoc = useCallback(
    async (docId: string) => {
      // Skip optimistic placeholder ids.
      if (docId.startsWith("opt-")) {
        setDocs((p) => p.filter((d) => d.id !== docId));
        return;
      }

      const prev = docsRef.current;
      setDocs((p) => p.filter((d) => d.id !== docId));

      const { error: delErr } = await supabase
        .from("support_docs")
        .delete()
        .eq("id", docId);

      if (delErr) {
        setDocs(prev);
        setError(delErr.message);
      }
    },
    [],
  );

  // ── Search (used by the draft flow, not the UI) ──

  const searchChunks = useCallback(
    async (query: string, limit = 8): Promise<SupportDocChunk[]> => {
      if (!userId || !query.trim()) return [];

      const terms = query
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join(" & ");

      const { data, error: searchErr } = await (supabase
        .from("support_doc_chunks") as any)
        .select("id,doc_id,chunk_index,content")
        .textSearch("search_vector", terms, {
          type: "websearch",
        })
        .limit(limit);

      if (searchErr) {
        console.error("support doc search failed", searchErr);
        return [];
      }
      return (data ?? []) as SupportDocChunk[];
    },
    [userId],
  );

  return {
    docs,
    hydrated,
    error,
    uploadDoc,
    deleteDoc,
    searchChunks,
  };
}
