"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileSignature,
  LayoutDashboard,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  PauseCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import TablePagination from "@/components/TablePagination";

type SearchUser = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  alreadyPartner: boolean;
  partner: { id: number; agentCode: string; status: string } | null;
  salesProfileReady: boolean;
  missingSalesFields: string[];
};

type PartnerRow = {
  id: number;
  agentCode: string;
  status: string;
  level: string;
  region: string | null;
  activatedAt: string | null;
  createdAt: string;
  user: { id: number; name: string | null; email: string | null };
  _count: { attributions: number; leads: number };
};

type PartnerDetail = PartnerRow & {
  territory: string | null;
  phone: string | null;
  payoutName: string | null;
  payoutMethod: string | null;
  payoutAccount: string | null;
  suspendedAt: string | null;
  terminatedAt: string | null;
  user: PartnerRow["user"] & { phone: string | null };
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
  _count: PartnerRow["_count"] & { commissions: number; payoutRequests: number };
};

const partnerPageSize = 20;
const fieldClass = "min-h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 shadow-sm no-underline transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const primaryClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
// Ghost buttons sitting on the dark sales header.
const heroButton = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

function statusTone(status: string) {
  if (status === "ACTIVE") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "PENDING" || status === "SIGNED") return "border-amber-100 bg-amber-50 text-amber-700";
  if (status === "SUSPENDED") return "border-orange-100 bg-orange-50 text-orange-700";
  if (status === "TERMINATED") return "border-red-100 bg-red-50 text-red-700";
  return "border-neutral-200 bg-neutral-100 text-neutral-600";
}

// Partner lifecycle: one definition drives the track, cards and list. Classes spelled out for Tailwind.
const LIFECYCLE = [
  { key: "PENDING", label: "Onboarding", hint: "Agreement or activation pending", icon: Clock3, text: "text-amber-700", dot: "bg-amber-500", ring: "ring-amber-400", bar: "bg-amber-400", soft: "bg-amber-50" },
  { key: "ACTIVE", label: "Active", hint: "Workspace access enabled", icon: BadgeCheck, text: "text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-500", bar: "bg-emerald-500", soft: "bg-emerald-50" },
  { key: "SUSPENDED", label: "Suspended", hint: "Access paused", icon: PauseCircle, text: "text-orange-700", dot: "bg-orange-500", ring: "ring-orange-400", bar: "bg-orange-400", soft: "bg-orange-50" },
  { key: "TERMINATED", label: "Terminated", hint: "Agreement ended", icon: XCircle, text: "text-rose-600", dot: "bg-rose-500", ring: "ring-rose-400", bar: "bg-rose-400", soft: "bg-rose-50" },
] as const;
const lifecycleOf = (status: string) => LIFECYCLE.find((s) => s.key === status) || null;

// Sales partner levels, lowest to highest; shown as a five-step signal.
const LEVELS = ["STARTER", "GROWTH", "PROFESSIONAL", "SENIOR", "REGIONAL_LEAD"];

function humanize(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function tidyName(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function initials(name: string | null | undefined) {
  const parts = String(name || "").trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.charAt(0) || "") + (parts[1]?.charAt(0) || "")).toUpperCase() || "?";
}

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not set";
}

function message(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) return "Finance OTP verification is required. Complete it, then retry.";
  return cause?.response?.data?.error || fallback;
}

function LevelSignal({ level }: { level: string }) {
  const step = Math.max(LEVELS.indexOf(String(level || "").toUpperCase()), 0) + 1;
  return (
    <span className="inline-flex items-center gap-2" title={`Level ${step} of ${LEVELS.length}`}>
      <span className="inline-flex items-end gap-[3px]" aria-hidden>
        {LEVELS.map((_, i) => (
          <span key={i} className={`w-[3px] rounded-sm ${i < step ? "bg-emerald-600" : "bg-neutral-200"}`} style={{ height: `${6 + i * 2.5}px` }} />
        ))}
      </span>
      <span className="text-xs text-neutral-700">{humanize(level)}</span>
    </span>
  );
}

export default function AdminSalesPartnersPage() {
  const [tab, setTab] = useState<"directory" | "promote">("directory");
  const [view, setView] = useState<"cards" | "list">("cards");
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selectedPartner, setSelectedPartner] = useState<PartnerDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<SearchUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [promotion, setPromotion] = useState({
    region: "",
    territory: "",
    phone: "",
    nrmsCommissionRate: "",
    marketplaceRevenueRate: "",
    startsAt: "",
    termDays: "365",
    reason: "",
  });
  const [activation, setActivation] = useState({ signatoryName: "", signatoryTitle: "", reason: "" });
  const [invitationReason, setInvitationReason] = useState("");

  // Remember the preferred directory view for this admin.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("admin.salesPartners.view");
      if (saved === "cards" || saved === "list") setView(saved);
    } catch {}
  }, []);
  const changeView = (next: "cards" | "list") => {
    setView(next);
    try { window.localStorage.setItem("admin.salesPartners.view", next); } catch {}
  };

  const loadPartners = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/admin/sales/partners", {
        params: {
          page,
          pageSize: partnerPageSize,
          q: query.trim() || undefined,
          status: status || undefined,
        },
      });
      setPartners(response.data?.partners || []);
      setTotal(Number(response.data?.total || 0));
      setStatusCounts(response.data?.statusCounts || {});
    } catch (cause: any) {
      setError(message(cause, "Could not load sales partners."));
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadPartners(); }, query.trim() ? 300 : 0);
    return () => window.clearTimeout(timeout);
  }, [loadPartners, query]);

  const allCount = useMemo(
    () => (Object.keys(statusCounts).length ? Object.values(statusCounts).reduce((sum, count) => sum + count, 0) : total),
    [statusCounts, total],
  );

  const openPartner = async (id: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setError("");
    try {
      const response = await apiClient.get(`/api/admin/sales/partners/${id}`);
      setSelectedPartner(response.data?.partner || null);
      setActivation({ signatoryName: "", signatoryTitle: "", reason: "" });
      setInvitationReason("");
    } catch (cause: any) {
      setError(message(cause, "Could not load this partner."));
    } finally {
      setDetailLoading(false);
    }
  };

  const resendInvitation = async (contractId: number) => {
    if (invitationReason.trim().length < 5) {
      return setError("Enter an administrative reason of at least 5 characters before resending.");
    }
    setBusy(`resend-${contractId}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/sales/contracts/${contractId}/resend-invitation`, {
        reason: invitationReason.trim(),
      });
      setNotice("A new secure agreement invitation was sent. The previous link is no longer valid.");
      setInvitationReason("");
    } catch (cause: any) {
      setError(message(cause, "Could not resend the agreement invitation."));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (!detailOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [detailOpen]);

  const searchUsers = async () => {
    const q = userQuery.trim();
    if (q.length < 3) return setError("Enter at least 3 characters to search existing users.");
    setSearchingUsers(true);
    setError("");
    setSelectedUser(null);
    try {
      const response = await apiClient.get("/api/admin/sales/users/search", { params: { q } });
      setUserResults(response.data?.users || []);
    } catch (cause: any) {
      setError(message(cause, "User search failed."));
      setUserResults([]);
    } finally {
      setSearchingUsers(false);
    }
  };

  const promote = async () => {
    if (!selectedUser || selectedUser.alreadyPartner) return setError("Select an eligible existing user.");
    if (promotion.region.trim().length < 2 || promotion.reason.trim().length < 5) {
      return setError("Region and an administrative reason of at least 5 characters are required.");
    }
    setBusy("promote");
    setError("");
    setNotice("");
    try {
      const response = await apiClient.post("/api/admin/sales/partners/promote", {
        userId: selectedUser.id,
        region: promotion.region.trim(),
        territory: promotion.territory.trim() || undefined,
        phone: promotion.phone.trim() || undefined,
        nrmsCommissionRate: promotion.nrmsCommissionRate === "" ? undefined : Number(promotion.nrmsCommissionRate),
        marketplaceRevenueRate: promotion.marketplaceRevenueRate === "" ? undefined : Number(promotion.marketplaceRevenueRate),
        startsAt: promotion.startsAt || undefined,
        termDays: Number(promotion.termDays || 365),
        reason: promotion.reason.trim(),
      });
      const emailSent = response.data?.invitation?.emailDelivery?.status === "SENT";
      setNotice(
        `${selectedUser.name || selectedUser.email} was promoted as ${response.data?.partner?.agentCode}. ` +
        (emailSent
          ? "A secure agreement invitation was sent to their verified email."
          : "The profile was created, but the invitation email could not be delivered. Check email configuration before asking the user to continue."),
      );
      setSelectedUser(null);
      setUserResults([]);
      setUserQuery("");
      setPromotion({ region: "", territory: "", phone: "", nrmsCommissionRate: "", marketplaceRevenueRate: "", startsAt: "", termDays: "365", reason: "" });
      await loadPartners();
      setTab("directory");
      if (response.data?.partner?.id) await openPartner(response.data.partner.id);
    } catch (cause: any) {
      setError(message(cause, "Could not promote this user."));
    } finally {
      setBusy("");
    }
  };

  const activateContract = async (contractId: number) => {
    if (activation.signatoryName.trim().length < 3 || activation.signatoryTitle.trim().length < 2 || activation.reason.trim().length < 5) {
      return setError("Enter the countersignatory name, title, and activation reason.");
    }
    if (!selectedPartner) return;
    setBusy(`activate-${contractId}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/sales/contracts/${contractId}/activate`, {
        signatoryName: activation.signatoryName.trim(),
        signatoryTitle: activation.signatoryTitle.trim(),
        reason: activation.reason.trim(),
      });
      setNotice(`Contract activated. ${selectedPartner.agentCode} can now enter the Sales Partner Workspace.`);
      await Promise.all([loadPartners(), openPartner(selectedPartner.id)]);
    } catch (cause: any) {
      setError(message(cause, "Contract activation failed."));
    } finally {
      setBusy("");
    }
  };

  const pickStatus = (next: string) => {
    setTab("directory");
    setStatus((current) => (current === next ? "" : next));
    setPage(1);
  };

  const activeCount = statusCounts.ACTIVE || 0;
  const activeShare = allCount > 0 ? Math.round((activeCount / allCount) * 100) : 0;

  return (
    <div className="space-y-5 w-full min-w-0">
      {/* Sales header: dark brand band with the page's two views as tabs */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Sales</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Sales partners</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Promote existing users, track their agreements and activate workspace access.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/sales" className={heroButton}><LayoutDashboard className="h-3.5 w-3.5" /> Sales review</Link>
              <Link href="/admin/sales/finance" className={heroButton}><Wallet className="h-3.5 w-3.5" /> Finance</Link>
              <Link href="/admin/sales/materials" className={heroButton}><BookOpen className="h-3.5 w-3.5" /> Materials</Link>
              <button type="button" onClick={() => void loadPartners()} disabled={loading} className={`${heroButton} w-9 px-0`} aria-label="Refresh sales partners" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Headline numbers */}
          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{allCount.toLocaleString()}</p>
              <p className="m-0 mt-1 text-xs text-white/55">{allCount === 1 ? "Partner" : "Partners"} in the network</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-emerald-300">{activeShare}%</p>
              <p className="m-0 mt-1 text-xs text-white/55">Active with workspace access</p>
            </div>
          </div>

          <div className="mt-5 flex gap-1" role="tablist" aria-label="Sales partner views">
            {([["directory", "Directory", Users], ["promote", "Promote user", UserPlus]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`relative inline-flex h-11 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${tab === key ? "text-white" : "text-white/50 hover:text-white/80"}`}
              >
                <Icon className="h-4 w-4" /> {label}
                {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {tab === "directory" ? (
        <>
          {/* Lifecycle track: where every partner sits, and a one-click filter */}
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {LIFECYCLE.map((stage, idx) => {
                const Icon = stage.icon;
                const n = statusCounts[stage.key] || 0;
                const share = allCount > 0 ? Math.round((n / allCount) * 100) : 0;
                const selected = status === stage.key;
                return (
                  <button
                    key={stage.key}
                    type="button"
                    onClick={() => pickStatus(stage.key)}
                    aria-pressed={selected}
                    className={`group relative min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${
                      selected ? `border-neutral-900 ${stage.soft}` : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${stage.text}`}>
                        <Icon className="h-3.5 w-3.5" /> {stage.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-neutral-400">{idx < 2 ? `Step ${idx + 1}` : share + "%"}</span>
                    </span>
                    <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{n.toLocaleString()}</span>
                    <span className="mt-1 block truncate text-[11px] text-neutral-500">{stage.hint}</span>
                    <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                      <span className={`block h-full rounded-full ${stage.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                    </span>
                    {idx === 0 && (
                      <ChevronRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white p-0.5 text-neutral-300 ring-1 ring-neutral-200 lg:block" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Directory */}
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-neutral-900">
                  {status ? `${lifecycleOf(status)?.label || humanize(status)} partners` : "All partners"}
                </h2>
                <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "result" : "results"}`}</p>
              </div>
              {status && (
                <button type="button" onClick={() => pickStatus(status)} className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
                  <X className="h-3 w-3" /> Show all
                </button>
              )}
              <div className="ml-auto flex w-full min-w-0 items-center gap-2 sm:w-auto">
                <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                    className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                    placeholder="Search code, partner, email or region"
                    aria-label="Search sales partners"
                  />
                  {query && (
                    <button type="button" onClick={() => { setQuery(""); setPage(1); }} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="hidden rounded-lg bg-neutral-100 p-0.5 md:inline-flex" role="group" aria-label="Directory layout">
                  {([["cards", LayoutGrid, "Cards"], ["list", List, "List"]] as const).map(([key, Icon, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => changeView(key)}
                      aria-pressed={view === key}
                      title={label}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border-0 transition-colors ${view === key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-400 hover:text-neutral-700"}`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading && partners.length === 0 ? (
              <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading partners
              </div>
            ) : partners.length === 0 ? (
              <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
                <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
                  <Users className="h-5 w-5" />
                </span>
                <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No matching partners</p>
                <p className="m-0 mt-1 text-xs text-neutral-500">
                  {query || status ? "Try another stage or search." : "Promote an existing user to add the first sales partner."}
                </p>
                <button type="button" onClick={() => setTab("promote")} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800">
                  <UserPlus className="h-4 w-4" /> Promote user
                </button>
              </div>
            ) : (
              <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
                {view === "list" ? (
                  <div className="hidden overflow-x-auto border-0 border-t border-solid border-neutral-100 md:block">
                    <table className="table w-full min-w-[960px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="text-[11px] font-semibold text-neutral-400">
                          <th className="px-4 py-2.5 font-semibold sm:pl-5">Partner</th>
                          <th className="px-4 py-2.5 font-semibold">Code</th>
                          <th className="px-4 py-2.5 font-semibold">Stage</th>
                          <th className="px-4 py-2.5 font-semibold">Level</th>
                          <th className="px-4 py-2.5 font-semibold">Region</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Leads</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Attributions</th>
                          <th className="px-4 py-2.5 font-semibold">Joined</th>
                          <th className="px-4 py-2.5 sm:pr-5"><span className="sr-only">Open</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {partners.map((partner) => {
                          const stage = lifecycleOf(partner.status);
                          const name = tidyName(partner.user.name) || partner.user.email || `User #${partner.user.id}`;
                          return (
                            <tr key={partner.id} onClick={() => void openPartner(partner.id)} className="cursor-pointer border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-neutral-50/70">
                              <td className="px-4 py-3 sm:pl-5">
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white ring-2 ring-offset-2 ${stage?.ring || "ring-neutral-300"}`}>{initials(name)}</span>
                                  <div className="min-w-0">
                                    <div className="max-w-[15rem] truncate font-medium text-neutral-900">{name}</div>
                                    <div className="max-w-[15rem] truncate text-xs text-neutral-400">{partner.user.email || "No email"}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-neutral-600">{partner.agentCode}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${stage?.text || "text-neutral-600"}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${stage?.dot || "bg-neutral-400"}`} /> {stage?.label || humanize(partner.status)}
                                </span>
                              </td>
                              <td className="px-4 py-3"><LevelSignal level={partner.level} /></td>
                              <td className={`px-4 py-3 ${partner.region ? "text-neutral-700" : "text-neutral-400"}`}>{partner.region || "Not set"}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-neutral-800">{partner._count.leads.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-neutral-800">{partner._count.attributions.toLocaleString()}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{date(partner.createdAt)}</td>
                              <td className="px-4 py-3 text-right sm:pr-5"><ChevronRight className="ml-auto h-4 w-4 text-neutral-300" aria-hidden /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {/* Cards: always on phones, and on desktop when the Cards layout is chosen */}
                <div className={`grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3 2xl:grid-cols-4 ${view === "list" ? "md:hidden" : ""}`}>
                  {partners.map((partner) => {
                    const stage = lifecycleOf(partner.status);
                    const name = tidyName(partner.user.name) || partner.user.email || `User #${partner.user.id}`;
                    const since = partner.status === "ACTIVE" && partner.activatedAt ? `Active since ${date(partner.activatedAt)}` : stage?.hint || humanize(partner.status);
                    return (
                      <button
                        key={partner.id}
                        type="button"
                        onClick={() => void openPartner(partner.id)}
                        className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white p-0 text-left transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_12px_28px_-18px_rgba(11,36,32,0.45)]"
                      >
                        <span className="flex items-start gap-3 px-4 pt-4">
                          <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white ring-2 ring-offset-2 ${stage?.ring || "ring-neutral-300"}`}>
                            {initials(name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-neutral-900">{name}</span>
                            <span className="block truncate text-xs text-neutral-400">{partner.user.email || "No email"}</span>
                          </span>
                          <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-500" aria-hidden />
                        </span>

                        <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4">
                          <span className="rounded-md border border-dashed border-neutral-300 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700">{partner.agentCode}</span>
                          <LevelSignal level={partner.level} />
                        </span>

                        <span className="mt-2 flex items-center gap-1.5 px-4 text-xs text-neutral-500">
                          <MapPin className="h-3.5 w-3.5 text-neutral-400" /> {partner.region || "Region not set"}
                        </span>

                        <span className={`mt-3 flex items-center gap-1.5 px-4 py-2 text-xs ${stage?.soft || "bg-neutral-50"} ${stage?.text || "text-neutral-600"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${stage?.dot || "bg-neutral-400"}`} />
                          <span className="font-semibold">{stage?.label || humanize(partner.status)}</span>
                          <span className="truncate opacity-80">· {since}</span>
                        </span>

                        <span className="grid grid-cols-3 gap-px bg-neutral-100">
                          {[
                            ["Leads", partner._count.leads.toLocaleString()],
                            ["Attributions", partner._count.attributions.toLocaleString()],
                            ["Joined", new Date(partner.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })],
                          ].map(([label, value]) => (
                            <span key={label} className="min-w-0 bg-white px-3 py-2.5">
                              <span className="block text-[10px] text-neutral-400">{label}</span>
                              <span className="block truncate text-sm font-semibold tabular-nums text-neutral-900">{value}</span>
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <TablePagination page={page} pageSize={partnerPageSize} total={total} onPageChange={setPage} />
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(480px,1.1fr)]">
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#0b2420] text-xs font-bold text-emerald-300">1</span>
              <div><h2 className="m-0 text-sm font-bold text-neutral-900">Find an existing user</h2><p className="mb-0 mt-0.5 text-xs text-neutral-500">Search by name, email, or phone. Promotion never creates a new account.</p></div>
            </div>
            <div className="mt-4 flex gap-2">
              <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchUsers(); }} className={fieldClass} placeholder="At least 3 characters" aria-label="Search existing users" />
              <button type="button" onClick={() => void searchUsers()} disabled={searchingUsers} className={`${actionClass} shrink-0 px-3`}>{searchingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</button>
            </div>
            <div className="mt-3 space-y-2">
              {userResults.map((user) => (
                <button key={user.id} type="button" disabled={user.alreadyPartner} onClick={() => { setSelectedUser(user); setPromotion((current) => ({ ...current, phone: user.phone || "" })); }} className={`block w-full rounded-xl border border-solid p-3 text-left transition ${selectedUser?.id === user.id ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100" : "border-neutral-200 bg-white hover:border-emerald-200"} disabled:cursor-not-allowed disabled:opacity-60`}>
                  <span className="flex items-center justify-between gap-2"><b className="truncate text-sm text-neutral-900">{user.name || user.email || `User #${user.id}`}</b><span className="text-[10px] font-bold text-neutral-400">#{user.id} / {user.role}</span></span>
                  <span className="mt-1 block truncate text-xs text-neutral-500">{user.email || "No email"} / {user.phone || "No phone"}</span>
                  {user.alreadyPartner && <span className="mt-2 inline-flex rounded-full border border-solid border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Already {user.partner?.agentCode}</span>}
                  {!user.alreadyPartner && !user.salesProfileReady && <span className="mt-2 block text-[10px] font-semibold text-red-600">Profile missing: {user.missingSalesFields.join(", ")}</span>}
                </button>
              ))}
              {!searchingUsers && userQuery.trim().length >= 3 && userResults.length === 0 && <p className="m-0 rounded-xl border border-dashed border-neutral-200 p-5 text-center text-xs text-neutral-500">No users match this search.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${selectedUser ? "bg-[#0b2420] text-emerald-300" : "bg-neutral-100 text-neutral-400"}`}>2</span>
                <div><h2 className="m-0 text-sm font-bold text-neutral-900">Promotion and first agreement</h2><p className="mb-0 mt-0.5 text-xs text-neutral-500">Access remains pending until signature and countersignature.</p></div>
              </div>
              {selectedUser && <button type="button" onClick={() => setSelectedUser(null)} className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500" aria-label="Clear selected user"><X className="h-4 w-4" /></button>}
            </div>
            {!selectedUser ? <div className="grid min-h-72 place-items-center text-center"><div><FileSignature className="mx-auto h-8 w-8 text-neutral-300" /><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">Select an eligible user</p><p className="mb-0 mt-1 text-xs text-neutral-500">Their sales profile and contract details will be configured here.</p></div></div> : (
              <>
                <div className="mt-4 border-0 border-l-2 border-solid border-emerald-600 px-3 py-1"><p className="m-0 text-xs font-bold text-neutral-900">{selectedUser.name || selectedUser.email}</p><p className="m-0 mt-0.5 text-[11px] text-neutral-500">{selectedUser.email} / user #{selectedUser.id}</p></div>
                {!selectedUser.salesProfileReady && (
                  <div className="mt-3 border-0 border-l-2 border-solid border-amber-500 px-3 py-1 text-[11px] leading-5 text-amber-800">
                    Ask this user to complete their {selectedUser.missingSalesFields.join(", ")} in Account → Personal Information before promotion.
                  </div>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-[11px] font-bold text-neutral-600">Region *<input value={promotion.region} onChange={(e) => setPromotion({ ...promotion, region: e.target.value })} className={`${fieldClass} mt-1.5`} placeholder="Dar es Salaam" /></label>
                  <label className="text-[11px] font-bold text-neutral-600">Territory<input value={promotion.territory} onChange={(e) => setPromotion({ ...promotion, territory: e.target.value })} className={`${fieldClass} mt-1.5`} placeholder="Assigned territory" /></label>
                  <label className="text-[11px] font-bold text-neutral-600">Phone<input value={promotion.phone} onChange={(e) => setPromotion({ ...promotion, phone: e.target.value })} className={`${fieldClass} mt-1.5`} placeholder="+255..." /></label>
                  <div className="text-[11px] font-bold text-neutral-600">
                    <span className="mb-1.5 block">Contract start</span>
                    <DatePickerField
                      label="Contract start date"
                      value={promotion.startsAt}
                      onChangeAction={(next) => setPromotion((current) => ({ ...current, startsAt: next.slice(0, 10) }))}
                      allowPast
                      twoMonths={false}
                      size="sm"
                      widthClassName="!w-full !rounded-lg"
                    />
                  </div>
                  <label className="text-[11px] font-bold text-neutral-600">NRMS commission %<input type="number" min="0" max="100" step="0.01" value={promotion.nrmsCommissionRate} onChange={(e) => setPromotion({ ...promotion, nrmsCommissionRate: e.target.value })} className={`${fieldClass} mt-1.5`} placeholder="Default: 14" /></label>
                  <label className="text-[11px] font-bold text-neutral-600">Marketplace revenue %<input type="number" min="0" max="100" step="0.01" value={promotion.marketplaceRevenueRate} onChange={(e) => setPromotion({ ...promotion, marketplaceRevenueRate: e.target.value })} className={`${fieldClass} mt-1.5`} placeholder="Default: 20" /></label>
                  <label className="text-[11px] font-bold text-neutral-600">Contract term (days)<input type="number" min="30" max="1095" value={promotion.termDays} onChange={(e) => setPromotion({ ...promotion, termDays: e.target.value })} className={`${fieldClass} mt-1.5`} /></label>
                  <label className="text-[11px] font-bold text-neutral-600">Administrative reason *<input value={promotion.reason} onChange={(e) => setPromotion({ ...promotion, reason: e.target.value })} className={`${fieldClass} mt-1.5`} placeholder="Why this user is being promoted" /></label>
                </div>
                <div className="mt-4 flex justify-end"><button type="button" onClick={() => void promote()} disabled={busy === "promote" || !selectedUser.salesProfileReady} className={primaryClass}>{busy === "promote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Promote and send agreement</button></div>
              </>
            )}
          </section>
        </div>
      )}

      {detailOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-neutral-950/45 p-3 backdrop-blur-sm sm:p-6" onMouseDown={() => setDetailOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sales-partner-detail-title"
            className="max-h-[calc(100dvh-24px)] w-full max-w-5xl overflow-y-auto rounded-xl border border-solid border-neutral-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-48px)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-0 border-b border-solid border-neutral-200 bg-white px-5 py-4">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Sales partner record</p>
                <h2 id="sales-partner-detail-title" className="mb-0 mt-1 truncate text-lg font-bold text-neutral-950">
                  {selectedPartner?.user.name || selectedPartner?.user.email || "Partner details"}
                </h2>
              </div>
              <button type="button" onClick={() => setDetailOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900" aria-label="Close partner details"><X className="h-4 w-4" /></button>
            </div>

            {detailLoading ? (
              <div className="grid min-h-80 place-items-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : !selectedPartner ? (
              <div className="grid min-h-80 place-items-center p-8 text-center"><div><ShieldCheck className="mx-auto h-9 w-9 text-neutral-300" /><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">Partner information is unavailable</p><p className="mb-0 mt-1 text-xs text-neutral-500">Close this window and try opening the record again.</p></div></div>
            ) : (
              <div className="space-y-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-emerald-700">{selectedPartner.agentCode}</span>
                      <span className={`rounded-full border border-solid px-2.5 py-1 text-[10px] font-bold ${statusTone(selectedPartner.status)}`}>{selectedPartner.status}</span>
                      <span className="rounded-full border border-solid border-sky-100 bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700">{selectedPartner.level}</span>
                    </div>
                    <p className="mb-0 mt-2 text-sm font-semibold text-neutral-800">{selectedPartner.user.email}</p>
                    <p className="mb-0 mt-1 text-xs text-neutral-500">{selectedPartner.phone || selectedPartner.user.phone || "No phone number"}</p>
                  </div>
                  <div className="text-right text-[11px] text-neutral-500">
                    <p className="m-0">Joined {date(selectedPartner.createdAt)}</p>
                    <p className="mb-0 mt-1">Activated {date(selectedPartner.activatedAt)}</p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 border-0 border-y border-solid border-neutral-200 md:grid-cols-6">
                  {[
                    ["Region", selectedPartner.region || "Not set"],
                    ["Territory", selectedPartner.territory || "Not set"],
                    ["Leads", selectedPartner._count.leads],
                    ["Attributions", selectedPartner._count.attributions],
                    ["Commissions", selectedPartner._count.commissions],
                    ["Payouts", selectedPartner._count.payoutRequests],
                  ].map(([label, value], index) => (
                    <div key={String(label)} className={`min-w-0 px-3 py-3 ${index % 2 ? "border-0 border-l border-solid border-neutral-200" : ""} md:border-0 md:border-l md:border-solid md:border-neutral-200 ${index === 0 ? "md:border-l-0" : ""}`}>
                      <dt className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">{label}</dt>
                      <dd className="mb-0 mt-1 truncate text-xs font-semibold text-neutral-700">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div>
                  <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Agreements</h3>
                  <div className="mt-2 border-0 border-y border-solid border-neutral-200">
                    <table className="w-full table-fixed border-collapse text-left">
                      <thead className="bg-neutral-50 text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                        <tr>
                          <th className="w-[25%] px-3 py-2.5">Agreement</th>
                          <th className="w-[35%] px-3 py-2.5">Period</th>
                          <th className="w-[25%] px-3 py-2.5">Rates</th>
                          <th className="w-[15%] px-3 py-2.5">Status</th>
                        </tr>
                      </thead>
                      {selectedPartner.contracts.map((contract) => (
                        <tbody key={contract.id} className="border-0 border-t border-solid border-neutral-100">
                          <tr className="align-top">
                            <td className="break-words px-3 py-3 text-[11px] font-bold text-neutral-900">
                              {contract.contractNumber}
                              {contract.invitationSentAt && <span className="mt-1 block text-[9px] font-normal text-neutral-400">Invite {contract.invitationUsedAt ? "used" : `expires ${date(contract.invitationExpiresAt)}`}</span>}
                            </td>
                            <td className="px-3 py-3 text-[10px] leading-5 text-neutral-500">{date(contract.startsAt)} to {date(contract.expiresAt)}</td>
                            <td className="px-3 py-3 text-[10px] leading-5 text-neutral-500">NRMS {Number(contract.nrmsCommissionRate)}%<br />Marketplace {Number(contract.marketplaceRevenueRate)}%</td>
                            <td className="px-3 py-3"><span className={`inline-flex max-w-full rounded-full border border-solid px-2 py-0.5 text-[9px] font-bold ${statusTone(contract.status)}`}>{contract.status}</span></td>
                          </tr>
                          {["SENT", "VIEWED"].includes(contract.status) && (
                            <tr className="bg-sky-50/60">
                              <td colSpan={4} className="px-3 py-3">
                                <p className="m-0 text-xs font-bold text-sky-900">Send a new invitation</p>
                                <p className="mb-0 mt-1 text-[10px] text-sky-700">The previous email link will stop working immediately.</p>
                                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                  <input value={invitationReason} onChange={(event) => setInvitationReason(event.target.value)} className={fieldClass} placeholder="Administrative reason for resending" />
                                  <button type="button" onClick={() => void resendInvitation(contract.id)} disabled={busy === `resend-${contract.id}`} className={`${actionClass} shrink-0`}>
                                    {busy === `resend-${contract.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}Resend invitation
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {contract.status === "SIGNED" && (
                            <tr className="bg-amber-50/60">
                              <td colSpan={4} className="px-3 py-3">
                                <p className="m-0 text-xs font-bold text-amber-900">Countersign and activate workspace</p>
                                <div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={activation.signatoryName} onChange={(e) => setActivation({ ...activation, signatoryName: e.target.value })} className={fieldClass} placeholder="Signatory name" /><input value={activation.signatoryTitle} onChange={(e) => setActivation({ ...activation, signatoryTitle: e.target.value })} className={fieldClass} placeholder="Signatory title" /><input value={activation.reason} onChange={(e) => setActivation({ ...activation, reason: e.target.value })} className={`${fieldClass} sm:col-span-2`} placeholder="Activation reason" /></div>
                                <button type="button" onClick={() => void activateContract(contract.id)} disabled={busy === `activate-${contract.id}`} className={`${primaryClass} mt-2`}>{busy === `activate-${contract.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}Activate sales workspace</button>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      ))}
                    </table>
                    {selectedPartner.contracts.length === 0 && <p className="m-0 px-3 py-6 text-center text-xs text-neutral-500">No agreements found.</p>}
                  </div>
                </div>

                <div className="border-0 border-t border-solid border-neutral-200 pt-4">
                  <h3 className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Payout destination</h3>
                  <p className="mb-0 mt-1 text-xs font-semibold text-neutral-700">
                    {selectedPartner.payoutMethod
                      ? `${selectedPartner.payoutName || "Account holder"} / ${selectedPartner.payoutMethod} / ending ${selectedPartner.payoutAccount || "not set"}`
                      : "Not configured"}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
