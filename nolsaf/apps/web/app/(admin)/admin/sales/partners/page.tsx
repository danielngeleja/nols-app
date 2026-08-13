"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileSignature,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";

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

const partnerStatuses = ["", "PENDING", "ACTIVE", "SUSPENDED", "TERMINATED"];
const partnerPageSize = 20;
const fieldClass = "min-h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 shadow-sm no-underline transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const primaryClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-700 bg-emerald-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";

function statusTone(status: string) {
  if (status === "ACTIVE") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "PENDING" || status === "SIGNED") return "border-amber-100 bg-amber-50 text-amber-700";
  if (status === "SUSPENDED") return "border-orange-100 bg-orange-50 text-orange-700";
  if (status === "TERMINATED") return "border-red-100 bg-red-50 text-red-700";
  return "border-neutral-200 bg-neutral-100 text-neutral-600";
}

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "Not set";
}

function message(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) return "Finance OTP verification is required. Complete it, then retry.";
  return cause?.response?.data?.error || fallback;
}

function StatCard({ icon: Icon, label, value, detail, tone }: {
  icon: typeof Users;
  label: string;
  value: number;
  detail: string;
  tone: "emerald" | "amber" | "blue" | "slate";
}) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-sky-100 bg-sky-50 text-sky-700",
    slate: "border-neutral-200 bg-neutral-100 text-neutral-600",
  };
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p><p className="mb-0 mt-1 text-2xl font-black text-neutral-950">{value}</p></div>
        <span className={`grid h-9 w-9 place-items-center rounded-xl border ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mb-0 mt-2 text-[11px] text-neutral-500">{detail}</p>
    </div>
  );
}

export default function AdminSalesPartnersPage() {
  const [tab, setTab] = useState<"directory" | "promote">("directory");
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

  const stats = useMemo(() => ({
    total: Object.keys(statusCounts).length ? Object.values(statusCounts).reduce((sum, count) => sum + count, 0) : total,
    pending: statusCounts.PENDING || 0,
    active: statusCounts.ACTIVE || 0,
    inactive: (statusCounts.SUSPENDED || 0) + (statusCounts.TERMINATED || 0),
  }), [statusCounts, total]);
  const totalPages = Math.max(1, Math.ceil(total / partnerPageSize));

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

  return (
    <div id="sales-partners-admin" className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:space-y-5 sm:py-6">
      <style>{`#sales-partners-admin, #sales-partners-admin * { box-sizing: border-box; }`}</style>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">PARTNERS</div>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Users className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Sales administration</p><span className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">Workspace onboarding</span></div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Sales partners</h1>
              <p className="mb-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500 sm:text-sm">Promote existing users, monitor agreements, and activate secure workspace access.</p>
            </div>
          </div>
          <div className="flex flex-nowrap items-center gap-2">
            <Link href="/admin/sales" className={actionClass}><ArrowLeft className="h-4 w-4" /> Review</Link>
            <Link href="/admin/sales/finance" className={actionClass}><Wallet className="h-4 w-4" /> Finance</Link>
            <Link href="/admin/sales/materials" className={actionClass}><BookOpen className="h-4 w-4" /> Materials</Link>
            <button type="button" onClick={() => void loadPartners()} disabled={loading} className={`${actionClass} h-10 w-10 shrink-0 px-0`} aria-label="Refresh sales partners" title="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Users} label="All partners" value={stats.total} detail="Sales partner profiles" tone="blue" />
        <StatCard icon={Clock3} label="Pending" value={stats.pending} detail="Agreement or activation pending" tone="amber" />
        <StatCard icon={BadgeCheck} label="Active" value={stats.active} detail="Workspace access enabled" tone="emerald" />
        <StatCard icon={ShieldCheck} label="Inactive" value={stats.inactive} detail="Suspended or terminated" tone="slate" />
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 sm:w-fit">
          <button type="button" onClick={() => setTab("directory")} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border-0 px-4 text-xs font-bold transition ${tab === "directory" ? "bg-white text-emerald-800 shadow-sm" : "bg-transparent text-neutral-500"}`}><Users className="h-4 w-4" />Directory</button>
          <button type="button" onClick={() => setTab("promote")} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border-0 px-4 text-xs font-bold transition ${tab === "promote" ? "bg-white text-emerald-800 shadow-sm" : "bg-transparent text-neutral-500"}`}><UserPlus className="h-4 w-4" />Promote user</button>
        </div>
      </section>

      {tab === "promote" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(480px,1.1fr)]">
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
            <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700"><Search className="h-4 w-4" /></span><div><h2 className="m-0 text-sm font-bold text-neutral-900">Find an existing user</h2><p className="mb-0 mt-0.5 text-xs text-neutral-500">Search by name, email, or phone. Promotion never creates a new account.</p></div></div>
            <div className="mt-4 flex gap-2">
              <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchUsers(); }} className={fieldClass} placeholder="At least 3 characters" aria-label="Search existing users" />
              <button type="button" onClick={() => void searchUsers()} disabled={searchingUsers} className={`${actionClass} shrink-0 px-3`}>{searchingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</button>
            </div>
            <div className="mt-3 space-y-2">
              {userResults.map((user) => (
                <button key={user.id} type="button" disabled={user.alreadyPartner} onClick={() => { setSelectedUser(user); setPromotion((current) => ({ ...current, phone: user.phone || "" })); }} className={`block w-full rounded-xl border p-3 text-left transition ${selectedUser?.id === user.id ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100" : "border-neutral-200 bg-white hover:border-emerald-200"} disabled:cursor-not-allowed disabled:opacity-60`}>
                  <span className="flex items-center justify-between gap-2"><b className="truncate text-sm text-neutral-900">{user.name || user.email || `User #${user.id}`}</b><span className="text-[10px] font-bold text-neutral-400">#{user.id} / {user.role}</span></span>
                  <span className="mt-1 block truncate text-xs text-neutral-500">{user.email || "No email"} / {user.phone || "No phone"}</span>
                  {user.alreadyPartner && <span className="mt-2 inline-flex rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Already {user.partner?.agentCode}</span>}
                  {!user.alreadyPartner && !user.salesProfileReady && <span className="mt-2 block text-[10px] font-semibold text-red-600">Profile missing: {user.missingSalesFields.join(", ")}</span>}
                </button>
              ))}
              {!searchingUsers && userQuery.trim().length >= 3 && userResults.length === 0 && <p className="m-0 rounded-xl border border-dashed border-neutral-200 p-5 text-center text-xs text-neutral-500">No users match this search.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700"><FileSignature className="h-4 w-4" /></span><div><h2 className="m-0 text-sm font-bold text-neutral-900">Promotion and first agreement</h2><p className="mb-0 mt-0.5 text-xs text-neutral-500">Access remains pending until signature and countersignature.</p></div></div>{selectedUser && <button type="button" onClick={() => setSelectedUser(null)} className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500" aria-label="Clear selected user"><X className="h-4 w-4" /></button>}</div>
            {!selectedUser ? <div className="grid min-h-72 place-items-center text-center"><div><UserPlus className="mx-auto h-8 w-8 text-neutral-300" /><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">Select an eligible user</p><p className="mb-0 mt-1 text-xs text-neutral-500">Their sales profile and contract details will be configured here.</p></div></div> : (
              <>
                <div className="mt-4 border-l-2 border-emerald-600 px-3 py-1"><p className="m-0 text-xs font-bold text-neutral-900">{selectedUser.name || selectedUser.email}</p><p className="m-0 mt-0.5 text-[11px] text-neutral-500">{selectedUser.email} / user #{selectedUser.id}</p></div>
                {!selectedUser.salesProfileReady && (
                  <div className="mt-3 border-l-2 border-amber-500 px-3 py-1 text-[11px] leading-5 text-amber-800">
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
      ) : (
        <>
          <section className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className={`${fieldClass} pl-9`} placeholder="Search code, partner, email or region" aria-label="Search sales partners" /></label>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={fieldClass} aria-label="Filter partner status">{partnerStatuses.map((item) => <option key={item || "ALL"} value={item}>{item || "ALL STATUSES"}</option>)}</select>
            </div>
          </section>

          <div>
            <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
              {loading ? <div className="grid min-h-72 place-items-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : partners.length === 0 ? <div className="grid min-h-72 place-items-center p-8 text-center"><div><Users className="mx-auto h-8 w-8 text-neutral-300" /><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">No matching partners</p><p className="mb-0 mt-1 text-xs text-neutral-500">Promote an existing user or adjust the filters.</p></div></div> : (
                <>
                  <div>
                    <table className="w-full table-fixed border-collapse text-left">
                      <thead className="border-b border-neutral-200 bg-neutral-50">
                        <tr className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">
                          <th className="w-[29%] px-4 py-3">Partner</th>
                          <th className="w-[12%] px-3 py-3">Status</th>
                          <th className="hidden w-[10%] px-3 py-3 sm:table-cell">Level</th>
                          <th className="w-[17%] px-3 py-3">Coverage</th>
                          <th className="w-[8%] px-3 py-3 text-right">Leads</th>
                          <th className="hidden w-[11%] px-3 py-3 text-right md:table-cell">Attributions</th>
                          <th className="hidden w-[12%] px-3 py-3 lg:table-cell">Joined</th>
                          <th className="w-[10%] px-4 py-3 text-right"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {partners.map((partner) => (
                          <tr key={partner.id} className={`transition ${selectedPartner?.id === partner.id ? "bg-emerald-50" : "hover:bg-neutral-50"}`}>
                            <td className="px-4 py-3">
                              <span className="block truncate text-xs font-bold text-neutral-950">{partner.user.name || partner.user.email}</span>
                              <span className="mt-0.5 block truncate font-mono text-[10px] font-semibold text-emerald-700">{partner.agentCode}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-neutral-400">{partner.user.email}</span>
                            </td>
                            <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusTone(partner.status)}`}>{partner.status}</span></td>
                            <td className="hidden px-3 py-3 text-[11px] font-semibold text-neutral-600 sm:table-cell">{partner.level}</td>
                            <td className="truncate px-3 py-3 text-[11px] text-neutral-600">{partner.region || "Not set"}</td>
                            <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums text-neutral-700">{partner._count.leads}</td>
                            <td className="hidden px-3 py-3 text-right text-xs font-semibold tabular-nums text-neutral-700 md:table-cell">{partner._count.attributions}</td>
                            <td className="hidden whitespace-nowrap px-3 py-3 text-[11px] text-neutral-500 lg:table-cell">{date(partner.createdAt)}</td>
                            <td className="px-4 py-3 text-right"><button type="button" onClick={() => void openPartner(partner.id)} className="inline-flex h-8 items-center justify-center rounded-lg border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700 transition hover:border-emerald-300 hover:text-emerald-800">View</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3">
                    <p className="m-0 text-[11px] text-neutral-500">
                      Showing {total ? (page - 1) * partnerPageSize + 1 : 0}–{Math.min(page * partnerPageSize, total)} of {total}
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40" aria-label="Previous partner page"><ChevronLeft className="h-4 w-4" /></button>
                      <span className="min-w-16 text-center text-[11px] font-semibold text-neutral-600">{page} / {totalPages}</span>
                      <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading} className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40" aria-label="Next partner page"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}

      {detailOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-neutral-950/45 p-3 backdrop-blur-sm sm:p-6" onMouseDown={() => setDetailOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sales-partner-detail-title"
            className="max-h-[calc(100dvh-24px)] w-full max-w-5xl overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-48px)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-neutral-200 bg-white px-5 py-4">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Sales partner record</p>
                <h2 id="sales-partner-detail-title" className="mb-0 mt-1 truncate text-lg font-bold text-neutral-950">
                  {selectedPartner?.user.name || selectedPartner?.user.email || "Partner details"}
                </h2>
              </div>
              <button type="button" onClick={() => setDetailOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900" aria-label="Close partner details"><X className="h-4 w-4" /></button>
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
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusTone(selectedPartner.status)}`}>{selectedPartner.status}</span>
                      <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700">{selectedPartner.level}</span>
                    </div>
                    <p className="mb-0 mt-2 text-sm font-semibold text-neutral-800">{selectedPartner.user.email}</p>
                    <p className="mb-0 mt-1 text-xs text-neutral-500">{selectedPartner.phone || selectedPartner.user.phone || "No phone number"}</p>
                  </div>
                  <div className="text-right text-[11px] text-neutral-500">
                    <p className="m-0">Joined {date(selectedPartner.createdAt)}</p>
                    <p className="mb-0 mt-1">Activated {date(selectedPartner.activatedAt)}</p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 border-y border-neutral-200 md:grid-cols-6">
                  {[
                    ["Region", selectedPartner.region || "Not set"],
                    ["Territory", selectedPartner.territory || "Not set"],
                    ["Leads", selectedPartner._count.leads],
                    ["Attributions", selectedPartner._count.attributions],
                    ["Commissions", selectedPartner._count.commissions],
                    ["Payouts", selectedPartner._count.payoutRequests],
                  ].map(([label, value], index) => (
                    <div key={String(label)} className={`min-w-0 px-3 py-3 ${index % 2 ? "border-l border-neutral-200" : ""} md:border-l ${index === 0 ? "md:border-l-0" : ""}`}>
                      <dt className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">{label}</dt>
                      <dd className="mb-0 mt-1 truncate text-xs font-semibold text-neutral-700">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div>
                  <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Agreements</h3>
                  <div className="mt-2 border-y border-neutral-200">
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
                        <tbody key={contract.id} className="border-t border-neutral-100">
                          <tr className="align-top">
                            <td className="break-words px-3 py-3 text-[11px] font-bold text-neutral-900">
                              {contract.contractNumber}
                              {contract.invitationSentAt && <span className="mt-1 block text-[9px] font-normal text-neutral-400">Invite {contract.invitationUsedAt ? "used" : `expires ${date(contract.invitationExpiresAt)}`}</span>}
                            </td>
                            <td className="px-3 py-3 text-[10px] leading-5 text-neutral-500">{date(contract.startsAt)} – {date(contract.expiresAt)}</td>
                            <td className="px-3 py-3 text-[10px] leading-5 text-neutral-500">NRMS {Number(contract.nrmsCommissionRate)}%<br />Marketplace {Number(contract.marketplaceRevenueRate)}%</td>
                            <td className="px-3 py-3"><span className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusTone(contract.status)}`}>{contract.status}</span></td>
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

                <div className="border-t border-neutral-200 pt-4">
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
