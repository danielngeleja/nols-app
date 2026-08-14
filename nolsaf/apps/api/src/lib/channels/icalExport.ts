// apps/api/src/lib/channels/icalExport.ts
//
// The outbound half of a calendar connection: what NRMS publishes so an OTA
// stops selling a night the property has already sold elsewhere.
//
// What gets published is deliberately not "every reservation". A room type
// with six units can take a sixth booking while five are occupied, and a feed
// that blocks the listing on the first reservation would cost the owner five
// sellable nights. Only nights where the type has nothing left are exported,
// which is the same allotment logic a channel manager applies.
//
// No guest information leaves the building. A busy period is a pair of dates
// and the word "Not available", because an OTA calendar needs nothing more and
// this file is served to anyone holding the feed token.
import { getRoomTypeDailyAvailability } from "../nrmsAvailability.js";

const DAY_MS = 86_400_000;

export type BusyPeriod = { start: Date; end: Date };

/** How far ahead a published calendar looks. Beyond this OTAs stop caring. */
export const ICAL_EXPORT_MONTHS = 12;

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * RFC 5545 caps a content line at 75 octets and continues it with a leading
 * space. Google and Apple tolerate long lines; some property systems do not.
 */
export function foldIcalLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let index = 0;
  while (index < bytes.length) {
    // Step back to a character boundary so a multi-byte glyph is never split.
    let size = Math.min(index === 0 ? 75 : 74, bytes.length - index);
    while (size > 1 && (bytes[index + size] & 0xc0) === 0x80) size -= 1;
    parts.push((index === 0 ? "" : " ") + bytes.subarray(index, index + size).toString("utf8"));
    index += size;
  }
  return parts.join("\r\n");
}

function escapeIcalText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Consecutive sold-out nights collapse into one VEVENT.
 *
 * `buffer` is the safety margin: rooms withheld from this provider so a night
 * closes before the property is genuinely full. A provider that reads the feed
 * hours late can otherwise sell a room sold here minutes ago, and the buffer is
 * what leaves somewhere to put that guest. Zero publishes only true sell-outs.
 */
export function mergeBusyDays(days: Array<{ day: Date; available: number }>, buffer = 0): BusyPeriod[] {
  const margin = Math.max(0, Math.floor(buffer));
  const periods: BusyPeriod[] = [];
  let open: BusyPeriod | null = null;
  for (const entry of days) {
    if (entry.available > margin) {
      open = null;
      continue;
    }
    const next = new Date(entry.day.getTime() + DAY_MS);
    if (open && open.end.getTime() === entry.day.getTime()) {
      open.end = next;
      continue;
    }
    open = { start: entry.day, end: next };
    periods.push(open);
  }
  return periods;
}

export async function getRoomTypeBusyPeriods(
  db: any,
  propertyId: number,
  roomTypeId: number,
  from: Date,
  options: { months?: number; buffer?: number } = {},
): Promise<BusyPeriod[]> {
  const months = options.months ?? ICAL_EXPORT_MONTHS;
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, from.getUTCDate()));
  const days = await getRoomTypeDailyAvailability(db, propertyId, roomTypeId, start, end);
  return mergeBusyDays(days, options.buffer ?? 0);
}

/**
 * A complete VCALENDAR document. Line endings are CRLF because the spec says
 * so and some importers reject LF-only calendars.
 */
export function buildIcalDocument(input: {
  calendarName: string;
  roomTypeId: number;
  periods: BusyPeriod[];
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const stamp = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NoLSAF//NRMS Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcalText(input.calendarName)}`,
  ];
  for (const period of input.periods) {
    lines.push(
      "BEGIN:VEVENT",
      // Stable while the period is: an unchanged block keeps its identity
      // across polls, so the OTA sees an update rather than churn.
      `UID:nrms-${input.roomTypeId}-${dayStamp(period.start)}-${dayStamp(period.end)}@nolsaf.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dayStamp(period.start)}`,
      `DTEND;VALUE=DATE:${dayStamp(period.end)}`,
      "SUMMARY:Not available",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcalLine).join("\r\n")}\r\n`;
}
