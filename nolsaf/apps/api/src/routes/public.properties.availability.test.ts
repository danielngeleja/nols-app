import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { calculateAvailabilityMock } = vi.hoisted(() => ({
  calculateAvailabilityMock: vi.fn(),
}));

vi.mock("../lib/availabilityCalculator.js", () => ({
  calculateAvailability: calculateAvailabilityMock,
}));

import publicPropertiesRouter from "./public.properties.js";

describe("public property availability room identity", () => {
  beforeEach(() => {
    calculateAvailabilityMock.mockReset();
    calculateAvailabilityMock.mockResolvedValue({
      restrictions: [],
      summary: {
        totalSellableRooms: 2,
        totalRooms: 2,
        totalAvailableRooms: 2,
      },
    });
  });

  it("passes the HTTP roomCode query to the calculator's exact-code argument", async () => {
    const app = express();
    app.use("/api/public/properties", publicPropertiesRouter);

    const response = await request(app).get(
      "/api/public/properties/availability?ids=7&checkIn=2026-09-10&checkOut=2026-09-17&roomCode=Double%201%20Full",
    );

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ id: 7, roomsAvailable: 2 });
    expect(calculateAvailabilityMock).toHaveBeenCalledWith(
      7,
      expect.any(Date),
      expect.any(Date),
      "Double 1 Full",
      undefined,
    );
  });
});
