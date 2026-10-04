import { describe, it, expect } from "vitest";
import { parseStay } from "../lib/twiga/stayDates";

// Wednesday 16 September 2026, mid-morning in Dar es Salaam.
const NOW = new Date("2026-09-16T06:00:00.000Z");

const stay = (text: string) => parseStay(text, NOW);

describe("parseStay: explicit dates", () => {
  it("reads a compressed range", () => {
    expect(stay("free from 12 to 15 October?")).toMatchObject({ checkIn: "2026-10-12", checkOut: "2026-10-15", nights: 3 });
  });

  it("reads two full dates and the party size", () => {
    expect(stay("from 12 Oct to 15 Oct for 4 people")).toMatchObject({
      checkIn: "2026-10-12",
      checkOut: "2026-10-15",
      guests: 4,
    });
  });

  it("reads an ISO date with a length of stay", () => {
    expect(stay("2026-10-12 for 3 nights")).toMatchObject({ checkIn: "2026-10-12", checkOut: "2026-10-15", nights: 3 });
  });

  it("reads day-first numeric dates", () => {
    expect(stay("arriving 12/10/2026")).toMatchObject({ checkIn: "2026-10-12", checkOut: "2026-10-13", nights: 1 });
  });

  it("rolls a range across the new year", () => {
    expect(stay("28 dec to 2 jan")).toMatchObject({ checkIn: "2026-12-28", checkOut: "2027-01-02", nights: 5 });
  });

  it("treats a yearless date that has passed as next year", () => {
    expect(stay("5 March")).toMatchObject({ checkIn: "2027-03-05", checkOut: "2027-03-06" });
  });
});

describe("parseStay: relative dates", () => {
  it("tomorrow defaults to one night", () => {
    expect(stay("tomorrow")).toMatchObject({ checkIn: "2026-09-17", checkOut: "2026-09-18", nights: 1 });
  });

  it("this weekend is Friday in, Sunday out", () => {
    expect(stay("this weekend")).toMatchObject({ checkIn: "2026-09-18", checkOut: "2026-09-20", nights: 2 });
  });

  it("a weekday with a length of stay", () => {
    expect(stay("on Friday for 2 nights")).toMatchObject({ checkIn: "2026-09-18", checkOut: "2026-09-20" });
  });

  it("understands Kiswahili", () => {
    expect(stay("kesho usiku 2 watu 3")).toMatchObject({ checkIn: "2026-09-17", checkOut: "2026-09-19", guests: 3 });
    expect(stay("12 hadi 15 oktoba")).toMatchObject({ checkIn: "2026-10-12", checkOut: "2026-10-15" });
  });
});

describe("parseStay: when it should not guess", () => {
  it("returns nothing for a message without dates", () => {
    expect(stay("Where is my booking?")).toMatchObject({ mentionsDates: false, checkIn: null, problem: null });
  });

  it("flags dates in the past", () => {
    expect(stay("2025-01-01")).toMatchObject({ mentionsDates: true, checkIn: null, problem: "past" });
  });

  it("flags a stay that is too far ahead", () => {
    expect(stay("2029-01-01")).toMatchObject({ checkIn: null, problem: "too_far" });
  });

  it("flags a stay that is unreasonably long", () => {
    expect(stay("2026-10-01 to 2026-12-30")).toMatchObject({ checkIn: null, problem: "too_long" });
  });
});
