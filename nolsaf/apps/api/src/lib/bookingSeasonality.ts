// apps/api/src/lib/bookingSeasonality.ts
//
// Seasons from stays: when guests actually come, month by month, for one
// property, one property type or one region. Pure so it can be tested without
// a database. Input is received bookings only (paid and confirmed); a stay
// belongs to the EAT month of its check-in.
//
// What it gives:
//   * a monthly series: the last 24 months as they happened, the next 6 as
//     they stand on the books today;
//   * a month-of-year profile: average stays per calendar month across the
//     years observed, and a season index (that month against the average
//     month), which labels peak, high, normal and low months;
//   * the next peak and an expected figure per coming month, from the profile;
//   * check-in weekdays and how far ahead guests book.
// It is a pattern from past stays, not a guarantee; `confidence` says how much
// history stands behind it.

const DAY_MS = 86_400_000;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Dar_es_Salaam, no DST
const HISTORY_MONTHS = 24;
const PROFILE_MONTHS = 36;
const AHEAD_MONTHS = 6;
const MIN_STAYS_FOR_SEASONS = 12;
const MIN_MONTHS_FOR_SEASONS = 6;

export type SeasonStay = { checkIn: Date; checkOut: Date; createdAt: Date; totalAmount: unknown };
export type SeasonLevel = "PEAK" | "HIGH" | "NORMAL" | "LOW";
export type SeasonConfidence = "NONE" | "EARLY" | "BUILDING" | "SOLID";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const eat = (at: Date | number) => new Date(new Date(at).getTime() + EAT_OFFSET_MS);
/** "2026-11" for the EAT month of an instant. */
export function eatMonthKey(at: Date | number): string {
  return eat(at).toISOString().slice(0, 7);
}
function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}
const monthIndex = (key: string) => Number(key.slice(5, 7)) - 1;
const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const nightsOf = (s: SeasonStay) => Math.max(1, Math.round((new Date(s.checkOut).getTime() - new Date(s.checkIn).getTime()) / DAY_MS));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function seasonLevel(index: number): SeasonLevel {
  if (index >= 1.25) return "PEAK";
  if (index >= 1.05) return "HIGH";
  if (index <= 0.75) return "LOW";
  return "NORMAL";
}

export function summarizeSeasonality(stays: SeasonStay[], opts: { now: Date }) {
  const now = opts.now;
  const thisMonth = eatMonthKey(now);
  const historyStart = shiftMonth(thisMonth, -(HISTORY_MONTHS - 1));
  const profileStart = shiftMonth(thisMonth, -PROFILE_MONTHS);
  const lastAhead = shiftMonth(thisMonth, AHEAD_MONTHS);

  const byMonth = new Map<string, { stays: number; nights: number; value: number }>();
  const weekdays = Array.from({ length: 7 }, () => 0);
  const lead = { sameWeek: 0, upToMonth: 0, upToQuarter: 0, longer: 0 };
  const leadDays: number[] = [];
  let firstMonth: string | null = null;

  for (const stay of stays) {
    const key = eatMonthKey(stay.checkIn);
    if (key < profileStart || key > lastAhead) continue;
    const row = byMonth.get(key) ?? { stays: 0, nights: 0, value: 0 };
    row.stays += 1;
    row.nights += nightsOf(stay);
    row.value += money(stay.totalAmount);
    byMonth.set(key, row);
    if (!firstMonth || key < firstMonth) firstMonth = key;

    // How guests book, from stays that have started.
    if (new Date(stay.checkIn) <= now) {
      weekdays[(eat(stay.checkIn).getUTCDay() + 6) % 7] += 1;
      const days = Math.max(0, Math.round((new Date(stay.checkIn).getTime() - new Date(stay.createdAt).getTime()) / DAY_MS));
      leadDays.push(days);
      if (days <= 7) lead.sameWeek += 1;
      else if (days <= 30) lead.upToMonth += 1;
      else if (days <= 90) lead.upToQuarter += 1;
      else lead.longer += 1;
    }
  }

  // Month-of-year profile over complete past months, counted from the first
  // month this scope had a stay, so months before it existed do not dilute it.
  const observed = Array.from({ length: 12 }, () => ({ months: 0, stays: 0, nights: 0 }));
  if (firstMonth) {
    for (let key = firstMonth < profileStart ? profileStart : firstMonth; key < thisMonth; key = shiftMonth(key, 1)) {
      const row = byMonth.get(key);
      const slot = observed[monthIndex(key)];
      slot.months += 1;
      slot.stays += row?.stays ?? 0;
      slot.nights += row?.nights ?? 0;
    }
  }
  const monthsObserved = observed.reduce((s, o) => s + o.months, 0);
  const pastStays = observed.reduce((s, o) => s + o.stays, 0);
  const averages = observed.map((o) => (o.months ? o.stays / o.months : null));
  const known = averages.filter((a): a is number => a != null);
  const mean = known.length ? known.reduce((s, a) => s + a, 0) / known.length : 0;
  const enough = pastStays >= MIN_STAYS_FOR_SEASONS && monthsObserved >= MIN_MONTHS_FOR_SEASONS && mean > 0;

  const profile = observed.map((o, i) => {
    const avg = averages[i];
    const index = enough && avg != null ? avg / mean : null;
    return {
      month: i + 1,
      name: MONTH_NAMES[i],
      yearsObserved: o.months,
      avgStays: avg == null ? null : round1(avg),
      avgNights: o.months ? round1(o.nights / o.months) : null,
      index: index == null ? null : Math.round(index * 100) / 100,
      level: index == null ? null : seasonLevel(index),
    };
  });

  const confidence: SeasonConfidence = !enough
    ? (pastStays > 0 ? "EARLY" : "NONE")
    : monthsObserved >= 24 ? "SOLID" : monthsObserved >= 12 ? "BUILDING" : "EARLY";

  const series: Array<{ month: string; stays: number; nights: number; value: number; future: boolean; expected: number | null }> = [];
  for (let key = historyStart; key <= lastAhead; key = shiftMonth(key, 1)) {
    const row = byMonth.get(key) ?? { stays: 0, nights: 0, value: 0 };
    const avg = averages[monthIndex(key)];
    series.push({
      month: key,
      stays: row.stays,
      nights: row.nights,
      value: Math.round(row.value),
      future: key > thisMonth,
      // What the season pattern says this month usually brings.
      expected: enough && avg != null && key >= thisMonth ? round1(avg) : null,
    });
  }

  // The next month, from this one on, that the pattern calls a peak.
  let nextPeak: { month: string; name: string; index: number; expected: number; onBooks: number } | null = null;
  if (enough) {
    for (let i = 0; i < 12; i++) {
      const key = shiftMonth(thisMonth, i);
      const p = profile[monthIndex(key)];
      if (p.level === "PEAK" && p.index != null && p.avgStays != null) {
        nextPeak = { month: key, name: p.name, index: p.index, expected: p.avgStays, onBooks: byMonth.get(key)?.stays ?? 0 };
        break;
      }
    }
  }

  const sortedLead = [...leadDays].sort((a, b) => a - b);
  const started = sortedLead.length;
  const busiestWeekday = started ? weekdays.indexOf(Math.max(...weekdays)) : -1;

  return {
    confidence,
    monthsObserved,
    pastStays,
    series,
    profile,
    peakMonths: profile.filter((p) => p.level === "PEAK").sort((a, b) => (b.index ?? 0) - (a.index ?? 0)).map((p) => p.name),
    lowMonths: profile.filter((p) => p.level === "LOW").sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((p) => p.name),
    nextPeak,
    weekdays: WEEKDAYS.map((name, i) => ({ name, stays: weekdays[i] })),
    busiestWeekday: busiestWeekday >= 0 ? WEEKDAYS[busiestWeekday] : null,
    lead: { ...lead, medianDays: started ? sortedLead[Math.floor((started - 1) / 2)] : null },
  };
}
