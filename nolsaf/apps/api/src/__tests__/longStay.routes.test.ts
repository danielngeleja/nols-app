// Long-stay routes: the admin switch is admin-only and audited; the owner quote
// is only for switched-on landlords and computed on the server.
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    user: { findFirst: fn() },
    longStayLandlordGrant: { findUnique: fn(), upsert: fn(), delete: fn(), update: fn() },
    property: { findMany: fn(), findFirst: fn(), findUnique: fn() },
    systemSetting: { findUnique: fn() },
    salesPartnerProfile: { findFirst: fn(), findUnique: fn() },
    salesLead: { findFirst: fn(), findMany: fn() },
    userWorkspaceAccess: { findUnique: fn() },
    propertySalesAttribution: { findFirst: fn() },
    longStayInspection: { findUnique: fn(), findFirst: fn(), findMany: fn(), create: fn(), updateMany: fn(), count: fn() },
    longStayEnquiry: { findMany: fn(), count: fn() },
    notification: { create: fn(), findMany: fn(), count: fn() },
    $transaction: vi.fn(async (operation: (tx: any) => unknown) => operation(db)),
  };
  return { db, session: { user: { id: 1, role: "ADMIN" } as any } };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("../lib/salesVisitPhotos.js", () => ({
  uploadVisitPhoto: vi.fn(async (buffer: Buffer) => `sales-visits/7/${buffer.toString()}`),
  deleteVisitPhoto: vi.fn(async () => undefined),
  signedVisitPhotoUrl: vi.fn(),
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = h.session.user; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => (req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" })),
  blockImpersonated: (req: any, res: any, next: any) => (req.user?.imp ? res.status(403).json({ error: "Not during a support session" }) : next()),
}));

import adminRouter from "../routes/admin.longStay.js";
import ownerRouter from "../routes/owner.longStay.js";
import salesInspectionsRouter from "../routes/sales.longStay.js";
import salesLeadsRouter from "../routes/sales.leads.js";
import salesWorkspaceRouter from "../routes/sales.workspace.js";
import { audit } from "../lib/audit.js";
import { CHECKLIST } from "../lib/longStay/inspection.js";
import { leadRef } from "../lib/salesReference.js";

const app = express();
app.use(express.json());
app.use("/api/admin/long-stay", adminRouter);
app.use("/api/owner/long-stay", ownerRouter);
app.use("/api", salesWorkspaceRouter);
app.use("/api/sales", salesLeadsRouter);
app.use("/api/sales", salesInspectionsRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

beforeEach(() => {
  vi.clearAllMocks();
  h.session.user = { id: 1, role: "ADMIN" };
  h.db.user.findFirst.mockResolvedValue({ id: 3, suspendedAt: null, deletedAt: null });
  h.db.longStayLandlordGrant.findUnique.mockResolvedValue(null);
  h.db.property.findMany.mockResolvedValue([]);
  h.db.systemSetting.findUnique.mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("admin long-stay enquiry queue", () => {
  it("paginates by status with a stable order and clamps a page after the queue shrinks", async () => {
    h.db.longStayEnquiry.count.mockImplementation(async ({ where }: { where: { status: string } }) => where.status === "OPEN" ? 8 : 51);
    h.db.longStayEnquiry.findMany.mockResolvedValue([]);
    const response = await request(app).get("/api/admin/long-stay/enquiries").query({ view: "answered", page: 9 }).expect(200);
    expect(response.body).toEqual({ openCount: 8, items: [], pagination: { page: 3, pageSize: 25, total: 51 } });
    expect(h.db.longStayEnquiry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "ANSWERED" }, skip: 50, take: 25, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
  });

  it("rejects invalid views and pages and leaves the original unpaged response available", async () => {
    h.db.longStayEnquiry.count.mockResolvedValue(4);
    h.db.longStayEnquiry.findMany.mockResolvedValue([]);
    await request(app).get("/api/admin/long-stay/enquiries").query({ view: "constructor" }).expect(400);
    await request(app).get("/api/admin/long-stay/enquiries").query({ page: 0 }).expect(400);
    const response = await request(app).get("/api/admin/long-stay/enquiries").expect(200);
    expect(response.body).toEqual({ openCount: 4, items: [] });
    expect(h.db.longStayEnquiry.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ take: 100 }));
  });
});

describe("admin landlord switch", () => {
  it("is refused to anyone but an admin", async () => {
    h.session.user = { id: 3, role: "OWNER" };
    const res = await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "ENABLE" });
    expect(res.status).toBe(403);
    expect(h.db.longStayLandlordGrant.upsert).not.toHaveBeenCalled();
  });

  it("switches an owner on, recording the admin, and audits it", async () => {
    const res = await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "ENABLE" });
    expect(res.status).toBe(200);
    expect(h.db.longStayLandlordGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 3 }, create: expect.objectContaining({ userId: 3, enabledById: 1 }) }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), "LONG_STAY_LANDLORD_SWITCH", "USER", expect.anything(), expect.objectContaining({ action: "ENABLE" }), 3);
  });

  it("never switches on a suspended account or a non-owner", async () => {
    h.db.user.findFirst.mockResolvedValueOnce({ id: 3, suspendedAt: new Date(), deletedAt: null });
    expect((await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "ENABLE" })).status).toBe(409);
    h.db.user.findFirst.mockResolvedValueOnce(null);
    expect((await request(app).post("/api/admin/long-stay/landlords/4").send({ action: "ENABLE" })).status).toBe(404);
    expect(h.db.longStayLandlordGrant.upsert).not.toHaveBeenCalled();
  });

  it("needs a reason to pause or switch off, and rejects unknown actions", async () => {
    h.db.longStayLandlordGrant.findUnique.mockResolvedValue({ userId: 3, pausedAt: null });
    expect((await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "PAUSE" })).status).toBe(400);
    expect((await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "DISABLE", reason: "no" })).status).toBe(400);
    expect((await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "GRANT_ALL" })).status).toBe(400);
    const paused = await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "PAUSE", reason: "Complaint under review" });
    expect(paused.status).toBe(200);
    expect(h.db.longStayLandlordGrant.update).toHaveBeenCalledWith({ where: { userId: 3 }, data: expect.objectContaining({ pauseReason: "Complaint under review" }) });
  });
});

describe("owner quote", () => {
  beforeEach(() => { h.session.user = { id: 3, role: "OWNER" }; });

  it("is closed until NoLSAF switches the landlord on", async () => {
    const res = await request(app).post("/api/owner/long-stay/quote").send({ monthlyRent: 4500, termMonths: 6, upfrontMonths: 6, currency: "USD" });
    expect(res.status).toBe(403);
  });

  it("returns the server's amounts for a switched-on landlord", async () => {
    h.db.longStayLandlordGrant.findUnique.mockResolvedValue({ enabledAt: new Date(), pausedAt: null, pauseReason: null });
    const res = await request(app).post("/api/owner/long-stay/quote").send({ monthlyRent: 4500, termMonths: 6, upfrontMonths: 6, currency: "USD" });
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ bookingAmount: 5580, balanceDue: 22500, landlordPayout: 3150 });
  });

  it("tells an owner whether they are switched on", async () => {
    const res = await request(app).get("/api/owner/long-stay/eligibility");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ granted: false, bookingsOpen: false, termMonths: [3, 6, 12] });
    expect(res.body.propertyTypes).not.toContain("HOTEL");
  });
});

describe("home inspection invitations", () => {
  const ref = "li_abcdefghijklmnopqrstuv";
  const path = `/sales/inspections?inspection=${ref}`;

  beforeEach(() => {
    h.db.salesPartnerProfile.findFirst.mockResolvedValue({ id: 7, userId: 50, agentCode: "NSA-DAR-0042" });
    h.db.salesPartnerProfile.findUnique.mockResolvedValue({
      id: 7, status: "ACTIVE",
      contracts: [{ id: 4, status: "ACTIVE", startsAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() + 86_400_000) }],
    });
    h.db.userWorkspaceAccess.findUnique.mockResolvedValue({ status: "ACTIVE", expiresAt: null });
    h.db.property.findUnique.mockResolvedValue({ ownerId: 3, title: "Sea View Flats" });
    h.db.propertySalesAttribution.findFirst.mockResolvedValue(null);
    h.db.longStayInspection.findUnique.mockResolvedValue({ id: 1, propertyId: 9, publicRef: ref, status: "REQUESTED", updatedAt: new Date() });
    h.db.longStayInspection.updateMany.mockResolvedValue({ count: 1 });
    h.db.notification.create.mockImplementation(async ({ data }: any) => ({ id: 1, createdAt: new Date(), ...data }));
  });

  it("shows the approval policy to admins and allows a visit request in either mode", async () => {
    vi.stubEnv("LONG_STAY_REQUIRE_INSPECTION", undefined);
    h.db.longStayInspection.findMany.mockResolvedValue([]);
    h.db.longStayInspection.count.mockResolvedValue(0);
    expect((await request(app).get("/api/admin/long-stay/inspections")).body.inspectionRequiredForApproval).toBe(false);

    h.db.property.findFirst.mockResolvedValueOnce({ id: 9 });
    h.db.longStayInspection.findFirst.mockResolvedValue(null);
    h.db.longStayInspection.create.mockImplementation(async ({ data }: any) => data);
    const opened = await request(app).post("/api/admin/long-stay/properties/9/inspection");
    expect(opened.body).toMatchObject({ ok: true, created: true, ref: expect.stringMatching(/^li_/) });

    vi.stubEnv("LONG_STAY_REQUIRE_INSPECTION", "1");
    expect((await request(app).get("/api/admin/long-stay/inspections")).body.inspectionRequiredForApproval).toBe(true);
  });

  it("pages a compact inspection queue and loads evidence only when an admin opens the details", async () => {
    const submittedAt = new Date();
    const record = {
      publicRef: ref, status: "SUBMITTED", reason: "FIRST_LISTING", createdAt: submittedAt, submittedAt,
      property: { title: "Sea View Flats", district: "Kinondoni", latitude: "-6.80", longitude: "39.23", owner: { name: "Landlord", phone: "+255700000009" } },
      latitude: "-6.81", longitude: "39.24",
      salesPartner: { agentCode: "NSA-DAR-0042", user: { name: "Partner" } },
      checklist: { ACCESS: "FAIL", findings: { ACCESS: { note: "Road is washed out", photoIndex: 2 } } },
      photos: [{}, {}, {}], recommendation: "PASS",
    };
    h.db.longStayInspection.count.mockResolvedValue(57);
    h.db.longStayInspection.findMany.mockResolvedValue([record]);
    h.db.longStayInspection.findUnique.mockResolvedValue(record);

    const queue = await request(app).get("/api/admin/long-stay/inspections").query({ view: "review", page: 2 }).expect(200);
    expect(queue.body.pagination).toEqual({ page: 2, pageSize: 25, total: 57 });
    expect(queue.body.items[0]).toMatchObject({ ref, status: "SUBMITTED", home: { title: "Sea View Flats" }, landlord: { name: "Landlord" } });
    expect(queue.body.items[0]).not.toHaveProperty("report");
    expect(queue.body.items[0]).not.toHaveProperty("pin");
    expect(queue.body.items[0].landlord).not.toHaveProperty("phone");
    expect(h.db.longStayInspection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "SUBMITTED" }, skip: 25, take: 25 }));
    expect(h.db.longStayInspection.findMany.mock.calls[0][0].select).not.toHaveProperty("photos");

    const detailUrl = `/api/admin/long-stay/inspections/${ref}`;
    const detail = await request(app).get(detailUrl).expect(200);
    expect(detail.body).toMatchObject({
      checklist: CHECKLIST,
      item: {
        ref, pin: { latitude: -6.8, longitude: 39.23 }, landlord: { phone: "+255700000009" },
        report: { position: { latitude: -6.81, longitude: 39.24 }, photoCount: 3, findings: record.checklist.findings },
      },
    });
    h.session.user = { id: 50, role: "CUSTOMER" };
    await request(app).get(detailUrl).expect(403);
  });

  it("assigns the home and puts a direct link in the selected partner’s Sales inbox", async () => {
    const assigned = await request(app).post(`/api/admin/long-stay/inspections/${ref}/assign`).send({ partnerCode: "NSA-DAR-0042" });
    expect(assigned.status).toBe(200);
    expect(h.db.$transaction).toHaveBeenCalledOnce();
    expect(h.db.longStayInspection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ASSIGNED", salesPartnerId: 7, dueBy: expect.any(Date) }),
    }));
    const invitation = await h.db.notification.create.mock.results[0].value;
    expect(invitation).toMatchObject({ userId: 50, type: "sales", unread: true, meta: { actionPath: path } });
    h.db.notification.findMany.mockResolvedValue([invitation]);
    h.db.notification.count.mockResolvedValue(1);
    h.session.user = { id: 50, role: "CUSTOMER" };
    const inbox = await request(app).get("/api/sales/notifications");
    expect(h.db.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 50, type: { in: ["sales"] }, unread: true },
    }));
    expect(inbox.body.items[0]).toMatchObject({ title: "Home inspection invitation", meta: { actionPath: path } });
  });

  it("sorts inspections before taking a page and uses the date shown in each tab", async () => {
    h.db.longStayInspection.count.mockResolvedValue(57);
    h.db.longStayInspection.findMany.mockResolvedValue([]);
    const list = "/api/admin/long-stay/inspections";
    await request(app).get(list).query({ view: "todo", page: 2, sort: "property", direction: "desc" }).expect(200);
    expect(h.db.longStayInspection.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: [{ property: { title: "desc" } }, { id: "desc" }], skip: 25, take: 25,
    }));
    await request(app).get(list).query({ view: "review", page: 1, sort: "date" }).expect(200);
    expect(h.db.longStayInspection.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    }));
    await request(app).get(list).query({ view: "todo", page: 1, sort: "status", direction: "asc" }).expect(200);
    expect(h.db.longStayInspection.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: [{ status: "asc" }, { dueBy: "asc" }, { id: "asc" }],
    }));
    await request(app).get(list).query({ page: 1, sort: "photos" }).expect(400);
    await request(app).get(list).query({ page: 1, direction: "invalid" }).expect(400);
  });

  it("scopes both the lead queue and deep-linked inspection to the signed-in partner", async () => {
    h.session.user = { id: 50, role: "CUSTOMER" };
    h.db.longStayInspection.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    h.db.longStayInspection.findMany.mockResolvedValueOnce([{ publicRef: ref, property: { title: "Sea View Flats", district: "Kinondoni" } }]).mockResolvedValueOnce([]);
    h.db.longStayInspection.findFirst.mockResolvedValue(null);

    const queue = await request(app).get("/api/sales/long-stay/inspections/queue");
    expect(queue.body).toMatchObject({ toVisit: 1, inReview: 0, upcoming: [{ ref, title: "Sea View Flats", area: "Kinondoni" }] });
    expect(h.db.longStayInspection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salesPartnerId: 7, status: "ASSIGNED" } }));
    const inspection = await request(app).get("/api/sales/long-stay/inspections").query({ inspection: ref });
    expect(inspection.body.items).toEqual([]);
    expect(h.db.longStayInspection.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ salesPartnerId: 7, publicRef: ref }),
    }));
  });

  it("submits an on-site report and links a request for a return visit to the same inspection", async () => {
    const assigned = { id: 1, propertyId: 9, publicRef: ref, status: "ASSIGNED", salesPartnerId: 7, updatedAt: new Date() };
    h.session.user = { id: 50, role: "CUSTOMER" };
    h.db.longStayInspection.findFirst.mockResolvedValue(assigned);
    h.db.longStayInspection.findMany.mockResolvedValue([]);
    const findings = { ACCESS: { note: "Road is washed out near the gate.", photoIndex: 2 } };
    function sendReport(photoCount: number, reportFindings: typeof findings | Record<string, never> = findings) {
      const report = request(app).post(`/api/sales/long-stay/inspections/${ref}/report`)
        .field("latitude", "-6.7924")
        .field("longitude", "39.2083")
        .field("accuracyMeters", "12")
        .field("capturedAt", new Date().toISOString())
        .field("checklist", JSON.stringify(Object.fromEntries(CHECKLIST.map(({ key }) => [key, key === "ACCESS" ? "FAIL" : "PASS"]))))
        .field("findings", JSON.stringify(reportFindings))
        .field("recommendation", "PASS")
        .field("note", "Rooms and utilities were inspected on site.");
      for (let i = 1; i <= photoCount; i++) report.attach("photos", Buffer.from(`photo-${i}`), `photo-${i}.jpg`);
      return report;
    }
    expect((await sendReport(2)).body.error).toMatch(/exactly 3 photos/);
    expect((await sendReport(4)).body.error).toMatch(/exactly 3 photos/);
    expect((await sendReport(3, {})).body.error).toMatch(/finding for every item answered No/);
    const sent = await sendReport(3);
    expect(sent.status).toBe(201);
    expect(h.db.longStayInspection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ salesPartnerId: 7, status: "ASSIGNED" }),
      data: expect.objectContaining({
        status: "SUBMITTED", submittedAt: expect.any(Date),
        checklist: expect.objectContaining({ ACCESS: "FAIL", findings }),
        photos: [1, 2, 3].map((slot) => expect.objectContaining({ publicId: `sales-visits/7/photo-${slot}` })),
      }),
    }));

    h.session.user = { id: 1, role: "ADMIN" };
    h.db.longStayInspection.findUnique.mockResolvedValue({ ...assigned, status: "SUBMITTED" });
    h.db.salesPartnerProfile.findUnique.mockResolvedValueOnce({ userId: 50 });
    const reviewed = await request(app).post(`/api/admin/long-stay/inspections/${ref}/review`).send({ decision: "REDO", note: "Please retake the kitchen photo." });
    expect(reviewed.body).toMatchObject({ ok: true, status: "ASSIGNED" });
    expect(h.db.notification.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 50, type: "sales", meta: expect.objectContaining({ actionPath: path, notificationKind: "long_stay_inspection_redo" }) }),
    }));
  });

  it("shows the status of an assisted home on its own lead without sharing the inspector’s report", async () => {
    h.session.user = { id: 50, role: "CUSTOMER" };
    h.db.salesLead.findMany.mockResolvedValue([{ id: 21 }]);
    h.db.salesLead.findFirst.mockResolvedValue({ id: 21, convertedPropertyId: null, assistedListing: { propertyId: 9 } });
    h.db.longStayInspection.findFirst.mockResolvedValue({ status: "SUBMITTED", submittedAt: new Date(), validUntil: null });
    const lead = await request(app).get(`/api/sales/leads/${leadRef(21)}`);
    expect(lead.status).toBe(200);
    expect(lead.body.lead.homeInspection).toMatchObject({ status: "SUBMITTED", current: false });
    expect(h.db.longStayInspection.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ propertyId: 9 }),
      select: { status: true, dueBy: true, submittedAt: true, reviewedAt: true, validUntil: true },
    }));
  });
});
