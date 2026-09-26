import { describe, expect, it } from "vitest";
import {
  assessVisaItineraryReadiness,
  buildTourVisaItineraryHtml,
  maskDocumentNumber,
  normalizeVisaItineraryDays,
  type TourVisaItineraryInput,
} from "./tourVisaItinerary.js";

const base = (over: Partial<TourVisaItineraryInput> = {}): TourVisaItineraryInput => ({
  bookingCode: "TOUR-20260926-ABC123",
  title: "Safari <Escape>",
  destination: "Arusha",
  startDate: "2026-10-01T00:00:00.000Z",
  endDate: "2026-10-03T00:00:00.000Z",
  travelerCount: 2,
  guestName: "Asha & Musa",
  nationality: "Tanzanian",
  paymentStatus: "PAID",
  bookingStatus: "CONFIRMED",
  currency: "USD",
  amountPaid: 1200,
  issuedAt: "2026-09-26T00:00:00.000Z",
  packageSnapshot: {
    accommodation: "Savannah Lodge",
    itinerary: [{ day: 1, title: "Arrival", overnight: "Savannah Lodge", timeline: [{ time: "14:00", label: "Airport pickup" }] }],
  },
  operatorSnapshot: { companyName: "Trusted Tours", contactEmail: "ops@example.com" },
  metadata: { groupMembers: [{ fullName: "Neema Musa", nationality: "Kenyan", relation: "Family" }] },
  ...over,
});

describe("tour visa itinerary document", () => {
  it("normalizes day and event shapes, including the overnight stay", () => {
    expect(normalizeVisaItineraryDays({
      itinerary: [{ day: 2, title: "Serengeti", accommodation: "Camp A", timeline: [{ startTime: "08:00", activity: "Game drive" }] }],
    }, null)).toEqual([{
      day: 2,
      title: "Serengeti",
      description: "",
      overnight: "Camp A",
      timeline: [{ time: "08:00", label: "Game drive", description: "" }],
    }]);
  });

  it("renders a paid booking as an escaped A4 itinerary in the document font", () => {
    const rendered = buildTourVisaItineraryHtml(base());
    expect(rendered).toContain("Visa-support travel itinerary");
    expect(rendered).toContain("Confirmed and paid");
    expect(rendered).toContain("01 October 2026");
    expect(rendered).toContain("03 October 2026");
    expect(rendered).toContain("3 days");
    expect(rendered).toContain("Savannah Lodge");
    expect(rendered).toContain("<b>Overnight</b> Savannah Lodge");
    expect(rendered).toContain("Airport pickup");
    expect(rendered).toContain("Safari &lt;Escape&gt;");
    expect(rendered).toContain("Asha &amp; Musa");
    expect(rendered).toContain("Travelling party");
    expect(rendered).toContain("Neema Musa");
    expect(rendered).toContain("Trebuchet MS");
    expect(rendered).toContain("EAT");
    expect(rendered).not.toContain("Safari <Escape>");
    expect(rendered).not.toContain("—");
  });

  it("carries the document number as a Code 128 barcode", () => {
    const rendered = buildTourVisaItineraryHtml(base());
    expect(rendered).toContain("Code 128 barcode NLSAF-VI-20260926-ABC123");
    expect(rendered).toContain("CODE 128 · ISO/IEC 15417");
  });

  it("names every traveller from the traveller records with masked document numbers", () => {
    const rendered = buildTourVisaItineraryHtml(base({
      guestName: "Asha Musa",
      travellers: [
        { fullName: "Asha Musa", nationality: "Kenyan", documentType: "PASSPORT", documentNumber: "AB1234567" },
        { fullName: "John Smith", nationality: "British", documentType: "PASSPORT", documentNumber: "987654321" },
      ],
    }));
    expect(rendered).toContain("John Smith");
    expect(rendered).toContain("Passport ••••4567");
    expect(rendered).not.toContain("AB1234567");
    expect(maskDocumentNumber("X12")).toBe("X12");
  });

  it("shows the operator's licensing and address", () => {
    const rendered = buildTourVisaItineraryHtml(base({
      operator: { name: "Trusted Tours Ltd", tourismLicence: "TALA-0042", registrationNumber: "BRELA-778", address: "Plot 5, Arusha" },
    }));
    expect(rendered).toContain("TALA-0042");
    expect(rendered).toContain("BRELA-778");
    expect(rendered).toContain("Plot 5, Arusha");
  });

  it("marks the booking provisional while a case is open", () => {
    expect(buildTourVisaItineraryHtml(base({ openCaseCount: 1 }))).toContain("Provisional: booking under review");
  });

  it("uses a plain travel itinerary title when every traveller is Tanzanian", () => {
    const rendered = buildTourVisaItineraryHtml(base({ metadata: {}, travellers: [{ fullName: "Asha & Musa", nationality: "Tanzanian" }] }));
    expect(rendered).toContain("<div class=\"kind\">Travel itinerary</div>");
  });
});

describe("visa itinerary readiness", () => {
  const now = new Date("2026-09-26T09:00:00.000Z");
  const plan = { itinerary: [{ day: 1, title: "Arrival" }] };

  it("is ready for an upcoming trip with both dates and a daily plan", () => {
    expect(assessVisaItineraryReadiness({ startDate: "2026-10-01", endDate: "2026-10-03", bookingStatus: "CONFIRMED", packageSnapshot: plan }, now)).toMatchObject({ ready: true, missing: [] });
  });

  it("refuses a trip that has already started or finished", () => {
    expect(assessVisaItineraryReadiness({ startDate: "2026-06-18", endDate: "2026-06-20", bookingStatus: "CONFIRMED", packageSnapshot: plan }, now).ready).toBe(false);
    expect(assessVisaItineraryReadiness({ startDate: "2026-10-01", endDate: "2026-10-03", bookingStatus: "COMPLETED", packageSnapshot: plan }, now).ready).toBe(false);
  });

  it("lists what is missing", () => {
    const result = assessVisaItineraryReadiness({ startDate: "2026-10-01", endDate: null, bookingStatus: "CONFIRMED", packageSnapshot: {} }, now);
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["The trip end date is not set yet.", "Your operator has not added the day-by-day schedule yet."]);
  });
});

describe("trip end date", () => {
  it("works out the end from the day-by-day plan when the booking has no end date", async () => {
    const { resolveTripEndDate, assessVisaItineraryReadiness: assess } = await import("./tourVisaItinerary.js");
    const plan = { itinerary: [{ day: 1, title: "Arrival" }, { day: 2, title: "Serengeti" }, { day: 3, title: "Return" }] };
    const end = resolveTripEndDate({ startDate: "2026-10-12T00:00:00.000Z", endDate: null, packageSnapshot: plan });
    expect(end).toEqual({ date: new Date("2026-10-14T00:00:00.000Z"), derived: true });
    expect(assess({ startDate: "2026-10-12", endDate: null, bookingStatus: "CONFIRMED", packageSnapshot: plan }, new Date("2026-09-26T09:00:00Z")).ready).toBe(true);
  });

  it("falls back to the package duration, and keeps a stored end date as is", async () => {
    const { resolveTripEndDate } = await import("./tourVisaItinerary.js");
    expect(resolveTripEndDate({ startDate: "2026-10-12T00:00:00.000Z", packageSnapshot: { duration: "4 days" } }).date).toEqual(new Date("2026-10-15T00:00:00.000Z"));
    expect(resolveTripEndDate({ startDate: "2026-10-12", endDate: "2026-10-20", packageSnapshot: { duration: "4 days" } }).derived).toBe(false);
  });
});
