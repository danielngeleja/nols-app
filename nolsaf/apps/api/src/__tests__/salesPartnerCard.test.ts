// Sales partner ID cards: token and code security, live validity, the public
// check and issuing. Database, auth and limits are stood in for.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesPartnerCard: { findUnique: fn(), findFirst: fn(), update: fn(), updateMany: fn(), count: fn(), create: fn() },
    salesPartnerProfile: { findUnique: fn() },
  };
  db.$transaction = vi.fn(async (operation: (tx: any) => unknown) => operation(db));
  return { db, audit: vi.fn(async () => undefined) };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSigningSecret: () => "test-secret" }));
vi.mock("../lib/audit.js", () => ({ audit: h.audit }));
vi.mock("../lib/redisRateLimitStore.js", () => ({ rateLimitWithRedis: () => (_req: any, _res: any, next: any) => next() }));
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
    req.salesPartner = { partnerId: 11 };
    next();
  },
  requireActivePartnerContract: (_req: any, _res: any, next: any) => next(),
  partnerIdFor: (req: any) => req.salesPartner?.partnerId ?? null,
}));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesLeadRead: pass, limitSalesLeadWrite: pass };
});

import {
  cardCode,
  cardToken,
  cardValidity,
  checkSegmentMatches,
  hashCardToken,
  parseCardCode,
} from "../lib/salesPartnerCard.js";
import publicRouter from "../routes/public.salesCards.js";
import cardRouter from "../routes/sales.card.js";

const app = express();
app.use(express.json());
app.use("/api/public/sales-cards", publicRouter);
app.use("/api/sales", cardRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const DAY = 24 * 60 * 60 * 1000;
const contract = () => ({ status: "ACTIVE", startsAt: new Date(Date.now() - 30 * DAY), expiresAt: new Date(Date.now() + 200 * DAY) });
const card = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  salt: "a".repeat(32),
  cardNumber: "NSA-DAR-0001-C1",
  photoUrl: "https://res.cloudinary.com/x/face.jpg",
  status: "ACTIVE",
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 100 * DAY),
  salesPartner: { agentCode: "NSA-DAR-0001", status: "ACTIVE", region: "Dar es Salaam", territory: null, user: { name: "Asha Juma" }, contracts: [contract()] },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (operation: (tx: any) => unknown) => operation(h.db));
  h.db.salesPartnerCard.update.mockImplementation(async ({ data }: any) => ({ ...card(), ...data }));
});

describe("card security", () => {
  it("the link token depends on the server secret and salt, and only its hash is stored", () => {
    const a = cardToken({ id: 3, salt: "a".repeat(32) });
    const b = cardToken({ id: 3, salt: "b".repeat(32) });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashCardToken(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("the typed code carries a check segment that a guessed card number cannot pass", () => {
    const code = cardCode({ id: 3, salt: "a".repeat(32), cardNumber: "NSA-DAR-0001-C1" });
    const parsed = parseCardCode(code.toLowerCase().replace(/-/g, " "))!;
    expect(parsed.cardNumber).toBe("NSA-DAR-0001-C1");
    expect(checkSegmentMatches({ id: 3, salt: "a".repeat(32) }, parsed.check)).toBe(true);
    expect(checkSegmentMatches({ id: 3, salt: "a".repeat(32) }, "AAAAAAAA")).toBe(false);
  });

  it("validity is decided live", () => {
    const base = { card: { status: "ACTIVE", expiresAt: new Date(Date.now() + DAY) }, partnerStatus: "ACTIVE", contracts: [contract()] };
    expect(cardValidity(base)).toBe("VALID");
    expect(cardValidity({ ...base, card: { ...base.card, status: "REVOKED" } })).toBe("REVOKED");
    expect(cardValidity({ ...base, card: { ...base.card, expiresAt: new Date(Date.now() - 1) } })).toBe("EXPIRED");
    expect(cardValidity({ ...base, partnerStatus: "SUSPENDED" })).toBe("PARTNER_INACTIVE");
    expect(cardValidity({ ...base, contracts: [] })).toBe("NO_CONTRACT");
  });
});

describe("public check", () => {
  it("a valid card shows the holder, counts the check and is never cached", async () => {
    h.db.salesPartnerCard.findUnique.mockResolvedValue(card());
    const token = cardToken(card());
    const res = await request(app).get(`/api/public/sales-cards/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.card).toMatchObject({ valid: true, name: "Asha Juma", agentCode: "NSA-DAR-0001" });
    expect(res.body.card).not.toHaveProperty("phone");
    expect(h.db.salesPartnerCard.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashCardToken(token) } }));
    expect(h.db.salesPartnerCard.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ verifyCount: { increment: 1 } }) }));
  });

  it("a revoked card still says who it was, and warns", async () => {
    h.db.salesPartnerCard.findUnique.mockResolvedValue(card({ status: "REVOKED" }));
    const res = await request(app).get(`/api/public/sales-cards/${cardToken(card())}`);
    expect(res.body.card).toMatchObject({ valid: false, validity: "REVOKED", name: "Asha Juma" });
    expect(h.db.salesPartnerCard.update).not.toHaveBeenCalled();
  });

  it("unknown tokens and wrong codes get the same not-found answer", async () => {
    h.db.salesPartnerCard.findUnique.mockResolvedValue(null);
    const a = await request(app).get(`/api/public/sales-cards/${"x".repeat(43)}`);
    const b = await request(app).get("/api/public/sales-cards/short");
    h.db.salesPartnerCard.findUnique.mockResolvedValue(card());
    const c = await request(app).get("/api/public/sales-cards/code/NSA-DAR-0001-C1-AAAAAAAA");
    expect([a.status, b.status, c.status]).toEqual([404, 404, 404]);
    expect(a.body).toEqual(c.body);
  });

  it("the typed code works", async () => {
    h.db.salesPartnerCard.findUnique.mockResolvedValue(card());
    const res = await request(app).get(`/api/public/sales-cards/code/${cardCode(card())}`);
    expect(res.status).toBe(200);
    expect(res.body.card.valid).toBe(true);
  });
});

describe("issuing", () => {
  const partner = (overrides: Record<string, unknown> = {}) => ({
    id: 11, agentCode: "NSA-DAR-0001", status: "ACTIVE", level: "STARTER", region: "Dar es Salaam", territory: null,
    user: { name: "Asha Juma", fullName: null, avatarUrl: "https://res.cloudinary.com/x/face.jpg" },
    contracts: [contract()],
    ...overrides,
  });
  const as = { "x-test-user-id": "101" };

  it("needs a profile photo", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner({ user: { name: "Asha", avatarUrl: null } }));
    const res = await request(app).post("/api/sales/id-card").set(as);
    expect(res.status).toBe(409);
    expect(h.db.salesPartnerCard.create).not.toHaveBeenCalled();
  });

  it("replaces the old card and stores only the token hash", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner());
    h.db.salesPartnerCard.updateMany.mockResolvedValue({ count: 1 });
    h.db.salesPartnerCard.count.mockResolvedValue(1);
    h.db.salesPartnerCard.create.mockImplementation(async ({ data }: any) => ({ id: 9, ...data, verifyCount: 0, lastVerifiedAt: null }));
    const res = await request(app).post("/api/sales/id-card").set(as);
    expect(res.status).toBe(201);
    expect(h.db.salesPartnerCard.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REPLACED", activeKey: null }) }));
    const created = h.db.salesPartnerCard.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ cardNumber: "NSA-DAR-0001-C2", activeKey: 11, photoUrl: "https://res.cloudinary.com/x/face.jpg" });
    const finalHash = h.db.salesPartnerCard.update.mock.calls[0][0].data.tokenHash;
    expect(finalHash).toBe(hashCardToken(cardToken({ id: 9, salt: created.salt })));
    expect(res.body.card.verifyUrl).toContain("/verify/sales/");
  });

  it("refuses support sessions", async () => {
    const res = await request(app).post("/api/sales/id-card").set({ ...as, "x-test-impersonated": "true" });
    expect(res.status).toBe(403);
  });
});
