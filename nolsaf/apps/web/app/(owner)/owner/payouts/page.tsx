"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock3, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import WithdrawPanel from "@/components/owner-payouts/WithdrawPanel";
import OwnerActivity, { isWithdrawalActive } from "@/components/owner-payouts/OwnerActivity";
import UpcomingFlowNotice from "@/components/owner-payouts/UpcomingFlowNotice";
import { PROVIDER_NAMES, formatEat, formatTzs, readableDestination, sum, timeLeft, useNow, useOwnerPayouts } from "@/components/owner-payouts/shared";

type PayoutAccount = { id: number; type: string; provider: string; accountNumber: string; isVerified: boolean; isActive: boolean; isDefault: boolean };

function destinationLabel(account: PayoutAccount | undefined): string | null {
  if (!account) return null;
  const name = PROVIDER_NAMES[account.provider.toLowerCase()] ?? account.provider;
  return `${name} ***${account.accountNumber.replace(/\D/g, "").slice(-3)}`;
}

const amountText = (value: number) => Math.round(value).toLocaleString("en-US");

export default function PayoutsOverviewPage() {
  const { payouts, withdrawals, enabled, recoveryDue, dailyLimit, dailyRemaining, dailyResetAt, loading, error, reload } = useOwnerPayouts();
  const now = useNow();
  const [account, setAccount] = useState<PayoutAccount | undefined>();
  const [accountLoaded, setAccountLoaded] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ accounts: PayoutAccount[] }>("/api/owner/payouts/accounts")
      .then((res) => {
        const usable = (res.data?.accounts ?? []).filter((a) => a.isActive && a.isVerified && a.type === "MOBILE_MONEY");
        setAccount(usable.find((a) => a.isDefault) ?? usable[0]);
      })
      .catch(() => setAccount(undefined))
      .finally(() => setAccountLoaded(true));
  }, []);

  const figures = useMemo(() => {
    const ready = payouts.filter((p) => p.stage === "READY");
    const unlocking = payouts.filter((p) => p.stage === "UNLOCKING" || p.stage === "WAITING");
    const nextUnlock = unlocking
      .filter((p) => p.stage === "UNLOCKING" && p.rule !== "CHECKIN_CONFIRMED")
      .sort((a, b) => new Date(a.releaseAt).getTime() - new Date(b.releaseAt).getTime())[0];
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const paidThisMonth = payouts.filter((p) => Number(p.paidAmount ?? 0) > 0 && p.paidAt && new Date(p.paidAt) >= monthStart);
    return {
      readyTotal: sum(payouts, ["READY"]),
      readyCount: ready.length,
      unlockingTotal: sum(payouts, ["UNLOCKING", "WAITING"]),
      nextUnlock,
      heldTotal: sum(payouts, ["ON_HOLD"]),
      inProgressTotal: payouts.reduce((t, p) => t + (Number(p.inProgressAmount) || 0), 0),
      paidMonthTotal: paidThisMonth.reduce((t, p) => t + Number(p.paidAmount ?? 0), 0),
    };
  }, [payouts]);

  useEffect(() => {
    if (loading || !enabled || window.location.hash !== "#withdraw") return;
    const frame = window.requestAnimationFrame(() => document.getElementById("withdraw")?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [loading, enabled]);

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading your payouts...
      </div>
    );
  }

  if (error) {
    return <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">{error}</p>;
  }

  if (!enabled) return <UpcomingFlowNotice />;

  const destination = destinationLabel(account);
  const active = withdrawals.filter(isWithdrawalActive);
  const onTheWay = active.length ? active.reduce((t, w) => t + Number(w.amount || 0), 0) : figures.inProgressTotal;
  const latest = withdrawals[0];

  // One short line under the balance: the single most useful fact right now.
  const status = (() => {
    if (active.length) {
      return { icon: ArrowUpRight, text: `${amountText(active[0].amount)} on its way to ${readableDestination(active[0].destination)}` };
    }
    if (latest?.state === "RETURNED" && figures.readyTotal > 0) {
      return { icon: RotateCcw, text: `Returned${latest.returnedAt ? ` ${formatEat(latest.returnedAt)}` : ""} · ready again` };
    }
    if (figures.nextUnlock) {
      return { icon: Clock3, text: `Next ${amountText(Number(figures.nextUnlock.amount ?? 0))} ${timeLeft(figures.nextUnlock.releaseAt, now)}` };
    }
    if (figures.readyTotal <= 0 && figures.unlockingTotal <= 0) {
      return { icon: Clock3, text: "Earnings arrive after a validated check-in" };
    }
    return null;
  })();

  // Where the money sits, as one bar. Only stages holding money take space.
  const segments = [
    { label: "Ready", value: figures.readyTotal, bar: "bg-[#02665e]" },
    { label: "Unlocking", value: figures.unlockingTotal, bar: "bg-emerald-200",
      note: figures.nextUnlock ? formatEat(figures.nextUnlock.releaseAt).replace(/,.*$/, "") : undefined },
    { label: "On its way", value: onTheWay, bar: "bg-sky-300" },
    { label: "On hold", value: figures.heldTotal, bar: "bg-amber-300" },
  ];
  const barTotal = segments.reduce((t, s) => t + s.value, 0);

  return (
    <div className="space-y-3">
      <section id="withdraw" className="scroll-mt-6 rounded-lg border border-solid border-slate-200 bg-white px-5 pb-6 pt-7 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
          <div className="min-w-0">
            <p className="m-0 text-xs font-medium text-slate-500">Available</p>
            <p className="m-0 mt-1.5 flex items-baseline gap-2 leading-none">
              <span className="text-5xl font-bold tracking-tight tabular-nums text-slate-900">{amountText(figures.readyTotal)}</span>
              <span className="text-base font-medium text-slate-400">TZS</span>
            </p>
            {status && (
              <p className="m-0 mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500">
                <status.icon className="h-3.5 w-3.5 text-[#02665e]" aria-hidden /> {status.text}
              </p>
            )}
          </div>

          {destination || !accountLoaded ? (
            <WithdrawPanel
              readyTotal={figures.readyTotal}
              readyCount={figures.readyCount}
              recoveryDue={recoveryDue}
              dailyLimit={dailyLimit}
              dailyRemaining={dailyRemaining}
              dailyResetAt={dailyResetAt}
              destination={destination}
              onDone={() => void reload()}
            />
          ) : (
            <Link
              href="/owner/payouts/account"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014d47]"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden /> Add a payout account
            </Link>
          )}
        </div>

        <div className="mt-8">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            {barTotal > 0 && segments.filter((s) => s.value > 0).map((s) => (
              <div key={s.label} className={s.bar} style={{ width: `${(s.value / barTotal) * 100}%` }} />
            ))}
          </div>
          <dl className="m-0 mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
            {segments.map((s) => (
              <div key={s.label} className={`flex items-center gap-1.5 ${s.value > 0 ? "text-slate-500" : "text-slate-300"}`}>
                <span className={`h-2 w-2 rounded-sm ${s.value > 0 ? s.bar : "bg-slate-200"}`} aria-hidden />
                <dt>{s.label}</dt>
                <dd className={`m-0 tabular-nums ${s.value > 0 ? "font-semibold text-slate-900" : ""}`}>{amountText(s.value)}</dd>
                {s.value > 0 && s.note ? <dd className="m-0 text-slate-400">· {s.note}</dd> : null}
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-slate-400">
              <dt>Paid this month</dt>
              <dd className="m-0 tabular-nums">{amountText(figures.paidMonthTotal)}</dd>
            </div>
          </dl>
          {recoveryDue > 0 && (
            <p className="m-0 mt-3 text-xs text-amber-800">
              {formatTzs(recoveryDue)} from an earlier refund is taken from your next withdrawal.
            </p>
          )}
        </div>
      </section>

      <OwnerActivity payouts={payouts} withdrawals={withdrawals} now={now} />
    </div>
  );
}
