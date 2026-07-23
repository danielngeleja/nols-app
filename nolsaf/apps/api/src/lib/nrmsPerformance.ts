// Outlet performance analytics: sales totals, a bucketed sales series for the
// trend chart, and serving-time ratios derived from the order lifecycle
// timestamps (placedAt -> confirmedAt -> servingAt -> servedAt).
//
// The heavy lifting is one grouped SQL query per view; everything here is pure
// so the windowing, gap-filling and shaping are unit-testable without a database.

export type PerformancePeriod = "day" | "week" | "month" | "year";

/** Orders whose revenue is recognised. Both statuses have passed through SERVING. */
export const REVENUE_STATUSES = ["SETTLED", "POSTED_TO_FOLIO"] as const;

/** An order is "on time" when served within this many minutes of being placed. */
export const ON_TIME_MINUTES = 15;

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC key matching the MySQL DATE_FORMAT output used in the bucket query. */
function bucketKey(date: Date, period: PerformancePeriod): string {
  const y = date.getUTCFullYear(), m = pad(date.getUTCMonth() + 1), d = pad(date.getUTCDate());
  if (period === "day") return `${y}-${m}-${d} ${pad(date.getUTCHours())}`;
  if (period === "year") return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function bucketLabel(date: Date, period: PerformancePeriod): string {
  if (period === "day") return pad(date.getUTCHours());
  if (period === "week") return WEEKDAYS[date.getUTCDay()];
  if (period === "month") return String(date.getUTCDate());
  return MONTHS[date.getUTCMonth()];
}

/**
 * Window start, the MySQL DATE_FORMAT the bucket query groups by, and the full
 * ordered list of expected buckets so the chart has continuous bars even where
 * an hour or day had no sales.
 */
export function performanceWindow(period: PerformancePeriod, now: Date): { start: Date; end: Date; format: string; buckets: Array<{ key: string; label: string }> } {
  const buckets: Array<{ key: string; label: string }> = [];
  let start: Date;
  let end: Date;
  let format: string;

  if (period === "day") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    end = new Date(start.getTime() + (now.getUTCHours() + 1) * 3_600_000);
    format = "%Y-%m-%d %H";
    for (let h = 0; h <= now.getUTCHours(); h += 1) {
      const at = new Date(start.getTime() + h * 3_600_000);
      buckets.push({ key: bucketKey(at, period), label: bucketLabel(at, period) });
    }
  } else if (period === "week") {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start = new Date(base.getTime() - 6 * 86_400_000);
    end = new Date(base.getTime() + 86_400_000);
    format = "%Y-%m-%d";
    for (let i = 0; i < 7; i += 1) {
      const at = new Date(start.getTime() + i * 86_400_000);
      buckets.push({ key: bucketKey(at, period), label: bucketLabel(at, period) });
    }
  } else if (period === "month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000);
    format = "%Y-%m-%d";
    for (let day = new Date(start); day <= now; day = new Date(day.getTime() + 86_400_000)) {
      buckets.push({ key: bucketKey(day, period), label: bucketLabel(day, period) });
    }
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    format = "%Y-%m";
    for (let mo = 0; mo <= now.getUTCMonth(); mo += 1) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), mo, 1));
      buckets.push({ key: bucketKey(at, period), label: bucketLabel(at, period) });
    }
  }
  return { start, end, format, buckets };
}

/**
 * Window for an operator-chosen date range (from/to inclusive, YYYY-MM-DD).
 * Bucket granularity adapts to the span so the chart stays legible: a single day
 * is shown hour by hour, up to a quarter is shown day by day, and anything wider
 * is shown month by month.
 */
export function customPerformanceWindow(fromKey: string, toKey: string): { start: Date; end: Date; format: string; buckets: Array<{ key: string; label: string }>; granularity: "hour" | "day" | "month" } {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const start = new Date(Date.UTC(fy, fm - 1, fd, 0, 0, 0));
  const end = new Date(Date.UTC(ty, tm - 1, td) + 86_400_000); // exclusive: midnight after `to`
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const buckets: Array<{ key: string; label: string }> = [];
  let format: string;
  let granularity: "hour" | "day" | "month";

  if (spanDays <= 1) {
    granularity = "hour";
    format = "%Y-%m-%d %H";
    for (let h = 0; h < 24; h += 1) {
      const at = new Date(start.getTime() + h * 3_600_000);
      buckets.push({ key: bucketKey(at, "day"), label: bucketLabel(at, "day") });
    }
  } else if (spanDays <= 92) {
    granularity = "day";
    format = "%Y-%m-%d";
    for (let at = new Date(start); at < end; at = new Date(at.getTime() + 86_400_000)) {
      buckets.push({ key: bucketKey(at, "month"), label: bucketLabel(at, "month") });
    }
  } else {
    granularity = "month";
    format = "%Y-%m";
    for (let at = new Date(Date.UTC(fy, fm - 1, 1)); at < end; at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))) {
      buckets.push({ key: bucketKey(at, "year"), label: bucketLabel(at, "year") });
    }
  }
  return { start, end, format, buckets, granularity };
}

/** Join the grouped DB rows onto the expected buckets, zero-filling the gaps. */
export function fillSeries(rows: Array<{ bucket: string; sales: number | string | null }>, buckets: Array<{ key: string; label: string }>): Array<{ label: string; value: number }> {
  const byKey = new Map(rows.map((row) => [String(row.bucket), Number(row.sales) || 0]));
  return buckets.map((bucket) => ({ label: bucket.label, value: byKey.get(bucket.key) ?? 0 }));
}

const seconds = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toMinutes = (value: unknown): number | null => {
  const s = seconds(value);
  return s == null ? null : Math.round((s / 60) * 10) / 10;
};

/** Shape one summary SQL row into the KPI + serving-time payload. */
export function shapePerformanceSummary(row: any) {
  const orders = Number(row?.orders) || 0;
  const sales = Number(row?.sales) || 0;
  const served = Number(row?.served) || 0;
  const onTime = Number(row?.onTime) || 0;
  return {
    orders,
    sales,
    avgTicket: orders > 0 ? Math.round(sales / orders) : 0,
    serving: {
      accept: toMinutes(row?.acceptSec),
      prepare: toMinutes(row?.prepSec),
      serve: toMinutes(row?.serveSec),
      total: toMinutes(row?.totalSec),
      onTimeRate: served > 0 ? Math.round((onTime / served) * 100) : null,
      servedCount: served,
    },
  };
}
