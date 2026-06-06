export const AGENDA_EVENTS_CHANGED = "agenda-events:change";

export function notifyAgendaEventsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENDA_EVENTS_CHANGED));
}
