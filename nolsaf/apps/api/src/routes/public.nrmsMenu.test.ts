import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  systemSettingFindUnique: vi.fn(),
  reservationFindFirst: vi.fn(),
  allocationFindFirst: vi.fn(),
  pointFindFirst: vi.fn(),
  pointFindUnique: vi.fn(),
  outletFindMany: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: mocks.systemSettingFindUnique },
    reservation: { findFirst: mocks.reservationFindFirst },
    reservationRoomAllocation: { findFirst: mocks.allocationFindFirst },
    nrmsOrderPoint: {
      findFirst: mocks.pointFindFirst,
      findUnique: mocks.pointFindUnique,
    },
    nrmsOutlet: { findMany: mocks.outletFindMany },
  },
}));

vi.mock("../middleware/rateLimit.js", () => ({
  limitPublicQrMenu: (_req: unknown, _res: unknown, next: () => void) => next(),
  limitPublicQrOrderCreate: (_req: unknown, _res: unknown, next: () => void) => next(),
  limitPublicQrOrderFeedback: (_req: unknown, _res: unknown, next: () => void) => next(),
  limitPublicQrOrderStatus: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { buildStayOrderingToken } from "../lib/nrmsStayToken.js";
import nrmsMenuRouter from "./public.nrmsMenu.js";

const app = express();
app.use(express.json());
app.use("/api/public/nrms", nrmsMenuRouter);

function roomPoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    propertyId: 7,
    type: "ROOM",
    roomUnitId: 204,
    label: "204",
    active: true,
    orderingEnabled: true,
    property: {
      id: 7,
      title: "NoLSAF Hotel",
      nrmsActivatedAt: new Date("2026-01-01T00:00:00.000Z"),
      nrmsQrOrderingFrozenAt: null,
    },
    ...overrides,
  };
}

describe("NRMS public menu stay-token resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "test_stay_token_secret");
    mocks.systemSettingFindUnique.mockResolvedValue({ nrmsQrOrderingEnabled: true });
    mocks.outletFindMany.mockResolvedValue([]);
    mocks.allocationFindFirst.mockResolvedValue(null);
  });

  it("does not let a stay-shaped value shadow a permanent printed token", async () => {
    const token = "s41_not_a_real_signature";
    mocks.pointFindUnique.mockResolvedValue(roomPoint({ token }));

    const response = await request(app).get(`/api/public/nrms/menu/${token}`);

    expect(response.status).toBe(200);
    expect(response.body.point).toEqual({ type: "ROOM", label: "204" });
    expect(mocks.reservationFindFirst).not.toHaveBeenCalled();
    expect(mocks.pointFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { token } }));
  });

  it("closes a genuine stay token after checkout without falling through to a room point", async () => {
    const token = buildStayOrderingToken(41);
    mocks.reservationFindFirst.mockResolvedValue(null);

    const response = await request(app).get(`/api/public/nrms/menu/${token}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("STAY_LINK_CLOSED");
    expect(mocks.reservationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 41, status: "CHECKED_IN" },
    }));
    expect(mocks.pointFindUnique).not.toHaveBeenCalled();
    expect(mocks.allocationFindFirst).not.toHaveBeenCalled();
  });

  it("closes a stay token when the reservation has no active room allocation", async () => {
    const token = buildStayOrderingToken(41);
    mocks.reservationFindFirst.mockResolvedValue({ id: 41, propertyId: 7, allocations: [] });

    const response = await request(app).get(`/api/public/nrms/menu/${token}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("STAY_LINK_CLOSED");
    expect(mocks.pointFindFirst).not.toHaveBeenCalled();
  });

  it("closes a stay token when its room has no enabled active ordering point", async () => {
    const token = buildStayOrderingToken(41);
    mocks.reservationFindFirst.mockResolvedValue({
      id: 41,
      propertyId: 7,
      allocations: [{ roomUnitId: 204 }],
    });
    mocks.pointFindFirst.mockResolvedValue(null);

    const response = await request(app).get(`/api/public/nrms/menu/${token}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("STAY_LINK_CLOSED");
    expect(mocks.pointFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        propertyId: 7,
        type: "ROOM",
        roomUnitId: { in: [204] },
        active: true,
        orderingEnabled: true,
      }),
    }));
  });

  it("binds room charging to the reservation named by the stay token", async () => {
    const token = buildStayOrderingToken(41);
    mocks.reservationFindFirst.mockResolvedValue({
      id: 41,
      propertyId: 7,
      allocations: [{ roomUnitId: 204 }],
    });
    mocks.pointFindFirst.mockResolvedValue(roomPoint());
    mocks.allocationFindFirst.mockResolvedValue({
      reservation: { id: 41, currency: "TZS", guestProfile: { fullName: "Guest" } },
    });

    const response = await request(app).get(`/api/public/nrms/menu/${token}`);

    expect(response.status).toBe(200);
    expect(response.body.roomChargeAvailable).toBe(true);
    expect(mocks.allocationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        roomUnitId: 204,
        status: "ACTIVE",
        reservation: { propertyId: 7, status: "CHECKED_IN", id: 41 },
      }),
    }));
  });
});
