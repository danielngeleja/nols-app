"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, BadgeCheck, CheckCircle2, CircleDollarSign, Clock3, Info, KeyRound, Loader2,
  Lock, Send, ShieldCheck, Smartphone, Wallet, Zap,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { codeLabel, statusTone } from "@/components/SalesShell";
import SalesPayoutDestination from "@/components/sales/SalesPayoutDestination";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Payout = {
  id: number;
  referenceNumber: string;
  requestedAmount: number;
  netPaidAmount: number | null;
  withholdingTaxAmount: number;
  currency: string;
  status: string;
  lane: "AUTO" | "REVIEW" | null;
  payoutMethod: string;
  payoutAccount: string | null;
  requestedAt: string;
  paidAt: string | null;
  rejectionReason: string | null;
  receiptUrl: string | null;
  _count: { items: number };
};

type WithdrawalStatus = {
  available: number;
  count: number;
  currency: string;
  minimum: number;
  withholdingTaxRate: number;
  destination: string | null;
  automatic?: { enabled: boolean; limit: number };
  blocked: { code: string; message: string; availableAfter?: string } | null;
};

type CodeSent = { challengeRef: string; sentTo: string; channel: "SMS" | "EMAIL"; total: number; count: number; destination: string; expiresAt: string };
type Result = { referenceNumber: string; lane: "AUTO" | "REVIEW"; message: string; total: number; destination: string };
type SalesMe = { payout: { name: string | null; method: string | null; accountMasked: string | null } };
type Filter = "ALL" | "OPEN" | "PAID" | "CLOSED";

const OPEN = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING"];
const CLOSED = ["REJECTED", "CANCELLED", "FAILED"];
const card = "rounded-lg border border-solid border-slate-200 bg-white";
const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500";

function money(value: number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function eat(value: string | null, withTime = true) {
  if (!value) return "–";
  const text = new Date(value).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: "Africa/Dar_es_Salaam",
  });
  return withTime ? `${text} EAT` : text;
}

function eatMonth(value: string | Date) {
  return new Date(value).toLocaleDateString("en-GB", { month: "2-digit", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function laneLabel(payout: Payout) {
  if (payout.lane === "AUTO") return { text: "Automatic", tone: "bg-emerald-50 text-emerald-800", Icon: Zap };
  if (payout.lane === "REVIEW") return { text: "Checked by our team", tone: "bg-amber-50 text-amber-800", Icon: ShieldCheck };
  return { text: "Finance review", tone: "bg-slate-100 text-slate-600", Icon: ShieldCheck };
}

/** Code, check, sent: where this withdrawal is right now. */
function Steps({ stage }: { stage: 0 | 1 | 2 | 3 }) {
  const steps = [
    { label: "Code", Icon: KeyRound },
    { label: "Policy check", Icon: ShieldCheck },
    { label: "On its way", Icon: Send },
  ];
  return (
    <ol className="m-0 flex list-none items-center gap-1.5 p-0" aria-label="Withdrawal progress">
      {steps.map((step, i) => {
        const done = stage > i + 1 || (stage === 3 && i === 2);
        const active = stage === i + 1;
        return (
          <Fragment key={step.label}>
            {i > 0 ? <li aria-hidden className={`h-px w-4 sm:w-6 ${stage > i ? "bg-[#02665e]" : "bg-slate-200"}`} /> : null}
            <li className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${done ? "text-[#02665e]" : active ? "text-slate-900" : "text-slate-400"}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-md ${done ? "bg-[#02665e] text-white" : active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400"}`}>
                {done ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <step.Icon className="h-3 w-3" aria-hidden />}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function Figure({ icon: Icon, label, value, note, tone = "text-slate-900" }: { icon: typeof Wallet; label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3.5">
      <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><Icon className="h-3.5 w-3.5" aria-hidden /> {label}</p>
      <p className={`m-0 mt-1 truncate text-xl font-bold tabular-nums tracking-tight ${tone}`} title={value}>{value}</p>
      <p className="m-0 truncate text-[12px] text-slate-500">{note}</p>
    </div>
  );
}

export default function SalesPayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [status, setStatus] = useState<WithdrawalStatus | null>(null);
  const [me, setMe] = useState<SalesMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [cancelling, setCancelling] = useState<{ id: number; reason: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  // The protection note opens only on tap; a tap outside or Escape closes it.
  useEffect(() => {
    if (!infoOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setInfoOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setInfoOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [infoOpen]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [payoutResult, statusResult, meResult] = await Promise.allSettled([
        apiClient.get("/api/sales/payouts", { params: { pageSize: 100 } }),
        apiClient.get("/api/sales/payouts/withdrawal"),
        apiClient.get("/api/sales/me"),
      ]);
      if (payoutResult.status === "fulfilled") setPayouts(payoutResult.value.data?.payouts || []);
      if (statusResult.status === "fulfilled") setStatus(statusResult.value.data || null);
      if (meResult.status === "fulfilled") setMe(meResult.value.data || null);
      const failed = [payoutResult, statusResult, meResult].find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) setError(failed.reason?.response?.data?.error || "Some payout details could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (sent) codeRef.current?.focus(); }, [sent]);
  // Live countdown while a code is open.
  useEffect(() => {
    if (!sent) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sent]);

  const secondsLeft = sent ? Math.max(0, Math.floor((new Date(sent.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = Boolean(sent) && secondsLeft === 0;

  const figures = useMemo(() => {
    const thisMonth = eatMonth(new Date());
    let onItsWay = 0;
    let openCount = 0;
    let paidMonth = 0;
    let paidAll = 0;
    let paidCount = 0;
    for (const p of payouts) {
      if (OPEN.includes(p.status)) { onItsWay += Number(p.netPaidAmount ?? p.requestedAmount); openCount++; }
      if (p.status === "PAID") {
        const net = Number(p.netPaidAmount ?? p.requestedAmount);
        paidAll += net;
        paidCount++;
        if (p.paidAt && eatMonth(p.paidAt) === thisMonth) paidMonth += net;
      }
    }
    return { onItsWay, openCount, paidMonth, paidAll, paidCount };
  }, [payouts]);

  const visible = useMemo(() => payouts.filter((p) =>
    filter === "ALL" ? true : filter === "OPEN" ? OPEN.includes(p.status) : filter === "PAID" ? p.status === "PAID" : CLOSED.includes(p.status),
  ), [payouts, filter]);

  const sendCode = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await apiClient.post("/api/sales/payouts/withdrawal/code", {});
      setSent(response.data);
      setNow(Date.now());
      setCode("");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not send your withdrawal code.");
      setSent(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!sent || expired) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await apiClient.post("/api/sales/payouts/withdrawal/confirm", { challengeRef: sent.challengeRef, code });
      setResult(response.data);
      setSent(null);
      setCode("");
      await load();
    } catch (cause: any) {
      const data = cause?.response?.data;
      const left = typeof data?.attemptsRemaining === "number" ? ` ${data.attemptsRemaining} ${data.attemptsRemaining === 1 ? "try" : "tries"} left.` : "";
      setError(`${data?.error || "Could not confirm the withdrawal."}${left}`);
      if (data?.code && data.code !== "INVALID_CODE") {
        setSent(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!cancelling) return;
    if (cancelling.reason.trim().length < 5) {
      setError("Enter a cancellation reason of at least 5 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/payouts/${cancelling.id}/cancel`, { reason: cancelling.reason.trim() });
      setCancelling(null);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not cancel the request.");
    } finally {
      setBusy(false);
    }
  };

  const available = status?.available ?? 0;
  const minimum = status?.minimum ?? 50_000;
  const blocked = status?.blocked ?? null;
  const frozen = blocked?.code === "ON_HOLD" || blocked?.code === "OTP_LOCKED";
  const stage: 0 | 1 | 2 | 3 = result ? (result.lane === "AUTO" ? 3 : 2) : sent ? 1 : 0;
  const auto = status?.automatic;

  const filters: Array<{ key: Filter; label: string; count: number }> = [
    { key: "ALL", label: "All", count: payouts.length },
    { key: "OPEN", label: "On its way", count: payouts.filter((p) => OPEN.includes(p.status)).length },
    { key: "PAID", label: "Paid", count: payouts.filter((p) => p.status === "PAID").length },
    { key: "CLOSED", label: "Closed", count: payouts.filter((p) => CLOSED.includes(p.status)).length },
  ];

  return (
    <SalesShell>
      <style jsx global>{`#sales-payouts, #sales-payouts * { box-sizing: border-box; }`}</style>
      <div id="sales-payouts" className="space-y-4">
        <SalesPageHeader
          icon={Wallet}
          title="Payouts"
          description="Withdraw your available earnings with a one-time code. Clean withdrawals are sent automatically; anything unusual is checked by our team first."
        />

        {/* Key figures, one joined panel */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 lg:grid-cols-4" aria-label="Payout figures">
          <Figure icon={CircleDollarSign} label="Available to withdraw" value={money(available)} note={status?.count ? `${status.count} earning${status.count === 1 ? "" : "s"} ready` : "Nothing ready yet"} tone="text-[#02665e]" />
          <Figure icon={Clock3} label="On its way" value={money(figures.onItsWay)} note={figures.openCount ? `${figures.openCount} withdrawal in progress` : "Nothing in progress"} />
          <Figure icon={CheckCircle2} label="Paid this month" value={money(figures.paidMonth)} note="Net, after any tax" />
          <Figure icon={BadgeCheck} label="Paid in total" value={money(figures.paidAll)} note={`${figures.paidCount} withdrawal${figures.paidCount === 1 ? "" : "s"}`} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* Withdraw */}
          <article className={`${card} flex min-w-0 flex-col`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-1.5">
                <h2 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><Send className="h-4 w-4 text-[#02665e]" aria-hidden /> Withdraw</h2>
                <div ref={infoRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setInfoOpen((v) => !v)}
                    aria-expanded={infoOpen}
                    aria-controls="withdraw-protection"
                    aria-label="How withdrawals are protected"
                    title="How withdrawals are protected"
                    className={`grid h-6 w-6 place-items-center rounded-md border-0 ${infoOpen ? "bg-[#02665e]/10 text-[#02665e]" : "bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {infoOpen ? (
                    <div
                      id="withdraw-protection"
                      role="dialog"
                      aria-label="How withdrawals are protected"
                      className="absolute left-0 top-8 z-20 w-[min(20rem,calc(100vw-3rem))] rounded-lg border border-solid border-slate-200 bg-white p-4 shadow-lg"
                    >
                      <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-slate-900"><ShieldCheck className="h-4 w-4 text-[#02665e]" aria-hidden /> How withdrawals are protected</p>
                      <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
                        {[
                          { Icon: KeyRound, title: "A code for every withdrawal", text: "It only works for that amount and your verified account." },
                          {
                            Icon: Zap,
                            title: auto?.enabled ? `Automatic up to ${money(auto.limit)}` : "Checked before sending",
                            text: auto?.enabled ? "Clean withdrawals are sent without waiting for anyone." : "Our team approves each withdrawal before it is sent.",
                          },
                          { Icon: ShieldCheck, title: "Your first withdrawal is checked", text: "So are large amounts and anything unusual." },
                          { Icon: Lock, title: "A broken rule pauses withdrawals", text: "Until our team completes its review." },
                        ].map(({ Icon, title, text }) => (
                          <li key={title} className="flex items-start gap-2.5">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><Icon className="h-3 w-3" aria-hidden /></span>
                            <span className="min-w-0">
                              <span className="block text-[12px] font-semibold text-slate-800">{title}</span>
                              <span className="block text-[12px] text-slate-500">{text}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
              <Steps stage={stage} />
            </div>

            <div className="flex flex-1 flex-col p-5">
              {loading && !status ? (
                <div className="space-y-3" aria-busy="true">
                  <div className="h-9 w-48 animate-pulse rounded-md bg-slate-100" />
                  <div className="h-4 w-64 animate-pulse rounded-md bg-slate-100" />
                </div>
              ) : (
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 text-[12px] text-slate-500">You can withdraw</p>
                    <p className="m-0 mt-0.5 text-3xl font-bold tracking-tight tabular-nums text-slate-900">{money(available)}</p>
                  </div>
                  {status?.destination ? (
                    <p className="m-0 inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600">
                      <Smartphone className="h-3.5 w-3.5 text-slate-400" aria-hidden /> to <span className="font-semibold text-slate-800">{status.destination}</span>
                    </p>
                  ) : null}
                </div>
              )}

              {available > 0 && available < minimum ? (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#02665e] transition-[width] duration-500" style={{ width: `${Math.min(100, (available / minimum) * 100)}%` }} />
                  </div>
                  <p className="m-0 mt-1.5 text-[12px] text-slate-500">{money(Math.max(0, minimum - available))} more to reach the {money(minimum)} minimum</p>
                </div>
              ) : null}

              {/* State: blocked, result, code entry, or ready */}
              <div className="mt-4">
                {result ? (
                  <div className={`rounded-md border border-solid px-4 py-3 ${result.lane === "AUTO" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                    <p className="m-0 flex items-center gap-2 text-[13px] font-semibold">
                      {result.lane === "AUTO" ? <Zap className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                      {money(result.total)} to {result.destination}
                    </p>
                    <p className="m-0 mt-1 text-[13px]">{result.message}</p>
                    <p className="m-0 mt-1.5 font-mono text-[11px] opacity-70">{result.referenceNumber}</p>
                  </div>
                ) : sent ? (
                  <div className="rounded-md border border-solid border-slate-200 bg-slate-50 p-4">
                    <p className="m-0 text-[13px] text-slate-700">
                      We sent a code by {sent.channel === "SMS" ? "SMS" : "email"} to <span className="font-semibold">{sent.sentTo}</span> to withdraw{" "}
                      <span className="font-semibold">{money(sent.total)}</span> to <span className="font-semibold">{sent.destination}</span>.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label htmlFor="withdraw-code" className="sr-only">Withdrawal code</label>
                      <input
                        id="withdraw-code"
                        ref={codeRef}
                        value={code}
                        disabled={expired}
                        onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
                        onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="••••••"
                        className="h-11 w-44 rounded-md border border-solid border-slate-300 bg-white px-3 text-center font-mono text-lg tracking-[0.45em] outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15 disabled:bg-slate-100"
                      />
                      {expired ? (
                        <button type="button" onClick={() => void sendCode()} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-60">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Send a new code
                        </button>
                      ) : (
                        <button type="button" onClick={() => void confirm()} disabled={busy || code.length !== 6} className="inline-flex h-11 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-50">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />} Confirm withdrawal
                        </button>
                      )}
                      <button type="button" onClick={() => { setSent(null); setCode(""); setError(""); }} className="inline-flex h-11 items-center rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                        Cancel
                      </button>
                    </div>
                    <p className={`m-0 mt-2 text-[12px] ${expired ? "font-medium text-rose-700" : "text-slate-500"}`}>
                      {expired
                        ? "This code has expired."
                        : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}. It works once. NoLSAF staff will never ask for it.`}
                    </p>
                  </div>
                ) : blocked ? (
                  <p className={`m-0 flex items-start gap-2 rounded-md px-3 py-2.5 text-[13px] ${frozen ? "bg-rose-50 text-rose-800" : "bg-slate-50 text-slate-700"}`}>
                    {frozen ? <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />}
                    <span>{blocked.message}{blocked.availableAfter ? ` Available from ${eat(blocked.availableAfter)}.` : ""}</span>
                  </p>
                ) : null}
              </div>

              {!sent ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={loading || busy || Boolean(blocked)}
                    onClick={() => void sendCode()}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-5 text-sm font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                    {busy ? "Sending code" : result ? "Withdraw again" : `Withdraw ${available > 0 ? money(available) : ""}`.trim()}
                  </button>
                  {status?.withholdingTaxRate ? <span className="text-[12px] text-slate-500">{status.withholdingTaxRate}% withholding tax is deducted on approval</span> : null}
                </div>
              ) : null}

              {error ? <p className="m-0 mt-3 flex items-start gap-2 text-[13px] text-rose-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null}
            </div>
          </article>

          <article className={`${card} min-w-0 self-start p-5`}>
            <SalesPayoutDestination current={me?.payout} loading={loading} onSaved={() => void load()} />
          </article>
        </section>

        {/* History */}
        <section className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-2.5">
            <h2 className="m-0 text-sm font-semibold text-slate-900">Withdrawal history</h2>
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter withdrawals">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border-0 px-2.5 text-[12px] font-semibold ${filter === f.key ? "bg-slate-900 text-white" : "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}
                >
                  {f.label}
                  <span className={`rounded px-1 text-[11px] tabular-nums ${filter === f.key ? "bg-white/15" : "bg-slate-100"}`}>{f.count}</span>
                </button>
              ))}
            </div>
          </div>
          {loading && !payouts.length ? (
            <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
          ) : visible.length === 0 ? (
            <div className="p-10 text-center">
              <p className="m-0 text-sm font-medium text-slate-800">{payouts.length ? "Nothing in this view" : "Your first withdrawal will show here"}</p>
              <p className="m-0 mt-1 text-[13px] text-slate-500">{payouts.length ? "Try another filter." : "Once earnings are available, withdraw them above."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={`${th} pl-4`}>Reference</th>
                    <th className={th}>Requested</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={`${th} text-right`}>Net paid</th>
                    <th className={th}>Destination</th>
                    <th className={th}>Handling</th>
                    <th className={th}>Status</th>
                    <th className={`${th} pr-4 text-right`}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((payout) => {
                    const handling = laneLabel(payout);
                    const isCancelling = cancelling?.id === payout.id;
                    return (
                      <Fragment key={payout.id}>
                        <tr className="border-0 border-t border-solid border-slate-100 align-top hover:bg-slate-50/60">
                          <td className="py-3 pl-4 pr-3">
                            <p className="m-0 font-mono text-[12px] font-semibold text-slate-900">{payout.referenceNumber}</p>
                            <p className="m-0 text-[11px] text-slate-500">{payout._count.items} earning{payout._count.items === 1 ? "" : "s"}</p>
                          </td>
                          <td className="px-3 py-3 text-[12px] text-slate-600">
                            {eat(payout.requestedAt)}
                            {payout.paidAt ? <span className="block text-[11px] text-emerald-700">Paid {eat(payout.paidAt, false)}</span> : null}
                          </td>
                          <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums text-slate-900">{money(payout.requestedAmount, payout.currency)}</td>
                          <td className="px-3 py-3 text-right text-[13px] tabular-nums text-slate-700">
                            {payout.netPaidAmount == null ? <span className="text-slate-400">Pending</span> : money(payout.netPaidAmount, payout.currency)}
                            {payout.withholdingTaxAmount ? <span className="block text-[11px] text-slate-400">tax {money(payout.withholdingTaxAmount, payout.currency)}</span> : null}
                          </td>
                          <td className="px-3 py-3 text-[12px] text-slate-600">{payout.payoutMethod} · {payout.payoutAccount || "masked"}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${handling.tone}`}><handling.Icon className="h-3 w-3" aria-hidden />{handling.text}</span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${statusTone(payout.status)}`}>
                              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{codeLabel(payout.status)}
                            </span>
                            {payout.rejectionReason ? <p className="m-0 mt-1 max-w-[220px] text-[11px] text-rose-700">{payout.rejectionReason}</p> : null}
                          </td>
                          <td className="py-3 pl-3 pr-4 text-right">
                            {payout.receiptUrl ? (
                              <a href={payout.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#02665e] no-underline hover:underline">
                                Receipt <ArrowRight className="h-3 w-3" aria-hidden />
                              </a>
                            ) : payout.status === "REQUESTED" && payout.lane !== "AUTO" ? (
                              <button type="button" onClick={() => setCancelling(isCancelling ? null : { id: payout.id, reason: "" })} className="h-7 rounded-md border border-solid border-rose-200 bg-white px-2 text-[11px] font-semibold text-rose-700 hover:bg-rose-50">
                                Cancel
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {isCancelling ? (
                          <tr className="bg-slate-50">
                            <td colSpan={8} className="px-4 pb-3 pt-1">
                              <div className="flex flex-wrap gap-2">
                                <input
                                  value={cancelling.reason}
                                  onChange={(e) => setCancelling({ id: payout.id, reason: e.target.value })}
                                  placeholder="Reason to cancel this request"
                                  className="h-8 min-w-0 flex-1 rounded-md border border-solid border-slate-300 bg-white px-2 text-[13px] outline-none focus:border-[#02665e]"
                                />
                                <button type="button" onClick={() => void cancel()} disabled={busy} className="h-8 rounded-md border-0 bg-rose-600 px-3 text-[12px] font-semibold text-white disabled:opacity-60">Cancel request</button>
                                <button type="button" onClick={() => setCancelling(null)} className="h-8 rounded-md border border-solid border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700">Keep</button>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </SalesShell>
  );
}
