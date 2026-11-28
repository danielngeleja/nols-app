"use client";

/**
 * Event hire review (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4).
 * Owners, or sales partners for them, declare an event space; the owner gives
 * the consent. Admin approves or returns it, and can pause an approved one.
 * Venue approval is separate from booking operations and financial release.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Eye, Inbox, Loader2, PartyPopper, PauseCircle, PlayCircle, RotateCcw, Search, ShieldCheck, UserRound, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { refreshEventHire } from "./admin/eventAdmin";
import { Loading } from "./admin/ui";
import {
  ALLOWED, EVENT_TYPES, SPACE_TYPES, STATUS_LABEL, STATUS_TONE,
  depositFor, eventMoney, feesOf, eat, multiDayPrice, tsh, type EventHireView,
} from "@/components/events/eventHireTypes";

type Tab = "PENDING" | "APPROVED" | "RETURNED" | "PAUSED" | "AWAITING_OWNER";
type Item = EventHireView & { ref: string; area: string | null; ownerName: string | null; ownerPhone: string | null; updatedAt: string };
type Payload = { counts: Record<string, number>; items: Item[] };

function titleCase(value: string | null) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

type SortKey = "venue" | "space" | "seated" | "standing" | "price" | "hours" | "owner" | "consent" | "status" | "updated";
const NUMERIC: SortKey[] = ["seated", "standing", "price", "updated"];
const COLUMNS: Array<{ key: SortKey; label: string; right?: boolean }> = [
  { key: "venue", label: "Venue" }, { key: "space", label: "Space" }, { key: "seated", label: "Seated", right: true },
  { key: "standing", label: "Standing", right: true }, { key: "price", label: "Full day", right: true }, { key: "hours", label: "Hours" },
  { key: "owner", label: "Owner" }, { key: "consent", label: "Consent" }, { key: "status", label: "Status" }, { key: "updated", label: "Updated" },
];
function sortValue(r: Item, key: SortKey): string | number {
  const t = r.terms;
  switch (key) {
    case "venue": return (r.propertyTitle || "").toLowerCase();
    case "space": return SPACE_TYPES.find((s) => s.key === t.spaceType)?.label ?? "";
    case "seated": return t.capacitySeated ?? -1;
    case "standing": return t.capacityStanding ?? -1;
    case "price": return t.fullDayPrice ?? t.halfDayPrice ?? -1;
    case "hours": return t.earliestStart ?? "";
    case "owner": return (r.ownerName || "").toLowerCase();
    case "consent": return r.consentCurrent ? 1 : 0;
    case "status": return `${STATUS_LABEL[r.status] ?? r.status}${String(r.problems.length).padStart(3, "0")}`;
    case "updated": return new Date(r.updatedAt).getTime() || 0;
  }
}
function sortVenues(rows: Item[], sort: { key: SortKey; dir: "asc" | "desc" }) {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c * sign || (a.propertyTitle || "").localeCompare(b.propertyTitle || "");
  });
}

const TABS: Tab[] = ["PENDING", "AWAITING_OWNER", "APPROVED", "RETURNED", "PAUSED"];

export default function AdminEventHirePage() {
  return <Suspense fallback={<Loading />}><VenueReview /></Suspense>;
}

function VenueReview() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.get("view") as Tab | null;
  const [tab, setTab] = useState<Tab>(fromUrl && TABS.includes(fromUrl) ? fromUrl : "PENDING");
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const landed = useRef(false);
  // Waiting longest first by default, so the oldest submission is never buried.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "updated", dir: "asc" });

  useEffect(() => {
    const refresh = () => setVersion(v => v + 1);
    window.addEventListener("event-hire-refresh", refresh);
    return () => window.removeEventListener("event-hire-refresh", refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void apiClient.get<Payload>("/api/admin/event-hire", { params: { status: tab }, signal: controller.signal })
      .then(({ data: result }) => { if (!controller.signal.aborted) { setData(result); setError(""); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e?.response?.data?.error || "Could not load event hire."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tab, version]);

  const count = (s: string) => data?.counts?.[s] ?? 0;
  const q = query.trim().toLowerCase();
  const rows = (data?.items ?? []).filter((r) => !q || [r.propertyTitle, r.area, r.ownerName].some((v) => String(v || "").toLowerCase().includes(q)));
  const opened = open ? (data?.items ?? []).find((r) => r.ref === open) ?? null : null;
  const sorted = sortVenues(rows, sort);
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: NUMERIC.includes(key) ? "desc" : "asc" }));
  const pick = (next: Tab) => { setTab(next); setNotice(""); setCleared(false); router.replace(`${pathname}?view=${next}`, { scroll: false }); };

  // Nothing to review: land on the live venues instead of an empty box, and say the queue is clear.
  useEffect(() => {
    if (landed.current || fromUrl || !data || tab !== "PENDING") return;
    landed.current = true;
    if (!count("PENDING") && count("APPROVED")) { setTab("APPROVED"); setCleared(true); }
  }, [data, tab, fromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const STAGES: Array<{ key: Tab; label: string; hint: string; warm?: boolean }> = [
    { key: "PENDING", label: "To review", hint: "Submitted with consent", warm: true },
    { key: "AWAITING_OWNER", label: "Owner consent", hint: "Sent to the owner" },
    { key: "APPROVED", label: "Live", hint: "On sale to clients" },
    { key: "RETURNED", label: "Returned", hint: "Owner is fixing it" },
    { key: "PAUSED", label: "Paused", hint: "Off sale for now" },
  ];
  const current = STAGES.find((s) => s.key === tab)!;

  return (
    <div className="w-full space-y-3">
      {/* Stages as one connected strip; each one is a filter */}
      <nav aria-label="Venue review stages" className="grid grid-cols-2 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white sm:grid-cols-5">
        {STAGES.map((s, i) => {
          const on = tab === s.key;
          const n = data ? count(s.key) : null;
          return (
            <button key={s.key} type="button" onClick={() => pick(s.key)} aria-current={on ? "true" : undefined} title={s.hint}
              className={`flex h-9 min-w-0 items-center justify-between gap-2 border-0 px-3 text-left text-[12px] font-semibold transition-colors ${i ? "sm:border-l sm:border-solid sm:border-neutral-200" : ""} ${on ? "bg-[#0b2420] text-white" : "bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"}`}>
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                {s.warm && n ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden /> : null}{s.label}
              </span>
              <span className={`shrink-0 rounded px-1.5 text-[11px] tabular-nums leading-5 ${on ? "bg-white/15 text-white" : n ? "bg-neutral-100 text-neutral-800" : "text-neutral-400"}`}>{n ?? "..."}</span>
            </button>
          );
        })}
      </nav>

      {cleared && <p role="status" className="m-0 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-900"><CheckCircle2 className="size-4 shrink-0" aria-hidden />Review queue is clear. Showing the live venues.</p>}
      {notice ? <p role="status" className="m-0 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"><CheckCircle2 className="size-4" aria-hidden />{notice}</p> : null}

      <section aria-busy={loading} className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
          <p className="m-0 flex-1 text-[13px] font-semibold text-neutral-900">{current.label}<span className="ml-1.5 font-normal text-neutral-400">{data ? rows.length : ""}</span></p>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search venues</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search venue, area or owner" className="h-8 w-full rounded-md border border-solid border-neutral-200 bg-neutral-50 pl-8 pr-3 text-[12.5px] text-neutral-900 outline-none focus:border-[#02665e] focus:bg-white focus:ring-2 focus:ring-[#02665e]/15" />
          </label>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <p role="alert" className="m-0 px-4 py-6 text-sm text-red-700">{error}</p>
        ) : rows.length === 0 ? (
          <p className="m-0 flex items-center gap-2 px-4 py-5 text-[12.5px] text-neutral-500">
            <Inbox className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
            {q ? "No venue matches that search." : tab === "PENDING" ? "Nothing to review. New submissions appear here with the owner's consent, details and photos." : "No venues at this stage."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-left text-[12.5px]">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-100 text-[11px] font-semibold text-neutral-600">
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`p-0 font-semibold ${c.key !== "venue" ? "border-0 border-l border-solid border-neutral-200" : ""}`}>
                      <button type="button" onClick={() => sortBy(c.key)} title={`Sort by ${c.label.toLowerCase()}`}
                        className={`flex w-full items-center gap-1 border-0 bg-transparent px-3 py-2 text-[11px] font-semibold hover:text-neutral-900 ${c.right ? "justify-end" : ""} ${sort.key === c.key ? "text-[#02665e]" : "text-neutral-600"}`}>
                        {c.label}
                        {sort.key === c.key ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                      </button>
                    </th>
                  ))}
                  <th className="w-12 border-0 border-l border-solid border-neutral-200 px-3 py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>{sorted.map((r, i) => <VenueRow key={r.ref} r={r} striped={i % 2 === 1} sortKey={sort.key} onOpen={() => setOpen(r.ref)} />)}</tbody>
            </table>
          </div>
        )}
      </section>

      {opened ? (
        <ReviewCard key={opened.ref} item={opened} onClose={() => setOpen(null)} onDone={(message) => { setNotice(message); setOpen(null); refreshEventHire(); }} />
      ) : null}
    </div>
  );
}

/** One venue as a table row: thumbnail and name, the decision facts in columns, the eye to open it. */
function VenueRow({ r, onOpen, striped, sortKey }: { r: Item; onOpen: () => void; striped: boolean; sortKey: SortKey }) {
  const t = r.terms;
  const cover = r.extraPhotos?.[0] ?? r.photos?.find((p) => p.area === "EVENT_SPACE")?.url ?? r.photos?.[0]?.url;
  const photoCount = (r.extraPhotos?.length ?? 0) + (r.photos ?? []).filter((p) => p.area === "EVENT_SPACE").length;
  const missing = r.status === "PENDING" ? r.problems.length : 0;
  // Column lines and stripes keep each value in its column; the sorted column is lightly tinted.
  const cell = (key: SortKey) => `px-3 py-2 align-middle ${key !== "venue" ? "border-0 border-l border-solid border-neutral-100" : ""} ${key === sortKey ? "bg-[#02665e]/[0.04]" : ""}`;
  return (
    <tr onDoubleClick={onOpen} className={`border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-[#02665e]/[0.05] ${striped ? "bg-neutral-50" : "bg-white"}`}>
      <td className={`${cell("venue")} max-w-[260px]`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative block h-9 w-12 shrink-0 overflow-hidden rounded bg-neutral-100">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : <span className="grid h-full w-full place-items-center text-neutral-300"><PartyPopper className="h-3.5 w-3.5" /></span>}
            <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[9px] font-semibold leading-[14px] text-white">{photoCount}</span>
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate font-semibold text-neutral-900">{titleCase(r.propertyTitle) || "Property"}</p>
            <p className="m-0 truncate text-[11px] text-neutral-500">{titleCase(r.area) || "Area not set"}</p>
          </div>
        </div>
      </td>
      <td className={`${cell("space")} text-neutral-700`}>{SPACE_TYPES.find((s) => s.key === t.spaceType)?.label ?? "-"}</td>
      <td className={`${cell("seated")} text-right tabular-nums text-neutral-800`}>{t.capacitySeated ?? "-"}</td>
      <td className={`${cell("standing")} text-right tabular-nums text-neutral-800`}>{t.capacityStanding ?? "-"}</td>
      <td className={`${cell("price")} text-right font-semibold tabular-nums text-neutral-900`}>{tsh(t.fullDayPrice ?? t.halfDayPrice)}</td>
      <td className={`${cell("hours")} whitespace-nowrap tabular-nums text-neutral-700`}>{t.earliestStart && t.latestEnd ? `${t.earliestStart} to ${t.latestEnd}` : "-"}</td>
      <td className={`${cell("owner")} max-w-[160px]`}>
        <p className="m-0 truncate text-neutral-800">{r.ownerName || "Owner"}</p>
        <p className="m-0 truncate text-[11px] text-neutral-400">{r.filledBy === "SALES_PARTNER" ? "Filled by partner" : "Filled by owner"}</p>
      </td>
      <td className={cell("consent")}>
        {r.consentCurrent
          ? <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />{r.ownerConsentVia === "SMS_LINK" ? "By SMS" : "In app"}</span>
          : <span className="text-[11.5px] font-semibold text-amber-700">Not given</span>}
      </td>
      <td className={cell("status")}>
        <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-bold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
        {missing ? <span className="mt-0.5 block text-[10.5px] font-semibold text-rose-700">{missing} missing</span> : null}
      </td>
      <td className={`${cell("updated")} whitespace-nowrap text-[11.5px] text-neutral-500`} title={eat(r.updatedAt)}>{new Date(r.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}</td>
      <td className="border-0 border-l border-solid border-neutral-100 px-3 py-2 text-right align-middle">
        <button type="button" onClick={onOpen} aria-label={`Open ${r.propertyTitle || "event venue"}`} title="Open"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-500 hover:border-[#02665e]/40 hover:bg-[#02665e]/5 hover:text-[#02665e]">
          <Eye className="h-4 w-4" aria-hidden />
        </button>
      </td>
    </tr>
  );
}

/** A labelled fact tile in the review card. */
function Fact({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: React.ReactNode; warn?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border border-solid px-3 py-2.5 ${warn ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="m-0 text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`m-0 mt-0.5 truncate text-[14px] font-bold ${warn ? "text-amber-800" : "text-slate-900"}`}>{value}</p>
      {sub ? <p className="m-0 truncate text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</p>;
}

/** One application, opened from the eye: photos on the left, facts on the right, the decision at the bottom. */
function ReviewCard({ item: r, onClose, onDone }: { item: Item; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState(0);
  const t = r.terms;
  const fees = feesOf(r);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const decide = async (action: "APPROVE" | "RETURN" | "PAUSE" | "RESUME") => {
    if ((action === "RETURN" || action === "PAUSE") && reason.trim().length < 5) { setError(action === "RETURN" ? "Say what the owner should change." : "Say why it is paused."); return; }
    setBusy(action);
    setError("");
    try {
      await apiClient.post(`/api/admin/event-hire/${encodeURIComponent(r.ref)}/decide`, { action, version: r.version, reason: reason.trim() || undefined });
      onDone({ APPROVE: "Approved. The owner was told.", RETURN: "Returned. The owner sees what to change.", PAUSE: "Paused.", RESUME: "Resumed." }[action]);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not save the decision.");
    } finally {
      setBusy("");
    }
  };

  const shots = [
    ...(r.extraPhotos ?? []).map((url) => ({ url, isNew: true })),
    ...(r.photos ?? []).filter((p) => p.area === "EVENT_SPACE").map((p) => ({ url: p.url, isNew: false })),
  ];
  const hero = shots[Math.min(shown, Math.max(0, shots.length - 1))];
  const prices: Array<[string, number]> = [];
  for (const [label, price] of [["Half day", t.halfDayPrice], ["Full day", t.fullDayPrice], ["Evening", t.eveningPrice]] as Array<[string, number | null]>) {
    if (price) prices.push([label, price]);
  }
  const kinds = EVENT_TYPES.filter((e) => (t.eventTypes ?? []).includes(e.key));
  const provided = [
    t.provided.chairs ? `${t.provided.chairs} chairs` : null,
    t.provided.tables ? `${t.provided.tables} tables` : null,
    t.provided.parkingSpaces ? `${t.provided.parkingSpaces} parking` : null,
    t.provided.toilets ? `${t.provided.toilets} toilets` : null,
    t.provided.powerBackup ? "Backup power" : null,
    t.provided.water ? "Water" : null,
  ].filter(Boolean) as string[];
  const multi = t.multiDay?.enabled ? [2, 3, 5].map((d) => multiDayPrice(t, d)).filter(Boolean) as Array<NonNullable<ReturnType<typeof multiDayPrice>>> : [];
  const actionable = r.status === "PENDING" || r.status === "APPROVED" || r.status === "PAUSED";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-[2px] sm:p-6" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div id="event-hire-card" role="dialog" aria-modal="true" aria-labelledby="event-hire-title" className="flex max-h-[94vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <style>{`#event-hire-card, #event-hire-card * { box-sizing: border-box; }`}</style>

        {/* Header: what, where, who, and where it stands, in one band */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 bg-[#0b2420] px-5 py-4 text-white">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/10"><PartyPopper className="size-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/45">Event hire</p>
              <h2 id="event-hire-title" className="m-0 truncate text-[18px] font-semibold text-white">{titleCase(r.propertyTitle) || "Property"}</h2>
              <p className="m-0 truncate text-[12.5px] text-white/60">{r.area || "Area not set"}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-white/[0.07] px-3 py-2">
            <UserRound className="size-4 shrink-0 text-white/50" />
            <div className="min-w-0">
              <p className="m-0 truncate text-[13px] font-semibold">{r.ownerName || "Owner"}</p>
              <p className="m-0 truncate font-mono text-[11px] text-white/55">{r.ownerPhone || "No phone"}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-white/[0.07] px-3 py-2">
            <ShieldCheck className={`size-4 shrink-0 ${r.consentCurrent ? "text-emerald-300" : "text-amber-300"}`} />
            <div className="min-w-0">
              <p className="m-0 truncate text-[13px] font-semibold">{r.consentCurrent ? (r.ownerConsentVia === "SMS_LINK" ? "Consent by SMS" : "Consent in the app") : "No consent"}</p>
              <p className="m-0 truncate text-[11px] text-white/55">{r.consentCurrent ? eat(r.ownerConsentAt) : r.filledBy === "SALES_PARTNER" ? "Filled by a partner" : "Filled by the owner"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-[11.5px] font-bold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
            {r.propertyStatus !== "APPROVED" ? <span className="rounded-md bg-amber-400/20 px-2 py-1 text-[11.5px] text-amber-100">Listing not approved</span> : null}
            <button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="Close" className="ml-1 grid h-8 w-8 place-items-center rounded-md border-0 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"><X className="size-4" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid min-w-0 gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {/* Left: the photos */}
            <section className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <SectionTitle>Photos of the space</SectionTitle>
                <span className={`text-[11px] font-semibold ${shots.length >= 7 && shots.length <= 12 ? "text-emerald-700" : "text-rose-700"}`}>{shots.length} of 7 to 12</span>
              </div>
              {hero ? (
                <>
                  <a href={hero.url} target="_blank" rel="noopener noreferrer" className="relative block aspect-[16/10] overflow-hidden rounded-lg bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hero.url} alt="" className="h-full w-full object-cover" />
                    {hero.isNew ? <span className="absolute left-2 top-2 rounded bg-[#02665e] px-2 py-0.5 text-[11px] font-semibold text-white">New, not on the listing</span> : null}
                    <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{Math.min(shown, shots.length - 1) + 1} / {shots.length} · Open full size</span>
                  </a>
                  <ul className="m-0 mt-2 grid list-none grid-cols-6 gap-1.5 p-0">
                    {shots.map((s, i) => (
                      <li key={s.url}>
                        <button type="button" onClick={() => setShown(i)} aria-label={`Show photo ${i + 1}`}
                          className={`relative block aspect-square w-full overflow-hidden rounded-md border-0 bg-slate-100 p-0 ${i === shown ? "ring-2 ring-[#02665e] ring-offset-1" : "opacity-80 hover:opacity-100"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                          {s.isNew ? <span className="absolute left-0.5 top-0.5 h-2 w-2 rounded-full bg-[#02665e] ring-2 ring-white" /> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 mt-1.5 text-[11px] text-slate-500"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#02665e] align-middle" />New: uploaded for event hire, not on the listing yet.</p>
                </>
              ) : (
                <p className="m-0 grid aspect-[16/10] place-items-center rounded-lg border border-dashed border-amber-300 bg-amber-50 text-[13px] font-semibold text-amber-800">No photos of the event space</p>
              )}
              {t.description ? <p className="m-0 mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[13px] leading-5 text-slate-700">{t.description}</p> : null}
            </section>

            {/* Right: the facts */}
            <section className="min-w-0 space-y-4">
              {r.status === "PENDING" && r.problems.length ? (
                <div className="rounded-lg border border-solid border-rose-200 bg-rose-50 px-3 py-2.5">
                  <p className="m-0 text-[12.5px] font-semibold text-rose-800">Required details missing. It cannot be approved.</p>
                  <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-rose-800">{r.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              ) : null}

              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
                <Fact label="Space" value={SPACE_TYPES.find((s) => s.key === t.spaceType)?.label ?? "-"} warn={!t.spaceType} />
                <Fact label="Guests" value={`${t.capacitySeated ?? "-"} / ${t.capacityStanding ?? "-"}`} sub="seated / standing" />
                <Fact label="Hours" value={`${t.earliestStart ?? "-"} to ${t.latestEnd ?? "-"}`} sub={t.earliestStart && t.latestEnd && t.latestEnd <= t.earliestStart ? "ends next day" : "same day"} />
                <Fact label="Quiet from" value={t.noiseCutoff ?? "Not set"} />
              </div>

              <div>
                <SectionTitle>Suitable for</SectionTitle>
                {kinds.length ? (
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {kinds.map((k) => <li key={k.key} className="rounded-md bg-[#02665e]/[0.08] px-2 py-0.5 text-[12px] font-semibold text-[#02665e]">{k.label}</li>)}
                  </ul>
                ) : <p className="m-0 text-[13px] font-semibold text-amber-700">Not chosen</p>}
              </div>

              <div>
                <SectionTitle>Prices</SectionTitle>
                <div className="overflow-hidden rounded-lg border border-solid border-slate-200">
                  <table className="w-full border-collapse text-left text-[12.5px]">
                    <thead>
                      <tr className="bg-slate-50 text-[11px] text-slate-500">
                        <th className="px-3 py-1.5 font-medium">Booking</th>
                        <th className="px-3 py-1.5 text-right font-medium">Owner receives</th>
                        <th className="px-3 py-1.5 text-right font-medium">Client pays</th>
                        <th className="px-3 py-1.5 text-right font-medium">Deposit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prices.map(([label, price]) => (
                        <tr key={label} className="border-0 border-t border-solid border-slate-100">
                          <td className="px-3 py-1.5 font-medium text-slate-700">{label}</td>
                          <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-900">{tsh(eventMoney(price, fees.owner, fees.client).ownerReceives)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{tsh(eventMoney(price, fees.owner, fees.client).clientPays)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{tsh(depositFor(t, price))}</td>
                        </tr>
                      ))}
                      {multi.map((x) => (
                        <tr key={`d${x.days}`} className="border-0 border-t border-solid border-slate-100 bg-[#02665e]/[0.03]">
                          <td className="px-3 py-1.5 font-medium text-slate-700">{x.days} days{x.percent ? <span className="ml-1 text-[11px] font-semibold text-[#02665e]">-{x.percent}%</span> : null}</td>
                          <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-900">{tsh(eventMoney(x.total, fees.owner, fees.client).ownerReceives)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{tsh(eventMoney(x.total, fees.owner, fees.client).clientPays)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{tsh(depositFor(t, x.total))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="m-0 border-0 border-t border-solid border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
                    NoLSAF {fees.owner + fees.client}%: {fees.owner}% from the owner, {fees.client}% client service fee. Deposit {t.depositMode === "FIXED" ? "fixed" : `${t.depositPercent ?? "-"}% of the price`}.
                    {t.cleaningFee ? ` Cleaning fee ${tsh(t.cleaningFee)}.` : ""}
                    {t.multiDay?.enabled ? ` Up to ${t.multiDay.maxDays ?? "-"} days in a row.` : " Single days only."}
                  </p>
                </div>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <SectionTitle>Allowed</SectionTitle>
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {ALLOWED.map((a) => {
                      const on = t.allowed?.[a.key];
                      return <li key={a.key} className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${on ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-400 line-through"}`}>{a.label}</li>;
                    })}
                  </ul>
                </div>
                <div className="min-w-0">
                  <SectionTitle>Provided</SectionTitle>
                  {provided.length ? (
                    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {provided.map((x) => <li key={x} className="rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700">{x}</li>)}
                    </ul>
                  ) : <p className="m-0 text-[12.5px] text-slate-500">Nothing listed</p>}
                  {t.permitNote ? <p className="m-0 mt-1.5 text-[12px] text-slate-600"><span className="font-semibold">Permit:</span> {t.permitNote}</p> : null}
                </div>
              </div>

              {r.returnReason && r.status === "RETURNED" ? <p className="m-0 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">Returned: {r.returnReason}</p> : null}
              {r.pauseReason && r.status === "PAUSED" ? <p className="m-0 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">Paused: {r.pauseReason}</p> : null}
            </section>
          </div>
        </div>

        {/* Decision bar, always in view */}
        {actionable ? (
          <div className="shrink-0 border-0 border-t border-solid border-slate-200 bg-slate-50 px-5 py-3">
            {error ? <p role="alert" className="m-0 mb-2 text-[12.5px] text-red-700">{error}</p> : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {r.status === "PAUSED" ? (
                <button type="button" disabled={Boolean(busy) || r.propertyStatus !== "APPROVED"} title={r.propertyStatus !== "APPROVED" ? "Approve the accommodation property first" : undefined} onClick={() => void decide("RESUME")}
                  className="ml-auto inline-flex h-10 items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-5 text-sm font-semibold text-white hover:bg-[#014d47]">
                  {busy === "RESUME" ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}Resume
                </button>
              ) : (
                <>
                  <input value={reason} onChange={(e) => { setReason(e.target.value); setError(""); }} maxLength={500}
                    placeholder={r.status === "PENDING" ? "Note for the owner (needed to return it)" : "Why it is paused (needed to pause it)"}
                    className="h-10 min-w-0 flex-1 basis-64 rounded-md border border-solid border-slate-300 bg-white px-3 text-[13px] outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                  {r.status === "PENDING" && r.problems.length ? (
                    <button type="button" disabled={Boolean(busy)}
                      onClick={() => setReason(`Please complete these before we can approve: ${r.problems.map((p) => p.replace(/\.$/, "")).join("; ")}.`)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-solid border-rose-300 bg-white px-3 text-xs font-semibold text-rose-800 hover:bg-rose-50">
                      Write the note for me
                    </button>
                  ) : null}
                  {r.status === "PENDING" ? (
                    <>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void decide("RETURN")}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100">
                        {busy === "RETURN" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}Return for changes
                      </button>
                      <button type="button" disabled={Boolean(busy) || !r.consentCurrent || r.problems.length > 0 || r.propertyStatus !== "APPROVED"} onClick={() => void decide("APPROVE")}
                        title={r.propertyStatus !== "APPROVED" ? "Approve the accommodation property first" : r.problems.length ? "Required details are missing. Return it instead." : undefined}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-5 text-sm font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                        {busy === "APPROVE" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Approve
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={Boolean(busy)} onClick={() => void decide("PAUSE")}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100">
                      {busy === "PAUSE" ? <Loader2 className="size-4 animate-spin" /> : <PauseCircle className="size-4" />}Pause
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
