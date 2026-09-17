/*
 * Reading stay dates and party size out of a chat message.
 *
 * Deliberately a small, predictable parser rather than a language model: it
 * understands the ways people actually write dates in this market, in English
 * and Kiswahili, and returns nothing when unsure so Twiga asks instead of
 * guessing. All dates are calendar days in East Africa Time, represented as
 * UTC-midnight Dates and "YYYY-MM-DD" strings, the same form the booking and
 * availability code uses.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Furthest ahead Twiga will check, matching how far owners open calendars. */
export const MAX_DAYS_AHEAD = 540;
export const MAX_NIGHTS = 60;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, januari: 0,
  feb: 1, february: 1, februari: 1,
  mar: 2, march: 2, machi: 2,
  apr: 3, april: 3, aprili: 3,
  may: 4, mei: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, julai: 6,
  aug: 7, august: 7, agosti: 7,
  sep: 8, sept: 8, september: 8, septemba: 8,
  oct: 9, october: 9, oktoba: 9,
  nov: 10, november: 10, novemba: 10,
  dec: 11, december: 11, desemba: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, jumapili: 0,
  monday: 1, mon: 1, jumatatu: 1,
  tuesday: 2, tue: 2, tues: 2, jumanne: 2,
  wednesday: 3, wed: 3, jumatano: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, alhamisi: 4,
  friday: 5, fri: 5, ijumaa: 5,
  saturday: 6, sat: 6, jumamosi: 6,
};

const MONTH_RE = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|")})`;
const WEEKDAY_RE = `(${Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|")})`;
const ORD = `(?:st|nd|rd|th)?`;

export type StayRequest = {
  /** Present when both ends of the stay could be worked out. */
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  guests: number | null;
  /** The message talked about dates at all, even if they were unusable. */
  mentionsDates: boolean;
  problem: "past" | "too_far" | "order" | "too_long" | null;
};

export function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Today as a calendar day in Dar es Salaam. */
export function todayInEat(now: Date): Date {
  const shifted = new Date(now.getTime() + EAT_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function makeDay(year: number, month: number, day: number): Date | null {
  const d = new Date(Date.UTC(year, month, day));
  return d.getUTCMonth() === month && d.getUTCDate() === day ? d : null;
}

type Found = { at: number; end: number; date: Date; yearGiven: boolean };

/**
 * Parse a message. `text` should have mention tokens removed first, so a
 * property called "May Villa" is not read as a month.
 */
export function parseStay(text: string, now: Date = new Date()): StayRequest {
  const source = ` ${text.toLowerCase().replace(/[’']/g, "")} `;
  const today = todayInEat(now);
  const thisYear = today.getUTCFullYear();
  const found: Found[] = [];
  const taken: Array<[number, number]> = [];

  const overlaps = (start: number, end: number) => taken.some(([a, b]) => start < b && end > a);
  const push = (at: number, end: number, date: Date | null, yearGiven: boolean) => {
    if (!date || overlaps(at, end)) return;
    taken.push([at, end]);
    found.push({ at, end, date, yearGiven });
  };
  const scan = (pattern: RegExp, handle: (m: RegExpExecArray) => void) => {
    for (const m of source.matchAll(pattern)) handle(m as RegExpExecArray);
  };

  // "12 to 15 october", "12-15 oct 2026", "12 hadi 15 oktoba"
  scan(new RegExp(`\\b(\\d{1,2})${ORD}\\s*(?:-|–|to|until|till|through|hadi|mpaka)\\s*(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(20\\d{2}))?\\b`, "g"), (m) => {
    const month = MONTHS[m[3]];
    const year = m[4] ? Number(m[4]) : thisYear;
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (overlaps(at, end)) return;
    const first = makeDay(year, month, Number(m[1]));
    const second = makeDay(year, month, Number(m[2]));
    if (!first || !second) return;
    taken.push([at, end]);
    found.push({ at, end: at + 1, date: first, yearGiven: Boolean(m[4]) });
    found.push({ at: at + 1, end, date: second, yearGiven: Boolean(m[4]) });
  });

  // 2026-10-12
  scan(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, (m) => {
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, makeDay(Number(m[1]), Number(m[2]) - 1, Number(m[3])), true);
  });

  // 12/10/2026, 12.10.26 (day first, as written in Tanzania)
  scan(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2}|\d{2})\b/g, (m) => {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, makeDay(year, Number(m[2]) - 1, Number(m[1])), true);
  });

  // 12 october, 12th of oct 2026
  scan(new RegExp(`\\b(\\d{1,2})${ORD}\\s*(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(20\\d{2}))?\\b`, "g"), (m) => {
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, makeDay(m[3] ? Number(m[3]) : thisYear, MONTHS[m[2]], Number(m[1])), Boolean(m[3]));
  });

  // october 12, oct 12th 2026
  scan(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(20\\d{2}))?\\b`, "g"), (m) => {
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, makeDay(m[3] ? Number(m[3]) : thisYear, MONTHS[m[1]], Number(m[2])), Boolean(m[3]));
  });

  // Relative days
  scan(/\b(day after tomorrow|keshokutwa|tomorrow|kesho|tonight|today|leo)\b/g, (m) => {
    const word = m[1];
    const offset = word === "day after tomorrow" || word === "keshokutwa" ? 2 : word === "tomorrow" || word === "kesho" ? 1 : 0;
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, addDays(today, offset), true);
  });

  // Weekend: Friday in, Sunday out
  let weekend = false;
  scan(/\b(this weekend|next weekend|weekend|wikendi hii|wikendi)\b/g, (m) => {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (overlaps(at, end)) return;
    const dow = today.getUTCDay();
    let friday = addDays(today, (5 - dow + 7) % 7);
    if (dow === 6) friday = today; // Saturday: this weekend is already on
    if (dow === 0) friday = addDays(today, 5); // Sunday: the coming weekend
    if (m[1] === "next weekend") friday = addDays(friday, 7);
    const sunday = addDays(friday, dow === 6 ? 1 : 2);
    taken.push([at, end]);
    found.push({ at, end: at + 1, date: friday, yearGiven: true });
    found.push({ at: at + 1, end, date: sunday, yearGiven: true });
    weekend = true;
  });

  // Weekdays: "on friday", "next saturday", "ijumaa"
  scan(new RegExp(`\\b(next\\s+|this\\s+|on\\s+|coming\\s+|ijayo\\s+)?${WEEKDAY_RE}(\\s+ijayo)?\\b`, "g"), (m) => {
    const target = WEEKDAYS[m[2]];
    let ahead = (target - today.getUTCDay() + 7) % 7;
    // "next friday" on a Friday means a week out; otherwise the nearest one.
    if (ahead === 0 && /next|ijayo/.test(`${m[1] ?? ""}${m[3] ?? ""}`)) ahead = 7;
    push(m.index ?? 0, (m.index ?? 0) + m[0].length, addDays(today, ahead), true);
  });

  // Length of stay
  let nights: number | null = null;
  const nightsMatch =
    source.match(/\b(\d{1,2})\s*(?:nights?|days?|usiku|siku)\b/) ?? source.match(/\b(?:usiku|siku)\s+(\d{1,2})\b/);
  if (nightsMatch) nights = Number(nightsMatch[1]);
  else if (/\b(one night|a night|1 night|usiku mmoja)\b/.test(source)) nights = 1;
  else if (/\b(a week|one week|wiki moja)\b/.test(source)) nights = 7;

  // Party size
  let guests: number | null = null;
  // Kiswahili puts the number after the noun ("watu 3"), so check that order
  // first; otherwise "usiku 2 watu 3" would read the nights as the party size.
  const guestsMatch =
    source.match(/\b(?:watu|wageni)\s+(\d{1,2})\b/) ??
    source.match(/\b(\d{1,2})\s*(?:people|persons|person|guests?|adults?|pax|of us)\b/);
  if (guestsMatch) guests = Number(guestsMatch[1]);
  else if (/\b(couple|two of us|wawili)\b/.test(source)) guests = 2;

  found.sort((a, b) => a.at - b.at);
  const mentionsDates = found.length > 0;

  if (!mentionsDates) {
    return { checkIn: null, checkOut: null, nights, guests, mentionsDates: false, problem: null };
  }

  // A date without a year that has already passed means next year's.
  const settle = (f: Found) =>
    !f.yearGiven && f.date.getTime() < today.getTime()
      ? makeDay(f.date.getUTCFullYear() + 1, f.date.getUTCMonth(), f.date.getUTCDate()) ?? f.date
      : f.date;

  const checkIn = settle(found[0]);
  let checkOut: Date;
  if (found.length > 1 && !(nights && !weekend && found[1].date.getTime() === found[0].date.getTime())) {
    checkOut = settle(found[1]);
    // "28 dec to 2 jan": the second date rolls into the next year.
    if (!found[1].yearGiven && checkOut.getTime() <= checkIn.getTime()) {
      checkOut = makeDay(checkOut.getUTCFullYear() + 1, checkOut.getUTCMonth(), checkOut.getUTCDate()) ?? checkOut;
    }
  } else {
    checkOut = addDays(checkIn, nights ?? 1);
  }

  const stayNights = Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
  let problem: StayRequest["problem"] = null;
  if (checkIn.getTime() < today.getTime()) problem = "past";
  else if (checkIn.getTime() > addDays(today, MAX_DAYS_AHEAD).getTime()) problem = "too_far";
  else if (stayNights <= 0) problem = "order";
  else if (stayNights > MAX_NIGHTS) problem = "too_long";

  return {
    checkIn: problem ? null : toDay(checkIn),
    checkOut: problem ? null : toDay(checkOut),
    nights: problem ? nights : stayNights,
    guests,
    mentionsDates: true,
    problem,
  };
}
