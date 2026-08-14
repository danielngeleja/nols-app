import { describe, expect, it } from "vitest";
import { parseIcalFeed } from "./icalParse.js";
import { calendarBlockData, ICAL_MISSING_GRACE_POLLS, isOwnCalendarExport, missingEventAction } from "./icalSync.js";

const event = parseIcalFeed([
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:busy@airbnb.com",
  "DTSTART;VALUE=DATE:20260817",
  "DTEND;VALUE=DATE:20260820",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n")).events[0];

describe("iCal inventory hold lifecycle", () => {
  it("maps availability evidence to an external block, not a guest reservation", () => {
    expect(calendarBlockData({
      propertyId: 10,
      ownerId: 20,
      roomTypeName: "Garden Suite",
      providerCode: "AIRBNB",
      label: "Suite listing",
    }, event)).toEqual({
      propertyId: 10,
      ownerId: 20,
      startDate: event.start,
      endDate: event.end,
      roomCode: "Garden Suite",
      source: "AIRBNB",
      kind: "CHANNEL_CALENDAR",
      bedsBlocked: 1,
      notes: "Suite listing - Reserved",
    });
  });

  it("retains an absent event until repeated complete snapshots agree", () => {
    let missingCount = 0;
    for (let poll = 1; poll < ICAL_MISSING_GRACE_POLLS; poll += 1) {
      const action = missingEventAction(missingCount, false);
      expect(action.release).toBe(false);
      missingCount = action.missingCount;
    }
    expect(missingEventAction(missingCount, false).release).toBe(true);
  });

  it("trusts an explicit provider cancellation immediately", () => {
    expect(missingEventAction(0, true).release).toBe(true);
  });

  it("recognizes NoLSAF-exported events so a two-way calendar cannot echo them back", () => {
    expect(isOwnCalendarExport({ uid: "nrms-7-20260817-20260820@nolsaf.com" })).toBe(true);
    expect(isOwnCalendarExport({ uid: "busy@airbnb.com" })).toBe(false);
  });
});
