"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, ShieldCheck, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import WithdrawPanel from "@/components/owner-payouts/WithdrawPanel";
import { PayoutRow } from "@/components/owner-payouts/PayoutList";
import UpcomingFlowNotice from "@/components/owner-payouts/UpcomingFlowNotice";
import { STAGES, formatEat, formatTzs, sum, timeLeft, useNow, useOwnerPayouts } from "@/components/owner-payouts/shared";

type PayoutAccount = { id: number; type: string; provider: string; accountNumber: string; isVerified: boolean; isActive: boolean; isDefault: boolean };

const PROVIDER_NAMES: Record<string, string> = {
  vodacom: "M-Pesa",
  mpesa: "M-Pesa",
  airtel: "Airtel Money",
  yas: "Mixx by Yas",
  tigo: "Mixx by Yas",
  halotel: "HaloPesa",
  halopesa: "HaloPesa",
  azampesa: "AzamPesa",
};

function destinationLabel(account: PayoutAccount | undefined): string | null {
  if (!account) return null;
  const name = PROVIDER_NAMES[account.provider.toLowerCase()] ?? account.provider;
  return `${name} ***${account.accountNumber.replace(/\D/g, "").slice(-3)}`;
}

export default function PayoutsOverviewPage() {
  const { payouts, enabled, recoveryDue, loading, error, reload } = useOwnerPayouts();
  const now = useNow();
  const [account, setAccount] = useState<PayoutAccount | undefined>();

  useEffect(() => {
    apiClient
      .get<{ accounts: PayoutAccount[] }>("/api/owner/payouts/accounts")
      .then((res) => {
        const usable = (res.data?.accounts ?? []).filter((a) => a.isActive && a.isVerified && a.type === "MOBILE_MONEY");
        setAccount(usable.find((a) => a.isDefault) ?? usable[0]);
      })
      .catch(() => setAccount(undefined));
  }, []);

  const figures = useMemo(() => {
    const ready = payouts.filter((p) => p.stage === "READY");
    const unlocking = payouts.filter((p) => p.stage === "UNLOCKING" || p.stage === "WAITING");
    const nextUnlock = unlocking.map((p) => p.releaseAt).sort()[0];
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const paidThisMonth = payouts.filter((p) => p.stage === "PAID" && p.paidAt && new Date(p.paidAt) >= monthStart);
    return {
      ready,
      readyTotal: sum(payouts, ["READY"]),
      unlockingTotal: sum(payouts, ["UNLOCKING", "WAITING"]),
      unlockingCount: unlocking.length,
      nextUnlock,
      heldTotal: sum(payouts, ["ON_HOLD"]),
      heldCount: payouts.filter((p) => p.stage === "ON_HOLD").length,
      onTheWayTotal: sum(payouts, ["SENDING", "UNDER_REVIEW"]),
      onTheWayCount: payouts.filter((p) => p.stage === "SENDING" || p.stage === "UNDER_REVIEW").length,
      paidMonthTotal: paidThisMonth.reduce((t, p) => t + (Number(p.amount) || 0), 0),
      paidMonthCount: paidThisMonth.length,
    };
  }, [payouts]);

  const active = useMemo(
    () =>
      payouts
        .filter((p) => STAGES[p.stage].active)
        .sort((a, b) => new Date(a.releaseAt).getTime() - new Date(b.releaseAt).getTime())
        .slice(0, 4),
    [payouts]
  );

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading your payouts...
      </div>
    );
  }

  if (error) {
    return <p className="m-0 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">{error}</p>;
  }

  if (!enabled) return <UpcomingFlowNotice />;

  const destination = destinationLabel(account);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-sm font-medium text-slate-500">Ready to withdraw</p>
            <p className="m-0 mt-1 text-4xl font-bold tracking-tight tabular-nums text-slate-900 sm:text-5xl">{formatTzs(figures.readyTotal)}</p>
            <p className="m-0 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <span>
                {figures.ready.length} {figures.ready.length === 1 ? "stay" : "stays"}
              </span>
              <span aria-hidden>·</span>
              {destination ? (
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> Paid to {destination}
                </span>
              ) : (
                <Link href="/owner/payouts/account" className="font-semibold text-amber-700 no-underline hover:underline">
                  Add a verified payout account
                </Link>
              )}
            </p>
          </div>
          <div className="lg:max-w-md lg:text-right">
            <WithdrawPanel readyTotal={figures.readyTotal} readyCount={figures.ready.length} recoveryDue={recoveryDue} onDone={() => void reload()} />
          </div>
        </div>

        {recoveryDue > 0 && (
          <p className="m-0 mt-5 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {formatTzs(recoveryDue)} from an earlier refund is still owed. It is taken from your next withdrawal (policy 6.3.3), and our
            team reviews your payouts until it is cleared.
          </p>
        )}

        <dl className="m-0 mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Unlocking",
              value: formatTzs(figures.unlockingTotal),
              detail: figures.nextUnlock ? `Next ${formatEat(figures.nextUnlock)}, ${timeLeft(figures.nextUnlock, now)}` : "Nothing unlocking",
            },
            {
              label: "On its way",
              value: formatTzs(figures.onTheWayTotal),
              detail: figures.onTheWayCount ? `${figures.onTheWayCount} withdrawn, being paid` : "Nothing being paid",
            },
            {
              label: "On hold",
              value: formatTzs(figures.heldTotal),
              detail: figures.heldCount ? `${figures.heldCount} under review` : "Nothing on hold",
            },
            {
              label: "Paid this month",
              value: formatTzs(figures.paidMonthTotal),
              detail: `${figures.paidMonthCount} ${figures.paidMonthCount === 1 ? "payout" : "payouts"}`,
            },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl bg-slate-50 px-4 py-3.5">
              <dt className="text-xs font-medium text-slate-500">{tile.label}</dt>
              <dd className="m-0 mt-1 text-lg font-bold tabular-nums text-slate-900">{tile.value}</dd>
              <dd className="m-0 mt-0.5 truncate text-[11px] text-slate-500">{tile.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 px-5 py-4">
          <div>
            <h2 className="m-0 text-base font-bold text-slate-900">In progress</h2>
            <p className="m-0 mt-0.5 text-xs text-slate-500">The next stays to unlock, be withdrawn or be paid.</p>
          </div>
          <Link href="/owner/payouts/in-progress" className="inline-flex items-center gap-1 text-sm font-semibold text-[#02665e] no-underline hover:underline">
            See all <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {active.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-slate-500">
            <Wallet className="h-5 w-5 text-slate-400" aria-hidden />
            After a validated check-in, the stay appears here and is ready once payout checks pass.
          </div>
        ) : (
          <ul className="m-0 list-none divide-y divide-slate-100 p-0">
            {active.map((p) => (
              <PayoutRow key={p.bookingReference} payout={p} now={now} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
