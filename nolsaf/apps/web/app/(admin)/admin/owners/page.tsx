"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Search, X, Download, ArrowUpDown, ArrowUp, ArrowDown, FileText, Filter, ChevronLeft, ChevronRight, Radar, Wallet, Users, UserCheck, Clock, ShieldCheck, ShieldX, Ban } from "lucide-react";
import DatePickerField from "@/components/DatePickerField";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";
import apiClient from "@/lib/apiClient";
import { io, Socket } from "socket.io-client";
import TableRow from "@/components/TableRow";
import Link from "next/link";
import { useAdminHref } from "@/lib/adminRecordRefs";

// Use same-origin calls (Next rewrites proxy to API in dev). Use secure cookie session.
const api = apiClient;

type Row = {
  id:number; name:string|null; email:string; phone:string|null;
  createdAt:string; suspendedAt:string|null; kycStatus:string|null;
  _count: { properties:number };
  /** True when at least one of the owner's properties has NRMS switched on.
   *  null when the lookup did not run, which is not the same as false. */
  nrmsActive?: boolean | null;
  /** True when a live merchant link of theirs has an ACTIVE provider account,
   *  i.e. money can actually move. A draft application does not count. */
  paymentsActive?: boolean | null;
};

export default function AdminOwnersPage() {
  const recordHref = useAdminHref();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({
    "": 0,
    ACTIVE: 0,
    SUSPENDED: 0,
    PENDING_KYC: 0,
    APPROVED_KYC: 0,
    REJECTED_KYC: 0,
    NRMS_ACTIVE: 0,
    PAYMENTS_ACTIVE: 0,
    NRMS_NO_PAYMENTS: 0,
  });

  // Sorting
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  
  // Advanced filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [propertiesMin, setPropertiesMin] = useState<string>("");
  const [propertiesMax, setPropertiesMax] = useState<string>("");
  // Capability filters. "" means no filter, "yes"/"no" are sent to the API and
  // applied to the whole table, not just the loaded page.
  const [nrmsFilter, setNrmsFilter] = useState<"" | "yes" | "no">("");
  const [paymentsFilter, setPaymentsFilter] = useState<"" | "yes" | "no">("");
  
  const [suggestions, setSuggestions] = useState<Row[]>([]);
  const itemsCount = items?.length ?? 0;

  type OwnersResponse = {
    items: Row[];
    total: number;
    page: number;
    pageSize: number;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { q, status, page, pageSize };
      if (sortBy) {
        params.sortBy = sortBy;
        params.sortDir = sortDir;
      }
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (propertiesMin) params.propertiesMin = propertiesMin;
      if (propertiesMax) params.propertiesMax = propertiesMax;
      if (nrmsFilter) params.nrms = nrmsFilter;
      if (paymentsFilter) params.payments = paymentsFilter;
      const r = await api.get<OwnersResponse>("/api/admin/owners", { params });
      let sortedItems = r.data.items ?? [];
      
      // Client-side sorting if API doesn't support it
      if (sortBy && sortedItems.length > 0) {
        sortedItems = [...sortedItems].sort((a, b) => {
          let aVal: any, bVal: any;
          switch (sortBy) {
            case "name":
              aVal = (a.name || a.email || "").toLowerCase();
              bVal = (b.name || b.email || "").toLowerCase();
              break;
            case "createdAt":
              aVal = new Date(a.createdAt).getTime();
              bVal = new Date(b.createdAt).getTime();
              break;
            case "properties":
              aVal = a._count.properties;
              bVal = b._count.properties;
              break;
            default:
              return 0;
          }
          if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
          if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
          return 0;
        });
      }
      
      setItems(sortedItems);
      setTotal(r.data.total ?? 0);
    } catch (err: any) {
      // network or server errors shouldn't break the page — log and show empty list
      // eslint-disable-next-line no-console
      console.error('Failed to load owners list', err);
      console.error('Error details:', {
        message: err?.message,
        response: err?.response?.data,
        status: err?.response?.status,
        url: err?.config?.url,
      });
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, status, page, sortBy, sortDir, dateFrom, dateTo, propertiesMin, propertiesMax, nrmsFilter, paymentsFilter]);
  
  // Sort handler
  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
    setPage(1);
  };

  useEffect(() => { void load(); }, [load]);

  // optional counts fetch; keep zeros if endpoint missing
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<Record<string, number>>('/api/admin/owners/counts', {
          validateStatus: (status) => status < 500 // Don't throw on 4xx errors
        });
        
        // Check if response is actually JSON
        const contentType = String(r.headers['content-type'] ?? '');
        if (contentType && contentType.includes('application/json') && r?.data && typeof r.data === 'object') {
          setCounts((p) => ({ ...p, ...r.data }));
        }
      } catch (e: any) {
        // Silently ignore - counts are optional
        // Only log if it's not a 401/403 (auth errors are expected if not logged in)
        if (e?.response?.status !== 401 && e?.response?.status !== 403) {
          console.warn('Failed to fetch owner counts:', e?.message || e);
        }
      }
    })();
  }, []);

  const handleSearch = useCallback(async () => {
    try {
      await load();
    } catch (e) {
      // swallow network errors for UX
    }
    // analytics/logging (fire-and-forget)
    try {
      console.log("[analytics] owners search", { query: q, ts: new Date().toISOString() });
      api.post("/admin/analytics/search", { query: q, timestamp: new Date().toISOString() }).catch(() => {});
    } catch (e) { /* swallow */ }
  }, [load, q]);

  // Debounce automatic search when typing (suggestions)
  useEffect(() => {
    const term = q;
    if (!term || term.trim() === "") {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      (async () => {
        try {
          const r = await api.get<{ items: Row[] }>("/api/admin/owners", {
            params: { status, q: term, page: 1, pageSize: 5 },
          });
          setSuggestions(r.data.items ?? []);
        } catch (e) {
          setSuggestions([]);
        }
        // also perform the full search to update the main list
        handleSearch().catch(() => {});
      })();
    }, 500);
    return () => clearTimeout(t);
  }, [q, status, handleSearch]);

  // live refresh when KYC/suspend changes
  useEffect(()=>{
    // Use direct API URL for Socket.IO in browser to ensure WebSocket works in dev
    const url = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000")
      : (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "");
    // Socket auth is optional; API auth is cookie-based for HTTP calls.
    const s: Socket = io(url, { transports: ['websocket'] });
    s.on("admin:owner:updated", load);
    s.on("admin:kyc:updated", load);
    return ()=>{ s.off("admin:owner:updated", load); s.off("admin:kyc:updated", load); s.disconnect(); };
  },[load]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  const exportOwners = async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (q) params.set("q", q);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (propertiesMin) params.set("propertiesMin", propertiesMin);
      if (propertiesMax) params.set("propertiesMax", propertiesMax);
      const response = await fetch(`/api/admin/owners/export.csv?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `owners_export_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export owners:", err);
      alert("Failed to export owners. Please try again.");
    }
  };

  const advancedCount = [dateFrom, dateTo, propertiesMin, propertiesMax].filter(Boolean).length;
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  const chip = "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-solid px-3 text-[13px] font-semibold [font-family:inherit] cursor-pointer transition-colors";
  const idle = "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <div id="admin-owners" className="w-full min-w-0 space-y-4">
      <style>{`#admin-owners, #admin-owners * { box-sizing: border-box; }`}</style>

      <SalesAdminHeader
        kicker="People"
        title="Owners"
        description="Identity checks, account status and what each owner has switched on."
        metrics={[
          { label: "Owners", value: counts[""] || 0 },
          { label: "Active", value: counts.ACTIVE || 0, tone: "good" },
          { label: "Pending KYC", value: counts.PENDING_KYC || 0, tone: (counts.PENDING_KYC || 0) > 0 ? "warn" : "muted" },
          { label: "Suspended", value: counts.SUSPENDED || 0, tone: "muted" },
        ]}
        actions={
          <button type="button" onClick={exportOwners} title="Export owners as CSV" aria-label="Export owners as CSV" className="grid w-10 shrink-0 cursor-pointer place-items-center rounded-md border border-solid border-white/15 bg-white/[0.04] text-white/80 [font-family:inherit] hover:bg-white/10 hover:text-white">
            <Download className="h-4 w-4" />
          </button>
        }
        onRefresh={() => void load()}
        loading={loading}
        tabs={STATUS_TABS.map((t) => ({ ...t, count: counts[t.key === "ALL" ? "" : t.key] ?? 0 }))}
        activeTab={(status || "ALL") as StatusTab}
        onTab={(key) => { setStatus(key === "ALL" ? "" : key); setPage(1); }}
      />

      {/* Search and filters, left aligned */}
      <div className="rounded-lg border border-solid border-slate-200 bg-white p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              className="h-9 w-full rounded-md border border-solid border-slate-300 bg-white pl-9 pr-9 text-sm outline-none focus:border-[#02665e]"
              placeholder="Search name, email or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setPage(1); load(); } }}
              aria-label="Search owners"
            />
            {q ? (
              <button type="button" onClick={() => { setQ(""); setPage(1); }} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            ) : null}
            {suggestions.length > 0 && q ? (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-solid border-slate-200 bg-white shadow-lg">
                {suggestions.map((sug) => (
                  <Link key={sug.id} href={recordHref("owner", sug.id)} className="block px-3 py-2 text-sm text-slate-800 no-underline hover:bg-slate-50">
                    <span className="block font-medium">{sug.name ?? sug.email}</span>
                    <span className="block text-xs text-slate-500">{sug.email}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 gap-2 overflow-x-auto pb-0.5 lg:pb-0">
            {[
              { key: "nrms" as const, on: nrmsFilter, set: setNrmsFilter, icon: Radar, yes: "On NRMS", no: "No NRMS", count: counts.NRMS_ACTIVE },
              { key: "payments" as const, on: paymentsFilter, set: setPaymentsFilter, icon: Wallet, yes: "Takes payment", no: "No payment method", count: counts.PAYMENTS_ACTIVE },
            ].map(({ key, on, set, icon: Icon, yes, no, count }) => {
              const next = on === "" ? "yes" : on === "yes" ? "no" : "";
              const skin = on === "yes" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : on === "no" ? "border-amber-300 bg-amber-50 text-amber-800" : idle;
              return (
                <button key={key} type="button" onClick={() => { set(next); setPage(1); }} className={`${chip} ${skin}`}
                  title={on === "" ? `Show only owners ${yes.toLowerCase()}` : on === "yes" ? `Show only owners with ${no.toLowerCase()}` : "Clear this filter"}>
                  <Icon className="h-4 w-4" aria-hidden />
                  {on === "no" ? no : yes}
                  {on === "" ? <span className="rounded bg-slate-100 px-1.5 text-[11px] tabular-nums text-slate-600">{count ?? 0}</span> : null}
                </button>
              );
            })}
            {counts.NRMS_NO_PAYMENTS > 0 ? (
              <button type="button" onClick={() => { setNrmsFilter("yes"); setPaymentsFilter("no"); setPage(1); }}
                className={`${chip} ${nrmsFilter === "yes" && paymentsFilter === "no" ? "border-amber-300 bg-amber-50 text-amber-800" : idle}`}
                title="Owners running NRMS who still cannot take a payment">
                NRMS, no payment
                <span className="rounded bg-amber-100 px-1.5 text-[11px] tabular-nums text-amber-800">{counts.NRMS_NO_PAYMENTS}</span>
              </button>
            ) : null}
            <button type="button" onClick={() => setShowAdvancedFilters((v) => !v)}
              className={`${chip} ${showAdvancedFilters || advancedCount ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : idle}`}>
              <Filter className="h-4 w-4" /> Filters{advancedCount ? <span className="rounded bg-[#02665e] px-1.5 text-[11px] text-white">{advancedCount}</span> : null}
            </button>
          </div>
        </div>

        {showAdvancedFilters ? (
          <div className="mt-3 grid grid-cols-1 gap-3 border-0 border-t border-solid border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
            <DatePickerField label="Joined from" value={dateFrom} onChangeAction={(iso) => { setDateFrom(String(iso).slice(0, 10)); setPage(1); }} max={dateTo || undefined} allowPast size="sm" widthClassName="w-full" />
            <DatePickerField label="Joined to" value={dateTo} onChangeAction={(iso) => { setDateTo(String(iso).slice(0, 10)); setPage(1); }} min={dateFrom || undefined} allowPast size="sm" widthClassName="w-full" />
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Min properties</span>
              <input type="number" min="0" value={propertiesMin} onChange={(e) => { setPropertiesMin(e.target.value); setPage(1); }} placeholder="0" className="h-9 w-full rounded-md border border-solid border-slate-300 px-3 text-sm outline-none focus:border-[#02665e]" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Max properties</span>
              <input type="number" min="0" value={propertiesMax} onChange={(e) => { setPropertiesMax(e.target.value); setPage(1); }} placeholder="No limit" className="h-9 w-full rounded-md border border-solid border-slate-300 px-3 text-sm outline-none focus:border-[#02665e]" />
            </label>
            <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); setPropertiesMin(""); setPropertiesMax(""); setPage(1); }} className={`${chip} justify-center ${idle}`}>
              <X className="h-4 w-4" /> Clear
            </button>
          </div>
        ) : null}
      </div>

      {/* Results */}
      <div className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        {loading && itemsCount === 0 ? (
          <div className="grid min-h-40 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-solid border-slate-200 border-t-[#02665e]" /></div>
        ) : itemsCount === 0 ? (
          <div className="px-6 py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-700">No owners match</p>
            <p className="m-0 mt-0.5 text-xs text-slate-500">Change the search or filters.</p>
          </div>
        ) : (
          <>
            {/* Phones: one row per owner */}
            <ul className="m-0 list-none p-0 md:hidden">
              {items.map((o) => (
                <li key={o.id} className="border-0 border-t border-solid border-slate-100 first:border-t-0">
                  <Link href={recordHref("owner", o.id)} className="flex items-start gap-3 px-4 py-3 text-slate-900 no-underline hover:bg-slate-50">
                    <Initials name={o.name || o.email} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{o.name?.trim() || "Name not set"}</span>
                      <span className="block truncate text-xs text-slate-500">{o.email}{o.phone ? ` · ${o.phone}` : ""}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        <StatusPill suspended={Boolean(o.suspendedAt)} />
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${badge(o.kycStatus)}`}>KYC {kycLabel(o.kycStatus).toLowerCase()}</span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200"><Building2 className="h-3 w-3" />{o._count.properties}</span>
                        {o.nrmsActive ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200"><Radar className="h-3 w-3" />NRMS</span> : null}
                        {o.paymentsActive ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200"><Wallet className="h-3 w-3" />Payments</span> : null}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>

            {/* Tablet and up: a table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <SortTh label="Owner" column="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-2.5 font-semibold">Phone</th>
                    <SortTh label="Properties" column="properties" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-2.5 font-semibold">NRMS</th>
                    <th className="px-4 py-2.5 font-semibold">Payments</th>
                    <th className="px-4 py-2.5 font-semibold">KYC</th>
                    <th className="px-4 py-2.5 font-semibold">Account</th>
                    <SortTh label="Joined" column="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <th className="w-10 px-2 py-2.5"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((o) => (
                    <TableRow key={o.id} className="border-0 border-t border-solid border-slate-100 hover:bg-slate-50/70">
                      <td className="max-w-[300px] px-4 py-2.5">
                        <Link href={recordHref("owner", o.id)} className="flex min-w-0 items-center gap-3 text-slate-900 no-underline">
                          <Initials name={o.name || o.email} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold hover:text-[#02665e]">{o.name?.trim() || "Name not set"}</span>
                            <span className="block truncate text-xs text-slate-500">{o.email}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{o.phone ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold tabular-nums text-slate-800">{o._count.properties}</td>
                      <td className="whitespace-nowrap px-4 py-2.5"><CapabilityPill on={o.nrmsActive} offLabel="Off" /></td>
                      <td className="whitespace-nowrap px-4 py-2.5"><CapabilityPill on={o.paymentsActive} offLabel="None" /></td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${badge(o.kycStatus)}`} aria-label={`KYC: ${kycLabel(o.kycStatus)}`}>{kycLabel(o.kycStatus)}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5"><StatusPill suspended={Boolean(o.suspendedAt)} /></td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                        {new Date(o.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <Link href={recordHref("owner", o.id)} className="inline-grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#02665e]/10 hover:text-[#02665e]" aria-label={`Open ${o.name || o.email}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Paging, inside the same card */}
        <div className="flex flex-col gap-2 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[13px] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>{total ? <>Showing <b className="text-slate-900">{firstRow}</b> to <b className="text-slate-900">{lastRow}</b> of <b className="text-slate-900">{total}</b></> : "No owners"}</span>
          {pages > 1 ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading} aria-label="Previous page"
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => {
                if (pages <= 5 || n === 1 || n === pages || (n >= page - 1 && n <= page + 1)) {
                  return (
                    <button key={n} type="button" onClick={() => setPage(n)} disabled={loading}
                      className={`h-8 min-w-8 cursor-pointer rounded-md border border-solid px-2 text-[13px] font-semibold [font-family:inherit] ${page === n ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{n}</button>
                  );
                }
                if ((page > 3 && n === 2) || (page < pages - 2 && n === pages - 1)) return <span key={n} className="px-1 text-slate-400">…</span>;
                return null;
              })}
              <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages || loading} aria-label="Next page"
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type StatusTab = "ALL" | "ACTIVE" | "PENDING_KYC" | "APPROVED_KYC" | "REJECTED_KYC" | "SUSPENDED";
const STATUS_TABS: Array<{ key: StatusTab; label: string; Icon: typeof Users }> = [
  { key: "ALL", label: "All", Icon: Users },
  { key: "ACTIVE", label: "Active", Icon: UserCheck },
  { key: "PENDING_KYC", label: "Pending KYC", Icon: Clock },
  { key: "APPROVED_KYC", label: "Approved KYC", Icon: ShieldCheck },
  { key: "REJECTED_KYC", label: "Rejected KYC", Icon: ShieldX },
  { key: "SUSPENDED", label: "Suspended", Icon: Ban },
];

function Initials({ name }: { name: string }) {
  const letters = String(name || "?").trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[12px] font-bold text-[#02665e]">{letters}</span>;
}

function StatusPill({ suspended }: { suspended: boolean }) {
  return suspended
    ? <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">Suspended</span>
    : <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Active</span>;
}

function SortTh({ label, column, sortBy, sortDir, onSort }: { label: string; column: string; sortBy: string | null; sortDir: "asc" | "desc"; onSort: (c: string) => void }) {
  const on = sortBy === column;
  return (
    <th className="px-4 py-2.5 font-semibold">
      <button type="button" onClick={() => onSort(column)} className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 [font-family:inherit] hover:text-slate-800">
        {label}
        {on ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-slate-300" />}
      </button>
    </th>
  );
}

/** Preflight is disabled project-wide, so `border` on a <span> paints nothing.
 *  Outlines here have to come from `ring-*`. */
function badge(status:string|null){
  // Use similar semantic colors as the status buttons (slightly stronger bg)
  if (status === "APPROVED_KYC") return "bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700";
  if (status === "REJECTED_KYC") return "bg-red-50 ring-1 ring-red-200 text-red-700";
  if (status === "PENDING_KYC") return "bg-amber-50 ring-1 ring-amber-200 text-amber-800";
  return "bg-gray-50 ring-1 ring-gray-200 text-gray-600";
}

/** Shared "switched on / not switched on" cell for the NRMS and Payments
 *  columns. Green means the capability is genuinely live, not merely started. */
function CapabilityPill({ on, offLabel }: { on: boolean | null | undefined; offLabel: string }) {
  // null means the lookup did not run. Rendering that as "not activated" would
  // be a silent lie on a column people make sales decisions from.
  if (on === null || on === undefined) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-gray-400 outline outline-1 outline-dashed outline-gray-300"
        title="This lookup did not run for this page. Reload to try again."
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gray-300" aria-hidden />
        Unknown
      </span>
    );
  }
  if (on) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-300" aria-hidden />
      {offLabel}
    </span>
  );
}

function kycLabel(status: string|null) {
  switch (status) {
    case "APPROVED_KYC":
      return "Approved";
    case "REJECTED_KYC":
      return "Rejected";
    case "PENDING_KYC":
      return "Pending";
    default:
      // fallback: prettify unknown codes
      return status ? status.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase()) : "Not submitted";
  }
}

// apps/api/src/routes/admin.owners.ts
