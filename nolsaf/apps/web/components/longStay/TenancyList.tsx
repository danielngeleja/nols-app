"use client";

/**
 * Long stays for the landlord or the tenant: what needs them now, where each
 * stay stands, and the history. One component, worded for each side; every
 * status and deadline comes from the server.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClock, ArrowRight, BadgeCheck, CalendarCheck, CalendarRange, ChevronRight, ClipboardCheck, FileSignature, Home, KeyRound, Loader2, Search, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Side = "TENANT" | "LANDLORD";
type Item = {
  ref: string;
  status: string;
  homeTitle: string | null;
  otherPartyName: string | null;
  moveInDate: string | null;
  termMonths: number | null;
  endDate: string | null;
  confirmBy: string | null;
  paymentDueAt: string | null;
  leaseSigned: { tenant: boolean; landlord: boolean } | null;
  currency: string | null;
  monthlyRent: number | null;
  updatedAt: string;
};

const TONE: Record<string, string> = {
  OFFERED: "bg-amber-50 text-amber-800",
  ACCEPTED: "bg-sky-50 text-sky-800",
  AWAITING_PAYMENT: "bg-sky-50 text-sky-800",
  RESERVED: "bg-emerald-50 text-emerald-800",
  MOVE_IN: "bg-emerald-50 text-emerald-800",
  ACTIVE: "bg-[#02665e]/10 text-[#02665e]",
  ENDING: "bg-amber-50 text-amber-800",
  OVERDUE: "bg-red-50 text-red-700",
  DISPUTED: "bg-red-50 text-red-700",
  ENDED: "bg-slate-100 text-slate-600",
  CANCELLED: "bg-slate-100 text-slate-500",
};
const LABEL: Record<Side, Record<string, string>> = {
  LANDLORD: {
    OFFERED: "To confirm", ACCEPTED: "Lease to sign", AWAITING_PAYMENT: "Tenant paying", RESERVED: "Reserved", MOVE_IN: "Moving in",
    ACTIVE: "Let", ENDING: "Ending", OVERDUE: "Overdue", DISPUTED: "Under review", ENDED: "Ended", CANCELLED: "Closed",
  },
  TENANT: {
    OFFERED: "Waiting for landlord", ACCEPTED: "Lease to sign", AWAITING_PAYMENT: "To pay", RESERVED: "Reserved", MOVE_IN: "Moving in",
    ACTIVE: "Living there", ENDING: "Ending", OVERDUE: "Overdue", DISPUTED: "Under review", ENDED: "Ended", CANCELLED: "Closed",
  },
};

function dayLabel(iso: string | null) {
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}
function left(iso: string | null) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "time is up";
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `${h}h left` : `${Math.max(1, Math.round(ms / 60_000))}m left`;
}
function money(value: number | null, currency: string | null) {
  return value == null || !currency ? "" : `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
}

/** What the reader should do next on this stay, if anything. */
function nextStep(item: Item, side: Side): { text: string; urgent: boolean } | null {
  const s = item.status;
  if (side === "LANDLORD") {
    if (s === "OFFERED") return { text: `Confirm or decline, ${left(item.confirmBy)}`, urgent: true };
    if (s === "ACCEPTED") return item.leaseSigned?.landlord ? { text: "Waiting for the tenant to sign", urgent: false } : { text: "Read and sign the lease", urgent: true };
    if (s === "AWAITING_PAYMENT") return { text: `Tenant pays, ${left(item.paymentDueAt)}`, urgent: false };
    if (s === "MOVE_IN") return { text: "Confirm the balance and keys", urgent: true };
    if (s === "OVERDUE") return { text: "Confirm the tenant moved out", urgent: true };
    return null;
  }
  if (s === "OFFERED") return { text: `Landlord answers, ${left(item.confirmBy)}`, urgent: false };
  if (s === "ACCEPTED") return item.leaseSigned?.tenant ? { text: "Waiting for the landlord to sign", urgent: false } : { text: "Read and sign the lease", urgent: true };
  if (s === "AWAITING_PAYMENT") return { text: `Pay the first month, ${left(item.paymentDueAt)}`, urgent: true };
  if (s === "MOVE_IN") return { text: "Confirm the balance and keys", urgent: true };
  return null;
}

export default function TenancyList({ side, detailBase, intro, extra }: { side: Side; detailBase: string; intro: string; extra?: React.ReactNode }) {
  const [scope, setScope] = useState<"open" | "closed">("open");
  const [open, setOpen] = useState<Item[] | null>(null);
  const [closed, setClosed] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const base = side === "TENANT" ? "/api/customer" : "/api/owner";

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<{ items: Item[] }>(`${base}/long-stay/tenancies?scope=open`),
      apiClient.get<{ items: Item[] }>(`${base}/long-stay/tenancies?scope=closed`),
    ])
      .then(([a, b]) => { if (active) { setOpen(a.data.items); setClosed(b.data.items); } })
      .catch(() => { if (active) { setError("Could not load your long stays."); setOpen([]); setClosed([]); } });
    return () => { active = false; };
  }, [base]);

  const counts = useMemo(() => {
    const list = open ?? [];
    const n = (statuses: string[]) => list.filter((i) => statuses.includes(i.status)).length;
    return {
      first: n(["OFFERED"]),
      sign: n(["ACCEPTED", "AWAITING_PAYMENT"]),
      moving: n(["RESERVED", "MOVE_IN"]),
      living: n(["ACTIVE", "ENDING", "OVERDUE", "DISPUTED"]),
    };
  }, [open]);

  const needsYou = (open ?? []).filter((i) => nextStep(i, side)?.urgent);
  const shown = (scope === "open" ? open : closed) ?? [];
  const needle = q.trim().toLowerCase();
  const filtered = needle ? shown.filter((i) => `${i.homeTitle ?? ""} ${i.otherPartyName ?? ""}`.toLowerCase().includes(needle)) : shown;
  const loading = open === null;

  const tiles = side === "LANDLORD"
    ? [
      { label: "To confirm", value: counts.first, Icon: AlarmClock, hint: "within 24 hours", warn: counts.first > 0 },
      { label: "Lease and payment", value: counts.sign, Icon: FileSignature, hint: "signing or paying", warn: false },
      { label: "Moving in", value: counts.moving, Icon: KeyRound, hint: "paid, keys next", warn: false },
      { label: "Let", value: counts.living, Icon: Home, hint: "tenants living there", warn: false },
    ]
    : [
      { label: "Waiting for landlord", value: counts.first, Icon: AlarmClock, hint: "answers within 24 hours", warn: false },
      { label: "To sign or pay", value: counts.sign, Icon: FileSignature, hint: "your next step", warn: counts.sign > 0 },
      { label: "Moving in", value: counts.moving, Icon: KeyRound, hint: "paid and reserved", warn: false },
      { label: "Living there", value: counts.living, Icon: Home, hint: "your homes now", warn: false },
    ];

  return (
    <div id="tenancy-list" className="w-full py-2">
      <style>{`#tenancy-list, #tenancy-list * { box-sizing: border-box; }`}</style>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#02665e]">{side === "LANDLORD" ? "Monthly rentals" : "Your monthly stays"}</p>
          <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-slate-900">Long stays</h1>
          <p className="m-0 mt-1 max-w-2xl text-sm text-slate-600">{intro}</p>
          {extra}
        </div>
        {side === "LANDLORD" ? (
          <Link href="/owner/properties/approved" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 no-underline hover:bg-slate-50">
            <Home className="h-4 w-4" />My homes
          </Link>
        ) : (
          <Link href="/public/properties" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#02665e] px-3 text-[13px] font-semibold text-white no-underline hover:bg-[#014e47]">
            <Search className="h-4 w-4" />Find a home
          </Link>
        )}
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map(({ label, value, Icon, hint, warn }) => (
          <div key={label} className={`rounded-lg border border-solid bg-white px-3.5 py-3 ${warn ? "border-amber-200" : "border-slate-200"}`}>
            <p className="m-0 flex items-center gap-1.5 text-[12px] font-semibold text-slate-500"><Icon className={`h-3.5 w-3.5 ${warn ? "text-amber-600" : "text-[#02665e]"}`} />{label}</p>
            <p className={`m-0 mt-1 text-2xl font-bold tabular-nums ${warn ? "text-amber-700" : "text-slate-900"}`}>{loading ? "-" : value}</p>
            <p className="m-0 text-[11.5px] text-slate-400">{hint}</p>
          </div>
        ))}
      </div>

      {needsYou.length ? (
        <section className="mt-4 overflow-hidden rounded-lg border border-solid border-amber-200 bg-amber-50/50" aria-label="Needs you">
          <p className="m-0 border-0 border-b border-solid border-amber-100 px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-amber-800">Needs you now ({needsYou.length})</p>
          <ul className="m-0 list-none p-0">
            {needsYou.map((item) => (
              <li key={item.ref} className="border-0 border-t border-solid border-amber-100 first:border-t-0">
                <Link href={`${detailBase}/${item.ref}`} className="flex items-center gap-3 px-4 py-2.5 text-slate-900 no-underline hover:bg-amber-50">
                  <AlarmClock className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]"><b>{item.homeTitle || "Long stay"}</b><span className="text-slate-600"> · {nextStep(item, side)?.text}</span></span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-amber-700" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-0 border-b border-solid border-slate-200">
        <nav className="flex gap-5" aria-label="Long stays">
          {(["open", "closed"] as const).map((key) => {
            const n = (key === "open" ? open : closed)?.length;
            return (
              <button key={key} type="button" onClick={() => setScope(key)}
                className={`-mb-px inline-flex cursor-pointer items-center gap-1.5 border-0 border-b-2 border-solid bg-transparent px-0 pb-2.5 text-sm font-semibold [font-family:inherit] ${scope === key ? "border-[#02665e] text-[#02665e]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                {key === "open" ? "Open" : "History"}
                {n != null ? <span className={`rounded px-1.5 text-[11px] tabular-nums ${scope === key ? "bg-[#02665e]/10" : "bg-slate-100"}`}>{n}</span> : null}
              </button>
            );
          })}
        </nav>
        {shown.length > 5 ? (
          <label className="relative mb-2 flex h-8 w-full items-center sm:w-56">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search homes" aria-label="Search" className="h-8 w-full rounded-md border border-solid border-slate-300 bg-white pl-7 pr-2 text-[13px] outline-none focus:border-[#02665e]" />
          </label>
        ) : null}
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        {loading ? (
          <div className="grid min-h-28 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : error ? (
          <p className="m-0 p-5 text-sm text-red-700">{error}</p>
        ) : filtered.length === 0 ? (
          <EmptyState side={side} scope={scope} searching={Boolean(needle)} />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_20px] gap-3 border-0 border-b border-solid border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid">
              <span>Home</span><span>Stay</span><span>Status</span><span>Next</span><span />
            </div>
            <ul className="m-0 list-none p-0">
              {filtered.map((item) => {
                const step = nextStep(item, side);
                return (
                  <li key={item.ref} className="border-0 border-t border-solid border-slate-100 first:border-t-0">
                    <Link href={`${detailBase}/${item.ref}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-slate-900 no-underline hover:bg-slate-50 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_20px]">
                      <span className="col-start-1 row-start-1 min-w-0">
                        <span className="block truncate text-sm font-semibold">{item.homeTitle || "Long stay"}</span>
                        <span className="block truncate text-[12px] text-slate-500">
                          {item.otherPartyName ? `${side === "TENANT" ? "Landlord" : "Tenant"}: ${item.otherPartyName}` : side === "LANDLORD" ? "Tenant verified by NoLSAF" : "Landlord via NoLSAF"}
                        </span>
                      </span>
                      <span className="col-start-2 row-start-1 md:col-start-3">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${TONE[item.status] ?? "bg-slate-100 text-slate-600"}`}>{LABEL[side][item.status] ?? item.status}</span>
                      </span>
                      <span className="col-span-2 min-w-0 text-[12.5px] text-slate-600 md:col-span-1 md:col-start-2 md:row-start-1">
                        {item.termMonths ? <span className="inline-flex items-center gap-1"><CalendarRange className="h-3.5 w-3.5 text-slate-400" />{item.termMonths} months</span> : null}
                        <span className="block text-slate-500">{item.moveInDate ? `${dayLabel(item.moveInDate)}${item.endDate ? ` to ${dayLabel(item.endDate)}` : ""}` : ""}</span>
                        {item.monthlyRent ? <span className="block text-slate-400">{money(item.monthlyRent, item.currency)} a month</span> : null}
                      </span>
                      <span className={`col-span-2 text-[12.5px] md:col-span-1 md:col-start-4 md:row-start-1 ${step?.urgent ? "font-semibold text-amber-800" : "text-slate-500"}`}>
                        {step ? step.text : item.status === "ACTIVE" ? <span className="inline-flex items-center gap-1 text-[#02665e]"><BadgeCheck className="h-3.5 w-3.5" />All in order</span> : item.status === "RESERVED" ? <span className="inline-flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5" />Move-in {dayLabel(item.moveInDate)}</span> : ""}
                      </span>
                      <ChevronRight className="hidden h-4 w-4 text-slate-300 md:col-start-5 md:row-start-1 md:block" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <HowItWorks side={side} />
    </div>
  );
}

function EmptyState({ side, scope, searching }: { side: Side; scope: "open" | "closed"; searching: boolean }) {
  if (searching) return <p className="m-0 p-8 text-center text-sm text-slate-500">No long stays match your search.</p>;
  if (scope === "closed") return <p className="m-0 p-8 text-center text-sm text-slate-500">Ended and closed stays show here.</p>;
  return (
    <div className="px-5 py-10 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#02665e]/10 text-[#02665e]"><CalendarRange className="h-6 w-6" /></span>
      <p className="m-0 mt-3 text-[15px] font-bold text-slate-900">{side === "LANDLORD" ? "No reservations yet" : "No long stays yet"}</p>
      <p className="m-0 mx-auto mt-1 max-w-md text-[13px] text-slate-500">
        {side === "LANDLORD"
          ? "Tenants reserve your homes at the terms you listed, and you confirm within 24 hours. A home takes reservations once a NoLSAF Sales Partner has inspected it."
          : "Find a home for a few months, reserve it at its listed terms, and pay only the first month through NoLSAF after you sign."}
      </p>
      {side === "LANDLORD" ? (
        <Link href="/owner/properties/approved" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-[#014e47]"><Home className="h-4 w-4" />Check my homes</Link>
      ) : (
        <Link href="/public/properties" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-[#014e47]"><Search className="h-4 w-4" />Find a home</Link>
      )}
    </div>
  );
}

function HowItWorks({ side }: { side: Side }) {
  const steps = side === "LANDLORD"
    ? [
      { Icon: ClipboardCheck, title: "Inspected", text: "A NoLSAF Sales Partner checks the home once a year." },
      { Icon: AlarmClock, title: "Reserved", text: "A verified tenant reserves; you confirm in 24 hours." },
      { Icon: Wallet, title: "Paid", text: "The tenant pays the first month to NoLSAF after both sign." },
      { Icon: KeyRound, title: "Moved in", text: "The balance comes to you; NoLSAF pays the first month out." },
    ]
    : [
      { Icon: CalendarCheck, title: "Reserve", text: "At the listed terms. Nothing is charged." },
      { Icon: FileSignature, title: "Sign", text: "Once the landlord confirms and your ID is verified." },
      { Icon: Wallet, title: "Pay", text: "The first month and fee through NoLSAF, within 48 hours." },
      { Icon: KeyRound, title: "Move in", text: "Pay the balance to the landlord when you get the keys." },
    ];
  return (
    <section className="mt-5 rounded-lg border border-solid border-slate-200 bg-white px-4 py-3.5" aria-label="How long stays work">
      <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-slate-400">How it works</p>
      <ol className="m-0 mt-2 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(({ Icon, title, text }, i) => (
          <li key={title} className="flex items-start gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#02665e]/10 text-[12px] font-bold text-[#02665e]">{i + 1}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-[13px] font-semibold text-slate-900"><Icon className="h-3.5 w-3.5 text-[#02665e]" />{title}</span>
              <span className="block text-[12.5px] text-slate-500">{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
