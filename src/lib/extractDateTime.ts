import {
  addDays,
  nextDay,
  setHours,
  setMinutes,
  startOfDay,
} from "date-fns";

export interface ExtractedDateTime {
  date: Date;
  source: string; // the substring that matched
  confidence: "high" | "medium";
}

/**
 * Attempts to extract a date + time from natural language text (draft
 * replies, user instructions, or message subjects). Returns the first
 * high-confidence match, or the first medium-confidence match as fallback.
 */
export function extractDateTime(
  ...texts: (string | null | undefined)[]
): ExtractedDateTime | null {
  const combined = texts.filter(Boolean).join("\n");
  if (!combined.trim()) return null;

  const now = new Date();

  // ─── Month + day + time (e.g. "June 3rd at 2pm", "Jun 3 at 14:00") ───
  const monthDayTime = extractMonthDayTime(combined, now);
  if (monthDayTime) return monthDayTime;

  // ─── Day name + time (e.g. "Tuesday at 10am", "next monday at 3pm") ───
  const dayNameTime = extractDayNameTime(combined, now);
  if (dayNameTime) return dayNameTime;

  // ─── Relative day + time (e.g. "tomorrow at 3pm") ───
  const relativeDayTime = extractRelativeDayTime(combined, now);
  if (relativeDayTime) return relativeDayTime;

  // ─── Numeric date + time (e.g. "3/6 at 2pm", "2026-06-03 14:00") ───
  const numericDateTime = extractNumericDateTime(combined, now);
  if (numericDateTime) return numericDateTime;

  // ─── Month + day only (no time, default to 9am) ───
  const monthDay = extractMonthDay(combined, now);
  if (monthDay) return monthDay;

  // ─── Day name only (no time, default to 9am) ───
  const dayName = extractDayName(combined, now);
  if (dayName) return { ...dayName, confidence: "medium" };

  // ─── Relative day only ───
  const relativeDay = extractRelativeDay(combined, now);
  if (relativeDay) return { ...relativeDay, confidence: "medium" };

  return null;
}

// ─── Month name lookup ───
const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2,
  april: 3, apr: 3,
  may: 3,
  june: 4, jun: 4,
  july: 5, jul: 5,
  august: 6, aug: 6,
  september: 7, sep: 7, sept: 7,
  october: 8, oct: 8,
  november: 9, nov: 9,
  december: 10, dec: 10,
  // Italian
  gennaio: 0, gen: 0,
  febbraio: 1,
  marzo: 2, mar: 2,
  aprile: 3,
  maggio: 3, mag: 3,
  giugno: 4, giu: 4,
  luglio: 5, lug: 5,
  agosto: 6, ago: 6,
  settembre: 7, set: 7,
  ottobre: 8, ott: 8,
  novembre: 9,
  dicembre: 10, dic: 10,
  // Spanish
  enero: 0, ene: 0,
  febrero: 1,
  abril: 3,
  mayo: 3,
  junio: 4,
  julio: 5,
  septiembre: 7,
  octubre: 8,
  noviembre: 9,
  diciembre: 10,
};

type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DAYS: Record<string, DayIndex> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  // Italian
  domenica: 0, dom: 0,
  "lunedì": 1, lunedi: 1, lun: 1,
  "martedì": 2, martedi: 2, mar: 2,
  "mercoledì": 3, mercoledi: 3, mer: 3,
  "giovedì": 4, giovedi: 4, gio: 4,
  "venerdì": 5, venerdi: 5, ven: 5,
  sabato: 6, sab: 6,
  // Spanish
  domingo: 0,
  lunes: 1,
  martes: 2,
  "miércoles": 3, miercoles: 3, "mié": 3, mie: 3,
  jueves: 4, jue: 4,
  viernes: 5, vie: 5,
  "sábado": 6, sabado: 6,
};

const TIME_REGEX = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/gi;

function parseTime(
  timeStr: string,
  baseDate: Date,
): Date | null {
  TIME_REGEX.lastIndex = 0;
  const match = TIME_REGEX.exec(timeStr);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = (match[3] || "").toLowerCase();

  if (ampm.startsWith("p") && hours < 12) hours += 12;
  if (ampm.startsWith("a") && hours === 12) hours = 0;

  // 24-hour time detection (e.g. "14:00" without am/pm)
  if (!ampm && hours >= 13 && hours <= 23) {
    // already 24h, keep as-is
  }

  return setMinutes(setHours(baseDate, hours), minutes);
}

// "June 3rd at 2pm", "Jun 3 at 14:00", "June 3, 2026 at 2:30 PM"
function extractMonthDayTime(
  text: string,
  now: Date,
): ExtractedDateTime | null {
  const re =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|gennaio|gen|febbraio|marzo|aprile|maggio|mag|giugno|giu|luglio|lug|agosto|ago|settembre|set|ottobre|ott|novembre|dicembre|dic|enero|ene|febrero|abril|mayo|junio|julio|septiembre|octubre|noviembre|diciembre)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:,?\s*\d{4}\s*,?)?\s*(?:at\s+|alle\s+|a\s+las\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i;

  const match = re.exec(text);
  if (!match) return null;

  const monthKey = match[1].toLowerCase();
  const month = MONTHS[monthKey];
  if (month === undefined) return null;

  const day = parseInt(match[2], 10);
  if (day < 1 || day > 31) return null;

  const year = guessYear(month, now);
  const base = startOfDay(new Date(year, month, day));
  const withTime = parseTime(match[3], base);
  if (!withTime) return null;

  return { date: withTime, source: match[0], confidence: "high" };
}

// "Tuesday at 10am", "next monday at 3pm", "on Wednesday at 2pm", "this Friday at 4"
function extractDayNameTime(
  text: string,
  now: Date,
): ExtractedDateTime | null {
  const re =
    /\b(?:(next|this|on)\s+)?(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|domenica|dom|luned[ìi]|lun|marted[ìi]|mercoled[ìi]|mer|gioved[ìi]|gio|venerd[ìi]|ven|sabato|sab|domingo|lunes|martes|mi[ée]rcoles|mie|jueves|jue|viernes|vie|s[áa]bado)\s+(?:at\s+|alle\s+|a\s+las\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i;

  const match = re.exec(text);
  if (!match) return null;

  const prefix = (match[1] ?? "").toLowerCase();
  const isNext = prefix === "next";
  const dayKey = match[2].toLowerCase();
  const dayOfWeek = DAYS[dayKey];
  if (dayOfWeek === undefined) return null;

  let date = nextDay(now, dayOfWeek);
  if (isNext) date = addDays(date, 7);

  const withTime = parseTime(match[3], date);
  if (!withTime) return null;

  return { date: withTime, source: match[0], confidence: "high" };
}

// "tomorrow at 3pm", "today at 2pm", "domani alle 16", "mañana a las 15"
function extractRelativeDayTime(
  text: string,
  now: Date,
): ExtractedDateTime | null {
  const re =
    /\b(tomorrow|today|domani|oggi|mañana|hoy)\s+(?:at\s+|alle\s+|a\s+las\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i;

  const match = re.exec(text);
  if (!match) return null;

  const word = match[1].toLowerCase();
  const isTomorrow = word === "tomorrow" || word === "domani" || word === "mañana";
  const base = isTomorrow ? addDays(now, 1) : now;

  const withTime = parseTime(match[2], base);
  if (!withTime) return null;

  return {
    date: withTime,
    source: match[0],
    confidence: "high",
  };
}

// "3/6 at 2pm", "06/03 14:00", "2026-06-03T14:00"
function extractNumericDateTime(
  text: string,
  now: Date,
): ExtractedDateTime | null {
  // ISO-ish: "2026-06-03" or "2026-06-03T14:00"
  const isoRe =
    /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?\b/;
  const isoMatch = isoRe.exec(text);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    let date = startOfDay(new Date(year, month, day));
    if (isoMatch[4]) {
      date = setMinutes(setHours(date, parseInt(isoMatch[4], 10)), parseInt(isoMatch[5], 10));
    } else {
      date = setHours(date, 9);
    }
    return { date, source: isoMatch[0], confidence: "high" };
  }

  // D/M or M/D with time: "3/6 at 2pm", "06/03 14:00"
  const slashRe =
    /\b(\d{1,2})\/(\d{1,2})\s*(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i;
  const slashMatch = slashRe.exec(text);
  if (slashMatch) {
    const a = parseInt(slashMatch[1], 10);
    const b = parseInt(slashMatch[2], 10);
    // Assume D/M format (day first, common in international contexts)
    const day = a <= 31 ? a : b;
    const month = (a <= 31 ? b : a) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const year = guessYear(month, now);
    const base = startOfDay(new Date(year, month, day));
    const withTime = parseTime(slashMatch[3], base);
    if (!withTime) return null;
    return { date: withTime, source: slashMatch[0], confidence: "high" };
  }

  return null;
}

// "June 3rd", "Jun 3" (no time)
function extractMonthDay(
  text: string,
  now: Date,
): ExtractedDateTime | null {
  const re =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|gennaio|gen|febbraio|marzo|aprile|maggio|mag|giugno|giu|luglio|lug|agosto|ago|settembre|set|ottobre|ott|novembre|dicembre|dic|enero|ene|febrero|abril|mayo|junio|julio|septiembre|octubre|noviembre|diciembre)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:,?\s*(\d{4})\s*)?/i;

  const match = re.exec(text);
  if (!match) return null;

  const monthKey = match[1].toLowerCase();
  const month = MONTHS[monthKey];
  if (month === undefined) return null;

  const day = parseInt(match[2], 10);
  if (day < 1 || day > 31) return null;

  const year = match[3] ? parseInt(match[3], 10) : guessYear(month, now);
  const date = setHours(startOfDay(new Date(year, month, day)), 9);

  return { date, source: match[0], confidence: "medium" };
}

// "next Monday", "Tuesday", "on Wednesday" (no time)
function extractDayName(
  text: string,
  now: Date,
): ExtractedDateTime | null {
  const re =
    /\b(?:(next|this|on)\s+)?(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|domenica|dom|luned[ìi]|lun|marted[ìi]|mercoled[ìi]|mer|gioved[ìi]|gio|venerd[ìi]|ven|sabato|sab|domingo|lunes|martes|mi[ée]rcoles|mie|jueves|jue|viernes|vie|s[áa]bado)\b(?!\s*(?:at|by|morning|evening|afternoon|night|alle|a\s+las))/i;

  const match = re.exec(text);
  if (!match) return null;

  const prefix = (match[1] ?? "").toLowerCase();
  const isNext = prefix === "next";
  const dayKey = match[2].toLowerCase();
  const dayOfWeek = DAYS[dayKey];
  if (dayOfWeek === undefined) return null;

  let date = nextDay(now, dayOfWeek);
  if (isNext) date = addDays(date, 7);

  // Default to 9am
  const withTime = setMinutes(setHours(date, 9), 0);
  return { date: withTime, source: match[0], confidence: "medium" };
}

// "tomorrow", "today", "domani", "oggi", "mañana", "hoy" (no time)
function extractRelativeDay(
  text: string,
  now: Date,
): ExtractedDateTime | null {
  const re = /\b(tomorrow|today|domani|oggi|mañana|hoy)\b/i;
  const match = re.exec(text);
  if (!match) return null;

  const word = match[1].toLowerCase();
  const isTomorrow = word === "tomorrow" || word === "domani" || word === "mañana";
  const base = isTomorrow ? addDays(now, 1) : now;
  const date = setHours(startOfDay(base), 9);

  return { date, source: match[0], confidence: "medium" };
}

/** Guess year: if the month is already past, assume next year. */
function guessYear(monthIndex: number, now: Date): number {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  if (monthIndex < currentMonth) return currentYear + 1;
  return currentYear;
}

/**
 * Quick check: does the text look like a booking confirmation?
 * Used to decide whether to parse dates and push to calendar.
 */
export function looksLikeConfirmation(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(confirm(?:ing|ed)?|book(?:ing|ed)?|schedul(?:ing|ed)?|reserv(?:ing|ed)?|set for|all set|see you|looking forward|c(u|ya)\s+(there|then)|appointment confirmed|slot is yours|on the calendar|in the calendar|on your calendar|in your calendar|added to calendar|confermo|confermato|conferma|confermando|prenotato|prenotazione|prenoto|fissato|fissiamo|appuntamento confermato|confirmado|confirmo|confirmamos|reservado|reservación|reservo|agendado|agendamiento|cita confirmada)\b/i.test(lower);
}

/**
 * Quick check: does the text look like a cancellation?
 * Used to decide whether to mark the agenda event as cancelled
 * and delete it from Google Calendar.
 */
export function looksLikeCancellation(text: string): boolean {
  const lower = text.toLowerCase();
  // English: conjugated forms only (cancelled/cancelling), not bare "cancel"
  // Italian: annullare/annullato/disdire/disdetto/rinunciare
  // Spanish: cancelar/cancelado/anular/anulado
  return /\b(cancelled|canceled|cancelling|canceling|cannot make\b|can't make\b|cant make\b|not going to make|won't be able|no longer|call off|called off|have to cancel|(?:\bi\b|\bwe\b)\s+need to cancel|sorry.*(?:cancel|cannot)|unfortunately.*(?:cancel|cannot)|not available anymore|raincheck|rain check|annullare|annullato|annulla|annulliamo|disdire|disdett[ao]|rinunciare|rinuncio|rinunciamo|non (?:posso|possiamo|riesco|riusciamo)|non (?:ce la faccio|ce la facciamo)|spiacente.*(?:annull|disd)|purtroppo.*(?:annull|disd)|cancelar|cancelado|cancelo|cancelamos|anular|anulado|anulo|anulamos|no (?:puedo|podemos|puede))\b/i.test(lower);
}

/**
 * Quick check: does the text look like a reschedule?
 * Signals that the old event should be cancelled and a new one
 * created at a different time. Needs both cancellation language
 * AND a new date/time proposal in the text.
 */
export function looksLikeReschedule(text: string): boolean {
  const lower = text.toLowerCase();
  const hasRescheduleLanguage = /\b(reschedule|rescheduled|rescheduling|change (?:the |our )?(?:time|date|appointment|meeting)|move (?:the |our )?(?:time|date|appointment|meeting)|push (?:back|forward|out)|bump|another time|different time|different day|another day|instead|how about|what about|would.*work|does.*work for|could we do|can we do|what if we|new time|new date|switch|swap|shift|spostare|spostiamo|spostato|rimandare|rimandiamo|rimandato|rinviare|rinviamo|rinviato|cambiare (?:data|ora|orario|appuntamento)|cambiamo (?:data|ora|orario)|un'?altra (?:data|ora|volta)|un altro (?:giorno|orario|momento)|possiamo (?:fare|vederci|sentirci)|che ne dici|che ne dite|reprogramar|reprogramado|cambiar (?:fecha|hora|cita)|cambiamos|movemos|movido|otra (?:fecha|hora|vez)|otro (?:d[íi]a|horario))\b/i.test(lower);
  // Time indicator: English + Italian + Spanish day/month names (mirrors the
  // patterns used in extractDayNameTime / extractMonthDayTime regexes)
  const hasTimeIndicator = /(\b(?:mon|tue|wed|thu|fri|sat|sun)(?:sday|rsday|nesday|rday|day)?\b|\b(?:luned[ìi]|marted[ìi]|mercoled[ìi]|gioved[ìi]|venerd[ìi]|sabato|domenica|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}[/-]\d{1,2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic|ene|abr|may|jul|sep|oct|nov|dic)\w*\s+\d{1,2}\b|\b(?:tomorrow|today|domani|oggi|mañana|hoy)\b)/i.test(lower);
  return hasRescheduleLanguage && hasTimeIndicator;
}
