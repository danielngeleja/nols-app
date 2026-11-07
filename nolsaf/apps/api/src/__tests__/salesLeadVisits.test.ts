// Visit mode: the warning-sign rules, and the partner check-in endpoint with
// the database, auth and photo storage stood in for.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateVisit, haversineMeters, visitActivityText, visitTimingError } from "../lib/salesLeadVisits.js";

const MIN = 60_000;
const base = (overrides: Partial<Parameters<typeof evaluateVisit>[0]> = {}) => ({
  position: { lat: -6.8, lng: 39.28 },
  accuracyMeters: 20,
  positionAt: new Date(Date.now() - 10_000),
  capturedAt: new Date(Date.now() - 5_000),
  receivedAt: new Date(),
  reference: null,
  previousVisit: null,
  photoSeenBefore: false,
  recentVisitCount: 0,
  ...overrides,
});

describe("visit rules", () => {
  it("measures distance on the globe", () => {
    // Dar es Salaam to Bagamoyo is roughly 65 km.
    const km = haversineMeters({ lat: -6.8161, lng: 39.2803 }, { lat: -6.4333, lng: 38.9 }) / 1000;
    expect(km).toBeGreaterThan(55);
    expect(km).toBeLessThan(65);
  });

  it("a clean check-in at the property is verified", () => {
    const result = evaluateVisit(base({ reference: { lat: -6.8005, lng: 39.2805 } }));
    expect(result).toMatchObject({ status: "VERIFIED", flags: [] });
    expect(result.distanceMeters).toBeLessThan(100);
  });

  it("flags a check-in far from the property, allowing for GPS accuracy", () => {
    expect(evaluateVisit(base({ reference: { lat: -6.81, lng: 39.28 } })).flags).toContain("FAR_FROM_PROPERTY");
    expect(evaluateVisit(base({ reference: { lat: -6.805, lng: 39.28 }, accuracyMeters: 120 })).flags).not.toContain("FAR_FROM_PROPERTY");
  });

  it("flags imprecise, artificial or cached GPS", () => {
    expect(evaluateVisit(base({ accuracyMeters: 400 })).flags).toContain("LOW_ACCURACY");
    expect(evaluateVisit(base({ accuracyMeters: 0 })).flags).toContain("SUSPICIOUS_ACCURACY");
    expect(evaluateVisit(base({ positionAt: new Date(Date.now() - 20 * MIN) })).flags).toContain("STALE_POSITION");
  });

  it("flags impossible travel between two check-ins, but not short hops", () => {
    const now = new Date();
    const far = { lat: -6.43, lng: 38.9, capturedAt: new Date(now.getTime() - 10 * MIN) }; // ~60 km, 10 min earlier
    expect(evaluateVisit(base({ capturedAt: now, previousVisit: far })).flags).toContain("IMPOSSIBLE_TRAVEL");
    const near = { lat: -6.801, lng: 39.281, capturedAt: new Date(now.getTime() - 1 * MIN) };
    expect(evaluateVisit(base({ capturedAt: now, previousVisit: near })).flags).not.toContain("IMPOSSIBLE_TRAVEL");
  });

  it("flags a reused photo, a burst and a late upload", () => {
    const result = evaluateVisit(base({ photoSeenBefore: true, recentVisitCount: 6, capturedAt: new Date(Date.now() - 2 * 60 * MIN) }));
    expect(result.flags).toEqual(expect.arrayContaining(["REUSED_PHOTO", "BURST", "DELAYED_UPLOAD"]));
    expect(result.status).toBe("FLAGGED");
  });

  it("refuses capture times from the future or older than 48 hours", () => {
    const now = new Date();
    expect(visitTimingError(new Date(now.getTime() + 10 * MIN), now)).toBe("CAPTURED_IN_FUTURE");
    expect(visitTimingError(new Date(now.getTime() - 49 * 60 * MIN), now)).toBe("TOO_OLD");
    expect(visitTimingError(new Date(now.getTime() - 3 * 60 * MIN), now)).toBeNull();
  });

  it("writes a plain timeline line", () => {
    expect(visitActivityText({ status: "VERIFIED", distanceMeters: 120, referenceSource: "PROPERTY", metWith: "OWNER" }))
      .toBe("Verified visit, 120 m from the property. Met the owner.");
    expect(visitActivityText({ status: "VERIFIED", distanceMeters: null, referenceSource: "NONE", metWith: "NOBODY" }))
      .toMatch(/first check-in, sets the property location/);
  });
});

// ---- endpoint ---------------------------------------------------------------

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesLead: { findFirst: fn(), findMany: fn(), update: fn() },
    salesLeadVisit: { findFirst: fn(), findMany: fn(), count: fn(), create: fn() },
    salesLeadActivity: { create: fn() },
  };
  db.$transaction = vi.fn(async (operation: (tx: any) => unknown) => operation(db));
  return { db, upload: vi.fn(async () => "sales-visits/11/abc"), remove: vi.fn(async () => undefined), audit: vi.fn(async () => undefined) };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: h.audit }));
vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSigningSecret: () => "test-secret", publicLinkSecrets: () => ["test-secret"] }));
vi.mock("../lib/salesVisitPhotos.js", () => ({
  uploadVisitPhoto: h.upload,
  deleteVisitPhoto: h.remove,
  signedVisitPhotoUrl: (id: string) => `https://signed.example/${id}`,
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = Number(req.get("x-test-user-id"));
    if (!Number.isInteger(id) || id <= 0) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id, role: "USER", imp: req.get("x-test-impersonated") === "true" };
    return next();
  },
  blockImpersonated: (req: any, res: any, next: any) => (req.user?.imp ? res.status(403).json({ error: "Not during support session" }) : next()),
}));
vi.mock("../middleware/salesWorkspace.js", () => ({
  requireWorkspaceAccess: () => (req: any, _res: any, next: any) => {
    req.salesPartner = { partnerId: Number(req.get("x-test-partner") || 11) };
    next();
  },
  requireActivePartnerContract: (_req: any, _res: any, next: any) => next(),
  partnerIdFor: (req: any) => req.salesPartner?.partnerId ?? null,
}));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesLeadRead: pass, limitSalesLeadWrite: pass };
});

import visitsRouter from "../routes/sales.visits.js";
import { leadRef } from "../lib/salesReference.js";

const app = express();
app.use(express.json());
app.use("/api/sales", visitsRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const partner = { "x-test-user-id": "101" };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function checkIn(fields: Record<string, string> = {}, withPhoto = true) {
  const req = request(app).post(`/api/sales/leads/${leadRef(5)}/visits`).set(partner);
  const values = { latitude: "-6.8", longitude: "39.28", accuracy: "20", capturedAt: new Date().toISOString(), metWith: "OWNER", ...fields };
  for (const [key, value] of Object.entries(values)) req.field(key, value);
  return withPhoto ? req.attach("photo", jpeg, { filename: "p.jpg", contentType: "image/jpeg" }) : req;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (operation: (tx: any) => unknown) => operation(h.db));
  h.db.salesLead.findMany.mockResolvedValue([{ id: 5 }]);
  h.db.salesLead.findFirst.mockResolvedValue({ id: 5, status: "CONTACTED", propertyName: "Jamirex", convertedProperty: null });
  h.db.salesLeadVisit.findFirst.mockResolvedValue(null);
  h.db.salesLeadVisit.count.mockResolvedValue(0);
  h.db.salesLeadVisit.create.mockImplementation(async ({ data }: any) => ({ id: 77, ...data, createdBy: { name: "Asha" } }));
});

describe("POST /leads/:id/visits", () => {
  it("records a verified first check-in with a private photo and extends the claim", async () => {
    const res = await checkIn();
    expect(res.status).toBe(201);
    expect(res.body.visit).toMatchObject({ id: 77, status: "VERIFIED", referenceSource: "NONE", photoUrl: "https://signed.example/sales-visits/11/abc" });
    expect(res.body.visit).not.toHaveProperty("photoHash");
    const data = h.db.salesLeadVisit.create.mock.calls[0][0].data;
    expect(data.photoHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.db.salesLeadActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "VISIT" }) });
    expect(h.db.salesLead.update).toHaveBeenCalled();
  });

  it("flags a check-in far from the first one and does not extend the claim", async () => {
    h.db.salesLeadVisit.findFirst.mockResolvedValue({ latitude: "-6.9", longitude: "39.28", capturedAt: new Date(Date.now() - 3 * 60 * MIN) });
    const res = await checkIn();
    expect(res.status).toBe(201);
    expect(res.body.visit.status).toBe("FLAGGED");
    expect(res.body.visit.flags.map((f: any) => f.code)).toContain("FAR_FROM_PROPERTY");
    expect(h.db.salesLead.update).not.toHaveBeenCalled();
  });

  it("needs a photo, a valid position and an honest time", async () => {
    expect((await checkIn({}, false)).status).toBe(400);
    expect((await checkIn({ latitude: "200" })).status).toBe(400);
    expect((await checkIn({ capturedAt: new Date(Date.now() + 30 * MIN).toISOString() })).status).toBe(400);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("only works on the partner's own open lead", async () => {
    h.db.salesLead.findFirst.mockResolvedValue(null);
    expect((await checkIn()).status).toBe(404);
    h.db.salesLead.findFirst.mockResolvedValue({ id: 5, status: "CONVERTED", convertedProperty: null });
    expect((await checkIn()).status).toBe(409);
  });

  it("refuses support sessions", async () => {
    const res = await request(app).post(`/api/sales/leads/${leadRef(5)}/visits`).set({ ...partner, "x-test-impersonated": "true" }).field("metWith", "OWNER");
    expect(res.status).toBe(403);
  });

  it("removes the uploaded photo when the visit cannot be saved", async () => {
    h.db.$transaction.mockRejectedValueOnce(new Error("db down"));
    const res = await checkIn();
    expect(res.status).toBe(500);
    expect(h.remove).toHaveBeenCalledWith("sales-visits/11/abc");
  });
});
