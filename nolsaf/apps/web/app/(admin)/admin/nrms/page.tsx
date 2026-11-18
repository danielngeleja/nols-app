"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, Building2, ChevronLeft, ChevronRight, Coins, Eye, Handshake, Hotel, Loader2, MessageCircle, Search, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { CountPill, EmptyState, SectionHeader } from "./_components/CommercialUi";
import { useAdminHref } from "@/lib/adminRecordRefs";

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
  const recordHref = useAdminHref();
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

  /** Account mix for the band's portfolio bar; every status lands in exactly one group. */
  const portfolio = useMemo(() => {
    const count = (statuses: string[]) => properties.filter((p) => statuses.includes(p.accountStatus)).length;
    const attention = ["WARNING", "PAYMENT_REQUIRED", "PAYMENT_PENDING"];
    const known = ["ACTIVE", "TRIAL", ...attention];
    return [
      { key: "active", label: "Active", count: count(["ACTIVE"]), bar: "bg-emerald-400" },
      { key: "trial", label: "Trial", count: count(["TRIAL"]), bar: "bg-sky-400" },
      { key: "attention", label: "Payment due", count: count(attention), bar: "bg-amber-400" },
      { key: "other", label: "Frozen, closed", count: properties.filter((p) => !known.includes(p.accountStatus)).length, bar: "bg-white/35" },
    ];
  }, [properties]);

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div id="nrms-directory" className="w-full min-w-0 max-w-none space-y-4">
      {/* Preflight is disabled in this project; without border-box, w-full controls (e.g. the property search box) overflow their container */}
      <style>{`#nrms-directory, #nrms-directory * { box-sizing: border-box; }`}</style>

      {/* Identity band with the live portfolio mix, in the operator-record language */}
      <section className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden="true" />
        <div className="relative grid min-w-0 gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">NRMS commercial</p>
              <span className="inline-flex items-center gap-1 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-white/70"><Eye className="h-3 w-3" aria-hidden /> Read-only</span>
            </div>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">NRMS Directory</h1>
            <p className="m-0 mt-1 text-[12px] text-white/60">Every enrolled owner and activated property.</p>
            <div className="mt-4">
              {stats.owing > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-amber-400/15 px-2.5 py-1.5 text-[11px] font-bold text-amber-200">
                  <span className="relative flex h-2 w-2" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" /></span>
                  {stats.owing} {stats.owing === 1 ? "property owes" : "properties owe"} {money(stats.owed)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-md bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-200"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Every account is paid up</span>
              )}
            </div>
          </div>

          {/* Portfolio mix: where every NRMS property's account stands */}
          <div className="min-w-0 rounded-md bg-white/[0.04] p-4 ring-1 ring-white/10">
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Portfolio</p>
              <p className="m-0 text-[11px] text-white/55">
                {stats.properties ? <><span className="font-bold tabular-nums text-emerald-300">{Math.round((stats.active / stats.properties) * 100)}%</span> billing in force</> : "No properties yet"}
              </p>
            </div>
            <p className="m-0 mt-2 text-2xl font-black tabular-nums tracking-tight text-white">
              {stats.properties} <span className="text-sm font-semibold text-white/50">{stats.properties === 1 ? "property" : "properties"}</span>
            </p>
            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={portfolio.map((p) => `${p.label} ${p.count}`).join(", ")}>
              {portfolio.map((p) => (
                <span key={p.key} className={`h-full transition-all duration-700 ${p.bar}`} style={{ width: `${stats.properties ? (p.count / stats.properties) * 100 : 0}%` }} />
              ))}
            </div>
            <dl className="m-0 mt-3 grid grid-cols-4 gap-2">
              {portfolio.map((p) => (
                <div key={p.key} className="min-w-0">
                  <dt className="flex items-center gap-1.5 truncate text-[10px] font-semibold text-white/50"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.bar}`} aria-hidden /> {p.label}</dt>
                  <dd className="m-0 mt-0.5 text-[12px] font-bold tabular-nums text-white/90">{p.count}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Workspaces, as a quiet strip inside the band */}
        <nav aria-label="NRMS workspaces" className="relative flex min-w-0 gap-1 overflow-x-auto border-0 border-t border-solid border-white/10 px-3 py-2 sm:px-5">
          {[
            { href: "/admin/nrms/messaging", label: "Meta messaging", Icon: MessageCircle },
            { href: "/admin/nrms/agents", label: "Verify agencies", Icon: ShieldCheck },
            { href: "/admin/nrms/partnerships", label: "Partnerships", Icon: Handshake },
            { href: "/admin/nrms/billing", label: "PAYG billing board", Icon: Wallet },
            { href: "/admin/nrms/pricing", label: "Pricing & levers", Icon: Coins },
            { href: "/admin/nrms/health", label: "System health", Icon: ShieldAlert },
          ].map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-[12px] font-semibold text-white/70 no-underline transition hover:bg-white/[0.08] hover:text-white"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-300/70 group-hover:text-emerald-300" aria-hidden />
              {label}
              <ChevronRight className="h-3 w-3 shrink-0 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-white/60" aria-hidden />
            </Link>
          ))}
        </nav>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}

      {/* Summary, joined cells like the operator statement's money strip */}
      <section aria-label="Directory summary" className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { Icon: Building2, label: "Properties", value: String(stats.properties), detail: `${stats.active} active`, ink: "text-neutral-950", iconTone: "text-neutral-300" },
          { Icon: ShieldCheck, label: "Active", value: String(stats.active), detail: "Billing in force", ink: stats.active ? "text-emerald-700" : "text-neutral-400", iconTone: "text-neutral-300" },
          { Icon: Hotel, label: "On trial", value: String(stats.trial), detail: "Free usage window", ink: stats.trial ? "text-sky-700" : "text-neutral-400", iconTone: "text-neutral-300" },
          { Icon: AlertTriangle, label: "Owing", value: String(stats.owing), detail: "Properties with a balance", ink: stats.owing ? "text-amber-600" : "text-neutral-400", iconTone: stats.owing ? "text-amber-500" : "text-neutral-300" },
          { Icon: Wallet, label: "Total owed", value: money(stats.owed), detail: "Across all accounts", ink: stats.owed ? "text-amber-600" : "text-neutral-400", iconTone: stats.owed ? "text-amber-500" : "text-neutral-300" },
        ].map(({ Icon, label, value, detail, ink, iconTone }) => (
          <div key={label} className="min-w-0 bg-white px-4 py-3 last:col-span-2 sm:last:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-semibold text-neutral-500">{label}</p>
              <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} aria-hidden />
            </div>
            <p className={`m-0 mt-1 break-words text-lg font-black tabular-nums tracking-tight ${ink}`}>{value}</p>
            <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{detail}</p>
          </div>
        ))}
      </section>

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
              <p className="m-0 text-[10px] font-bold text-neutral-400">Would book through NoLSAF again</p>
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
          <table className="directory-register w-full min-w-[760px] table-fixed border-collapse text-left">
            <caption className="sr-only">NRMS enrolled owners</caption>
            <colgroup>{[23, 32, 15, 15, 15].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
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
          <table className="directory-register directory-properties-register w-full min-w-[92rem] table-fixed border-collapse text-left">
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
                    <td className="whitespace-nowrap px-4 py-3.5 text-neutral-500">{p.trialEndsAt ? shortDate(p.trialEndsAt) : "Not recorded"}</td>
                    <td className={`whitespace-nowrap px-4 py-3.5 text-right tabular-nums ${nearLimit ? "font-bold text-red-600" : "text-neutral-600"}`}>{p.unpaidBalance.toLocaleString()} / {p.unpaidLimit.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-600">{p.rooms}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-600">{p.activeStaff}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-600">{p.activeOutlets}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-600">{p.activeOrderPoints}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-neutral-500">{shortDate(p.lastOrderAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-neutral-500">{shortDate(p.lastNightAuditAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right sm:px-5"><Link href={recordHref("property", p.propertyId)} className="inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800 no-underline transition hover:border-emerald-300 hover:bg-emerald-100">View</Link></td>
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
