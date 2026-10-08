"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BedDouble, Building2, Check, ChevronRight, ClipboardList, Gift, HandHeart, MessageSquareText, RefreshCw, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { DateTile, GroupStaysBand, StatusTabs, fmtDay, humanize, nightsBetween, placeName, tzs } from "@/components/owner-groups/GroupStaysChrome";

type Claim = {
  id: number;
  groupBookingId: number;
  propertyId: number;
  offeredPricePerNight: number;
  discountPercent: number | null;
  specialOffers: string | null;
  notes: string | null;
  totalAmount: number;
  currency: string;
  status: string;
  reviewedAt: string | null;
  createdAt: string;
  groupBooking: {
    id: number;
    headcount: number;
    roomsNeeded: number;
    toRegion: string;
    checkIn: string | null;
    checkOut: string | null;
    user: { id: number; name: string; email: string; phone: string | null } | null;
  };
  property: { id: number; title: string; type: string; regionName: string };
};

const STATUS: Record<string, { label: string; chip: string; tile: string; note: string }> = {
  PENDING: { label: "Waiting", chip: "bg-amber-50 text-amber-800 ring-amber-200", tile: "bg-amber-500 text-white", note: "Sent. NoLSAF has not opened it yet." },
  REVIEWING: { label: "In review", chip: "bg-sky-50 text-sky-800 ring-sky-200", tile: "bg-sky-600 text-white", note: "NoLSAF is comparing offers for this group." },
  ACCEPTED: { label: "Accepted", chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", tile: "bg-[#02665e] text-white", note: "Your offer won. The stay appears under Assigned to me." },
  REJECTED: { label: "Not chosen", chip: "bg-rose-50 text-rose-700 ring-rose-200", tile: "bg-rose-100 text-rose-600", note: "Another offer was chosen for this group." },
  WITHDRAWN: { label: "Withdrawn", chip: "bg-slate-100 text-slate-600 ring-slate-200", tile: "bg-slate-500 text-white", note: "You withdrew this offer." },
};
const statusOf = (s: string) => STATUS[s.toUpperCase()] ?? { label: humanize(s), chip: "bg-slate-100 text-slate-600 ring-slate-200", tile: "bg-slate-500 text-white", note: "" };
const TAB_ORDER = ["PENDING", "REVIEWING", "ACCEPTED", "REJECTED", "WITHDRAWN"];

export default function OwnerMyClaimsPage() {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  // Load every claim once and filter here, so each tab keeps its true count.
  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await apiClient.get("/api/owner/group-stays/claims/my-claims");
      setClaims(response.data?.items || []);
    } catch (err: any) {
      setClaims([]);
      setError(err?.response?.data?.error || "Your claims could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => claims ?? [], [claims]);
  const count = (key: string) => list.filter((c) => c.status.toUpperCase() === key).length;
  const tabs = [
    { key: "", label: "All", count: list.length },
    ...TAB_ORDER.filter((key) => count(key) > 0 || ["PENDING", "ACCEPTED"].includes(key)).map((key) => ({ key, label: STATUS[key].label, count: count(key) })),
  ];
  const shown = status ? list.filter((c) => c.status.toUpperCase() === status) : list;
  const current = shown.find((c) => c.id === open) ?? shown[0] ?? null;
  const active = count("PENDING") + count("REVIEWING");
  const decided = count("ACCEPTED") + count("REJECTED");
  const winRate = decided ? Math.round((count("ACCEPTED") / decided) * 100) : null;
  const wonValue = list.filter((c) => c.status.toUpperCase() === "ACCEPTED").reduce((sum, c) => sum + Number(c.totalAmount || 0), 0);

  return (
    <div className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <GroupStaysBand
        title="My claims"
        subtitle="Every offer you sent for a group stay, where it stands, and what you offered."
        actions={
          <Link href="/owner/group-stays/claims" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5eead4] px-4 text-sm font-bold text-[#012a26] no-underline hover:bg-[#8ff3e1]">
            <HandHeart className="h-4 w-4" aria-hidden /> Make a new offer
          </Link>
        }
        stats={[
          { label: "Offers sent", value: claims === null ? "…" : list.length, hint: "all time" },
          { label: "Still open", value: claims === null ? "…" : active, hint: "waiting or in review", tone: active ? "text-amber-200" : "text-white/50" },
          { label: "Won", value: claims === null ? "…" : count("ACCEPTED"), hint: winRate === null ? "no decisions yet" : `${winRate}% of decided offers`, tone: "text-[#5eead4]" },
          { label: "Value won", value: claims === null ? "…" : tzs(wonValue), hint: "accepted offers" },
        ]}
      />

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 text-xs font-bold text-white"><RefreshCw className="h-3.5 w-3.5" /> Try again</button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="px-3 sm:px-4"><StatusTabs tabs={tabs} value={status} onChange={setStatus} /></div>
      </section>

      {claims === null ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]" aria-busy="true">
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 rounded-2xl border border-solid border-slate-200 bg-white p-4">
                <div className="h-14 w-12 rounded-xl bg-slate-100" />
                <div className="flex-1 space-y-2"><div className="h-3.5 w-48 rounded-full bg-slate-100" /><div className="h-3 w-72 max-w-full rounded-full bg-slate-50" /></div>
              </div>
            ))}
          </div>
          <div className="hidden h-[420px] rounded-3xl bg-slate-100 lg:block" />
        </div>
      ) : shown.length === 0 ? (
        <section className="flex flex-col items-center rounded-2xl border border-solid border-slate-200 bg-white px-6 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><ClipboardList className="h-6 w-6" aria-hidden /></span>
          <p className="m-0 mt-3 text-sm font-bold text-slate-900">{status ? `No ${statusOf(status).label.toLowerCase()} offers` : "You have not sent any offers yet"}</p>
          <p className="m-0 mt-1 max-w-sm text-xs leading-5 text-slate-500">Groups looking for a place to stay are listed under Open to claim. Send a price and NoLSAF picks the best offer.</p>
          {!status && (
            <Link href="/owner/group-stays/claims" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#02665e] px-4 text-xs font-bold text-white no-underline hover:bg-[#014d47]">
              See stays open to claim <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <ul className="m-0 list-none space-y-3 p-0">
            {shown.map((claim) => {
              const st = statusOf(claim.status);
              const gb = claim.groupBooking;
              const nights = nightsBetween(gb.checkIn, gb.checkOut);
              const isOpen = current?.id === claim.id;
              const stage = stageOf(claim.status);
              return (
                <li key={claim.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(claim.id)}
                    aria-pressed={isOpen}
                    className={`flex w-full items-center gap-4 rounded-2xl border border-solid bg-white p-4 text-left transition ${isOpen ? "border-[#02665e] shadow-[0_14px_34px_-24px_rgba(1,42,38,0.7)] ring-1 ring-[#02665e]" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    <DateTile iso={gb.checkIn} tone={st.tile} />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[15px] font-bold text-slate-900">Group of {gb.headcount} in {placeName(gb.toRegion)}</p>
                      <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        <span className="inline-flex min-w-0 items-center gap-1"><Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{claim.property.title}</span></span>
                        <span>{gb.roomsNeeded} room{gb.roomsNeeded === 1 ? "" : "s"} · {nights ?? "?"} night{nights === 1 ? "" : "s"}</span>
                      </p>
                      <div className="mt-2.5 flex items-center gap-1" aria-label={`Stage: ${st.label}`}>
                        {[0, 1, 2].map((step) => (
                          <span key={step} className={`h-1 w-8 rounded-full ${step < stage.reached ? stage.bar : "bg-slate-200"}`} />
                        ))}
                        <span className={`ml-2 text-[11px] font-bold ${stage.text}`}>{st.label}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="m-0 text-base font-extrabold tabular-nums text-slate-900">{tzs(claim.totalAmount, claim.currency)}</p>
                      <p className="m-0 text-[11px] text-slate-400">sent {fmtDay(claim.createdAt)}</p>
                    </div>
                    <ChevronRight className={`h-4 w-4 shrink-0 transition ${isOpen ? "text-[#02665e]" : "text-slate-300"}`} aria-hidden />
                  </button>
                  {isOpen && <div className="mt-3 lg:hidden"><OfferSheet claim={claim} /></div>}
                </li>
              );
            })}
          </ul>

          {current && (
            <aside className="hidden lg:sticky lg:top-24 lg:block">
              <OfferSheet claim={current} />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

/** Three steps every offer walks: sent, reviewed, decided. */
function stageOf(raw: string) {
  const s = raw.toUpperCase();
  if (s === "ACCEPTED") return { reached: 3, bar: "bg-[#02665e]", text: "text-emerald-700" };
  if (s === "REJECTED") return { reached: 3, bar: "bg-rose-400", text: "text-rose-600" };
  if (s === "WITHDRAWN") return { reached: 1, bar: "bg-slate-400", text: "text-slate-500" };
  if (s === "REVIEWING") return { reached: 2, bar: "bg-sky-500", text: "text-sky-700" };
  return { reached: 1, bar: "bg-amber-500", text: "text-amber-700" };
}

function OfferSheet({ claim }: { claim: Claim }) {
  const st = statusOf(claim.status);
  const s = claim.status.toUpperCase();
  const gb = claim.groupBooking;
  const nights = nightsBetween(gb.checkIn, gb.checkOut);
  const discount = claim.discountPercent && claim.discountPercent > 0 ? claim.discountPercent : 0;
  const nightly = discount ? claim.offeredPricePerNight * (1 - discount / 100) : claim.offeredPricePerNight;
  const offers = claim.specialOffers ? claim.specialOffers.split(",").map((x) => x.trim()).filter(Boolean) : [];
  const decision = s === "ACCEPTED" ? "Won" : s === "REJECTED" ? "Not chosen" : s === "WITHDRAWN" ? "Withdrawn" : "Decision";
  const steps = [
    { label: "Sent", date: claim.createdAt, done: true },
    { label: "In review", date: null as string | null, done: ["REVIEWING", "ACCEPTED", "REJECTED"].includes(s) },
    { label: decision, date: claim.reviewedAt, done: ["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(s) },
  ];
  const headTone = s === "ACCEPTED" ? "text-[#5eead4]" : s === "REJECTED" ? "text-rose-300" : s === "REVIEWING" ? "text-sky-300" : s === "WITHDRAWN" ? "text-white/60" : "text-amber-300";

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-40px_rgba(1,42,38,0.75)] ring-1 ring-slate-200">
      <header className="bg-[#012a26] px-6 pb-5 pt-5 text-white">
        <div className="flex items-center justify-between gap-3">
          <span className={`text-[11px] font-bold uppercase tracking-[0.16em] ${headTone}`}>{st.label}</span>
          <span className="text-[11px] text-white/50">Your offer</span>
        </div>
        <h2 className="m-0 mt-2 text-xl font-bold leading-tight">Group of {gb.headcount} in {placeName(gb.toRegion)}</h2>
        <p className="m-0 mt-0.5 text-xs text-white/60">{fmtDay(gb.checkIn)} to {fmtDay(gb.checkOut)}{nights ? ` · ${nights} night${nights === 1 ? "" : "s"}` : ""}</p>
        <p className="m-0 mt-4 text-[32px] font-extrabold leading-none tracking-tight tabular-nums text-[#5eead4]">{tzs(claim.totalAmount, claim.currency)}</p>
        <p className="m-0 mt-1 text-xs text-white/60">{tzs(nightly, claim.currency)} a room a night</p>
      </header>

      <ol className="m-0 grid list-none grid-cols-3 border-0 border-b border-solid border-slate-100 p-0">
        {steps.map((step, index) => (
          <li key={step.label} className={`px-4 py-3 ${index > 0 ? "border-0 border-l border-solid border-slate-100" : ""}`}>
            <span className={`flex items-center gap-1.5 text-xs font-bold ${step.done ? "text-slate-900" : "text-slate-400"}`}>
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${step.done ? "bg-[#02665e] text-white" : "bg-slate-100"}`}>{step.done ? <Check className="h-2.5 w-2.5" aria-hidden /> : null}</span>
              {step.label}
            </span>
            <span className="mt-0.5 block text-[11px] text-slate-400">{step.date ? fmtDay(step.date) : step.done ? "Done" : "Pending"}</span>
          </li>
        ))}
      </ol>

      <div className="space-y-5 p-6">
        {st.note ? <p className="m-0 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs leading-5 text-slate-600">{st.note}</p> : null}

        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">How the total adds up</p>
          <dl className="m-0 mt-2 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Price a room a night</dt><dd className="m-0 font-semibold tabular-nums text-slate-800">{tzs(claim.offeredPricePerNight, claim.currency)}</dd></div>
            {discount ? <div className="flex justify-between gap-3"><dt className="text-slate-500">Group discount {discount}%</dt><dd className="m-0 font-semibold tabular-nums text-emerald-700">&minus;{tzs(claim.offeredPricePerNight - nightly, claim.currency)}</dd></div> : null}
            <div className="flex justify-between gap-3"><dt className="text-slate-500">{gb.roomsNeeded} room{gb.roomsNeeded === 1 ? "" : "s"} × {nights ?? "?"} night{nights === 1 ? "" : "s"}</dt><dd className="m-0 font-semibold tabular-nums text-slate-800">{(gb.roomsNeeded * (nights ?? 0)).toLocaleString()} room nights</dd></div>
            <div className="flex justify-between gap-3 border-0 border-t border-dashed border-slate-200 pt-2"><dt className="font-bold text-slate-900">Total offer</dt><dd className="m-0 font-extrabold tabular-nums text-slate-900">{tzs(claim.totalAmount, claim.currency)}</dd></div>
          </dl>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "People", value: gb.headcount, Icon: Users },
            { label: "Rooms", value: gb.roomsNeeded, Icon: BedDouble },
            { label: "Property", value: claim.property.title, Icon: Building2 },
          ].map((fact) => (
            <div key={fact.label} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5">
              <p className="m-0 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400"><fact.Icon className="h-3 w-3" aria-hidden />{fact.label}</p>
              <p className="m-0 mt-0.5 truncate text-sm font-bold text-slate-900" title={String(fact.value)}>{fact.value}</p>
            </div>
          ))}
        </div>

        {offers.length > 0 && (
          <div>
            <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400"><Gift className="h-3.5 w-3.5" aria-hidden /> Extras you offered ({offers.length})</p>
            <ul className="m-0 mt-2 grid list-none grid-cols-2 gap-x-3 gap-y-1.5 p-0">
              {offers.map((offer) => (
                <li key={offer} className="flex items-center gap-1.5 text-xs text-slate-700"><Check className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden /><span className="truncate">{offer}</span></li>
              ))}
            </ul>
          </div>
        )}

        {claim.notes && (
          <blockquote className="m-0 rounded-xl bg-slate-50 px-4 py-3">
            <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400"><MessageSquareText className="h-3.5 w-3.5" aria-hidden /> Your note</p>
            <p className="m-0 mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-700">{claim.notes}</p>
          </blockquote>
        )}

        {s === "ACCEPTED" && (
          <Link href="/owner/group-stays" className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#02665e] text-sm font-bold text-white no-underline hover:bg-[#014d47]">
            Go to Assigned to me <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
    </article>
  );
}
