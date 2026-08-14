// apps/api/src/lib/channels/icalParse.ts
//
// Minimal RFC 5545 reader, scoped to what an OTA availability calendar
// actually contains: VEVENT blocks with a UID and a pair of dates.
//
// Deliberately not a general iCalendar library. A hotel calendar needs day
// granularity and nothing else: no recurrence, no alarms, no timezone
// database. A VEVENT that carries a time is reduced to the day it starts on,
// because a room is either sold for a night or it is not.
//
// Airbnb's export is the shape this was written against: VALUE=DATE start and
// end, an exclusive end date equal to the checkout day, a UID ending
// @airbnb.com, and a SUMMARY of "Reserved" or "Airbnb (Not available)". The
// parser stays generic enough for Booking.com, Vrbo and Google calendars,
// which differ only in how they spell the summary.
import crypto from "node:crypto";

export type IcalEvent = {
  /** Provider-stable identity. The dedupe key for everything downstream. */
  uid: string;
  /** First night held, UTC midnight. */
  start: Date;
  /** Departure day, UTC midnight, exclusive. Always after start. */
  end: Date;
  summary: string;
  cancelled: boolean;
  /** Changes whenever anything we act on changes. Cheap "did this move?" test. */
  hash: string;
};

export type IcalParseResult = {
  events: IcalEvent[];
  /** Events we could read but had to drop, with the reason, for the sync run log. */
  skipped: Array<{ uid: string | null; reason: string }>;
  /** More valid events existed than the safety cap. Never reconcile deletions from this snapshot. */
  truncated: boolean;
};

const DAY_MS = 86_400_000;

/** A runaway feed must not become a runaway import. */
export const MAX_ICAL_EVENTS = 5_000;

/**
 * RFC 5545 folds long lines by inserting CRLF plus one space or tab. Unfolding
 * has to happen before anything else or a URL split across two lines parses as
 * two properties.
 */
export function unfoldIcalLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  for (const line of normalized.split("\n")) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
      continue;
    }
    lines.push(line);
  }
  return lines;
}

/** TEXT values escape commas, semicolons, backslashes and newlines. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

type PropertyLine = { name: string; params: Map<string, string>; value: string };

function parsePropertyLine(line: string): PropertyLine | null {
  const separator = line.indexOf(":");
  if (separator <= 0) return null;
  const head = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [rawName, ...rawParams] = head.split(";");
  const params = new Map<string, string>();
  for (const param of rawParams) {
    const eq = param.indexOf("=");
    if (eq <= 0) continue;
    params.set(param.slice(0, eq).trim().toUpperCase(), param.slice(eq + 1).trim().toUpperCase());
  }
  return { name: rawName.trim().toUpperCase(), params, value };
}

/**
 * Reduce any DATE or DATE-TIME to the UTC midnight of the day it names.
 *
 * A floating or TZID-qualified time is read at face value rather than being
 * converted: the provider means "the 14th" whatever its offset, and shifting
 * it by a timezone we did not look up would move a stay across a night.
 */
export function parseIcalDate(value: string): Date | null {
  const raw = value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(raw);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1) return null;
  return date;
}

/** Only the day-bearing parts of a DURATION matter at this granularity. */
export function parseIcalDurationDays(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T.*)?$/.exec(value.trim().toUpperCase());
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] ?? 0) * 7 + Number(match[2] ?? 0);
}

function eventHash(parts: Array<string | number>): string {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Every VEVENT in the feed, normalized to whole nights.
 *
 * Malformed events are collected in `skipped` rather than thrown, because one
 * unreadable line in a 300-event calendar must not cost the property the other
 * 299 blocks.
 */
export function parseIcalFeed(text: string): IcalParseResult {
  const events: IcalEvent[] = [];
  const skipped: IcalParseResult["skipped"] = [];
  let truncated = false;
  const lines = unfoldIcalLines(text);

  let current: {
    uid: string | null;
    start: Date | null;
    end: Date | null;
    durationDays: number | null;
    startIsDateOnly: boolean;
    summary: string;
    cancelled: boolean;
  } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase() === "BEGIN:VEVENT") {
      current = { uid: null, start: null, end: null, durationDays: null, startIsDateOnly: true, summary: "", cancelled: false };
      continue;
    }
    if (trimmed.toUpperCase() === "END:VEVENT") {
      if (!current) continue;
      const event = finalizeEvent(current);
      if ("error" in event) skipped.push({ uid: current.uid, reason: event.error });
      else if (events.length < MAX_ICAL_EVENTS) events.push(event.value);
      else truncated = true;
      current = null;
      continue;
    }
    if (!current) continue;

    const property = parsePropertyLine(line);
    if (!property) continue;
    switch (property.name) {
      case "UID":
        current.uid = unescapeText(property.value).slice(0, 200);
        break;
      case "DTSTART":
        current.start = parseIcalDate(property.value);
        current.startIsDateOnly = property.params.get("VALUE") === "DATE" || !property.value.includes("T");
        break;
      case "DTEND":
        current.end = parseIcalDate(property.value);
        break;
      case "DURATION":
        current.durationDays = parseIcalDurationDays(property.value);
        break;
      case "SUMMARY":
        current.summary = unescapeText(property.value).slice(0, 200);
        break;
      case "STATUS":
        current.cancelled = property.value.trim().toUpperCase() === "CANCELLED";
        break;
      default:
        break;
    }
  }

  return { events, skipped, truncated };
}

function finalizeEvent(current: {
  uid: string | null;
  start: Date | null;
  end: Date | null;
  durationDays: number | null;
  startIsDateOnly: boolean;
  summary: string;
  cancelled: boolean;
}): { value: IcalEvent } | { error: string } {
  if (!current.uid) return { error: "MISSING_UID" };
  if (!current.start) return { error: "MISSING_OR_INVALID_DTSTART" };

  let end = current.end;
  if (!end && current.durationDays != null) {
    end = new Date(current.start.getTime() + current.durationDays * DAY_MS);
  }
  // RFC 5545: a DATE-valued DTSTART with no DTEND is a single day. A timed
  // event with no end is the same thing once reduced to day granularity.
  if (!end) end = new Date(current.start.getTime() + DAY_MS);

  // A same-day block is how some providers spell "one night". Anything that
  // ends before it starts is corrupt and dropped.
  if (end.getTime() === current.start.getTime()) end = new Date(current.start.getTime() + DAY_MS);
  if (end.getTime() < current.start.getTime()) return { error: "END_BEFORE_START" };

  return {
    value: {
      uid: current.uid,
      start: current.start,
      end,
      summary: current.summary,
      cancelled: current.cancelled,
      hash: eventHash([current.uid, dayKey(current.start), dayKey(end), current.summary, current.cancelled ? 1 : 0]),
    },
  };
}
