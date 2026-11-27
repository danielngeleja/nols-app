"use client";

// Agency Desk quotes: find stays for what a client asks, then text 1 to 3
// priced options the client pays NoLSAF for (docs/SALES_AGENCY_QUOTES_STRATEGY.md).
// Prices always come from the server; the partner never sets or collects one.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CalendarDays, Check, CheckCircle2, Copy, FileText, Loader2, MapPin, Plus, RefreshCw, Search, Send, Trash2, Users, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { codeLabel } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import AgencyTabs from "@/components/sales/AgencyTabs";
import InfoTip from "@/components/sales/InfoTip";
import DatePicker from "@/components/ui/DatePicker";

type Priced = { roomCode: string | null; roomLabel: string; rooms: number; nights: number; total: number; currency: string };
type Hit = { ref: string; title: string; slug: string; type: string | null; location: string | null; photo: string | null; option: Priced | null; features: string[]; reasons: string[] };
type LeadHit = { ref: string; propertyName: string; type: string | null; area: string | null; estimatedRooms: number | null; status: string };
type SearchResult = { dayUse: boolean; nights?: number; ready: Hit[]; close: Hit[]; leads: LeadHit[]; demandRecorded: boolean };
type Need = { people: number; checkIn: string; checkOut: string };
type Pick = { hit: Hit; option: Priced; need: Need };
type QuoteRow = {
  ref: string; status: string; clientName: string; clientPhone: string; expiresAt: string; sentAt: string; viewedAt: string | null; createdAt: string;
  chosenPosition: number | null;
  options: Array<{ position: number; title: string; roomLabel: string | null; rooms: number; checkIn: string; checkOut: string; nights: number; total: number; currency: string }>;
};

const FEATURES: Array<[string, string]> = [
  ["eventSpace", "Event or open space"], ["parking", "Parking"], ["kitchen", "Kitchen"], ["pool", "Pool"],
  ["wifi", "Wi-Fi"], ["generator", "Backup power"], ["garden", "Garden"], ["breakfast", "Breakfast"],
];
const HOURS = [6, 12, 24, 48, 72];
const MAX_OPTIONS = 3;
const MAX_ADULTS = 100;

const card = "min-w-0 rounded-lg border border-solid border-slate-300 bg-white";
const input = "mt-1.5 block min-h-10 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
const field = "block min-w-0 text-xs font-medium text-slate-600";
const primary = "inline-flex min-h-10 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const ghost = "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-[#02665e] hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-50";
const money = (currency: string, n: number) => `${currency === "TZS" ? "TSh" : currency} ${Math.round(n).toLocaleString("en-US")}`;
const day = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const eat = (v: string | null) => (v ? `${new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" })} EAT` : "-");

const STATUS_TONE: Record<string, string> = {
  SENT: "bg-sky-50 text-sky-800",
  VIEWED: "bg-indigo-50 text-indigo-800",
  PAYING: "bg-amber-50 text-amber-800",
  PAID: "bg-emerald-50 text-emerald-800",
  EXPIRED: "bg-slate-100 text-slate-600",
  CANCELLED: "bg-rose-50 text-rose-800",
};
const STATUS_WORD: Record<string, string> = { SENT: "Sent", VIEWED: "Opened", PAYING: "Paying", PAID: "Paid", EXPIRED: "Expired", CANCELLED: "Cancelled" };

const blankNeed = { people: "", checkIn: "", checkOut: "", area: "", budget: "", wholePlace: false, dayUse: false, features: [] as string[] };
const blankClient = { name: "", phone: "", email: "", note: "", hours: 24 };

export default function AgencyQuotesPage() {
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [need, setNeed] = useState(blankNeed);
  const [dateOpen, setDateOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searched, setSearched] = useState<Need | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [client, setClient] = useState(blankClient);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ link: string; smsSent: boolean; clientName: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [counts, setCounts] = useState({ open: 0, paid: 0, expired: 0 });
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/sales/agency/quotes");
      setQuotes(res.data?.quotes || []);
      setCounts(res.data?.counts || { open: 0, paid: 0, expired: 0 });
    } catch (cause: any) {
      if (cause?.response?.status === 404 || cause?.response?.status === 403) setUnavailable(true);
      else setError(cause?.response?.data?.error || "Could not load your quotes.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const people = Number(need.people) || 0;
  const canSearch = people >= 1 && (need.dayUse || (need.checkIn && need.checkOut));

  const search = async () => {
    setSearching(true);
    setError("");
    setNotice("");
    setSent(null);
    try {
      const body: Record<string, unknown> = { people, dayUse: need.dayUse, wholePlace: need.wholePlace, features: need.features };
      if (!need.dayUse) { body.checkIn = need.checkIn; body.checkOut = need.checkOut; }
      if (need.area.trim()) body.area = need.area.trim();
      if (Number(need.budget) > 0) body.budgetTzs = Number(need.budget);
      const res = await apiClient.post("/api/sales/agency/search", body);
      setResult(res.data);
      const snapshot = { people, checkIn: need.checkIn, checkOut: need.checkOut };
      // Options picked for other dates or another group size no longer fit this search.
      if (searched && (searched.people !== people || searched.checkIn !== need.checkIn || searched.checkOut !== need.checkOut)) setPicks([]);
      setSearched(snapshot);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not search right now.");
    } finally {
      setSearching(false);
    }
  };

  const picked = useMemo(() => new Set(picks.map((p) => p.hit.ref)), [picks]);
  const addPick = (hit: Hit) => {
    if (!hit.option || !searched || picks.length >= MAX_OPTIONS || picked.has(hit.ref)) return;
    setPicks((prev) => [...prev, { hit, option: hit.option as Priced, need: searched }]);
    setSent(null);
  };

  const send = async () => {
    setSending(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        clientName: client.name.trim(),
        clientPhone: client.phone.trim(),
        expiresInHours: client.hours,
        options: picks.map((p) => ({ propertyRef: p.hit.ref, roomCode: p.option.roomCode, rooms: p.option.rooms, checkIn: p.need.checkIn, checkOut: p.need.checkOut, adults: p.need.people, children: 0 })),
      };
      if (client.email.trim()) body.clientEmail = client.email.trim();
      if (client.note.trim()) body.note = client.note.trim();
      const res = await apiClient.post("/api/sales/agency/quotes", body);
      setSent({ link: res.data.link, smsSent: Boolean(res.data.smsSent), clientName: client.name.trim() });
      setPicks([]);
      setClient(blankClient);
      setCopied(false);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not send the quote.");
    } finally {
      setSending(false);
    }
  };

  const act = async (ref: string, action: "resend" | "cancel") => {
    if (action === "cancel" && !window.confirm("Cancel this quote? The client's link stops working.")) return;
    setActing(`${ref}:${action}`);
    setError("");
    setNotice("");
    try {
      const res = await apiClient.post(`/api/sales/agency/quotes/${encodeURIComponent(ref)}/${action}`);
      if (action === "resend") {
        setNotice(res.data?.smsSent ? "A new link was sent by SMS. The old link no longer works." : "A new link is ready, but the SMS did not go. Share it yourself.");
        if (res.data?.link) { setSent({ link: res.data.link, smsSent: Boolean(res.data.smsSent), clientName: quotes.find((q) => q.ref === ref)?.clientName || "" }); setCopied(false); }
      } else {
        setNotice("Quote cancelled.");
      }
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not update the quote.");
    } finally {
      setActing("");
    }
  };

  const copyLink = async () => {
    if (!sent) return;
    try { await navigator.clipboard.writeText(sent.link); setCopied(true); } catch { setCopied(false); }
  };

  const canSend = picks.length > 0 && client.name.trim().length >= 2 && client.phone.replace(/\D/g, "").length >= 9;
  const tooMany = (searched?.people || 0) > MAX_ADULTS;

  const hitRow = (hit: Hit, tone: "ready" | "close") => {
    const option = hit.option;
    const isPicked = picked.has(hit.ref);
    const blockedReason = !option ? "Not enough rooms for the group" : tooMany ? `One quote takes up to ${MAX_ADULTS} people` : picks.length >= MAX_OPTIONS && !isPicked ? "Up to 3 options per quote" : "";
    return (
      <li key={hit.ref} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
        <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {hit.photo ? <img src={hit.photo} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/public/properties/${hit.slug}`} target="_blank" className="block truncate text-sm font-semibold text-slate-900 no-underline hover:text-[#02665e] hover:underline">{hit.title}</Link>
          <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs text-slate-500"><MapPin className="h-3.5 w-3.5 shrink-0" />{hit.location || "-"}</p>
          {tone === "close" && hit.reasons.length ? <p className="m-0 mt-1 text-xs font-medium text-amber-700">{hit.reasons.join(" · ")}</p> : null}
        </div>
        <div className="min-w-0 text-left sm:w-44 sm:text-right">
          {option ? (
            <>
              <p className="m-0 text-sm font-bold tabular-nums text-slate-900">{money(option.currency, option.total)}</p>
              <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{option.rooms} x {option.roomLabel} · {option.nights} night{option.nights === 1 ? "" : "s"}</p>
            </>
          ) : <p className="m-0 text-xs text-slate-500">No full price</p>}
        </div>
        <button type="button" className={ghost} disabled={!!blockedReason || isPicked} title={blockedReason || undefined} onClick={() => addPick(hit)}>
          {isPicked ? <><Check className="h-3.5 w-3.5" />Added</> : <><Plus className="h-3.5 w-3.5" />Add</>}
        </button>
      </li>
    );
  };

  return (
    <SalesShell>
      <div className="min-w-0 space-y-4">
        <SalesPageHeader
          icon={FileText}
          title="Quotes"
          description="Find stays for what a client asks, then text them up to 3 options they pay NoLSAF for."
        />
        {!unavailable ? <AgencyTabs /> : null}
        {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {notice ? <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

        {unavailable ? (
          <article className={`${card} p-5 text-sm text-slate-600`}>The Agency Desk is not available on your account.</article>
        ) : (
          <>
            {/* What the client asked for */}
            <article className={card}>
              <form onSubmit={(e) => { e.preventDefault(); if (canSearch) void search(); }}>
                <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3">
                  <h2 className="m-0 text-sm font-semibold text-slate-900">What the client needs</h2>
                  <InfoTip label="How the search works">Approved stays that can take the whole group on these dates come first, cheapest first. Close matches miss one thing, like a feature or a few beds. Your own leads in the area show too. When nothing fits, NoLSAF records the demand so the team can find more places.</InfoTip>
                </div>
                <div className="grid min-w-0 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className={field}>People
                    <input value={need.people} onChange={(e) => setNeed({ ...need, people: e.target.value.replace(/\D/g, "").slice(0, 3) })} inputMode="numeric" placeholder="50" className={input} />
                  </label>
                  <div className="relative min-w-0">
                    <span className="block text-xs font-medium text-slate-600">Dates</span>
                    <button type="button" disabled={need.dayUse} aria-expanded={dateOpen} onClick={() => setDateOpen((v) => !v)} className={`${input} flex items-center gap-2 text-left text-slate-700 disabled:bg-slate-50 disabled:text-slate-400`}>
                      <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 truncate">{need.dayUse ? "One day, no night" : need.checkIn ? `${day(need.checkIn)} to ${need.checkOut ? day(need.checkOut) : "?"}` : "Check-in to check-out"}</span>
                    </button>
                    {dateOpen && !need.dayUse ? (
                      <div className="absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)]">
                        <DatePicker
                          selected={need.checkIn ? (need.checkOut ? [need.checkIn, need.checkOut] : need.checkIn) : undefined}
                          allowRange
                          resetRangeAnchor
                          onSelectAction={(value) => {
                            if (Array.isArray(value)) {
                              const first = value[0] || "";
                              const last = value[value.length - 1] || "";
                              if (first && last && last > first) { setNeed((n) => ({ ...n, checkIn: first, checkOut: last })); setDateOpen(false); }
                              else setNeed((n) => ({ ...n, checkIn: first, checkOut: "" }));
                            } else {
                              setNeed((n) => ({ ...n, checkIn: value, checkOut: "" }));
                            }
                          }}
                          onCloseAction={() => setDateOpen(false)}
                        />
                      </div>
                    ) : null}
                  </div>
                  <label className={field}>Area
                    <input value={need.area} onChange={(e) => setNeed({ ...need, area: e.target.value.slice(0, 120) })} placeholder="Mbezi, Arusha, Moshi" className={input} />
                  </label>
                  <label className={field}>Budget for the stay (TSh, optional)
                    <input value={need.budget ? Number(need.budget).toLocaleString("en-US") : ""} onChange={(e) => setNeed({ ...need, budget: e.target.value.replace(/\D/g, "").slice(0, 10) })} inputMode="numeric" placeholder="3,000,000" className={input} />
                  </label>
                </div>
                <div className="min-w-0 px-4 pb-4">
                  <p className="m-0 text-xs font-medium text-slate-600">Must have</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {FEATURES.map(([key, label]) => {
                      const on = need.features.includes(key);
                      return (
                        <button key={key} type="button" aria-pressed={on}
                          onClick={() => setNeed((n) => ({ ...n, features: on ? n.features.filter((f) => f !== key) : [...n.features, key] }))}
                          className={`inline-flex min-h-8 items-center gap-1 rounded-full border border-solid px-3 text-xs font-semibold ${on ? "border-[#02665e] bg-[#02665e]/[0.08] text-[#02665e]" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
                          {on ? <Check className="h-3.5 w-3.5" /> : null}{label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
                    <label className="inline-flex items-center gap-2"><input type="checkbox" checked={need.wholePlace} onChange={(e) => setNeed({ ...need, wholePlace: e.target.checked })} className="h-4 w-4 accent-[#02665e]" />Whole place only</label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={need.dayUse} onChange={(e) => { setNeed({ ...need, dayUse: e.target.checked }); setDateOpen(false); }} className="h-4 w-4 accent-[#02665e]" />
                      Day use, no overnight
                      <InfoTip label="Day use">Day events (a party, a meeting) are not sold yet. Searching saves the request so NoLSAF can plan for it.</InfoTip>
                    </label>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-300 bg-slate-50 px-4 py-3">
                  <button type="submit" className={primary} disabled={!canSearch || searching}>{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Find stays</button>
                  {result || need !== blankNeed ? (
                    <button type="button" className={ghost} onClick={() => { setNeed(blankNeed); setResult(null); setSearched(null); }}><X className="h-3.5 w-3.5" />Clear</button>
                  ) : null}
                </div>
              </form>
            </article>

            {/* Results */}
            {result ? (
              result.dayUse ? (
                <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Saved. Day use is not sold yet, so NoLSAF recorded this request to plan for it. Ask the client if an overnight stay works.
                </p>
              ) : (
                <div className="grid min-w-0 gap-4">
                  <article className={`${card} overflow-hidden`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3">
                      <h2 className="m-0 text-sm font-semibold text-slate-900">Ready to quote <span className="font-normal text-slate-500">({result.ready.length})</span></h2>
                      {searched ? <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Users className="h-3.5 w-3.5" />{searched.people} people · {day(searched.checkIn)} to {day(searched.checkOut)}</span> : null}
                    </div>
                    {result.ready.length ? (
                      <ul className="m-0 list-none divide-y divide-solid divide-slate-100 p-0">{result.ready.map((hit) => hitRow(hit, "ready"))}</ul>
                    ) : (
                      <p className="m-0 px-4 py-4 text-sm text-slate-600">
                        No stay takes the whole group on these dates.{result.demandRecorded ? " NoLSAF recorded the demand so the team can find more places in this area." : ""}
                      </p>
                    )}
                  </article>

                  {result.close.length ? (
                    <article className={`${card} overflow-hidden`}>
                      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3">
                        <h2 className="m-0 text-sm font-semibold text-slate-900">Close matches <span className="font-normal text-slate-500">({result.close.length})</span></h2>
                        <InfoTip label="Close matches">Each one misses something, shown in amber. Tell the client what is different before you add it.</InfoTip>
                      </div>
                      <ul className="m-0 list-none divide-y divide-solid divide-slate-100 p-0">{result.close.map((hit) => hitRow(hit, "close"))}</ul>
                    </article>
                  ) : null}

                  {result.leads.length ? (
                    <article className={`${card} overflow-hidden`}>
                      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3">
                        <h2 className="m-0 text-sm font-semibold text-slate-900">Your leads that could fit</h2>
                        <InfoTip label="Your leads">Places you are already signing up in this area. They cannot be quoted until they are listed and approved, so this is a good reason to finish them.</InfoTip>
                      </div>
                      <ul className="m-0 list-none divide-y divide-solid divide-slate-100 p-0">
                        {result.leads.map((lead) => (
                          <li key={lead.ref} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-2.5">
                            <div className="min-w-0 flex-1">
                              <Link href={`/sales/leads/${lead.ref}`} className="block truncate text-sm font-semibold text-slate-900 no-underline hover:text-[#02665e] hover:underline">{lead.propertyName}</Link>
                              <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{[lead.type ? codeLabel(lead.type) : null, lead.area, lead.estimatedRooms ? `about ${lead.estimatedRooms} rooms` : null].filter(Boolean).join(" · ")}</p>
                            </div>
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{codeLabel(lead.status)}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ) : null}
                </div>
              )
            ) : null}

            {/* Sent */}
            {sent ? (
              <article className={`${card} border-emerald-300 p-4`}>
                <p className="m-0 flex items-center gap-2 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-4 w-4" />{sent.smsSent ? `Quote sent to ${sent.clientName || "the client"} by SMS` : "Quote ready, but the SMS did not go"}</p>
                <p className="m-0 mt-1 text-xs text-slate-600">You can also share this link on WhatsApp. It is shown only now; a resend makes a new one.</p>
                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-solid border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{sent.link}</code>
                  <button type="button" className={ghost} onClick={() => void copyLink()}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}</button>
                  <a className={`${ghost} no-underline`} href={`https://wa.me/?text=${encodeURIComponent(`Your NoLSAF stay options: ${sent.link} Pay NoLSAF only on that page.`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                </div>
              </article>
            ) : null}

            {/* Quote builder */}
            {picks.length ? (
              <article className={`${card} overflow-hidden`}>
                <form onSubmit={(e) => { e.preventDefault(); if (canSend) void send(); }}>
                  <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3">
                    <h2 className="m-0 text-sm font-semibold text-slate-900">Quote <span className="font-normal text-slate-500">({picks.length} of {MAX_OPTIONS} options)</span></h2>
                    <InfoTip label="Prices">NoLSAF prices every option again when you send, and the client pays NoLSAF on the quote page. You never collect money.</InfoTip>
                  </div>
                  <ol className="m-0 list-none divide-y divide-solid divide-slate-100 p-0">
                    {picks.map((p, index) => (
                      <li key={p.hit.ref} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#02665e]/10 text-xs font-bold text-[#02665e]">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-sm font-semibold text-slate-900">{p.hit.title}</p>
                          <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{p.option.rooms} x {p.option.roomLabel} · {day(p.need.checkIn)} to {day(p.need.checkOut)} · {p.need.people} people</p>
                        </div>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{money(p.option.currency, p.option.total)}</span>
                        <button type="button" aria-label={`Remove ${p.hit.title}`} onClick={() => setPicks((prev) => prev.filter((x) => x.hit.ref !== p.hit.ref))}
                          className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-700">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="grid min-w-0 gap-3 border-0 border-t border-solid border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className={field}>Client name<input value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value.slice(0, 160) })} className={input} /></label>
                    <label className={field}>Client phone<input value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value.slice(0, 40) })} inputMode="tel" placeholder="0712 345 678" className={input} /></label>
                    <label className={field}>Email (optional)<input value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value.slice(0, 190) })} inputMode="email" className={input} /></label>
                    <label className={field}>Valid for
                      <select value={client.hours} onChange={(e) => setClient({ ...client, hours: Number(e.target.value) })} className={input}>
                        {HOURS.map((h) => <option key={h} value={h}>{h} hours</option>)}
                      </select>
                    </label>
                    <label className={`${field} sm:col-span-2 lg:col-span-4`}>Note to the client (optional)
                      <input value={client.note} onChange={(e) => setClient({ ...client, note: e.target.value.slice(0, 500) })} placeholder="All three have parking. Option 1 has the biggest garden." className={input} />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-300 bg-slate-50 px-4 py-3">
                    <button type="submit" className={primary} disabled={!canSend || sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send by SMS</button>
                    <span className="text-xs text-slate-500">Rooms are not held. The first guest to pay gets them.</span>
                  </div>
                </form>
              </article>
            ) : null}

            {/* Quotes sent */}
            <article className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3">
                <h2 className="m-0 text-sm font-semibold text-slate-900">Quotes sent</h2>
                <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  <span className="rounded-md bg-sky-50 px-2 py-0.5 text-sky-800">{counts.open} open</span>
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-800">{counts.paid} paid</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-600">{counts.expired} expired</span>
                </div>
              </div>
              {loading ? (
                <div className="grid min-h-24 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : quotes.length === 0 ? (
                <p className="m-0 px-4 py-5 text-sm text-slate-500">No quotes yet. Search what a client needs, add up to 3 stays and send.</p>
              ) : (
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-2 font-semibold">Client</th>
                        <th className="px-4 py-2 font-semibold">Options</th>
                        <th className="px-4 py-2 font-semibold">From</th>
                        <th className="px-4 py-2 font-semibold">Status</th>
                        <th className="px-4 py-2 font-semibold">Valid until</th>
                        <th className="px-4 py-2 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map((q) => {
                        const live = ["SENT", "VIEWED", "PAYING"].includes(q.status);
                        const cheapest = q.options.reduce<QuoteRow["options"][number] | null>((m, o) => (!m || o.total < m.total ? o : m), null);
                        const chosen = q.chosenPosition ? q.options.find((o) => o.position === q.chosenPosition) : null;
                        return (
                          <tr key={q.ref} className="border-0 border-t border-solid border-slate-100 align-top">
                            <td className="px-4 py-3">
                              <p className="m-0 font-semibold text-slate-900">{q.clientName}</p>
                              <p className="m-0 mt-0.5 text-xs text-slate-500">{q.clientPhone}</p>
                            </td>
                            <td className="max-w-[16rem] px-4 py-3">
                              <p className="m-0 truncate text-slate-800">{chosen ? `Chose ${chosen.title}` : q.options.map((o) => o.title).join(", ")}</p>
                              <p className="m-0 mt-0.5 text-xs text-slate-500">{q.options.length} option{q.options.length === 1 ? "" : "s"}{q.options[0] ? ` · ${day(q.options[0].checkIn)} to ${day(q.options[0].checkOut)}` : ""}</p>
                            </td>
                            <td className="px-4 py-3 font-semibold tabular-nums text-slate-900">{cheapest ? money(cheapest.currency, (chosen || cheapest).total) : "-"}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[q.status] || "bg-slate-100 text-slate-600"}`}>{STATUS_WORD[q.status] || codeLabel(q.status)}</span>
                              <p className="m-0 mt-1 text-[11px] text-slate-500">{q.viewedAt ? `Opened ${eat(q.viewedAt)}` : "Not opened yet"}</p>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600">{eat(q.expiresAt)}</td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-1.5">
                                {live ? (
                                  <>
                                    <button type="button" className={ghost} disabled={!!acting} onClick={() => void act(q.ref, "resend")}>
                                      {acting === `${q.ref}:resend` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Resend
                                    </button>
                                    <button type="button" className={ghost} disabled={!!acting} onClick={() => void act(q.ref, "cancel")}>
                                      {acting === `${q.ref}:cancel` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}Cancel
                                    </button>
                                  </>
                                ) : <span className="text-xs text-slate-400">-</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </>
        )}
      </div>
    </SalesShell>
  );
}

