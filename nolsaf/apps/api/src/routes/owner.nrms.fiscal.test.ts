import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadNrmsPropertyAccess: vi.fn(),
  connectionFindUnique: vi.fn(),
  connectionCreate: vi.fn(),
  connectionUpdate: vi.fn(),
  credentialFindFirst: vi.fn(),
  credentialCreate: vi.fn(),
  credentialUpdate: vi.fn(),
  credentialUpdateMany: vi.fn(),
  receiptCount: vi.fn(),
  receiptFindFirst: vi.fn(),
  receiptFindMany: vi.fn(),
  receiptUpdate: vi.fn(),
  orderFindFirst: vi.fn(),
  transaction: vi.fn(),
  enqueue: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    nrmsFiscalConnection: { findUnique: mocks.connectionFindUnique, create: mocks.connectionCreate, update: mocks.connectionUpdate },
    nrmsFiscalCredentialVersion: {
      findFirst: mocks.credentialFindFirst,
      create: mocks.credentialCreate,
      update: mocks.credentialUpdate,
      updateMany: mocks.credentialUpdateMany,
    },
    nrmsFiscalReceipt: { count: mocks.receiptCount, findFirst: mocks.receiptFindFirst, findMany: mocks.receiptFindMany, update: mocks.receiptUpdate },
    nrmsOutletOrder: { findFirst: mocks.orderFindFirst },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: 23, role: "OWNER" };
    next();
  },
  // Tax credentials sit behind the same guard as payout details. Passing it
  // through here keeps the tests about the route's own rules.
  blockImpersonated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/nrmsPropertyAccess.js", () => ({ loadNrmsPropertyAccess: mocks.loadNrmsPropertyAccess }));
vi.mock("../lib/crypto.js", () => ({ encrypt: (value: string) => `enc(${value.length})` }));
// The enqueue path itself is covered in nrmsFiscal.test.ts; here we assert what
// the route hands it.
vi.mock("../lib/nrmsFiscal.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueFiscalReceipt: mocks.enqueue,
}));

import fiscalRouter from "./owner.nrms.fiscal.js";

const app = express();
app.use(express.json());
app.use("/api/owner/nrms/fiscal", fiscalRouter);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadNrmsPropertyAccess.mockResolvedValue({ role: "OWNER", property: { id: 91 } });
  mocks.receiptCount.mockResolvedValue(0);
  mocks.connectionUpdate.mockResolvedValue({});
  mocks.credentialUpdateMany.mockResolvedValue({ count: 0 });
  mocks.receiptUpdate.mockResolvedValue({});
  mocks.auditCreate.mockResolvedValue({ id: 1 });
  mocks.transaction.mockImplementation(async (callback: any) => callback({
    nrmsFiscalConnection: { create: mocks.connectionCreate, update: mocks.connectionUpdate },
    nrmsFiscalCredentialVersion: {
      findFirst: mocks.credentialFindFirst,
      create: mocks.credentialCreate,
      update: mocks.credentialUpdate,
      updateMany: mocks.credentialUpdateMany,
    },
    nrmsFiscalReceipt: { update: mocks.receiptUpdate, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: mocks.auditCreate },
  }));
});

describe("GET /property/:id", () => {
  it("reports a clean off state for the properties that will never use this", async () => {
    mocks.connectionFindUnique.mockResolvedValue(null);
    const response = await request(app).get("/api/owner/nrms/fiscal/property/91");
    expect(response.status).toBe(200);
    expect(response.body.fiscal).toMatchObject({ enabled: false, mode: "OFF", status: "DISABLED" });
  });

  it("never returns a credential secret", async () => {
    mocks.connectionFindUnique.mockResolvedValue({
      id: 5,
      mode: "ALWAYS",
      status: "ACTIVE",
      tin: "123456789",
      credentialVersions: [
        { version: 2, status: "ACTIVE", validationStatus: "VALIDATED", encryptedData: "enc(400)", expiresAt: null, activatedAt: new Date() },
      ],
    });
    const response = await request(app).get("/api/owner/nrms/fiscal/property/91");
    const body = JSON.stringify(response.body);
    expect(body).not.toContain("enc(");
    expect(body).not.toContain("encryptedData");
    expect(response.body.fiscal.credential).toMatchObject({ version: 2, validationStatus: "VALIDATED" });
  });
});

describe("PUT /property/:id/identity", () => {
  it("refuses to move a live receipt series onto a different taxpayer", async () => {
    mocks.connectionFindUnique.mockResolvedValue({ id: 5, status: "DISABLED", tin: "111111111", vrn: "40000000", globalCounter: 1 });
    const response = await request(app)
      .put("/api/owner/nrms/fiscal/property/91/identity")
      .send({ tin: "222222222", vrn: "40000000", businessName: "Mikumi Lodge" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FISCAL_IDENTITY_LOCKED");
    expect(mocks.connectionUpdate).not.toHaveBeenCalled();
  });

  it("creates the connection off, never live, on first save", async () => {
    mocks.connectionFindUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: 5, mode: "OFF", status: "DISABLED", credentialVersions: [] });
    mocks.connectionCreate.mockResolvedValue({ id: 5, propertyId: 91 });
    const response = await request(app)
      .put("/api/owner/nrms/fiscal/property/91/identity")
      .send({ tin: "123456789", vrn: "40000000", businessName: "Mikumi Lodge" });
    expect(response.status).toBe(200);
    expect(mocks.connectionCreate.mock.calls[0][0].data).toMatchObject({ propertyId: 91, mode: "OFF", status: "DISABLED" });
  });
});

describe("POST /property/:id/credentials", () => {
  it("stages rather than activating, and encrypts the certificate with the password", async () => {
    mocks.connectionFindUnique.mockResolvedValueOnce({ id: 5 }).mockResolvedValue({ id: 5, mode: "OFF", status: "PENDING", credentialVersions: [] });
    mocks.credentialFindFirst.mockResolvedValue({ version: 1 });
    mocks.credentialCreate.mockResolvedValue({ id: 9 });
    const response = await request(app)
      .post("/api/owner/nrms/fiscal/property/91/credentials")
      .send({ username: "u", password: "p", certificate: "BASE64", certificatePassphrase: "cp", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(response.status).toBe(201);
    const data = mocks.credentialCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ connectionId: 5, version: 2, status: "STAGED" });
    expect(data.encryptedData).toMatch(/^enc\(/);
    expect(data.expiresAt).toBeNull();
    // The plaintext must never reach a column of its own.
    expect(JSON.stringify(data)).not.toContain("BASE64");
  });

  it("does not take an active connection offline while staging a rotation", async () => {
    mocks.connectionFindUnique
      .mockResolvedValueOnce({ id: 5, mode: "ALWAYS", status: "ACTIVE" })
      .mockResolvedValue({ id: 5, mode: "ALWAYS", status: "ACTIVE", credentialVersions: [] });
    mocks.credentialFindFirst.mockResolvedValue({ version: 1 });
    mocks.credentialCreate.mockResolvedValue({ id: 9 });

    const response = await request(app)
      .post("/api/owner/nrms/fiscal/property/91/credentials")
      .send({ username: "u", password: "p", certificate: "BASE64" });

    expect(response.status).toBe(201);
    const statusWrites = mocks.connectionUpdate.mock.calls.filter((call) => call[0].data.status);
    expect(statusWrites).toHaveLength(0);
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
  });

  it("does not let a manager stage taxpayer credentials", async () => {
    mocks.loadNrmsPropertyAccess.mockResolvedValue({ role: "MANAGER", property: { id: 91 } });
    const response = await request(app)
      .post("/api/owner/nrms/fiscal/property/91/credentials")
      .send({ username: "u", password: "p", certificate: "BASE64" });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FISCAL_OWNER_REQUIRED");
    expect(mocks.credentialCreate).not.toHaveBeenCalled();
  });

  it("will not take credentials before the registration details exist", async () => {
    mocks.connectionFindUnique.mockResolvedValue(null);
    const response = await request(app)
      .post("/api/owner/nrms/fiscal/property/91/credentials")
      .send({ username: "u", password: "p", certificate: "B" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FISCAL_IDENTITY_MISSING");
  });
});

describe("POST /property/:id/credentials/validate", () => {
  it("records a truthful failure rather than pretending to have verified anything", async () => {
    mocks.connectionFindUnique.mockResolvedValueOnce({ id: 5 }).mockResolvedValue({ id: 5, mode: "OFF", status: "PENDING", credentialVersions: [] });
    mocks.credentialFindFirst.mockResolvedValue({ id: 9, version: 1 });
    mocks.credentialUpdate.mockResolvedValue({});
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/credentials/validate").send({});
    expect(response.status).toBe(503);
    // The one thing that must never happen while the adapter is unbuilt.
    expect(mocks.credentialUpdate.mock.calls[0][0].data.validationStatus).toBe("FAILED");
  });
});

describe("POST /property/:id/activate", () => {
  const validated = {
    id: 5,
    status: "PENDING",
    mode: "OFF",
    credentialVersions: [{ id: 9, version: 1, status: "STAGED", validationStatus: "VALIDATED", expiresAt: "2030-01-01T00:00:00.000Z" }],
  };

  it("refuses without the taxpayer acknowledgement", async () => {
    mocks.connectionFindUnique.mockResolvedValue(validated);
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/activate").send({ mode: "ALWAYS" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("FISCAL_ACKNOWLEDGEMENT_REQUIRED");
    expect(mocks.connectionUpdate).not.toHaveBeenCalled();
  });

  it("refuses on credentials that were never verified", async () => {
    mocks.connectionFindUnique.mockResolvedValue({ ...validated, credentialVersions: [{ version: 1, status: "STAGED", validationStatus: "UNTESTED" }] });
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/activate").send({ mode: "ALWAYS", acknowledge: true });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FISCAL_CREDENTIAL_UNVERIFIED");
  });

  it("schedules for the next business day instead of going live mid day", async () => {
    mocks.connectionFindUnique.mockResolvedValueOnce(validated).mockResolvedValue({ ...validated, credentialVersions: [] });
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/activate").send({ mode: "ALWAYS", acknowledge: true });
    expect(response.status).toBe(200);
    const data = mocks.connectionUpdate.mock.calls[0][0].data;
    // VALIDATED, not ACTIVE: the worker promotes it when that day arrives, so a
    // day never ends half fiscalised.
    expect(data.status).toBe("VALIDATED");
    expect(data.pendingMode).toBe("ALWAYS");
    expect(data.activatesOnBusinessDate).toBeInstanceOf(Date);
    expect(data.acknowledgedById).toBe(23);
    expect(data.acknowledgementVersion).toBeTruthy();
  });

  it("activates a validated credential rotation atomically without stopping a live connection", async () => {
    const rotating = { ...validated, status: "ACTIVE", mode: "ALWAYS" };
    mocks.connectionFindUnique.mockResolvedValueOnce(rotating).mockResolvedValue({ ...rotating, credentialVersions: [] });

    const response = await request(app)
      .post("/api/owner/nrms/fiscal/property/91/activate")
      .send({ mode: "ALWAYS", acknowledge: true });

    expect(response.status).toBe(200);
    expect(response.body.activatesOnBusinessDate).toBeNull();
    expect(mocks.credentialUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ connectionId: 5, status: "ACTIVE" }),
      data: expect.objectContaining({ status: "REVOKED" }),
    }));
    expect(mocks.credentialUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9 },
      data: expect.objectContaining({ status: "ACTIVE" }),
    }));
    const connectionData = mocks.connectionUpdate.mock.calls[0][0].data;
    expect(connectionData).toMatchObject({ status: "ACTIVE", pendingMode: null, activatesOnBusinessDate: null });
  });

  it("refuses while an admin has the connection suspended", async () => {
    mocks.connectionFindUnique.mockResolvedValue({ ...validated, status: "SUSPENDED" });
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/activate").send({ mode: "ALWAYS", acknowledge: true });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FISCAL_SUSPENDED");
  });

  it("refuses a validated credential whose certificate expiry was not derived", async () => {
    mocks.connectionFindUnique.mockResolvedValue({
      ...validated,
      credentialVersions: [{ id: 9, version: 1, status: "STAGED", validationStatus: "VALIDATED", expiresAt: null }],
    });
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/activate").send({ mode: "ALWAYS", acknowledge: true });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FISCAL_CERTIFICATE_EXPIRY_UNVERIFIED");
  });
});

describe("POST /property/:id/credentials/revoke", () => {
  it("is owner only, not manager", async () => {
    mocks.loadNrmsPropertyAccess.mockResolvedValue({ role: "MANAGER", property: { id: 91 } });
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/credentials/revoke").send({});
    expect(response.status).toBe(403);
    expect(mocks.credentialUpdateMany).not.toHaveBeenCalled();
  });

  it("kills every version and takes the connection down immediately", async () => {
    mocks.connectionFindUnique.mockResolvedValueOnce({ id: 5 }).mockResolvedValue({ id: 5, mode: "OFF", status: "DISABLED", credentialVersions: [] });
    mocks.credentialUpdateMany.mockResolvedValue({ count: 2 });
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/credentials/revoke").send({});
    expect(response.status).toBe(200);
    // Revocation is not scheduled for a day boundary: the reason to revoke is
    // that the credential is compromised.
    expect(mocks.connectionUpdate.mock.calls[0][0].data).toMatchObject({ mode: "OFF", status: "DISABLED" });
    expect(mocks.credentialUpdateMany.mock.calls[0][0].data.status).toBe("REVOKED");
  });
});

describe("POST /property/:id/issue", () => {
  const active = { id: 5, mode: "ON_REQUEST", status: "ACTIVE" };

  it("refuses while the property is not fiscalising", async () => {
    mocks.connectionFindUnique.mockResolvedValue({ id: 5, mode: "OFF", status: "DISABLED" });
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/issue").send({ sourceType: "OUTLET_SALE", sourceId: 8842 });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FISCAL_NOT_ACTIVE");
  });

  it("refuses a sale that belongs to another property", async () => {
    mocks.connectionFindUnique.mockResolvedValue(active);
    mocks.orderFindFirst.mockResolvedValue(null);
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/issue").send({ sourceType: "OUTLET_SALE", sourceId: 8842 });
    expect(response.status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("issues for a sale from days ago, which is the whole point of on request", async () => {
    // A guest returning on Wednesday for Monday's receipt. Nothing here limits
    // the sale to today, and the closed business day is never touched.
    const monday = new Date("2026-08-24T11:00:00.000Z");
    mocks.connectionFindUnique.mockResolvedValue(active);
    mocks.orderFindFirst.mockResolvedValue({ settledAt: monday, currency: "TZS", total: 45000, orderNumber: "BAR-1", customerLabel: "Table 4" });
    mocks.enqueue.mockResolvedValue({ id: 900 });

    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/issue").send({ sourceType: "OUTLET_SALE", sourceId: 8842 });
    expect(response.status).toBe(201);
    expect(mocks.enqueue.mock.calls[0][1]).toMatchObject({
      propertyId: 91,
      connectionId: 5,
      sourceType: "OUTLET_SALE",
      sourceId: 8842,
      saleOccurredAt: monday,
      grossAmount: 45000,
    });
  });

  it("does not issue a second document for a sale that already has one", async () => {
    mocks.connectionFindUnique.mockResolvedValue(active);
    mocks.orderFindFirst.mockResolvedValue({ settledAt: new Date(), currency: "TZS", total: 1000, orderNumber: "BAR-2", customerLabel: null });
    mocks.enqueue.mockResolvedValue(null);
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/issue").send({ sourceType: "OUTLET_SALE", sourceId: 8842 });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FISCAL_ALREADY_ISSUED");
  });
});

describe("POST /receipts/:receiptId/retry", () => {
  it("revives a dead letter and restarts the backoff from the first step", async () => {
    mocks.receiptFindFirst.mockResolvedValue({ id: 900 });
    mocks.receiptUpdate.mockResolvedValue({});
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/receipts/900/retry").send({});
    expect(response.status).toBe(200);
    const data = mocks.receiptUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "PENDING", attemptCount: 0, lastError: null });
    // Delivery stays the worker's job and stays in counter order; this only
    // clears the wait.
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("will not retry a confirmed receipt", async () => {
    mocks.receiptFindFirst.mockResolvedValue(null);
    const response = await request(app).post("/api/owner/nrms/fiscal/property/91/receipts/900/retry").send({});
    expect(response.status).toBe(404);
    expect(mocks.receiptUpdate).not.toHaveBeenCalled();
  });
});
