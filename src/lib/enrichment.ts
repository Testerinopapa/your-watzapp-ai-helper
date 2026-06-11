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
  VOICE_ENVELOPE_RE,
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

export const textForActivity = (r: SendSmartUsageRecent) => {
  const raw = (r.latestMessage ?? r.preview ?? "").trim();
  // Strip voice-message envelope so "[Voice message 0:05] I need to reschedule"
  // becomes "I need to reschedule" in the enrichment map. Bare stubs like
  // "[Voice message 0:05]" become "" and are skipped by the caller.
  return raw.replace(VOICE_ENVELOPE_RE, "").trim();
};

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
    // candidate.text was already stripped by textForActivity, but strip
    // again here as a belt-and-suspenders in case a non-activity source
    // stores tagged text in the map in the future.
    const cleanCandidate = candidate.text.replace(VOICE_ENVELOPE_RE, "").trim();
    if (!cleanCandidate) return null;
    if (isVoiceStub(current) && cleanCandidate !== current) {
      return cleanCandidate;
    }
    if (cleanCandidate !== current) {
      return cleanCandidate;
    }
    return null;
  };

  const withActivityPreview = (item: FlaggedMessage): FlaggedMessage => {
    const enriched = enrichedMessageFor(item);
    const activityCreatedAt =
      activityCandidateFor(item)?.createdAt ?? 0;

    const rawLatest = (item.latest_message ?? item.preview ?? "").trim();
    const hasVoiceEnvelope = VOICE_ENVELOPE_RE.test(rawLatest);

    // No enrichment match, no activity timestamp, and no voice envelope
    // to clean up — return the item as-is (hot path for normal text messages).
    if (!enriched && !activityCreatedAt && !hasVoiceEnvelope) {
      return item;
    }

    // Strip any voice envelope from the best available text.
    // "enriched" is already clean (textForActivity strips it); rawLatest
    // may still carry the envelope flag.
    let bestText = (enriched ?? rawLatest).replace(VOICE_ENVELOPE_RE, "").trim();

    // If stripping left us with nothing but there WAS a voice envelope,
    // produce a readable label so the card isn't blank.
    if (!bestText && hasVoiceEnvelope) {
      const dur = rawLatest.match(/(\d+:\d{2})/);
      bestText = dur ? `Voice message · ${dur[1]}` : "Voice message";
    }

    // ── ENRICHMENT TRACE ──────────────────────────────────────────────
    const changed =
      enriched !== null ||
      (hasVoiceEnvelope && bestText !== rawLatest) ||
      activityCreatedAt > 0;
    if (changed) {
      console.log(
        "%c🔧 withActivityPreview modified item%c %s | %s",
        "color:#f59e0b;font-weight:bold",
        "color:inherit",
        item.thread_id,
        item.sender ?? "?",
      );
      console.log("  raw latest_message:", JSON.stringify(item.latest_message));
      console.log("  raw preview:", JSON.stringify(item.preview));
      console.log("  hasVoiceEnvelope:", hasVoiceEnvelope);
      console.log("  enriched (from activity):", JSON.stringify(enriched));
      console.log("  bestText:", JSON.stringify(bestText));
      console.log("  recent_messages count:", (item.recent_messages ?? []).length);
    }
    // ── END ENRICHMENT TRACE ──────────────────────────────────────────

    return {
      ...item,
      preview: bestText || item.preview,
      latest_message: bestText || item.latest_message,
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
