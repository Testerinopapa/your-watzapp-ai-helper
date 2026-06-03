import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";

// ── Types ──

export type Tone = "fresh" | "stale";

export type FolderDef = { id: string; name: string };

export type DraftPhase = "idle" | "generating" | "sent" | "error";

export type DraftState = {
  open: boolean;
  instruction: string;
  draft: string;
  loading: boolean;
  error: string | null;
  draftId: string | null;
  phase: DraftPhase;
  sentAt: string | null;
  supportDocId: string | null;
};

// ── Constants ──

export const APPOINTMENT_CATEGORIES = new Set(["appointment", "booking", "reservation"]);
export const SUPPORT_CATEGORIES = new Set(["support", "help", "faq", "question", "inquiry"]);

export const toneStyles: Record<Tone, { badge: string; border: string }> = {
  fresh: {
    badge: "bg-secondary text-secondary-foreground border-transparent",
    border: "border-l-border",
  },
  stale: {
    badge: "bg-destructive/10 text-destructive border-destructive/20",
    border: "border-l-destructive",
  },
};

export const FOLDERS_KEY = "flagged.folders.v2";
export const ASSIGNMENTS_KEY = "flagged.assignments.v3";
export const DISMISSED_KEY = "flagged.dismissed.v2";
export const SUPPORT_DOCS_CACHE_KEY = "support.docs.v1";
export const FOLDER_DROP_PREFIX = "folder-drop:";
export const TRASH_DROP_ID = "flagged-trash-drop";

export const defaultDraft: DraftState = {
  open: false,
  instruction: "",
  draft: "",
  loading: false,
  error: null,
  draftId: null,
  phase: "idle",
  sentAt: null,
  supportDocId: null,
};

export const DEFAULT_FOLDERS: FolderDef[] = [
  { id: "needs-review", name: "Needs review" },
  { id: "follow-up", name: "Follow-up" },
];

const ISO_TIMESTAMP_LABEL_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})(?::\d+)?$/i;

// ── Pure utility functions ──

export function toneFor(updatedAt: string): Tone {
  const age = Date.now() - new Date(updatedAt).getTime();
  return age < 24 * 60 * 60 * 1000 ? "fresh" : "stale";
}

export const cleanSenderLabel = (value: string | null | undefined) => {
  const cleaned = (value ?? "")
    .replace(/[‎‏‪-‮]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !cleaned ||
    /^unknown sender$/i.test(cleaned) ||
    /^activity:/i.test(cleaned) ||
    ISO_TIMESTAMP_LABEL_RE.test(cleaned)
  )
    return "";
  return cleaned;
};

export const senderFromThreadId = (threadId: string | null | undefined) => {
  const raw = (threadId ?? "").split("|")[0]?.replace(/^\w+:/, "") ?? "";
  return cleanSenderLabel(raw);
};

export const senderLabelForItem = (
  item: Pick<FlaggedMessage, "sender" | "subject" | "thread_id">,
) =>
  cleanSenderLabel(item.sender) ||
  cleanSenderLabel(item.subject) ||
  senderFromThreadId(item.thread_id);

/** Stable contact key: prefers sender name, falls back to phone
 *  number extracted from the thread_id. Mock data where sender
 *  is null still gets consistent keys across threads. */
export const contactKeyForItem = (
  item: Pick<FlaggedMessage, "sender" | "subject" | "thread_id">,
): string => {
  const label = senderLabelForItem(item);
  if (label) return normalizeLookup(label);
  // Extract phone digits from thread_id as last-resort stable key
  const phone = (item.thread_id ?? "").replace(/\D/g, "");
  return phone || item.thread_id;
};

export const normalizeLookup = (s: string | null | undefined) =>
  cleanSenderLabel(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const normalizePhone = (s: string | null | undefined) =>
  (s ?? "").replace(/\D/g, "");

export const threadContactKey = (threadId: string | null | undefined) =>
  normalizeLookup(senderFromThreadId(threadId));

export const normalizeEventText = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const eventMatchesContact = (
  row: { title?: string | null; contact_name?: string | null; description?: string | null },
  contact: string,
) => {
  const normalizedContact = normalizeEventText(contact);
  if (!normalizedContact) return false;
  const haystack = normalizeEventText(
    `${row.title ?? ""} ${row.contact_name ?? ""} ${row.description ?? ""}`,
  );
  if (haystack.includes(normalizedContact)) return true;
  const contactTokens = normalizedContact
    .split(" ")
    .filter((token) => token.length > 1)
    .slice(0, 3);
  return (
    contactTokens.length > 0 &&
    contactTokens.every((token) => haystack.includes(token))
  );
};

export function isVoiceStub(text: string | null | undefined) {
  const t = (text ?? "").trim();
  if (!t) return true;
  return /^\[voice message[^\]]*\]\s*(\d+×|x\d+)?\s*$/i.test(t);
}

// ── localStorage loaders ──

export function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

export function loadFolders(): FolderDef[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) return DEFAULT_FOLDERS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (f): f is FolderDef =>
          f && typeof f.id === "string" && typeof f.name === "string",
      );
    }
    return DEFAULT_FOLDERS;
  } catch {
    return DEFAULT_FOLDERS;
  }
}

export function loadAssignments(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ASSIGNMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}
