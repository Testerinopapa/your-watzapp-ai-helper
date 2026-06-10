import { supabase } from "@/integrations/supabase/client";
import type { FlaggedMessage } from "@/hooks/useFlaggedMessages";
import {
  senderLabelForItem,
  normalizeEventText,
  eventMatchesContact,
} from "./flagged-utils";
import {
  extractDateTime,
  type ExtractedDateTime,
  looksLikeConfirmation,
  looksLikeCancellation,
  looksLikeReschedule,
} from "./extractDateTime";
import { functionErrorCode } from "./function-error";
import { notifyAgendaEventsChanged } from "./agenda-events";

// ── Intent classification ──

export type CalendarMutationIntent =
  | "confirmation"
  | "cancellation"
  | "reschedule"
  | "none";

export interface CalendarMutationPayload {
  intent: CalendarMutationIntent;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  title?: string | null;
  confidence?: string | null;
}

function extractedFromPayload(
  calendarPayload?: CalendarMutationPayload | null,
): ExtractedDateTime | null {
  if (!calendarPayload?.start_time) return null;
  const date = new Date(calendarPayload.start_time);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date,
    source: "structured calendar payload",
    confidence: "high",
  };
}

function endDateFromPayload(
  calendarPayload: CalendarMutationPayload | null | undefined,
  startDate: Date | null,
): Date | null {
  if (!calendarPayload?.end_time) return null;
  const date = new Date(calendarPayload.end_time);
  if (Number.isNaN(date.getTime())) return null;
  if (startDate && date.getTime() <= startDate.getTime()) return null;
  return date;
}

function timezoneForPayload(calendarPayload?: CalendarMutationPayload | null) {
  return (
    calendarPayload?.timezone?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  );
}

function classifyDraftIntent(
  item: FlaggedMessage,
  incomingMessage: string,
  userInstruction: string,
  draftText: string,
) {
  const intentTextForSignal = `${incomingMessage}\n${userInstruction}`;
  const reasonText = String(item.intent_reason ?? "").toLowerCase();

  const reasonMentionsReschedule =
    /\b(reschedul|move|postpone|push back|shift|change (?:the |our )?(?:time|date|appointment|meeting)|spostare|rinviare|reprogramar)\b/i.test(
      reasonText,
    );
  const reasonMentionsCancel =
    /\b(cancel|call off|drop|annull|disd|rinunci|cancelar|anular)\b/i.test(
      reasonText,
    );
  const classifiedCancel =
    reasonMentionsCancel && !reasonMentionsReschedule;
  const classifiedReschedule = reasonMentionsReschedule;

  const draftReschedule = looksLikeReschedule(draftText);
  const draftCancel = looksLikeCancellation(draftText);
  const intentReschedule = looksLikeReschedule(intentTextForSignal);
  const intentCancel = looksLikeCancellation(intentTextForSignal);

  // A replacement time makes this a reschedule even when the old slot is
  // described as cancelled. Only delete when no reschedule signal exists.
  const rescheduleSignal =
    classifiedReschedule || draftReschedule || intentReschedule;
  const cancelSignal =
    !rescheduleSignal &&
    (classifiedCancel || draftCancel || intentCancel);

  console.log(
    "[flagged] draft sent, isScheduling:",
    true,
    "| confirm:",
    looksLikeConfirmation(draftText),
    "| cancel:",
    cancelSignal,
    "| reschedule:",
    rescheduleSignal,
    "| classifiedC/R:",
    classifiedCancel,
    classifiedReschedule,
    "| draftR/C:",
    draftReschedule,
    draftCancel,
    "| intentR/C:",
    intentReschedule,
    intentCancel,
    "| reason:",
    reasonText.slice(0, 160),
    "| draft:",
    draftText.slice(0, 200),
  );

  return { cancel: cancelSignal, reschedule: rescheduleSignal };
}

// ── Calendar mutation handlers ──

async function cancelAppointment(
  item: FlaggedMessage,
  incomingMessage: string,
  userInstruction: string,
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }) => void,
) {
  console.log("[flagged][cancel] entering cancel branch", {
    thread_id: item.thread_id,
  });
  try {
    const { data: userData, error: userErr } =
      await supabase.auth.getUser();
    console.log("[flagged][cancel] auth", {
      user_id: userData?.user?.id,
      userErr,
    });
    if (userData.user) {
      const { data: existingRows, error: rowErr } = await supabase
        .from("agenda_events")
        .select("id, source_type, source_event_id, status, title, contact_name, description, start_time, end_time")
        .eq("thread_id", item.thread_id)
        .eq("user_id", userData.user.id);
      console.log("[flagged][cancel] db lookup", {
        count: existingRows?.length ?? 0,
        existingRows,
        rowErr,
      });

      let toCancel = (existingRows ?? []).filter(
        (r) => r.status !== "cancelled",
      );

      if ((existingRows ?? []).length > 0 && toCancel.length === 0) {
        const staleGoogleRows = (existingRows ?? []).filter(
          (row) =>
            row.status === "cancelled" &&
            row.source_type === "google_calendar" &&
            Boolean(row.source_event_id),
        );

        if (staleGoogleRows.length > 0) {
          let cleaned = 0;
          for (const row of staleGoogleRows) {
            const { data: pushData, error: pushErr } =
              await supabase.functions.invoke("google-calendar-push", {
                body: {
                  agenda_event_id: row.id,
                  source_event_id: row.source_event_id,
                  action: "delete",
                  mark_cancelled: true,
                },
              });
            const errCode = await functionErrorCode(pushData, pushErr);
            if (pushErr || errCode) continue;

            await supabase
              .from("agenda_events")
              .update({ source_event_id: null })
              .eq("id", row.id);
            cleaned += 1;
          }

          toast({
            title:
              cleaned === staleGoogleRows.length
                ? "Calendar cleanup completed"
                : "Calendar cleanup incomplete",
            description:
              cleaned === staleGoogleRows.length
                ? "The cancelled appointment was removed from Google Calendar."
                : "Some cancelled calendar entries could not be removed. Please retry.",
            variant:
              cleaned === staleGoogleRows.length
                ? "default"
                : "destructive",
          });
          if (cleaned > 0) notifyAgendaEventsChanged();
          return;
        }

        console.log(
          "[flagged][cancel] all events already cancelled for thread",
        );
        toast({
          title: "Already cancelled",
          description:
            "This appointment was already cancelled in a previous action.",
        });
        return;
      } else if (toCancel.length === 0) {
        const cancellationTime = extractDateTime(
          incomingMessage,
          userInstruction,
          item.subject,
        );
        const contact = senderLabelForItem(item);
        console.log(
          "[flagged][cancel] thread lookup empty; trying date/contact fallback",
          {
            extracted: cancellationTime
              ? {
                  iso: cancellationTime.date.toISOString(),
                  source: cancellationTime.source,
                  confidence: cancellationTime.confidence,
                }
              : null,
            contact,
          },
        );

        if (cancellationTime) {
          const windowStart = new Date(
            cancellationTime.date.getTime() -
              12 * 60 * 60 * 1000,
          ).toISOString();
          const windowEnd = new Date(
            cancellationTime.date.getTime() +
              12 * 60 * 60 * 1000,
          ).toISOString();
          const { data: fallbackRows, error: fallbackErr } =
            await supabase
              .from("agenda_events")
              .select(
                "id, source_type, source_event_id, status, title, contact_name, description, start_time, end_time",
              )
              .eq("user_id", userData.user.id)
              .neq("status", "cancelled")
              .gte("start_time", windowStart)
              .lte("start_time", windowEnd)
              .order("start_time", { ascending: true })
              .limit(50);

          const matchedFallbackRows = (fallbackRows ?? []).filter(
            (r) => eventMatchesContact(r, contact),
          );
          console.log(
            "[flagged][cancel] date/contact fallback lookup",
            {
              windowStart,
              windowEnd,
              fallbackCount: fallbackRows?.length ?? 0,
              matchedCount: matchedFallbackRows.length,
              fallbackRows,
              fallbackErr,
            },
          );
          if (matchedFallbackRows.length > 1) {
            toast({
              title: "Cancellation needs review",
              description:
                "More than one appointment matches this contact and time. Open the Agenda panel and choose the event to cancel.",
              variant: "destructive",
            });
            return;
          }
          toCancel = matchedFallbackRows;
        }

        // Last-resort fallback: search broadly by contact name only.
        if (toCancel.length === 0 && contact) {
          const broadStart = new Date(
            Date.now() - 24 * 60 * 60 * 1000,
          ).toISOString();
          const broadEnd = new Date(
            Date.now() + 180 * 24 * 60 * 60 * 1000,
          ).toISOString();
          const { data: contactRows, error: contactErr } =
            await supabase
              .from("agenda_events")
              .select(
                "id, source_type, source_event_id, status, title, contact_name, description, start_time, end_time",
              )
              .eq("user_id", userData.user.id)
              .neq("status", "cancelled")
              .gte("start_time", broadStart)
              .lte("start_time", broadEnd)
              .order("start_time", { ascending: true })
              .limit(500);

          const matchedByContact = (contactRows ?? []).filter(
            (r) => eventMatchesContact(r, contact),
          );
          console.log(
            "[flagged][cancel] contact-only fallback lookup",
            {
              contactCount: contactRows?.length ?? 0,
              matchedCount: matchedByContact.length,
              matched: matchedByContact,
              contactErr,
            },
          );

          if (matchedByContact.length > 0) {
            if (cancellationTime) {
              const target = cancellationTime.date.getTime();
              matchedByContact.sort((a, b) => {
                const da = Math.abs(
                  new Date(a.start_time as string).getTime() -
                    target,
                );
                const db = Math.abs(
                  new Date(b.start_time as string).getTime() -
                    target,
                );
                return da - db;
              });
              toCancel = [matchedByContact[0]];
            } else if (matchedByContact.length === 1) {
              toCancel = [matchedByContact[0]];
            } else {
              console.warn(
                "[flagged][cancel] contact fallback is ambiguous; refusing to choose",
                {
                  contact,
                  matchedIds: matchedByContact.map((row) => row.id),
                },
              );
            }
            if (toCancel.length > 0) {
              console.log(
                "[flagged][cancel] contact-only fallback chose",
                toCancel,
              );
            }
          }
        }
      }

      if (toCancel.length === 0) {
        console.log(
          "[flagged][cancel] nothing to cancel for thread",
        );
        toast({
          title: "Reply sent (no event found)",
          description:
            "No existing appointment was found for this thread to cancel.",
        });
      } else {
        let calendarFailures = 0;
        let calendarSuccesses = 0;
        let titleForToast = "Appointment";

        for (const existing of toCancel) {
          titleForToast = existing.title || titleForToast;
          const sourceEventId =
            existing.source_type === "google_calendar"
              ? existing.source_event_id
              : null;
          let googleDeleteSucceeded = true;

          if (sourceEventId) {
            console.log(
              "[flagged][cancel] invoking google-calendar-push",
              {
                agenda_event_id: existing.id,
                source_event_id: sourceEventId,
                action: "delete",
              },
            );
            const { data: pushData, error: pushErr } =
              await supabase.functions.invoke(
                "google-calendar-push",
                {
                  body: {
                    agenda_event_id: existing.id,
                    source_event_id: sourceEventId,
                    action: "delete",
                    mark_cancelled: true,
                  },
                },
              );
            const errCode = await functionErrorCode(pushData, pushErr);
            console.log(
              "[flagged][cancel] google-calendar-push response",
              {
                id: existing.id,
                pushData,
                pushErr,
                errCode,
              },
            );
            if (pushErr || errCode) {
              calendarFailures += 1;
              googleDeleteSucceeded = false;
              console.warn(
                "[flagged][cancel] calendar delete FAILED",
                pushErr ?? errCode,
              );
            } else {
              calendarSuccesses += 1;
            }
          }

          const shouldCommitLocalCancellation =
            !sourceEventId || googleDeleteSucceeded;
          const { error: updateErr } = shouldCommitLocalCancellation
            ? await supabase
                .from("agenda_events")
                .update({ status: "cancelled", source_event_id: null })
                .eq("id", existing.id)
            : { error: null };
          console.log(
            "[flagged][cancel] row updated to cancelled",
            {
              id: existing.id,
              updateErr,
            },
          );
        }

        if (calendarFailures > 0 && calendarSuccesses === 0) {
          toast({
            title: "Marked cancelled locally",
            description:
              "Google Calendar removal skipped.",
          });
        } else {
          toast({
            title:
              calendarSuccesses > 0
                ? "Cancelled & removed from Google Calendar"
                : "Appointment cancelled",
            description: `${titleForToast} has been cancelled${
              toCancel.length > 1
                ? ` (${toCancel.length} entries)`
                : ""
            }.`,
          });
        }
        notifyAgendaEventsChanged();
      }
    }
  } catch (e) {
    console.warn("[flagged][cancel] threw exception", e);
    toast({
      title: "Reply sent, cancellation skipped",
      description:
        (e as Error)?.message?.slice(0, 120) ??
        "Could not update calendar.",
      variant: "destructive",
    });
  }
}

/**
 * Attempt to find the NEW proposed date in a reschedule draft.
 *
 * Reschedule drafts almost always mention the OLD date first ("cancel
 * Thursday 4 June") and the NEW date second ("Both Thursday 11 and
 * Friday 12 June at 10am"). Standard extractDateTime returns the first
 * date it finds, which gives us the cancellation date — exactly wrong.
 *
 * Strategy:
 *  1. Strip everything up through the first sentence that contains
 *     cancellation language, then extract from the remainder.
 *  2. If that yields nothing, process sentences from the END backwards.
 *  3. Fall back to extracting from the full draft + other inputs.
 */
function extractNewDateForReschedule(
  draftText: string,
  incomingMessage: string,
  userInstruction: string,
  subject: string | null | undefined,
): ReturnType<typeof extractDateTime> {
  // Step 1: prefer text after language that introduces the replacement slot.
  for (const text of [draftText, incomingMessage, userInstruction]) {
    const extracted = extractAfterRescheduleMarker(text);
    if (extracted) {
      console.log(
        "[flagged][reschedule] extracted after reschedule marker",
        { iso: extracted.date.toISOString(), source: extracted.source },
      );
      return extracted;
    }
  }

  // Step 2: try the portion of the draft after cancellation language.
  const cancelEnd = findCancelClauseEnd(draftText);
  if (cancelEnd > 0) {
    const afterCancel = draftText.slice(cancelEnd).trim();
    if (afterCancel.length > 10) {
      const extracted = extractDateTime(afterCancel);
      if (extracted) {
        console.log(
          "[flagged][reschedule] extracted from post-cancel portion",
          { iso: extracted.date.toISOString(), source: extracted.source },
        );
        return extracted;
      }
    }
  }

  // Step 3: walk sentences from the end backwards.
  const sentences = draftText.split(/[.!?]\s+/);
  for (let i = sentences.length - 1; i >= 0; i--) {
    const extracted = extractDateTime(sentences[i]);
    if (extracted) {
      console.log(
        "[flagged][reschedule] extracted from sentence",
        { i, sentence: sentences[i].slice(0, 80), iso: extracted.date.toISOString(), source: extracted.source },
      );
      return extracted;
    }
  }

  // Step 4: standard extraction on the full draft.
  const extracted = extractDateTime(draftText, incomingMessage, userInstruction, subject);
  if (extracted) {
    console.log(
      "[flagged][reschedule] extracted from full text (fallback)",
      { iso: extracted.date.toISOString(), source: extracted.source },
    );
  }
  return extracted;
}

function extractAfterRescheduleMarker(
  text: string,
): ReturnType<typeof extractDateTime> {
  const markerPatterns = [
    /\b(?:reschedul(?:e|ed|ing)|mov(?:e|ed|ing)|chang(?:e|ed|ing)|shift(?:ed|ing)?|push(?:ed|ing)?(?:\s+back)?)\b[^.!?\n]{0,100}?\b(?:to|for)\b/gi,
    /\b(?:could|can|shall|would)\s+we\s+(?:do|make|try|use)\b/gi,
    /\b(?:how|what)\s+about\b/gi,
    /\b(?:new|another|different)\s+(?:time|date|day|slot)\b(?:\s+(?:at|on|for))?/gi,
  ];
  const markerEnds: number[] = [];

  for (const pattern of markerPatterns) {
    for (const match of text.matchAll(pattern)) {
      markerEnds.push((match.index ?? 0) + match[0].length);
    }
  }

  markerEnds.sort((a, b) => b - a);
  for (const markerEnd of markerEnds) {
    const extracted = extractDateTime(text.slice(markerEnd));
    if (extracted) return extracted;
  }

  return null;
}

/** Find where the cancellation clause ends in a reschedule draft.
 *  Returns the index after the sentence containing cancel language,
 *  or -1 if no clear cancellation clause is found. */
function findCancelClauseEnd(text: string): number {
  const cancelPatterns = [
    /\b(?:I(?:'ve|\s+have)\s+noted\s+that\s+you\s+need\s+to\s+cancel)[^.]*\.[\s\n]*/i,
    /\b(?:need\s+to\s+cancel)[^.]*\.[\s\n]*/i,
    /\b(?:cancel\s+(?:your|the|our|my)\s+(?:appointment|booking|reservation|meeting))[^.]*\.[\s\n]*/i,
    /\b(?:can(?:'t|not)\s+make\s+it)[^.]*\.[\s\n]*/i,
    /\b(?:won(?:'t|\s+not)\s+be\s+able)[^.]*\.[\s\n]*/i,
    /\b(?:have\s+to\s+cancel)[^.]*\.[\s\n]*/i,
    /\b(?:noted\s+that\s+you)[^.]*\.[\s\n]*/i,
    /\b(?:sorry.*(?:cancel|cannot|can't))[^.]*\.[\s\n]*/i,
    /\b(?:unfortunately.*(?:cancel|cannot|can't))[^.]*\.[\s\n]*/i,
  ];

  for (const pat of cancelPatterns) {
    const m = pat.exec(text);
    if (m) return m.index + m[0].length;
  }
  return -1;
}

async function rescheduleAppointment(
  item: FlaggedMessage,
  incomingMessage: string,
  userInstruction: string,
  draftText: string,
  reasonText: string,
  calendarPayload: CalendarMutationPayload | null | undefined,
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }) => void,
) {
  console.log("[flagged][reschedule] entering reschedule branch", {
    thread_id: item.thread_id,
    sender: item.sender,
    draft: draftText.slice(0, 200),
    reason: reasonText.slice(0, 160),
  });
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    // 1. Extract the NEW time (not the cancellation date).
    //    Reschedule drafts mention the OLD date first and the NEW date
    //    second. extractNewDateForReschedule handles this by looking past
    //    cancellation language and searching sentences from the end.
    let extracted =
      extractedFromPayload(calendarPayload) ??
      extractNewDateForReschedule(
        draftText,
        incomingMessage,
        userInstruction,
        item.subject,
      );
    console.log("[flagged][reschedule] pass 1 (draft, reschedule-aware)", {
      extracted: extracted
        ? {
            iso: extracted.date.toISOString(),
            source: extracted.source,
          }
        : null,
    });
    if (!extracted) {
      extracted = extractDateTime(
        incomingMessage,
        userInstruction,
        item.subject,
      );
      console.log(
        "[flagged][reschedule] pass 2 (contact+instruction)",
        {
          extracted: extracted
            ? {
                iso: extracted.date.toISOString(),
                source: extracted.source,
              }
            : null,
        },
      );
    }
    if (!extracted) {
      console.log(
        "[flagged][reschedule] no time parsed, skipping new event",
      );
      toast({
        title: "Reply sent, time unclear",
        description:
          "Could not determine the new appointment time. Set it manually in the Agenda panel.",
      });
      return;
    }

    const tz = timezoneForPayload(calendarPayload);

    // 2. Find the event to reschedule
    let { data: existingRows } = await supabase
      .from("agenda_events")
      .select(
        "id, source_type, source_event_id, status, title, contact_name, description, start_time, end_time",
      )
      .eq("thread_id", item.thread_id)
      .eq("user_id", userData.user.id)
      .neq("status", "cancelled")
      .order("start_time", { ascending: true });

    // Fallback: search by contact name + extracted time window.
    const contact = senderLabelForItem(item);
    if (
      (existingRows ?? []).length === 0 &&
      contact &&
      extracted
    ) {
      const windowStart = new Date(
        extracted.date.getTime() - 14 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const windowEnd = new Date(
        extracted.date.getTime() + 14 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data: fallbackRows } = await supabase
        .from("agenda_events")
        .select(
          "id, source_type, source_event_id, status, title, contact_name, description, start_time, end_time",
        )
        .eq("user_id", userData.user.id)
        .neq("status", "cancelled")
        .gte("start_time", windowStart)
        .lte("start_time", windowEnd)
        .order("start_time", { ascending: true })
        .limit(500);
      const matched = (fallbackRows ?? []).filter((r) =>
        eventMatchesContact(r, contact),
      );
      console.log(
        "[flagged][reschedule] thread_id found nothing; contact fallback",
        {
          contact,
          windowStart,
          windowEnd,
          fallbackCount: fallbackRows?.length ?? 0,
          matchedCount: matched.length,
        },
      );
      if (matched.length > 1) {
        toast({
          title: "Reschedule needs review",
          description:
            "More than one appointment matches this contact. Open the Agenda panel and choose the appointment to move.",
          variant: "destructive",
        });
        return;
      }
      existingRows = matched;
    }

    console.log("[flagged][reschedule] existing events", {
      count: existingRows?.length ?? 0,
      rows: existingRows,
    });

    const googleLinkedRows = (existingRows ?? []).filter(
      (r) =>
        r.source_type === "google_calendar" &&
        Boolean(r.source_event_id),
    );
    if (googleLinkedRows.length > 1) {
      toast({
        title: "Reschedule needs review",
        description:
          "This thread is linked to multiple Google Calendar events. Open the Agenda panel and choose the event to move.",
        variant: "destructive",
      });
      return;
    }
    const existingWithGoogle = googleLinkedRows[0];
    const others = (existingRows ?? []).filter(
      (r) => r !== existingWithGoogle,
    );

    // ── PATCH path ──
    if (existingWithGoogle) {
      console.log(
        "[flagged][reschedule] PATCHING existing event",
        {
          id: existingWithGoogle.id,
          source_event_id: existingWithGoogle.source_event_id,
          old_start: existingWithGoogle.start_time,
          new_start: extracted.date.toISOString(),
        },
      );

      // Guard: if extracted time matches existing, re-extract from draft only.
      const extMs = extracted.date.getTime();
      const sameAsExisting = (existingRows ?? []).some(
        (r) =>
          r.start_time &&
          Math.abs(
            new Date(r.start_time).getTime() - extMs,
          ) < 60_000,
      );
      if (sameAsExisting) {
        console.log(
          "[flagged][reschedule] extracted time matches existing — re-extracting from draft only",
        );
        const reExtracted = extractNewDateForReschedule(
          draftText,
          incomingMessage,
          userInstruction,
          item.subject,
        );
        if (reExtracted) {
          extracted = reExtracted;
          console.log(
            "[flagged][reschedule] re-extracted new time",
            {
              iso: extracted.date.toISOString(),
              source: extracted.source,
            },
          );
        }
        if (
          existingWithGoogle.start_time &&
          Math.abs(
            new Date(existingWithGoogle.start_time).getTime() -
              extracted.date.getTime(),
          ) < 60_000
        ) {
          toast({
            title: "Reply sent, new time unclear",
            description:
              "The proposed time matches the current appointment, so Google Calendar was not changed.",
            variant: "destructive",
          });
          return;
        }
      }

      const keepTitle =
        existingWithGoogle.title?.trim() ||
        (item.sender
          ? `Appointment with ${item.sender}`
          : "Appointment");
      const payloadEnd = endDateFromPayload(calendarPayload, extracted.date);
      const durationMs =
        payloadEnd
          ? payloadEnd.getTime() - extracted.date.getTime()
          : existingWithGoogle.start_time && existingWithGoogle.end_time
          ? Math.max(
              30 * 60 * 1000,
              new Date(existingWithGoogle.end_time).getTime() -
                new Date(existingWithGoogle.start_time).getTime(),
            )
          : 30 * 60 * 1000;
      const newStart = extracted.date.toISOString();
      const newEnd =
        payloadEnd?.toISOString() ??
        new Date(extracted.date.getTime() + durationMs).toISOString();

      console.log(
        "[flagged][reschedule] calling google-calendar-push upsert (PATCH)",
        {
          agenda_event_id: existingWithGoogle.id,
          start_time: extracted.date.toISOString(),
          timezone: tz,
        },
      );
      const { data: pushData, error: pushErr } =
        await supabase.functions.invoke(
          "google-calendar-push",
          {
            body: {
              agenda_event_id: existingWithGoogle.id,
              action: "upsert",
              start_time: newStart,
              end_time: newEnd,
              timezone: tz,
            },
          },
        );
      const errCode = await functionErrorCode(pushData, pushErr);
      console.log(
        "[flagged][reschedule] google-calendar-push upsert response",
        {
          pushData,
          pushErr,
          errCode,
        },
      );

      if (pushErr || errCode) {
        toast({
          title: "Reply sent, Google Calendar unchanged",
          description:
            errCode === "not_connected"
              ? "Connect Google Calendar, then retry the reschedule."
              : "Google Calendar rejected the new time. The existing appointment was left unchanged.",
          variant: "destructive",
        });
      } else {
        const { error: updErr } = await supabase
          .from("agenda_events")
          .update({
            start_time: newStart,
            end_time: newEnd,
            timezone: tz,
            status: "confirmed",
            title: keepTitle,
          })
          .eq("id", existingWithGoogle.id);
        if (updErr) throw updErr;

        for (const other of others) {
          if (other.source_type === "google_calendar") continue;
          await supabase
            .from("agenda_events")
            .update({
              status: "cancelled",
              source_event_id: null,
            })
            .eq("id", other.id);
        }

        toast({
          title: "Rescheduled & synced to Google Calendar",
          description: `${keepTitle} moved to a new time.`,
        });
        notifyAgendaEventsChanged();
      }
      return;
    }

    // ── DELETE+CREATE path ──
    console.log(
      "[flagged][reschedule] no Google-linked event, using delete+create",
    );

    // Build title from existing event if available.
    const bestExisting = (existingRows ?? []).find(
      (r) =>
        r.title?.trim() &&
        r.title.trim().toLowerCase() !==
          "reschedule appointment",
    );
    const title =
      calendarPayload?.title?.trim() ||
      bestExisting?.title?.trim() ||
      (item.sender
        ? `Appointment with ${item.sender}`
        : "Appointment");
    const newStart = extracted.date.toISOString();
    const payloadEnd = endDateFromPayload(calendarPayload, extracted.date);
    const newEnd =
      payloadEnd?.toISOString() ??
      new Date(extracted.date.getTime() + 30 * 60 * 1000).toISOString();

    const newEvent = {
      user_id: userData.user.id,
      source_type: "whatsapp",
      source_event_id: `${item.thread_id}:rescheduled:${Date.now()}`,
      thread_id: item.thread_id,
      contact_name: item.sender ?? null,
      contact_channel: item.provider ?? null,
      title,
      description: (item.preview ??
        item.latest_message ??
        null) as string | null,
      start_time: newStart,
      end_time: newEnd,
      timezone: tz,
      status: "confirmed",
      imported_at: new Date().toISOString(),
    };

    console.log(
      "[flagged][reschedule] inserting new event",
      newEvent,
    );
    const { data: inserted, error: insErr } = await supabase
      .from("agenda_events")
      .insert(newEvent)
      .select("id")
      .single();

    console.log("[flagged][reschedule] insert result", {
      inserted,
      insErr,
    });

    if (insErr) throw insErr;

    if (inserted?.id) {
      console.log(
        "[flagged][reschedule] calling google-calendar-push upsert (insert)",
        {
          agenda_event_id: inserted.id,
          start_time: extracted.date.toISOString(),
          timezone: tz,
        },
      );
      const { data: pushData, error: pushErr } =
        await supabase.functions.invoke(
          "google-calendar-push",
          {
            body: {
              agenda_event_id: inserted.id,
              action: "upsert",
              start_time: newStart,
              end_time: newEnd,
              timezone: tz,
            },
          },
        );
      const errCode = await functionErrorCode(pushData, pushErr);
      console.log(
        "[flagged][reschedule] google-calendar-push upsert response",
        {
          pushData,
          pushErr,
          errCode,
        },
      );
      if (pushErr || errCode) {
        await supabase
          .from("agenda_events")
          .delete()
          .eq("id", inserted.id);
        toast({
          title: "Reply sent, Google Calendar unchanged",
          description:
            errCode === "not_connected"
              ? "Connect Google Calendar, then retry the reschedule."
              : "Google Calendar rejected the new time. The existing appointment was left unchanged.",
          variant: "destructive",
        });
      } else {
        for (const existing of existingRows ?? []) {
          await supabase
            .from("agenda_events")
            .update({
              status: "cancelled",
              source_event_id: null,
            })
            .eq("id", existing.id);
        }
        toast({
          title: "Rescheduled & synced to Google Calendar",
          description: `${title} moved to a new time.`,
        });
        notifyAgendaEventsChanged();
      }
    }
  } catch (e) {
    console.warn("[flagged] failed to reschedule event", e);
    toast({
      title: "Reply sent, reschedule skipped",
      description:
        (e as Error)?.message?.slice(0, 120) ??
        "Could not update calendar.",
      variant: "destructive",
    });
  }
}

async function confirmAppointment(
  item: FlaggedMessage,
  incomingMessage: string,
  userInstruction: string,
  draftText: string,
  calendarPayload: CalendarMutationPayload | null | undefined,
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }) => void,
) {
  // Two-pass: contact message + instruction first, fall back to draft.
  let extracted = extractedFromPayload(calendarPayload);
  if (extracted) {
    console.log("[flagged] confirmation structured payload", extracted);
  } else {
    extracted = extractDateTime(incomingMessage, userInstruction);
    console.log(
      "[flagged] confirmation pass 1 (contact+instruction)",
      extracted,
    );
  }
  if (!extracted) {
    extracted = extractDateTime(draftText, item.subject);
    console.log(
      "[flagged] confirmation pass 2 (draft+subject)",
      extracted,
    );
  }
  console.log(
    "[flagged] confirmation block entered, extracted:",
    extracted,
  );
  const tz = timezoneForPayload(calendarPayload);
  const title =
    calendarPayload?.title?.trim() ||
    item.subject?.trim() ||
    (item.sender
      ? `Appointment with ${item.sender}`
      : "Appointment");
  const payloadEnd = endDateFromPayload(
    calendarPayload,
    extracted?.date ?? null,
  );

  const eventRow: Record<string, unknown> = {
    source_type: "whatsapp",
    source_event_id: item.thread_id,
    thread_id: item.thread_id,
    contact_name: item.sender ?? null,
    contact_channel: item.provider ?? null,
    title,
    description: (item.preview ??
      item.latest_message ??
      null) as string | null,
    start_time: extracted?.date.toISOString() ?? null,
    end_time: payloadEnd?.toISOString() ?? null,
    timezone: extracted ? tz : null,
    status: "confirmed",
    imported_at: new Date().toISOString(),
  };

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      eventRow.user_id = userData.user.id;

      const { data: existingRows, error: lookupErr } = await supabase
        .from("agenda_events")
        .select("id, source_type, source_event_id, status")
        .eq("thread_id", item.thread_id)
        .eq("user_id", userData.user.id)
        .neq("status", "cancelled")
        .order("updated_at", { ascending: false })
        .limit(1);

      if (lookupErr) throw lookupErr;

      const existing = (existingRows ?? [])[0] as
        | { id: string; source_type?: string | null }
        | undefined;
      let agendaEventId = existing?.id ?? null;

      if (existing) {
        const updateRow = { ...eventRow };
        delete updateRow.source_type;
        delete updateRow.source_event_id;
        if (!extracted) {
          delete updateRow.start_time;
          delete updateRow.end_time;
          delete updateRow.timezone;
        } else if (!payloadEnd) {
          delete updateRow.end_time;
        }
        const { error: updErr } = await supabase
          .from("agenda_events")
          .update(updateRow as never)
          .eq("id", existing.id);
        if (updErr) throw updErr;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("agenda_events")
          .upsert(eventRow as never, {
            onConflict: "user_id,source_type,source_event_id",
            ignoreDuplicates: false,
          })
          .select("id")
          .single();

        if (insErr) throw insErr;
        agendaEventId = inserted?.id ?? null;
      }

      if (agendaEventId && extracted) {
        console.log(
          "[flagged][confirm] calling google-calendar-push upsert",
          {
            agenda_event_id: agendaEventId,
            start_time: extracted.date.toISOString(),
            end_time: payloadEnd?.toISOString() ?? null,
            timezone: tz,
          },
        );
        const { data: pushData, error: pushErr } =
          await supabase.functions.invoke(
            "google-calendar-push",
            {
              body: {
                agenda_event_id: agendaEventId,
                action: "upsert",
                start_time: extracted.date.toISOString(),
                end_time: payloadEnd?.toISOString() ?? undefined,
                timezone: tz,
              },
            },
          );
        const errCode = await functionErrorCode(pushData, pushErr);
        if (pushErr || errCode) {
          console.warn(
            "[flagged] calendar push failed after draft",
            pushErr ?? errCode,
          );
          toast({
            title: extracted
              ? "Saved to agenda (Google sync skipped)"
              : "Added to agenda",
            description:
              errCode === "not_connected"
                ? "Connect Google Calendar to sync."
                : "Calendar event saved locally.",
          });
        } else {
          toast({
            title: "Confirmed & synced to Google Calendar",
            description: `${title} added to your calendar.`,
          });
          notifyAgendaEventsChanged();
        }
      } else if (agendaEventId) {
        toast({
          title: "Added to agenda (needs time)",
          description: `${title} — set a time in the Agenda panel to sync.`,
        });
      }
    }
  } catch (e) {
    console.warn(
      "[flagged] failed to push booking to calendar",
      e,
    );
    toast({
      title: "Reply sent, calendar update skipped",
      description:
        (e as Error)?.message?.slice(0, 120) ??
        "Could not update calendar.",
      variant: "destructive",
    });
  }
}

// ── Public entry point ──

export async function handleCalendarAfterDraft({
  item,
  incomingMessage,
  userInstruction,
  draftText,
  calendarPayload,
  toast,
}: {
  item: FlaggedMessage;
  incomingMessage: string;
  userInstruction: string;
  draftText: string;
  calendarPayload?: CalendarMutationPayload | null;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }) => void;
}) {
  const classified = classifyDraftIntent(
    item,
    incomingMessage,
    userInstruction,
    draftText,
  );
  const payloadIntent = calendarPayload?.intent ?? null;
  const cancel =
    payloadIntent === "cancellation" ||
    (!payloadIntent && classified.cancel);
  const reschedule =
    payloadIntent === "reschedule" ||
    (!payloadIntent && classified.reschedule);
  const confirmation =
    payloadIntent === "confirmation" ||
    (!payloadIntent && looksLikeConfirmation(draftText));

  console.log("[flagged][calendar-response] intent routing decision", {
    thread_id: item.thread_id,
    sender: item.sender,
    has_payload: !!calendarPayload,
    payload_intent: payloadIntent,
    classified_cancel: classified.cancel,
    classified_reschedule: classified.reschedule,
    classified_confirm: confirmation,
    chosen_cancel: cancel,
    chosen_reschedule: reschedule,
    chosen_confirm: confirmation,
    chosen_none: !cancel && !reschedule && !confirmation,
    draft_preview: draftText.slice(0, 200),
    incoming_preview: incomingMessage.slice(0, 200),
    user_instruction_preview: userInstruction.slice(0, 100),
  });

  const reasonText = String(item.intent_reason ?? "");

  if (cancel) {
    await cancelAppointment(
      item,
      incomingMessage,
      userInstruction,
      toast,
    );
  } else if (reschedule) {
    await rescheduleAppointment(
      item,
      incomingMessage,
      userInstruction,
      draftText,
      reasonText,
      calendarPayload,
      toast,
    );
  } else if (confirmation) {
    await confirmAppointment(
      item,
      incomingMessage,
      userInstruction,
      draftText,
      calendarPayload,
      toast,
    );
  }
}
