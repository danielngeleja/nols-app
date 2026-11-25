"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Clock3, Home, RotateCcw, type LucideIcon } from "lucide-react";
import { formatEat, readableDestination, timeLeft, type OwnerPayout, type OwnerWithdrawal } from "./shared";

/**
 * One statement-style feed of what happened to the owner's money: stays that
 * became ready (+), withdrawals (-), and transfers that came back (+). Plain
 * rows, newest first, so it reads like a mobile money history.
 */
type Item = {
  key: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  amount: number;
  sign: "+" | "-" | "";
  tone: "in" | "out" | "pending";
  at: number;
};

const amountText = (value: number) => Math.round(value).toLocaleString("en-US");

export function isWithdrawalActive(w: OwnerWithdrawal): boolean {
  return w.state === "PREPARING" || w.state === "CHECKING" || w.state === "SENDING";
}

function withdrawalItems(w: OwnerWithdrawal): Item[] {
  const to = readableDestination(w.destination);
  const requested = w.requestedAt ? formatEat(w.requestedAt) : "";
  const detail = {
    PREPARING: `Requested · ${requested}`,
    CHECKING: `Being checked · ${requested}`,
    SENDING: `Sending · ${requested}`,
    PAID: `Paid · ${w.paidAt ? formatEat(w.paidAt) : requested}`,
    RETURNED: `Not delivered · ${requested}`,
  }[w.state];
  const items: Item[] = [{
    key: `w-${w.reference}`,
    icon: ArrowUpRight,
    title: `Withdrawal to ${to}`,
    detail,
    amount: w.amount,
    sign: "-",
    tone: isWithdrawalActive(w) ? "pending" : "out",
    at: new Date(w.requestedAt ?? 0).getTime(),
  }];
  if (w.state === "RETURNED") {
    const at = w.returnedAt ?? w.requestedAt;
    items.push({
      key: `r-${w.reference}`,
      icon: RotateCcw,
      title: "Back in Ready",
      detail: `Transfer not delivered${at ? ` · ${formatEat(at)}` : ""}`,
      amount: w.amount,
      sign: "+",
      tone: "in",
      at: new Date(at ?? 0).getTime() + 1,
    });
  }
  return items;
}

function stayItem(p: OwnerPayout, now: number): Item | null {
  if (p.stage === "CANCELLED") return null;
  const place = p.propertyTitle || "Your property";
  const guest = p.guestName ? `${p.guestName} · ` : "";
  const amount = Number(p.originalAmount ?? p.amount ?? 0);
  if (p.stage === "UNLOCKING" || p.stage === "WAITING" || p.stage === "ON_HOLD") {
    const detail = p.stage === "ON_HOLD"
      ? "On hold while we check it"
      : p.stage === "WAITING"
        ? `Waiting: ${p.reason ?? "a final check"}`
        : p.rule === "CHECKIN_CONFIRMED"
          ? "Unlocks after check-in checks"
          : `Unlocks ${formatEat(p.releaseAt)}, ${timeLeft(p.releaseAt, now)}`;
    return { key: `s-${p.bookingReference}`, icon: Clock3, title: place, detail: `${guest}${detail}`, amount, sign: "", tone: "pending", at: new Date(p.releaseAt).getTime() };
  }
  const readyAt = p.availableAt ?? p.releaseAt;
  return {
    key: `s-${p.bookingReference}`, icon: Home, title: place,
    detail: `${guest}ready ${formatEat(readyAt)}`,
    amount, sign: "+", tone: "in", at: new Date(readyAt).getTime(),
  };
}

const TONE = {
  in: "text-[#02665e]",
  out: "text-slate-500",
  pending: "text-slate-400",
};

export default function OwnerActivity({ payouts, withdrawals, now, limit = 6 }: {
  payouts: OwnerPayout[]; withdrawals: OwnerWithdrawal[]; now: number; limit?: number;
}) {
  const items = [
    ...withdrawals.flatMap(withdrawalItems),
    ...payouts.map((p) => stayItem(p, now)).filter((item): item is Item => !!item),
  ].sort((a, b) => b.at - a.at).slice(0, limit);

  return (
    <section className="rounded-lg border border-solid border-slate-200 bg-white px-5 sm:px-7">
      <div className="flex items-center justify-between pb-1 pt-4">
        <h2 className="m-0 text-sm font-semibold text-slate-900">Activity</h2>
        <Link href="/owner/payouts/history" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">
          See all <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="m-0 py-8 text-center text-sm text-slate-400">Your earnings appear here after a guest&apos;s validated check-in.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <li key={item.key} className={`flex items-center justify-between gap-4 py-3.5 ${index < items.length - 1 ? "border-0 border-b border-solid border-slate-100" : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-50 ${item.tone === "in" ? "text-[#02665e]" : "text-slate-500"}`}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-medium text-slate-900">{item.title}</p>
                    <p className="m-0 truncate text-xs text-slate-400">{item.detail}</p>
                  </div>
                </div>
                <span className={`shrink-0 text-sm font-semibold tabular-nums ${TONE[item.tone]}`}>
                  {item.sign === "-" ? "−" : item.sign}{amountText(item.amount)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
