import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  ASSIGNMENTS_KEY,
  DEFAULT_FOLDERS,
  DISMISSED_KEY,
  FOLDERS_KEY,
  loadAssignments,
  loadDismissed,
  loadFolders,
  type FolderDef,
} from "@/lib/flagged-utils";

/**
 * Cloud-backed flagged review state.
 *
 * Folders, folder assignments, and dismissals live in the database
 * (`flagged_folders`, `flagged_assignments`, `flagged_dismissals`) so they
 * sync across browsers/devices and survive storage clears. localStorage is
 * still used as an instant-paint cache so the UI doesn't flicker on load.
 *
 * All write helpers are optimistic: state updates immediately, the DB call
 * runs in the background, and on failure we revert.
 */
export function useFlaggedState() {
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  // Seed from localStorage cache so the UI paints instantly.
  const [folders, setFoldersState] = useState<FolderDef[]>(() => loadFolders());
  const [assignments, setAssignmentsState] = useState<Record<string, string>>(
    () => loadAssignments(),
  );
  const [dismissed, setDismissedState] = useState<Map<string, number>>(
    () => new Map(Object.entries(loadDismissed())),
  );
  const [hydrated, setHydrated] = useState(false);

  const foldersRef = useRef(folders);
  const assignmentsRef = useRef(assignments);
  const dismissedRef = useRef(dismissed);
  useEffect(() => { foldersRef.current = folders; }, [folders]);
  useEffect(() => { assignmentsRef.current = assignments; }, [assignments]);
  useEffect(() => { dismissedRef.current = dismissed; }, [dismissed]);

  // Mirror to localStorage so the next paint (and offline) has cached values.
  useEffect(() => {
    try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch { /* ignore */ }
  }, [folders]);
  useEffect(() => {
    try { localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments)); } catch { /* ignore */ }
  }, [assignments]);
  useEffect(() => {
    try {
      localStorage.setItem(
        DISMISSED_KEY,
        JSON.stringify(Object.fromEntries(dismissed)),
      );
    } catch { /* ignore */ }
  }, [dismissed]);

  // Hydrate from DB after auth is ready.
  useEffect(() => {
    if (authLoading) return;
    if (!userId) { setHydrated(true); return; }

    let cancelled = false;
    (async () => {
      const [foldersRes, assignRes, dismissRes] = await Promise.all([
        supabase
          .from("flagged_folders")
          .select("folder_id,name,created_at")
          .order("created_at", { ascending: true }),
        supabase.from("flagged_assignments").select("thread_id,folder_id"),
        supabase.from("flagged_dismissals").select("thread_id,created_at"),
      ]);
      if (cancelled) return;

      if (!foldersRes.error && foldersRes.data) {
        let next: FolderDef[] = foldersRes.data.map((r) => ({
          id: r.folder_id as string,
          name: r.name as string,
        }));
        // First time on this account: seed the default folders.
        if (next.length === 0) {
          const seedPayload = DEFAULT_FOLDERS.map((f) => ({
            user_id: userId,
            folder_id: f.id,
            name: f.name,
          }));
          const { error: seedErr } = await supabase
            .from("flagged_folders")
            .insert(seedPayload);
          if (!seedErr) next = DEFAULT_FOLDERS;
        }
        setFoldersState(next);
      }
      if (!assignRes.error && assignRes.data) {
        const map: Record<string, string> = {};
        for (const r of assignRes.data) {
          map[r.thread_id as string] = r.folder_id as string;
        }
        setAssignmentsState(map);
      }
      if (!dismissRes.error && dismissRes.data) {
        const m = new Map<string, number>();
        for (const r of dismissRes.data) {
          const ts = r.created_at
            ? new Date(r.created_at as string).getTime()
            : 0;
          m.set(r.thread_id as string, Number.isFinite(ts) ? ts : 0);
        }
        setDismissedState(m);
      }
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [authLoading, userId]);

  // ── Folders ──

  const addFolder = useCallback(
    async (folder: FolderDef) => {
      setFoldersState((prev) =>
        prev.some((f) => f.id === folder.id) ? prev : [...prev, folder],
      );
      if (!userId) return;
      const { error } = await supabase
        .from("flagged_folders")
        .insert({ user_id: userId, folder_id: folder.id, name: folder.name });
      if (error) {
        setFoldersState((prev) => prev.filter((f) => f.id !== folder.id));
      }
    },
    [userId],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const prevFolders = foldersRef.current;
      const prevAssign = assignmentsRef.current;
      setFoldersState((prev) => prev.filter((f) => f.id !== folderId));
      setAssignmentsState((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (next[k] === folderId) delete next[k];
        }
        return next;
      });
      if (!userId) return;
      const [delFolder, delAssign] = await Promise.all([
        supabase
          .from("flagged_folders")
          .delete()
          .eq("user_id", userId)
          .eq("folder_id", folderId),
        supabase
          .from("flagged_assignments")
          .delete()
          .eq("user_id", userId)
          .eq("folder_id", folderId),
      ]);
      if (delFolder.error || delAssign.error) {
        setFoldersState(prevFolders);
        setAssignmentsState(prevAssign);
      }
    },
    [userId],
  );

  // ── Assignments ──

  const assignToFolder = useCallback(
    async (threadId: string, folderId: string) => {
      const prev = assignmentsRef.current[threadId];
      setAssignmentsState((p) => ({ ...p, [threadId]: folderId }));
      if (!userId) return;
      const { error } = await supabase
        .from("flagged_assignments")
        .upsert(
          { user_id: userId, thread_id: threadId, folder_id: folderId },
          { onConflict: "user_id,thread_id" },
        );
      if (error) {
        setAssignmentsState((p) => {
          const next = { ...p };
          if (prev === undefined) delete next[threadId];
          else next[threadId] = prev;
          return next;
        });
      }
    },
    [userId],
  );

  const unassignFromFolder = useCallback(
    async (threadId: string) => {
      const prev = assignmentsRef.current[threadId];
      if (prev === undefined) return;
      setAssignmentsState((p) => {
        const next = { ...p };
        delete next[threadId];
        return next;
      });
      if (!userId) return;
      const { error } = await supabase
        .from("flagged_assignments")
        .delete()
        .eq("user_id", userId)
        .eq("thread_id", threadId);
      if (error) {
        setAssignmentsState((p) => ({ ...p, [threadId]: prev }));
      }
    },
    [userId],
  );

  // ── Dismissals ──

  const dismissThreads = useCallback(
    async (threadIds: string[]) => {
      if (threadIds.length === 0) return;
      const now = Date.now();
      const prevSnapshot = new Map(dismissedRef.current);
      setDismissedState((prev) => {
        const next = new Map(prev);
        for (const id of threadIds) next.set(id, now);
        return next;
      });
      if (!userId) return;
      const { error } = await supabase
        .from("flagged_dismissals")
        .upsert(
          threadIds.map((id) => ({
            user_id: userId,
            thread_id: id,
            created_at: new Date(now).toISOString(),
          })),
          { onConflict: "user_id,thread_id" },
        );
      if (error) {
        setDismissedState(prevSnapshot);
      }
    },
    [userId],
  );

  const undismissThread = useCallback(
    async (threadId: string) => {
      const prev = dismissedRef.current.get(threadId);
      if (prev === undefined) return;
      setDismissedState((p) => {
        const next = new Map(p);
        next.delete(threadId);
        return next;
      });
      if (!userId) return;
      const { error } = await supabase
        .from("flagged_dismissals")
        .delete()
        .eq("user_id", userId)
        .eq("thread_id", threadId);
      if (error) {
        setDismissedState((p) => new Map(p).set(threadId, prev));
      }
    },
    [userId],
  );

  return {
    folders,
    assignments,
    dismissed,
    hydrated,
    addFolder,
    deleteFolder,
    assignToFolder,
    unassignFromFolder,
    dismissThreads,
    undismissThread,
  };
}
