"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArrowUpRight, Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { formatEat, formatTzs } from "@/components/owner-payouts/shared";

/**
 * Claims from the previous invoice flow (submit invoice, then Requested,
 * Verified, Approved, Disbursed). Only claims that are NOT part of the new
 * payout flow are shown (scope=legacy), so nothing appears in two places.
 */

type LegacyInvoice = {
  id: number;
  invoiceReference?: string | null;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  netPayable: number | string;
  bookingReference?: string | null;
  booking?: { property?: { title: string } };
};

const STEPS = ["Submitted", "Verified", "Approved", "Disbursed"] as const;

function stepOf(status: string): number {
  switch (status.toUpperCase()) {
    case "DRAFT":
      return -1;
    case "REQUESTED":
      return 0;
    case "VERIFIED":
      return 1;
    case "APPROVED":
    case "PROCESSING":
      return 2;
    default:
      return 3;
  }
}

/** What the claim is waiting for right now, in one short line. */
function nextLabel(status: string): { text: string; tone: string } {
  switch (status.toUpperCase()) {
    case "DRAFT":
      return { text: "Waiting for you to submit", tone: "text-amber-700" };
    case "REQUESTED":
      return { text: "Waiting for verification", tone: "text-slate-600" };
    case "VERIFIED":
      return { text: "Waiting for approval", tone: "text-slate-600" };
    case "PROCESSING":
      return { text: "Payment is being sent", tone: "text-sky-700" };
    default:
      return { text: "Approved, payment scheduled", tone: "text-emerald-700" };
  }
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1" aria-label={step < 0 ? "Not submitted" : `${STEPS[step]}, step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <span
          key={s}
          title={s}
          className={`h-1.5 flex-1 rounded-full ${i < step || (i === step && step === STEPS.length - 1) ? "bg-[#02665e]" : i === step ? "bg-[#02665e]/60" : "bg-slate-200"}`}
        />
      ))}
    </div>
  );
}

export default function OlderClaimsPage() {
  const [items, setItems] = useState<LegacyInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get<{ items: LegacyInvoice[] }>("/api/owner/revenue/invoices", {
        params: { status: "DRAFT,REQUESTED,VERIFIED,APPROVED,PROCESSING", scope: "legacy", take: 200 },
      })
      .then((res) => setItems((res.data?.items ?? []).filter((i) => String(i.invoiceNumber || "").startsWith("OINV-"))))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const amount = (list: LegacyInvoice[]) => list.reduce((t, i) => t + (Number(i.netPayable) || 0), 0);
    const drafts = items.filter((i) => stepOf(i.status) < 0);
    const approved = items.filter((i) => stepOf(i.status) === 2);
    return { all: amount(items), drafts: drafts.length, approved: amount(approved), approvedCount: approved.length };
  }, [items]);

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading older claims...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Figures first, so the owner sees what is still owed before reading rows. */}
      <section className="grid grid-cols-1 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white sm:grid-cols-3">
        {[
          { label: "Open claims", value: String(items.length), hint: items.length === 1 ? "claim still finishing" : "claims still finishing" },
          { label: "Still to be paid", value: formatTzs(totals.all), hint: "across all open claims" },
          {
            label: "Approved",
            value: formatTzs(totals.approved),
            hint: `${totals.approvedCount} ${totals.approvedCount === 1 ? "claim" : "claims"} waiting for payment`,
          },
        ].map((card, i) => (
          <div
            key={card.label}
            className={`px-5 py-4 ${i > 0 ? "border-0 border-t border-solid border-slate-100 sm:border-l sm:border-t-0" : ""}`}
          >
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{card.label}</p>
            <p className="m-0 mt-1 text-xl font-bold tabular-nums text-slate-900">{card.value}</p>
            <p className="m-0 mt-0.5 text-xs text-slate-500">{card.hint}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="flex items-start gap-3 border-0 border-b border-solid border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-5">
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <p className="m-0 text-xs leading-5 text-slate-600">
            Started before the new payout flow, so they finish the previous way: our team verifies, approves and disburses each one.
            {totals.drafts > 0 && <span className="font-semibold text-amber-700"> {totals.drafts} still need you to submit the invoice.</span>} New stays
            are under{" "}
            <Link href="/owner/payouts/in-progress" className="font-semibold text-[#02665e]">
              In progress
            </Link>
            .
          </p>
        </div>

        {items.length === 0 ? (
          <p className="m-0 px-5 py-10 text-center text-sm text-slate-500">No older claims are open. Finished ones are in History.</p>
        ) : (
          <>
            {/* Table from md up. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col />
                  <col className="w-[120px]" />
                  <col className="w-[30%]" />
                  <col className="w-[150px]" />
                  <col className="w-[130px]" />
                </colgroup>
                <thead>
                  <tr className="border-0 border-b border-solid border-slate-200 text-left">
                    {["Property and claim", "Issued", "Progress", "Amount", ""].map((head, i) => (
                      <th
                        key={head || "action"}
                        scope="col"
                        className={`px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 ${i === 3 ? "text-right" : "text-left"}`}
                      >
                        {head || <span className="sr-only">Action</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((inv) => {
                    const step = stepOf(inv.status);
                    const next = nextLabel(inv.status);
                    const href = `/owner/invoices/${encodeURIComponent(inv.invoiceReference ?? String(inv.id))}`;
                    return (
                      <tr key={inv.id} className="border-0 border-b border-solid border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                        <td className="px-5 py-3.5 align-middle">
                          <p className="m-0 truncate font-semibold text-slate-900">{inv.booking?.property?.title || "Your property"}</p>
                          <p className="m-0 mt-0.5 truncate font-mono text-[11px] text-slate-500">{inv.invoiceNumber}</p>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 align-middle text-slate-600">{formatEat(inv.issuedAt, false)}</td>
                        <td className="px-5 py-3.5 align-middle">
                          <Progress step={step} />
                          <p className={`m-0 mt-1.5 text-[11px] font-semibold ${next.tone}`}>
                            {step >= 0 && <span className="text-slate-400">{STEPS[step]} · </span>}
                            {next.text}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-right align-middle font-bold tabular-nums text-slate-900">
                          {formatTzs(inv.netPayable)}
                        </td>
                        <td className="px-5 py-3.5 text-right align-middle">
                          <Link
                            href={href}
                            className={`inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-solid px-3 text-xs font-semibold no-underline hover:no-underline ${
                              step < 0
                                ? "border-[#02665e] bg-[#02665e] text-white hover:bg-[#015750]"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            {step < 0 ? "Submit invoice" : "View claim"} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Phones: one card per claim. */}
            <ul className="m-0 list-none divide-y divide-slate-100 p-0 md:hidden">
              {items.map((inv) => {
                const step = stepOf(inv.status);
                const next = nextLabel(inv.status);
                const href = `/owner/invoices/${encodeURIComponent(inv.invoiceReference ?? String(inv.id))}`;
                return (
                  <li key={inv.id} className="space-y-2.5 px-4 py-3.5">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-slate-900">{inv.booking?.property?.title || "Your property"}</p>
                        <p className="m-0 mt-0.5 truncate font-mono text-[11px] text-slate-500">
                          {inv.invoiceNumber} · {formatEat(inv.issuedAt, false)}
                        </p>
                      </div>
                      <span className="whitespace-nowrap text-sm font-bold tabular-nums text-slate-900">{formatTzs(inv.netPayable)}</span>
                    </div>
                    <Progress step={step} />
                    <div className="flex items-center justify-between gap-3">
                      <p className={`m-0 text-[11px] font-semibold ${next.tone}`}>{next.text}</p>
                      <Link
                        href={href}
                        className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-solid px-2.5 text-xs font-semibold no-underline hover:no-underline ${
                          step < 0 ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        {step < 0 ? "Submit" : "View"} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
