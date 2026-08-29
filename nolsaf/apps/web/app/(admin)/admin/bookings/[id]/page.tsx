"use client";
import React, { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Home, User, Calendar, CheckCircle2, Clock, DollarSign, Key, AlertCircle, AlertTriangle, Loader2, MessageSquare, RefreshCw, Star } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

function authify() {}

// Input sanitization helper
function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

// Validate booking ID
function isValidBookingId(id: number | null | undefined): boolean {
  return id !== null && id !== undefined && Number.isInteger(id) && id > 0;
}

// Toast notification helper
function showToast(type: "success" | "error" | "info" | "warning", title: string, message?: string, duration?: number) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("nols:toast", {
        detail: { type, title, message, duration: duration ?? 5000 },
      })
    );
  }
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="font-semibold text-sm text-gray-900">{value || "Not set"}</div>
    </div>
  );
}

// Confirmation Modal Component
function ConfirmModal({ 
  open, 
  title, 
  message, 
  confirmLabel, 
  onConfirm, 
  onCancel 
}: { 
  open: boolean; 
  title: string; 
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void; 
  onCancel: () => void; 
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-lg p-5 z-10 w-full max-w-md shadow-lg">
        <div className="font-semibold text-lg mb-2">{title}</div>
        {message && <div className="text-sm text-gray-600 mb-4">{message}</div>}
        <div className="flex justify-end gap-3">
          <button 
            onClick={onCancel}
            aria-label="Cancel action"
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors"
          >
            Cancel
          </button>
          <button 
            autoFocus 
            onClick={onConfirm}
            aria-label={confirmLabel || "Confirm action"}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            {confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function AdminBookingDetail() {
  const params = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(params?.id) ? params?.id?.[0] : params?.id;
  const id = Number(idParam);
  const [b, setB] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  
  // Modal and message states
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!isValidBookingId(id)) {
      setError("Invalid booking ID");
      setLoading(false);
      showToast("error", "Invalid Booking", "Invalid booking ID provided");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      authify();
      const r = await api.get<any>(`/api/admin/bookings/${id}`);
      setB(r.data);
      setRoomCode(r.data.roomCode ?? "");
    } catch (err: any) {
      console.error("Failed to load booking:", err);
      const errorMessage = err?.response?.status === 404
        ? "Booking not found"
        : err?.response?.data?.error || err?.message || "Failed to load booking details";
      setError(errorMessage);
      showToast("error", "Failed to Load Booking", errorMessage);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    authify();
    load();
  }, [load]);


  const reassign = useCallback(async () => {
    if (!isValidBookingId(id)) {
      showToast("error", "Invalid Booking", "Invalid booking ID provided");
      return;
    }

    const sanitizedCode = sanitizeInput(roomCode);
    if (!sanitizedCode.trim()) {
      showToast("error", "Room Code Required", "Please enter a room code");
      return;
    }

    if (sanitizedCode.length > 50) {
      showToast("error", "Room Code Too Long", "Room code must be less than 50 characters");
      return;
    }

    setBusy(true);
    try {
      authify();
      await api.post(`/api/admin/bookings/${id}/reassign-room`, { roomCode: sanitizedCode });
      await load();
      showToast("success", "Room Reassigned", "Room reassigned successfully");
    } catch (e: any) {
      const errorMessage = e?.response?.data?.error || e?.message || "Failed to reassign room";
      showToast("error", "Failed to Reassign Room", errorMessage);
    } finally {
      setBusy(false);
    }
  }, [id, roomCode, load]);

  const handleVoidCode = useCallback(async () => {
    setShowVoidConfirm(false);
    if (!b?.code?.id) {
      showToast("error", "No Code", "No check-in code found to void");
      return;
    }

    if (!isValidBookingId(id)) {
      showToast("error", "Invalid Booking", "Invalid booking ID provided");
      return;
    }

    setBusy(true);
    try {
      authify();
      await api.post(`/api/admin/bookings/codes/${b.code.id}/void`, { reason: "Voided from admin detail" });
      await load();
      showToast("success", "Code Voided", "Check-in code voided successfully");
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to void code";
      showToast("error", "Failed to Void Code", errorMessage);
    } finally {
      setBusy(false);
    }
  }, [b, id, load]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col items-center justify-center h-64">
          <Loader2 className="h-8 w-8 text-[#02665e] animate-spin mb-3" />
          <p className="text-gray-500 text-sm">Loading booking details...</p>
        </div>
      </div>
    );
  }

  if (error || !b) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-4" />
          <p className="text-gray-900 font-medium mb-2">{error || "Booking not found"}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/admin/bookings"
              className="text-[#02665e] hover:text-[#014d47] underline"
              aria-label="Back to bookings list"
            >
              ← Back to bookings list
            </Link>
            {error && (
              <button
                onClick={load}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                aria-label="Retry loading booking"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const checkInDate = new Date(b.checkIn);
  const checkOutDate = new Date(b.checkOut);
  const nights = Math.max(0, Math.round((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <>
      <ConfirmModal
        open={showVoidConfirm}
        title="Void Check-in Code"
        message="Are you sure you want to void this active check-in code? This action cannot be undone."
        confirmLabel="Void Code"
        onConfirm={handleVoidCode}
        onCancel={() => setShowVoidConfirm(false)}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Header */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link
                href="/admin/bookings"
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to bookings list"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Booking #{b.id}</h1>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <StatusBadge s={b.status} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Check-in codes are issued automatically once payment is confirmed.
                  There is no manual code generation. Unpaid bookings simply wait. */}
              {b.status === "NEW" && (
                <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-amber-800 text-sm font-medium">
                  <Clock className="h-4 w-4" />
                  Awaiting payment. The check-in code is issued automatically once paid.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Booking Dates & Details */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <Calendar className="h-5 w-5 text-purple-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Booking Dates & Details</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Check-in</div>
                      <div className="font-semibold text-sm text-gray-900">
                        {checkInDate.toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {checkInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Check-out</div>
                      <div className="font-semibold text-sm text-gray-900">
                        {checkOutDate.toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {checkOutDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <InfoRow label="Duration" value={`${nights} ${nights === 1 ? 'night' : 'nights'}`} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Property Details */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                  <Home className="h-5 w-5 text-[#02665e]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Property Details</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InfoRow label="Property Name" value={b.property?.title} />
                    <InfoRow label="Property Type" value={b.property?.type} />
                    <InfoRow label="Country" value={b.property?.country} />
                    <InfoRow label="Region" value={b.property?.regionName} />
                    <InfoRow label="City" value={b.property?.city} />
                    <InfoRow label="District" value={b.property?.district} />
                    <InfoRow label="Ward" value={b.property?.ward} />
                  </div>
                </div>
              </div>
            </div>

            {/* Guest Information */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <User className="h-5 w-5 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Guest Information</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InfoRow label="Full Name" value={b.guestName || b.user?.name} />
                    <InfoRow label="Email" value={b.user?.email} />
                    <InfoRow label="Phone" value={b.user?.phone} />
                  </div>
                </div>
              </div>
            </div>

            {/* Room Assignment */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                  <Home className="h-5 w-5 text-[#02665e]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Room Assignment</h2>
                  <div className="flex items-center gap-3">
                    <input
                      className="flex-1 min-w-0 border-0 rounded-xl bg-white px-4 py-2 text-sm ring-1 ring-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      value={roomCode}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.length <= 50) {
                          setRoomCode(value);
                        }
                      }}
                      placeholder="e.g., A-101"
                      aria-label="Enter room code"
                      title="Enter room code to assign"
                      maxLength={50}
                      disabled={busy}
                    />
                    <button
                      disabled={busy}
                      onClick={reassign}
                      aria-label="Reassign room code"
                      className="px-4 py-2 bg-[#02665e] text-white rounded-lg hover:bg-[#013a37] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2"
                    >
                      {busy ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Updating...
                        </>
                      ) : (
                        "Reassign"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Financials */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <DollarSign className="h-5 w-5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Financials</h2>
                  <div className="text-2xl font-bold text-gray-900">
                    {new Intl.NumberFormat('en-US').format(Number(b.totalAmount || 0))} TZS
                  </div>
                  {b.notes && (
                    <div className="text-sm text-gray-600 mt-3 p-3 bg-gray-50 rounded-lg">
                      {b.notes}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Check-in Code */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <Key className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Check-in Code</h2>
                  {b.code?.codeVisible ? (
                    <div className="space-y-4">
                      <div className="col-span-2">
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Code</div>
                        <div className="font-mono font-semibold text-lg text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">
                          {b.code.codeVisible}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <InfoRow label="Status" value={b.code.status} />
                        {b.code.generatedAt && (
                          <InfoRow
                            label="Generated At"
                            value={new Date(b.code.generatedAt).toLocaleString()}
                          />
                        )}
                        {b.code.usedAt && (
                          <InfoRow
                            label="Used At"
                            value={new Date(b.code.usedAt).toLocaleString()}
                          />
                        )}
                      </div>
                      {b.code.status === "ACTIVE" && (
                        <button
                          disabled={busy}
                          onClick={() => setShowVoidConfirm(true)}
                          aria-label="Void check-in code"
                          className="w-full px-4 py-2 border-0 bg-white ring-1 ring-red-300 text-red-700 rounded-xl hover:bg-red-50 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2"
                        >
                          {busy ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Voiding...
                            </>
                          ) : (
                            "Void Code"
                          )}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">No active code yet. Confirm booking to generate.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Owner Information */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <User className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Owner</h2>
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <InfoRow label="Name" value={b.property?.owner?.name} />
                      {b.property?.owner?.phone && (
                        <InfoRow label="Phone" value={b.property?.owner?.phone} />
                      )}
                    </div>
                    {b.property?.owner?.email && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Email</div>
                        <div className="font-semibold text-sm text-gray-900 break-all leading-snug">{b.property.owner.email}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Check-out Summary */}
            {(b.status === 'CHECKED_OUT' || b.status === 'CHECKED_IN') && (() => {
              const scheduledOut = new Date(b.checkOut);
              const now = new Date();
              // For CHECKED_OUT: use updatedAt as actual checkout time
              const actualOut = b.status === 'CHECKED_OUT' && b.updatedAt ? new Date(b.updatedAt) : null;
              const isCurrentlyOverdue = b.status === 'CHECKED_IN' && now > scheduledOut;
              const wasOverdue = b.status === 'CHECKED_OUT' && actualOut && actualOut > scheduledOut;
              const overdueDays = wasOverdue && actualOut
                ? Math.round((actualOut.getTime() - scheduledOut.getTime()) / 86400000)
                : isCurrentlyOverdue
                ? Math.round((now.getTime() - scheduledOut.getTime()) / 86400000)
                : 0;
              const review = Array.isArray(b.reviews) && b.reviews.length > 0 ? b.reviews[0] : null;
              return (
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      wasOverdue || isCurrentlyOverdue ? 'bg-amber-50' : 'bg-emerald-50'
                    }`}>
                      {wasOverdue || isCurrentlyOverdue
                        ? <AlertTriangle className="h-5 w-5 text-amber-500" />
                        : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Check-out Summary</h2>

                      {/* Status line */}
                      {b.status === 'CHECKED_OUT' ? (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-2.5 py-1 w-fit mb-3">
                          <CheckCircle2 className="h-3 w-3" /> Checkout confirmed
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 ring-1 ring-blue-200 rounded-full px-2.5 py-1 w-fit mb-3">
                          <Clock className="h-3 w-3" /> Guest is currently checked in
                        </div>
                      )}

                      {/* Overdue banner */}
                      {(wasOverdue || isCurrentlyOverdue) && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 ring-1 ring-amber-200 mb-3">
                          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                          <div className="text-xs leading-snug">
                            <span className="font-bold text-amber-800">
                              {isCurrentlyOverdue ? 'Overdue: guest has not checked out' : `Late checkout: ${overdueDays} day${overdueDays !== 1 ? 's' : ''} past schedule`}
                            </span>
                            <div className="text-amber-600 mt-0.5">
                              Scheduled out: <span className="font-semibold">{scheduledOut.toLocaleDateString()}</span>
                              {wasOverdue && actualOut && (
                                <> · Actual: <span className="font-semibold">{actualOut.toLocaleDateString()}</span></>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Guest review */}
                      {review ? (
                        <div className="space-y-2.5">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Guest review</div>
                          {/* Stars */}
                          <div className="flex items-center gap-1">
                            {[1,2,3,4,5].map(s => (
                              <Star key={s} className={`h-4 w-4 ${
                                s <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'
                              }`} />
                            ))}
                            <span className="text-xs font-bold text-gray-700 ml-1">{review.rating}/5</span>
                          </div>
                          {review.title && <div className="text-sm font-semibold text-gray-900">{review.title}</div>}
                          {review.comment && <div className="text-xs text-gray-600 leading-relaxed">{review.comment}</div>}
                          <div className="text-[10px] text-gray-400">{new Date(review.createdAt).toLocaleDateString()}</div>

                          {/* Owner response */}
                          {review.ownerResponse && (
                            <div className="mt-2 p-3 rounded-xl bg-indigo-50 ring-1 ring-indigo-100">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <MessageSquare className="h-3.5 w-3.5 text-indigo-500" />
                                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide">Owner response</span>
                                {review.ownerResponseAt && (
                                  <span className="text-[10px] text-indigo-400 ml-auto">{new Date(review.ownerResponseAt).toLocaleDateString()}</span>
                                )}
                              </div>
                              <div className="text-xs text-indigo-800 leading-relaxed">{review.ownerResponse}</div>
                            </div>
                          )}
                        </div>
                      ) : b.status === 'CHECKED_OUT' ? (
                        <div className="text-xs text-gray-400 italic">No review submitted for this stay.</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </>
  );
}
