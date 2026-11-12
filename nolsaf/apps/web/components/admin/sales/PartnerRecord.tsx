"use client";

/**
 * Admin: one sales partner's record. This is where reviews and actions
 * happen, so it leads with what is waiting for a decision, then splits the
 * rest into tabs: Overview, Agreements, Team and target, ID card.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, BadgeCheck, Building2, CheckCircle2, Coins, FileSignature, Footprints, Handshake, History, IdCard, ListChecks, Loader2, Lock, MapPin,
  PauseCircle, PlayCircle, Send, ShieldAlert, ShieldCheck, Users, Wallet, X,
} from "lucide-react";
import AdminReasonDialog from "./AdminReasonDialog";
import apiClient from "@/lib/apiClient";
import PartnerIdCardAdmin, { type AdminIdCard, type CardReadiness, cardGapText } from "./PartnerIdCardAdmin";
import PartnerTeamAdmin from "./PartnerTeamAdmin";
import PartnerAgencyAdmin from "./PartnerAgencyAdmin";
import PartnerFileSection, { PartnerAccountFacts, usePartnerFile, type FileSection } from "./PartnerFile";

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
export type RecordAttention = {
  payoutsUnderReview: number;
  flaggedVisits: number;
  disputedProperties: number;
  leadsTeam: string | null;
  card?: CardReadiness;
  /** Admin-only: when and why the partner was suspended. Never shown to the partner. */
  suspension?: { at: string | null; reason: string | null } | null;
};
type Access = { status: string; expiresAt: string | null } | null;

type Tab = "overview" | "agreements" | FileSection | "team" | "card" | "agency";

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
  initialTab = "overview",
}: {
  /** Open on a tab, e.g. "card" from an ID card photo alert. */
  initialTab?: Tab;
  partner: RecordPartner | null;
  attention: RecordAttention | null;
  access: Access;
  loading: boolean;
  onClose: () => void;
  onReload: () => void;
  /** After an action that changes the directory (activation). */
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activation, setActivation] = useState({ signatoryName: "", signatoryTitle: "", reason: "" });
  const [resendReason, setResendReason] = useState("");
  const [resumeReason, setResumeReason] = useState("");
  const [statusDialog, setStatusDialog] = useState<"suspend" | "reinstate" | null>(null);
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    setTab(initialTab);
    setStatusDialog(null);
    setStatusError("");
    setError("");
    setNotice("");
    setActivation({ signatoryName: "", signatoryTitle: "", reason: "" });
    setResendReason("");
    setResumeReason("");
  }, [partner?.id]);

  // The partner's whole file (leads, visits, properties, ledger, withdrawals, history), reloaded with the record.
  const file = usePartnerFile(partner?.id ?? null, partner);
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
    const out: Array<{ key: string; tone: "rose" | "amber" | "sky"; icon: typeof AlertTriangle; title: string; detail?: string; action?: { label: string; tab?: Tab; href?: string; onClick?: () => void } }> = [];
    if (partner.status === "SUSPENDED") {
      out.push({
        key: "suspended", tone: "rose", icon: PauseCircle,
        title: "Partner suspended",
        detail: `Since ${eatDate(attention?.suspension?.at || partner.suspendedAt)}. Sales portal closed, ID card not verifying, payouts not sent.${attention?.suspension?.reason ? ` Reason: ${attention.suspension.reason} (not shown to the partner).` : ""}`,
        action: { label: "Reinstate", onClick: () => { setStatusError(""); setStatusDialog("reinstate"); } },
      });
    }
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
    if (attention?.card?.photoPending) {
      const gap = cardGapText(attention.card);
      out.push({ key: "card-photo", tone: "amber", icon: IdCard, title: gap.title, detail: activeCard ? "A replacement card is waiting. Their current card keeps working until you approve it." : gap.detail, action: { label: "Check photo", tab: "card" } });
    } else if (partner.status === "ACTIVE" && !activeCard) {
      const gap = cardGapText(attention?.card);
      out.push({ key: "card", tone: attention?.card && (!attention.card.profilePhoto || !attention.card.activeContract) ? "amber" : "sky", icon: IdCard, title: gap.title, detail: gap.detail, action: { label: "ID card", tab: "card" } });
    }
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

  // The file's sections, grouped the way admins review a partner. Counts show
  // only when there is something; an amber dot marks a section with a decision waiting.
  type NavItem = { key: Tab; label: string; icon: typeof Users; count?: number; alert?: boolean };
  const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
    {
      label: "Partner",
      items: [
        { key: "overview", label: "Overview", icon: ShieldCheck, alert: partner?.status === "SUSPENDED" || paused },
        { key: "agreements", label: "Agreements", icon: FileSignature, count: partner?.contracts.length, alert: Boolean(signed || deadInvite) },
        { key: "card", label: "ID card", icon: IdCard, alert: Boolean(attention?.card?.photoPending) },
        { key: "team", label: "Team and target", icon: Users },
      ],
    },
    {
      label: "Pipeline",
      items: [
        { key: "leads", label: "Leads", icon: ListChecks, count: partner?._count.leads },
        { key: "visits", label: "Field visits", icon: Footprints, count: file.data?.visits.length, alert: Boolean(attention?.flaggedVisits) },
        { key: "properties", label: "Properties", icon: Building2, count: partner?._count.attributions, alert: Boolean(attention?.disputedProperties) },
      ],
    },
    {
      label: "Money",
      items: [
        { key: "earnings", label: "Earnings", icon: Coins, count: partner?._count.commissions },
        { key: "withdrawals", label: "Withdrawals", icon: Send, count: partner?._count.payoutRequests, alert: Boolean(attention?.payoutsUnderReview) || paused },
      ],
    },
    { label: "Distribution", items: [{ key: "agency", label: "Agency Desk", icon: Handshake }] },
    { label: "Record", items: [{ key: "history", label: "History", icon: History, count: file.data?.history.length }] },
  ];

  return (
    <div className="fixed inset-0 z-[1000] flex items-stretch justify-center bg-neutral-950/45 p-0 sm:p-3" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-partner-record-title"
        className="flex h-[100dvh] w-full max-w-[1440px] flex-col overflow-hidden border border-solid border-neutral-200 bg-white shadow-2xl sm:h-[calc(100dvh-24px)] sm:rounded-lg"
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
          {/* Phones: one scrollable row, in rail order. */}
          <div className="mt-3 flex gap-1 overflow-x-auto border-0 border-t border-solid border-white/10 px-3 lg:hidden" role="tablist" aria-label="Partner record">
            {NAV_GROUPS.flatMap((g) => g.items).map(({ key, label, icon: Icon, count, alert }) => {
              const on = tab === key;
              return (
                <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setTab(key)}
                  className={`relative inline-flex h-10 shrink-0 items-center gap-1.5 border-0 bg-transparent px-2.5 text-[13px] font-semibold ${on ? "text-white" : "text-white/55 hover:text-white/85"}`}>
                  <Icon className="h-4 w-4" /> {label}
                  {count ? <span className="rounded bg-white/10 px-1.5 text-[11px] tabular-nums text-white/70">{count}</span> : null}
                  {alert ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="Needs attention" /> : null}
                  {on ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-emerald-400" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
        {/* Desktop: the file's sections, grouped, always visible. */}
        <nav aria-label="Partner record" className="hidden w-60 shrink-0 overflow-y-auto border-0 border-r border-solid border-neutral-200 bg-neutral-50 px-3 py-4 lg:block">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="m-0 mb-1 px-2 text-[11px] font-semibold text-neutral-400">{group.label}</p>
              <ul className="m-0 list-none space-y-0.5 p-0">
                {group.items.map(({ key, label, icon: Icon, count, alert }) => {
                  const on = tab === key;
                  return (
                    <li key={key}>
                      <button type="button" aria-current={on ? "page" : undefined} onClick={() => setTab(key)}
                        className={`flex h-9 w-full items-center gap-2.5 rounded-md border-0 px-2 text-left text-[13px] font-semibold ${on ? "bg-white text-neutral-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-inset ring-neutral-200" : "bg-transparent text-neutral-600 hover:bg-white/70 hover:text-neutral-900"}`}>
                        <Icon className={`h-4 w-4 shrink-0 ${on ? "text-emerald-700" : "text-neutral-400"}`} />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {alert ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label="Needs attention" /> : null}
                        {count ? <span className="shrink-0 rounded bg-neutral-200/70 px-1.5 text-[11px] tabular-nums text-neutral-600">{count}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

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

              {/* Needs your decision: on Overview only; the rail's amber dots point here from other sections. */}
              {tab === "overview" ? (
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
                            ) : d.action?.onClick ? (
                              <button type="button" onClick={d.action.onClick} className="inline-flex h-8 items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">
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
              ) : null}

              {tab === "overview" ? (
                <>
                  <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-4">
                    {[
                      { label: "Leads", value: partner._count.leads, to: "leads" as Tab },
                      { label: "Properties attributed", value: partner._count.attributions, to: "properties" as Tab },
                      { label: "Commission entries", value: partner._count.commissions, to: "earnings" as Tab },
                      { label: "Withdrawals", value: partner._count.payoutRequests, to: "withdrawals" as Tab },
                    ].map((f) => (
                      <button key={f.label} type="button" onClick={() => setTab(f.to)} className="group border-0 bg-white px-4 py-3 text-left hover:bg-neutral-50">
                        <p className="m-0 flex items-center justify-between text-[12px] text-neutral-500">{f.label}<ArrowRight className="h-3.5 w-3.5 text-neutral-300 group-hover:text-emerald-700" /></p>
                        <p className="m-0 mt-0.5 text-xl font-bold tabular-nums text-neutral-900">{f.value.toLocaleString("en-US")}</p>
                      </button>
                    ))}
                  </section>
                  <PartnerAccountFacts data={file.data} />
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
                  {partner.status === "ACTIVE" ? (
                    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-solid border-rose-100 px-4 py-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-semibold text-neutral-900">Suspend this partner</p>
                        <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Closes the sales portal and stops the ID card at once. The rest of their NoLSAF account keeps working. You can reinstate later.</p>
                      </div>
                      <button type="button" onClick={() => { setStatusError(""); setStatusDialog("suspend"); }} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-solid border-rose-200 bg-white px-3 text-[13px] font-semibold text-rose-700 hover:bg-rose-50">
                        <PauseCircle className="h-4 w-4" aria-hidden /> Suspend partner
                      </button>
                    </section>
                  ) : null}
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
              {tab === "agency" ? <PartnerAgencyAdmin partnerId={partner.id} agentCode={partner.agentCode} /> : null}
              {tab === "leads" || tab === "visits" || tab === "properties" || tab === "earnings" || tab === "withdrawals" || tab === "history" ? (
                <PartnerFileSection
                  section={tab}
                  data={file.data}
                  error={file.error}
                  ctx={{
                    status: partner.status,
                    liveAgreement: partner.contracts.some((c) => ["ACTIVE", "EXPIRING"].includes(c.status) && new Date(c.startsAt).getTime() <= Date.now() && new Date(c.expiresAt).getTime() > Date.now()),
                    joinedAt: partner.activatedAt || partner.createdAt,
                  }}
                />
              ) : null}
              {tab === "card" ? <PartnerIdCardAdmin partnerId={partner.id} cards={partner.idCards} readiness={attention?.card} holder={{ name, agentCode: partner.agentCode, region: partner.region ?? null, territory: (partner as any).territory ?? null }} onChanged={onReload} /> : null}
            </div>
          )}
        </div>
        </div>
      </section>

      {statusDialog && partner ? (
        <AdminReasonDialog
          icon={statusDialog === "suspend" ? PauseCircle : PlayCircle}
          tone={statusDialog === "suspend" ? "danger" : "safe"}
          title={statusDialog === "suspend" ? "Suspend sales partner" : "Reinstate sales partner"}
          subject={<><strong>{name}</strong> · <span className="font-mono">{partner.agentCode}</span></>}
          effects={statusDialog === "suspend"
            ? [
                "The sales portal closes on their next tap",
                "Their ID card shows not active on the next scan",
                "A card waiting for a photo check is withdrawn",
                "Payouts stop; earnings already recorded stay on the ledger",
                "They are told it happened, never why",
              ]
            : [
                "The sales portal opens again",
                "Their current ID card verifies again, if it has not expired",
                "Payouts can be sent again",
              ]}
          chips={statusDialog === "suspend"
            ? ["Owner complaint under review", "Possible misconduct", "Documents need checking", "Requested by the partner"]
            : ["Review completed, no issue", "Complaint resolved", "Documents verified"]}
          placeholder={statusDialog === "suspend" ? "Why, for the record (not shown to the partner)" : "Why it is safe to reinstate (kept in the audit log)"}
          confirmLabel={statusDialog === "suspend" ? "Suspend partner" : "Reinstate partner"}
          busy={busy === "status"}
          error={statusError}
          onCancel={() => setStatusDialog(null)}
          onConfirm={async (reason) => {
            setBusy("status");
            setStatusError("");
            try {
              await apiClient.post(`/api/admin/sales/partners/${partner.id}/${statusDialog}`, { reason });
              setNotice(statusDialog === "suspend" ? `${partner.agentCode} is suspended. Portal closed and ID card stopped.` : `${partner.agentCode} is active again.`);
              setStatusDialog(null);
              onReload();
              onChanged();
            } catch (cause: any) {
              setStatusError(errorOf(cause, "That did not work. Try again."));
            } finally {
              setBusy("");
            }
          }}
        />
      ) : null}
    </div>
  );
}
