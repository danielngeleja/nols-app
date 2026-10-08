"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BedDouble, Building2, Bus, Car, ChevronRight, CircleAlert, Clock3, Compass, HandHeart, MapPin, Moon, RefreshCw, Users, UtensilsCrossed, Wrench } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { GroupStaysBand, StatusTabs, humanize, nightsBetween, placeName } from "@/components/owner-groups/GroupStaysChrome";

type GroupStay = {
  id: number;
  /** Opaque gs_ reference for the page URL. */
  reference?: string;
  groupType: string;
  accommodationType: string;
  headcount: number;
  roomsNeeded: number;
  toRegion: string;
  toDistrict?: string | null;
  toWard?: string | null;
  toLocation?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  user: { id: number; name: string; email: string; phone: string | null } | null;
  confirmedProperty: { id: number; title: string; type: string; status: string } | null;
  createdAt: string;
  arrPickup?: boolean;
  arrTransport?: boolean;
  arrMeals?: boolean;
  arrGuide?: boolean;
  arrEquipment?: boolean;
};

/** Colour for each stage a group stay can be in. Unknown stages fall back to grey. */
const STAGE_TONE: Record<string, { chip: string; tile: string }> = {
  AWAITING_DEPOSIT: { chip: "bg-amber-50 text-amber-800 ring-amber-200", tile: "bg-amber-500 text-white" },
  PENDING: { chip: "bg-amber-50 text-amber-800 ring-amber-200", tile: "bg-amber-500 text-white" },
  PROCESSING: { chip: "bg-sky-50 text-sky-800 ring-sky-200", tile: "bg-sky-600 text-white" },
  CONFIRMED: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", tile: "bg-[#02665e] text-white" },
  COMPLETED: { chip: "bg-slate-100 text-slate-700 ring-slate-200", tile: "bg-slate-700 text-white" },
  CANCELED: { chip: "bg-rose-50 text-rose-700 ring-rose-200", tile: "bg-rose-100 text-rose-600" },
  CANCELLED: { chip: "bg-rose-50 text-rose-700 ring-rose-200", tile: "bg-rose-100 text-rose-600" },
};
const toneOf = (status: string) => STAGE_TONE[status.toUpperCase()] ?? { chip: "bg-slate-100 text-slate-700 ring-slate-200", tile: "bg-slate-600 text-white" };

const EXTRAS: Array<{ key: keyof GroupStay; label: string; Icon: typeof Bus }> = [
  { key: "arrPickup", label: "Pickup", Icon: Car },
  { key: "arrTransport", label: "Transport", Icon: Bus },
  { key: "arrMeals", label: "Meals", Icon: UtensilsCrossed },
  { key: "arrGuide", label: "Guide", Icon: Compass },
  { key: "arrEquipment", label: "Equipment", Icon: Wrench },
];

export default function OwnerGroupStaysPage() {
  const [groupStays, setGroupStays] = useState<GroupStay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await apiClient.get("/api/owner/group-stays");
      setGroupStays(response.data?.items || []);
    } catch (err: any) {
      setGroupStays([]);
      setError(err?.response?.data?.error || "Your group stays could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => groupStays ?? [], [groupStays]);
  // Tabs come from the stages actually present, so a new stage never hides a stay.
  const tabs = useMemo(() => {
    const order = ["AWAITING_DEPOSIT", "PENDING", "PROCESSING", "CONFIRMED", "COMPLETED", "CANCELED", "CANCELLED"];
    const rank = (key: string) => (order.indexOf(key) === -1 ? 99 : order.indexOf(key));
    const present = [...new Set(list.map((gs) => gs.status.toUpperCase()))].sort((a, b) => rank(a) - rank(b));
    return [{ key: "", label: "All", count: list.length }, ...present.map((key) => ({ key, label: humanize(key), count: list.filter((gs) => gs.status.toUpperCase() === key).length }))];
  }, [list]);
  const shown = status ? list.filter((gs) => gs.status.toUpperCase() === status) : list;
  const upcoming = list.filter((gs) => gs.checkIn && new Date(gs.checkIn).getTime() >= Date.now() && !["CANCELED", "CANCELLED", "COMPLETED"].includes(gs.status.toUpperCase()));
  const guests = upcoming.reduce((sum, gs) => sum + (gs.headcount || 0), 0);
  const awaitingDeposit = list.filter((gs) => gs.status.toUpperCase() === "AWAITING_DEPOSIT").length;
  const now = Date.now();
  const phaseOf = (gs: GroupStay) => {
    const start = gs.checkIn ? new Date(gs.checkIn).getTime() : NaN;
    const end = gs.checkOut ? new Date(gs.checkOut).getTime() : NaN;
    if (Number.isFinite(start) && start > now) return "upcoming";
    if (Number.isFinite(end) && end > now) return "now";
    return Number.isFinite(start) ? "past" : "upcoming";
  };
  const byStart = (a: GroupStay, b: GroupStay) => new Date(a.checkIn ?? 0).getTime() - new Date(b.checkIn ?? 0).getTime();
  const sections = [
    { key: "now", label: "In progress", hint: "the group is staying now", items: shown.filter((gs) => phaseOf(gs) === "now").sort(byStart) },
    { key: "upcoming", label: "Upcoming", hint: "soonest first", items: shown.filter((gs) => phaseOf(gs) === "upcoming").sort(byStart) },
    { key: "past", label: "Past dates", hint: "most recent first", items: shown.filter((gs) => phaseOf(gs) === "past").sort((a, b) => byStart(b, a)) },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <GroupStaysBand
        title="Assigned to me"
        subtitle="Group stays NoLSAF placed at your properties: who is coming, when, and what they need."
        actions={
          <Link href="/owner/group-stays/claims" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5eead4] px-4 text-sm font-bold text-[#012a26] no-underline hover:bg-[#8ff3e1]">
            <HandHeart className="h-4 w-4" aria-hidden /> Find stays to claim
          </Link>
        }
        stats={[
          { label: "Assigned", value: groupStays === null ? "…" : list.length, hint: "all time" },
          { label: "Upcoming", value: groupStays === null ? "…" : upcoming.length, hint: "not yet arrived", tone: "text-[#5eead4]" },
          { label: "Guests coming", value: groupStays === null ? "…" : guests, hint: "across upcoming stays" },
          { label: "Awaiting deposit", value: groupStays === null ? "…" : awaitingDeposit, hint: "group has not paid yet", tone: awaitingDeposit ? "text-amber-200" : "text-white/50" },
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

        {groupStays === null ? (
          <ul className="m-0 list-none p-0" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-4 border-0 border-b border-solid border-slate-100 px-5 py-4">
                <div className="h-14 w-12 rounded-xl bg-slate-100" />
                <div className="flex-1 space-y-2"><div className="h-3.5 w-48 rounded-full bg-slate-100" /><div className="h-3 w-80 max-w-full rounded-full bg-slate-50" /></div>
              </li>
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Users className="h-6 w-6" aria-hidden /></span>
            <p className="m-0 mt-3 text-sm font-bold text-slate-900">{status ? `No ${humanize(status).toLowerCase()} group stays` : "No group stays assigned to you yet"}</p>
            <p className="m-0 mt-1 max-w-sm text-xs leading-5 text-slate-500">When NoLSAF places a group at one of your properties, or accepts one of your offers, it appears here.</p>
            {!status && (
              <Link href="/owner/group-stays/claims" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#02665e] px-4 text-xs font-bold text-white no-underline hover:bg-[#014d47]">
                See stays open to claim <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-6 p-4 sm:p-5">
            {sections.map((section) => (
              <div key={section.key}>
                <div className="mb-3 flex items-baseline gap-2">
                  <h2 className="m-0 text-sm font-bold text-slate-900">{section.label}</h2>
                  <span className="rounded-full bg-slate-100 px-2 text-[11px] font-bold tabular-nums text-slate-600">{section.items.length}</span>
                  <span className="text-xs text-slate-400">{section.hint}</span>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {section.items.map((gs) => <StayCard key={gs.id} gs={gs} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const dayLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", weekday: "short", day: "numeric", month: "short" }) : "Not set");

/** One sentence on timing, and whether something is off (dates passed but still unpaid). */
function whenLine(gs: GroupStay): { text: string; tone: string } {
  const status = gs.status.toUpperCase();
  const start = gs.checkIn ? new Date(gs.checkIn).getTime() : NaN;
  const end = gs.checkOut ? new Date(gs.checkOut).getTime() : NaN;
  const now = Date.now();
  const days = (ms: number) => Math.max(1, Math.round(ms / 86_400_000));
  if (["CANCELED", "CANCELLED"].includes(status)) return { text: "Cancelled. Nothing to prepare.", tone: "text-slate-500" };
  if (!Number.isFinite(start)) return { text: "Dates not set yet", tone: "text-slate-500" };
  if (start > now) {
    const d = days(start - now);
    return { text: d === 1 ? "Arrives tomorrow" : `Arrives in ${d} days`, tone: d <= 7 ? "text-[#02665e]" : "text-slate-600" };
  }
  if (Number.isFinite(end) && end > now) return { text: `In house, leaves in ${days(end - now)} day${days(end - now) === 1 ? "" : "s"}`, tone: "text-emerald-700" };
  if (status === "AWAITING_DEPOSIT" || status === "PENDING") return { text: `Dates passed ${days(now - start)} days ago and the deposit was never paid`, tone: "text-rose-700" };
  return { text: `Ended ${days(now - (Number.isFinite(end) ? end : start))} days ago`, tone: "text-slate-500" };
}

function StayCard({ gs }: { gs: GroupStay }) {
  const tone = toneOf(gs.status);
  const nights = nightsBetween(gs.checkIn, gs.checkOut);
  const extras = EXTRAS.filter((extra) => Boolean(gs[extra.key]));
  const place = [gs.toLocation, gs.toWard, gs.toDistrict, gs.toRegion].filter(Boolean).map((part) => placeName(part as string)).slice(0, 2).join(", ") || placeName(gs.toRegion);
  const when = whenLine(gs);
  const start = gs.checkIn ? new Date(gs.checkIn).getTime() : NaN;
  const end = gs.checkOut ? new Date(gs.checkOut).getTime() : NaN;
  const progress = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100)) : 0;
  return (
    <Link href={`/owner/group-stays/${encodeURIComponent(gs.reference ?? String(gs.id))}`} className="group flex flex-col overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white no-underline shadow-[0_10px_30px_-26px_rgba(15,23,42,0.5)] transition hover:border-[#02665e]/35 hover:shadow-[0_18px_40px_-26px_rgba(1,42,38,0.5)]">
      <div className="px-5 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${tone.chip}`}>{humanize(gs.status)}</span>
          <span className="text-[11px] font-semibold text-slate-400">Group #{gs.id}</span>
        </div>
        <h3 className="m-0 mt-2.5 text-lg font-bold leading-snug text-slate-900">{humanize(gs.groupType) || "Group"} group</h3>
        <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{place}</p>
      </div>

      <dl className="m-0 mx-5 mt-4 grid grid-cols-3 overflow-hidden rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200">
        {[
          { label: "Guests", value: gs.headcount, Icon: Users },
          { label: "Rooms", value: gs.roomsNeeded, Icon: BedDouble },
          { label: "Nights", value: nights ?? "?", Icon: Moon },
        ].map((fact, index) => (
          <div key={fact.label} className={`px-3 py-2.5 ${index > 0 ? "border-0 border-l border-solid border-slate-200" : ""}`}>
            <dt className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400"><fact.Icon className="h-3 w-3" aria-hidden />{fact.label}</dt>
            <dd className="m-0 mt-0.5 text-xl font-extrabold tabular-nums text-slate-900">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mx-5 mt-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span><span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400">Arrive</span><span className="font-semibold text-slate-800">{dayLabel(gs.checkIn)}</span></span>
          <span className="text-right"><span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400">Leave</span><span className="font-semibold text-slate-800">{dayLabel(gs.checkOut)}</span></span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${tone.tile.split(" ")[0]}`} style={{ width: `${Math.max(progress, progress > 0 ? 4 : 0)}%` }} />
        </div>
        <p className={`m-0 mt-2 flex items-start gap-1.5 text-xs font-semibold ${when.tone}`}>
          {when.tone.includes("rose") ? <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> : <Clock3 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />}
          {when.text}
        </p>
      </div>

      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-5 py-3">
          {gs.confirmedProperty ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-[#012a26] px-2.5 py-1 text-[11px] font-semibold text-[#5eead4]"><Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{gs.confirmedProperty.title}</span></span>
          ) : (
            <span className="text-[11px] text-slate-400">{humanize(gs.accommodationType)}</span>
          )}
          {extras.length > 0 && (
            <span className="flex items-center gap-1" aria-label={`Extras: ${extras.map((x) => x.label).join(", ")}`}>
              {extras.map((extra) => (
                <span key={extra.label} title={extra.label} className="grid h-7 w-7 place-items-center rounded-lg bg-white text-slate-500 ring-1 ring-inset ring-slate-200"><extra.Icon className="h-3.5 w-3.5" aria-hidden /></span>
              ))}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-[#02665e]">Open <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden /></span>
        </div>
      </div>
    </Link>
  );
}
