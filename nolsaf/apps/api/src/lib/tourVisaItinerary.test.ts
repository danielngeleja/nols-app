import { describe, expect, it } from "vitest";
import {
  assessVisaItineraryReadiness,
  buildVisaItineraryModel,
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

  it("resolves a paid booking into the itinerary model", () => {
    const model = buildVisaItineraryModel(base());
    expect(model.documentTitle).toBe("Visa-support travel itinerary");
    expect(model.status).toEqual({ label: "Confirmed and paid", tone: "confirmed" });
    expect(model.arrival).toBe("01 October 2026");
    expect(model.departure).toBe("03 October 2026");
    expect(model.duration).toBe("3 days");
    expect(model.arrangements).toContain("Accommodation: Savannah Lodge");
    expect(model.days[0]).toMatchObject({ day: 1, overnight: "Savannah Lodge", date: "01 October 2026", timeline: [{ time: "14:00", text: "Airport pickup" }] });
    expect(model.travellers.map((t) => t.name)).toEqual(["Asha & Musa", "Neema Musa"]);
    expect(model.issuedLabel).toMatch(/EAT$/);
    expect(JSON.stringify(model)).not.toContain("—");
  });

  it("names every traveller from the traveller records with masked document numbers", () => {
    const model = buildVisaItineraryModel(base({
      guestName: "Asha Musa",
      travellers: [
        { fullName: "John Smith", nationality: "British", documentType: "PASSPORT", documentNumber: "987654321" },
        { fullName: "Asha Musa", nationality: "Kenyan", documentType: "PASSPORT", documentNumber: "AB1234567" },
      ],
    }));
    expect(model.travellers[0]).toEqual({ name: "Asha Musa", nationality: "Kenyan", document: "Passport ••••4567", lead: true });
    expect(model.travellers[1].document).toBe("Passport ••••4321");
    expect(JSON.stringify(model)).not.toContain("AB1234567");
    expect(maskDocumentNumber("X12")).toBe("X12");
  });

  it("shows the operator's licensing and address", () => {
    const model = buildVisaItineraryModel(base({
      operator: { name: "Trusted Tours Ltd", tourismLicence: "TALA-0042", registrationNumber: "BRELA-778", address: "Plot 5, Arusha" },
    }));
    expect(model.operatorFacts).toEqual(expect.arrayContaining([["Tourism licence", "TALA-0042"], ["Business registration", "BRELA-778"], ["Registered address", "Plot 5, Arusha"]]));
  });

  it("marks the booking provisional while a case is open", () => {
    expect(buildVisaItineraryModel(base({ openCaseCount: 1 })).status.tone).toBe("review");
  });

  it("uses a plain travel itinerary title when every traveller is Tanzanian", () => {
    const model = buildVisaItineraryModel(base({ metadata: {}, travellers: [{ fullName: "Asha & Musa", nationality: "Tanzanian" }] }));
    expect(model.documentTitle).toBe("Travel itinerary");
  });

  it("renders a multi-page A4 PDF with the barcode and page numbers", async () => {
    const { generateTourVisaItineraryPdf } = await import("./tourVisaItineraryPdf.js");
    const days = Array.from({ length: 12 }, (_, i) => ({ day: i + 1, title: `Day ${i + 1} safari`, overnight: "Camp", timeline: [{ time: "07:00-09:00", label: "Game drive" }, { time: "13:00-15:00", label: "Lunch and rest" }] }));
    const model = buildVisaItineraryModel(base({ packageSnapshot: { itinerary: days } }));
    const pdf = await generateTourVisaItineraryPdf({ model, verificationUrl: "https://nolsaf.com/verify/tour-itinerary/1.x", qrPng: null });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Page objects stay uncompressed; "/Type /Pages" (the tree root) is excluded.
    const pageCount = (pdf.toString("latin1").match(new RegExp("/Type /Page(?!s)", "g")) || []).length;
    expect(pageCount).toBeGreaterThan(1);
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
