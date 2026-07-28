import { describe, expect, it } from "vitest";
import { customPerformanceWindow, fillSeries, performanceWindow, shapePerformanceSummary } from "./nrmsPerformance.js";

const NOW = new Date("2026-07-24T14:30:00Z");

describe("performanceWindow", () => {
  it("day buckets one per hour from midnight through the current hour", () => {
    const { start, end, format, buckets } = performanceWindow("day", NOW);
    expect(start.toISOString()).toBe("2026-07-24T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-24T15:00:00.000Z");
    expect(format).toBe("%Y-%m-%d %H");
    expect(buckets).toHaveLength(15);
    expect(buckets[0]).toEqual({ key: "2026-07-24 00", label: "00" });
    expect(buckets[14]).toEqual({ key: "2026-07-24 14", label: "14" });
  });

  it("week is seven daily buckets ending today, labelled by weekday", () => {
    const { buckets } = performanceWindow("week", NOW);
    expect(buckets).toHaveLength(7);
    expect(buckets[6]).toEqual({ key: "2026-07-24", label: "Fri" });
    expect(buckets[0].key).toBe("2026-07-18");
  });

  it("month is one bucket per day from the 1st through today", () => {
    const { start, buckets } = performanceWindow("month", NOW);
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(buckets).toHaveLength(24);
    expect(buckets[0]).toEqual({ key: "2026-07-01", label: "1" });
    expect(buckets[23]).toEqual({ key: "2026-07-24", label: "24" });
  });

  it("year is one bucket per month from January through the current month", () => {
    const { start, format, buckets } = performanceWindow("year", NOW);
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(format).toBe("%Y-%m");
    expect(buckets).toHaveLength(7);
    expect(buckets[0]).toEqual({ key: "2026-01", label: "J" });
    expect(buckets[6]).toEqual({ key: "2026-07", label: "J" });
  });
});

describe("customPerformanceWindow", () => {
  it("a single day is bucketed hour by hour with an exclusive next-midnight end", () => {
    const { start, end, format, buckets, granularity } = customPerformanceWindow("2026-07-20", "2026-07-20");
    expect(start.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-21T00:00:00.000Z");
    expect(format).toBe("%Y-%m-%d %H");
    expect(granularity).toBe("hour");
    expect(buckets).toHaveLength(24);
    expect(buckets[0]).toEqual({ key: "2026-07-20 00", label: "00" });
  });

  it("a multi-day span within a quarter is bucketed day by day", () => {
    const { format, buckets, granularity } = customPerformanceWindow("2026-07-01", "2026-07-10");
    expect(granularity).toBe("day");
    expect(format).toBe("%Y-%m-%d");
    expect(buckets).toHaveLength(10);
    expect(buckets[0]).toEqual({ key: "2026-07-01", label: "1" });
    expect(buckets[9]).toEqual({ key: "2026-07-10", label: "10" });
  });

  it("a span wider than a quarter is bucketed month by month", () => {
    const { format, buckets, granularity } = customPerformanceWindow("2026-01-15", "2026-07-20");
    expect(granularity).toBe("month");
    expect(format).toBe("%Y-%m");
    expect(buckets).toHaveLength(7);
    expect(buckets[0]).toEqual({ key: "2026-01", label: "J" });
    expect(buckets[6]).toEqual({ key: "2026-07", label: "J" });
  });
});

describe("fillSeries", () => {
  it("maps db rows onto the buckets and zero-fills the gaps", () => {
    const buckets = [
      { key: "2026-07-24 12", label: "12" },
      { key: "2026-07-24 13", label: "13" },
      { key: "2026-07-24 14", label: "14" },
    ];
    const rows = [{ bucket: "2026-07-24 12", sales: "40000" }, { bucket: "2026-07-24 14", sales: 90000 }];
    expect(fillSeries(rows, buckets)).toEqual([
      { label: "12", value: 40000 },
      { label: "13", value: 0 },
      { label: "14", value: 90000 },
    ]);
  });
});

describe("shapePerformanceSummary", () => {
  it("derives average ticket, converts serving seconds to minutes, and computes the on-time rate", () => {
    const shaped = shapePerformanceSummary({
      orders: 34, sales: "412000",
      acceptSec: 108, prepSec: 372, serveSec: 204, totalSec: 684,
      onTime: 30, served: 34,
    });
    expect(shaped.orders).toBe(34);
    expect(shaped.sales).toBe(412000);
    expect(shaped.avgTicket).toBe(12118);
    expect(shaped.serving.accept).toBe(1.8);
    expect(shaped.serving.prepare).toBe(6.2);
    expect(shaped.serving.serve).toBe(3.4);
    expect(shaped.serving.total).toBe(11.4);
    expect(shaped.serving.onTimeRate).toBe(88);
  });

  it("returns null serving metrics and a zero ticket when there are no completed orders", () => {
    const shaped = shapePerformanceSummary({ orders: 0, sales: 0, acceptSec: null, prepSec: null, serveSec: null, totalSec: null, onTime: 0, served: 0 });
    expect(shaped.avgTicket).toBe(0);
    expect(shaped.serving.total).toBeNull();
    expect(shaped.serving.onTimeRate).toBeNull();
  });
});
