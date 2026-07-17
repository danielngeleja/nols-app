"use client";

// NRMS guests (doc 7.6): property-scoped guest records with stay history.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import apiClient from "@/lib/apiClient";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Eye, Loader2, Megaphone, MessageSquareText, MousePointerClick, Repeat2, Search, ShieldCheck, Users, X } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type SmsOutreach = {
  eligible: boolean;
  reason: "ELIGIBLE" | "NO_PHONE" | "NO_CONSENT" | "OPTED_OUT" | "ANNUAL_LIMIT";
  normalizedPhone: string | null;
  consentStatus: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";
  usedCount: number;
  remainingCount: number;
};

type Guest = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  reservationCount: number;
  lastStay: { checkIn: string; checkOut: string; status: string } | null;
  smsOutreach: SmsOutreach;
};

type GuestDetail = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  notes: string | null;
  smsOutreach: SmsOutreach;
  reservations: Array<{
    id: number;
    status: string;
    source: string;
    checkIn: string;
    checkOut: string;
    totalAmount: number | null;
    amountPaid: number | null;
    currency: string;
  }>;
};

const GUEST_PAGE_SIZE = 10;
type AudienceType = "SELECTED" | "ALL_ELIGIBLE" | "INACTIVE_90" | "INACTIVE_180" | "INACTIVE_365" | "REPEAT_GUESTS";

type AudiencePreview = {
  totalCount: number;
  eligibleCount: number;
  skippedCount: number;
  reasons: Record<string, number>;
};

const AUDIENCE_OPTIONS: Array<{ value: AudienceType; label: string; description: string }> = [
  { value: "SELECTED", label: "Selected guests", description: "Only guests selected in the table" },
  { value: "ALL_ELIGIBLE", label: "All eligible guests", description: "Everyone with consent and quota" },
  { value: "REPEAT_GUESTS", label: "Repeat guests", description: "Guests with two or more stays" },
  { value: "INACTIVE_90", label: "Inactive 90+ days", description: "Last stay was at least 3 months ago" },
  { value: "INACTIVE_180", label: "Inactive 180+ days", description: "Last stay was at least 6 months ago" },
  { value: "INACTIVE_365", label: "Inactive 1+ year", description: "Last stay was at least one year ago" },
];

export default function NrmsGuestsPage() {
  const { selectedPropertyId } = useNrms();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [page, setPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [detail, setDetail] = useState<GuestDetail | null>(null);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignKind, setCampaignKind] = useState<"OFFER" | "RETURN_INVITATION">("RETURN_INVITATION");
  const [campaignMessage, setCampaignMessage] = useState("");
  const [audienceType, setAudienceType] = useState<AudienceType>("SELECTED");
  const [audiencePreview, setAudiencePreview] = useState<AudiencePreview | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [campaignSubmitting, setCampaignSubmitting] = useState(false);
  const [campaignNotice, setCampaignNotice] = useState<string | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [pendingConsent, setPendingConsent] = useState<"OPTED_IN" | "OPTED_OUT" | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiClient.get<any>(`/api/owner/nrms/guests/${selectedPropertyId}`, {
        params: { q: q || undefined, page, pageSize: GUEST_PAGE_SIZE, sortOrder },
      });
      setGuests(r.data?.guests ?? []);
      setTotal(Number(r.data?.total ?? 0));
      setPageCount(Number(r.data?.pageCount ?? 0));
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load guests");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId, q, page, sortOrder]);

  useEffect(() => {
    setPage(1);
    setSelectedGuestIds(new Set());
  }, [selectedPropertyId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const openDetail = async (guestId: number) => {
    if (!selectedPropertyId) return;
    try {
      const r = await apiClient.get<any>(`/api/owner/nrms/guests/${selectedPropertyId}/${guestId}`);
      setDetail(r.data?.guest ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load guest");
    }
  };

  const openCampaign = () => {
    const selectedAudience = selectedGuestIds.size > 0 ? "SELECTED" : "ALL_ELIGIBLE";
    setAudienceType(selectedAudience);
    setCampaignName("");
    setCampaignKind("RETURN_INVITATION");
    setCampaignMessage("");
    setAudiencePreview(null);
    setCampaignError(null);
    setCampaignOpen(true);
  };

  const previewAudience = useCallback(async () => {
    if (!selectedPropertyId || !campaignOpen) return;
    setPreviewLoading(true);
    setCampaignError(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/sms/${selectedPropertyId}/preview`, {
        audienceType,
        guestIds: audienceType === "SELECTED" ? [...selectedGuestIds] : [],
      });
      setAudiencePreview(response.data?.preview ?? null);
    } catch (e: any) {
      setAudiencePreview(null);
      setCampaignError(e?.response?.data?.error || "Failed to preview this audience");
    } finally {
      setPreviewLoading(false);
    }
  }, [audienceType, campaignOpen, selectedGuestIds, selectedPropertyId]);

  useEffect(() => {
    if (!campaignOpen) return;
    const timer = setTimeout(() => void previewAudience(), 150);
    return () => clearTimeout(timer);
  }, [campaignOpen, previewAudience]);

  const queueCampaign = async () => {
    if (!selectedPropertyId) return;
    setCampaignSubmitting(true);
    setCampaignError(null);
    try {
      const response = await apiClient.post<any>(`/api/owner/nrms/sms/${selectedPropertyId}/campaigns`, {
        name: campaignName,
        kind: campaignKind,
        message: campaignMessage,
        audienceType,
        guestIds: audienceType === "SELECTED" ? [...selectedGuestIds] : [],
      });
      const eligible = Number(response.data?.campaign?.eligibleCount ?? 0);
      setCampaignOpen(false);
      setCampaignNotice(eligible > 0 ? `${eligible} SMS message${eligible === 1 ? "" : "s"} queued for delivery.` : "Campaign saved; no guests were eligible to receive it.");
      setSelectedGuestIds(new Set());
      await load();
    } catch (e: any) {
      setCampaignError(e?.response?.data?.error || "Failed to queue SMS campaign");
    } finally {
      setCampaignSubmitting(false);
    }
  };

  const updateConsent = async (status: "OPTED_IN" | "OPTED_OUT") => {
    if (!selectedPropertyId || !detail) return;
    setConsentSaving(true);
    setConsentError(null);
    try {
      await apiClient.put(`/api/owner/nrms/sms/${selectedPropertyId}/preferences/${detail.id}`, { status, confirmedByGuest: true });
      await Promise.all([openDetail(detail.id), load()]);
      setPendingConsent(null);
    } catch (e: any) {
      setConsentError(e?.response?.data?.error || "Failed to update SMS consent");
    } finally {
      setConsentSaving(false);
    }
  };

  const selectableGuests = guests.filter((guest) => Boolean(guest.smsOutreach.normalizedPhone));
  const allPageSelected = selectableGuests.length > 0 && selectableGuests.every((guest) => selectedGuestIds.has(guest.id));

  if (!selectedPropertyId) {
    return <p className="text-sm text-neutral-500 py-10 text-center">Add a property first to see guests.</p>;
  }

  return (
    <div className="min-w-0 max-w-full pb-10">
      <div className="relative mb-4 box-border w-full min-w-0 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          className="block box-border w-full min-w-0 max-w-full rounded-lg border border-neutral-300 py-2 pl-9 pr-3 text-sm"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name or phone"
        />
      </div>

      {campaignNotice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> {campaignNotice}</span>
          <button type="button" onClick={() => setCampaignNotice(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold text-neutral-800">Guest SMS outreach</p>
          <p className="mt-0.5 text-[10px] text-neutral-500">Only opted-in guests can receive up to 3 promotional messages per calendar year.</p>
        </div>
        <button
          type="button"
          onClick={openCampaign}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3.5 text-xs font-bold text-white transition hover:bg-emerald-800"
        >
          <MessageSquareText className="h-4 w-4" />
          {selectedGuestIds.size > 0 ? `Message ${selectedGuestIds.size} selected` : "Create SMS campaign"}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-neutral-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      ) : guests.length === 0 ? (
        <p className="text-sm text-neutral-500 py-14 text-center border border-dashed border-neutral-300 rounded-2xl">
          {q ? "No guests match your search." : "Guest records build up automatically as you record reservations."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead className="border-b border-neutral-200 bg-neutral-50/90">
                <tr className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                  <th scope="col" className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all guests on this page with phone numbers"
                      checked={allPageSelected}
                      onChange={() => {
                        setSelectedGuestIds((current) => {
                          const next = new Set(current);
                          for (const guest of selectableGuests) {
                            if (allPageSelected) next.delete(guest.id);
                            else next.add(guest.id);
                          }
                          return next;
                        });
                      }}
                      className="h-4 w-4 rounded border-neutral-300 text-emerald-700 focus:ring-emerald-600"
                    />
                  </th>
                  <th scope="col" className="px-4 py-3" aria-sort={sortOrder === "asc" ? "ascending" : "descending"}>
                    <button
                      type="button"
                      onClick={() => {
                        setSortOrder((current) => current === "asc" ? "desc" : "asc");
                        setPage(1);
                      }}
                      className="inline-flex appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500 shadow-none outline-none transition hover:text-emerald-700 focus-visible:text-emerald-700 focus-visible:underline"
                      aria-label={`Sort guests by name ${sortOrder === "asc" ? "descending" : "ascending"}`}
                    >
                      Guest {sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3">Contact</th>
                  <th scope="col" className="px-4 py-3">Nationality</th>
                  <th scope="col" className="px-4 py-3 text-center">Stays</th>
                  <th scope="col" className="px-4 py-3">Last stay</th>
                  <th scope="col" className="px-4 py-3">SMS outreach</th>
                  <th scope="col" className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {guests.map((g) => (
                  <tr key={g.id} className="group transition hover:bg-emerald-50/35">
                    <td className="px-3 py-3.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${g.fullName} for SMS outreach`}
                        disabled={!g.smsOutreach.normalizedPhone}
                        checked={selectedGuestIds.has(g.id)}
                        onChange={() => setSelectedGuestIds((current) => {
                          const next = new Set(current);
                          if (next.has(g.id)) next.delete(g.id);
                          else next.add(g.id);
                          return next;
                        })}
                        className="h-4 w-4 rounded border-neutral-300 text-emerald-700 focus:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <button type="button" onClick={() => openDetail(g.id)} className="appearance-none border-0 bg-transparent p-0 text-sm font-bold text-neutral-900 shadow-none outline-none transition hover:text-emerald-700 focus-visible:text-emerald-700 focus-visible:underline">
                        {g.fullName}
                      </button>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-xs font-medium text-neutral-700">{g.phone || "No phone"}</p>
                      <p className="mt-0.5 max-w-52 truncate text-[10px] text-neutral-400">{g.email || "No email"}</p>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-neutral-600">{g.nationality || "—"}</td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="inline-flex min-w-8 justify-center rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">{g.reservationCount}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      {g.lastStay ? (
                        <>
                          <p className="text-xs font-medium text-neutral-700">{new Date(g.lastStay.checkIn).toLocaleDateString()}</p>
                          <p className="mt-0.5 text-[10px] capitalize text-neutral-400">{g.lastStay.status.replace(/_/g, " ").toLowerCase()}</p>
                        </>
                      ) : (
                        <span className="text-xs text-neutral-400">No stays</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          g.smsOutreach.eligible
                            ? "bg-emerald-50 text-emerald-700"
                            : g.smsOutreach.reason === "ANNUAL_LIMIT" || g.smsOutreach.reason === "OPTED_OUT"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-amber-50 text-amber-700"
                        }`}>
                          {g.smsOutreach.eligible
                            ? "Eligible"
                            : g.smsOutreach.reason === "NO_PHONE"
                              ? "No phone"
                              : g.smsOutreach.reason === "NO_CONSENT"
                                ? "Needs consent"
                                : g.smsOutreach.reason === "OPTED_OUT"
                                  ? "Opted out"
                                  : "Yearly limit"}
                        </span>
                        {g.smsOutreach.normalizedPhone && (
                          <span className="whitespace-nowrap text-[10px] font-medium text-neutral-400">{g.smsOutreach.usedCount}/3 used</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(g.id)}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-[10px] font-bold text-neutral-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-neutral-200 bg-neutral-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-medium text-neutral-500">
              Showing <strong className="text-neutral-800">{(page - 1) * GUEST_PAGE_SIZE + 1}–{Math.min(page * GUEST_PAGE_SIZE, total)}</strong> of <strong className="text-neutral-800">{total}</strong> guests
            </p>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <span className="min-w-20 text-center text-[10px] font-bold text-neutral-500">Page {page} of {Math.max(pageCount, 1)}</span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 my-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-neutral-900">{detail.fullName}</h3>
              <button type="button" onClick={() => setDetail(null)} aria-label="Close dialog">
                <X className="w-4 h-4 text-neutral-400" />
              </button>
            </div>
            <div className="text-xs text-neutral-500 mb-4">
              {[detail.phone, detail.email, detail.nationality].filter(Boolean).join(" · ") || "No contact details"}
            </div>
            <div className="mb-5 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-bold text-neutral-800"><ShieldCheck className="h-4 w-4 text-emerald-700" /> Promotional SMS consent</p>
                  <p className="mt-1 text-[10px] text-neutral-500">
                    {detail.smsOutreach.consentStatus === "OPTED_IN"
                      ? `Opted in · ${detail.smsOutreach.usedCount}/3 messages used this year`
                      : detail.smsOutreach.consentStatus === "OPTED_OUT"
                        ? "Guest has opted out"
                        : "No consent has been recorded"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={consentSaving || !detail.smsOutreach.normalizedPhone}
                    onClick={() => {
                      setConsentError(null);
                      setPendingConsent("OPTED_IN");
                    }}
                    className="min-h-8 rounded-lg border border-emerald-200 bg-white px-2.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                  >
                    Record opt-in
                  </button>
                  <button
                    type="button"
                    disabled={consentSaving || !detail.smsOutreach.normalizedPhone}
                    onClick={() => {
                      setConsentError(null);
                      setPendingConsent("OPTED_OUT");
                    }}
                    className="min-h-8 rounded-lg border border-neutral-200 bg-white px-2.5 text-[10px] font-bold text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                  >
                    Record opt-out
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-neutral-400">Record opt-in only after the guest clearly agrees. Booking and payment messages are managed separately from promotional consent.</p>
              {consentError && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] font-medium text-red-700">{consentError}</p>}
            </div>
            <h4 className="text-xs font-semibold text-neutral-700 mb-2">Stay history</h4>
            {detail.reservations.length === 0 ? (
              <p className="text-xs text-neutral-400">No stays recorded yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm">
                {detail.reservations.map((r) => (
                  <li key={r.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-neutral-800">
                        {new Date(r.checkIn).toLocaleDateString()} to {new Date(r.checkOut).toLocaleDateString()}
                      </div>
                      <div className="text-[11px] text-neutral-400">
                        {r.source.replace(/_/g, " ").toLowerCase()} · {r.status.replace(/_/g, " ").toLowerCase()}
                      </div>
                    </div>
                    <div className="text-xs text-neutral-600">
                      {r.totalAmount != null ? `${r.currency} ${r.totalAmount.toLocaleString()}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {pendingConsent && detail && typeof document !== "undefined" && createPortal((
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close consent confirmation"
            disabled={consentSaving}
            onClick={() => setPendingConsent(null)}
            className="absolute inset-0 bg-neutral-950/55 backdrop-blur-[2px] disabled:cursor-wait"
          />
          <div role="alertdialog" aria-modal="true" aria-labelledby="consent-confirmation-title" className="relative w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_28px_80px_-24px_rgba(0,0,0,0.55)]">
            <div className={`h-1 w-full ${pendingConsent === "OPTED_IN" ? "bg-emerald-600" : "bg-rose-500"}`} />
            <div className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${pendingConsent === "OPTED_IN" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <button
                  type="button"
                  disabled={consentSaving}
                  onClick={() => setPendingConsent(null)}
                  aria-label="Close confirmation"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className={`mt-4 text-[9px] font-bold uppercase tracking-[0.14em] ${pendingConsent === "OPTED_IN" ? "text-emerald-700" : "text-rose-700"}`}>
                Promotional SMS preference
              </p>
              <h3 id="consent-confirmation-title" className="mt-1 text-lg font-bold text-neutral-950">
                {pendingConsent === "OPTED_IN" ? "Confirm guest permission" : "Record guest opt-out"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                {pendingConsent === "OPTED_IN"
                  ? `Only continue if ${detail.fullName} clearly agreed to receive promotional SMS messages.`
                  : `Confirm that ${detail.fullName} asked not to receive promotional SMS messages.`}
              </p>

              <div className={`mt-4 rounded-xl border px-3.5 py-3 text-[11px] leading-relaxed ${pendingConsent === "OPTED_IN" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-neutral-200 bg-neutral-50 text-neutral-600"}`}>
                {pendingConsent === "OPTED_IN"
                  ? "Consent must come directly from the guest. A previous booking does not automatically provide marketing permission."
                  : "The guest will immediately become ineligible for all future promotional campaigns."}
              </div>

              {consentError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700">{consentError}</div>}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={consentSaving}
                  onClick={() => setPendingConsent(null)}
                  className="min-h-10 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={consentSaving}
                  onClick={() => void updateConsent(pendingConsent)}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold text-white transition disabled:cursor-wait disabled:opacity-60 ${pendingConsent === "OPTED_IN" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-rose-600 hover:bg-rose-700"}`}
                >
                  {consentSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {pendingConsent === "OPTED_IN" ? "Confirm opt-in" : "Confirm opt-out"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}

      {campaignOpen && typeof document !== "undefined" && createPortal((
        <div className="fixed inset-0 z-[9999] flex min-h-dvh items-center justify-center overflow-hidden p-0 sm:p-5">
          <button type="button" aria-label="Close campaign dialog" className="absolute inset-0 bg-neutral-950/55 backdrop-blur-[2px]" onClick={() => setCampaignOpen(false)} />
          <div role="dialog" aria-modal="true" aria-labelledby="sms-campaign-title" className="relative flex max-h-[calc(100vh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[22px] border border-neutral-200 bg-[#f7f9f8] shadow-[0_28px_90px_-28px_rgba(0,0,0,0.55)] sm:max-h-[calc(100vh-2.5rem)]">
            <div className="h-1 w-full shrink-0 bg-gradient-to-r from-emerald-800 via-emerald-500 to-teal-400" />
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 bg-white px-4 py-3.5 sm:px-6">
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-[0_8px_22px_-10px_rgba(4,120,87,0.8)]">
                  <Megaphone className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 id="sms-campaign-title" className="truncate text-base font-bold text-neutral-950">Create SMS campaign</h3>
                    <span className="hidden rounded-full bg-amber-50 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-700 sm:inline-flex">Draft</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-neutral-500">Guest engagement · Delivered securely through Africa&apos;s Talking</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-700 sm:inline-flex"><ShieldCheck className="h-3 w-3" /> Consent protected</span>
                <button type="button" onClick={() => setCampaignOpen(false)} aria-label="Close dialog" className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-500 transition hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-900">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 auto-rows-max content-start grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-12 lg:items-start">
              <section className="isolate h-fit min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-30px_rgba(15,23,42,0.55)] lg:col-span-6">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Megaphone className="h-4 w-4" /></span>
                  <div><h4 className="text-sm font-bold text-neutral-900">Campaign details</h4><p className="text-[10px] text-neutral-400">Give this campaign a clear internal name and purpose.</p></div>
                </div>
                <label className="block min-w-0 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">
                  Campaign name
                  <input
                    value={campaignName}
                    onChange={(event) => setCampaignName(event.target.value)}
                    maxLength={120}
                    placeholder="e.g. July return guest invitation"
                    className="mt-2 block min-h-11 w-full min-w-0 max-w-full box-border rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 text-sm font-medium normal-case tracking-normal text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-50"
                  />
                </label>
                <div className="mt-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">Message purpose</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => setCampaignKind("RETURN_INVITATION")} className={`box-border flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-xl border p-3 text-left transition ${campaignKind === "RETURN_INVITATION" ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-100" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${campaignKind === "RETURN_INVITATION" ? "bg-emerald-700 text-white" : "bg-neutral-100 text-neutral-500"}`}><Repeat2 className="h-4 w-4" /></span>
                      <span><strong className="block text-xs text-neutral-900">Invite guests to return</strong><small className="mt-0.5 block text-[10px] text-neutral-400">Reconnect with past guests</small></span>
                      {campaignKind === "RETURN_INVITATION" && <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-700" />}
                    </button>
                    <button type="button" onClick={() => setCampaignKind("OFFER")} className={`box-border flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-xl border p-3 text-left transition ${campaignKind === "OFFER" ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-100" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${campaignKind === "OFFER" ? "bg-emerald-700 text-white" : "bg-neutral-100 text-neutral-500"}`}><Megaphone className="h-4 w-4" /></span>
                      <span><strong className="block text-xs text-neutral-900">Share an offer</strong><small className="mt-0.5 block text-[10px] text-neutral-400">Promote a limited guest deal</small></span>
                      {campaignKind === "OFFER" && <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-700" />}
                    </button>
                  </div>
                </div>
              </section>

              <section className="isolate h-fit min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-30px_rgba(15,23,42,0.55)] lg:col-span-6">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Users className="h-4 w-4" /></span>
                  <div><h4 className="text-sm font-bold text-neutral-900">Choose audience</h4><p className="text-[10px] text-neutral-400">Eligibility and the 3-per-year limit are enforced automatically.</p></div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {AUDIENCE_OPTIONS.map((option) => {
                    const disabled = option.value === "SELECTED" && selectedGuestIds.size === 0;
                    const selected = audienceType === option.value;
                    const Icon = option.value === "SELECTED" ? MousePointerClick : option.value === "ALL_ELIGIBLE" ? Users : option.value === "REPEAT_GUESTS" ? Repeat2 : Clock3;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => setAudienceType(option.value)}
                        className={`relative box-border min-h-[74px] w-full min-w-0 max-w-full overflow-hidden rounded-xl border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-100" : "border-neutral-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/25"}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-emerald-700 text-white" : "bg-neutral-100 text-neutral-500"}`}><Icon className="h-3.5 w-3.5" /></span>
                          <span className="min-w-0"><strong className="block text-[11px] text-neutral-900">{option.label}{option.value === "SELECTED" ? ` (${selectedGuestIds.size})` : ""}</strong><small className="mt-1 block text-[9px] leading-snug text-neutral-400">{option.description}</small></span>
                        </div>
                        {selected && <CheckCircle2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-emerald-700" />}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="isolate h-fit min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-30px_rgba(15,23,42,0.55)] lg:col-span-8">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><MessageSquareText className="h-4 w-4" /></span>
                  <div><h4 className="text-sm font-bold text-neutral-900">Write the message</h4><p className="text-[10px] text-neutral-400">Keep it useful, recognizable, and easy to understand.</p></div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 transition focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-50">
                  <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-3.5 py-2.5">
                    <span className="flex items-center gap-2 text-[10px] font-bold text-neutral-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> SMS via Africa&apos;s Talking</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[9px] font-medium text-neutral-400">Up to 4 SMS segments</span>
                      {campaignMessage && <button type="button" onClick={() => setCampaignMessage("")} className="text-[9px] font-bold text-neutral-500 transition hover:text-rose-600">Clear</button>}
                    </div>
                  </div>
                  <textarea
                    aria-label="Campaign message"
                    value={campaignMessage}
                    onChange={(event) => setCampaignMessage(event.target.value)}
                    maxLength={612}
                    rows={9}
                    placeholder="Write your message here..."
                    className="block min-h-64 w-full min-w-0 max-w-full box-border resize-y border-0 bg-transparent px-4 py-4 font-sans text-sm font-normal leading-6 text-neutral-800 outline-none placeholder:font-sans placeholder:text-neutral-400 focus:ring-0"
                  />
                  <div className="flex items-center justify-between border-t border-neutral-200 bg-white px-3.5 py-2.5">
                    <span className="text-[9px] text-neutral-400">Estimated {campaignMessage.length <= 160 ? 1 : Math.ceil(campaignMessage.length / 153)} SMS segment{(campaignMessage.length <= 160 ? 1 : Math.ceil(campaignMessage.length / 153)) === 1 ? "" : "s"}</span>
                    <span className={`text-[10px] font-bold ${campaignMessage.length > 560 ? "text-amber-600" : "text-neutral-400"}`}>{campaignMessage.length}/612</span>
                  </div>
                </div>
              </section>

              <section className="isolate h-fit min-w-0 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 lg:col-span-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><ShieldCheck className="h-4 w-4" /></span><div><h4 className="text-sm font-bold text-blue-950">Audience preview</h4><p className="text-[10px] text-blue-700/60">A final safety check before queueing.</p></div></div>
                  {previewLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                </div>
                {audiencePreview && !previewLoading ? (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl border border-white bg-white/90 p-3 shadow-sm"><strong className="block text-lg text-neutral-900">{audiencePreview.totalCount}</strong><span className="text-[8px] font-bold uppercase tracking-[0.12em] text-neutral-400">Matched</span></div>
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3"><strong className="block text-lg text-emerald-700">{audiencePreview.eligibleCount}</strong><span className="text-[8px] font-bold uppercase tracking-[0.12em] text-emerald-700/60">Will receive</span></div>
                      <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-3"><strong className="block text-lg text-amber-700">{audiencePreview.skippedCount}</strong><span className="text-[8px] font-bold uppercase tracking-[0.12em] text-amber-700/60">Protected</span></div>
                    </div>
                    {audiencePreview.skippedCount > 0 && (
                      <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-[10px] leading-relaxed text-blue-800">
                        <strong>Excluded:</strong> {[
                          ["No phone", audiencePreview.reasons.NO_PHONE],
                          ["no consent", audiencePreview.reasons.NO_CONSENT],
                          ["opted out", audiencePreview.reasons.OPTED_OUT],
                          ["yearly limit", audiencePreview.reasons.ANNUAL_LIMIT],
                          ["duplicate phone", audiencePreview.reasons.DUPLICATE_PHONE],
                        ].filter(([, count]) => Number(count) > 0).map(([label, count]) => `${count} ${label}`).join(" · ")}
                      </p>
                    )}
                  </>
                ) : !previewLoading ? <p className="mt-3 text-[10px] text-blue-700">Choose an audience to calculate who can safely receive this message.</p> : null}
              </section>

              {campaignError && <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700 lg:col-span-12">{campaignError}</div>}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="hidden max-w-xs text-[9px] leading-relaxed text-neutral-400 sm:block">Only opted-in guests with annual quota remaining will be queued.</p>
              <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
                <button type="button" onClick={() => setCampaignOpen(false)} className="min-h-10 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50">Cancel</button>
                <button
                  type="button"
                  disabled={campaignSubmitting || previewLoading || !audiencePreview || audiencePreview.eligibleCount === 0 || campaignName.trim().length < 3 || campaignMessage.trim().length < 5}
                  onClick={() => void queueCampaign()}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
                >
                  {campaignSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Queue {audiencePreview?.eligibleCount ?? 0} SMS message{audiencePreview?.eligibleCount === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
