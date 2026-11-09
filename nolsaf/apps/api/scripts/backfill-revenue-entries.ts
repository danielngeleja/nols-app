// Backfills revenue_entry from the money NoLSAF has already collected, so the
// ledger starts complete before /admin/finance reads from it
// (docs/REVENUE_LEDGER.md, "Backfill").
//
// It replays every recognition and reversal point through the same functions
// the live settlement paths call (src/lib/revenueRecognition.ts), so a
// backfilled row and a live one can never disagree on amounts. Amounts are the
// ones stored on each source row when it was paid (commissionAmount, netPayable,
// ...), never recomputed from today's commission percent. Rows already in the
// ledger are left alone: every write is idempotent on sourceKey, so re-running
// is safe and only fills gaps.
//
// SAFE BY DEFAULT: a dry run reads the source tables and revenue_entry and
// prints what it would write. It writes nothing.
//   npx tsx scripts/backfill-revenue-entries.ts                      (dry run)
//   npx tsx scripts/backfill-revenue-entries.ts --apply --target=<db host>
// --target must equal the host in DATABASE_URL, so a write cannot land on a
// database you did not name. Optional: --stream=ACCOMMODATION (repeatable),
// --no-compare to skip the side-by-side with the finance overview.
//
// Never run --apply without Daniel's explicit approval for that database.

import dotenv from "dotenv";
import { prisma } from "@nolsaf/prisma";
import {
  recognizeGroupStayRevenue,
  recognizeInvoiceRevenue,
  recognizeNrmsPaymentRevenue,
  recognizeTourRevenue,
  recognizeTransportRevenue,
  reverseAccommodationChargeback,
  reverseAccommodationRefund,
  reverseTourRefund,
  REVENUE_TX_OPTIONS,
} from "../src/lib/revenueRecognition.js";
import { REVENUE_STREAMS, round2, type LedgerResult, type RevenueStream } from "../src/lib/revenueLedger.js";
import { moneyStageOf } from "../src/lib/invoiceMoneyStage.js";
import { GUEST_MONEY_IN, loadOwnerInvoiceDisbursements } from "../src/lib/invoiceMoneyStageIndex.js";

dotenv.config({ path: ".env" });

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const COMPARE = !args.includes("--no-compare");
const TARGET = args.find((a) => a.startsWith("--target="))?.split("=")[1] ?? null;
const ONLY = new Set(args.filter((a) => a.startsWith("--stream=")).map((a) => a.split("=")[1].toUpperCase()));
const BATCH = 500;

const wanted = (stream: RevenueStream) => ONLY.size === 0 || ONLY.has(stream);

function databaseHost(): string {
  try {
    return new URL(String(process.env.DATABASE_URL)).hostname;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

// ── Dry-run client ───────────────────────────────────────────────────────────
// Reads pass through to the database. revenue_entry writes are kept in memory
// and are visible to later reads in this run, so a refund replayed after its
// recognition sees the planned recognition exactly as --apply would.

function dryRunClient() {
  const planned: any[] = [];
  let nextId = -1;
  const real = (prisma as any).revenueEntry;
  const client = new Proxy(prisma as any, {
    get(target, prop) {
      if (prop === "$queryRaw") return undefined; // no row locks in a read-only run
      if (prop !== "revenueEntry") return target[prop];
      return {
        findUnique: async (q: any) => planned.find((r) => r.sourceKey === q.where.sourceKey) ?? real.findUnique(q),
        findMany: async (q: any) => [...(await real.findMany(q)), ...planned.filter((r) => r.reversesId === q.where.reversesId)],
        create: async ({ data }: any) => {
          const row = { id: nextId--, ...data };
          planned.push(row);
          return row;
        },
      };
    },
  });
  return { client, planned };
}

// ── Report ───────────────────────────────────────────────────────────────────

type Bucket = { count: number; grossTzs: number; commissionTzs: number; partnerNetTzs: number };
const report = new Map<string, Bucket>();
const outcomes = new Map<string, number>();
const failures: string[] = [];

function tally(label: string, result: LedgerResult) {
  const key = `${label} ${result.status}${result.status === "skipped" ? `:${result.reason}` : ""}`;
  outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  if (result.status !== "created") return;
  const e = result.entry;
  const month = new Date(e.businessDate).toISOString().slice(0, 7);
  const bucketKey = `${e.stream}|${month}|${e.entryType}`;
  const b = report.get(bucketKey) ?? { count: 0, grossTzs: 0, commissionTzs: 0, partnerNetTzs: 0 };
  b.count += 1;
  b.grossTzs += Number(e.grossTzs);
  b.commissionTzs += Number(e.commissionTzs);
  b.partnerNetTzs += Number(e.partnerNetTzs);
  report.set(bucketKey, b);
}

const fmt = (n: number) => round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function printReport() {
  console.log("\nNew entries by stream, EAT business month and type (TZS):");
  console.log(["stream", "month", "type", "count", "gross", "commission", "partnerNet"].join("\t"));
  const totals = new Map<string, Bucket>();
  for (const key of [...report.keys()].sort()) {
    const b = report.get(key)!;
    const [stream, month, type] = key.split("|");
    console.log([stream, month, type, b.count, fmt(b.grossTzs), fmt(b.commissionTzs), fmt(b.partnerNetTzs)].join("\t"));
    const t = totals.get(stream) ?? { count: 0, grossTzs: 0, commissionTzs: 0, partnerNetTzs: 0 };
    t.count += b.count; t.grossTzs += b.grossTzs; t.commissionTzs += b.commissionTzs; t.partnerNetTzs += b.partnerNetTzs;
    totals.set(stream, t);
  }
  console.log("\nNet of new entries by stream (TZS):");
  for (const [stream, t] of totals) console.log(`  ${stream.padEnd(14)} rows ${String(t.count).padStart(6)}  gross ${fmt(t.grossTzs)}  commission ${fmt(t.commissionTzs)}  partnerNet ${fmt(t.partnerNetTzs)}`);
  console.log("\nOutcomes:");
  for (const key of [...outcomes.keys()].sort()) console.log(`  ${key}: ${outcomes.get(key)}`);
  if (failures.length) {
    console.log(`\n${failures.length} source(s) failed and were left out:`);
    failures.slice(0, 50).forEach((f) => console.log(`  ${f}`));
  }
}

// ── Replay ───────────────────────────────────────────────────────────────────

async function replay(label: string, ids: number[], run: (db: any, id: number) => Promise<LedgerResult>, dryDb: any) {
  for (const id of ids) {
    try {
      const result = APPLY
        ? await (prisma as any).$transaction((tx: any) => run(tx, id), REVENUE_TX_OPTIONS)
        : await run(dryDb, id);
      tally(label, result);
    } catch (err: any) {
      failures.push(`${label} ${id}: ${err?.message ?? String(err)}`);
    }
  }
}

/** Ids from `model` matching `where`, in id order, batched to keep memory flat. */
async function idsOf(model: string, where: Record<string, unknown>, field = "id"): Promise<number[]> {
  const out: number[] = [];
  let cursor = 0;
  for (;;) {
    const rows = await (prisma as any)[model].findMany({ where: { ...where, id: { gt: cursor } }, select: { id: true, [field]: true }, orderBy: { id: "asc" }, take: BATCH });
    if (!rows.length) break;
    rows.forEach((r: any) => out.push(Number(r[field])));
    cursor = rows[rows.length - 1].id;
  }
  return out;
}

async function liveRateWarnings() {
  const db = prisma as any;
  const [tours, groups, transport, nrms] = await Promise.all([
    db.tourBooking.count({ where: { currency: { not: "TZS" }, fxTzsPerUnit: null, OR: [{ paymentStatus: "PAID" }, { paymentStatus: "REFUNDED", paidAt: { not: null } }] } }),
    db.groupBooking.count({ where: { depositPaid: true, currency: { not: "TZS" } } }),
    db.transportPayout.count({ where: { currency: { not: "TZS" }, booking: { paymentStatus: "PAID" } } }),
    db.nrmsServicePayment.count({ where: { currency: { not: "TZS" }, status: { in: ["VERIFIED", "MANUALLY_VERIFIED"] } } }),
  ]);
  const total = tours + groups + transport + nrms;
  if (total) {
    console.log(`\nNOTE ${total} non-TZS source(s) have no rate frozen at payment time and will be booked at today's rate:`);
    console.log(`  tours ${tours}, group stays ${groups}, transport ${transport}, subscriptions ${nrms}. The finance overview converts these at today's rate too.`);
  }
}

async function compareWithOverview(planned: any[]) {
  const { computeFinanceOverview } = await import("../src/lib/financeOverview.js");
  const overview = await computeFinanceOverview(undefined, undefined, { margin: false });
  const existing = await (prisma as any).revenueEntry.groupBy({ by: ["stream"], _sum: { grossTzs: true, commissionTzs: true } });
  const ledger = new Map<string, { gross: number; commission: number }>();
  for (const row of existing) ledger.set(row.stream, { gross: Number(row._sum.grossTzs ?? 0), commission: Number(row._sum.commissionTzs ?? 0) });
  for (const row of planned) {
    const cur = ledger.get(row.stream) ?? { gross: 0, commission: 0 };
    cur.gross += Number(row.grossTzs); cur.commission += Number(row.commissionTzs);
    ledger.set(row.stream, cur);
  }
  const keyOf: Record<string, RevenueStream> = { accommodation: "ACCOMMODATION", tours: "TOUR", transport: "TRANSPORT", groupStay: "GROUP_STAY", subscriptions: "SUBSCRIPTION" };
  console.log("\nAll-time NoLSAF revenue, ledger after this run vs the finance overview today (TZS):");
  console.log(["stream", "ledger", "overview", "difference"].join("\t"));
  for (const s of overview.streams) {
    const l = ledger.get(keyOf[s.key]) ?? { gross: 0, commission: 0 };
    console.log([keyOf[s.key], fmt(l.commission), fmt(s.nolsafRevenue), fmt(l.commission - s.nolsafRevenue)].join("\t"));
  }
  console.log("Differences are expected where the overview ignores refunds or converts at today's FX rate (docs/REVENUE_LEDGER.md).");
}

async function main() {
  const host = databaseHost();
  console.log(`revenue_entry backfill: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} against ${host}`);
  if (APPLY && TARGET !== host) {
    console.error(`Refusing to write: pass --target=${host} to confirm this is the database you were approved to backfill.`);
    process.exitCode = 2;
    return;
  }
  for (const s of ONLY) if (!REVENUE_STREAMS.includes(s as RevenueStream)) throw new Error(`Unknown stream ${s}`);

  const { client: dryDb, planned } = dryRunClient();
  const db = prisma as any;

  if (wanted("ACCOMMODATION")) {
    // Same rule as the finance overview: booking invoices whose guest has paid,
    // read through the disbursement-aware money stage.
    const invoices: Array<{ id: number; status: string; invoiceNumber: string | null }> = [];
    let cursor = 0;
    for (;;) {
      const rows = await db.invoice.findMany({
        where: { id: { gt: cursor }, OR: [{ invoiceNumber: null }, { NOT: { invoiceNumber: { startsWith: "OINV-" } } }] },
        select: { id: true, status: true, invoiceNumber: true }, orderBy: { id: "asc" }, take: BATCH,
      });
      if (!rows.length) break;
      invoices.push(...rows);
      cursor = rows[rows.length - 1].id;
    }
    const disbursements = await loadOwnerInvoiceDisbursements(invoices.map((i) => i.id));
    const paid = invoices.filter((inv) => GUEST_MONEY_IN.has(moneyStageOf(inv, disbursements.get(inv.id) ?? []).stage)).map((i) => i.id);
    await replay("ACCOMMODATION INVOICE", paid, (d, id) => recognizeInvoiceRevenue(d, id, { assumeGuestPaid: true }), dryDb);
  }
  if (wanted("TOUR")) {
    const ids = await idsOf("tourBooking", { OR: [{ paymentStatus: "PAID" }, { paymentStatus: "REFUNDED", paidAt: { not: null } }] });
    await replay("TOUR TOUR_BOOKING", ids, (d, id) => recognizeTourRevenue(d, id), dryDb);
  }
  if (wanted("TRANSPORT")) {
    const ids = await idsOf("transportPayout", { booking: { paymentStatus: "PAID" } }, "transportBookingId");
    await replay("TRANSPORT TRANSPORT_BOOKING", ids, (d, id) => recognizeTransportRevenue(d, id), dryDb);
  }
  if (wanted("GROUP_STAY")) {
    const ids = await idsOf("groupBooking", { depositPaid: true });
    await replay("GROUP_STAY GROUP_BOOKING", ids, (d, id) => recognizeGroupStayRevenue(d, id), dryDb);
  }
  if (wanted("SUBSCRIPTION")) {
    const ids = await idsOf("nrmsServicePayment", { status: { in: ["VERIFIED", "MANUALLY_VERIFIED"] } });
    await replay("SUBSCRIPTION NRMS_SERVICE_PAYMENT", ids, (d, id) => recognizeNrmsPaymentRevenue(d, id), dryDb);
  }

  // Reversals after recognitions, so each finds its original.
  if (wanted("ACCOMMODATION")) {
    const refunds = await idsOf("cancellationRequest", { status: "REFUNDED" });
    await replay("ACCOMMODATION CANCELLATION_REFUND", refunds, (d, id) => reverseAccommodationRefund(d, id), dryDb);
    const chargebacks = await db.ownerPayoutRecovery.findMany({ where: { kind: "CHARGEBACK" }, select: { id: true, bookingId: true, guestAmount: true, createdAt: true }, orderBy: { id: "asc" } });
    const byId = new Map<number, any>(chargebacks.map((c: any) => [c.id, c]));
    await replay("ACCOMMODATION CHARGEBACK", [...byId.keys()], (d, id) => reverseAccommodationChargeback(d, byId.get(id)), dryDb);
  }
  if (wanted("TOUR")) {
    const refunds = await idsOf("tourFinancialTransaction", { kind: "REFUND", status: "REFUNDED" });
    await replay("TOUR TOUR_REFUND", refunds, (d, id) => reverseTourRefund(d, id), dryDb);
  }

  printReport();
  await liveRateWarnings();
  if (COMPARE && ONLY.size === 0) await compareWithOverview(APPLY ? [] : planned);
  console.log(APPLY ? "\nApplied. Re-running is safe: existing entries are left alone." : "\nDry run: nothing was written.");
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
