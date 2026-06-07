import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";

export interface OutboundAppointmentMessage {
  key: string;
  item: FlaggedMessage;
  text: string;
  incomingMessage: string;
  capturedAt: string;
}

function messageKey(
  item: FlaggedMessage,
  body: string,
  capturedAt: string | null,
) {
  const stableMessagePart = capturedAt || body.toLowerCase();
  return `${item.thread_id}|${stableMessagePart}|${body}`;
}

/**
 * Converts WhatsApp messages authored by the account owner (`from_me`) into
 * inputs for the existing post-draft appointment mutation pipeline.
 */
export function collectOutboundAppointmentMessages(
  items: FlaggedMessage[],
): OutboundAppointmentMessage[] {
  const candidates: OutboundAppointmentMessage[] = [];

  for (const item of items) {
    const messages = (item.recent_messages ?? [])
      .map((message, index) => ({ message, index }))
      .sort((a, b) => {
        const aTime = a.message.captured_at
          ? new Date(a.message.captured_at).getTime()
          : Number.MAX_SAFE_INTEGER;
        const bTime = b.message.captured_at
          ? new Date(b.message.captured_at).getTime()
          : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || a.index - b.index;
      });

    let latestInbound = "";
    for (const { message } of messages) {
      const text = (message.body ?? "").trim();
      if (!text) continue;

      if (message.from_me !== true) {
        latestInbound = text;
        continue;
      }

      const capturedAt = message.captured_at ?? item.updated_at;
      candidates.push({
        key: messageKey(item, text, message.captured_at),
        item,
        text,
        incomingMessage: latestInbound,
        capturedAt,
      });
    }
  }

  return candidates.sort(
    (a, b) =>
      new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  );
}
