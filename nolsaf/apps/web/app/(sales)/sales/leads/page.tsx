"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, ChevronLeft, ChevronRight, Plus, Search, UsersRound, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { codeLabel, statusTone } from "@/components/SalesShell";

type Lead = {
  id: number;
  ref: string;
  propertyName: string;
  contactPerson: string | null;
  location: string | null;
  proposedProduct: string;
  status: string;
  duplicateReviewStatus: string;
  nextFollowUpAt: string | null;
  protectionExpiresAt: string | null;
  updatedAt: string;
  _count: { activities: number };
};

const STATUSES = [
  "ALL",
  "NEW",
  "CONTACTED",
  "MEETING_SCHEDULED",
  "PROPOSAL_SENT",
  "DOCUMENTS_PENDING",
  "TRIAL_STARTED",
  "CONVERSION_REQUESTED",
  "CONVERTED",
  "LOST",
  "CANCELLED",
] as const;

function shortDate(value: string | null): string {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function SalesLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("ALL");
  const [followUp, setFollowUp] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState<number | null>(null);
  const pageSize = 25;
  const hasFilters = status !== "ALL" || Boolean(followUp || search);
  const firstResult = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResult = Math.min(total, page * pageSize);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/sales/leads", {
        params: {
          page,
          pageSize,
          ...(status !== "ALL" ? { status } : {}),
          ...(followUp ? { followUp } : {}),
          ...(search ? { q: search } : {}),
        },
      });
      setLeads(response.data?.leads || []);
      setTotal(Number(response.data?.total || 0));
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load leads.");
    } finally {
      setLoading(false);
    }
  }, [followUp, page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const updateTime = () => setNowMs(Date.now());
    updateTime();
    const timer = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <SalesShell>
      <style jsx global>{`
        #sales-leads-page *,
        #sales-leads-page *::before,
        #sales-leads-page *::after {
          box-sizing: border-box;
        }
      `}</style>
      <div id="sales-leads-page" className="w-full min-w-0 space-y-4">
        <header className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white shadow-[0_18px_40px_-30px_rgba(3,51,44,0.8)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
          <div className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "18px 18px" }} aria-hidden />
          <div className="relative px-5 py-5 sm:px-6 sm:py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80"><UsersRound className="h-3.5 w-3.5" /> Sales workspace</p>
                <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-white">Lead pipeline</h1>
                <p className="m-0 mt-1 max-w-2xl text-sm leading-5 text-white/60">Track prospects, follow-ups and conversion requests in one place.</p>
              </div>
              <Link href="/sales/leads/new" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border-0 bg-emerald-400 px-4 text-sm font-bold text-[#0b2420] no-underline shadow-sm transition hover:bg-emerald-300 hover:text-[#0b2420] hover:no-underline"><Plus className="h-4 w-4" />Register lead</Link>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-white/65">
              <span className="inline-flex items-center gap-2"><span className="text-lg font-bold tabular-nums leading-none text-white">{loading ? "…" : total.toLocaleString()}</span> matching leads</span>
              <span className="inline-flex items-center gap-2"><CalendarClock className="h-4 w-4 text-emerald-300" />{followUp ? `${codeLabel(followUp)} follow-ups` : "All follow-ups"}</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-white/75">{status === "ALL" ? "Every stage" : codeLabel(status)}</span>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-sm">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(query.trim());
            }}
          >
            <label className="min-w-[15rem] flex-1 text-xs font-semibold text-slate-700">
              Find a lead
              <span className="relative mt-1.5 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Property, contact or location" className="block h-11 w-full min-w-0 rounded-xl border border-solid border-slate-300 bg-slate-50/80 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
              </span>
            </label>
            <label className="min-w-[11rem] text-xs font-semibold text-slate-700">
              Follow-up
              <select value={followUp} onChange={(event) => { setPage(1); setFollowUp(event.target.value); }} className="mt-1.5 block h-11 w-full rounded-xl border border-solid border-slate-300 bg-slate-50/80 px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100">
                <option value="">All follow-ups</option>
                <option value="OVERDUE">Overdue</option>
                <option value="UPCOMING">Upcoming</option>
                <option value="NONE">Not scheduled</option>
              </select>
            </label>
            <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border-0 px-4 text-sm font-bold text-white transition hover:opacity-90" style={{ backgroundColor: "#073c35" }}>
              <Search className="h-4 w-4" />Search
            </button>
            {hasFilters ? <button type="button" onClick={() => { setQuery(""); setSearch(""); setStatus("ALL"); setFollowUp(""); setPage(1); }} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"><X className="h-3.5 w-3.5" />Clear</button> : null}
          </form>
          <div className="mt-4 flex gap-2 overflow-x-auto border-t border-solid border-slate-100 pt-3 pb-1" role="group" aria-label="Pipeline stage filters">
            {STATUSES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setPage(1);
                  setStatus(item);
                }}
                aria-pressed={status === item}
                className={`min-h-9 shrink-0 whitespace-nowrap rounded-lg border border-solid px-3 text-xs font-semibold transition ${
                  status === item ? "border-[#073c35]" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50"
                }`}
                style={status === item ? { backgroundColor: "#073c35", color: "#ffffff" } : undefined}
              >
                {codeLabel(item)}
              </button>
            ))}
          </div>
        </section>

        {error ? <p role="alert" className="m-0 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-solid border-slate-200 px-5 py-3.5">
            <div>
              <h2 className="m-0 text-sm font-bold text-slate-900">Leads</h2>
              <p className="m-0 mt-0.5 text-xs text-slate-500">{loading ? "Loading pipeline…" : `Showing ${firstResult}–${lastResult} of ${total.toLocaleString()}`}</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{status === "ALL" ? "All stages" : codeLabel(status)}</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading leads…</div>
          ) : leads.length === 0 ? (
            <div className="grid justify-items-center px-5 py-14 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><UsersRound className="h-5 w-5" /></span>
              <p className="m-0 mt-3 text-sm font-bold text-slate-900">No leads in this view</p>
              <p className="m-0 mt-1 text-xs text-slate-500">Try another filter or register a new prospect.</p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-[28%]" />
                    <col className="w-[24%]" />
                    <col className="w-[14%]" />
                    <col className="w-[16%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <thead className="border-b border-solid border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-bold">Property</th>
                      <th scope="col" className="px-4 py-3 font-bold">Product</th>
                      <th scope="col" className="px-4 py-3 font-bold">Status</th>
                      <th scope="col" className="px-4 py-3 font-bold">Follow-up</th>
                      <th scope="col" className="px-4 py-3 text-center font-bold">Activity</th>
                      <th scope="col" className="px-4 py-3 text-center font-bold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {leads.map((lead) => {
                      const overdue = nowMs !== null && lead.nextFollowUpAt && !["CONVERTED", "LOST", "CANCELLED"].includes(lead.status) && new Date(lead.nextFollowUpAt).getTime() < nowMs;
                      return (
                        <tr key={lead.id} className="transition-colors hover:bg-emerald-50/30">
                          <td className="px-5 py-3 align-middle">
                            <Link href={`/sales/leads/${lead.ref}`} className="block truncate text-[13px] font-bold text-slate-900 no-underline hover:text-emerald-800 hover:underline">{lead.propertyName}</Link>
                            <p className="mb-0 mt-0.5 truncate text-xs text-slate-500">{lead.location || lead.contactPerson || "No location recorded"}</p>
                            {lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" ? (
                              <span className="mt-1.5 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                Duplicate review
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 align-middle text-xs font-medium text-slate-600">
                            <span className="line-clamp-2">{codeLabel(lead.proposedProduct)}</span>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone(lead.status)}`}>{codeLabel(lead.status)}</span>
                          </td>
                          <td className={`whitespace-nowrap px-4 py-3 align-middle text-xs ${overdue ? "font-semibold text-red-700" : "text-slate-600"}`}>
                            {shortDate(lead.nextFollowUpAt)}
                          </td>
                          <td className="px-4 py-3 text-center align-middle text-xs font-semibold tabular-nums text-slate-700">{lead._count.activities}</td>
                          <td className="px-4 py-3 text-center align-middle">
                            <Link
                              href={`/sales/leads/${lead.ref}`}
                              aria-label={`Open ${lead.propertyName}`}
                              className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-solid border-slate-200 bg-white px-2.5 text-xs font-semibold text-emerald-800 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-900 hover:no-underline focus:outline-none focus:ring-2 focus:ring-emerald-200"
                            >
                              Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 md:hidden">
                {leads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/sales/leads/${lead.ref}`}
                    className="group block p-4 no-underline transition hover:bg-emerald-50/40 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-black text-slate-900">{lead.propertyName}</p>
                        <p className="mb-0 mt-1 truncate text-xs text-slate-500">{lead.location || "No location recorded"}</p>
                      </div>
                      <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone(lead.status)}`}>
                        {codeLabel(lead.status)}
                      </span>
                    </div>
                    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold text-slate-600">
                        {codeLabel(lead.proposedProduct)}
                      </span>
                      <span className="rounded-lg border border-solid border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-600">
                        Follow-up {shortDate(lead.nextFollowUpAt)}
                      </span>
                      <span className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-100">
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-solid border-slate-200 bg-slate-50/70 px-5 py-3 text-xs text-slate-600">
            <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
            <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />Previous
            </button>
            <button
              type="button"
              disabled={loading || page * pageSize >= total}
              onClick={() => setPage((value) => value + 1)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
            </div>
          </div>
        </section>
      </div>
    </SalesShell>
  );
}
