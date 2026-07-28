import { describe, expect, it, vi } from "vitest";
import { bookingComFullAriWindows, queueBookingComStopSell } from "./bookingComDelivery.js";

describe("Booking.com full ARI windows", () => {
  it("starts on the requested day and covers the forward horizon without past dates", () => {
    const windows = bookingComFullAriWindows(new Date("2026-07-22T15:00:00.000Z"), 2);

    expect(windows.map((window) => [window.from.toISOString().slice(0, 10), window.to.toISOString().slice(0, 10)])).toEqual([
      ["2026-07-22", "2026-08-01"],
      ["2026-08-01", "2026-09-01"],
      ["2026-09-01", "2026-09-22"],
    ]);
  });

  it("queues a governed stop-sell with an inclusive admin end date", async () => {
    const upsert = vi.fn(async () => ({ id: 77 }));
    const result = await queueBookingComStopSell({ channelOutboundDelivery: { upsert } }, { requestId: 15, connectionId: 9, action: "APPLY", fromDate: new Date("2026-08-01T00:00:00.000Z"), toDate: new Date("2026-08-03T00:00:00.000Z") });

    expect(result).toEqual({ id: 77 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ eventType: "ARI_STOP_SELL", payload: { from: "2026-08-01", to: "2026-08-04", forceClosed: true, stopSellRequestId: 15 } }),
    }));
  });
});
