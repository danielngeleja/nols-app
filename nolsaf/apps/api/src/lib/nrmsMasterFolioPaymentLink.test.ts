import { describe, expect, it, vi } from "vitest";
import {
  agencyProFormaPayBlocker,
  issueMasterFolioPaymentLink,
  MASTER_FOLIO_PAYMENT_LINK_TTL_MS,
  serializeMasterFolioPaymentLink,
} from "./nrmsMasterFolioPaymentLink.js";

function fakeDb(overrides: { balance?: number; folioStatus?: string; existing?: any; quoted?: number | null; ledgerItems?: number } = {}) {
  const balance = overrides.balance ?? 125_000;
  const ledgerItems = overrides.ledgerItems ?? (balance > 0 ? 1 : 0);
  const quoted = overrides.quoted ?? null;
  const existing = overrides.existing ?? null;
  const created = {
    id: 8,
    masterFolioId: 4,
    publicToken: "fresh-token",
    amount: balance,
    currency: "TZS",
    status: "ACTIVE",
    expiresAt: new Date("2026-09-25T15:00:00.000Z"),
  };
  return {
    nrmsMasterFolio: {
      findUnique: vi.fn(async () => ({ id: 4, currency: "TZS", status: overrides.folioStatus ?? "OPEN" })),
    },
    nrmsMasterFolioItem: {
      aggregate: vi.fn(async () => ({ _sum: { amount: balance } })),
      count: vi.fn(async () => ledgerItems),
    },
    nrmsMasterFolioProForma: { findFirst: vi.fn(async () => (quoted == null ? null : { quotedTotal: quoted })) },
    nrmsMasterFolioPayment: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
    nrmsMasterFolioRefund: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
    nrmsMasterFolioPaymentLink: {
      findFirst: vi.fn(async (query: any) => query?.where?.status === "PROCESSING" ? null : existing),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => created),
    },
  };
}

describe("master folio payment links", () => {
  it("issues a new link for exactly three hours and revokes older live links", async () => {
    const db = fakeDb();
    const now = new Date("2026-09-25T12:00:00.000Z");
    const link = await issueMasterFolioPaymentLink(db, 4, 19, { now });
    expect(db.nrmsMasterFolioPaymentLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { masterFolioId: 4, status: { in: ["ACTIVE", "PROCESSING"] } },
    }));
    expect(db.nrmsMasterFolioPaymentLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        masterFolioId: 4,
        amount: 125_000,
        createdById: 19,
        expiresAt: new Date(now.getTime() + MASTER_FOLIO_PAYMENT_LINK_TTL_MS),
      }),
    });
    expect(link.publicToken).toBe("fresh-token");
  });

  it("reuses a matching live link during repeated rooming-list confirmation", async () => {
    const existing = { id: 7, publicToken: "same-token", amount: 125_000, currency: "TZS", status: "ACTIVE", expiresAt: new Date("2026-09-25T15:00:00.000Z") };
    const db = fakeDb({ existing });
    const link = await issueMasterFolioPaymentLink(db, 4, 19, { reuseMatching: true, now: new Date("2026-09-25T12:00:00.000Z") });
    expect(link).toBe(existing);
    expect(db.nrmsMasterFolioPaymentLink.updateMany).not.toHaveBeenCalled();
    expect(db.nrmsMasterFolioPaymentLink.create).not.toHaveBeenCalled();
  });

  it("does not issue a payment capability for a settled balance", async () => {
    const db = fakeDb({ balance: 0, folioStatus: "SETTLED" });
    await expect(issueMasterFolioPaymentLink(db, 4, 19)).rejects.toThrow("NRMS_MASTER_PAYMENT_COMPLETE");
  });

  it("refuses regeneration while an AzamPay payment is in flight", async () => {
    const db = fakeDb();
    db.nrmsMasterFolioPaymentLink.findFirst.mockImplementation(async (query: any) =>
      query?.where?.status === "PROCESSING" ? { id: 99 } : null,
    );
    await expect(issueMasterFolioPaymentLink(db, 4, 19)).rejects.toThrow("NRMS_MASTER_PAYMENT_IN_FLIGHT");
    expect(db.nrmsMasterFolioPaymentLink.updateMany).not.toHaveBeenCalled();
  });

  it("charges the Pro Forma as an advance before any room has been billed", async () => {
    const db = fakeDb({ balance: 0, ledgerItems: 0, quoted: 1_125_000 });
    await issueMasterFolioPaymentLink(db, 4, null, { now: new Date("2026-09-25T12:00:00.000Z") });
    expect(db.nrmsMasterFolioPaymentLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 1_125_000, createdById: null }),
    });
  });

  it("lets billed charges override the Pro Forma once the ledger has history", async () => {
    const db = fakeDb({ balance: 90_000, ledgerItems: 3, quoted: 1_125_000 });
    await issueMasterFolioPaymentLink(db, 4, 19, { now: new Date("2026-09-25T12:00:00.000Z") });
    expect(db.nrmsMasterFolioPaymentLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 90_000 }),
    });
  });

  it("only lets an agency pay from a Pro Forma that is current and in date", () => {
    const now = new Date("2026-09-26T10:00:00.000Z");
    expect(agencyProFormaPayBlocker({ status: "SENT", validUntil: "2026-09-26", masterFolioId: 4 }, now)).toBeNull();
    expect(agencyProFormaPayBlocker({ status: "DRAFT", validUntil: "2026-10-01", masterFolioId: 4 }, now)).toBeNull();
    expect(agencyProFormaPayBlocker({ status: "SUPERSEDED", validUntil: "2026-10-01", masterFolioId: 4 }, now)?.code).toBe("SUPERSEDED");
    expect(agencyProFormaPayBlocker({ status: "SENT", validUntil: "2026-09-25", masterFolioId: 4 }, now)?.code).toBe("EXPIRED");
  });

  it("serializes only the public checkout fields", () => {
    const serialized = serializeMasterFolioPaymentLink({ publicToken: "abc", amount: 9000, currency: "TZS", status: "ACTIVE", expiresAt: new Date("2026-09-25T15:00:00.000Z") });
    expect(serialized).toMatchObject({ amount: 9000, currency: "TZS", status: "ACTIVE" });
    expect(serialized?.url).toContain("/nrms/group/payment/abc");
  });
});
