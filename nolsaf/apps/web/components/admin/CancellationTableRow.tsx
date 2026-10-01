"use client";

import Link from "next/link";
import { Eye, DollarSign, MapPin, Clock, CheckCircle, XCircle, AlertCircle, FileX } from "lucide-react";
import TableRow from "../TableRow";
import { useAdminHref } from "@/lib/adminRecordRefs";

type CancellationRow = {
  id: number;
  status: string;
  bookingCode: string;
  createdAt: string;
  updatedAt: string;
  policyEligible: boolean;
  policyRefundPercent: number | null;
  policyRule: string | null;
  user: { id: number; name: string | null; email: string | null; phone: string | null };
  booking: {
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    status: string;
    property: { title: string; regionName?: string | null; city?: string | null; district?: string | null };
  };
};

type Props = {
  row: CancellationRow;
  onRowClick?: (id: number) => void;
};

function badge(status: string) {
  const s = (status || "").toUpperCase();
  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all";
  if (s === "SUBMITTED") return `${base} bg-slate-100 text-slate-700 border border-slate-200`;
  if (s === "REVIEWING") return `${base} bg-amber-50 text-amber-700 border border-amber-200`;
  if (s === "NEED_INFO") return `${base} bg-orange-50 text-orange-700 border border-orange-200`;
  if (s === "PROCESSING") return `${base} bg-blue-50 text-blue-700 border border-blue-200`;
  if (s === "REFUNDED") return `${base} bg-emerald-50 text-emerald-700 border border-emerald-200`;
  if (s === "REJECTED") return `${base} bg-red-50 text-red-700 border border-red-200`;
  return `${base} bg-slate-100 text-slate-700 border border-slate-200`;
}

function getStatusIcon(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "SUBMITTED") return <Clock className="h-3.5 w-3.5" />;
  if (s === "REVIEWING") return <AlertCircle className="h-3.5 w-3.5" />;
  if (s === "NEED_INFO") return <AlertCircle className="h-3.5 w-3.5" />;
  if (s === "PROCESSING") return <Clock className="h-3.5 w-3.5" />;
  if (s === "REFUNDED") return <CheckCircle className="h-3.5 w-3.5" />;
  if (s === "REJECTED") return <XCircle className="h-3.5 w-3.5" />;
  return <FileX className="h-3.5 w-3.5" />;
}

export default function CancellationTableRow({ row: r, onRowClick }: Props) {
  const recordHref = useAdminHref();
  const handleRowClick = () => {
    if (onRowClick) {
      onRowClick(r.id);
    } else {
      window.location.href = recordHref("cancellation", r.id);
    }
  };

  return (
    <TableRow className="cursor-pointer" onClick={handleRowClick}>
      {/* Request */}
      <td className="px-6 py-4 whitespace-nowrap">
        <Link
          className="no-underline text-[#02665e] hover:text-[#014d47] hover:underline font-semibold"
          href={recordHref("cancellation", r.id)}
          onClick={(e) => e.stopPropagation()}
        >
          #{r.id}
        </Link>
        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
          <span>Code:</span>
          <span className="font-mono font-medium">{r.bookingCode}</span>
        </div>
      </td>

      {/* Customer */}
      <td className="px-6 py-4">
        <div className="font-semibold text-gray-900">{r.user?.name || `User #${r.user?.id}`}</div>
        <div className="text-xs text-gray-500 mt-1">{r.user?.email || r.user?.phone || "—"}</div>
      </td>

      {/* Booking */}
      <td className="px-6 py-4">
        <div className="font-semibold text-gray-900">{r.booking?.property?.title}</div>
        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          <span>
            {r.booking?.property?.regionName || ""} {r.booking?.property?.city ? `• ${r.booking.property.city}` : ""}
          </span>
        </div>
      </td>

      {/* Policy */}
      <td className="px-6 py-4">
        <div className="font-semibold text-gray-900 flex items-center gap-1">
          {r.policyRefundPercent === 100 ? (
            <>
              <DollarSign className="h-4 w-4 text-emerald-600" />
              <span>100% (free)</span>
            </>
          ) : r.policyRefundPercent === 50 ? (
            <>
              <DollarSign className="h-4 w-4 text-amber-600" />
              <span>50%</span>
            </>
          ) : r.policyRefundPercent === 0 ? (
            <>
              <DollarSign className="h-4 w-4 text-red-600" />
              <span>0%</span>
            </>
          ) : (
            "—"
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1">{r.policyRule || "Manual review"}</div>
      </td>

      {/* Status */}
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={badge(r.status)}>
          {getStatusIcon(r.status)}
          {r.status}
        </span>
      </td>

      {/* Submitted */}
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          {new Date(r.createdAt).toLocaleDateString()}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </td>

      {/* Actions */}
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <Link
          href={recordHref("cancellation", r.id)}
          onClick={(e) => e.stopPropagation()}
          className="group relative inline-flex items-center justify-center rounded-lg bg-[#02665e] p-2 text-white hover:bg-[#014d47] transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
        >
          <Eye className="h-4 w-4" />
          <span className="absolute left-full ml-2 px-2 py-1 text-xs font-semibold bg-gray-900 text-white rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity duration-200 shadow-lg z-10">
            View
          </span>
        </Link>
      </td>
    </TableRow>
  );
}

