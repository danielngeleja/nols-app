import { describe, expect, it, vi } from "vitest";
import { agentCoverDecision, describeIncidentalCover } from "./nrmsAgentIncidentals.js";

type RequestOver = Record<string, unknown>;

function fakeTx(over: RequestOver = {}, routedExtras: number[] = []) {
  const request = {
    incidentalBilling: "AGENCY",
    incidentalScope: "ALL",
    incidentalCategories: null,
    incidentalCapAmount: null,
    incidentalCapBasis: null,
    adults: 2,
    children: 0,
    checkIn: new Date("2026-09-01T00:00:00.000Z"),
    checkOut: new Date("2026-09-04T00:00:00.000Z"), // 3 nights
    ...over,
  };
  return {
    request,
    nrmsMasterFolio: { findUnique: vi.fn().mockResolvedValue({ id: 88, agentBookingRequestId: 42 }) },
    nrmsAgentBookingRequest: { findUnique: vi.fn().mockResolvedValue(request) },
    reservation: { findUnique: vi.fn().mockResolvedValue({ adults: 2, children: 0 }) },
    nrmsMasterFolioItem: { findMany: vi.fn().mockResolvedValue(routedExtras.map((amount) => ({ amount }))) },
  };
}

describe("describeIncidentalCover", () => {
  it("reads a row written before the cover columns existed as covering everything", () => {
    const cover = describeIncidentalCover({ incidentalBilling: "AGENCY" });
    expect(cover).toMatchObject({ scope: "ALL", capAmount: null, headline: "Agency covers everything" });
  });

  it("states the limit and its basis in the detail line", () => {
    const cover = describeIncidentalCover({
      incidentalBilling: "AGENCY",
      incidentalScope: "SELECTED",
      incidentalCategories: ["RESTAURANT", "BAR"],
      incidentalCapAmount: 50000,
      incidentalCapBasis: "PER_TRAVELLER_PER_NIGHT",
    });
    expect(cover.headline).toBe("Agency covers part");
    expect(cover.detail).toContain("Restaurant, Bar");
    expect(cover.detail).toContain("50,000 per traveller per night");
  });

  it("does not claim a cover when the agency named no category", () => {
    const cover = describeIncidentalCover({ incidentalBilling: "AGENCY", incidentalScope: "SELECTED", incidentalCategories: [] });
    expect(cover.detail).toContain("traveller's own bill");
  });
});

describe("agentCoverDecision", () => {
  const charge = (over: Record<string, unknown> = {}) => ({ reservationId: 901, category: "BAR", amount: 10_000, ...over });

  it("leaves an ordinary group block to its billing mode", async () => {
    const tx = fakeTx();
    tx.nrmsMasterFolio.findUnique.mockResolvedValue({ id: 88, agentBookingRequestId: null });
    await expect(agentCoverDecision(tx as any, 88, charge())).resolves.toMatchObject({ route: true });
  });

  it("routes any category when the agency covers everything", async () => {
    const tx = fakeTx();
    await expect(agentCoverDecision(tx as any, 88, charge({ category: "LAUNDRY" }))).resolves.toMatchObject({ route: true });
  });

  it("keeps an uncovered category on the traveller's own folio", async () => {
    const tx = fakeTx({ incidentalScope: "SELECTED", incidentalCategories: ["RESTAURANT"] });
    await expect(agentCoverDecision(tx as any, 88, charge({ category: "BAR" }))).resolves.toMatchObject({
      route: false,
      reason: "CATEGORY_NOT_COVERED",
    });
  });

  it("counts the limit per traveller per night", async () => {
    // 20,000 x 2 travellers x 3 nights = 120,000 of cover.
    const tx = fakeTx({ incidentalCapAmount: 20_000, incidentalCapBasis: "PER_TRAVELLER_PER_NIGHT" }, [100_000]);
    await expect(agentCoverDecision(tx as any, 88, charge({ amount: 25_000 }))).resolves.toMatchObject({
      route: false,
      reason: "COVER_LIMIT_REACHED",
    });
    // Landing exactly on the ceiling is still covered.
    await expect(agentCoverDecision(tx as any, 88, charge({ amount: 20_000 }))).resolves.toMatchObject({ route: true });
  });

  it("counts a booking-wide limit against everything already routed", async () => {
    const tx = fakeTx({ incidentalCapAmount: 50_000, incidentalCapBasis: "BOOKING_TOTAL" }, [30_000, 15_000]);
    await expect(agentCoverDecision(tx as any, 88, charge({ amount: 6_000 }))).resolves.toMatchObject({ route: false });
    await expect(agentCoverDecision(tx as any, 88, charge({ amount: 5_000 }))).resolves.toMatchObject({ route: true });
  });

  it("keeps per-traveller limits on the stay that incurred the charge", async () => {
    const tx = fakeTx({ incidentalCapAmount: 50_000, incidentalCapBasis: "PER_TRAVELLER_STAY" }, [40_000]);
    tx.reservation.findUnique.mockResolvedValue({ adults: 1, children: 0 });
    await agentCoverDecision(tx as any, 88, charge({ amount: 10_000 }));
    expect(tx.nrmsMasterFolioItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reservationId: 901 }),
    }));
  });

  it("never routes when the travellers settle their own extras", async () => {
    const tx = fakeTx({ incidentalBilling: "INDIVIDUAL_GUEST" });
    await expect(agentCoverDecision(tx as any, 88, charge())).resolves.toMatchObject({
      route: false,
      reason: "GUESTS_SETTLE_EXTRAS",
    });
  });
});
