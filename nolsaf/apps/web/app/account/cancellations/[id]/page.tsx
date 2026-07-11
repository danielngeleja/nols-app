"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Send, MapPin, Calendar, DollarSign, MessageSquare } from "lucide-react";
import LayoutFrame from "@/components/LayoutFrame";
import LogoSpinner from "@/components/LogoSpinner";

const api = apiClient;

type Msg = { id: number; senderId: number; senderRole: string; body: string; createdAt: string };
type Item = {
  id: number;
  status: string;
  bookingCode: string;
  reason: string | null;
  decisionNote: string | null;
  policyEligible: boolean;
  policyRefundPercent: number | null;
  policyRule: string | null;
  refundAmount: number | null;
  refundProvider: string | null;
  refundReference: string | null;
  refundInitiatedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
  booking: {
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    status: string;
    guestName?: string | null;
    guestPhone?: string | null;
    roomCode?: string | null;
    property: { 
      title: string; 
      type?: string | null;
      regionName?: string | null; 
      city?: string | null; 
      district?: string | null;
      ward?: string | null;
      country?: string | null;
    };
  };
  messages: Msg[];
};

function fmt(d: string) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

function badge(status: string) {
  const s = (status || "").toUpperCase();
  const base = "inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border";
  if (s === "SUBMITTED") return `${base} bg-blue-50 text-blue-700 border-blue-200`;
  if (s === "REVIEWING") return `${base} bg-amber-50 text-amber-700 border-amber-200`;
  if (s === "NEED_INFO") return `${base} bg-orange-50 text-orange-700 border-orange-200`;
  if (s === "APPROVED") return `${base} bg-teal-50 text-teal-700 border-teal-200`;
  if (s === "REFUND_PENDING") return `${base} bg-purple-50 text-purple-700 border-purple-200`;
  if (s === "REFUNDED") return `${base} bg-emerald-50 text-emerald-700 border-emerald-200`;
  if (s === "REJECTED") return `${base} bg-red-50 text-red-700 border-red-200`;
  return `${base} bg-gray-50 text-gray-700 border-gray-200`;
}

export default function CustomerCancellationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id ?? "");

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/customer/cancellations/${id}`);
      setItem(res.data.item);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load cancellation request");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send() {
    if (!item) return;
    const body = message.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/customer/cancellations/${item.id}/messages`, { body });
      setMessage("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="w-full min-w-0">
      <LayoutFrame />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 overflow-x-hidden">
      {/* Back Button */}
      <div className="flex items-center">
        <Link 
          href="/account/cancellations" 
          className="group no-underline inline-flex items-center justify-center gap-2 h-9 w-9 sm:h-10 sm:w-10 rounded-full text-slate-700 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200 transition-all duration-200 hover:scale-105 active:scale-95"
        >
          <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 transition-transform group-hover:-translate-x-0.5" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white p-12 shadow-sm">
          <div className="flex flex-col items-center gap-3">
            <LogoSpinner size="md" ariaLabel="Loading cancellation request" />
            <div className="text-sm font-medium text-gray-600">Loading cancellation request...</div>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border-2 border-red-200 bg-red-50 px-6 py-5 shadow-sm">
          <div className="text-sm font-semibold text-red-900">{error}</div>
        </div>
      ) : !item ? null : (
        <div className="space-y-6 sm:space-y-8">
          {/* Cancellation Claim Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm transition-all duration-300">
            {/* Header Section */}
            <div className="border-b border-gray-200 pb-4 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#02665e]/10 to-[#02665e]/5 flex items-center justify-center border-2 border-[#02665e]/20 flex-shrink-0">
                    <span className="text-xl font-bold text-[#02665e]">#{item.id}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Cancellation claim</div>
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">Booking code:</span>{" "}
                      <span className="font-mono font-semibold text-gray-900">{item.bookingCode}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Created {new Date(item.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <span className={`${badge(item.status)} border transition-all`}>{item.status.replace(/_/g, " ")}</span>
                </div>
              </div>
            </div>

            {/* Booking Details Section */}
            <div className="space-y-4">
              <div className="p-5 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Booking Details</div>
                
                {/* Property Information */}
                <div className="flex items-start gap-3 mb-5">
                  <div className="w-10 h-10 rounded-lg bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                    <MapPin className="h-5 w-5 text-[#02665e]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-base text-gray-900 mb-1">{item.booking.property.title}</div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>
                        {[
                          item.booking.property.ward,
                          item.booking.property.district,
                          item.booking.property.city,
                          item.booking.property.regionName,
                          item.booking.property.country
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                      {item.booking.property.type && (
                        <div className="text-xs text-gray-500">
                          Type: <span className="font-medium">{item.booking.property.type}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Guest Information */}
                {(item.booking.guestName || item.booking.guestPhone) && (
                  <div className="pt-4 border-t border-gray-200 mb-4">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Guest Information</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {item.booking.guestName && (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="text-gray-500 font-medium">Full Name:</div>
                          <div className="text-gray-900 font-semibold">{item.booking.guestName}</div>
                        </div>
                      )}
                      {item.booking.guestPhone && (
                        <div className="flex items-center gap-2 text-sm">
                          <div className="text-gray-500 font-medium">Phone:</div>
                          <div className="text-gray-900 font-semibold">{item.booking.guestPhone}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Booking Dates & Amount */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <Calendar className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Check-in</div>
                      <div className="font-semibold text-sm text-gray-900">{new Date(item.booking.checkIn).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                      <Calendar className="h-4 w-4 text-purple-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Check-out</div>
                      <div className="font-semibold text-sm text-gray-900">{new Date(item.booking.checkOut).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 col-span-2 sm:col-span-1">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                      <DollarSign className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Amount</div>
                      <div className="font-semibold text-sm text-gray-900">{Number(item.booking.totalAmount).toLocaleString()} TZS</div>
                    </div>
                  </div>
                </div>

                {/* Room Information */}
                {item.booking.roomCode && (
                  <div className="pt-4 border-t border-gray-200 mt-4">
                    <div className="flex items-center gap-2 text-sm">
                      <div className="text-gray-500 font-medium">Room Type/Code:</div>
                      <div className="text-gray-900 font-semibold">{item.booking.roomCode}</div>
                    </div>
                  </div>
                )}
              </div>

              {item.refundAmount != null && (
                <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-5 py-4 sm:grid-cols-3">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Approved refund</div><div className="mt-1 font-bold text-emerald-950">{Number(item.refundAmount).toLocaleString()} TZS</div></div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Provider</div><div className="mt-1 font-bold text-emerald-950">{item.refundProvider || "Not initiated"}</div></div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Reference</div><div className="mt-1 break-all font-bold text-emerald-950">{item.refundReference || "Awaiting confirmation"}</div></div>
                </div>
              )}

              {/* Admin Note */}
              {item.decisionNote && (
                <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 px-5 py-4">
                  <div className="text-xs font-semibold text-amber-900 uppercase tracking-wide mb-2">Admin Note</div>
                  <div className="text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">{item.decisionNote}</div>
                </div>
              )}
            </div>
          </div>

          {/* Messages Card */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm transition-all duration-300">
            <div className="flex items-center gap-2 mb-6">
              <MessageSquare className="h-5 w-5 text-[#02665e]" />
              <div className="text-lg font-semibold text-gray-900">Messages</div>
              {item.messages.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs font-medium text-gray-700">
                  {item.messages.length}
                </span>
              )}
            </div>

            <div className="space-y-4 mb-6">
              {item.messages.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <div className="text-sm font-medium text-gray-700">No messages yet</div>
                  <div className="text-sm text-gray-500 mt-1">Start a conversation with the admin team</div>
                </div>
              ) : (
                item.messages.map((m) => {
                  const isAdmin = m.senderRole === "ADMIN";
                  return (
                    <div
                      key={m.id}
                      className={`flex gap-3 ${isAdmin ? "flex-row" : "flex-row-reverse"}`}
                    >
                      <div className={`flex-1 ${isAdmin ? "max-w-[85%] sm:max-w-[75%]" : "max-w-[85%] sm:max-w-[75%]"}`}>
                        <div
                          className={`rounded-2xl px-4 py-3 transition-all duration-200 ${
                            isAdmin
                              ? "bg-blue-50/50 border-l-4 border-blue-400 shadow-sm"
                              : "bg-[#02665e]/5 border-l-4 border-[#02665e] shadow-sm ml-auto"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className={`text-xs font-semibold ${
                              isAdmin ? "text-blue-700" : "text-[#02665e]"
                            }`}>
                              {isAdmin ? "Admin" : "You"}
                            </div>
                            <div className="text-[11px] text-gray-500">
                              {fmt(m.createdAt)}
                            </div>
                          </div>
                          <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
                            {m.body}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Message Input */}
            <div className="border-t border-gray-200 pt-6">
              {["REFUNDED", "REJECTED"].includes(item.status) ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">This cancellation is final. The message history remains available for your records.</div>
              ) : <div className="space-y-3">
                <div className="relative">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={4}
                    className="w-full min-w-0 max-w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 pr-24 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all resize-none box-border"
                    placeholder="Reply to admin / provide more information..."
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={sending || !message.trim()}
                    className="absolute right-2 bottom-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[#02665e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#014d47] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                  >
                    {sending ? (
                      <LogoSpinner size="xs" className="h-4 w-4" ariaLabel="Sending message" />
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span className="hidden sm:inline">Send</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    Press Ctrl+Enter or Cmd+Enter to send
                  </div>
                  {error && (
                    <div className="text-xs text-red-600 font-medium">{error}</div>
                  )}
                </div>
              </div>}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}


