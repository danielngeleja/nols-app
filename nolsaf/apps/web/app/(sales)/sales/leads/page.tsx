"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, Plus, UsersRound } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Lead = {
  id: number;
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
  const pageSize = 25;

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

  return (
    <SalesShell>
      <style jsx global>{`
        #sales-leads-page *,
        #sales-leads-page *::before,
        #sales-leads-page *::after {
          box-sizing: border-box;
        }
      `}</style>
      <div id="sales-leads-page">
        <SalesPageHeader
          icon={UsersRound}
          title="Lead pipeline"
          description="Register prospects, keep every follow-up accountable and request conversion only when the evidence is ready."
          actions={<Link href="/sales/leads/new" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#087f68] px-4 text-sm font-bold text-white no-underline hover:bg-[#066b59]"><Plus className="h-4 w-4" />Register lead</Link>}
        />

        <section className="mt-5 border border-slate-200 bg-white p-4 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(query.trim());
            }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search property, contact or location"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={followUp}
              onChange={(event) => {
                setPage(1);
                setFollowUp(event.target.value);
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All follow-ups</option>
              <option value="OVERDUE">Overdue</option>
              <option value="UPCOMING">Upcoming</option>
              <option value="NONE">Not scheduled</option>
            </select>
            <button type="submit" className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand-50">
              Search
            </button>
          </form>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {STATUSES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setPage(1);
                  setStatus(item);
                }}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
                  status === item ? "bg-brand text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {item.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        </section>

        {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <section className="mt-5 overflow-hidden border border-slate-200 bg-white shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading leads...</div>
          ) : leads.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-gray-900">No leads found</p>
              <p className="mt-1 text-sm text-gray-500">Register a prospect or change the current filters.</p>
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
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    <tr className="h-11">
                      <th scope="col" className="px-5 py-3 font-bold">Property</th>
                      <th scope="col" className="px-4 py-3 font-bold">Product</th>
                      <th scope="col" className="px-4 py-3 font-bold">Status</th>
                      <th scope="col" className="px-4 py-3 font-bold">Follow-up</th>
                      <th scope="col" className="px-4 py-3 text-center font-bold">Activity</th>
                      <th scope="col" className="px-4 py-3 text-center font-bold"><span className="sr-only">View</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {leads.map((lead) => {
                      const overdue = lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now();
                      return (
                        <tr key={lead.id} className="h-[4.75rem] transition-colors hover:bg-slate-50/70">
                          <td className="px-5 py-3 align-middle">
                            <p className="m-0 truncate font-semibold text-slate-900">{lead.propertyName}</p>
                            <p className="mb-0 mt-1 truncate text-xs text-slate-500">{lead.location || lead.contactPerson || "No location recorded"}</p>
                            {lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" ? (
                              <span className="mt-1.5 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                Duplicate review
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 align-middle text-xs font-medium text-slate-600">
                            <span className="line-clamp-2">{lead.proposedProduct.replaceAll("_", " ")}</span>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone(lead.status)}`}>{lead.status.replaceAll("_", " ")}</span>
                          </td>
                          <td className={`whitespace-nowrap px-4 py-3 align-middle text-xs ${overdue ? "font-semibold text-red-700" : "text-slate-600"}`}>
                            {shortDate(lead.nextFollowUpAt)}
                          </td>
                          <td className="px-4 py-3 text-center align-middle text-xs font-semibold tabular-nums text-slate-700">{lead._count.activities}</td>
                          <td className="px-4 py-3 text-center align-middle">
                            <Link
                              href={`/sales/leads/${lead.id}`}
                              aria-label={`View ${lead.propertyName}`}
                              title={`View ${lead.propertyName}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 no-underline shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 hover:no-underline focus:outline-none focus:ring-2 focus:ring-emerald-200"
                            >
                              <Eye className="h-4 w-4" aria-hidden />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-gray-100 md:hidden">
                {leads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/sales/leads/${lead.id}`}
                    className="group block p-4 no-underline transition hover:bg-emerald-50/40 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-black text-slate-900">{lead.propertyName}</p>
                        <p className="mb-0 mt-1 truncate text-xs text-slate-500">{lead.location || "No location recorded"}</p>
                      </div>
                      <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone(lead.status)}`}>
                        {lead.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="mt-3 flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 text-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <span className="shrink-0 whitespace-nowrap rounded-lg bg-slate-100 px-2.5 py-1.5 font-bold text-slate-600">
                        {lead.proposedProduct.replaceAll("_", " ")}
                      </span>
                      <span className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-600">
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
        </section>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-600">{total.toLocaleString()} leads</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page * pageSize >= total}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </SalesShell>
  );
}
