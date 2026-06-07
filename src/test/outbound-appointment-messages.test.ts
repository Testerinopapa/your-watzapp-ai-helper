import { describe, expect, it } from "vitest";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import { collectOutboundAppointmentMessages } from "@/lib/outbound-appointment-messages";

function flagged(overrides: Partial<FlaggedMessage> = {}): FlaggedMessage {
  return {
    thread_id: "wa:customer-1",
    provider: "whatsapp",
    sender: "Customer One",
    subject: "Appointment",
    preview: "Can we meet Friday at 3pm?",
    latest_message: "Can we meet Friday at 3pm?",
    intent_category: "appointment",
    intent_confidence: 1,
    intent_reason: null,
    intent_source: "test",
    intent_classified_at: "2026-06-07T12:00:00.000Z",
    updated_at: "2026-06-07T12:00:00.000Z",
    thread_url: null,
    ...overrides,
  };
}

describe("collectOutboundAppointmentMessages", () => {
  it("collects only messages authored by You and preserves the parent thread", () => {
    const item = flagged({
      recent_messages: [
        {
          body: "Can we meet Friday at 3pm?",
          from_me: false,
          captured_at: "2026-06-07T12:00:00.000Z",
        },
        {
          body: "Confirmed, see you Friday at 3pm.",
          from_me: true,
          captured_at: "2026-06-07T12:01:00.000Z",
        },
      ],
    });

    expect(collectOutboundAppointmentMessages([item])).toEqual([
      expect.objectContaining({
        item,
        text: "Confirmed, see you Friday at 3pm.",
        incomingMessage: "Can we meet Friday at 3pm?",
        capturedAt: "2026-06-07T12:01:00.000Z",
      }),
    ]);
  });

  it("uses the nearest earlier inbound message as calendar context", () => {
    const item = flagged({
      recent_messages: [
        {
          body: "Move the appointment.",
          from_me: false,
          captured_at: "2026-06-07T12:00:00.000Z",
        },
        {
          body: "What about Monday?",
          from_me: false,
          captured_at: "2026-06-07T12:02:00.000Z",
        },
        {
          body: "Rescheduled to Monday at 10am.",
          from_me: true,
          captured_at: "2026-06-07T12:03:00.000Z",
        },
      ],
    });

    const [candidate] = collectOutboundAppointmentMessages([item]);
    expect(candidate.incomingMessage).toBe("What about Monday?");
    expect(candidate.item.thread_id).toBe("wa:customer-1");
  });

  it("ignores empty and non-user messages", () => {
    const item = flagged({
      recent_messages: [
        {
          body: "Incoming only",
          from_me: false,
          captured_at: "2026-06-07T12:00:00.000Z",
        },
        {
          body: "   ",
          from_me: true,
          captured_at: "2026-06-07T12:01:00.000Z",
        },
      ],
    });

    expect(collectOutboundAppointmentMessages([item])).toEqual([]);
  });
});
