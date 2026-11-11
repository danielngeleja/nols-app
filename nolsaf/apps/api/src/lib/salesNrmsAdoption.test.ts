import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ notifyUser: vi.fn(async () => undefined), notifyAdmins: vi.fn(async () => undefined) }));
vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));
vi.mock("./notifications.js", () => ({ notifyUser: h.notifyUser, notifyAdmins: h.notifyAdmins }));

import { lapseUnadoptedNrmsClaims, NRMS_LAPSE_REASON } from "./salesNrmsAdoption.js";

const NOW = new Date("2026-11-11T09:00:00.000Z");

function client(rows: any[], updated = 1) {
  const c: any = {
    propertySalesAttribution: { findMany: vi.fn(async () => rows), updateMany: vi.fn(async () => ({ count: updated })) },
    salesOwnerConfirmation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  c.$transaction = vi.fn(async (fn: (tx: any) => unknown) => fn(c));
  return c;
}

const row = { id: 9, status: "VERIFIED", salesPartnerId: 4, propertyId: 30, property: { title: "Minza Executive Lodge" }, salesPartner: { userId: 77 } };

beforeEach(() => vi.clearAllMocks());

describe("lapseUnadoptedNrmsClaims", () => {
  it("looks only for NRMS claims on properties without NRMS, older than 90 days", async () => {
    const c = client([]);
    await lapseUnadoptedNrmsClaims(NOW, c);
    const where = c.propertySalesAttribution.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ productType: "NRMS", status: { in: ["PENDING", "VERIFIED", "ACTIVE", "DISPUTED"] }, property: { nrmsActivatedAt: null } });
    expect(where.OR[0].verifiedAt.lte.toISOString()).toBe("2026-08-13T09:00:00.000Z");
  });

  it("lapses the claim, ends its window, cancels the owner question, audits and tells the partner", async () => {
    const c = client([row]);
    expect(await lapseUnadoptedNrmsClaims(NOW, c)).toEqual({ lapsed: 1 });
    expect(c.propertySalesAttribution.updateMany).toHaveBeenCalledWith({
      // Guarded, so an owner switching NRMS on at the same moment wins.
      where: { id: 9, status: "VERIFIED", salesPartnerId: 4, property: { nrmsActivatedAt: null } },
      data: { status: "LAPSED", commissionEndsAt: NOW, disputeReason: NRMS_LAPSE_REASON, notes: NRMS_LAPSE_REASON },
    });
    expect(c.salesOwnerConfirmation.updateMany).toHaveBeenCalledWith({ where: { attributionId: 9, status: "PENDING" }, data: { status: "CANCELLED", activeKey: null } });
    expect(c.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorRole: "SYSTEM", action: "SALES_ATTRIBUTION_NRMS_LAPSE", entityId: 9 }) });
    expect(h.notifyUser).toHaveBeenCalledWith(77, "sales_partner_attribution_lapsed", expect.objectContaining({ propertyName: "Minza Executive Lodge", days: 90 }));
    expect(h.notifyAdmins).toHaveBeenCalledWith("sales_partner_nrms_claim_lapsed", expect.objectContaining({ propertyTitle: "Minza Executive Lodge", attributionId: 9 }));
  });

  it("does nothing more when the claim changed first (NRMS switched on, or an admin acted)", async () => {
    const c = client([row], 0);
    expect(await lapseUnadoptedNrmsClaims(NOW, c)).toEqual({ lapsed: 0 });
    expect(c.salesOwnerConfirmation.updateMany).not.toHaveBeenCalled();
    expect(c.auditLog.create).not.toHaveBeenCalled();
    expect(h.notifyUser).not.toHaveBeenCalled();
  });
});
