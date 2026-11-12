"use client";

/**
 * Admin: a partner's Agency Desk, inside the partner record. The only place the
 * capability is granted. Leads with what matters: can this partner hold it and
 * what blocks it, where they are in the lifecycle, what the rate means in
 * shillings, and what they have done with it. Grant, rate change and reopen
 * need the finance code; pause and end take effect at once. Every action needs
 * a reason and is audited on the server.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Handshake, Link2, Loader2, PauseCircle, PlayCircle, ShieldAlert, Users, Wallet, X, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Capability = {
  status: "PENDING_ACCEPTANCE" | "ACTIVE" | "SUSPENDED" | "REVOKED";
  stayRate: number;
  maxActiveLinks: number;
  grantReason: string;
  grantedAt: string;
  acceptedAt: string | null;
  acceptedName: string | null;
  suspendedAt: string | null;
  revokedAt: string | null;
  statusReason: string | null;
};
type Check = { key: string; label: string; ok: boolean; detail: string | null };
type Activity = {
  linksLive: number; linksTotal: number; bookingsCredited: number; bookingsBlocked: number; bookingsVoided: number;
  groupsWaitingClient: number; groupsConfirmed: number; groupsCancelled: number; clients: number;
  earnedLive: number; earnedPaid: number; earnedReversed: number;
  recentBookings: Array<{ reference?: string; property: string; checkIn: string | null; total: number | null; bookingStatus: string | null; credit: string; blockedReason: string | null; at: string }>;
  toursCredited?: number;
  recentTours?: Array<{ bookingCode?: string | null; title: string; startDate: string | null; travelers: number | null; tourStatus: string | null; total: number | null; currency: string; credit: string; blockedReason: string | null; at: string }>;
  recentGroups: Array<{ reference: string; client: string; destination: string | null; people: number | null; request: string; shortlist: string; stage: string | null; total: number | null; at: string }>;
};
type State = {
  enabled: boolean;
  capability: Capability | null;
  eligibilityProblem: string | null;
  checks: Check[];
  contractExpiresAt: string | null;
  activity: Activity | null;
  rateBounds: { min: number; max: number };
};

const card = "overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white";
const head = "m-0 border-0 border-b border-solid border-neutral-100 bg-neutral-50 px-4 py-2 text-[12px] font-semibold text-neutral-700";
const field = "h-10 w-full min-w-0 rounded-md border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-400";
const btn = "inline-flex h-10 items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-white px-3 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const primary = "inline-flex h-10 items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3.5 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const th = "px-3 py-2 text-left text-[11px] font-semibold text-neutral-500";
const td = "px-3 py-2.5 align-top text-[13px] text-neutral-700";

const STATUS: Record<Capability["status"], { label: string; tone: string }> = {
  PENDING_ACCEPTANCE: { label: "Waiting for the partner to accept", tone: "bg-amber-50 text-amber-800" },
  ACTIVE: { label: "Live", tone: "bg-emerald-50 text-emerald-800" },
  SUSPENDED: { label: "Paused", tone: "bg-orange-50 text-orange-800" },
  REVOKED: { label: "Ended", tone: "bg-rose-50 text-rose-700" },
};

const eatDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-";
const money = (v: number | null | undefined) => (v == null ? "-" : `TSh ${Math.round(Number(v)).toLocaleString("en-US")}`);
const words = (v: string | null | undefined) => {
  const t = String(v || "").replace(/_/g, " ").toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "-";
};

/** Same colour per measure as the partner's own Agency Desk overview. */
const TONE_HEX = { blue: "#2a78d6", orange: "#eb6834", violet: "#6250d6", amber: "#eda100" } as const;
const TONE_CHIP: Record<keyof typeof TONE_HEX, string> = {
  blue: "bg-[#2a78d6]/10 text-[#2a78d6]",
  orange: "bg-[#eb6834]/10 text-[#d1531f]",
  violet: "bg-[#6250d6]/10 text-[#6250d6]",
  amber: "bg-[#eda100]/15 text-[#a86f00]",
};

/**
 * A figure with a thin segmented bar under it: how the number splits (stays vs
 * tours, paid vs not yet paid), or how much of a limit is used. Segments with
 * a value are listed in a legend so colour is never the only cue.
 */
function AgencyFigure({ icon: Icon, tone, label, value, sub, bar, barTotal }: {
  icon: typeof Wallet; tone: keyof typeof TONE_HEX; label: string; value: React.ReactNode; sub: string;
  bar: Array<{ value: number; color: string; label: string }>; barTotal?: number;
}) {
  const sum = bar.reduce((s, b) => s + Math.max(0, b.value), 0);
  const total = Math.max(1, barTotal ?? sum);
  const shown = bar.filter((b) => b.value > 0);
  return (
    <div className="flex min-w-0 flex-col bg-white px-4 py-3.5 transition-colors hover:bg-neutral-50/70">
      <p className="m-0 flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-neutral-500">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${TONE_CHIP[tone]}`}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
        <span className="truncate">{label}</span>
      </p>
      <p className="m-0 mt-2 truncate text-xl font-bold tabular-nums text-neutral-900">{value}</p>
      <p className="m-0 truncate text-[11px] text-neutral-500" title={sub}>{sub}</p>
      <div className="mt-auto pt-3">
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={`${label}: ${shown.map((b) => `${b.label} ${b.value}`).join(", ") || "none yet"}`}>
          {shown.map((b) => (
            <span key={b.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(b.value / total) * 100}%`, background: b.color }} title={`${b.label}: ${b.value}`} />
          ))}
        </div>
        <p className="m-0 mt-1 flex min-h-[14px] flex-wrap gap-x-2.5 text-[10px] text-neutral-500">
          {shown.length > 1 || barTotal ? shown.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-sm" style={{ background: b.color }} aria-hidden />{b.label}</span>
          )) : null}
          {!shown.length ? <span>Nothing yet</span> : null}
        </p>
      </div>
    </div>
  );
}

/** Worked example used in the grant panel: a TSh 2.4M group at a 10% NoLSAF commission, about 12% tax and processing. */
const EXAMPLE_GROUP = 2_400_000;
const EXAMPLE_NET = Math.round(EXAMPLE_GROUP * 0.1 * 0.88);

export default function PartnerAgencyAdmin({ partnerId, agentCode }: { partnerId: number; agentCode: string }) {
  const [state, setState] = useState<State | null>(null);
  const [rate, setRate] = useState("25");
  const [maxLinks, setMaxLinks] = useState("20");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/api/admin/sales/partners/${partnerId}/agency`);
      setState(data);
      if (data?.capability) {
        setRate(String(data.capability.stayRate));
        setMaxLinks(String(data.capability.maxActiveLinks));
      }
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load the Agency Desk.");
    }
  }, [partnerId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, path: string, body: Record<string, unknown>, done: string) => {
    if (reason.trim().length < 5) return setError("Give a reason of at least 5 characters.");
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/sales/partners/${partnerId}/agency/${path}`, { ...body, reason: reason.trim() });
      setNotice(done);
      setReason("");
      setEditing(false);
      await load();
    } catch (cause: any) {
      if (cause?.response?.data?.require2fa) {
        window.dispatchEvent(new CustomEvent("finance-grant-required"));
        setError("Finance verification is needed. Use Unlock finance at the top, then try again.");
      } else {
        setError(cause?.response?.data?.error || "That did not work.");
      }
    } finally {
      setBusy("");
    }
  };

  // Void a credited stay (by its bk_ reference) or tour (by its booking code): finance code, reason required.
  const voidCredit = async (kind: "stay" | "tour", key: string) => {
    if (voidReason.trim().length < 5) return setError("Give a reason of at least 5 characters.");
    setBusy(`void-${key}`);
    setError("");
    setNotice("");
    try {
      if (kind === "stay") await apiClient.post(`/api/admin/sales/partners/${partnerId}/agency/bookings/void`, { bookingRef: key, reason: voidReason.trim() });
      else await apiClient.post("/api/admin/sales/agency/tours/void", { bookingCode: key, reason: voidReason.trim() });
      setNotice("Credit voided. Any commission on it was reversed or will come off the next payout.");
      setVoiding(null);
      setVoidReason("");
      await load();
    } catch (cause: any) {
      if (cause?.response?.data?.require2fa) {
        window.dispatchEvent(new CustomEvent("finance-grant-required"));
        setError("Finance verification is needed. Use Unlock finance at the top, then try again.");
      } else setError(cause?.response?.data?.error || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const voidCell = (kind: "stay" | "tour", key: string | null | undefined, credit: string) => {
    if (!key || credit === "VOID") return <span className="text-neutral-400">-</span>;
    if (voiding !== key) {
      return <button type="button" onClick={() => { setVoiding(key); setVoidReason(""); }} className="inline-flex h-8 items-center rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">Void</button>;
    }
    return (
      <div className="flex min-w-[200px] flex-col gap-1.5">
        <input className="h-8 rounded-md border border-solid border-neutral-200 px-2 text-[12px] outline-none focus:border-emerald-400" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason (kept in the audit log)" />
        <div className="flex gap-1.5">
          <button type="button" disabled={!!busy || voidReason.trim().length < 5} onClick={() => void voidCredit(kind, key)} className="inline-flex h-8 items-center rounded-md border border-solid border-rose-200 bg-white px-2.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
            {busy === `void-${key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Void (finance code)"}
          </button>
          <button type="button" onClick={() => setVoiding(null)} className="inline-flex h-8 items-center rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700">Back</button>
        </div>
      </div>
    );
  };

  if (!state) {
    return error
      ? <p className="m-0 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</p>
      : <div className="grid min-h-40 place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const cap = state.capability;
  const held = !!cap && cap.status !== "REVOKED";
  const rateNumber = Number(rate);
  const rateValid = Number.isFinite(rateNumber) && rateNumber >= state.rateBounds.min && rateNumber <= state.rateBounds.max;
  const eligible = !state.eligibilityProblem;
  const failing = state.checks.filter((c) => !c.ok);
  const a = state.activity;

  // Lifecycle: selected -> addendum accepted -> live.
  const steps = [
    { label: "Selected by NoLSAF", done: !!cap, at: cap?.grantedAt ?? null },
    { label: "Addendum accepted", done: !!cap?.acceptedAt, at: cap?.acceptedAt ?? null, sub: cap?.acceptedName ? `by ${cap.acceptedName}` : null },
    { label: "Desk live", done: cap?.status === "ACTIVE" && failing.length === 0, at: null },
  ];

  const reasonBox = (placeholder: string) => (
    <label className="block text-[12px] text-neutral-500">Reason (kept in the audit log)
      <input className={`${field} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
    </label>
  );

  return (
    <div className="space-y-4">
      {error ? <p className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
      {notice ? <p className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

      {/* Where the desk stands */}
      <section className={card}>
        <div className="flex flex-wrap items-start gap-3 px-4 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100"><Handshake className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-bold text-neutral-900">
              Agency Desk
              <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-neutral-700">{agentCode}</span>
            </p>
            {!cap ? (
              <p className="m-0 mt-1 text-[12px] text-neutral-500">Not granted. Only NoLSAF selects partners for the desk; nobody can apply.</p>
            ) : cap.status === "REVOKED" ? (
              <p className="m-0 mt-1 text-[12px] text-neutral-500">Ended {eatDate(cap.revokedAt)}. It can be granted again.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                <span className="inline-flex items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2 py-1 text-neutral-600"><Wallet className="h-3.5 w-3.5 text-[#2a78d6]" aria-hidden /><span className="font-semibold tabular-nums text-neutral-900">{cap.stayRate}%</span> of NoLSAF net revenue</span>
                <span className="inline-flex items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2 py-1 text-neutral-600"><Link2 className="h-3.5 w-3.5 text-[#b07600]" aria-hidden />Up to <span className="font-semibold tabular-nums text-neutral-900">{cap.maxActiveLinks}</span> live links</span>
                <span className="inline-flex items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2 py-1 text-neutral-600">Stays, groups and tours</span>
              </div>
            )}
          </div>
          {cap ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset ${STATUS[cap.status].tone} ${cap.status === "ACTIVE" ? "ring-emerald-200" : cap.status === "PENDING_ACCEPTANCE" ? "ring-amber-200" : cap.status === "SUSPENDED" ? "ring-orange-200" : "ring-rose-200"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${cap.status === "ACTIVE" ? "animate-pulse bg-emerald-500" : cap.status === "PENDING_ACCEPTANCE" ? "bg-amber-500" : cap.status === "SUSPENDED" ? "bg-orange-500" : "bg-rose-500"}`} aria-hidden />
              {STATUS[cap.status].label}
            </span>
          ) : <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] font-semibold text-neutral-600">Not granted</span>}
        </div>

        {held ? (
          <ol className="m-0 grid list-none grid-cols-1 border-0 border-t border-solid border-neutral-100 p-0 px-4 py-4 sm:grid-cols-3" aria-label="Desk lifecycle">
            {steps.map((s, i) => {
              const next = steps[i + 1];
              return (
                <li key={s.label} className="relative flex items-start gap-3 pb-4 last:pb-0 sm:block sm:pb-0 sm:pr-4">
                  {/* Connector to the next step: down on phones, across on wider screens */}
                  {next ? (
                    <>
                      <span className={`absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5 sm:hidden ${next.done ? "bg-emerald-500" : "bg-neutral-200"}`} aria-hidden />
                      <span className={`absolute left-8 right-1 top-[13px] hidden h-0.5 sm:block ${next.done ? "bg-emerald-500" : "bg-neutral-200"}`} aria-hidden />
                    </>
                  ) : null}
                  <span className={`relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold ${s.done ? "bg-emerald-600 text-white" : "border-2 border-solid border-neutral-300 bg-white text-neutral-400"}`}>
                    {s.done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                  </span>
                  <div className="min-w-0 sm:mt-2">
                    <p className={`m-0 text-[13px] font-semibold ${s.done ? "text-neutral-900" : "text-neutral-500"}`}>{s.label}</p>
                    <p className="m-0 text-[11px] text-neutral-500">{s.at ? eatDate(s.at) : s.done ? "Now" : "Not yet"}{s.sub ? ` ${s.sub}` : ""}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        {cap?.statusReason || cap?.grantReason ? (
          <div className="flex items-start gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-2.5 text-[12px] text-neutral-600">
            <span className="shrink-0 font-semibold text-neutral-700">Last reason</span>
            <q className="min-w-0 italic text-neutral-700 [overflow-wrap:anywhere]">{cap.statusReason || cap.grantReason}</q>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* What the partner has done with it */}
          {a ? (
            <>
              <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 lg:grid-cols-4" aria-label="Agency activity">
                <AgencyFigure icon={Link2} tone="amber" label="Booking links" value={<>{a.linksLive} <span className="text-[13px] font-semibold text-neutral-400">/ {cap?.maxActiveLinks ?? "-"} live</span></>}
                  sub={`${a.linksTotal} made in total`}
                  bar={[{ value: a.linksLive, color: TONE_HEX.amber, label: "Live" }]} barTotal={Math.max(1, cap?.maxActiveLinks ?? a.linksLive)} />
                <AgencyFigure icon={CheckCircle2} tone="orange" label="Credited" value={a.bookingsCredited + (a.toursCredited ?? 0)}
                  sub={`${a.bookingsCredited} stays · ${a.toursCredited ?? 0} tours${a.bookingsVoided ? ` · ${a.bookingsVoided} voided` : ""}`}
                  bar={[{ value: a.bookingsCredited, color: TONE_HEX.orange, label: "Stays" }, { value: a.toursCredited ?? 0, color: "#f4a582", label: "Tours" }, { value: a.bookingsBlocked, color: "#e34948", label: "Blocked" }]} />
                <AgencyFigure icon={Users} tone="violet" label="Group stays" value={a.groupsConfirmed}
                  sub={`${a.groupsWaitingClient} waiting · ${a.clients} client${a.clients === 1 ? "" : "s"}`}
                  bar={[{ value: a.groupsConfirmed, color: TONE_HEX.violet, label: "Confirmed" }, { value: a.groupsWaitingClient, color: "#a99cf0", label: "Waiting" }, { value: a.groupsCancelled, color: "#d4d4d4", label: "Cancelled" }]} />
                <AgencyFigure icon={Wallet} tone="blue" label="Agency earnings" value={money(a.earnedLive)}
                  sub={`Paid ${money(a.earnedPaid)}${a.earnedReversed ? ` · reversed ${money(a.earnedReversed)}` : ""}`}
                  bar={[{ value: a.earnedPaid, color: TONE_HEX.blue, label: "Paid" }, { value: Math.max(0, a.earnedLive - a.earnedPaid), color: "#9cc3f0", label: "Not paid yet" }]} />
              </section>

              {a.bookingsBlocked ? (
                <p className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {a.bookingsBlocked} booking{a.bookingsBlocked === 1 ? " was" : "s were"} blocked as the partner's own stay or property. Nothing was earned on {a.bookingsBlocked === 1 ? "it" : "them"}; check the pattern below.
                </p>
              ) : null}

              <section className={card}>
                <p className={head}>Latest bookings from their links</p>
                {a.recentBookings.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse">
                      <thead><tr>{["Property", "Check-in", "Booking", "Credit", "Credited", ""].map((h) => <th key={h || "action"} className={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {a.recentBookings.map((b, i) => (
                          <tr key={`${b.at}-${i}`} className="border-0 border-t border-solid border-neutral-100">
                            <td className={td}><span className="font-semibold text-neutral-900">{b.property}</span>{b.total ? <span className="block text-[11px] text-neutral-500">{money(b.total)}</span> : null}</td>
                            <td className={td}>{eatDate(b.checkIn)}</td>
                            <td className={td}>{words(b.bookingStatus)}</td>
                            <td className={td}>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${b.credit === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{b.credit === "ACTIVE" ? "Credited" : words(b.credit)}</span>
                              {b.blockedReason ? <span className="mt-0.5 block text-[11px] text-rose-700">{b.blockedReason}</span> : null}
                            </td>
                            <td className={td}>{eatDate(b.at)}</td>
                            <td className={td}>{voidCell("stay", b.reference, b.credit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="m-0 px-4 py-6 text-center text-sm text-neutral-500">No bookings through their links yet.</p>}
              </section>

              <section className={card}>
                <p className={head}>Latest tours they referred</p>
                {a.recentTours?.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse">
                      <thead><tr>{["Tour", "Date", "People", "Tour status", "Credit", "Credited", ""].map((h) => <th key={h || "action"} className={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {a.recentTours.map((t, i) => (
                          <tr key={`${t.at}-${i}`} className="border-0 border-t border-solid border-neutral-100">
                            <td className={td}><span className="font-semibold text-neutral-900">{t.title}</span>{t.total ? <span className="block text-[11px] text-neutral-500">{t.currency === "TZS" ? money(t.total) : `${t.currency} ${Math.round(t.total).toLocaleString("en-US")}`}</span> : null}</td>
                            <td className={td}>{eatDate(t.startDate)}</td>
                            <td className={td}>{t.travelers ?? "-"}</td>
                            <td className={td}>{words(t.tourStatus)}</td>
                            <td className={td}>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${t.credit === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{t.credit === "ACTIVE" ? "Credited" : words(t.credit)}</span>
                              {t.blockedReason ? <span className="mt-0.5 block text-[11px] text-rose-700">{t.blockedReason}</span> : null}
                            </td>
                            <td className={td}>{eatDate(t.at)}</td>
                            <td className={td}>{voidCell("tour", t.bookingCode, t.credit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="m-0 px-4 py-6 text-center text-sm text-neutral-500">No tours referred yet.</p>}
              </section>

              <section className={card}>
                <p className={head}>Latest group stays they coordinated</p>
                {a.recentGroups.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse">
                      <thead><tr>{["Client", "Destination", "People", "Where it stands", "Total", "Started"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {a.recentGroups.map((g) => (
                          <tr key={g.reference} className="border-0 border-t border-solid border-neutral-100">
                            <td className={`${td} font-semibold text-neutral-900`}>{g.client}</td>
                            <td className={td}>{g.destination || "-"}</td>
                            <td className={td}>{g.people ?? "-"}</td>
                            <td className={td}>
                              {g.request !== "CONFIRMED" ? words(g.request === "AWAITING_CLIENT" ? "WAITING_FOR_CLIENT" : g.request) : words(g.stage)}
                              {g.shortlist === "PENDING_REVIEW" ? <span className="mt-0.5 block text-[11px] text-amber-800">Shortlist waiting for NoLSAF</span> : null}
                            </td>
                            <td className={`${td} tabular-nums`}>{money(g.total)}</td>
                            <td className={td}>{eatDate(g.at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="m-0 px-4 py-6 text-center text-sm text-neutral-500">No group stays yet.</p>}
              </section>
            </>
          ) : (
            <section className={card}>
              <p className={head}>What the partner gets with the desk</p>
              <ul className="m-0 list-none space-y-2 px-4 py-3 text-[13px] text-neutral-700">
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Signed booking links. Clients book and pay NoLSAF themselves; the partner never touches money.</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />A client book, protected for 12 months, renewed by logged contact.</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Group stays: the client confirms from a verified phone, owners bid, the partner shortlists, the client pays in full.</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Earnings on NoLSAF's net revenue only after the stay. Nothing on their own stays or properties.</li>
              </ul>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {/* Readiness: what the desk depends on */}
          <section className={card}>
            <p className={head}>{held ? "Desk is open only while all of these hold" : "Before you can grant it"}</p>
            <ul className="m-0 list-none p-0">
              {state.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2.5 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 first:border-t-0">
                  {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                  <div className="min-w-0">
                    <p className={`m-0 text-[13px] font-semibold ${c.ok ? "text-neutral-800" : "text-rose-700"}`}>{c.label}</p>
                    <p className="m-0 text-[11px] text-neutral-500">
                      {c.key === "contract" && c.ok ? `Runs until ${eatDate(state.contractExpiresAt)}` : c.detail || "OK"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {held && failing.length ? (
              <p className="m-0 border-0 border-t border-solid border-rose-100 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-800">The desk is closed for this partner until the items in red are fixed.</p>
            ) : null}
          </section>

          {/* Grant */}
          {!held ? (
            <section className={card}>
              <p className={head}>Grant the Agency Desk</p>
              <div className="space-y-3 px-4 py-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[12px] text-neutral-500">Rate (%)
                    <input className={`${field} mt-1`} value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} inputMode="decimal" />
                  </label>
                  <label className="block text-[12px] text-neutral-500">Live links
                    <input className={`${field} mt-1`} value={maxLinks} onChange={(e) => setMaxLinks(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" />
                  </label>
                </div>
                <p className="m-0 rounded-md bg-neutral-50 px-3 py-2 text-[12px] text-neutral-600">
                  {rateValid
                    ? <>On a {money(EXAMPLE_GROUP)} group stay, NoLSAF keeps about {money(EXAMPLE_NET)} net and the partner earns about <strong className="text-neutral-900">{money(EXAMPLE_NET * (rateNumber / 100))}</strong>.</>
                    : `Rate must be between ${state.rateBounds.min}% and ${state.rateBounds.max}%.`}
                </p>
                {reasonBox("Why this partner")}
                <button type="button" className={`${primary} w-full justify-center`} disabled={!!busy || !rateValid || !eligible}
                  onClick={() => void run("grant", "grant", { stayRate: rateNumber, maxActiveLinks: Number(maxLinks) || 20 }, "Granted. The partner must accept the addendum before the desk opens.")}>
                  {busy === "grant" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />} Grant Agency Desk
                </button>
                <p className="m-0 text-[11px] text-neutral-500">{eligible ? "Needs your finance code. The partner is notified and must accept the addendum." : "Fix the items in red first."}</p>
              </div>
            </section>
          ) : (
            <section className={card}>
              <p className={head}>Manage</p>
              <div className="space-y-3 px-4 py-3">
                {editing ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[12px] text-neutral-500">Rate (%)
                      <input className={`${field} mt-1`} value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} inputMode="decimal" />
                    </label>
                    <label className="block text-[12px] text-neutral-500">Live links
                      <input className={`${field} mt-1`} value={maxLinks} onChange={(e) => setMaxLinks(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" />
                    </label>
                  </div>
                ) : null}
                {reasonBox(editing ? "Why the change" : "Why")}
                <div className="flex flex-wrap gap-2">
                  {editing ? (
                    <>
                      <button type="button" className={primary} disabled={!!busy || !rateValid}
                        onClick={() => void run("rate", "rate", { stayRate: rateNumber, maxActiveLinks: Number(maxLinks) || undefined }, "Saved. A new rate sends the partner back to accept the addendum.")}>
                        {busy === "rate" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
                      </button>
                      <button type="button" className={btn} onClick={() => { setEditing(false); setRate(String(cap!.stayRate)); setMaxLinks(String(cap!.maxActiveLinks)); }}><X className="h-4 w-4" />Cancel</button>
                    </>
                  ) : (
                    <button type="button" className={btn} onClick={() => setEditing(true)}>Change rate or limit</button>
                  )}
                  {cap && ["ACTIVE", "PENDING_ACCEPTANCE"].includes(cap.status) ? (
                    <button type="button" className={btn} disabled={!!busy} onClick={() => void run("suspend", "suspend", {}, "Paused. Links no longer credit bookings.")}>
                      {busy === "suspend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />} Pause
                    </button>
                  ) : null}
                  {cap?.status === "SUSPENDED" ? (
                    <button type="button" className={btn} disabled={!!busy} onClick={() => void run("reinstate", "reinstate", {}, "Reopened.")}>
                      {busy === "reinstate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Reopen
                    </button>
                  ) : null}
                  <button type="button" className={`${btn} text-rose-700`} disabled={!!busy} onClick={() => void run("revoke", "revoke", {}, "Ended. Every link is closed.")}>
                    {busy === "revoke" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} End
                  </button>
                </div>
                <p className="m-0 text-[11px] text-neutral-500">Rate changes and reopening need your finance code. Pause and end take effect at once.</p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
