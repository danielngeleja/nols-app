"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Eye, KeyRound, Loader2, PauseCircle, RefreshCw, ShieldAlert, ShieldCheck, UserCheck, Wallet } from "lucide-react";
import api from "@/lib/apiClient";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";

type Overview = {
  money: {
    firstPayoutDone: boolean; paidCount: number; paidLast30Days: number; readyToWithdraw: number;
    unlockingCount: number; onHoldCount: number; readyCount: number;
    waitingApproval: { count: number; total: number; oldestAt: string | null };
    recoveryDue: number;
  };
  nextRoute: { lane: "AUTO" | "MANUAL"; reason: string | null; amount: number } | null;
  safety: {
    wallet: { provider: string; ending: string | null; holderName: string | null; nameMatchesOwner: boolean } | null;
    walletWaitUntil: string | null; contactWaitUntil: string | null;
    codeLocked: boolean; wrongCodes: number; failedLast14Days: number;
  };
  controls: {
    available: boolean;
    hold: { at: string; reason: string | null } | null;
    alwaysReview: { reason: string | null } | null;
  };
  recent: Array<{
    reference: string; amount: number; status: string; route: "AUTO" | "MANUAL"; approvedAutomatically: boolean;
    createdAt: string; paidAt: string | null; note: string | null;
  }>;
};
type Action = "HOLD" | "RELEASE" | "ALWAYS_REVIEW_ON" | "ALWAYS_REVIEW_OFF";

const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam",
});
const eat = (value: string) => `${dateTime.format(new Date(value))} EAT`;
function waited(from: string | null): string | null {
  if (!from) return null;
  const hours = Math.floor((Date.now() - new Date(from).getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
}
const statusLabel: Record<string, { text: string; tone: string }> = {
  REQUESTED: { text: "Waiting for approval", tone: "bg-amber-50 text-amber-900" },
  APPROVED: { text: "Approved", tone: "bg-sky-50 text-sky-800" },
  BATCHED: { text: "Queued", tone: "bg-sky-50 text-sky-800" },
  AUTHORIZED: { text: "Queued", tone: "bg-sky-50 text-sky-800" },
  SUBMITTED: { text: "Sending", tone: "bg-sky-50 text-sky-800" },
  PROCESSING: { text: "Sending", tone: "bg-sky-50 text-sky-800" },
  PAID: { text: "Paid", tone: "bg-emerald-50 text-emerald-800" },
  FAILED: { text: "Failed", tone: "bg-rose-50 text-rose-800" },
  SECURITY_REVIEW: { text: "Security review", tone: "bg-rose-50 text-rose-800" },
};
const providerNames: Record<string, string> = {
  vodacom: "Vodacom M-Pesa", mpesa: "Vodacom M-Pesa", airtel: "Airtel Money", tigo: "Tigo Pesa",
  azampesa: "AzamPesa", halopesa: "HaloPesa",
};
const provider = (value: string) => providerNames[value.toLowerCase()] ?? value.replace(/\b\w/g, (c) => c.toUpperCase());

const actionCopy: Record<Action, { title: string; button: string; hint: string; danger?: boolean }> = {
  HOLD: { title: "Pause this owner's payouts", button: "Pause payouts", danger: true,
    hint: "Takes effect at once. The owner cannot withdraw, and approved payouts are kept out of every batch until the pause is lifted." },
  RELEASE: { title: "Lift the payout pause", button: "Lift pause",
    hint: "Needs your finance code. The owner can withdraw again and held payouts go back into batches." },
  ALWAYS_REVIEW_ON: { title: "Always check this owner's payouts", button: "Always check",
    hint: "Takes effect at once. Every payout goes to a person, nothing is sent automatically." },
  ALWAYS_REVIEW_OFF: { title: "Stop always checking", button: "Stop always checking",
    hint: "Needs your finance code. Clean payouts can go automatically again." },
};

function Tile({ label, value, sub, tone = "text-slate-950" }: { label: string; value: string; sub?: string | null; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-solid border-slate-200 px-3 py-2.5">
      <p className="m-0 text-xs font-medium text-slate-600">{label}</p>
      <p className={`m-0 mt-1 text-lg font-semibold tabular-nums leading-tight ${tone}`}>{value}</p>
      {sub ? <p className="m-0 mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

type SignalState = "ok" | "check" | "alert" | "info";
const signalTone: Record<SignalState, { tile: string; pill: string }> = {
  ok: { tile: "bg-emerald-50 text-emerald-700", pill: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  check: { tile: "bg-amber-50 text-amber-700", pill: "bg-amber-50 text-amber-900 ring-amber-200" },
  alert: { tile: "bg-rose-50 text-rose-700", pill: "bg-rose-50 text-rose-800 ring-rose-200" },
  info: { tile: "bg-[#eaf4f0] text-[#28645a]", pill: "bg-slate-50 text-slate-700 ring-slate-200" },
};

/** One safety signal: icon tile, what it is (with a note under it), and a status pill. */
function Signal({ icon: Icon, label, state, status, note }: {
  icon: typeof Wallet; label: string; state: SignalState; status: string; note?: string | null;
}) {
  const tone = signalTone[state];
  return (
    <li className="flex min-w-0 items-start gap-3 py-3">
      <span className={`grid size-8 shrink-0 place-items-center rounded-md ${tone.tile}`}><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-[13px] font-semibold text-slate-900">{label}</span>
          <span className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone.pill}`}>{status}</span>
        </div>
        {note ? <p className="m-0 mt-0.5 text-xs leading-5 text-slate-600">{note}</p> : null}
      </div>
    </li>
  );
}

export default function OwnerPayoutPanel({ ownerId }: { ownerId: number }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<Overview>(`/api/admin/owners/${ownerId}/payout-overview`);
      setData(data);
    } catch {
      setError("Could not load this owner's payouts.");
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!pending || reason.trim().length < 10) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<{ controls: Overview["controls"] }>(`/api/admin/owners/${ownerId}/payout-controls`, { action: pending, reason: reason.trim() });
      setData((current) => current ? { ...current, controls: res.data.controls } : current);
      setPending(null);
      setReason("");
      void load();
    } catch (cause: any) {
      const body = cause?.response?.data;
      setActionError(body?.require2fa
        ? "Enter your finance code in the window that opened, then press the button again."
        : body?.error || "Could not save the change.");
    } finally {
      setBusy(false);
    }
  }

  const c = data?.controls;

  return (
    <section aria-labelledby="owner-payouts-title" className="min-w-0 rounded-lg border border-solid border-slate-200 bg-white">
      <FinanceGrantPanel showTrigger={false} listenForRequired />
      <header className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
        <h3 id="owner-payouts-title" className="m-0 flex items-center gap-2.5 text-base font-semibold text-slate-950">
          <span className="grid size-8 place-items-center rounded-md bg-[#eaf4f0] text-[#28645a]"><Wallet className="size-4" aria-hidden /></span>Payouts
        </h3>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh payouts"
          className="grid size-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:text-[#02665e] disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </header>

      {error ? <p role="alert" className="m-0 px-4 py-3 text-xs text-red-700">{error} <button type="button" onClick={() => void load()} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-red-800 underline">Try again</button></p> : null}
      {!data && loading ? <p role="status" className="m-0 flex items-center gap-2 px-4 py-3 text-xs text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Loading payouts</p> : null}

      {data ? (
        <div className="grid gap-3 p-4">
          {c?.hold ? (
            <div className="flex items-start gap-2.5 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-900">
              <PauseCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 text-[13px]"><strong>Payouts paused</strong> since {eat(c.hold.at)}.{c.hold.reason ? <span className="block text-xs text-rose-800">Reason: {c.hold.reason}</span> : null}</div>
            </div>
          ) : null}
          {c?.alwaysReview ? (
            <div className="flex items-start gap-2.5 rounded-md border border-solid border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900">
              <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 text-[13px]"><strong>Every payout is checked by a person.</strong>{c.alwaysReview.reason ? <span className="block text-xs text-amber-800">Reason: {c.alwaysReview.reason}</span> : null}</div>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Ready to withdraw" value={tzs(data.money.readyToWithdraw)}
              sub={[data.money.unlockingCount ? `${data.money.unlockingCount} unlocking` : null, data.money.onHoldCount ? `${data.money.onHoldCount} on hold` : null].filter(Boolean).join(" · ") || null} />
            <Tile label="Waiting for approval" value={data.money.waitingApproval.count ? tzs(data.money.waitingApproval.total) : "None"}
              tone={data.money.waitingApproval.count ? "text-amber-800" : "text-slate-950"}
              sub={data.money.waitingApproval.count ? `${data.money.waitingApproval.count} withdrawal${data.money.waitingApproval.count === 1 ? "" : "s"}, oldest waiting ${waited(data.money.waitingApproval.oldestAt)}` : null} />
            <Tile label="Paid in the last 30 days" value={tzs(data.money.paidLast30Days)}
              sub={data.money.firstPayoutDone ? `${data.money.paidCount} payout${data.money.paidCount === 1 ? "" : "s"} in total` : "No payout yet"} />
            <Tile label="Owed back from refunds" value={data.money.recoveryDue > 0 ? tzs(data.money.recoveryDue) : "Nothing"}
              tone={data.money.recoveryDue > 0 ? "text-rose-800" : "text-slate-950"}
              sub={data.money.recoveryDue > 0 ? "Taken from the next withdrawal" : null} />
          </div>

          <div className="rounded-md border border-solid border-slate-200 px-3 py-2.5">
            <p className="m-0 text-xs font-medium text-slate-600">Next payout</p>
            {data.nextRoute ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold ${data.nextRoute.lane === "AUTO" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                  {data.nextRoute.lane === "AUTO" ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Clock3 className="size-3.5" aria-hidden />}
                  {data.nextRoute.lane === "AUTO" ? "Sent automatically" : "Checked by a person"}
                </span>
                <span className="text-[13px] text-slate-700">
                  for {tzs(data.nextRoute.amount)}{data.nextRoute.reason ? `: ${data.nextRoute.reason}` : ""}
                </span>
              </div>
            ) : <p className="m-0 mt-1 text-[13px] text-slate-700">Nothing is ready to withdraw right now.</p>}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {(() => {
              const s = data.safety;
              const waiting = Boolean(s.walletWaitUntil || s.contactWaitUntil);
              const states: SignalState[] = [
                !s.wallet ? "check" : s.wallet.nameMatchesOwner ? "ok" : "check",
                waiting ? "check" : "ok",
                s.codeLocked ? "alert" : s.wrongCodes ? "check" : "ok",
                s.failedLast14Days ? "alert" : "ok",
              ];
              const toCheck = states.filter((st) => st !== "ok").length;
              return (
                <div className="min-w-0 rounded-md border border-solid border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-4 text-[#28645a]" aria-hidden />
                      <p className="m-0 text-sm font-semibold text-slate-950">Safety signals</p>
                    </div>
                    <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${toCheck ? signalTone.check.pill : signalTone.ok.pill}`}>
                      {toCheck ? `${toCheck} to check` : "All clear"}
                    </span>
                  </div>

                  {/* The wallet itself: identity of where the money goes. */}
                  <div className="flex min-w-0 items-center gap-3 border-0 border-b border-solid border-slate-100 bg-[#f7faf9] px-4 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white text-[#28645a] ring-1 ring-inset ring-[#dce8e3]"><Wallet className="size-4" aria-hidden /></span>
                    {s.wallet ? (
                      <div className="min-w-0">
                        <p className="m-0 truncate text-[13px] font-semibold text-slate-950">
                          {provider(s.wallet.provider)}{s.wallet.ending ? <span className="font-normal text-slate-600"> · ending in <span className="font-mono tabular-nums">{s.wallet.ending}</span></span> : null}
                        </p>
                        <p className="m-0 mt-0.5 truncate text-xs text-slate-600">Holder: <span className="font-medium text-slate-800">{s.wallet.holderName || "Not returned by the provider"}</span></p>
                      </div>
                    ) : <p className="m-0 text-[13px] font-semibold text-amber-800">No verified wallet yet</p>}
                  </div>

                  <ul className="m-0 list-none divide-y divide-slate-100 px-4 py-0">
                    {s.wallet ? (
                      <Signal icon={UserCheck} label="Holder name matches owner" state={states[0]}
                        status={s.wallet.nameMatchesOwner ? "Match" : "No match"}
                        note={s.wallet.nameMatchesOwner ? "Automatic first payouts are allowed to this wallet." : "A first payout to this wallet always goes to a person."} />
                    ) : null}
                    <Signal icon={Clock3} label="Security wait" state={states[1]} status={waiting ? "Active" : "None"}
                      note={[s.walletWaitUntil ? `Wallet change, until ${eat(s.walletWaitUntil)}` : null,
                        s.contactWaitUntil ? `Phone or email change, until ${eat(s.contactWaitUntil)}` : null].filter(Boolean).join(". ") || "No recent wallet or contact change."} />
                    <Signal icon={KeyRound} label="Withdrawal code" state={states[2]}
                      status={s.codeLocked ? "Locked" : s.wrongCodes ? `${s.wrongCodes} of 3 wrong` : "OK"}
                      note={s.codeLocked ? "Locked after 3 wrong codes. Unlock it only after checking the owner's identity." : s.wrongCodes ? "Locks at 3 wrong codes." : "No wrong codes entered."} />
                    <Signal icon={AlertTriangle} label="Failed payouts" state={states[3]} status={String(s.failedLast14Days)}
                      note={s.failedLast14Days ? "In the last 14 days. Check the wallet before the next payout." : "None in the last 14 days."} />
                  </ul>
                  {s.codeLocked ? (
                    <div className="border-0 border-t border-solid border-slate-100 px-4 py-2.5">
                      <Link href="/admin/disbursements/owner-payouts" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">Unlock in Owner payouts <ArrowRight className="size-3.5" aria-hidden /></Link>
                    </div>
                  ) : null}
                </div>
              );
            })()}

            {(() => {
              const available = Boolean(c?.available);
              const controls = [
                {
                  key: "hold", icon: PauseCircle, title: "Pause payouts", on: Boolean(c?.hold),
                  onText: "Paused", offText: "Not paused",
                  what: "Stops withdrawals and keeps approved payouts out of every batch.",
                  action: (c?.hold ? "RELEASE" : "HOLD") as Action,
                },
                {
                  key: "review", icon: ShieldAlert, title: "Always check payouts", on: Boolean(c?.alwaysReview),
                  onText: "On", offText: "Off",
                  what: "Every payout goes to a person. Nothing is sent automatically.",
                  action: (c?.alwaysReview ? "ALWAYS_REVIEW_OFF" : "ALWAYS_REVIEW_ON") as Action,
                },
              ];
              return (
                <div className="min-w-0 rounded-md border border-solid border-slate-200 bg-white">
                  <div className="border-0 border-b border-solid border-slate-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="size-4 shrink-0 text-[#28645a]" aria-hidden />
                      <p className="m-0 text-sm font-semibold text-slate-950">Admin controls</p>
                    </div>
                    <p className="m-0 mt-1 flex items-center gap-1.5 text-xs text-slate-500"><KeyRound className="size-3.5 shrink-0" aria-hidden />Placing is instant. Lifting needs your finance code.</p>
                  </div>

                  <ul className="m-0 list-none divide-y divide-slate-100 p-0">
                    {controls.map((ctl) => {
                      const Icon = ctl.icon;
                      const isPending = pending === ctl.action;
                      const danger = ctl.key === "hold";
                      return (
                        <li key={ctl.key} className="px-4 py-3.5">
                          {/* Stacked on purpose: this card often sits in a narrow column, and a
                              button beside the text squeezed the copy into one word per line. */}
                          <div className="flex min-w-0 items-center gap-3">
                            <span className={`grid size-8 shrink-0 place-items-center rounded-md ${ctl.on ? (danger ? signalTone.alert.tile : signalTone.check.tile) : "bg-slate-50 text-slate-500"}`}><Icon className="size-4" aria-hidden /></span>
                            <span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-900">{ctl.title}</span>
                            <span className={`shrink-0 whitespace-nowrap rounded-sm px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ctl.on ? (danger ? signalTone.alert.pill : signalTone.check.pill) : signalTone.info.pill}`}>
                              {ctl.on ? ctl.onText : ctl.offText}
                            </span>
                          </div>
                          <p className="m-0 mt-2 text-xs leading-5 text-slate-600">{ctl.what}</p>
                          {!isPending ? (
                            <button type="button" disabled={!available || pending !== null}
                              onClick={() => { setPending(ctl.action); setReason(""); setActionError(null); }}
                              className={`mt-3 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid px-3 text-xs font-semibold box-border disabled:cursor-not-allowed disabled:opacity-45 ${
                                ctl.on ? "border-slate-300 bg-white text-slate-800 hover:border-[#02665e] hover:text-[#02665e]"
                                  : danger ? "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                                  : "border-[#b8d9d1] bg-white text-[#215b50] hover:bg-[#eaf4f0]"}`}>
                              <Icon className="size-3.5" aria-hidden />{actionCopy[ctl.action].button}
                            </button>
                          ) : null}

                          {isPending ? (
                            <div className="mt-3 grid gap-2 rounded-md bg-[#f7faf9] p-3 ring-1 ring-inset ring-[#dce8e3]">
                              <p className="m-0 text-xs leading-5 text-slate-700">{actionCopy[ctl.action].hint}</p>
                              <label htmlFor="owner-payout-control-reason" className="text-xs font-semibold text-slate-800">Reason <span className="font-normal text-slate-500">(saved in the audit log)</span></label>
                              <textarea id="owner-payout-control-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3}
                                placeholder="What prompted this, in a sentence"
                                className="w-full resize-y rounded-md border border-solid border-slate-300 bg-white px-2.5 py-2 text-[13px] text-slate-900 box-border focus:border-[#02665e] focus:outline-none" />
                              <p className="m-0 text-right text-[11px] tabular-nums text-slate-500">{reason.trim().length < 10 ? `${10 - reason.trim().length} more characters needed` : `${reason.trim().length} / 300`}</p>
                              {actionError ? <p role="alert" className="m-0 text-xs text-red-700">{actionError}</p> : null}
                              <div className="flex flex-wrap justify-end gap-2">
                                <button type="button" onClick={() => { setPending(null); setReason(""); setActionError(null); }} disabled={busy}
                                  className="min-h-8 cursor-pointer rounded-md border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">Cancel</button>
                                <button type="button" onClick={() => void submit()} disabled={busy || reason.trim().length < 10}
                                  className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border-0 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${actionCopy[ctl.action].danger ? "bg-rose-700 hover:bg-rose-800" : "bg-[#02665e] hover:bg-[#014d47]"}`}>
                                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}Confirm: {actionCopy[ctl.action].button.toLowerCase()}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  <div className="border-0 border-t border-solid border-slate-100 px-4 py-2.5">
                    {available ? (
                      <p className="m-0 text-xs text-slate-500">Every change is saved in the audit log with your reason.</p>
                    ) : (
                      <p className="m-0 flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />Available after the owner payout controls database update is applied.</p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="min-w-0 rounded-md border border-solid border-slate-200">
            <p className="m-0 px-3 pt-2.5 text-xs font-medium text-slate-600">Recent withdrawals</p>
            {data.recent.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="px-3 py-2 font-medium">Reference</th>
                      <th className="px-3 py-2 font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Route</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((row) => {
                      const status = statusLabel[row.status] ?? { text: row.status.charAt(0) + row.status.slice(1).toLowerCase().replace(/_/g, " "), tone: "bg-slate-100 text-slate-700" };
                      return (
                        <tr key={row.reference} className="border-0 border-t border-solid border-slate-100 align-top">
                          <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.reference}</td>
                          <td className="px-3 py-2 font-semibold tabular-nums text-slate-900">{tzs(row.amount)}</td>
                          <td className="px-3 py-2 text-slate-700">{row.route === "AUTO" ? "Automatic" : "By a person"}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${status.tone}`}>{status.text}</span>
                            {row.paidAt ? <span className="block text-xs text-slate-500">Paid {eat(row.paidAt)}</span> : null}
                            {row.note ? <span className="block text-xs text-rose-700">{row.note}</span> : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">{eat(row.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="m-0 px-3 pb-2.5 pt-1 text-[13px] text-slate-600">No withdrawals yet.</p>}
          </div>
        </div>
      ) : null}
    </section>
  );
}
