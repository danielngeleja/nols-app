"use client";

/**
 * Admin: one sales partner's record. This is where reviews and actions
 * happen, so it leads with what is waiting for a decision, then splits the
 * rest into tabs: Overview, Agreements, Team and target, ID card.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, BadgeCheck, CheckCircle2, FileSignature, IdCard, Loader2, Lock, MapPin, ShieldAlert,
  ShieldCheck, Users, Wallet, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import PartnerIdCardAdmin, { type AdminIdCard } from "./PartnerIdCardAdmin";
import PartnerTeamAdmin from "./PartnerTeamAdmin";

export type RecordPartner = {
  id: number;
  agentCode: string;
  status: string;
  level: string;
  region: string | null;
  territory: string | null;
  phone: string | null;
  payoutName: string | null;
  payoutMethod: string | null;
  payoutAccount: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  terminatedAt: string | null;
  createdAt: string;
  payoutHoldAt?: string | null;
  payoutHoldReason?: string | null;
  payoutHoldFlags?: Array<{ code: string; message: string }> | null;
  withdrawalOtpLockedAt?: string | null;
  user: { id: number; name: string | null; fullName?: string | null; email: string | null; phone: string | null };
  contracts: Array<{
    id: number;
    contractNumber: string;
    status: string;
    startsAt: string;
    expiresAt: string;
    nrmsCommissionRate: number;
    marketplaceRevenueRate: number;
    signedAt: string | null;
    activatedAt: string | null;
    invitationSentAt: string | null;
    invitationExpiresAt: string | null;
    invitationUsedAt: string | null;
  }>;
  _count: { attributions: number; leads: number; commissions: number; payoutRequests: number };
  idCards?: AdminIdCard[];
};
export type RecordAttention = { payoutsUnderReview: number; flaggedVisits: number; disputedProperties: number; leadsTeam: string | null };
type Access = { status: string; expiresAt: string | null } | null;

type Tab = "overview" | "agreements" | "team" | "card";

const field = "h-10 w-full min-w-0 rounded-md border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-400";
const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-400/15 text-emerald-200",
  PENDING: "bg-amber-400/15 text-amber-200",
  SUSPENDED: "bg-orange-400/15 text-orange-200",
  TERMINATED: "bg-rose-400/15 text-rose-200",
};
const CONTRACT_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800",
  SIGNED: "bg-amber-50 text-amber-800",
  SENT: "bg-sky-50 text-sky-800",
  VIEWED: "bg-sky-50 text-sky-800",
  EXPIRED: "bg-neutral-100 text-neutral-600",
  TERMINATED: "bg-rose-50 text-rose-700",
};

const humanize = (v: string | null | undefined) => {
  const t = String(v || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Unknown";
};
const eatDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "Not yet";
const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
const errorOf = (cause: any, fallback: string) =>
  cause?.response?.data?.require2fa ? "Finance verification is needed. Use Unlock finance at the top, then try again." : cause?.response?.data?.error || fallback;

export default function PartnerRecord({
  partner,
  attention,
  access,
  loading,
  onClose,
  onReload,
  onChanged,
}: {
  partner: RecordPartner | null;
  attention: RecordAttention | null;
  access: Access;
  loading: boolean;
  onClose: () => void;
  onReload: () => void;
  /** After an action that changes the directory (activation). */
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activation, setActivation] = useState({ signatoryName: "", signatoryTitle: "", reason: "" });
  const [resendReason, setResendReason] = useState("");
  const [resumeReason, setResumeReason] = useState("");

  useEffect(() => {
    setTab("overview");
    setError("");
    setNotice("");
    setActivation({ signatoryName: "", signatoryTitle: "", reason: "" });
    setResendReason("");
    setResumeReason("");
  }, [partner?.id]);

  const name = partner ? partner.user.fullName || partner.user.name || partner.user.email || "Partner" : "Partner";
  const now = Date.now();
  const signed = partner?.contracts.find((c) => c.status === "SIGNED") ?? null;
  const deadInvite = partner?.contracts.find(
    (c) => ["SENT", "VIEWED"].includes(c.status) && !c.invitationUsedAt && c.invitationExpiresAt && new Date(c.invitationExpiresAt).getTime() < now,
  ) ?? null;
  const paused = Boolean(partner?.payoutHoldAt || partner?.withdrawalOtpLockedAt);
  const activeCard = partner?.idCards?.find((c) => c.status === "ACTIVE");

  // Everything waiting on an admin, most urgent first.
  const decisions = useMemo(() => {
    if (!partner) return [];
    const out: Array<{ key: string; tone: "rose" | "amber" | "sky"; icon: typeof AlertTriangle; title: string; detail?: string; action?: { label: string; tab?: Tab; href?: string } }> = [];
    if (paused) {
      out.push({
        key: "paused", tone: "rose", icon: Lock,
        title: partner.withdrawalOtpLockedAt && !partner.payoutHoldAt ? "Withdrawals locked after three wrong codes" : "Withdrawals paused",
        detail: (partner.payoutHoldFlags?.map((f) => f.message).join(" ") || partner.payoutHoldReason || "Paused for review") + ` Since ${eatDate(partner.payoutHoldAt || partner.withdrawalOtpLockedAt)}.`,
      });
    }
    if (signed) out.push({ key: "sign", tone: "amber", icon: FileSignature, title: `Agreement ${signed.contractNumber} is signed by the partner`, detail: "Countersign it to open their sales workspace.", action: { label: "Countersign", tab: "agreements" } });
    if (deadInvite) out.push({ key: "invite", tone: "amber", icon: FileSignature, title: "The agreement invitation expired before it was used", detail: "Send a new link; the old one stays dead.", action: { label: "Resend", tab: "agreements" } });
    if (attention?.payoutsUnderReview) out.push({ key: "payouts", tone: "amber", icon: Wallet, title: `${attention.payoutsUnderReview} withdrawal${attention.payoutsUnderReview === 1 ? "" : "s"} waiting for review`, action: { label: "Open Finance", href: "/admin/sales/finance" } });
    if (attention?.flaggedVisits) out.push({ key: "visits", tone: "amber", icon: ShieldAlert, title: `${attention.flaggedVisits} flagged visit${attention.flaggedVisits === 1 ? "" : "s"} waiting for review`, action: { label: "Review", href: "/admin/sales" } });
    if (attention?.disputedProperties) out.push({ key: "disputed", tone: "amber", icon: AlertTriangle, title: `${attention.disputedProperties} propert${attention.disputedProperties === 1 ? "y is" : "ies are"} on hold after an owner said no`, action: { label: "Review", href: "/admin/sales" } });
    if (partner.status === "ACTIVE" && !activeCard) out.push({ key: "card", tone: "sky", icon: IdCard, title: "No ID card yet", detail: "The partner issues it from their portal once they have a profile photo.", action: { label: "ID card", tab: "card" } });
    return out;
  }, [partner, attention, paused, signed, deadInvite, activeCard]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(ok);
      onReload();
      after?.();
    } catch (cause: any) {
      if (cause?.response?.data?.require2fa) window.dispatchEvent(new CustomEvent("finance-grant-required"));
      setError(errorOf(cause, "That did not work. Try again."));
    } finally {
      setBusy("");
    }
  };

  const activate = (contractId: number) => {
    if (activation.signatoryName.trim().length < 3 || activation.signatoryTitle.trim().length < 2 || activation.reason.trim().length < 5) {
      return setError("Enter the countersignatory's name, title and a reason.");
    }
    void run(`activate-${contractId}`, () => apiClient.post(`/api/admin/sales/contracts/${contractId}/activate`, {
      signatoryName: activation.signatoryName.trim(), signatoryTitle: activation.signatoryTitle.trim(), reason: activation.reason.trim(),
    }), `Agreement countersigned. ${partner?.agentCode} can now open the sales workspace.`, onChanged);
  };
  const resend = (contractId: number) => {
    if (resendReason.trim().length < 5) return setError("Give a reason of at least 5 characters.");
    void run(`resend-${contractId}`, () => apiClient.post(`/api/admin/sales/contracts/${contractId}/resend-invitation`, { reason: resendReason.trim() }),
      "A new agreement link was sent. The previous link no longer works.", () => setResendReason(""));
  };
  const resume = () => {
    if (!partner) return;
    if (resumeReason.trim().length < 5) return setError("Write why it is safe to resume (at least 5 characters).");
    void run("resume", () => apiClient.post(`/api/admin/sales/payout-holds/${partner.id}/clear`, { reason: resumeReason.trim() }),
      "Withdrawals resumed. The partner has been told.", () => setResumeReason(""));
  };

  const TABS: Array<{ key: Tab; label: string; icon: typeof Users; count?: number }> = [
    { key: "overview", label: "Overview", icon: ShieldCheck },
    { key: "agreements", label: "Agreements", icon: FileSignature, count: partner?.contracts.length },
    { key: "team", label: "Team and target", icon: Users },
    { key: "card", label: "ID card", icon: IdCard },
  ];

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-neutral-950/45 p-3 sm:p-6" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-partner-record-title"
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-48px)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Record header */}
        <header className="shrink-0 bg-[#0b2420] text-white">
          <div className="flex items-start gap-3 px-5 pt-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-white/10 text-sm font-bold">{initials(name)}</span>
            <div className="min-w-0 flex-1">
              <h2 id="sales-partner-record-title" className="m-0 truncate text-lg font-bold">{loading ? "Loading" : name}</h2>
              {partner ? (
                <>
                  <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className="font-mono text-emerald-300">{partner.agentCode}</span>
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[partner.status] || "bg-white/10 text-white/70"}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{humanize(partner.status)}
                    </span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-white/75">{humanize(partner.level)}</span>
                    {attention?.leadsTeam ? <span className="rounded bg-[#f5c451] px-1.5 py-0.5 text-[11px] font-bold text-[#4a3205]">Team lead · {attention.leadsTeam}</span> : null}
                    {partner.region ? <span className="inline-flex items-center gap-1 text-white/60"><MapPin className="h-3 w-3" />{partner.region}</span> : null}
                  </p>
                  <p className="m-0 mt-1 truncate text-[12px] text-white/55">{partner.user.email || "No email"} · {partner.phone || partner.user.phone || "No phone"}</p>
                </>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-solid border-white/15 bg-white/[0.04] text-white/80 hover:bg-white/10 hover:text-white" aria-label="Close partner record">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto border-0 border-t border-solid border-white/10 px-3" role="tablist" aria-label="Partner record">
            {TABS.map(({ key, label, icon: Icon, count }) => {
              const on = tab === key;
              return (
                <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setTab(key)}
                  className={`relative inline-flex h-10 shrink-0 items-center gap-2 border-0 bg-transparent px-3 text-[13px] font-semibold ${on ? "text-white" : "text-white/50 hover:text-white/80"}`}>
                  <Icon className="h-4 w-4" /> {label}
                  {typeof count === "number" ? <span className={`rounded px-1.5 text-[11px] tabular-nums ${on ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60"}`}>{count}</span> : null}
                  {on ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-emerald-400" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="grid min-h-80 place-items-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !partner ? (
            <div className="grid min-h-80 place-items-center p-8 text-center">
              <div><ShieldCheck className="mx-auto h-9 w-9 text-neutral-300" /><p className="m-0 mt-3 text-sm font-bold text-neutral-700">Partner information is unavailable</p><p className="m-0 mt-1 text-xs text-neutral-500">Close this window and open the record again.</p></div>
            </div>
          ) : (
            <div className="space-y-4 p-5">
              {error ? <p className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
              {notice ? <p className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

              {/* Needs your decision */}
              <section className="overflow-hidden rounded-lg border border-solid border-neutral-200">
                <p className="m-0 border-0 border-b border-solid border-neutral-100 bg-neutral-50 px-4 py-2 text-[12px] font-semibold text-neutral-700">
                  {decisions.filter((d) => d.tone !== "sky").length ? "Needs your decision" : "Status"}
                </p>
                {decisions.length === 0 ? (
                  <p className="m-0 flex items-center gap-2 px-4 py-3 text-[13px] text-emerald-800"><BadgeCheck className="h-4 w-4" /> Nothing is waiting on you for this partner.</p>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {decisions.map((d) => {
                      const tone = d.tone === "rose" ? "text-rose-700 bg-rose-50" : d.tone === "amber" ? "text-amber-800 bg-amber-50" : "text-sky-800 bg-sky-50";
                      return (
                        <li key={d.key} className="border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0">
                          <div className="flex flex-wrap items-start gap-3">
                            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${tone}`}><d.icon className="h-4 w-4" /></span>
                            <div className="min-w-0 flex-1">
                              <p className="m-0 text-[13px] font-semibold text-neutral-900">{d.title}</p>
                              {d.detail ? <p className="m-0 mt-0.5 text-[12px] text-neutral-600">{d.detail}</p> : null}
                            </div>
                            {d.action?.tab ? (
                              <button type="button" onClick={() => setTab(d.action!.tab!)} className="inline-flex h-8 items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">
                                {d.action.label} <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                            ) : d.action?.href ? (
                              <Link href={d.action.href} className="inline-flex h-8 items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 no-underline hover:bg-neutral-50 hover:no-underline">
                                {d.action.label} <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            ) : null}
                          </div>
                          {d.key === "paused" ? (
                            <div className="mt-2 flex flex-wrap gap-2 sm:pl-11">
                              <input className={`${field} flex-1`} value={resumeReason} onChange={(e) => setResumeReason(e.target.value)} placeholder="Why it is safe to resume (kept in the audit log)" aria-label="Reason to resume withdrawals" />
                              <button type="button" onClick={resume} disabled={busy === "resume"} className="inline-flex h-10 items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                                {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Resume withdrawals
                              </button>
                              <p className="m-0 w-full text-[11px] text-neutral-500">Needs your finance code.</p>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {tab === "overview" ? (
                <>
                  <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-4">
                    {[
                      { label: "Leads", value: partner._count.leads },
                      { label: "Properties attributed", value: partner._count.attributions },
                      { label: "Commission entries", value: partner._count.commissions },
                      { label: "Withdrawals", value: partner._count.payoutRequests },
                    ].map((f) => (
                      <div key={f.label} className="bg-white px-4 py-3">
                        <p className="m-0 text-[12px] text-neutral-500">{f.label}</p>
                        <p className="m-0 mt-0.5 text-xl font-bold tabular-nums text-neutral-900">{f.value.toLocaleString("en-US")}</p>
                      </div>
                    ))}
                  </section>
                  <section className="grid gap-x-6 rounded-lg border border-solid border-neutral-200 px-4 py-1 sm:grid-cols-2">
                    {[
                      ["Region", partner.region || "Not set"],
                      ["Territory", partner.territory || "Not set"],
                      ["Joined NoLSAF sales", eatDate(partner.createdAt)],
                      ["Workspace opened", eatDate(partner.activatedAt)],
                      ["Workspace access", access ? `${humanize(access.status)}${access.expiresAt ? ` until ${eatDate(access.expiresAt)}` : ""}` : "Not granted"],
                      ["Current agreement", partner.contracts.find((c) => c.status === "ACTIVE")?.contractNumber || "None active"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-baseline justify-between gap-3 border-0 border-b border-solid border-neutral-100 py-2.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                        <span className="text-[12px] text-neutral-500">{label}</span>
                        <span className="truncate text-right text-[13px] font-semibold text-neutral-800">{value}</span>
                      </div>
                    ))}
                  </section>
                  <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-solid border-neutral-200 px-4 py-3">
                    <div className="min-w-0">
                      <p className="m-0 text-[12px] text-neutral-500">Payout destination</p>
                      <p className="m-0 mt-0.5 text-[13px] font-semibold text-neutral-800">
                        {partner.payoutMethod ? `${partner.payoutName || "Account holder"} · ${partner.payoutMethod} · ending ${partner.payoutAccount || "not set"}` : "Not added yet"}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600"><Lock className="h-3 w-3" /> Locked, verified by name lookup</span>
                  </section>
                </>
              ) : null}

              {tab === "agreements" ? (
                <section className="overflow-hidden rounded-lg border border-solid border-neutral-200">
                  {partner.contracts.length === 0 ? (
                    <p className="m-0 px-4 py-8 text-center text-sm text-neutral-500">No agreements yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] border-collapse text-left">
                        <thead className="bg-neutral-50">
                          <tr>
                            {["Agreement", "Period", "Rates", "Status"].map((h) => <th key={h} className="px-4 py-2.5 text-[11px] font-semibold text-neutral-500">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {partner.contracts.map((c) => (
                            <Fragment key={c.id}>
                              <tr className="border-0 border-t border-solid border-neutral-100 align-top">
                                <td className="px-4 py-3">
                                  <p className="m-0 font-mono text-[12px] font-semibold text-neutral-900">{c.contractNumber}</p>
                                  {c.invitationSentAt ? <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Link {c.invitationUsedAt ? "used" : `valid until ${eatDate(c.invitationExpiresAt)}`}</p> : null}
                                </td>
                                <td className="px-4 py-3 text-[12px] text-neutral-600">{eatDate(c.startsAt)} to {eatDate(c.expiresAt)}</td>
                                <td className="px-4 py-3 text-[12px] text-neutral-600">NRMS {Number(c.nrmsCommissionRate)}%<br />Marketplace {Number(c.marketplaceRevenueRate)}%</td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${CONTRACT_TONE[c.status] || "bg-neutral-100 text-neutral-600"}`}>
                                    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{humanize(c.status)}
                                  </span>
                                </td>
                              </tr>
                              {c.status === "SIGNED" ? (
                                <tr>
                                  <td colSpan={4} className="px-4 pb-4">
                                    <div className="rounded-md border border-solid border-amber-200 bg-amber-50 p-3">
                                      <p className="m-0 text-[13px] font-semibold text-amber-900">Countersign and open the workspace</p>
                                      <p className="m-0 mt-0.5 text-[12px] text-amber-800">Signed by the partner {eatDate(c.signedAt)}. Your name and title are added to the agreement PDF.</p>
                                      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                                        <input className={field} value={activation.signatoryName} onChange={(e) => setActivation({ ...activation, signatoryName: e.target.value })} placeholder="Your full name" aria-label="Countersignatory name" />
                                        <input className={field} value={activation.signatoryTitle} onChange={(e) => setActivation({ ...activation, signatoryTitle: e.target.value })} placeholder="Your title" aria-label="Countersignatory title" />
                                        <input className={field} value={activation.reason} onChange={(e) => setActivation({ ...activation, reason: e.target.value })} placeholder="Reason (kept in the audit log)" aria-label="Activation reason" />
                                        <button type="button" onClick={() => activate(c.id)} disabled={busy === `activate-${c.id}`} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3.5 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                                          {busy === `activate-${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Countersign and activate
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                              {["SENT", "VIEWED"].includes(c.status) ? (
                                <tr>
                                  <td colSpan={4} className="px-4 pb-4">
                                    <div className="rounded-md border border-solid border-sky-200 bg-sky-50 p-3">
                                      <p className="m-0 text-[13px] font-semibold text-sky-900">Send a new agreement link</p>
                                      <p className="m-0 mt-0.5 text-[12px] text-sky-800">The previous link stops working at once.</p>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        <input className={`${field} flex-1`} value={resendReason} onChange={(e) => setResendReason(e.target.value)} placeholder="Reason (kept in the audit log)" aria-label="Reason to resend" />
                                        <button type="button" onClick={() => resend(c.id)} disabled={busy === `resend-${c.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-solid border-sky-300 bg-white px-3 text-[13px] font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50">
                                          {busy === `resend-${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />} Resend
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : null}

              {tab === "team" ? <PartnerTeamAdmin partnerId={partner.id} partnerActive={partner.status === "ACTIVE"} /> : null}
              {tab === "card" ? <PartnerIdCardAdmin partnerId={partner.id} cards={partner.idCards} onChanged={onReload} /> : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
