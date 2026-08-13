"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Attribution = {
  id: number;
  productType: string;
  status: string;
  attributedAt: string;
  verifiedAt: string | null;
  commissionStartsAt: string | null;
  commissionEndsAt: string | null;
  reassignedAt: string | null;
  revokedAt: string | null;
  lead: {
    id: number;
    propertyName: string;
    contactPerson: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    convertedAt: string | null;
  } | null;
  contract: {
    id: number;
    contractNumber: string;
    status: string;
    startsAt: string;
    expiresAt: string;
  } | null;
};

type PropertyDetail = {
  id: number;
  title: string;
  status: string;
  type: string;
  city: string | null;
  district: string | null;
  regionName: string | null;
  country: string | null;
  totalBedrooms: number | null;
  nrmsActivatedAt: string | null;
  createdAt: string;
  salesAttributions: Attribution[];
};

type Earning = {
  id: number;
  type: string;
  status: string;
  sourceKey: string;
  grossAmount: string | number;
  eligibleNetRevenue: string | number;
  commissionRate: string | number;
  commissionAmount: string | number;
  currency: string;
  earnedAt: string;
};

type Activity = {
  id: string | number;
  source: "ATTRIBUTION" | "LEAD";
  action?: string;
  type?: string;
  description?: string;
  createdAt: string;
};

function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not set";
}

function money(value: string | number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function SalesPropertyDetailPage() {
  const params = useParams<{ propertyId: string }>();
  const propertyId = Number(params.propertyId);
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [totals, setTotals] = useState({ commissionAmount: 0, eligibleNetRevenue: 0, commissionCount: 0, currency: "TZS" });
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!Number.isInteger(propertyId) || propertyId <= 0) {
      setError("Invalid property.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [detailResponse, earningsResponse, activityResponse] = await Promise.all([
        apiClient.get(`/api/sales/properties/${propertyId}`),
        apiClient.get(`/api/sales/properties/${propertyId}/earnings`, { params: { pageSize: 50 } }),
        apiClient.get(`/api/sales/properties/${propertyId}/activity`),
      ]);
      setProperty(detailResponse.data?.property || null);
      setTotals(detailResponse.data?.totals || {});
      setEarnings(earningsResponse.data?.earnings || []);
      setActivity(activityResponse.data?.activity || []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load this attributed property.");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SalesShell>
      <style jsx global>{`#sales-property-detail, #sales-property-detail * { box-sizing: border-box; }`}</style>
      <div id="sales-property-detail">
        <Link href="/sales/properties" className="text-sm font-medium text-brand hover:underline">← Back to properties</Link>
        {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        {loading ? (
          <div className="mt-5 rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading property...</div>
        ) : property ? (
          <>
            <SalesPageHeader
              icon={Building2}
              eyebrow={`Property #${property.id} · ${property.status}`}
              title={property.title}
              description={[property.city, property.district, property.regionName, property.country].filter(Boolean).join(", ") || "Location not recorded"}
              actions={<Link href="/sales/properties" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 no-underline hover:border-emerald-300 hover:text-emerald-800"><ArrowLeft className="h-4 w-4" />Portfolio</Link>}
            />
            <header className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
              <div className="sr-only">
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">{property.title}</h1>
                  <p className="mt-1 text-sm text-gray-600">{[property.city, property.district, property.regionName, property.country].filter(Boolean).join(", ") || "Location not recorded"}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">Property #{property.id} · {property.status}</span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-4"><p className="text-xs text-gray-500">Partner earnings</p><p className="mt-1 text-lg font-semibold text-gray-900">{money(totals.commissionAmount, totals.currency)}</p></div>
                <div className="rounded-lg bg-gray-50 p-4"><p className="text-xs text-gray-500">Eligible NoLSAF revenue</p><p className="mt-1 text-lg font-semibold text-gray-900">{money(totals.eligibleNetRevenue, totals.currency)}</p></div>
                <div className="rounded-lg bg-gray-50 p-4"><p className="text-xs text-gray-500">Earning events</p><p className="mt-1 text-lg font-semibold text-gray-900">{totals.commissionCount}</p></div>
              </div>
            </header>

            <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-base font-semibold text-gray-900">Product attribution</h2>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {property.salesAttributions.map((item) => (
                  <div key={item.id} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-gray-900">{item.productType}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs ${statusTone(item.status)}`}>{item.status}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div><dt className="text-gray-500">Verified</dt><dd className="mt-1 font-medium text-gray-800">{shortDate(item.verifiedAt)}</dd></div>
                      <div><dt className="text-gray-500">Earning starts</dt><dd className="mt-1 font-medium text-gray-800">{shortDate(item.commissionStartsAt)}</dd></div>
                      <div><dt className="text-gray-500">Earning ends</dt><dd className="mt-1 font-medium text-gray-800">{shortDate(item.commissionEndsAt)}</dd></div>
                      <div><dt className="text-gray-500">Agreement</dt><dd className="mt-1 font-medium text-gray-800">{item.contract?.contractNumber || "Not bound"}</dd></div>
                    </dl>
                    {item.lead ? (
                      <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                        Origin: <Link href={`/sales/leads/${item.lead.id}`} className="font-medium text-brand hover:underline">{item.lead.propertyName}</Link>
                        {item.lead.contactPerson ? ` · ${item.lead.contactPerson}` : ""}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-5 py-4"><h2 className="text-base font-semibold text-gray-900">Earnings</h2></div>
              {earnings.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">No earning events have been recorded for this property.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-600"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Stream</th><th className="px-4 py-3">Eligible revenue</th><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Earning</th><th className="px-4 py-3">Status</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {earnings.map((item) => (
                        <tr key={item.id}>
                          <td className="px-4 py-3 text-gray-700">{shortDate(item.earnedAt)}</td>
                          <td className="px-4 py-3 text-gray-700">{item.type.replaceAll("_", " ")}</td>
                          <td className="px-4 py-3 text-gray-700">{money(item.eligibleNetRevenue, item.currency)}</td>
                          <td className="px-4 py-3 text-gray-700">{Number(item.commissionRate)}%</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{money(item.commissionAmount, item.currency)}</td>
                          <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${statusTone(item.status)}`}>{item.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-base font-semibold text-gray-900">Activity</h2>
              {activity.length === 0 ? <p className="mt-3 text-sm text-gray-500">No portfolio activity recorded.</p> : (
                <div className="mt-4 space-y-3">
                  {activity.map((item) => (
                    <div key={`${item.source}-${item.id}`} className="border-l-2 border-brand/30 pl-4">
                      <p className="text-sm font-medium text-gray-900">{(item.action || item.type || "Activity").replaceAll("_", " ")}</p>
                      {item.description ? <p className="mt-1 text-sm text-gray-600">{item.description}</p> : null}
                      <p className="mt-1 text-xs text-gray-500">{shortDate(item.createdAt)} · {item.source.toLowerCase()}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </SalesShell>
  );
}
