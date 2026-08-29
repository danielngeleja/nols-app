"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, Building2, ChevronLeft, ChevronRight, Coins, Handshake, Hotel, Loader2, MessageCircle, Search, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { CountPill, EmptyState, SectionHeader, SummaryCard } from "./_components/CommercialUi";

type Enrollment = {
  id: number;
  status: string;
  planStatus: string;
  trialEndsAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  owner: { id: number; fullName: string | null; name: string | null; email: string | null; phone: string | null };
};

type DirectoryProperty = {
  accountId: number;
  propertyId: number;
  ownerId: number;
  title: string;
  region: string | null;
  accountStatus: string;
  trialEndsAt: string | null;
  unpaidBalance: number;
  unpaidLimit: number;
  policy: { version: string; roomNightPrice: number; trialDays: number; currency: string } | null;
  rooms: number;
  activeStaff: number;
  activeOutlets: number;
  activeOrderPoints: number;
  lastOrderAt: string | null;
  lastNightAuditAt: string | null;
};

const ACCOUNT_BADGE: Record<string, string> = {
  TRIAL: "border-sky-100 bg-sky-50 text-sky-700",
  ACTIVE: "border-emerald-100 bg-emerald-50 text-emerald-700",
  WARNING: "border-amber-100 bg-amber-50 text-amber-700",
  PAYMENT_REQUIRED: "border-red-100 bg-red-50 text-red-700",
  PAYMENT_PENDING: "border-violet-100 bg-violet-50 text-violet-700",
  FROZEN: "border-orange-100 bg-orange-50 text-orange-700",
  CLOSED: "border-neutral-200 bg-neutral-100 text-neutral-500",
};

const ENROLLMENT_BADGE: Record<string, string> = {
  ACTIVE: "border-emerald-100 bg-emerald-50 text-emerald-700",
  TRIAL: "border-sky-100 bg-sky-50 text-sky-700",
  PENDING: "border-neutral-200 bg-neutral-100 text-neutral-500",
  PAST_DUE: "border-amber-100 bg-amber-50 text-amber-700",
  SUSPENDED: "border-red-100 bg-red-50 text-red-700",
  CANCELLED: "border-neutral-200 bg-neutral-100 text-neutral-400",
};

function ownerName(owner: Enrollment["owner"]): string {
  return owner.fullName || owner.name || owner.email || `User #${owner.id}`;
}

function shortDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function money(value: number): string {
  return `TZS ${value.toLocaleString()}`;
}

const PROPERTY_PAGE_SIZE = 10;
const ENROLLMENT_PAGE_SIZE = 10;

export default function AdminNrmsDirectoryPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [properties, setProperties] = useState<DirectoryProperty[]>([]);
  // Platform channel loyalty from verified-stay reviews. Reported to admins only:
  // it measures NoLSAF, not the hotel, so it is never shown in the owner console.
  const [reviewIntent, setReviewIntent] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [enrollmentQuery, setEnrollmentQuery] = useState("");
  const [enrollmentStatusFilter, setEnrollmentStatusFilter] = useState("");
  const [enrollmentPage, setEnrollmentPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/api/admin/nrms/directory");
      setEnrollments(res.data?.enrollments ?? []);
      setProperties(res.data?.properties ?? []);
      setReviewIntent(res.data?.reviewIntent ?? null);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load the NRMS directory");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const ownerById = useMemo(() => {
    const map = new Map<number, Enrollment["owner"]>();
    for (const e of enrollments) map.set(e.owner.id, e.owner);
    return map;
  }, [enrollments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return properties.filter((p) => {
      if (statusFilter && p.accountStatus !== statusFilter) return false;
      if (!q) return true;
      const owner = ownerById.get(p.ownerId);
      return (
        p.title.toLowerCase().includes(q) ||
        (p.region ?? "").toLowerCase().includes(q) ||
        (owner ? ownerName(owner).toLowerCase().includes(q) : false) ||
        (owner?.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [properties, query, statusFilter, ownerById]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PROPERTY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedProperties = filtered.slice((currentPage - 1) * PROPERTY_PAGE_SIZE, currentPage * PROPERTY_PAGE_SIZE);

  const filteredEnrollments = useMemo(() => {
    const q = enrollmentQuery.trim().toLowerCase();
    return enrollments.filter((e) => {
      if (enrollmentStatusFilter && e.status !== enrollmentStatusFilter) return false;
      if (!q) return true;
      return (
        ownerName(e.owner).toLowerCase().includes(q) ||
        (e.owner.email ?? "").toLowerCase().includes(q) ||
        (e.owner.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [enrollments, enrollmentQuery, enrollmentStatusFilter]);

  const enrollmentPageCount = Math.max(1, Math.ceil(filteredEnrollments.length / ENROLLMENT_PAGE_SIZE));
  const enrollmentCurrentPage = Math.min(enrollmentPage, enrollmentPageCount);
  const pagedEnrollments = filteredEnrollments.slice((enrollmentCurrentPage - 1) * ENROLLMENT_PAGE_SIZE, enrollmentCurrentPage * ENROLLMENT_PAGE_SIZE);

  const stats = useMemo(() => ({
    properties: properties.length,
    active: properties.filter((p) => p.accountStatus === "ACTIVE").length,
    trial: properties.filter((p) => p.accountStatus === "TRIAL").length,
    owing: properties.filter((p) => p.unpaidBalance > 0).length,
    owed: properties.reduce((sum, p) => sum + p.unpaidBalance, 0),
  }), [properties]);

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div id="nrms-directory" className="mx-auto w-full min-w-0 max-w-7xl space-y-5 px-4 py-6 2xl:max-w-[1720px]">
      {/* Preflight is disabled in this project; without border-box, w-full controls (e.g. the property search box) overflow their container */}
      <style>{`#nrms-directory, #nrms-directory * { box-sizing: border-box; }`}</style>
      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">NRMS</div>
        <div className="relative flex flex-col flex-wrap gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:gap-3.5 sm:text-left">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Hotel className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS commercial</p>
                <span className="inline-flex rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm">Read-only</span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">NRMS Directory</h1>
              <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500 sm:text-sm">Every enrolled owner and activated property.</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/admin/nrms/messaging" className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-white"><MessageCircle className="h-4 w-4" /> Meta messaging</Link>
            <Link href="/admin/nrms/agents" className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-white"><ShieldCheck className="h-4 w-4" /> Verify agencies</Link>
            <Link href="/admin/nrms/partnerships" className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-white"><Handshake className="h-4 w-4" /> Partnerships</Link>
            <Link href="/admin/nrms/billing" className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-white"><Wallet className="h-4 w-4" /> PAYG billing board</Link>
            <Link href="/admin/nrms/pricing" className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-white"><Coins className="h-4 w-4" /> Pricing &amp; levers</Link>
            <Link href="/admin/nrms/health" className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-white"><ShieldAlert className="h-4 w-4" /> System health</Link>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard icon={Building2} label="Properties" value={String(stats.properties)} detail={`${stats.active} active`} tone="emerald" />
        <SummaryCard icon={ShieldCheck} label="Active" value={String(stats.active)} detail="Billing in force" tone="emerald" />
        <SummaryCard icon={Hotel} label="On trial" value={String(stats.trial)} detail="Free usage window" tone="blue" />
        <SummaryCard icon={AlertTriangle} label="Owing" value={String(stats.owing)} detail="Properties with a balance" tone={stats.owing > 0 ? "amber" : "slate"} />
        <SummaryCard icon={Wallet} label="Total owed" value={money(stats.owed)} detail="Across all accounts" tone={stats.owed > 0 ? "amber" : "slate"} />
      </div>

      {reviewIntent && (reviewIntent.YES || reviewIntent.MAYBE || reviewIntent.NO) ? (() => {
        const total = (reviewIntent.YES || 0) + (reviewIntent.MAYBE || 0) + (reviewIntent.NO || 0);
        const share = (value: number) => (total ? Math.round((value / total) * 100) : 0);
        const bars: Array<{ label: string; value: number; bar: string; text: string }> = [
          { label: "Yes", value: reviewIntent.YES || 0, bar: "bg-emerald-600", text: "text-emerald-700" },
          { label: "Maybe", value: reviewIntent.MAYBE || 0, bar: "bg-amber-500", text: "text-amber-700" },
          { label: "No", value: reviewIntent.NO || 0, bar: "bg-red-600", text: "text-red-700" },
        ];
        return (
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Would book through NoLSAF again</p>
              <p className="m-0 text-[10px] text-neutral-400">{total} verified {total === 1 ? "guest" : "guests"}</p>
            </div>
            <p className="mb-0 mt-1 text-[11px] text-neutral-500">Asked after a verified stay. Platform metric, not shown to owners.</p>
            <div className="mt-3 space-y-1.5">
              {bars.map((row) => (
                <div key={row.label} className="grid grid-cols-[54px_minmax(70px,1fr)_auto] items-center gap-3">
                  <span className="text-[11px] text-neutral-600">{row.label}</span>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-1.5 rounded-full ${row.bar}`} style={{ width: `${share(row.value)}%` }} /></span>
                  <span className="flex min-w-[64px] items-center justify-end gap-1.5">
                    <span className={`text-[11px] font-bold ${row.text}`}>{share(row.value)}%</span>
                    <span className="text-[10px] text-neutral-400">{row.value}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })() : null}

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={ShieldCheck} title="Enrollments" subtitle="Owners who have activated NRMS billing" right={<CountPill count={filteredEnrollments.length} singular="owner" plural="owners" />} />
        <div className="flex flex-col gap-2.5 border-b border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input value={enrollmentQuery} onChange={(e) => { setEnrollmentQuery(e.target.value); setEnrollmentPage(1); }} placeholder="Search owner, email or phone" className="block min-h-9 w-full min-w-0 rounded-lg border border-neutral-200 bg-white py-1.5 pl-9 pr-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" aria-label="Search enrollments" />
          </div>
          <select value={enrollmentStatusFilter} onChange={(e) => { setEnrollmentStatusFilter(e.target.value); setEnrollmentPage(1); }} className="min-h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 outline-none transition hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:w-48 sm:shrink-0" aria-label="Filter by enrollment status">
            <option value="">All statuses</option>
            {Object.keys(ENROLLMENT_BADGE).map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-100 text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2.5 sm:px-5">Owner</th><th className="px-4 py-2.5">Contact</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Activated</th><th className="px-4 py-2.5 sm:px-5">Suspended</th>
              </tr>
            </thead>
            <tbody>
              {pagedEnrollments.map((e, index) => (
                <tr key={e.id} className={`border-b border-neutral-50 text-xs transition last:border-0 hover:bg-emerald-50/70 ${index % 2 === 1 ? "bg-emerald-50/40" : "bg-white"}`}>
                  <td className="px-4 py-3 font-bold text-neutral-800 sm:px-5">{ownerName(e.owner)}</td>
                  <td className="px-4 py-3 text-neutral-500">{e.owner.email ?? e.owner.phone ?? "No contact"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${ENROLLMENT_BADGE[e.status] ?? "border-neutral-200 bg-neutral-100 text-neutral-500"}`}>{e.status}</span></td>
                  <td className="px-4 py-3 text-neutral-500">{shortDate(e.activatedAt)}</td>
                  <td className="px-4 py-3 text-neutral-500 sm:px-5">{shortDate(e.suspendedAt)}</td>
                </tr>
              ))}
              {filteredEnrollments.length === 0 && (
                <tr><td colSpan={5}>
                  {enrollments.length === 0
                    ? <EmptyState icon={ShieldCheck} title="No NRMS enrollments yet" text="Owners appear here once they activate NRMS billing." />
                    : <EmptyState icon={Search} title="No matches" text="No enrollments match this search and filter." />}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredEnrollments.length > ENROLLMENT_PAGE_SIZE && (
          <div className="flex flex-col gap-2 border-t border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="m-0 text-[11px] text-neutral-500">Showing <b className="font-bold text-neutral-700">{(enrollmentCurrentPage - 1) * ENROLLMENT_PAGE_SIZE + 1}-{Math.min(enrollmentCurrentPage * ENROLLMENT_PAGE_SIZE, filteredEnrollments.length)}</b> of {filteredEnrollments.length} owners</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={enrollmentCurrentPage <= 1} onClick={() => setEnrollmentPage(enrollmentCurrentPage - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-[11px] font-bold tabular-nums text-neutral-700">Page {enrollmentCurrentPage} of {enrollmentPageCount}</span>
              <button type="button" disabled={enrollmentCurrentPage >= enrollmentPageCount} onClick={() => setEnrollmentPage(enrollmentCurrentPage + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader
          icon={Building2}
          title="Activated properties"
          subtitle="Every property currently on NRMS billing"
          right={<CountPill count={filtered.length} singular="property" plural="properties" />}
        />
        <div className="flex flex-col gap-2.5 border-b border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search property or owner" className="block min-h-9 w-full min-w-0 rounded-lg border border-neutral-200 bg-white py-1.5 pl-9 pr-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" aria-label="Search properties" />
          </div>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="min-h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 outline-none transition hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 sm:w-48 sm:shrink-0" aria-label="Filter by account status">
            <option value="">All statuses</option>
            {Object.keys(ACCOUNT_BADGE).map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
          </select>
        </div>
        <div
          className="w-full overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]"
          role="region"
          aria-label="Activated properties table"
          tabIndex={0}
        >
          <table className="w-full min-w-[92rem] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[14rem]" />
              <col className="w-[11rem]" />
              <col className="w-[9rem]" />
              <col className="w-[7rem]" />
              <col className="w-[10rem]" />
              <col className="w-[5.5rem]" />
              <col className="w-[5.5rem]" />
              <col className="w-[6rem]" />
              <col className="w-[7rem]" />
              <col className="w-[8rem]" />
              <col className="w-[8rem]" />
              <col className="w-[5rem]" />
            </colgroup>
            <thead className="bg-neutral-50/90">
              <tr className="border-b border-neutral-200 text-[10px] font-bold uppercase tracking-[0.06em] text-neutral-500">
                <th className="sticky left-0 z-10 whitespace-nowrap bg-neutral-50 px-4 py-3 shadow-[1px_0_0_0_rgb(229,229,229)] sm:px-5">Property</th>
                <th className="whitespace-nowrap px-4 py-3">Owner</th>
                <th className="whitespace-nowrap px-4 py-3">Status</th>
                <th className="whitespace-nowrap px-4 py-3">Trial ends</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Balance / limit</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Rooms</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Staff</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Outlets</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">QR points</th>
                <th className="whitespace-nowrap px-4 py-3">Last order</th>
                <th className="whitespace-nowrap px-4 py-3">Last audit</th>
                <th className="whitespace-nowrap px-4 py-3 text-right sm:px-5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pagedProperties.map((p, index) => {
                const owner = ownerById.get(p.ownerId);
                const nearLimit = p.unpaidLimit > 0 && p.unpaidBalance / p.unpaidLimit >= 0.8;
                return (
                  <tr key={p.accountId} className={`group border-b border-neutral-100 text-xs transition last:border-0 hover:bg-emerald-50/70 ${index % 2 === 1 ? "bg-neutral-50/55" : "bg-white"}`}>
                    <td className={`sticky left-0 z-[5] px-4 py-3.5 shadow-[1px_0_0_0_rgb(245,245,245)] transition-colors group-hover:bg-emerald-50 sm:px-5 ${index % 2 === 1 ? "bg-[#fafafa]" : "bg-white"}`}>
                      <span className="block truncate font-bold text-neutral-900" title={p.title}>{p.title}</span>
                      <span className="mt-0.5 block truncate text-[10px] uppercase tracking-wide text-neutral-400">{p.region || "Region unavailable"}</span>
                    </td>
                    <td className="truncate px-4 py-3.5 font-medium text-neutral-600" title={owner ? ownerName(owner) : `Owner #${p.ownerId}`}>{owner ? ownerName(owner) : `Owner #${p.ownerId}`}</td>
                    <td className="whitespace-nowrap px-4 py-3.5"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${ACCOUNT_BADGE[p.accountStatus] ?? "border-neutral-200 bg-neutral-100 text-neutral-500"}`}>{p.accountStatus.replaceAll("_", " ")}</span></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-neutral-500">{p.accountStatus === "TRIAL" ? shortDate(p.trialEndsAt) : "n/a"}</td>
                    <td className={`whitespace-nowrap px-4 py-3.5 text-right tabular-nums ${nearLimit ? "font-bold text-red-600" : "text-neutral-600"}`}>{p.unpaidBalance.toLocaleString()} / {p.unpaidLimit.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-600">{p.rooms}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-600">{p.activeStaff}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-600">{p.activeOutlets}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-600">{p.activeOrderPoints}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-neutral-500">{shortDate(p.lastOrderAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-neutral-500">{shortDate(p.lastNightAuditAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right sm:px-5"><Link href={`/admin/nrms/${p.propertyId}`} className="inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800 no-underline transition hover:border-emerald-300 hover:bg-emerald-100">View</Link></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={12}>
                  {properties.length === 0
                    ? <EmptyState icon={Building2} title="No activated properties" text="Properties appear here once an owner activates NRMS." />
                    : <EmptyState icon={Search} title="No matches" text="No properties match this search and filter." />}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > PROPERTY_PAGE_SIZE && (
          <div className="flex flex-col gap-2 border-t border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="m-0 text-[11px] text-neutral-500">Showing <b className="font-bold text-neutral-700">{(currentPage - 1) * PROPERTY_PAGE_SIZE + 1}-{Math.min(currentPage * PROPERTY_PAGE_SIZE, filtered.length)}</b> of {filtered.length} properties</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-[11px] font-bold tabular-nums text-neutral-700">Page {currentPage} of {pageCount}</span>
              <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
