import { describe, expect, it, vi } from "vitest";

vi.mock("./salesLeadAvailability.js", () => ({
  loadLeadAvailability: vi.fn(async () => ({ lead: "CLEAR", ownLeadId: null, listed: false })),
  availabilityRefusal: vi.fn(() => null),
}));
vi.mock("./salesLeadDuplicates.js", () => ({
  findLeadDuplicates: vi.fn(async () => []),
  duplicateEvidence: vi.fn(() => ({})),
}));

import { loadLeadAvailability, availabilityRefusal } from "./salesLeadAvailability.js";
import {
  assignVisitRequest,
  closeVisitRequest,
  createVisitRequest,
  isVisitRef,
  newVisitRef,
  productForInterest,
  VisitRequestError,
} from "./salesVisitRequests.js";

const now = new Date("2026-11-26T08:00:00Z");
const farFuture = new Date("2027-12-31T00:00:00Z");

function partnerRow(overrides: any = {}) {
  return {
    id: 7,
    userId: 70,
    agentCode: "NSA-DAR-0007",
    status: "ACTIVE",
    regionId: 1,
    user: { name: "Asha", fullName: "Asha Mussa", suspendedAt: null, isDisabled: false },
    contracts: [{ status: "ACTIVE", startsAt: new Date("2026-01-01"), expiresAt: farFuture }],
    ...overrides,
  };
}

function request(overrides: any = {}) {
  return {
    id: 11,
    publicRef: "VR-ABCDEFGH",
    status: "NEW",
    regionId: 1,
    contactName: "Juma",
    contactPhone: "0712 345 678",
    contactEmail: null,
    propertyName: "Juma Guest House",
    propertyType: "Guest house",
    estimatedRooms: 8,
    location: "Mikocheni",
    interest: "NOT_SURE",
    message: "Call after 5pm",
    ...overrides,
  };
}

function mockDb(opts: { partner?: any; claimCount?: number } = {}) {
  const tx = {
    salesVisitRequest: { updateMany: vi.fn(async (_args: any) => ({ count: opts.claimCount ?? 1 })), update: vi.fn(async () => ({})) },
    salesLead: { create: vi.fn(async (_args: any) => ({ id: 501 })) },
    salesLeadActivity: { create: vi.fn(async () => ({})) },
  };
  const db: any = {
    salesPartnerProfile: { findUnique: vi.fn(async () => opts.partner ?? partnerRow()) },
    salesRegion: { findUnique: vi.fn(async () => ({ name: "Dar es Salaam" })), findFirst: vi.fn(async () => ({ id: 1, name: "Dar es Salaam", leadPartnerId: 9 })) },
    salesVisitRequest: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => ({ id: 12, publicRef: data.publicRef, regionId: data.regionId, status: "NEW" })), updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  return { db, tx };
}

const lead = { role: "REGION_LEAD" as const, userId: 90, region: { id: 1, name: "Dar es Salaam", leadPartnerId: 9 } };

describe("visit request references", () => {
  it("are VR- plus 8 unambiguous characters", () => {
    const ref = newVisitRef();
    expect(isVisitRef(ref)).toBe(true);
    expect(ref).toMatch(/^VR-[A-HJ-NP-Z2-9]{8}$/);
    expect(isVisitRef("VR-0000OOOO")).toBe(false);
    expect(isVisitRef("42")).toBe(false);
  });

  it("maps 'not sure' to both products", () => {
    expect(productForInterest("NOT_SURE")).toBe("NRMS_AND_MARKETPLACE");
    expect(productForInterest("NRMS")).toBe("NRMS");
  });
});

describe("createVisitRequest", () => {
  const input = { contactName: "Juma", contactPhone: "0712 345 678", contactEmail: null, propertyName: "Juma Guest House", propertyType: null, estimatedRooms: null, regionCode: "DAR", location: "Mikocheni", interest: "NOT_SURE" as const, message: null };

  it("saves with a normalised phone and the chosen region", async () => {
    const { db } = mockDb();
    const out = await createVisitRequest(db, input, { ipHash: "h", now });
    expect(out.created).toBe(true);
    const data = db.salesVisitRequest.create.mock.calls[0][0].data;
    expect(data.contactPhoneNormalized).toBe("255712345678");
    expect(data.regionId).toBe(1);
    expect(isVisitRef(data.publicRef)).toBe(true);
  });

  it("returns the open request from the same phone instead of a second one", async () => {
    const { db } = mockDb();
    db.salesVisitRequest.findFirst.mockResolvedValueOnce({ id: 3, publicRef: "VR-EXISTING", regionId: 1, status: "NEW" });
    const out = await createVisitRequest(db, input, { ipHash: null, now });
    expect(out.created).toBe(false);
    expect(out.request.publicRef).toBe("VR-EXISTING");
    expect(db.salesVisitRequest.create).not.toHaveBeenCalled();
  });

  it("refuses a phone that cannot be called", async () => {
    const { db } = mockDb();
    await expect(createVisitRequest(db, { ...input, contactPhone: "123" }, { ipHash: null, now })).rejects.toBeInstanceOf(VisitRequestError);
  });
});

describe("assignVisitRequest", () => {
  it("creates the partner's lead with the owner's contact and a 48h follow-up", async () => {
    const { db, tx } = mockDb();
    const out = await assignVisitRequest(db, request(), { agentCode: "nsa-dar-0007" }, lead, now);
    expect(out.leadId).toBe(501);
    const data = tx.salesLead.create.mock.calls[0][0].data;
    expect(data.salesPartnerId).toBe(7);
    expect(data.contactPhone).toBe("0712 345 678");
    expect(data.proposedProduct).toBe("NRMS_AND_MARKETPLACE");
    expect(data.nextFollowUpAt.getTime() - now.getTime()).toBe(48 * 3_600_000);
    expect(tx.salesVisitRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ASSIGNED", assignedPartnerId: 7, assignedByRole: "REGION_LEAD" });
  });

  it("does not let a regional lead assign to themself", async () => {
    const { db } = mockDb({ partner: partnerRow({ id: 9 }) });
    await expect(assignVisitRequest(db, request(), { agentCode: "NSA-DAR-0009" }, lead, now)).rejects.toMatchObject({ status: 403 });
  });

  it("does not let a regional lead assign outside their region", async () => {
    const { db } = mockDb({ partner: partnerRow({ regionId: 2 }) });
    await expect(assignVisitRequest(db, request(), { agentCode: "NSA-DAR-0007" }, lead, now)).rejects.toMatchObject({ status: 403 });
    const { db: db2 } = mockDb();
    await expect(assignVisitRequest(db2, request({ regionId: 3 }), { agentCode: "NSA-DAR-0007" }, lead, now)).rejects.toMatchObject({ status: 403 });
  });

  it("lets an admin assign anywhere, including a regional lead", async () => {
    const { db } = mockDb({ partner: partnerRow({ id: 9, regionId: 4 }) });
    const out = await assignVisitRequest(db, request(), { agentCode: "NSA-DAR-0009" }, { role: "ADMIN", userId: 1 }, now);
    expect(out.partner.id).toBe(9);
  });

  it("refuses a partner without a current agreement", async () => {
    const { db } = mockDb({ partner: partnerRow({ contracts: [] }) });
    await expect(assignVisitRequest(db, request(), { agentCode: "NSA-DAR-0007" }, { role: "ADMIN", userId: 1 }, now)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses when another partner already works the property", async () => {
    vi.mocked(loadLeadAvailability).mockResolvedValueOnce({ lead: "TAKEN", ownLeadId: null, listed: false });
    const { db, tx } = mockDb();
    await expect(assignVisitRequest(db, request(), { agentCode: "NSA-DAR-0007" }, { role: "ADMIN", userId: 1 }, now)).rejects.toMatchObject({ code: "LEAD_TAKEN" });
    expect(tx.salesLead.create).not.toHaveBeenCalled();
  });

  it("links the partner's own existing lead instead of duplicating it", async () => {
    vi.mocked(loadLeadAvailability).mockResolvedValueOnce({ lead: "OWN", ownLeadId: 300, listed: false });
    const { db, tx } = mockDb();
    const out = await assignVisitRequest(db, request(), { agentCode: "NSA-DAR-0007" }, { role: "ADMIN", userId: 1 }, now);
    expect(out).toMatchObject({ leadId: 300, linkedExisting: true });
    expect(tx.salesLead.create).not.toHaveBeenCalled();
  });

  it("asks for NRMS when the property is already listed", async () => {
    vi.mocked(availabilityRefusal).mockReturnValueOnce({ code: "ALREADY_LISTED", error: "listed" });
    const { db } = mockDb();
    await expect(assignVisitRequest(db, request({ interest: "MARKETPLACE" }), { agentCode: "NSA-DAR-0007" }, { role: "ADMIN", userId: 1 }, now)).rejects.toMatchObject({ code: "ALREADY_LISTED" });
  });

  it("loses cleanly when someone else assigned it first", async () => {
    const { db, tx } = mockDb({ claimCount: 0 });
    await expect(assignVisitRequest(db, request(), { agentCode: "NSA-DAR-0007" }, { role: "ADMIN", userId: 1 }, now)).rejects.toMatchObject({ status: 409 });
    expect(tx.salesLead.create).not.toHaveBeenCalled();
  });

  it("will not touch a request already handled", async () => {
    const { db } = mockDb();
    await expect(assignVisitRequest(db, request({ status: "ASSIGNED" }), { agentCode: "NSA-DAR-0007" }, { role: "ADMIN", userId: 1 }, now)).rejects.toMatchObject({ status: 409 });
    await expect(closeVisitRequest(db, request({ status: "CLOSED" }), "spam", 1, now)).rejects.toMatchObject({ status: 409 });
  });
});
