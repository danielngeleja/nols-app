"use client";

// Admin review of pre-trip advances on one tour booking (Tour Operator
// Disbursement Policy). Finance verifies the claim and any supplier receipts,
// approves it, then sends it through the AzamPay disbursement queue as source
// TOUR_ADVANCE. The balance after the trip pays the net share minus advances.
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, HandCoins, Receipt, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type TourAdvanceRow = {
  id: number;
  status: string;
  amount: number;
  createdAt: string;
  percentOfNet: number | null;
  inFullWindow: boolean;
  hoursBeforeStart: number | null;
  operatorTier: string | null;
  evidence: Array<{ description: string; amount: number; evidenceUrl: string }>;
  evidenceTotal: number;
  history: Array<{ action: string; at: string; reason: string; actor?: { name: string | null } | null }>;
  rejectedReason: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  CLAIMED: "border-sky-200 bg-sky-50 text-sky-700",
  VERIFIED: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  DISBURSED: "border-green-200 bg-green-50 text-green-700",
  PAID: "border-green-200 bg-green-50 text-green-700",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-700",
};

function money(value: number, currency: string) {
  return `${currency} ${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
}

export default function TourAdvancePanel({
  currency,
  operatorNet,
  advancePaid,
  balanceAmount,
  advances,
  onChanged,
}: {
  currency: string;
  operatorNet: number;
  advancePaid: number;
  balanceAmount: number;
  advances: TourAdvanceRow[];
  onChanged: () => void;
}) {
  const [working, setWorking] = useState<number | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const act = async (row: TourAdvanceRow, action: "verify" | "approve" | "reject") => {
    const reason = String(reasons[row.id] || "").trim();
    if (!reason) {
      setError("Write a short note before changing an advance.");
      return;
    }
    setWorking(row.id);
    setError(null);
    try {
      await apiClient.post(`/api/admin/tour-revenue/advances/${row.id}/action`, { action, reason });
      setReasons((old) => ({ ...old, [row.id]: "" }));
      onChanged();
    } catch (err: any) {
      setError(String(err?.response?.data?.error || "Could not update this advance."));
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50">
            <HandCoins className="h-4 w-4 text-emerald-700" />
          </div>
          <div>
            <h3 className="m-0 text-base font-semibold text-gray-900 sm:text-lg">Pre-trip advances</h3>
            <p className="m-0 text-xs text-gray-500">30% from 7 days out, up to 70% with supplier receipts, 70% inside 96 hours.</p>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-3 gap-4 text-right">
          {[
            { label: "Net share", value: money(operatorNet, currency) },
            { label: "Advanced", value: money(advancePaid, currency) },
            { label: "Balance due", value: money(balanceAmount, currency) },
          ].map((fact) => (
            <div key={fact.label}>
              <dt className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-gray-400">{fact.label}</dt>
              <dd className="m-0 mt-0.5 text-sm font-bold tabular-nums text-gray-900">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {error ? (
        <p role="alert" className="m-0 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      {advances.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-gray-300 px-4 py-5 text-center text-sm text-gray-500">
          The operator has not requested an advance for this trip.
        </p>
      ) : (
        <div className="space-y-3">
          {advances.map((row) => {
            const status = String(row.status || "").toUpperCase();
            const open = ["CLAIMED", "VERIFIED", "APPROVED"].includes(status);
            return (
              <div key={row.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold tabular-nums text-gray-900">{money(row.amount, currency)}</span>
                      {row.percentOfNet != null ? <span className="text-xs font-semibold text-gray-500">{row.percentOfNet}% of net</span> : null}
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status] || "border-gray-200 bg-gray-50 text-gray-600"}`}>{status}</span>
                    </div>
                    <p className="m-0 mt-1 text-xs text-gray-500">
                      Advance #{row.id} · requested {new Date(row.createdAt).toLocaleString()}
                      {row.hoursBeforeStart != null ? ` · ${row.hoursBeforeStart}h before departure` : ""}
                      {row.inFullWindow ? " · inside the 96-hour window" : ""}
                      {row.operatorTier ? ` · ${row.operatorTier.toLowerCase()} tier` : ""}
                    </p>
                  </div>
                  {status === "APPROVED" ? (
                    <Link
                      href={`/admin/disbursements?sourceType=TOUR_ADVANCE&sourceId=${row.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white no-underline hover:bg-emerald-800"
                    >
                      Send via AzamPay
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                </div>

                {row.evidence.length > 0 ? (
                  <div className="mt-3 rounded-lg bg-gray-50 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-gray-700">
                      <Receipt className="h-3.5 w-3.5" /> Supplier receipts ({money(row.evidenceTotal, currency)})
                    </div>
                    <ul className="m-0 list-none space-y-1 p-0">
                      {row.evidence.map((item, index) => (
                        <li key={index} className="flex items-center justify-between gap-3 text-xs">
                          <a href={item.evidenceUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-emerald-700 underline">
                            {item.description}
                          </a>
                          <span className="flex-shrink-0 font-semibold tabular-nums text-gray-700">{money(item.amount, currency)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="m-0 mt-1.5 text-[11px] text-gray-500">Check each receipt matches this trip before verifying.</p>
                  </div>
                ) : row.inFullWindow ? null : (
                  <p className="m-0 mt-2 text-xs text-gray-500">Within the no-receipt share, no supplier receipts needed.</p>
                )}

                {row.history.length > 0 ? (
                  <ul className="m-0 mt-3 list-none space-y-1 border-0 border-l-2 border-solid border-gray-200 p-0 pl-3">
                    {row.history.map((step, index) => (
                      <li key={index} className="text-xs text-gray-600">
                        <strong className="font-semibold">{step.action.toLowerCase()}</strong> · {new Date(step.at).toLocaleString()}
                        {step.actor?.name ? ` · ${step.actor.name}` : ""} · {step.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {status === "REJECTED" && row.rejectedReason ? (
                  <p className="m-0 mt-2 text-xs text-rose-700">Rejected: {row.rejectedReason}</p>
                ) : null}

                {open ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      value={reasons[row.id] || ""}
                      onChange={(e) => setReasons((old) => ({ ...old, [row.id]: e.target.value }))}
                      placeholder="Note for the record"
                      className="box-border min-w-0 flex-1 rounded-lg border-2 border-gray-300 px-3 py-2 text-sm focus:border-[#02665e] focus:outline-none"
                    />
                    <div className="flex flex-shrink-0 gap-2">
                      {status === "CLAIMED" ? (
                        <button type="button" onClick={() => act(row, "verify")} disabled={working === row.id} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Verify
                        </button>
                      ) : null}
                      {status === "VERIFIED" ? (
                        <button type="button" onClick={() => act(row, "approve")} disabled={working === row.id} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </button>
                      ) : null}
                      <button type="button" onClick={() => act(row, "reject")} disabled={working === row.id} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
