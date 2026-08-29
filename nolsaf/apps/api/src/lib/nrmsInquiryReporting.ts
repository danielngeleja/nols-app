type DirectMetric = { kind: string; count: number };
type ReportInquiry = {
  source: string;
  createdAt: Date;
  firstResponseAt: Date | null;
  reservationId: number | null;
  reservation: { status: string } | null;
};

export type InquiryConversionReport = {
  periodDays: number;
  funnel: { visits: number; inquiries: number; responded: number; holds: number; confirmed: number };
  rates: { visitToInquiryPct: number | null; inquiryToHoldPct: number | null; holdToConfirmedPct: number | null };
  averageFirstResponseMinutes: number | null;
  sources: Array<{ source: string; visits: number; inquiries: number; responded: number; holds: number; confirmed: number }>;
};

const confirmedStatuses = new Set(["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]);
const pct = (value: number, denominator: number) => denominator > 0 ? Math.round(value * 10_000 / denominator) / 100 : null;

export function buildInquiryConversionReport(metrics: DirectMetric[], inquiries: ReportInquiry[], periodDays = 30): InquiryConversionReport {
  const sourceMap = new Map<string, { source: string; visits: number; inquiries: number; responded: number; holds: number; confirmed: number }>();
  const row = (sourceValue: string) => {
    const source = String(sourceValue || "DIRECT").trim().toUpperCase() || "DIRECT";
    let current = sourceMap.get(source);
    if (!current) { current = { source, visits: 0, inquiries: 0, responded: 0, holds: 0, confirmed: 0 }; sourceMap.set(source, current); }
    return current;
  };

  let visits = 0;
  for (const metric of metrics) {
    const [namespace, event, source] = metric.kind.split(":");
    if (namespace !== "DIRECT" || event !== "PAGE_OPEN" || !source) continue;
    const count = Math.max(0, Number(metric.count) || 0);
    row(source).visits += count;
    visits += count;
  }

  let responded = 0; let holds = 0; let confirmed = 0; let responseMinutes = 0;
  for (const inquiry of inquiries) {
    const source = row(inquiry.source);
    source.inquiries += 1;
    if (inquiry.firstResponseAt) {
      source.responded += 1; responded += 1;
      responseMinutes += Math.max(0, inquiry.firstResponseAt.getTime() - inquiry.createdAt.getTime()) / 60_000;
    }
    if (inquiry.reservationId) { source.holds += 1; holds += 1; }
    if (inquiry.reservation && confirmedStatuses.has(inquiry.reservation.status)) { source.confirmed += 1; confirmed += 1; }
  }

  return {
    periodDays,
    funnel: { visits, inquiries: inquiries.length, responded, holds, confirmed },
    rates: {
      visitToInquiryPct: pct(inquiries.length, visits),
      inquiryToHoldPct: pct(holds, inquiries.length),
      holdToConfirmedPct: pct(confirmed, holds),
    },
    averageFirstResponseMinutes: responded ? Math.round(responseMinutes / responded * 10) / 10 : null,
    sources: [...sourceMap.values()].sort((a, b) => b.inquiries - a.inquiries || b.visits - a.visits || a.source.localeCompare(b.source)),
  };
}
