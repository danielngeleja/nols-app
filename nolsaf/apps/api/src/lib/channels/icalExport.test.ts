import { describe, expect, it } from "vitest";
import { buildIcalDocument, foldIcalLine, mergeBusyDays } from "./icalExport.js";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("mergeBusyDays", () => {
  it("collapses consecutive sold-out nights into one period", () => {
    const periods = mergeBusyDays([
      { day: day("2026-08-01"), available: 2 },
      { day: day("2026-08-02"), available: 0 },
      { day: day("2026-08-03"), available: 0 },
      { day: day("2026-08-04"), available: 1 },
    ]);
    expect(periods).toHaveLength(1);
    expect(periods[0].start.toISOString()).toBe("2026-08-02T00:00:00.000Z");
    // Exclusive end: the room frees up on the 4th.
    expect(periods[0].end.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("keeps separated periods apart", () => {
    const periods = mergeBusyDays([
      { day: day("2026-08-01"), available: 0 },
      { day: day("2026-08-02"), available: 3 },
      { day: day("2026-08-03"), available: 0 },
    ]);
    expect(periods.map((period) => period.start.toISOString().slice(0, 10))).toEqual(["2026-08-01", "2026-08-03"]);
  });

  it("publishes nothing while a room type still has a unit left", () => {
    expect(mergeBusyDays([{ day: day("2026-08-01"), available: 1 }])).toEqual([]);
  });

  describe("safety margin", () => {
    const nights = [
      { day: day("2026-08-01"), available: 3 },
      { day: day("2026-08-02"), available: 2 },
      { day: day("2026-08-03"), available: 1 },
      { day: day("2026-08-04"), available: 0 },
    ];

    it("closes a night once availability falls to the margin", () => {
      const periods = mergeBusyDays(nights, 1);
      expect(periods).toHaveLength(1);
      // The 3rd is held back with one room still free; without the margin only
      // the 4th would close.
      expect(periods[0].start.toISOString().slice(0, 10)).toBe("2026-08-03");
      expect(periods[0].end.toISOString().slice(0, 10)).toBe("2026-08-05");
    });

    it("holds back more rooms as the margin grows", () => {
      expect(mergeBusyDays(nights, 2)[0].start.toISOString().slice(0, 10)).toBe("2026-08-02");
      expect(mergeBusyDays(nights, 3)[0].start.toISOString().slice(0, 10)).toBe("2026-08-01");
    });

    it("behaves as before with no margin", () => {
      expect(mergeBusyDays(nights, 0)).toEqual(mergeBusyDays(nights));
    });

    it("ignores a negative or fractional margin", () => {
      expect(mergeBusyDays(nights, -5)).toEqual(mergeBusyDays(nights, 0));
      expect(mergeBusyDays(nights, 1.9)).toEqual(mergeBusyDays(nights, 1));
    });
  });
});

describe("buildIcalDocument", () => {
  const document = buildIcalDocument({
    calendarName: "Kilimanjaro Lodge - Garden Suite",
    roomTypeId: 7,
    periods: [{ start: day("2026-08-02"), end: day("2026-08-04") }],
    now: new Date("2026-08-01T09:30:00.000Z"),
  });

  it("emits a well-formed CRLF calendar", () => {
    expect(document.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(document.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(document).toContain("DTSTART;VALUE=DATE:20260802");
    expect(document).toContain("DTEND;VALUE=DATE:20260804");
    expect(document).toContain("SUMMARY:Not available");
  });

  it("keeps a period's identity stable across rebuilds", () => {
    const again = buildIcalDocument({
      calendarName: "Kilimanjaro Lodge - Garden Suite",
      roomTypeId: 7,
      periods: [{ start: day("2026-08-02"), end: day("2026-08-04") }],
      now: new Date("2026-08-02T11:00:00.000Z"),
    });
    const uid = (text: string) => /UID:(.+)/.exec(text)?.[1];
    expect(uid(again)).toBe(uid(document));
  });

  it("never leaks a guest name", () => {
    expect(document).not.toMatch(/ATTENDEE|ORGANIZER|DESCRIPTION/);
  });
});

describe("foldIcalLine", () => {
  it("leaves a short line alone", () => {
    expect(foldIcalLine("SUMMARY:Not available")).toBe("SUMMARY:Not available");
  });

  it("folds a long line with a leading space on continuations", () => {
    const folded = foldIcalLine(`X-WR-CALNAME:${"a".repeat(200)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((line) => line.startsWith(" "))).toBe(true);
    expect(lines.map((line, index) => (index === 0 ? line : line.slice(1))).join("")).toBe(`X-WR-CALNAME:${"a".repeat(200)}`);
  });
});
