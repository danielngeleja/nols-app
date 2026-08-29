import { describe, expect, it } from "vitest";
import { buildInquiryConversionReport } from "./nrmsInquiryReporting.js";

describe("buildInquiryConversionReport", () => {
  it("links ad sources through response, hold and confirmation", () => {
    const createdAt = new Date("2026-09-01T10:00:00.000Z");
    const report = buildInquiryConversionReport(
      [
        { kind: "DIRECT:PAGE_OPEN:INSTAGRAM", count: 100 },
        { kind: "DIRECT:PAGE_OPEN:WHATSAPP", count: 50 },
        { kind: "DIRECT:ROOM_SELECTED:INSTAGRAM", count: 30 },
      ],
      [
        { source: "INSTAGRAM", createdAt, firstResponseAt: new Date("2026-09-01T10:05:00.000Z"), reservationId: 20, reservation: { status: "CONFIRMED" } },
        { source: "INSTAGRAM", createdAt, firstResponseAt: new Date("2026-09-01T10:15:00.000Z"), reservationId: 21, reservation: { status: "HELD" } },
        { source: "WHATSAPP", createdAt, firstResponseAt: null, reservationId: null, reservation: null },
      ],
    );
    expect(report.funnel).toEqual({ visits: 150, inquiries: 3, responded: 2, holds: 2, confirmed: 1 });
    expect(report.rates).toEqual({ visitToInquiryPct: 2, inquiryToHoldPct: 66.67, holdToConfirmedPct: 50 });
    expect(report.averageFirstResponseMinutes).toBe(10);
    expect(report.sources[0]).toEqual({ source: "INSTAGRAM", visits: 100, inquiries: 2, responded: 2, holds: 2, confirmed: 1 });
  });
});
