import { describe, expect, it } from "vitest";
import { eatMonthKey, seasonLevel, summarizeSeasonality, type SeasonStay } from "./bookingSeasonality.js";

const NOW = new Date("2026-11-09T09:00:00Z");
const DAY = 86_400_000;

/** `count` stays checking in on day 10 of an EAT month, booked `leadDays` ahead, 2 nights each. */
function staysIn(month: string, count: number, leadDays = 10): SeasonStay[] {
  return Array.from({ length: count }, () => {
    const checkIn = new Date(`${month}-10T11:00:00Z`);
    return { checkIn, checkOut: new Date(checkIn.getTime() + 2 * DAY), createdAt: new Date(checkIn.getTime() - leadDays * DAY), totalAmount: 100000 };
  });
}

/** Two full years, Nov 2024 to Oct 2026: 3 stays a month, 6 in July and December. */
function twoYears(): SeasonStay[] {
  const out: SeasonStay[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(2024, 10 + i, 1));
    const key = d.toISOString().slice(0, 7);
    const m = d.getUTCMonth();
    out.push(...staysIn(key, m === 6 || m === 11 ? 6 : 3));
  }
  return out;
}

describe("eatMonthKey", () => {
  it("puts a 00:30 EAT check-in on 1 July into July, not June", () => {
    expect(eatMonthKey(new Date("2026-06-30T21:30:00Z"))).toBe("2026-07");
    expect(eatMonthKey(new Date("2026-06-30T20:59:59Z"))).toBe("2026-06");
  });
});

describe("seasonLevel", () => {
  it("labels the index", () => {
    expect([1.3, 1.1, 1, 0.7].map(seasonLevel)).toEqual(["PEAK", "HIGH", "NORMAL", "LOW"]);
  });
});

describe("summarizeSeasonality", () => {
  it("finds the peak months from two years of stays and calls the next one", () => {
    const s = summarizeSeasonality([...twoYears(), ...staysIn("2026-12", 2, 40)], { now: NOW });
    expect(s.confidence).toBe("SOLID");
    expect(s.monthsObserved).toBe(24);
    expect(s.peakMonths).toEqual(["July", "December"]);
    const july = s.profile[6];
    expect(july).toMatchObject({ name: "July", yearsObserved: 2, avgStays: 6, level: "PEAK" });
    expect(july.index).toBeCloseTo(6 / 3.5, 2);
    expect(s.profile[2].level).toBe("NORMAL");
    expect(s.nextPeak).toEqual({ month: "2026-12", name: "December", index: 1.71, expected: 6, onBooks: 2 });
  });

  it("keeps 24 months of history and 6 ahead, with what the pattern expects from now on", () => {
    const s = summarizeSeasonality([...twoYears(), ...staysIn("2026-12", 2, 40)], { now: NOW });
    expect(s.series).toHaveLength(30);
    expect(s.series[0].month).toBe("2024-12");
    expect(s.series.at(-1)!.month).toBe("2027-05");
    const dec = s.series.find((m) => m.month === "2026-12")!;
    expect(dec).toMatchObject({ stays: 2, nights: 4, value: 200000, future: true, expected: 6 });
    expect(s.series.find((m) => m.month === "2026-10")!.expected).toBeNull();
  });

  it("does not let months before the first stay dilute the profile", () => {
    // Only the last year has stays, so each calendar month is observed once.
    const lastYear = twoYears().filter((st) => st.checkIn >= new Date("2025-11-01T00:00:00Z"));
    const s = summarizeSeasonality(lastYear, { now: NOW });
    expect(s.monthsObserved).toBe(12);
    expect(s.confidence).toBe("BUILDING");
    expect(s.profile.every((p) => p.yearsObserved === 1)).toBe(true);
    expect(s.peakMonths).toEqual(["July", "December"]);
  });

  it("refuses to call seasons from too little history", () => {
    const s = summarizeSeasonality(staysIn("2026-09", 5), { now: NOW });
    expect(s.confidence).toBe("EARLY");
    expect(s.peakMonths).toEqual([]);
    expect(s.nextPeak).toBeNull();
    expect(s.profile.every((p) => p.level === null)).toBe(true);
    expect(summarizeSeasonality([], { now: NOW }).confidence).toBe("NONE");
  });

  it("reads check-in weekdays and booking lead time from started stays only", () => {
    const s = summarizeSeasonality([...staysIn("2026-10", 3, 3), ...staysIn("2026-09", 1, 45), ...staysIn("2027-01", 4, 60)], { now: NOW });
    // 10 October 2026 and 10 September 2026 at 14:00 EAT are a Saturday and a Thursday.
    expect(s.busiestWeekday).toBe("Saturday");
    expect(s.weekdays.find((w) => w.name === "Thursday")!.stays).toBe(1);
    expect(s.lead).toEqual({ sameWeek: 3, upToMonth: 0, upToQuarter: 1, longer: 0, medianDays: 3 });
  });
});
