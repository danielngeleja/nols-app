"use client";
import React, { useEffect, useMemo, useState } from 'react';
import TableRow from "@/components/TableRow";
import { Building2, Download, Eye, X, ExternalLink, RefreshCw, CheckCircle2, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";

type Owner = {
  id: number;
  name: string;
  email: string;
  propertiesCount?: number;
  region?: string | null;
  district?: string | null;
  status?: 'active' | 'suspended' | 'pending' | 'closed' | string;
  suspendedAt?: string | null;
  kycStatus?: string | null;
  _count?: { properties?: number };
};

type PayoutPreview = {
  gross: number;
  commissionPercent: number;
  taxPercent: number;
  net: number;
  rows: Array<{ bookingId: number; amount: number }>
};

const api = apiClient;

function computeOwnerStatus(input: {
  status?: string | null;
  suspendedAt?: string | null;
  kycStatus?: string | null;
}) {
  if (input.status && String(input.status).trim()) return String(input.status);
  if (input.suspendedAt) return "SUSPENDED";
  if (input.kycStatus) return String(input.kycStatus);
  return "ACTIVE";
}

function formatStatusLabel(status: string | null | undefined) {
  if (!status) return "—";
  const raw = String(status);
  if (!raw.trim()) return "—";
  // ACTIVE, PENDING_KYC -> Pending Kyc
  const words = raw
    .toLowerCase()
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ");
}

function normalizeOwner(raw: any): Owner {
  const propertiesCount =
    raw?.propertiesCount ??
    raw?._count?.properties ??
    raw?._propertyCount ??
    raw?._count?.properties ??
    0;

  const suspendedAt = raw?.suspendedAt ?? null;
  const kycStatus = raw?.kycStatus ?? null;

  return {
    id: Number(raw?.id),
    name: raw?.name ?? "—",
    email: raw?.email ?? "—",
    propertiesCount: Number(propertiesCount) || 0,
    region: raw?.region ?? null,
    district: raw?.district ?? null,
    suspendedAt,
    kycStatus,
    _count: raw?._count,
    status: computeOwnerStatus({ status: raw?.status ?? null, suspendedAt, kycStatus }),
  };
}

export default function OwnersPage() {
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Owner | null>(null);
  const [, setPreview] = useState<PayoutPreview | null>(null);
  const [, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"name" | "email" | "properties" | "region" | "district" | "status">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const pageSize = 10;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Call real API (no client-side mocks)
        const base = typeof window === 'undefined'
          ? (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000")
          : '';
        const url = `${base.replace(/\/$/, '')}/api/admin/owners?page=1&limit=50`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const json = await res.json();
          const list = Array.isArray(json?.items) ? json.items : (Array.isArray(json) ? json : []);
          if (mounted) setOwners(list.map(normalizeOwner));
        } else {
          throw new Error("Invalid response format");
        }
      } catch (err: any) {
        if (mounted) {
          console.error('Failed to load owners', err);
          setError(err?.message ?? "Failed to load owners");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const openOwner = (o: Owner) => { 
    setSelected(o); 
    setPreview(null);
    setError(null);
    setSuccessMessage(null);
  };
  const closeOwner = () => { 
    setSelected(null); 
    setPreview(null);
    setError(null);
    setSuccessMessage(null);
  };

  const handleRefreshOwner = async () => {
    if (!selected) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/admin/owners/${selected.id}`);
      if (res.data) {
        // Handle both direct owner object and nested owner structure
        const ownerData = res.data.owner || res.data;
        const normalized = normalizeOwner({ ...selected, ...ownerData });
        // Keep region/district from the list if detail endpoint doesn't provide it
        setSelected({
          ...normalized,
          region: normalized.region ?? selected.region ?? null,
          district: normalized.district ?? selected.district ?? null,
        });
        setSuccessMessage("Owner data refreshed successfully");
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      console.error("Failed to refresh owner:", err);
      setError(err?.response?.data?.error || "Failed to refresh owner data");
      setTimeout(() => setError(null), 5000);
    } finally {
      setActionLoading(false);
    }
  };

  const _handlePreview = async (ownerId: number) => {
    setPreviewLoading(true);
    setError(null);
    try {
      const base = typeof window === 'undefined'
        ? (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000")
        : '';
      const res = await fetch(`${base.replace(/\/$/, '')}/api/admin/owners/${ownerId}/payouts/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setPreview(json);
    } catch (err: any) {
      // fallback mock preview
      setPreview({ gross: 100000, commissionPercent: 10, taxPercent: 18, net: 82000, rows: [{ bookingId: 123, amount: 100000 }] });
      setError(typeof err === 'string' ? err : (err?.message ?? String(err)));
    } finally {
      setPreviewLoading(false);
    }
  };

  // Manual "grant payout" (POST /api/admin/owners/:id/payouts) was retired —
  // owner invoices are now paid exclusively through the AzamPay Disbursement
  // ledger at /admin/disbursements. This dead handler was never wired to a
  // button in this page; removed rather than left pointing at a route that
  // no longer exists.

  const rows = useMemo(() => owners ?? [], [owners]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const valueOf = (o: Owner): string | number => {
      switch (sortBy) {
        case "name": return String(o.name ?? "").toLowerCase();
        case "email": return String(o.email ?? "").toLowerCase();
        case "properties": return Number(o.propertiesCount ?? 0);
        case "region": return String(o.region ?? "").toLowerCase();
        case "district": return String(o.district ?? "").toLowerCase();
        case "status": return String(o.status ?? "").toLowerCase();
        default: return "";
      }
    };

    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [rows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const pagedRows = sortedRows.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [owners, sortBy, sortDir]);

  const handleSort = (field: "name" | "email" | "properties" | "region" | "district" | "status") => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir("asc");
  };

  const renderSortIcon = (field: "name" | "email" | "properties" | "region" | "district" | "status") => {
    if (sortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-[#02665e]" />
      : <ChevronDown className="h-3.5 w-3.5 text-[#02665e]" />;
  };

  function getStatusBadgeClass(status: string) {
    const statusLower = (status ?? '').toLowerCase();
    const baseClasses = "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200";
    if (statusLower.includes('active')) {
      return `${baseClasses} bg-green-50 text-green-700 border border-green-200`;
    }
    if (statusLower.includes('approved')) {
      return `${baseClasses} bg-emerald-50 text-emerald-700 border border-emerald-200`;
    }
    if (statusLower.includes('pending') || statusLower.includes('new')) {
      return `${baseClasses} bg-yellow-50 text-yellow-700 border border-yellow-200`;
    }
    if (statusLower.includes('reject')) {
      return `${baseClasses} bg-rose-50 text-rose-700 border border-rose-200`;
    }
    if (statusLower.includes('suspend') || statusLower.includes('close') || statusLower.includes('cancel')) {
      return `${baseClasses} bg-red-50 text-red-700 border border-red-200`;
    }
    return `${baseClasses} bg-gray-50 text-gray-700 border border-gray-200`;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-[#02665e]/10 mb-4">
            <Building2 className="h-6 w-6 text-[#02665e]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
            Owners
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Manage property owners and their information
          </p>
        </div>
        <div className="flex justify-center">
          <button 
            className="inline-flex items-center gap-2 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:border-[#02665e] hover:text-[#02665e] hover:bg-[#02665e]/5 transition-all duration-200 font-medium text-sm"
            onClick={() => alert('Export owners - implement server side export')}
          >
            <Download className="h-4 w-4" />
            Export owners
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/70">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  <button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-gray-900">
                    Name {renderSortIcon("name")}
                  </button>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  <button type="button" onClick={() => handleSort("email")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-gray-900">
                    Email {renderSortIcon("email")}
                  </button>
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  <button type="button" onClick={() => handleSort("properties")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-gray-900">
                    No. of Properties {renderSortIcon("properties")}
                  </button>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  <button type="button" onClick={() => handleSort("region")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-gray-900">
                    Region {renderSortIcon("region")}
                  </button>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  <button type="button" onClick={() => handleSort("district")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-gray-900">
                    District {renderSortIcon("district")}
                  </button>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 hover:text-gray-900">
                    Status {renderSortIcon("status")}
                  </button>
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {loading ? (
                <TableRow hover={false}>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500">
                    Loading…
                  </td>
                </TableRow>
              ) : sortedRows.length === 0 ? (
                <TableRow hover={false}>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500">
                    No owners found
                  </td>
                </TableRow>
              ) : (
                pagedRows.map((o) => (
                  <TableRow key={o.id} className="align-middle">
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                      {o.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {o.email}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 text-center">
                      {o.propertiesCount ?? 0}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {o.region ?? '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {o.district ?? '—'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={getStatusBadgeClass(o.status ?? '')}>
                        {formatStatusLabel(o.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex justify-center">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => openOwner(o)}
                            className="inline-flex items-center justify-center p-2 text-gray-600 hover:text-[#02665e] hover:bg-gray-100 rounded-xl transition-all duration-200 ease-in-out hover:scale-110 active:scale-95"
                            title="Quick view"
                          >
                            <Eye className="h-5 w-5" />
                          </button>
                          <Link
                            href={`/admin/owners/${o.id}`}
                            className="inline-flex items-center justify-center p-2 text-gray-600 hover:text-[#02665e] hover:bg-gray-100 rounded-xl transition-all duration-200 ease-in-out hover:scale-110 active:scale-95"
                            title="Open full owner page"
                          >
                            <ExternalLink className="h-5 w-5" />
                          </Link>
                        </div>
                      </div>
                    </td>
                  </TableRow>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-200 px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-gray-500">
            Showing {sortedRows.length === 0 ? 0 : start + 1}-{Math.min(end, sortedRows.length)} of {sortedRows.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-xs font-semibold text-gray-600">Page {safePage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Owner drawer */}
      {selected && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity duration-200"
          onClick={closeOwner}
        >
          <div 
            className="bg-white w-full max-w-2xl max-h-[90vh] rounded-xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 transform"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#02665e] to-[#014d47] px-6 py-5 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-white">{selected.name}</h2>
                <p className="text-sm text-white/90 mt-1">Owner Details</p>
              </div>
              <button 
                className="text-white hover:text-white/80 p-2 transition-all duration-200 bg-transparent border-none outline-none hover:scale-110 active:scale-95"
                onClick={closeOwner}
                title="Close"
              >
                <X className="h-5 w-5 stroke-[2.5]" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Owner Information Card */}
              <div className="bg-white rounded-lg border border-gray-200 p-4 transition-all duration-300 hover:shadow-md">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-0.5 group">
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Email</label>
                    <div className="text-sm text-gray-900 font-medium truncate group-hover:text-[#02665e] transition-colors duration-200">{selected.email}</div>
                  </div>
                  <div className="space-y-0.5 group">
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Properties</label>
                    <Link
                      href={`/admin/properties/previews?ownerId=${selected.id}`}
                      className="inline-flex items-center gap-1 text-sm text-gray-900 font-medium hover:text-[#02665e] transition-colors duration-200 group"
                    >
                      {selected.propertiesCount ?? 0}
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    </Link>
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Region</label>
                    <div className="text-sm text-gray-900 font-medium">{selected.region ?? '—'}</div>
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">District</label>
                    <div className="text-sm text-gray-900 font-medium">{selected.district ?? '—'}</div>
                  </div>
                  <div className="col-span-2 space-y-0.5">
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Status</label>
                    <div>
                      <span className={getStatusBadgeClass(selected.status ?? '')}>
                        {formatStatusLabel(selected.status)}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Quick Actions */}
                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
                  <Link
                    href={`/admin/owners/${selected.id}`}
                    className="inline-flex items-center gap-1.5 text-[#02665e] hover:text-[#014d47] font-medium text-xs transition-all duration-200 hover:gap-2 no-underline"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Full Review
                  </Link>
                  
                  <button
                    onClick={handleRefreshOwner}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 text-gray-600 hover:text-[#02665e] font-medium text-xs transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Refresh owner data"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Success Message */}
              {successMessage && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 transition-all duration-300">
                  <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <p className="text-sm text-green-700 font-medium">{successMessage}</p>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
 

