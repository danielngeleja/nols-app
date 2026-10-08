"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import apiClient from "@/lib/apiClient";

/**
 * Owner payout recoveries (Property Owner Disbursement Policy 6.3.3;
 * docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md Phase 4). A recovery is the owner's
 * share of a refund or chargeback on a stay they were already paid for. It is
 * deducted from the owner's next payouts; after 7 business days the owner is
 * asked to repay. Refunds create recoveries automatically; chargebacks are
 * recorded here from the provider's notice.
 */

type Recovery = {
  id: number;
  ownerId: number;
  ownerName: string | null;
  bookingReference: string;
  kind: "REFUND" | "CHARGEBACK";
  reference: string;
  guestAmount: string;
  amount: string;
  recoveredAmount: string;
  outstanding: number;
  status: "OPEN" | "RECOVERED" | "WAIVED";
  dueAt: string;
  repayRequestedAt: string | null;
  closedAt: string | null;
  note: string | null;
  createdAt: string;
};

const STATUS_TABS: Array<{ value: "" | Recovery["status"]; label: string }> = [
  { value: "OPEN", label: "Open" },
  { value: "RECOVERED", label: "Recovered" },
  { value: "WAIVED", label: "Waived" },
  { value: "", label: "All" },
];

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";
const field =
  "box-border h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
const label = "m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400";

function tzs(value: string | number) {
  return `TSh ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function eat(iso: string) {
  return `${new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}`;
}

function errorMessage(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) return "Finance verification is required. Complete it in the verification panel, then try again.";
  return cause?.response?.data?.error || fallback;
}

export default function RecoveriesPage() {
  const [status, setStatus] = useState<"" | Recovery["status"]>("OPEN");
  const [rows, setRows] = useState<Recovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [waiveNotes, setWaiveNotes] = useState<Record<number, string>>({});
  const [chargeback, setChargeback] = useState({ bookingReference: "", amount: "", providerReference: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/admin/disbursements/recoveries", { params: { status: status || undefined } });
      setRows(response.data?.recoveries || []);
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load recoveries."));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const facts = useMemo(() => {
    const open = rows.filter((r) => r.status === "OPEN");
    const outstanding = open.reduce((sum, r) => sum + Number(r.outstanding), 0);
    const overdue = open.filter((r) => new Date(r.dueAt).getTime() < Date.now()).length;
    return [
      { label: "Open", value: loading ? "..." : String(open.length), detail: "owner debts being recovered" },
      { label: "Outstanding", value: loading ? "..." : tzs(outstanding), detail: "taken from next payouts" },
      { label: "Past 7 business days", value: loading ? "..." : String(overdue), detail: "owner asked to repay" },
    ];
  }, [rows, loading]);

  const recordChargeback = async () => {
    setBusy("chargeback");
    setError("");
    setNotice("");
    try {
      await apiClient.post("/api/admin/disbursements/recoveries/chargeback", {
        bookingReference: chargeback.bookingReference.trim(),
        amount: Number(chargeback.amount),
        providerReference: chargeback.providerReference.trim(),
        note: chargeback.note.trim() || undefined,
      });
      setNotice("Chargeback recorded. The owner's share will be deducted from their next payouts, and the owner has been notified.");
      setChargeback({ bookingReference: "", amount: "", providerReference: "", note: "" });
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not record the chargeback."));
    } finally {
      setBusy("");
    }
  };

  const waive = async (id: number) => {
    const note = (waiveNotes[id] || "").trim();
    if (note.length < 5) {
      setError(`Write why recovery #${id} is being waived before waiving it.`);
      return;
    }
    setBusy(`waive-${id}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/disbursements/recoveries/${id}/waive`, { note });
      setNotice(`Recovery #${id} waived. Nothing more will be deducted for it.`);
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, `Could not waive recovery #${id}.`));
    } finally {
      setBusy("");
    }
  };

  const canRecord =
    chargeback.bookingReference.trim().length >= 3 && Number(chargeback.amount) > 0 && chargeback.providerReference.trim().length >= 3;

  return (
    <div id="disbursement-recoveries" className="w-full min-w-0 space-y-5">
      <style>{`#disbursement-recoveries, #disbursement-recoveries * { box-sizing: border-box; }`}</style>

      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Owner payouts</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Recoveries</h1>
              <p className="m-0 mt-1 max-w-3xl text-sm text-white/60">
                The owner&apos;s share of a refund or chargeback on a stay they were already paid for. It is deducted from their next payouts,
                and while it is open their payouts come to an admin. Refunds are recorded automatically; record chargebacks below.
              </p>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <dl className="m-0 mt-5 grid grid-cols-1 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 sm:grid-cols-3 sm:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index ? "sm:border-0 sm:border-l sm:border-solid sm:border-white/10 sm:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className="m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums text-white">{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error && <p className="m-0 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800" role="alert">{error}</p>}
      {notice && <p className="m-0 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800" role="status">{notice}</p>}

      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <RotateCcw className="h-4 w-4 text-neutral-500" />
          <h2 className="m-0 text-sm font-bold text-neutral-900">Record a card chargeback</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
          <div>
            <label htmlFor="cb-booking" className={label}>Booking reference</label>
            <input id="cb-booking" className={`${field} mt-1.5`} value={chargeback.bookingReference} onChange={(e) => setChargeback((p) => ({ ...p, bookingReference: e.target.value }))} placeholder="From the booking page" />
          </div>
          <div>
            <label htmlFor="cb-amount" className={label}>Amount charged back (TZS)</label>
            <input id="cb-amount" inputMode="numeric" className={`${field} mt-1.5`} value={chargeback.amount} onChange={(e) => setChargeback((p) => ({ ...p, amount: e.target.value.replace(/[^\d.]/g, "") }))} />
          </div>
          <div>
            <label htmlFor="cb-ref" className={label}>Provider reference</label>
            <input id="cb-ref" className={`${field} mt-1.5`} value={chargeback.providerReference} onChange={(e) => setChargeback((p) => ({ ...p, providerReference: e.target.value }))} placeholder="From the chargeback notice" />
          </div>
          <div>
            <label htmlFor="cb-note" className={label}>Note (optional)</label>
            <input id="cb-note" className={`${field} mt-1.5`} value={chargeback.note} onChange={(e) => setChargeback((p) => ({ ...p, note: e.target.value }))} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50/60 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => void recordChargeback()}
            disabled={!canRecord || busy === "chargeback"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-50"
          >
            {busy === "chargeback" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record chargeback
          </button>
          <span className="text-xs text-neutral-500">Only the owner&apos;s share is recovered, never more than they were paid. Needs your finance code.</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap gap-1 border-0 border-b border-solid border-neutral-200 px-4 pt-2 sm:px-5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value || "ALL"}
              type="button"
              onClick={() => setStatus(tab.value)}
              className={`-mb-px h-9 border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-semibold ${status === tab.value ? "border-[#02665e] text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="m-0 px-5 py-8 text-center text-sm text-neutral-500">Loading recoveries...</p>
        ) : rows.length === 0 ? (
          <p className="m-0 px-5 py-8 text-center text-sm text-neutral-500">No recoveries here.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-neutral-100 p-0">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-900">#{r.id} {r.ownerName || `Owner ${r.ownerId}`}</span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">{r.kind === "CHARGEBACK" ? "Chargeback" : "Refund"}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === "OPEN" ? "bg-amber-50 text-amber-800" : r.status === "RECOVERED" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}
                    >
                      {r.status === "OPEN" ? "Open" : r.status === "RECOVERED" ? "Recovered" : "Waived"}
                    </span>
                    {r.repayRequestedAt && r.status === "OPEN" && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">Repayment requested</span>
                    )}
                  </div>
                  <p className="m-0 mt-1 text-xs text-neutral-500">
                    Booking {r.bookingReference}. Guest got back {tzs(r.guestAmount)}; owner share {tzs(r.amount)}; recovered {tzs(r.recoveredAmount)}.
                    {r.status === "OPEN" ? ` Due ${eat(r.dueAt)}.` : r.closedAt ? ` Closed ${eat(r.closedAt)}.` : ""}
                    {r.note ? ` ${r.note}` : ""}
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-bold tabular-nums text-neutral-900">{r.status === "OPEN" ? tzs(r.outstanding) : tzs(r.amount)}</span>
                  {r.status === "OPEN" && (
                    <>
                      <input
                        aria-label={`Reason to waive recovery ${r.id}`}
                        placeholder="Reason to waive"
                        value={waiveNotes[r.id] || ""}
                        onChange={(e) => setWaiveNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                        className={`${field} w-48`}
                      />
                      <button
                        type="button"
                        onClick={() => void waive(r.id)}
                        disabled={busy === `waive-${r.id}`}
                        className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        Waive
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
