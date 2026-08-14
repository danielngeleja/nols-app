"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type Commission = {
  id: number;
  type: string;
  status: string;
  sourceKey: string;
  commissionAmount: number;
  currency: string;
  earnedAt: string;
  property: { id: number; title: string } | null;
  salesPartner: {
    id: number;
    agentCode: string;
    user: { name: string | null; email: string | null };
  };
  payoutItem: { payoutId: number } | null;
};

type Payout = {
  id: number;
  referenceNumber: string;
  requestedAmount: number;
  approvedAmount: number | null;
  deductionAmount: number;
  netPaidAmount: number | null;
  currency: string;
  status: string;
  payoutMethod: string;
  payoutName: string;
  payoutAccount: string | null;
  requestedAt: string;
  paymentReference: string | null;
  salesPartner: {
    id: number;
    agentCode: string;
    user: { name: string | null; email: string | null };
  };
  _count: { items: number };
};

const commissionStatuses = ["", "VALIDATING", "ELIGIBLE", "AVAILABLE", "PAID", "REVERSED", "CANCELLED"];
const payoutStatuses = ["", "REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING", "PAID", "REJECTED", "CANCELLED"];
const fieldClass =
  "min-h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const actionClass =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";

function money(value: number | null, currency: string) {
  if (value == null) return "—";
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function errorMessage(cause: any, fallback: string) {
  return cause?.response?.data?.require2fa
    ? "Finance OTP verification is required. Complete it in the verification panel, then retry."
    : cause?.response?.data?.error || fallback;
}

function statusClass(status: string) {
  if (["PAID", "AVAILABLE", "APPROVED"].includes(status)) return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (["REJECTED", "REVERSED", "CANCELLED"].includes(status)) return "border-red-100 bg-red-50 text-red-700";
  return "border-amber-100 bg-amber-50 text-amber-700";
}

function FinanceSummary({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  detail: string;
  tone: "emerald" | "amber" | "blue" | "slate";
}) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-sky-100 bg-sky-50 text-sky-700",
    slate: "border-neutral-200 bg-neutral-100 text-neutral-600",
  };
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p><p className="mb-0 mt-1 truncate text-xl font-black text-neutral-950">{value}</p></div>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mb-0 mt-2 text-[11px] text-neutral-500">{detail}</p>
    </div>
  );
}

export default function AdminSalesFinancePage() {
  const [tab, setTab] = useState<"commissions" | "payouts">("commissions");
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [commissionStatus, setCommissionStatus] = useState("ELIGIBLE");
  const [payoutStatus, setPayoutStatus] = useState("REQUESTED");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [deduction, setDeduction] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adjustment, setAdjustment] = useState({
    salesPartnerId: "",
    propertyId: "",
    amount: "",
    currency: "TZS",
    reason: "",
  });
  const summary = useMemo(() => {
    const commissionCurrencies = [...new Set(commissions.map((item) => item.currency))];
    const payoutCurrencies = [...new Set(payouts.map((item) => item.currency))];
    const commissionTotal = commissions.reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0);
    const payoutTotal = payouts.reduce((sum, item) => sum + Number(item.netPaidAmount ?? item.requestedAmount ?? 0), 0);
    return {
      commissionCount: commissions.length,
      commissionValue: commissionCurrencies.length === 1 ? money(commissionTotal, commissionCurrencies[0]) : commissions.length ? "Mixed currencies" : "TSh 0",
      payoutCount: payouts.length,
      payoutValue: payoutCurrencies.length === 1 ? money(payoutTotal, payoutCurrencies[0]) : payouts.length ? "Mixed currencies" : "TSh 0",
    };
  }, [commissions, payouts]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [commissionResponse, payoutResponse] = await Promise.all([
        apiClient.get("/api/admin/sales/commissions", {
          params: { pageSize: 100, status: commissionStatus || undefined, q: query || undefined },
        }),
        apiClient.get("/api/admin/sales/payouts", {
          params: { pageSize: 100, status: payoutStatus || undefined, q: query || undefined },
        }),
      ]);
      setCommissions(commissionResponse.data?.commissions || []);
      setPayouts(payoutResponse.data?.payouts || []);
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load sales finance data."));
    } finally {
      setLoading(false);
    }
  }, [commissionStatus, payoutStatus, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const requireReason = (key: string) => {
    const value = (reason[key] || "").trim();
    if (value.length < 5) {
      setError("Enter an audit reason of at least 5 characters.");
      return null;
    }
    return value;
  };

  const commissionAction = async (item: Commission, action: "approve" | "reverse") => {
    const note = requireReason(`commission-${item.id}`);
    if (!note) return;
    setBusy(`commission-${action}-${item.id}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/sales/commissions/${item.id}/${action}`, { reason: note });
      setNotice(action === "approve" ? `Commission #${item.id} is available to withdraw.` : `Commission #${item.id} was reversed with ledger history retained.`);
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, `Commission ${action} failed.`));
    } finally {
      setBusy("");
    }
  };

  // "processing" and "paid" were retired here — a payout is paid exclusively
  // through the AzamPay Disbursement queue once it reaches APPROVED (see the
  // "Send via AzamPay instead" link shown below for APPROVED payouts).
  const payoutAction = async (item: Payout, action: "approve" | "reject") => {
    const note = requireReason(`payout-${item.id}`);
    if (!note) return;
    const payload: Record<string, unknown> = { reason: note };
    if (action === "approve") {
      const value = Number(deduction[item.id] || 0);
      if (!Number.isFinite(value) || value < 0) return setError("Deduction must be zero or a positive amount.");
      payload.deductionAmount = value;
    }
    setBusy(`payout-${action}-${item.id}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/sales/payouts/${item.id}/${action}`, payload);
      setNotice(`Payout ${item.referenceNumber} moved to ${action.toUpperCase()}.`);
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, `Payout ${action} failed.`));
    } finally {
      setBusy("");
    }
  };

  const createAdjustment = async () => {
    const partnerId = Number(adjustment.salesPartnerId);
    const propertyId = adjustment.propertyId ? Number(adjustment.propertyId) : null;
    const amount = Number(adjustment.amount);
    if (!Number.isInteger(partnerId) || partnerId <= 0 || !Number.isFinite(amount) || amount === 0 || adjustment.reason.trim().length < 5) {
      setError("Enter a valid partner ID, non-zero amount, and audit reason of at least 5 characters.");
      return;
    }
    setBusy("adjustment");
    setError("");
    setNotice("");
    try {
      await apiClient.post("/api/admin/sales/commissions/adjustments", {
        salesPartnerId: partnerId,
        propertyId,
        amount,
        currency: adjustment.currency,
        reason: adjustment.reason.trim(),
      });
      setAdjustment({ salesPartnerId: "", propertyId: "", amount: "", currency: "TZS", reason: "" });
      setNotice("Manual ledger adjustment created and made available.");
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not create the adjustment."));
    } finally {
      setBusy("");
    }
  };

  return (
    <div id="sales-finance" className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:space-y-5 sm:py-6">
      <style>{`#sales-finance, #sales-finance * { box-sizing: border-box; }`}</style>
      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">FINANCE</div>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Wallet className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Sales administration</p>
                <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 shadow-sm">Finance OTP protected</span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Sales finance control</h1>
              <p className="mb-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500 sm:text-sm">Approve ledger earnings and move locked payouts through auditable states.</p>
            </div>
          </div>
          <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            <Link href="/admin/sales" className={`${actionClass} min-h-10 no-underline`}><ArrowLeft className="h-4 w-4" /> Review</Link>
            <Link href="/admin/sales/partners" className={`${actionClass} min-h-10 no-underline`}><Users className="h-4 w-4" /> Partners</Link>
            <Link href="/admin/sales/materials" className={`${actionClass} min-h-10 no-underline`}><FileText className="h-4 w-4" /> Materials</Link>
            <button type="button" onClick={() => void load()} disabled={loading} className={`${actionClass} h-10 w-10 shrink-0 px-0`} aria-label="Refresh sales finance data" title="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" />{notice}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FinanceSummary icon={CircleDollarSign} label="Visible commissions" value={String(summary.commissionCount)} detail={`Current ${commissionStatus || "all"} filter`} tone="blue" />
        <FinanceSummary icon={BadgeCheck} label="Commission value" value={summary.commissionValue} detail="Value in the visible ledger" tone="emerald" />
        <FinanceSummary icon={Clock3} label="Visible payouts" value={String(summary.payoutCount)} detail={`Current ${payoutStatus || "all"} filter`} tone="amber" />
        <FinanceSummary icon={Wallet} label="Payout value" value={summary.payoutValue} detail="Net or requested visible value" tone="slate" />
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
            <button type="button" onClick={() => setTab("commissions")} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border-0 px-3 text-xs font-bold transition ${tab === "commissions" ? "bg-white text-emerald-800 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}><CircleDollarSign className="h-4 w-4" />Commissions</button>
            <button type="button" onClick={() => setTab("payouts")} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border-0 px-3 text-xs font-bold transition ${tab === "payouts" ? "bg-white text-emerald-800 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}><Send className="h-4 w-4" />Payouts</button>
          </div>
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_220px]">
          <label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className={`${fieldClass} pl-9`} placeholder="Reference, agent code, partner or property" aria-label="Search sales finance" /></label>
          <select value={tab === "commissions" ? commissionStatus : payoutStatus} onChange={(event) => tab === "commissions" ? setCommissionStatus(event.target.value) : setPayoutStatus(event.target.value)} className={fieldClass}>
            {(tab === "commissions" ? commissionStatuses : payoutStatuses).map((status) => <option key={status || "ALL"} value={status}>{status || "ALL STATUSES"}</option>)}
          </select>
          </div>
        </div>
      </section>

      {tab === "commissions" && (
        <>
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-violet-100 bg-violet-50 text-violet-700"><RotateCcw className="h-4 w-4" /></span>
              <div><h2 className="m-0 text-sm font-bold text-neutral-900">Manual ledger adjustment</h2><p className="mb-0 mt-0.5 text-xs text-neutral-500">Positive credits and negative recovery offsets remain fully auditable.</p></div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <input className={fieldClass} value={adjustment.salesPartnerId} onChange={(e) => setAdjustment({ ...adjustment, salesPartnerId: e.target.value })} placeholder="Partner profile ID" />
              <input className={fieldClass} value={adjustment.propertyId} onChange={(e) => setAdjustment({ ...adjustment, propertyId: e.target.value })} placeholder="Property ID (optional)" />
              <input className={fieldClass} type="number" value={adjustment.amount} onChange={(e) => setAdjustment({ ...adjustment, amount: e.target.value })} placeholder="Amount (+/-)" />
              <input className={fieldClass} maxLength={3} value={adjustment.currency} onChange={(e) => setAdjustment({ ...adjustment, currency: e.target.value.toUpperCase() })} placeholder="TZS" />
              <input className={`${fieldClass} lg:col-span-2`} value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} placeholder="Required audit reason" />
            </div>
            <button type="button" disabled={busy === "adjustment"} onClick={() => void createAdjustment()} className={`${actionClass} mt-3 !border-emerald-700 !bg-emerald-700 !text-white`}>{busy === "adjustment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}Create adjustment</button>
          </section>

          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
            {loading ? <div className="grid min-h-56 place-items-center text-neutral-400"><div className="text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /><p className="mb-0 mt-2 text-xs">Loading ledger</p></div></div> : commissions.length === 0 ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span><p className="mb-0 mt-3 text-sm font-bold text-neutral-800">No matching commissions</p><p className="mb-0 mt-1 text-xs text-neutral-500">Try another status or search term.</p></div></div> : (
              <div className="divide-y divide-neutral-100">
                {commissions.map((item) => (
                  <article key={item.id} className="grid gap-3 p-4 transition hover:bg-emerald-50/30 lg:grid-cols-[minmax(0,1fr)_220px_270px] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-neutral-950">#{item.id} / {item.salesPartner.agentCode}</strong><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(item.status)}`}>{item.status}</span></div>
                      <p className="mb-0 mt-1 truncate text-xs text-slate-500">{item.salesPartner.user.name || item.salesPartner.user.email} · {item.property?.title || "No property"} · {item.type.replaceAll("_", " ")}</p>
                      <p className="mb-0 mt-1 truncate font-mono text-[10px] text-slate-400">{item.sourceKey}</p>
                    </div>
                    <div><p className="m-0 text-lg font-black text-slate-950">{money(item.commissionAmount, item.currency)}</p><p className="m-0 text-xs text-slate-500">{new Date(item.earnedAt).toLocaleString()}</p></div>
                    <div className="space-y-2">
                      <input className={fieldClass} value={reason[`commission-${item.id}`] || ""} onChange={(e) => setReason({ ...reason, [`commission-${item.id}`]: e.target.value })} placeholder="Required audit reason" />
                      <div className="flex gap-2">
                        <button type="button" disabled={item.status !== "ELIGIBLE" || !!busy} onClick={() => void commissionAction(item, "approve")} className={actionClass}>{busy === `commission-approve-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}Approve</button>
                        <button type="button" disabled={["REVERSED", "CANCELLED"].includes(item.status) || !!busy} onClick={() => void commissionAction(item, "reverse")} className={actionClass}><RotateCcw className="h-4 w-4" />Reverse</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tab === "payouts" && (
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          {loading ? <div className="grid min-h-56 place-items-center text-neutral-400"><div className="text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /><p className="mb-0 mt-2 text-xs">Loading payouts</p></div></div> : payouts.length === 0 ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-neutral-100 text-neutral-500"><Send className="h-5 w-5" /></span><p className="mb-0 mt-3 text-sm font-bold text-neutral-800">No matching payouts</p><p className="mb-0 mt-1 text-xs text-neutral-500">Try another status or search term.</p></div></div> : (
            <div className="divide-y divide-neutral-100">
              {payouts.map((item) => (
                <article key={item.id} className="grid gap-4 p-4 transition hover:bg-emerald-50/30 xl:grid-cols-[minmax(0,1fr)_230px_330px] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-neutral-950">{item.referenceNumber}</strong><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(item.status)}`}>{item.status}</span></div>
                    <p className="mb-0 mt-1 text-xs text-slate-500">{item.salesPartner.agentCode} · {item.salesPartner.user.name || item.salesPartner.user.email} · {item._count.items} ledger items</p>
                    <p className="mb-0 mt-1 text-xs text-slate-500">{item.payoutMethod} ending {item.payoutAccount || "unknown"} · requested {new Date(item.requestedAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="m-0 text-lg font-black text-slate-950">{money(item.netPaidAmount ?? item.requestedAmount, item.currency)}</p>
                    {item.deductionAmount > 0 && <p className="m-0 text-xs text-red-600">Deduction {money(item.deductionAmount, item.currency)}</p>}
                  </div>
                  <div className="space-y-2">
                    <input className={fieldClass} value={reason[`payout-${item.id}`] || ""} onChange={(e) => setReason({ ...reason, [`payout-${item.id}`]: e.target.value })} placeholder="Required audit reason" />
                    {["REQUESTED", "UNDER_REVIEW"].includes(item.status) && <input className={fieldClass} type="number" min="0" value={deduction[item.id] || ""} onChange={(e) => setDeduction({ ...deduction, [item.id]: e.target.value })} placeholder="Deduction (0 if none)" />}
                    <div className="flex flex-wrap gap-2">
                      {["REQUESTED", "UNDER_REVIEW"].includes(item.status) && <>
                        <button type="button" disabled={!!busy} onClick={() => void payoutAction(item, "approve")} className={actionClass}><BadgeCheck className="h-4 w-4" />Approve</button>
                        <button type="button" disabled={!!busy} onClick={() => void payoutAction(item, "reject")} className={actionClass}><Ban className="h-4 w-4" />Reject</button>
                      </>}
                    </div>
                    {item.status === "APPROVED" && (
                      <Link
                        href={`/admin/disbursements?sourceType=SALES_PAYOUT&sourceId=${item.id}`}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 underline underline-offset-2"
                      >
                        <Send className="h-3 w-3" /> Send via AzamPay instead
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
