import { describe, expect, it } from "vitest";
import { agentProFormaSource } from "./nrmsAgentInvoice.js";

describe("agentProFormaSource", () => {
  const request = {
    id: 42,
    propertyId: 3,
    property: { id: 3, ownerId: 7, title: "Serengeti Hotel" },
    checkIn: new Date("2026-09-01T00:00:00.000Z"),
    checkOut: new Date("2026-09-03T00:00:00.000Z"),
    currency: "TZS",
    quotedTotal: 600_000,
    roomsRequested: 3,
    roomType: { name: "Double" },
    link: { agentAccount: { legalName: "Safari Agency", tradingName: "Safari Co", contactName: "Amina", contactEmail: "billing@example.com", contactPhone: "+255700000000" } },
  };

  it("produces the shared Pro Forma shape with the agency and stay reference", () => {
    const source = agentProFormaSource(request, { id: 9, items: [], payments: [], refunds: [] });
    expect(source).toMatchObject({ reference: "AGB-000042", agencyName: "Safari Co", contactName: "Amina", contactEmail: "billing@example.com", currency: "TZS" });
    expect(source.rooms[0]).toMatchObject({ quantity: 3, nightlyRate: 100_000, roomType: { name: "Double" } });
  });

  it("uses the verified agency identity when no trading name exists", () => {
    const source = agentProFormaSource({ ...request, link: { agentAccount: { ...request.link.agentAccount, tradingName: null } } }, { id: 9 });
    expect(source.agencyName).toBe("Safari Agency");
  });
});
