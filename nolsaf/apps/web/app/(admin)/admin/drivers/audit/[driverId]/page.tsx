"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminRecordGate from "@/components/admin/AdminRecordGate";
import { ArrowLeft, ShieldCheck, Calendar, Hash, UserCog, FileText, AlertCircle, ChevronDown, ChevronUp, ClipboardList } from "lucide-react";

type AdminAudit = {
  id: number;
  adminId: number;
  targetUserId: number | null;
  action: string;
  details: any;
  createdAt: string;
};

function asObj(v: any): Record<string, any> | null {
  if (!v) return null;
  if (typeof v === "object") return v as Record<string, any>;
  return null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function SkeletonRow() {
  return (
    <div className="flex items-start gap-4 p-5 border-b border-slate-100 last:border-0 animate-pulse">
      <div className="mt-1 h-8 w-8 rounded-xl bg-slate-100 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-48 rounded-full bg-slate-100" />
        <div className="h-3 w-72 rounded-full bg-slate-100" />
        <div className="h-3 w-32 rounded-full bg-slate-100" />
      </div>
    </div>
  );
}

function RawJsonToggle({ data }: { data: any }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#02665e] transition-colors"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Raw JSON
      </button>
      {open && (
        <pre className="mt-2 whitespace-pre-wrap text-xs font-mono bg-slate-900 text-emerald-300 p-3 rounded-xl max-w-full overflow-x-auto leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function DriverAssignmentAuditPage({ params }: { params: Promise<{ driverId: string }> }) {
  const { driverId: driverIdParam } = use(params);
  return (
    <AdminRecordGate kind="driver" param={driverIdParam} backHref="/admin/drivers">
      {(driverId) => <DriverAssignmentAudit driverId={driverId} />}
    </AdminRecordGate>
  );
}

function DriverAssignmentAudit({ driverId }: { driverId: number }) {
  const [items, setItems] = useState<AdminAudit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!Number.isFinite(driverId) || driverId <= 0) {
      setError("Invalid driver id");
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setError(null);
        setItems(null);

        const url = `/api/admin/audits?targetId=${encodeURIComponent(String(driverId))}&action=${encodeURIComponent(
          "TRANSPORT_ASSIGN_DRIVER"
        )}&page=1&pageSize=200&sortBy=createdAt&sortDir=desc`;

        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        const json = await res.json();
        const list: AdminAudit[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.data?.items)
            ? json.data.items
            : Array.isArray(json?.data)
              ? json.data
              : Array.isArray(json?.items)
                ? json.items
                : [];

        if (mounted) setItems(list);
      } catch (e: any) {
        if (mounted) setError(e?.message ?? String(e));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [driverId]);

  const totalAssignments = items?.length ?? 0;
  const uniqueBookings = useMemo(() => {
    if (!items) return 0;
    return new Set(items.map((a) => asObj(a.details)?.bookingId).filter(Boolean)).size;
  }, [items]);
  const uniqueAdmins = useMemo(() => {
    if (!items) return 0;
    return new Set(items.map((a) => a.adminId).filter(Boolean)).size;
  }, [items]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100/60">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Back button */}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-[#02665e] hover:border-[#02665e]/30 hover:bg-[#02665e]/5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Hero header */}
        <div className="relative rounded-3xl overflow-hidden border border-slate-200/80 bg-white shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-[#02665e]/8 via-white to-slate-50/60" aria-hidden />
          <div className="relative px-6 py-8 sm:px-10 sm:py-10">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="flex-shrink-0 flex items-center justify-center h-14 w-14 rounded-2xl bg-[#02665e]/10 border border-[#02665e]/15">
                <ShieldCheck className="h-7 w-7 text-[#02665e]" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  Driver Assignment Audit
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-600">
                    <UserCog className="h-3.5 w-3.5" />
                    Driver #{Number.isFinite(driverId) ? driverId : "—"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#02665e]/8 border border-[#02665e]/15 text-xs font-semibold text-[#02665e]">
                    <FileText className="h-3.5 w-3.5" />
                    TRANSPORT_ASSIGN_DRIVER
                  </span>
                </div>
              </div>
            </div>

            {/* Stats row */}
            {items !== null && !error && (
              <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
                {[
                  { label: "Total Assignments", value: totalAssignments, icon: ClipboardList },
                  { label: "Unique Bookings", value: uniqueBookings, icon: Hash },
                  { label: "Admins Involved", value: uniqueAdmins, icon: UserCog },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur px-4 py-3 text-center shadow-sm">
                    <div className="flex items-center justify-center mb-1 text-[#02665e]/60">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
                    <div className="text-xs font-medium text-slate-500 mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-700">Failed to load audit records</div>
              <div className="text-sm text-red-600 mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {/* Loading state */}
        {!error && !items && (
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
              <div className="h-4 w-24 rounded-full bg-slate-200 animate-pulse" />
            </div>
            {[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Records list */}
        {!error && items !== null && (
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between gap-4">
              <div className="text-sm font-bold text-slate-800">
                {items.length === 0 ? "No records" : `${items.length} record${items.length !== 1 ? "s" : ""}`}
              </div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Most recent first</div>
            </div>

            {items.length === 0 ? (
              <div className="px-6 py-16 flex flex-col items-center gap-3 text-center">
                <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-slate-100 text-slate-400">
                  <ClipboardList className="h-6 w-6" />
                </div>
                <div className="text-sm font-bold text-slate-700">No assignment audits yet</div>
                <div className="text-sm text-slate-500">Trip assignments for this driver will appear here.</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      {["#", "Date & Time", "Trip", "Claim", "Admin", "Reason", ""].map((h) => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((a, idx) => {
                      const d = asObj(a.details);
                      const bookingId = d?.bookingId ?? null;
                      const claimId = d?.claimId ?? null;
                      const reason = (typeof d?.reason === "string" ? d.reason.trim() : "") || "—";

                      return (
                        <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-5 py-4">
                            <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-[#02665e]/8 border border-[#02665e]/12 text-xs font-bold text-[#02665e] tabular-nums">
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                              <Calendar className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                              {formatDate(a.createdAt)}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            {d?.tripCode ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#02665e]/8 border border-[#02665e]/15 text-xs font-semibold text-[#02665e] font-mono">
                                {d.tripCode}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700">
                                <Hash className="h-3 w-3 text-slate-400" />
                                Booking&nbsp;<span className="text-[#02665e]">{bookingId ?? "—"}</span>
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700">
                              <ClipboardList className="h-3 w-3 text-slate-400" />
                              Claim&nbsp;<span className="text-[#02665e]">{claimId ?? "—"}</span>
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700">
                              <UserCog className="h-3 w-3 text-slate-400" />
                              Admin&nbsp;<span className="text-[#02665e]">#{a.adminId}</span>
                            </span>
                          </td>
                          <td className="px-5 py-4 max-w-xs">
                            <div className="text-sm text-slate-800 font-medium leading-relaxed">{reason}</div>
                          </td>
                          <td className="px-5 py-4">
                            <RawJsonToggle data={a.details} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
