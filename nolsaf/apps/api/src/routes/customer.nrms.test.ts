import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  systemSettingFindUnique: vi.fn(),
  reservationFindFirst: vi.fn(),
  pointFindFirst: vi.fn(),
  outletCount: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: mocks.systemSettingFindUnique },
    reservation: { findFirst: mocks.reservationFindFirst },
    nrmsOrderPoint: { findFirst: mocks.pointFindFirst },
    nrmsOutlet: { count: mocks.outletCount },
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: 23, role: "USER" };
    next();
  },
}));

import customerNrmsRouter from "./customer.nrms.js";

const app = express();
app.use("/api/customer/nrms", customerNrmsRouter);

describe("customer NRMS room-ordering entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "test_stay_token_secret");
    mocks.systemSettingFindUnique.mockResolvedValue({ nrmsQrOrderingEnabled: true });
  });

  it("scopes simultaneous checked-in stays to the requested property", async () => {
    mocks.reservationFindFirst.mockResolvedValue({
      id: 41,
      propertyId: 7,
      property: { title: "NoLSAF Hotel" },
      allocations: [{ roomUnitId: 204, roomUnit: { code: "204" } }],
    });
    mocks.pointFindFirst.mockResolvedValue({ id: 8, roomUnitId: 204 });
    mocks.outletCount.mockResolvedValue(1);

    const response = await request(app).get("/api/customer/nrms/room-ordering?propertyId=7");

    expect(response.status).toBe(200);
    expect(response.body.stay).toMatchObject({ propertyId: 7, propertyTitle: "NoLSAF Hotel", roomLabel: "Room 204" });
    expect(mocks.reservationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ propertyId: 7, booking: { userId: 23 } }),
    }));
  });

  it("rejects an invalid property scope", async () => {
    const response = await request(app).get("/api/customer/nrms/room-ordering?propertyId=not-a-property");

    expect(response.status).toBe(400);
    expect(mocks.reservationFindFirst).not.toHaveBeenCalled();
  });

  it("returns no stay when the requested property has no eligible reservation", async () => {
    mocks.reservationFindFirst.mockResolvedValue(null);

    const response = await request(app).get("/api/customer/nrms/room-ordering?propertyId=9");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stay: null });
  });
});
