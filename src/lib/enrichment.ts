import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import type { SendSmartUsageRecent } from "@/hooks/useSendSmartUsage";
import {
  cleanSenderLabel,
  senderFromThreadId,
  senderLabelForItem,
  normalizeLookup,
  normalizePhone,
  threadContactKey,
  isVoiceStub,
} from "./flagged-utils";

// ── Lookup key builders ──

export const buildFlaggedKeyList = (item: FlaggedMessage) => {
  const keys = [
    item.thread_id,
    item.sender,
    item.subject,
    senderLabelForItem(item),
    threadContactKey(item.thread_id),
    normalizePhone(item.sender),
    normalizePhone(item.thread_id),
  ];
  return Array.from(new Set(keys.map(normalizeLookup).filter(Boolean)));
};

export const buildActivityKeyList = (r: SendSmartUsageRecent) => {
  const keys = [
    r.thread_id,
    r.threadId,
    r.senderEmail,
    r.sender,
    r.contactName,
    r.subject,
    senderLabelForActivity(r, []),
    threadContactKey(r.thread_id ?? r.threadId),
    normalizePhone(r.senderEmail),
    normalizePhone(r.thread_id ?? r.threadId),
  ];
  return Array.from(new Set(keys.map(normalizeLookup).filter(Boolean)));
};

// ── Activity helpers ──

export const textForActivity = (r: SendSmartUsageRecent) =>
  (r.latestMessage ?? r.preview ?? "").trim();

export const activityThreadId = (r: SendSmartUsageRecent) =>
  (
    (r.thread_id ?? r.threadId) ||
    cleanSenderLabel(r.senderEmail) ||
    cleanSenderLabel(r.sender) ||
    cleanSenderLabel(r.contactName) ||
    cleanSenderLabel(r.subject) ||
    ""
  ).trim();

export const senderLabelForActivity = (
  r: SendSmartUsageRecent,
  rows: SendSmartUsageRecent[] = [],
) => {
  const direct =
    cleanSenderLabel(r.senderEmail) ||
    cleanSenderLabel(r.sender) ||
    cleanSenderLabel(r.contactName) ||
    cleanSenderLabel(r.subject) ||
    senderFromThreadId(r.thread_id ?? r.threadId);
  if (direct) return direct;

  const currentAt = r.createdAt ? new Date(r.createdAt).getTime() : 0;
  const neighbor = rows
    .map((candidate) => ({
      label:
        cleanSenderLabel(candidate.senderEmail) ||
        cleanSenderLabel(candidate.sender) ||
        cleanSenderLabel(candidate.contactName) ||
        cleanSenderLabel(candidate.subject) ||
        senderFromThreadId(candidate.thread_id ?? candidate.threadId),
      distance: Math.abs(
        new Date(candidate.createdAt).getTime() - currentAt,
      ),
    }))
    .filter(
      (candidate) =>
        candidate.label && candidate.distance <= 2 * 60 * 1000,
    )
    .sort((a, b) => a.distance - b.distance)[0];
  return neighbor?.label ?? "";
};

export const isFlaggedActivity = (r: SendSmartUsageRecent) => {
  const decision = (r.decision ?? "").toLowerCase();
  return decision.includes("flagged") || decision.includes("review");
};

// ── Enricher factory ──

export function createEnricher(activityRows: SendSmartUsageRecent[]) {
  // Build a multi-key lookup from the Activity feed so flagged cards can be
  // refreshed by exact thread id, contact name, sender label, or phone number.
  const enrichedByKey = (() => {
    const map = new Map<
      string,
      { text: string; createdAt: number; flagged: boolean }
    >();
    for (const r of activityRows) {
      const text = textForActivity(r);
      if (!text) continue;
      const createdAt = r.createdAt
        ? new Date(r.createdAt).getTime()
        : 0;
      const flagged = isFlaggedActivity(r);
      for (const key of buildActivityKeyList(r)) {
        const existing = map.get(key);
        if (!existing) {
          map.set(key, { text, createdAt, flagged });
          continue;
        }
        const existingIsStub = isVoiceStub(existing.text);
        const candidateIsStub = isVoiceStub(text);
        if (existingIsStub && !candidateIsStub) {
          map.set(key, { text, createdAt, flagged });
        } else if (
          existingIsStub === candidateIsStub &&
          flagged &&
          !existing.flagged
        ) {
          map.set(key, { text, createdAt, flagged });
        } else if (
          existingIsStub === candidateIsStub &&
          flagged === existing.flagged &&
          createdAt > existing.createdAt
        ) {
          map.set(key, { text, createdAt, flagged });
        }
      }
    }
    return map;
  })();

  const activityCandidateFor = (item: FlaggedMessage) =>
    buildFlaggedKeyList(item)
      .map((key) => enrichedByKey.get(key))
      .filter(
        (
          c,
        ): c is {
          text: string;
          createdAt: number;
          flagged: boolean;
        } => Boolean(c),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  const enrichedMessageFor = (item: FlaggedMessage): string | null => {
    const current = (item.latest_message ?? item.preview ?? "").trim();
    const candidate = activityCandidateFor(item);
    if (!candidate) return null;
    if (isVoiceStub(current) && !isVoiceStub(candidate.text)) {
      return candidate.text;
    }
    if (!isVoiceStub(candidate.text) && candidate.text !== current) {
      return candidate.text;
    }
    return null;
  };

  const withActivityPreview = (item: FlaggedMessage): FlaggedMessage => {
    const enriched = enrichedMessageFor(item);
    const activityCreatedAt =
      activityCandidateFor(item)?.createdAt ?? 0;
    if (!enriched && !activityCreatedAt) return item;
    return {
      ...item,
      preview: enriched ?? item.preview,
      latest_message: enriched ?? item.latest_message,
      updated_at: activityCreatedAt
        ? new Date(
            Math.max(
              new Date(item.updated_at).getTime(),
              activityCreatedAt,
            ),
          ).toISOString()
        : item.updated_at,
    };
  };

  return { enrichedMessageFor, withActivityPreview };
}
