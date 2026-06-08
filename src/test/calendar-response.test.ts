import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  operations: [] as Array<{ kind: string; payload?: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const selectBuilder = () => {
    const builder = {
      eq: () => builder,
      neq: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (
        resolve: (value: {
          data: Record<string, unknown>[];
          error: null;
        }) => unknown,
      ) =>
        Promise.resolve({
          data: state.rows,
          error: null,
        }).then(resolve),
    };
    return builder;
  };

  return {
    supabase: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1" } },
          error: null,
        })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => selectBuilder()),
        update: vi.fn((payload: unknown) => ({
          eq: vi.fn(async () => {
            state.operations.push({ kind: "update", payload });
            return { error: null };
          }),
        })),
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: "upserted-1" },
              error: null,
            })),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: "inserted-1" },
              error: null,
            })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
      functions: {
        invoke: vi.fn(async (_name: string, options: unknown) => {
          state.operations.push({ kind: "invoke", payload: options });
          return { data: { ok: true }, error: null };
        }),
      },
    },
  };
});

import { handleCalendarAfterDraft } from "@/lib/calendar-response";

function appointment(
  overrides: Partial<FlaggedMessage> = {},
): FlaggedMessage {
  return {
    thread_id: "wa:customer-1",
    provider: "whatsapp",
    sender: "Customer One",
    subject: "Appointment",
    preview: "Appointment message",
    latest_message: "Appointment message",
    intent_category: "appointment",
    intent_confidence: 1,
    intent_reason: null,
    intent_source: "test",
    intent_classified_at: "2026-06-06T12:00:00.000Z",
    updated_at: "2026-06-06T12:00:00.000Z",
    thread_url: null,
    ...overrides,
  };
}

describe("calendar response mutations", () => {
  beforeEach(() => {
    state.rows = [];
    state.operations = [];
  });

  it("asks the edge function to delete and finalize cancellation", async () => {
    state.rows = [
      {
        id: "event-1",
        source_type: "google_calendar",
        source_event_id: "google-event-1",
        status: "confirmed",
        title: "Appointment with Customer One",
        contact_name: "Customer One",
        start_time: "2027-06-10T14:00:00.000Z",
        end_time: "2027-06-10T14:30:00.000Z",
      },
    ];

    await handleCalendarAfterDraft({
      item: appointment({ intent_reason: "Customer wants to cancel" }),
      incomingMessage: "Please cancel my appointment.",
      userInstruction: "Cancel it and update Google Calendar.",
      draftText: "Your appointment has been cancelled.",
      toast: vi.fn(),
    });

    expect(state.operations[0]).toMatchObject({
      kind: "invoke",
      payload: {
        body: {
          agenda_event_id: "event-1",
          source_event_id: "google-event-1",
          action: "delete",
          mark_cancelled: true,
        },
      },
    });
  });

  it("patches Google before committing the rescheduled time locally", async () => {
    state.rows = [
      {
        id: "event-1",
        source_type: "google_calendar",
        source_event_id: "google-event-1",
        status: "confirmed",
        title: "Appointment with Customer One",
        contact_name: "Customer One",
        start_time: "2027-06-10T14:00:00.000Z",
        end_time: "2027-06-10T14:30:00.000Z",
      },
    ];

    await handleCalendarAfterDraft({
      item: appointment({ intent_reason: "Customer wants to reschedule" }),
      incomingMessage: "Please move it to June 12, 2027 at 3pm.",
      userInstruction: "Reschedule it and update Google Calendar.",
      draftText: "Your appointment is rescheduled to June 12, 2027 at 3pm.",
      toast: vi.fn(),
    });

    expect(state.operations.map((operation) => operation.kind)).toEqual([
      "invoke",
      "update",
    ]);
    expect(state.operations[0]).toMatchObject({
      kind: "invoke",
      payload: {
        body: {
          agenda_event_id: "event-1",
          action: "upsert",
          start_time: expect.stringContaining("2027-06-12"),
        },
      },
    });
  });

  it("treats cancelling the old slot plus proposing a new slot as a reschedule", async () => {
    state.rows = [
      {
        id: "event-1",
        source_type: "google_calendar",
        source_event_id: "google-event-1",
        status: "confirmed",
        title: "Appointment with Customer One",
        contact_name: "Customer One",
        start_time: "2027-06-10T14:00:00.000Z",
        end_time: "2027-06-10T14:30:00.000Z",
      },
    ];

    await handleCalendarAfterDraft({
      item: appointment({
        intent_reason:
          "Customer cannot make the current appointment and wants to cancel",
      }),
      incomingMessage:
        "I can't make June 10, 2027 at 2pm. Could we do June 12, 2027 at 3pm instead?",
      userInstruction: "Handle the appointment and update Google Calendar.",
      draftText:
        "I've cancelled the June 10 slot and moved your appointment to June 12, 2027 at 3pm.",
      toast: vi.fn(),
    });

    expect(state.operations.map((operation) => operation.kind)).toEqual([
      "invoke",
      "update",
    ]);
    expect(state.operations[0]).toMatchObject({
      kind: "invoke",
      payload: {
        body: {
          agenda_event_id: "event-1",
          action: "upsert",
          start_time: expect.stringContaining("2027-06-12"),
        },
      },
    });
  });

  it("uses structured confirmation payloads to update and sync an existing thread event", async () => {
    state.rows = [
      {
        id: "event-1",
        source_type: "google_calendar",
        source_event_id: "google-event-1",
        status: "confirmed",
        title: "Old title",
        contact_name: "Customer One",
        start_time: "2027-06-10T14:00:00.000Z",
        end_time: "2027-06-10T14:30:00.000Z",
      },
    ];

    await handleCalendarAfterDraft({
      item: appointment(),
      incomingMessage: "Can we meet next Friday?",
      userInstruction: "",
      draftText: "Done.",
      calendarPayload: {
        intent: "confirmation",
        start_time: "2027-06-12T15:00:00.000Z",
        end_time: "2027-06-12T15:45:00.000Z",
        timezone: "America/New_York",
        title: "Consultation with Customer One",
      },
      toast: vi.fn(),
    });

    expect(state.operations.map((operation) => operation.kind)).toEqual([
      "update",
      "invoke",
    ]);
    expect(state.operations[0]).toMatchObject({
      kind: "update",
      payload: {
        title: "Consultation with Customer One",
        start_time: "2027-06-12T15:00:00.000Z",
        end_time: "2027-06-12T15:45:00.000Z",
        timezone: "America/New_York",
      },
    });
    expect(state.operations[1]).toMatchObject({
      kind: "invoke",
      payload: {
        body: {
          agenda_event_id: "event-1",
          action: "upsert",
          start_time: "2027-06-12T15:00:00.000Z",
          end_time: "2027-06-12T15:45:00.000Z",
          timezone: "America/New_York",
        },
      },
    });
  });
});
