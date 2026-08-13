import { describe, expect, it } from "vitest";
import { MAX_ICAL_EVENTS, parseIcalFeed, parseIcalDate, parseIcalDurationDays, unfoldIcalLines } from "./icalParse.js";

const airbnbFeed = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN",
  "CALSCALE:GREGORIAN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20260820",
  "DTSTART;VALUE=DATE:20260817",
  "UID:1f2e3d4c5b6a@airbnb.com",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20260902",
  "DTSTART;VALUE=DATE:20260901",
  "UID:aaa111@airbnb.com",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcalFeed", () => {
  it("reads Airbnb date-only events as whole nights", () => {
    const { events, skipped } = parseIcalFeed(airbnbFeed);
    expect(skipped).toEqual([]);
    expect(events).toHaveLength(2);
    expect(events[0].uid).toBe("1f2e3d4c5b6a@airbnb.com");
    expect(events[0].start.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    // DTEND is exclusive: a 17th to 20th block is three nights, free on the 20th.
    expect(events[0].end.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(events[0].summary).toBe("Reserved");
  });

  it("gives an unchanged event the same hash and a moved one a different hash", () => {
    const first = parseIcalFeed(airbnbFeed).events[0];
    const again = parseIcalFeed(airbnbFeed).events[0];
    const moved = parseIcalFeed(airbnbFeed.replace("20260820", "20260821")).events[0];
    expect(first.hash).toBe(again.hash);
    expect(moved.hash).not.toBe(first.hash);
  });

  it("unfolds continuation lines before parsing", () => {
    const folded = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:very-long-ident", " ifier@example.com", "DTSTART;VALUE=DATE:20260101", "DTEND;VALUE=DATE:20260102", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    expect(parseIcalFeed(folded).events[0].uid).toBe("very-long-identifier@example.com");
  });

  it("treats a missing DTEND as a single night", () => {
    const feed = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:one@x", "DTSTART;VALUE=DATE:20260310", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const event = parseIcalFeed(feed).events[0];
    expect(event.end.toISOString()).toBe("2026-03-11T00:00:00.000Z");
  });

  it("expands DURATION when there is no DTEND", () => {
    const feed = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:dur@x", "DTSTART;VALUE=DATE:20260310", "DURATION:P3D", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    expect(parseIcalFeed(feed).events[0].end.toISOString()).toBe("2026-03-13T00:00:00.000Z");
  });

  it("promotes a zero-length event to one night", () => {
    const feed = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:same@x", "DTSTART;VALUE=DATE:20260310", "DTEND;VALUE=DATE:20260310", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    expect(parseIcalFeed(feed).events[0].end.toISOString()).toBe("2026-03-11T00:00:00.000Z");
  });

  it("flags a cancelled event rather than dropping it silently", () => {
    const feed = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:gone@x", "DTSTART;VALUE=DATE:20260310", "DTEND;VALUE=DATE:20260312", "STATUS:CANCELLED", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    expect(parseIcalFeed(feed).events[0].cancelled).toBe(true);
  });

  it("keeps good events when one is unreadable", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260310", "DTEND;VALUE=DATE:20260312", "END:VEVENT",
      "BEGIN:VEVENT", "UID:good@x", "DTSTART;VALUE=DATE:20260401", "DTEND;VALUE=DATE:20260403", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { events, skipped } = parseIcalFeed(feed);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe("good@x");
    expect(skipped).toEqual([{ uid: null, reason: "MISSING_UID" }]);
  });

  it("marks a snapshot truncated instead of silently treating omitted events as deleted", () => {
    const event = (index: number) => [
      "BEGIN:VEVENT",
      `UID:${index}@x`,
      "DTSTART;VALUE=DATE:20260310",
      "DTEND;VALUE=DATE:20260311",
      "END:VEVENT",
    ].join("\r\n");
    const feed = ["BEGIN:VCALENDAR", ...Array.from({ length: MAX_ICAL_EVENTS + 1 }, (_, index) => event(index)), "END:VCALENDAR"].join("\r\n");
    const result = parseIcalFeed(feed);
    expect(result.events).toHaveLength(MAX_ICAL_EVENTS);
    expect(result.truncated).toBe(true);
  });

  it("drops an event that ends before it starts", () => {
    const feed = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:bad@x", "DTSTART;VALUE=DATE:20260310", "DTEND;VALUE=DATE:20260301", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const { events, skipped } = parseIcalFeed(feed);
    expect(events).toEqual([]);
    expect(skipped[0].reason).toBe("END_BEFORE_START");
  });

  it("reduces a timed event to the day it starts on", () => {
    const feed = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:timed@x", "DTSTART:20260310T140000Z", "DTEND:20260312T100000Z", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const event = parseIcalFeed(feed).events[0];
    expect(event.start.toISOString()).toBe("2026-03-10T00:00:00.000Z");
    expect(event.end.toISOString()).toBe("2026-03-12T00:00:00.000Z");
  });

  it("unescapes text values", () => {
    const feed = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:esc@x", "DTSTART;VALUE=DATE:20260310", "DTEND;VALUE=DATE:20260311", "SUMMARY:Reserved\\, room 4\\; late", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    expect(parseIcalFeed(feed).events[0].summary).toBe("Reserved, room 4; late");
  });
});

describe("parseIcalDate", () => {
  it("accepts date and date-time forms", () => {
    expect(parseIcalDate("20260817")?.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(parseIcalDate("20260817T093000Z")?.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  it("rejects nonsense", () => {
    expect(parseIcalDate("not-a-date")).toBeNull();
    expect(parseIcalDate("20261317")).toBeNull();
  });
});

describe("parseIcalDurationDays", () => {
  it("reads whole-day durations", () => {
    expect(parseIcalDurationDays("P2D")).toBe(2);
    expect(parseIcalDurationDays("P1W")).toBe(7);
    expect(parseIcalDurationDays("PT6H")).toBeNull();
  });
});

describe("unfoldIcalLines", () => {
  it("joins tab and space continuations and normalizes line endings", () => {
    expect(unfoldIcalLines("A:one\r\n two\nB:three\n\tfour")).toEqual(["A:onetwo", "B:threefour"]);
  });
});
