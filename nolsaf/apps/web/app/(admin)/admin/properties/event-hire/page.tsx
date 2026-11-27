"use client";

/**
 * Event hire review (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4).
 * Owners, or sales partners for them, declare an event space; the owner gives
 * the consent. Admin approves or returns it, and can pause an approved one.
 * Nothing is sold until event booking opens (phase E2).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Clock3, Eye, Inbox, Loader2, PartyPopper, PauseCircle, PlayCircle, RotateCcw, ShieldCheck, UserRound, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";
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

export default function AdminEventHirePage() {
  const [tab, setTab] = useState<Tab>("PENDING");
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);

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
  const rows = data?.items ?? [];
  const opened = open ? rows.find((r) => r.ref === open) ?? null : null;

  return (
    <div id="event-hire-admin" className="w-full">
      <style>{`#event-hire-admin, #event-hire-admin * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<Tab>
        kicker="Properties"
        title="Event hire"
        description="Spaces owners offer for parties, meetings and gatherings. Approve the ones that are safe to sell."
        metrics={[
          { label: "Waiting for review", value: data ? count("PENDING") : "-", tone: count("PENDING") ? "warn" : "default" },
          { label: "Approved", value: data ? count("APPROVED") : "-" },
        ]}
        onRefresh={() => setVersion((v) => v + 1)}
        loading={loading}
        tabs={[
          { key: "PENDING", label: "Waiting", Icon: Inbox, count: count("PENDING") || undefined },
          { key: "APPROVED", label: "Approved", Icon: CheckCircle2 },
          { key: "RETURNED", label: "Returned", Icon: RotateCcw },
          { key: "PAUSED", label: "Paused", Icon: PauseCircle },
          { key: "AWAITING_OWNER", label: "With the owner", Icon: Clock3, count: count("AWAITING_OWNER") || undefined },
        ]}
        activeTab={tab}
        onTab={(next) => { if (next !== tab) { setTab(next); setNotice(""); } }}
      />
      {notice ? <p role="status" className="m-0 mt-3 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"><CheckCircle2 className="size-4" aria-hidden />{notice}</p> : null}

      <section aria-busy={loading} className="mt-3 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        {loading && !data ? (
          <p role="status" className="m-0 flex min-h-32 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Loading</p>
        ) : error ? (
          <p role="alert" className="m-0 px-4 py-6 text-sm text-red-700">{error}</p>
        ) : rows.length === 0 ? (
          <p className="m-0 px-4 py-10 text-center text-sm text-slate-500">{tab === "PENDING" ? "Nothing waiting for review." : "Nothing here yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">Space</th>
                  <th className="px-4 py-2.5 font-semibold">Owner</th>
                  <th className="px-4 py-2.5 font-semibold">Guests</th>
                  <th className="px-4 py-2.5 font-semibold">Full day</th>
                  <th className="px-4 py-2.5 font-semibold">Filled by</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="w-14 px-4 py-2.5"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ref} className="border-0 border-t border-solid border-slate-100 align-middle hover:bg-slate-50/70">
                    <td className="max-w-[240px] px-4 py-3">
                      <p className="m-0 truncate font-semibold text-slate-900">{titleCase(r.propertyTitle) || "Property"}</p>
                      <p className="m-0 truncate text-xs text-slate-500">{[r.area, r.propertyStatus === "APPROVED" ? null : `Listing ${String(r.propertyStatus || "").toLowerCase()}`].filter(Boolean).join(" · ") || "-"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="m-0 truncate text-slate-800">{r.ownerName || "Owner"}</p>
                      <p className="m-0 font-mono text-xs text-slate-400">{r.ownerPhone || "No phone"}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-800">{r.terms.capacityStanding ?? "-"}<span className="text-xs text-slate-400"> standing</span></td>
                    <td className="px-4 py-3 tabular-nums text-slate-800">{tsh(r.terms.fullDayPrice ?? r.terms.halfDayPrice)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{r.filledBy === "SALES_PARTNER" ? "Sales partner" : "Owner"}{r.consentCurrent ? <span className="block text-emerald-700">Owner consent {r.ownerConsentVia === "SMS_LINK" ? "by SMS" : "in app"}</span> : null}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      {r.status === "PENDING" && r.problems.length ? <span className="mt-1 block text-[11px] font-semibold text-rose-700">{r.problems.length} required missing</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setOpen(r.ref)} aria-label={`Open ${r.propertyTitle || "event hire"}`} title="Open"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-solid border-slate-200 bg-white text-slate-500 hover:border-[#02665e]/40 hover:bg-[#02665e]/5 hover:text-[#02665e]">
                        <Eye className="size-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {opened ? (
        <ReviewCard key={opened.ref} item={opened} onClose={() => setOpen(null)} onDone={(message) => { setNotice(message); setOpen(null); setVersion((v) => v + 1); }} />
      ) : null}
    </div>
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
                <button type="button" disabled={Boolean(busy)} onClick={() => void decide("RESUME")}
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
                      <button type="button" disabled={Boolean(busy) || !r.consentCurrent || r.problems.length > 0} onClick={() => void decide("APPROVE")}
                        title={r.problems.length ? "Required details are missing. Return it instead." : undefined}
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
