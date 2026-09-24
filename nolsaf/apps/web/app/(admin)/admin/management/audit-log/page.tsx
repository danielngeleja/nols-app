"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search, ShieldCheck } from "lucide-react";

type Audit = {
  id: number;
  adminId?: number | null;
  targetUserId?: number | null;
  action: string;
  details: any;
  createdAt: string;
};

const pageSize = 12;

export default function AuditLogPage() {
  const [data, setData] = useState<Audit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [actor, setActor] = useState("all");
  const [selectedAudit, setSelectedAudit] = useState<Audit | null>(null);

  const exportUrl = "/api/admin/audits?format=csv";
  const audits = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const filteredAudits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return audits.filter((audit) => {
      if (actor === "system" && audit.adminId != null) return false;
      if (actor === "admin" && audit.adminId == null) return false;
      const haystack = [
        audit.id,
        audit.adminId,
        audit.targetUserId,
        audit.action,
        audit.createdAt,
        JSON.stringify(audit.details ?? {}),
      ]
        .filter((value) => value !== null && value !== undefined)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [audits, query, actor]);

  useEffect(() => {
    setPage(1);
  }, [query, actor]);

  const totalPages = Math.max(1, Math.ceil(filteredAudits.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedAudits = filteredAudits.slice((safePage - 1) * pageSize, safePage * pageSize);

  function coerceAudits(json: any): Audit[] {
    if (json && typeof json === "object") {
      const dataNode = json.data;
      if (Array.isArray(dataNode)) return dataNode as Audit[];
      if (dataNode && typeof dataNode === "object") {
        if (Array.isArray(dataNode.items)) return dataNode.items as Audit[];
        if (Array.isArray(dataNode.audits)) return dataNode.audits as Audit[];
      }
      if (Array.isArray(json.items)) return json.items as Audit[];
      if (Array.isArray(json.audits)) return json.audits as Audit[];
    }
    if (Array.isArray(json)) return json as Audit[];
    return [];
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/audits", { credentials: "include" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const contentType = res.headers.get("content-type");
        if (!contentType?.includes("application/json")) throw new Error("Invalid response format");
        const json = await res.json();
        if (mounted) setData(coerceAudits(json));
      } catch (err: any) {
        if (mounted) setError(err?.message ?? String(err));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const header = (
    <div className="relative overflow-hidden rounded-2xl border border-[#d8d1e4] bg-[#eee9f4] p-5">
      <style>{`.audit-workspace, .audit-workspace * {box-sizing:border-box;} .audit-workspace [class~="border"] {border-style:solid;} .audit-workspace th {border-bottom:1px solid #dfe5ee;} .audit-workspace td {border-bottom:1px solid #edf0f5;vertical-align:top;} .audit-workspace .grid > * {min-width:0;}`}</style>
      <div className="relative">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-700">Governance / Activity records</p><h1 className="mb-0 mt-1 text-2xl font-bold tracking-tight text-slate-900">Audit Log</h1><p className="mb-0 mt-1 text-xs leading-5 text-slate-600">Trace admin and system actions, inspect evidence and export recorded history.</p></div>
        </div>
      </div>
    </div>
  );

  const controls = (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900"><b>{audits.length}</b> loaded records</span>
          <span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><b>{filteredAudits.length}</b> matching records</span>
          <a
            href={exportUrl}
            className="ml-auto inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white no-underline hover:bg-indigo-700"
            download
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="relative min-w-0">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search action, admin, details..."
            aria-label="Search loaded audit records"
            className="w-full rounded-2xl border border-slate-200/70 bg-white py-2.5 pl-10 pr-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition-all duration-300 placeholder:text-slate-400 hover:border-slate-300 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/20"
          />
        </div>
        <select value={actor} onChange={(event) => setActor(event.target.value)} aria-label="Filter audit actor" className="min-h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700"><option value="all">All actors</option><option value="admin">Admin actions</option><option value="system">System actions</option></select>
        </div>
        <p className="m-0 text-[10px] text-slate-500">Search and actor filters apply to loaded records. CSV exports use the server endpoint, not these local filters.</p>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="audit-workspace min-h-full w-full bg-slate-50">
        <div className="space-y-4 px-3 py-4 sm:px-5 sm:py-5">
          {header}
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700 shadow-sm">
            Failed to load audits: {error}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="audit-workspace min-h-full w-full bg-slate-50">
        <div className="space-y-4 px-3 py-4 sm:px-5 sm:py-5">
          {header}
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-medium text-slate-500 shadow-sm">
            Loading audit logs...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="audit-workspace min-h-full w-full max-w-full bg-slate-50">
      <div className="min-w-0 space-y-4 px-3 py-4 sm:px-5 sm:py-5">
        {header}
        {controls}

        <div className="max-w-full overflow-hidden rounded-3xl border border-slate-200/60 bg-white/70 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">Audit entries</h2>
              <p className="mt-1 text-sm text-slate-500">
                Showing {filteredAudits.length ? (safePage - 1) * pageSize + 1 : 0}-{Math.min(safePage * pageSize, filteredAudits.length)} of {filteredAudits.length}
              </p>
            </div>
            <PaginationControls page={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
          <div className="w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-[1000px] table-fixed">
              <colgroup>
                <col className="w-[13rem]" />
                <col className="w-[5rem]" />
                <col className="w-[18rem]" />
                <col className="w-[5rem]" />
                <col />
              </colgroup>
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Time (EAT)</th>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Admin</th>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Action</th>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Target</th>
                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredAudits.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center">
                      <div className="mx-auto max-w-sm">
                        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                          <ShieldCheck className="h-5 w-5 text-slate-500" />
                        </div>
                        <div className="text-sm font-bold text-slate-900">No audit logs found</div>
                        <div className="mt-1 text-xs text-slate-600">Actions will appear here as admins make changes.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedAudits.map((audit) => (
                    <tr key={audit.id} className="transition-colors hover:bg-slate-50">
                      <td className="truncate px-4 py-3 text-xs font-normal text-slate-700">
                        {new Date(audit.createdAt).toLocaleString('en-GB', {timeZone:'Africa/Dar_es_Salaam',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{audit.adminId == null ? "System" : `#${audit.adminId}`}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <button type="button" onClick={() => setSelectedAudit(audit)} className="mb-2 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700">Inspect #{audit.id}</button>
                        <span className="inline-flex max-w-full items-center truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
                          {formatAction(audit.action)}
                        </span>
                      </td>
                      <td className="truncate px-4 py-3 text-sm text-slate-700">{audit.targetUserId ?? "-"}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div
                          className="group/details relative w-full cursor-help truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-600 outline-none transition-colors hover:border-emerald-200 hover:bg-white focus:border-emerald-300 focus:bg-white"
                          tabIndex={0}
                          title={formatDetails(audit.details)}
                        >
                          {formatDetails(audit.details)}
                          <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-[min(34rem,calc(100vw-3rem))] rounded-xl border border-slate-200 bg-white p-3 font-mono text-[11px] leading-5 text-slate-700 shadow-xl ring-1 ring-black/[0.03] group-hover/details:block group-focus/details:block">
                            <div className="mb-1 font-sans text-[10px] font-black uppercase tracking-wide text-slate-400">Full details</div>
                            <div className="max-h-56 overflow-auto whitespace-pre-wrap break-words">{formatDetails(audit.details)}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredAudits.length > pageSize ? (
            <div className="border-t border-slate-100 px-4 py-3">
              <PaginationControls page={safePage} totalPages={totalPages} onPageChange={setPage} align="end" />
            </div>
          ) : null}
        </div>
      </div>
      {selectedAudit && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setSelectedAudit(null)}><section role="dialog" aria-modal="true" aria-label={`Audit record ${selectedAudit.id}`} className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {if (event.key === 'Escape') setSelectedAudit(null);}}><div className="flex items-center justify-between gap-3"><h2 className="m-0 text-base font-bold">Audit #{selectedAudit.id} · {formatAction(selectedAudit.action)}</h2><button autoFocus type="button" onClick={() => setSelectedAudit(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">Close</button></div><pre className="mb-0 mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-700">{formatDetails(selectedAudit.details)}</pre></section></div>}
    </div>
  );
}

function PaginationControls({
  page,
  totalPages,
  onPageChange,
  align = "start",
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  align?: "start" | "end";
}) {
  return (
    <div className={`flex items-center gap-2 ${align === "end" ? "justify-end" : ""}`}>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="min-w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black uppercase tracking-wide text-slate-600">
        {page} / {totalPages}
      </div>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function formatAction(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDetails(details: any) {
  if (details == null) return "-";
  if (typeof details === "string") return details;
  if (typeof details === "object") return JSON.stringify(details) || "-";
  return String(details);
}
