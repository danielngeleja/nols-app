"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { ArrowLeft, Loader2, CalendarDays, Ticket, Receipt, CheckCircle2, Clock3, CreditCard, Plus, Minus, MapPin, Trash2, Users, Share2, Copy, Star } from "lucide-react";

const api = apiClient;
const MAX_ACTION_WORDS = 30;
const MAX_CANCELLATION_WORDS = 120;

function countWords(text: string): number {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  return normalized.split(/\s+/).length;
}

function displayText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return fallback;
}

function friendlyTimelineShareError(error: any): string {
  const code = String(error?.response?.data?.error || "").trim();
  const message = String(error?.response?.data?.message || "").trim();
  if (code === "traveller_capacity_full") return "All traveller slots are already connected for this timeline.";
  if (code === "meetup_not_validated") return "Validate meetup before sharing this timeline.";
  return message || code || "Failed to prepare timeline invite.";
}

export default function TourPackageDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activeActionForm, setActiveActionForm] = useState<"change" | "issue" | "cancellation" | null>(null);
  const [actionTitle, setActionTitle] = useState("");
  const [actionDraft, setActionDraft] = useState("");
  const [changeType, setChangeType] = useState<
    "GENERAL" | "DATE_CHANGE" | "TRAVELERS" | "DOCUMENTS" | "PICKUP" | "ITINERARY" | "OTHER"
  >("GENERAL");
  const [issueType, setIssueType] = useState<
    "GENERAL" | "SERVICE" | "TIMING" | "PICKUP" | "DOCUMENTS" | "PAYMENT" | "COMMUNICATION" | "OTHER"
  >("GENERAL");
  const [issueSeverity, setIssueSeverity] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [deletingAuditId, setDeletingAuditId] = useState<string | null>(null);
  const [pendingDeleteAudit, setPendingDeleteAudit] = useState<{ id: string; kind: "CHANGE_REQUEST" | "ISSUE_REPORT" } | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [uploadedDocsCount, setUploadedDocsCount] = useState<number>(0);
  const [shareLoading, setShareLoading] = useState(false);
  const [timelineInviteUrl, setTimelineInviteUrl] = useState("");
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [completionLoading, setCompletionLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
        if (!alive) return;
        const nextItem = res.data || null;
        setItem(nextItem);
        const invitePath = String(nextItem?.timelineShare?.invitePath || "").trim();
        const inviteUrl = String(nextItem?.timelineShare?.inviteUrl || "").trim();
        if (invitePath && typeof window !== "undefined") {
          setTimelineInviteUrl(`${window.location.origin}${invitePath}`);
        } else if (inviteUrl) {
          setTimelineInviteUrl(inviteUrl);
        }
      } catch (err: any) {
        if (!alive) return;
        setError(displayText(err?.response?.data?.error, "Failed to load tour package"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/api/account/me");
        if (!alive) return;
        const data = (res as any)?.data?.data ?? (res as any)?.data ?? {};
        const docs = Array.isArray(data?.documents) ? data.documents : [];
        const uploadedForBooking = docs.filter((doc: any) => {
          const url = String(doc?.url || "").trim();
          if (!url) return false;
          const meta = doc?.metadata && typeof doc.metadata === "object" ? doc.metadata : null;
          const bookingIdFromMeta = String(meta?.bookingId || "").trim();
          return bookingIdFromMeta === String(id);
        }).length;
        setUploadedDocsCount(uploadedForBooking);
      } catch {
        if (!alive) return;
        setUploadedDocsCount(0);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  const submitChangeRequest = async (title: string, message: string) => {
    if (!id) return;
    if (!title.trim() || !message.trim()) return;
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/request-change`, {
        title: title.trim(),
        message: message.trim(),
        changeType,
      });
      setActionMessage(res?.data?.ok ? "Change request submitted." : "Change request sent.");
      const latest = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
      setItem(latest.data || null);
      setActionTitle("");
      setActionDraft("");
      setActiveActionForm(null);
    } catch (err: any) {
      setActionMessage(displayText(err?.response?.data?.error, "Failed to submit change request."));
    } finally {
      setActionLoading(false);
    }
  };

  const submitIssueReport = async (title: string, message: string) => {
    if (!id) return;
    if (!title.trim() || !message.trim()) return;
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/report-issue`, {
        title: title.trim(),
        message: message.trim(),
        issueType,
        severity: issueSeverity,
      });
      setActionMessage(res?.data?.ok ? "Issue reported successfully." : "Issue reported.");
      const latest = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
      setItem(latest.data || null);
      setActionTitle("");
      setActionDraft("");
      setActiveActionForm(null);
    } catch (err: any) {
      setActionMessage(displayText(err?.response?.data?.error, "Failed to report issue."));
    } finally {
      setActionLoading(false);
    }
  };

  const submitCancellationRequest = async (title: string, message: string) => {
    if (!id) return;
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/request-cancellation`, {
        reasonCategory: title.trim(),
        reason: message.trim(),
      });
      const eligibility = res?.data?.eligibility;
      const amount = Number(eligibility?.estimatedRefundAmount || 0);
      const percentage = Number(eligibility?.refundPercent || 0);
      setActionMessage(`${displayText(eligibility?.reason, "Cancellation submitted for review")} Provisional refund: ${percentage}% (${amount.toLocaleString()} ${item?.currency || "TZS"}).`);
      const latest = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
      setItem(latest.data || null);
      setActionTitle("");
      setActionDraft("");
      setActiveActionForm(null);
    } catch (err: any) {
      setActionMessage(displayText(err?.response?.data?.error, "Failed to submit cancellation request."));
    } finally {
      setActionLoading(false);
    }
  };

  const openActionForm = (kind: "change" | "issue" | "cancellation") => {
    setActiveActionForm(kind);
    setActionTitle("");
    setActionDraft("");
    setChangeType("GENERAL");
    setIssueType("GENERAL");
    setIssueSeverity("MEDIUM");
    setActionMessage(null);
  };

  const closeActionForm = () => {
    if (actionLoading) return;
    setActiveActionForm(null);
    setActionTitle("");
    setActionDraft("");
  };

  const confirmTourCompletion = async () => {
    if (!id || completionLoading) return;
    setCompletionLoading(true);
    setActionMessage(null);
    try {
      await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/confirm-completion`);
      const latest = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
      setItem(latest.data || null);
      setActionMessage("Tour completion confirmed. Thank you—your review is now available.");
    } catch (error: any) {
      setActionMessage(displayText(error?.response?.data?.error, "Could not confirm tour completion."));
    } finally { setCompletionLoading(false); }
  };

  const createTimelineInvite = async () => {
    if (!id || shareLoading) return;
    setShareLoading(true);
    setShareMessage(null);
    try {
      const res = await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/timeline-invite`);
      const invitePath = String(res?.data?.invitePath || "").trim();
      const apiUrl = String(res?.data?.inviteUrl || "").trim();
      const fullUrl = invitePath && typeof window !== "undefined"
        ? `${window.location.origin}${invitePath}`
        : apiUrl;
      setTimelineInviteUrl(fullUrl);
      if (fullUrl && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl);
        setShareMessage(res?.data?.reused ? "Timeline invite copied again." : "Timeline invite copied. The traveller must register or login before opening it.");
      } else {
        setShareMessage(res?.data?.reused ? "Timeline invite ready to share." : "Timeline invite created. The traveller must register or login before opening it.");
      }
      setItem((prev: any) => prev ? {
        ...prev,
        timelineShare: {
          ...(prev.timelineShare || {}),
          hasInvite: true,
          invitePath,
          inviteUrl: fullUrl,
          expiresAt: res?.data?.invite?.expiresAt || prev?.timelineShare?.expiresAt || null,
        },
        timelineTeam: res?.data?.invite?.team || prev.timelineTeam,
      } : prev);
    } catch (err: any) {
      setShareMessage(friendlyTimelineShareError(err));
    } finally {
      setShareLoading(false);
    }
  };

  const submitActiveAction = async () => {
    const title = actionTitle.trim();
    const message = actionDraft.trim();
    if (!title) {
      setActionMessage("Please add a short title for your request.");
      return;
    }
    if (!message) {
      setActionMessage("Please describe your request before submitting.");
      return;
    }
    const wordLimit = activeActionForm === "cancellation" ? MAX_CANCELLATION_WORDS : MAX_ACTION_WORDS;
    if (countWords(message) > wordLimit) {
      setActionMessage(`Please keep details within ${wordLimit} words.`);
      return;
    }
    if (activeActionForm === "change") {
      await submitChangeRequest(title, message);
      return;
    }
    if (activeActionForm === "issue") {
      await submitIssueReport(title, message);
      return;
    }
    if (activeActionForm === "cancellation") {
      await submitCancellationRequest(title, message);
    }
  };

  const deleteAuditItem = async (entry: { id: string; kind: "CHANGE_REQUEST" | "ISSUE_REPORT" }) => {
    if (!id || !entry?.id) return;

    setDeletingAuditId(entry.id);
    setActionMessage(null);
    try {
      if (entry.kind === "CHANGE_REQUEST") {
        await api.delete(`/api/customer/tour-bookings/${encodeURIComponent(id)}/request-change/${encodeURIComponent(entry.id)}`);
      } else {
        await api.delete(`/api/customer/tour-bookings/${encodeURIComponent(id)}/report-issue/${encodeURIComponent(entry.id)}`);
      }
      const latest = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
      setItem(latest.data || null);
      setActionMessage("Request deleted successfully.");
      setPendingDeleteAudit(null);
    } catch (err: any) {
      setActionMessage(displayText(err?.response?.data?.error, "Failed to delete request."));
    } finally {
      setDeletingAuditId(null);
    }
  };

  const handleActionDraftChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    const wordLimit = activeActionForm === "cancellation" ? MAX_CANCELLATION_WORDS : MAX_ACTION_WORDS;
    const prevWordCount = countWords(actionDraft);
    const nextWordCount = countWords(nextValue);

    // Hard stop: once max words are reached, block any input that adds more words.
    if (prevWordCount >= wordLimit && nextWordCount > prevWordCount) {
      return;
    }
    if (nextWordCount > wordLimit) {
      return;
    }

    setActionDraft(nextValue);
  };

  const packageSnapshot = item?.packageSnapshot && typeof item.packageSnapshot === "object" ? item.packageSnapshot : {};
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};

  const listify = (value: any): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((v) => String(v || "").trim())
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(/[\n,;|]+/)
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  };

  const parseDurationDays = (value: any): number | null => {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const text = String(value || "").trim();
    if (!text) return null;
    const m = text.match(/(\d{1,3})/);
    if (!m) return null;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const roots = [
    packageSnapshot,
    (metadata as any)?.packageSnapshot,
    (metadata as any)?.tourPackage,
    (metadata as any)?.package,
  ].filter((v) => v && typeof v === "object") as any[];

  const firstNonEmpty = (...vals: any[]) => vals.find((v) => {
    if (Array.isArray(v)) return v.length > 0;
    return String(v || "").trim().length > 0;
  });
  const itinerary = (() => {
    const candidates = [
      (packageSnapshot as any)?.itinerary,
      (metadata as any)?.itinerary,
      (packageSnapshot as any)?.timelineDays,
      (metadata as any)?.timelineDays,
    ];
    return candidates.find((candidate) => Array.isArray(candidate)) || [];
  })();
  const inclusions = (() => {
    const raw = firstNonEmpty(
      ...roots.map((r) => r?.inclusions),
      ...roots.map((r) => r?.included),
      ...roots.map((r) => r?.includes)
    );
    return listify(raw);
  })();

  const exclusions = (() => {
    const raw = firstNonEmpty(
      ...roots.map((r) => r?.exclusions),
      ...roots.map((r) => r?.excluded)
    );
    return listify(raw);
  })();

  const airportMeetingPoint = (() => {
    const airport =
      (metadata as any)?.departureAirport ||
      (metadata as any)?.selectedAirport ||
      (metadata as any)?.airport ||
      (metadata as any)?.pickupAirport ||
      (metadata as any)?.flight?.departureAirport ||
      null;

    if (!airport) return null;
    if (typeof airport === "string") {
      const text = airport.trim();
      return text || null;
    }
    if (typeof airport === "object") {
      const a = airport as Record<string, any>;
      const text = String(
        a.shortLabel || a.label || a.iataCode || a.airport || a.airportName || a.city || ""
      ).trim();
      return text || null;
    }
    return null;
  })();

  const meetingPoints = (() => {
    const raw = firstNonEmpty(
      ...roots.map((r) => r?.meetingPoints),
      ...roots.map((r) => r?.meetingPoint),
      ...roots.map((r) => r?.departurePoint),
      airportMeetingPoint
    );
    return listify(raw);
  })();
  const packageDaysSource =
    parseDurationDays(firstNonEmpty(
      ...roots.map((r) => r?.durationDays),
      ...roots.map((r) => r?.packageDays),
      ...roots.map((r) => r?.days),
      ...roots.map((r) => r?.duration)
    )) ??
    (Array.isArray(itinerary) && itinerary.length > 0 ? itinerary.length : null);
  const packageDaysValue = Number(packageDaysSource);
  const packageDaysText = packageDaysValue
    && Number.isFinite(packageDaysValue)
    && packageDaysValue > 0
    ? `${packageDaysValue} day${packageDaysValue === 1 ? "" : "s"}`
    : "Not provided";
  const pickupValidation = (() => {
    if (item?.pickupValidation && typeof item.pickupValidation === "object") return item.pickupValidation;
    const mdValidation = item?.metadata?.pickupValidation;
    if (mdValidation && typeof mdValidation === "object") return mdValidation;
    return null;
  })();
  const pickupValidationOperator = (() => {
    const md = item?.metadata?.pickupValidationOperator;
    return md && typeof md === "object" ? md : null;
  })();
  const pickupValidated = Boolean(
    pickupValidation?.validated ||
    pickupValidation?.firstMeetValidated ||
    pickupValidationOperator?.validated ||
    pickupValidationOperator?.validatedAt ||
    item?.pickupTimeline?.validatedAt ||
    item?.metadata?.pickupTimeline?.validatedAt
  );
  const changeRequests = Array.isArray((item?.metadata as any)?.changeRequests)
    ? (item?.metadata as any).changeRequests
    : [];
  const issueReports = Array.isArray((item?.metadata as any)?.issueReports)
    ? (item?.metadata as any).issueReports
    : [];
  const cancellationCases = Array.isArray(item?.cases) ? item.cases : [];
  const activeCancellationCase = cancellationCases.find((tourCase: any) => !["WITHDRAWN", "CLOSED", "RESOLVED", "REJECTED"].includes(String(tourCase?.status || "").toUpperCase())) || null;
  const evidenceRequest = Array.isArray(activeCancellationCase?.events)
    ? activeCancellationCase.events.find((event: any) => String(event?.type || "").toUpperCase() === "REQUEST_EVIDENCE")
    : null;
  const activeCancellationDecision = Array.isArray(activeCancellationCase?.events)
    ? activeCancellationCase.events.find((event: any) => String(event?.type || "").toUpperCase() === "ELIGIBILITY_CALCULATED")?.data
    : null;

  const auditItems = [
    ...changeRequests.map((entry: any) => ({
      id: String(entry?.id || `change-${Math.random()}`),
      kind: "CHANGE_REQUEST" as const,
      title: String(entry?.title || "Untitled request"),
      message: String(entry?.message || "Change request"),
      status: String(entry?.status || "OPEN").toUpperCase(),
      createdAt: entry?.createdAt ? new Date(entry.createdAt) : null,
      severity: null as string | null,
      changeType: String(entry?.changeType || "GENERAL"),
      issueType: null as string | null,
    })),
    ...issueReports.map((entry: any) => ({
      id: String(entry?.id || `issue-${Math.random()}`),
      kind: "ISSUE_REPORT" as const,
      title: String(entry?.title || "Untitled issue"),
      message: String(entry?.message || "Issue report"),
      status: String(entry?.status || "OPEN").toUpperCase(),
      createdAt: entry?.createdAt ? new Date(entry.createdAt) : null,
      severity: String(entry?.severity || "MEDIUM"),
      changeType: null as string | null,
      issueType: String(entry?.issueType || "GENERAL"),
    })),
  ]
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
    .slice(0, 12);

  const statusToneClass = (status: string) => {
    const s = String(status || "").toUpperCase();
    if (["RESOLVED", "DONE", "CLOSED", "COMPLETED", "CHANGED", "IMPLEMENTED", "FIXED"].includes(s)) {
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    }
    if (["REJECTED", "DECLINED", "CANCELLED"].includes(s)) {
      return "bg-rose-100 text-rose-700 border-rose-200";
    }
    return "bg-amber-100 text-amber-700 border-amber-200";
  };

  const statusDisplayText = (status: string) => {
    const s = String(status || "").toUpperCase();
    if (["RESOLVED", "DONE", "CLOSED", "COMPLETED", "CHANGED", "IMPLEMENTED", "FIXED"].includes(s)) {
      return "Changed";
    }
    if (["REJECTED", "DECLINED", "CANCELLED"].includes(s)) {
      return "Not Changed";
    }
    return "Pending";
  };
  const dashboardBucket = String(item?.dashboardBucket || "").toUpperCase();
  const isDraft = dashboardBucket === "DRAFT";
  const isCompleted = dashboardBucket === "COMPLETED" || String(item?.status || "").toUpperCase() === "COMPLETED";
  const timelineTeam = item?.timelineTeam && typeof item.timelineTeam === "object" ? item.timelineTeam : {};
  const timelineJoinedTotal = Math.max(1, Number(timelineTeam.joinedTotal || 1));
  const timelineTotalTravellers = Math.max(1, Number(timelineTeam.totalTravellers || item?.travelerCount || 1));
  const timelineRemainingTravellers = Math.max(0, Number(timelineTeam.remainingTravellers || 0));
  const paymentResume = item?.paymentResume || null;
  const paymentTokenStatus = String(paymentResume?.paymentAccessTokenStatus || "").toUpperCase();
  const paymentRef = String(item?.paymentRef || item?.metadata?.paymentRef || "").trim();
  const paidAtValue = item?.paidAt ? new Date(item.paidAt).toLocaleString() : "Not yet paid";
  const paymentProviderRaw = String(
    item?.paymentProvider ||
    item?.metadata?.paymentProvider ||
    item?.metadata?.provider ||
    item?.metadata?.paymentMethod ||
    ""
  ).trim();
  const cardBrandRaw = String(
    item?.metadata?.cardBrand ||
    item?.metadata?.cardType ||
    ""
  ).trim();

  const paidViaText = (() => {
    const p = paymentProviderRaw.toUpperCase();
    const c = cardBrandRaw.toUpperCase();

    if (p.includes("VISA") || c.includes("VISA")) return "Card (VISA)";
    if (p.includes("MASTER") || c.includes("MASTER")) return "Card (MasterCard)";
    if (p.includes("BANK") || p.includes("TRANSFER")) return "Bank";
    if (
      p.includes("MOBILE") ||
      p.includes("M-PESA") ||
      p.includes("MPESA") ||
      p.includes("AIRTEL") ||
      p.includes("TIGO") ||
      p.includes("HALOPESA") ||
      p.includes("MIXX")
    ) {
      return "Mobile Money";
    }
    return paymentProviderRaw || "Not recorded";
  })();
  const hasPaymentEvidence = Boolean(item?.paidAt || paymentRef || paymentProviderRaw);
  const totalPaidText = hasPaymentEvidence
    ? `${item.currency} ${Number(item.grossAmount || 0).toLocaleString()}`
    : "Not yet paid";
  const paymentTokenExpiresAtMs = new Date(paymentResume?.paymentAccessTokenExpiresAt || "").getTime();
  const effectiveRemainingSeconds = remainingSeconds > 0
    ? remainingSeconds
    : paymentTokenStatus === "ACTIVE" && Number.isFinite(paymentTokenExpiresAtMs)
      ? Math.max(0, Math.floor((paymentTokenExpiresAtMs - Date.now()) / 1000))
      : 0;
  const canContinuePayment = Boolean(paymentResume?.paymentUrl) && effectiveRemainingSeconds > 0 && paymentTokenStatus !== "EXPIRED";
  const draftTokenExpired = isDraft && !canContinuePayment;
  const paymentStatusDisplay = (() => {
    const s = String(item?.paymentStatus || "UNPAID").trim().toUpperCase();
    if (["APPROVED", "PAID", "DISBURSED", "SETTLED"].includes(s)) return "PAID";
    return s || "UNPAID";
  })();

  useEffect(() => {
    if (!isDraft || !paymentResume?.paymentAccessTokenExpiresAt) {
      setRemainingSeconds(0);
      return;
    }
    const tick = () => {
      const end = new Date(paymentResume.paymentAccessTokenExpiresAt).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      setRemainingSeconds(remaining);
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [isDraft, paymentResume?.paymentAccessTokenExpiresAt]);

  const formatRemaining = (total: number) => {
    const s = Math.max(0, Math.floor(total));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-full overflow-x-hidden py-8 min-w-0">
      <div className="space-y-4 min-w-0">
        <Link
          href="/account/tour-packages"
          aria-label="Back to My Tour Packages"
          title="Back to My Tour Packages"
          className="inline-flex items-center text-sm text-teal-700 hover:text-teal-800 no-underline"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <section className="w-full max-w-full min-w-0 card overflow-hidden">
          <div className="card-section">
          {loading ? (
            <div className="space-y-4 animate-pulse" aria-hidden="true">
              <div className="h-8 w-2/5 rounded-lg bg-slate-200" />
              <div className="h-4 w-1/4 rounded bg-slate-200" />

              <div className="grid grid-cols-2 gap-3">
                <div className="h-20 rounded-xl border border-slate-200 bg-slate-100" />
                <div className="h-20 rounded-xl border border-slate-200 bg-slate-100" />
                <div className="h-20 rounded-xl border border-slate-200 bg-slate-100" />
                <div className="h-20 rounded-xl border border-slate-200 bg-slate-100" />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="h-4 w-36 rounded bg-slate-200" />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="h-24 rounded-xl border border-slate-200 bg-slate-100" />
                  <div className="h-24 rounded-xl border border-slate-200 bg-slate-100" />
                </div>
              </div>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : !item ? (
            <div className="text-sm text-slate-600">Package not found.</div>
          ) : (
            isDraft ? (
              <div className="space-y-5 min-w-0">
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-slate-900 break-words">{item.title}</h1>
                  <div className="text-sm text-slate-600 mt-1 break-all">Ref: {item.bookingCode}</div>
                </div>

                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
                        <Clock3 className="h-4 w-4" />
                        {draftTokenExpired ? "Payment Token Expired" : "Waiting For Payment"}
                      </div>
                      <div className="mt-1 text-xs text-amber-800">
                        Draft reservations expire 12 hours after they are created if payment is not completed.
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-300 bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-amber-700">Token status</div>
                      <div className="text-lg font-extrabold text-amber-900">
                        {draftTokenExpired ? "Expired" : formatRemaining(effectiveRemainingSeconds)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <Link
                      href={paymentResume?.paymentUrl || "#"}
                      aria-disabled={!canContinuePayment}
                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold no-underline ${
                        !canContinuePayment
                          ? "bg-slate-200 text-slate-500 pointer-events-none"
                          : "bg-teal-600 text-white hover:bg-teal-700"
                      }`}
                    >
                      <CreditCard className="h-4 w-4" />
                      {draftTokenExpired ? "Payment Link Expired" : "Continue Payment"}
                    </Link>
                    {draftTokenExpired ? (
                      <span className="text-xs text-rose-700">This draft payment window has expired. Create a new booking to proceed with payment.</span>
                    ) : (
                      <span className="text-xs text-slate-600">You can return here to continue your payment anytime before expiry.</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-indigo-50 p-3">
                    <div className="text-slate-500">Flow status</div>
                    <div className="font-semibold text-slate-900 mt-1">DRAFT</div>
                    <div className="text-xs font-medium text-slate-600 mt-1">{paymentStatusDisplay.replace(/_/g, " ")}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3">
                    <div className="text-slate-500">Amount to pay</div>
                    <div className="font-semibold text-slate-900 mt-1">{item.currency} {Number(item.grossAmount || 0).toLocaleString()}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Short Package Details</div>
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 divide-y divide-slate-200 bg-gradient-to-br from-white to-slate-50/80">
                      <div className="grid grid-cols-[130px_1fr] gap-3 px-3 py-2.5 text-sm">
                        <div className="text-slate-500 inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-teal-700" />Destination</div>
                        <div className="font-medium text-slate-900 break-words">{item.destination || "Not set"}</div>
                      </div>
                      <div className="grid grid-cols-[130px_1fr] gap-3 px-3 py-2.5 text-sm">
                        <div className="text-slate-500 inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-indigo-700" />Travelers</div>
                        <div className="font-medium text-slate-900">{Number(item.travelerCount || 0)}</div>
                      </div>
                      <div className="grid grid-cols-[130px_1fr] gap-3 px-3 py-2.5 text-sm">
                        <div className="text-slate-500 inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-indigo-700" />Travel date</div>
                        <div className="font-medium text-slate-900">{item.startDate ? new Date(item.startDate).toLocaleDateString() : "TBD"}</div>
                      </div>
                      <div className="grid grid-cols-[130px_1fr] gap-3 px-3 py-2.5 text-sm">
                        <div className="text-slate-500 inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-slate-700" />Created</div>
                        <div className="font-medium text-slate-900 break-words">{item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-sky-50 p-4 min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Experience Setup</div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3 min-w-0">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Inclusions</div>
                        {inclusions.length ? (
                          <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-800 list-none m-0 p-0">
                            {inclusions.map((inc: string, idx: number) => (
                              <li key={`${inc}-${idx}`} className="text-sm leading-5 break-words inline-flex items-start gap-1.5">
                                <Plus className="h-3.5 w-3.5 mt-0.5 text-emerald-700 shrink-0" />
                                <span>{inc}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1.5 text-slate-800">Not provided</div>
                        )}
                      </div>
                      <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-orange-50 p-3 min-w-0">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Exclusions</div>
                        {exclusions.length ? (
                          <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-800 list-none m-0 p-0">
                            {exclusions.map((exc: string, idx: number) => (
                              <li key={`${exc}-${idx}`} className="text-sm leading-5 break-words inline-flex items-start gap-1.5">
                                <Minus className="h-3.5 w-3.5 mt-0.5 text-rose-700 shrink-0" />
                                <span>{exc}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1.5 text-slate-800">Not provided</div>
                        )}
                      </div>
                      <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50 p-3 min-w-0">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Meeting points</div>
                        {meetingPoints.length ? (
                          <ul className="mt-1.5 space-y-1 text-slate-800 list-none m-0 p-0">
                            {meetingPoints.map((point: string, idx: number) => (
                              <li key={`${point}-${idx}`} className="text-sm leading-5 break-words inline-flex items-start gap-1.5">
                                <MapPin className="h-3.5 w-3.5 mt-0.5 text-teal-700 shrink-0" />
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1.5 text-slate-800">Not provided</div>
                        )}
                      </div>
                      <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-3 min-w-0">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Package days</div>
                        <div className="mt-1.5 text-slate-800 break-words inline-flex items-start gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5 mt-0.5 text-indigo-700 shrink-0" />
                          <span>{packageDaysText}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
            <div className="space-y-5 min-w-0">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-slate-900 break-words">{item.title}</h1>
                <div className="text-sm text-slate-600 mt-1 break-all">Ref: {item.bookingCode}</div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3">
                  <div className="text-slate-500">Payment status</div>
                  <div className="font-semibold text-slate-900 mt-1">{paymentStatusDisplay.replace(/_/g, " ")}</div>
                </div>
                <div className="rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-sky-50 p-3">
                  <div className="text-slate-500">Total paid</div>
                  <div className="font-semibold text-slate-900 mt-1">{totalPaidText}</div>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-3">
                  <div className="text-slate-500">Payment time</div>
                  <div className="font-semibold text-slate-900 mt-1">{paidAtValue}</div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-3">
                  <div className="text-slate-500">Paid ref</div>
                  <div className="font-semibold text-slate-900 mt-1 break-words">{paymentRef || "Not recorded"}</div>
                </div>
                <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 p-3">
                  <div className="text-slate-500">Paid via</div>
                  <div className="font-semibold text-slate-900 mt-1">{paidViaText}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div className="text-sm font-semibold text-slate-900">Quick Access</div>
                  <div className="text-[11px] text-slate-500">Open booking tools for this package</div>
                </div>
                <div className="grid grid-cols-1 gap-3 min-w-0 sm:grid-cols-3">
                  <Link
                    href={`/account/tour-packages/${encodeURIComponent(String(id))}/voucher`}
                    className="group rounded-xl border border-amber-200 bg-amber-50/60 p-3 no-underline text-slate-800 transition-all duration-150 hover:bg-amber-100 hover:border-amber-300 hover:shadow-sm active:scale-[0.99]"
                  >
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700">
                      <Ticket className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-base font-semibold text-slate-900">Voucher</div>
                    <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">View booking voucher details.</div>
                  </Link>

                  <Link
                    href={`/account/tour-packages/${encodeURIComponent(String(id))}/receipt`}
                    className="group rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 no-underline text-slate-800 transition-all duration-150 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm active:scale-[0.99]"
                  >
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700">
                      <Receipt className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-base font-semibold text-slate-900">Receipt</div>
                    <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">Open payment receipt summary.</div>
                  </Link>

                  <Link
                    href={`/account/tour-packages/${encodeURIComponent(String(id))}/timeline`}
                    className="group rounded-xl border border-sky-200 bg-sky-50/70 p-3 no-underline text-slate-800 transition-all duration-150 hover:bg-sky-100 hover:border-sky-300 hover:shadow-sm active:scale-[0.99]"
                  >
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-200 bg-white text-sky-700">
                      <CalendarDays className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-base font-semibold text-slate-900">Timeline</div>
                    <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">Open tour timetable tracking.</div>
                  </Link>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 min-w-0">
                <div className="text-sm font-semibold text-slate-900">Package Setup</div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 min-w-0">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Inclusions</div>
                    {inclusions.length ? (
                      <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700 list-none m-0 p-0">
                        {inclusions.map((inc: string, idx: number) => (
                          <li key={`${inc}-full-${idx}`} className="leading-5 break-words inline-flex items-start gap-1.5">
                            <Plus className="h-3.5 w-3.5 mt-0.5 text-emerald-700 shrink-0" />
                            <span>{inc}</span>
                          </li>
                        ))}
                      </ul>

                    ) : (
                      <div className="mt-2 text-sm text-slate-700">Not provided</div>
                    )}
                  </div>

                  <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 min-w-0">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Exclusions</div>
                    {exclusions.length ? (
                      <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700 list-none m-0 p-0">
                        {exclusions.map((exc: string, idx: number) => (
                          <li key={`${exc}-full-${idx}`} className="leading-5 break-words inline-flex items-start gap-1.5">
                            <Minus className="h-3.5 w-3.5 mt-0.5 text-rose-700 shrink-0" />
                            <span>{exc}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-sm text-slate-700">Not provided</div>
                    )}
                  </div>

                  <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3 min-w-0">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Meeting Points</div>
                    {meetingPoints.length ? (
                      <ul className="mt-2 space-y-1 text-sm text-slate-700 list-none m-0 p-0">
                        {meetingPoints.map((point: string, idx: number) => (
                          <li key={`${point}-full-${idx}`} className="leading-5 break-words inline-flex items-start gap-1.5">
                            <MapPin className="h-3.5 w-3.5 mt-0.5 text-teal-700 shrink-0" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-sm text-slate-700">Not provided</div>
                    )}
                  </div>

                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 min-w-0">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Package Days</div>
                    <div className="mt-2 text-sm text-slate-700 inline-flex items-start gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 mt-0.5 text-indigo-700 shrink-0" />
                      <span>{packageDaysText}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-w-0 overflow-hidden rounded-2xl border border-teal-700 bg-[#02665e] bg-[linear-gradient(135deg,rgba(255,255,255,0.18)_12.5%,transparent_12.5%,transparent_50%,rgba(255,255,255,0.18)_50%,rgba(255,255,255,0.18)_62.5%,transparent_62.5%,transparent_100%)] [background-size:18px_18px] p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold text-white">Timeline</div>
                    <div className="mt-1 text-xs text-teal-50">Tour timetable tracking is separated into its own workspace.</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-teal-700 shadow-sm">
                      <Users className="h-3.5 w-3.5" />
                      {timelineJoinedTotal}/{timelineTotalTravellers} joined
                    </span>
                    {pickupValidated ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Meetup validated
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 shadow-sm">
                        <Clock3 className="h-3.5 w-3.5" />
                        Locked until meetup
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div className="min-w-0 rounded-xl border border-white/30 bg-white px-3 py-2 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team Access</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {timelineJoinedTotal} of {timelineTotalTravellers} traveller{timelineTotalTravellers === 1 ? "" : "s"} connected
                        </div>
                      </div>
                      <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700">
                        {timelineRemainingTravellers} slot{timelineRemainingTravellers === 1 ? "" : "s"} left
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-teal-600"
                        style={{ width: `${Math.min(100, Math.max(0, (timelineJoinedTotal / timelineTotalTravellers) * 100))}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      One timeline share link is kept for this package. Copy it any time for the remaining declared travellers.
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-2">
                    {pickupValidated ? (
                      <button
                        type="button"
                        onClick={createTimelineInvite}
                        disabled={shareLoading}
                        aria-label={timelineInviteUrl ? "Copy timeline invite" : "Create timeline invite"}
                        title={timelineInviteUrl ? "Copy timeline invite" : "Create timeline invite"}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/30 bg-white text-teal-700 shadow-sm transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {shareLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                      </button>
                    ) : null}
                    <Link
                      href={`/account/tour-packages/${encodeURIComponent(String(id))}/timeline`}
                      className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white px-4 py-2 text-sm font-semibold text-teal-700 no-underline shadow-sm hover:bg-teal-50"
                    >
                      Open Timeline
                    </Link>
                  </div>
                </div>
                {(shareMessage || timelineInviteUrl) ? (
                  <div className="mt-3 rounded-xl border border-white/30 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
                    {shareMessage ? <div className="font-medium text-slate-700">{shareMessage}</div> : null}
                    {timelineInviteUrl ? (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">
                          {timelineInviteUrl}
                        </div>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(`Join our tour timeline on NoLSAF: ${timelineInviteUrl}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Share timeline invite on WhatsApp"
                          title="Share on WhatsApp"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 no-underline hover:bg-emerald-100"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                            <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.512 5.26l-.999 3.648 3.476-.911zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                          </svg>
                        </a>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!navigator.clipboard?.writeText) return;
                            await navigator.clipboard.writeText(timelineInviteUrl);
                            setShareMessage("Timeline invite copied.");
                          }}
                          aria-label="Copy timeline invite"
                          title="Copy timeline invite"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                {String(item?.status || "").toUpperCase() === "OPERATOR_COMPLETED" && (
                  <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div><div className="text-sm font-bold text-emerald-900">Operator marked the tour complete</div><p className="mt-1 text-xs text-emerald-800">Confirm only if the agreed package was delivered. If something is unresolved, report an issue instead; an open case will hold completion and payout.</p></div>
                      <button type="button" onClick={() => void confirmTourCompletion()} disabled={completionLoading} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{completionLoading ? "Confirming…" : "Confirm Tour Completion"}</button>
                    </div>
                  </div>
                )}
                {activeCancellationCase ? (
                  <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
                    <div className="flex flex-col gap-3 border-b border-amber-100 bg-amber-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">Cancellation case #{activeCancellationCase.id}</div>
                        <h2 className="mt-1 text-lg font-bold text-slate-950">Your request is being reviewed</h2>
                      </div>
                      <span className="inline-flex w-fit rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-bold text-amber-900">{String(activeCancellationCase.status || "UNDER_REVIEW").replaceAll("_", " ")}</span>
                    </div>
                    <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                        <div className="text-sm font-bold text-amber-950">{evidenceRequest ? "Action required: upload supporting evidence" : "No action is needed from you right now"}</div>
                        <p className="mt-2 text-sm leading-relaxed text-amber-900">{evidenceRequest ? displayText(evidenceRequest.message, "Upload the requested files so NoLSAF can continue the review.") : "We have received your cancellation request. NoLSAF will update this case after the policy and operator costs are reviewed."}</p>
                        {evidenceRequest && <Link href={`/account/tour-packages/${encodeURIComponent(String(id))}/documents?caseId=${activeCancellationCase.id}`} className="mt-4 inline-flex rounded-lg bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-[#014d47]">Upload evidence</Link>}
                      </div>
                      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                        <div><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Submitted</div><div className="mt-1 font-semibold text-slate-900">{activeCancellationCase.createdAt ? new Date(activeCancellationCase.createdAt).toLocaleString() : "Recorded"}</div></div>
                        <div><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Policy result</div><div className="mt-1 font-semibold text-slate-900">{activeCancellationDecision?.eligibilityCode || "Manual review"}</div></div>
                        <div><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Provisional refund</div><div className="mt-1 font-semibold text-slate-900">{Number(activeCancellationDecision?.refundPercent || 0)}% · {Number(activeCancellationDecision?.estimatedRefundAmount || 0).toLocaleString()} {item?.currency || "TZS"}</div></div>
                      </div>
                    </div>
                    <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">Your booking remains active until NoLSAF makes a final decision. Updates and uploaded evidence remain linked to this case.</div>
                  </section>
                ) : (
                  <>
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Booking support</h2>
                    <p className="mt-1 text-sm text-slate-600">Choose the option that best matches what you need.</p>
                  </div>
                  <p className="text-xs text-slate-500">Requests are saved in your activity history.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Link
                    href={`/account/tour-packages/${encodeURIComponent(String(id))}/documents`}
                    className="group min-h-24 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 no-underline transition-all duration-150 hover:-translate-y-px hover:border-teal-300 hover:bg-teal-50/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                  >
                    <span className="block text-sm font-semibold text-slate-900">Documents <span className="text-slate-500">({uploadedDocsCount})</span></span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-600">Upload passports, permits, or required files.</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => openActionForm("change")}
                    disabled={actionLoading}
                    className="min-h-24 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-all duration-150 hover:-translate-y-px hover:border-teal-300 hover:bg-teal-50/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none"
                  >
                    <span className="block text-sm font-semibold text-slate-900">Request a change</span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-600">Update dates, travellers, pickup, or itinerary details.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openActionForm("issue")}
                    disabled={actionLoading}
                    className="min-h-24 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-all duration-150 hover:-translate-y-px hover:border-rose-300 hover:bg-rose-50/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none"
                  >
                    <span className="block text-sm font-semibold text-slate-900">Report an issue</span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-600">Tell us about a service, timing, or communication problem.</span>
                  </button>
                  {activeCancellationCase ? (
                    evidenceRequest ? (
                      <Link
                        href={`/account/tour-packages/${encodeURIComponent(String(id))}/documents?caseId=${activeCancellationCase.id}`}
                        className="min-h-24 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 no-underline transition-all duration-150 hover:-translate-y-px hover:border-amber-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/30"
                      >
                        <span className="block text-sm font-semibold text-amber-950">Upload requested evidence</span>
                        <span className="mt-1 block text-xs leading-relaxed text-amber-800">Case #{activeCancellationCase.id} is waiting for the files requested by NoLSAF.</span>
                      </Link>
                    ) : (
                      <div className="min-h-24 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
                        <span className="block text-sm font-semibold text-amber-950">Cancellation in review</span>
                        <span className="mt-1 block text-xs leading-relaxed text-amber-800">Case #{activeCancellationCase.id} is already submitted. You cannot submit another request.</span>
                      </div>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => openActionForm("cancellation")}
                      disabled={actionLoading || ["CANCELED", "REFUNDED", "COMPLETED"].includes(String(item?.status || "").toUpperCase())}
                      className="min-h-24 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-left transition-all duration-150 hover:-translate-y-px hover:border-amber-300 hover:bg-amber-50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none"
                    >
                      <span className="block text-sm font-semibold text-amber-950">Request cancellation</span>
                      <span className="mt-1 block text-xs leading-relaxed text-amber-800">Check the tour policy and submit a cancellation request.</span>
                    </button>
                  )}
                </div>
                  </>
                )}
                {activeActionForm && !(activeActionForm === "cancellation" && activeCancellationCase) && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-sm font-semibold text-slate-900">
                      {activeActionForm === "change" ? "Request A Change" : activeActionForm === "issue" ? "Report An Issue" : "Request Tour Cancellation"}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {activeActionForm === "change"
                        ? "Tell the operator what should be updated in your package."
                        : activeActionForm === "issue"
                          ? "Describe the issue clearly so the operator can resolve it quickly."
                          : "Your eligibility and provisional refund will be calculated immediately. The booking stays active until NoLSAF approves it."}
                    </div>

                    <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                        <label className="text-xs font-medium text-slate-700">Title</label>
                        <input
                          type="text"
                          value={actionTitle}
                          onChange={(e) => setActionTitle(e.target.value)}
                          placeholder={activeActionForm === "change" ? "Example: Change pickup time" : activeActionForm === "issue" ? "Example: Delay at meetup point" : "Example: Medical emergency"}
                          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        />
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                        <label className="text-xs font-medium text-slate-700">
                          {activeActionForm === "change" ? "Type of request" : "Type of issue"}
                        </label>
                        {activeActionForm === "change" ? (
                          <select
                            value={changeType}
                            onChange={(e) => setChangeType(e.target.value as any)}
                            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                          >
                            <option value="GENERAL">General</option>
                            <option value="DATE_CHANGE">Date Change</option>
                            <option value="TRAVELERS">Traveler Count</option>
                            <option value="DOCUMENTS">Documents</option>
                            <option value="PICKUP">Pickup/Meetup</option>
                            <option value="ITINERARY">Itinerary</option>
                            <option value="OTHER">Other</option>
                          </select>
                        ) : activeActionForm === "issue" ? (
                          <select
                            value={issueType}
                            onChange={(e) => setIssueType(e.target.value as any)}
                            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                          >
                            <option value="GENERAL">General</option>
                            <option value="SERVICE">Service Quality</option>
                            <option value="TIMING">Timing/Delay</option>
                            <option value="PICKUP">Pickup/Meetup</option>
                            <option value="DOCUMENTS">Documents</option>
                            <option value="PAYMENT">Payment</option>
                            <option value="COMMUNICATION">Communication</option>
                            <option value="OTHER">Other</option>
                          </select>
                        ) : <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Reason category is taken from the title. Supporting evidence can be requested during review.</div>}
                      </div>
                    </div>

                    {activeActionForm === "issue" && (
                      <div className="mt-3">
                        <label className="text-xs font-medium text-slate-700">Severity</label>
                        <select
                          value={issueSeverity}
                          onChange={(e) => setIssueSeverity(e.target.value as "LOW" | "MEDIUM" | "HIGH")}
                          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        >
                          <option value="LOW">Low</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HIGH">High</option>
                        </select>
                      </div>
                    )}

                    <div className="mt-3">
                      <label className="text-xs font-medium text-slate-700">
                        {activeActionForm === "change" ? "Change details" : activeActionForm === "issue" ? "Issue details" : "Cancellation reason"}
                      </label>
                      <textarea
                        rows={4}
                        value={actionDraft}
                        onChange={handleActionDraftChange}
                        placeholder={activeActionForm === "change" ? "Describe what should be changed (max 30 words)..." : activeActionForm === "issue" ? "Describe the issue (max 30 words)..." : "Explain why you need to cancel (max 30 words)..."}
                        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                      />
                      <div className="mt-1 text-[11px] text-slate-500">
                        {countWords(actionDraft)}/{activeActionForm === "cancellation" ? MAX_CANCELLATION_WORDS : MAX_ACTION_WORDS} words
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={closeActionForm}
                        disabled={actionLoading}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={submitActiveAction}
                        disabled={actionLoading}
                        className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                      >
                        {actionLoading ? "Sending..." : activeActionForm === "change" ? "Send Request" : activeActionForm === "issue" ? "Submit Issue" : "Calculate & Submit"}
                      </button>
                    </div>
                  </div>
                )}
                {actionMessage && (
                  <div role="status" className="mt-4 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3">
                    <div className="text-sm font-semibold text-teal-950">Request update</div>
                    <p className="mt-1 text-sm leading-relaxed text-teal-900">{actionMessage}</p>
                  </div>
                )}
                {cancellationCases.length > 0 && !activeCancellationCase && (
                  <div className="mt-3 space-y-2">
                    {cancellationCases.map((tourCase: any) => {
                      const events = Array.isArray(tourCase?.events) ? tourCase.events : [];
                      const decision = events.find((event: any) => String(event?.type).toUpperCase() === "ELIGIBILITY_CALCULATED")?.data;
                      const status = String(tourCase.status || "OPEN").toUpperCase();
                      const outcome = [...events].reverse().find((event: any) => ["REJECT", "APPROVE_CANCELLATION", "RECORD_REFUND"].includes(String(event?.type || "").toUpperCase()));
                      const tone = status === "RESOLVED"
                        ? { card: "border-emerald-200 bg-emerald-50/60 text-emerald-950", badge: "border-emerald-300 text-emerald-900", label: "Refunded", footer: "The refund for this booking has been recorded." }
                        : status === "REJECTED"
                          ? { card: "border-rose-200 bg-rose-50/60 text-rose-950", badge: "border-rose-300 text-rose-900", label: "Rejected", footer: "This request was declined. Your booking remains active." }
                          : { card: "border-slate-200 bg-slate-50 text-slate-800", badge: "border-slate-300 text-slate-700", label: status.replaceAll("_", " "), footer: "This case is closed." };
                      return (
                        <div key={tourCase.id} className={`rounded-xl border p-3 text-xs ${tone.card}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold">Cancellation case #{tourCase.id}</span>
                            <span className={`rounded-full border bg-white px-2 py-0.5 font-semibold ${tone.badge}`}>{tone.label}</span>
                          </div>
                          <p className="mt-2 leading-relaxed">{decision?.reason || tourCase.description}</p>
                          {outcome?.message && (
                            <div className="mt-2 rounded-lg border border-white bg-white/80 px-3 py-2">
                              <div className="font-semibold">NoLSAF decision</div>
                              <p className="mt-1 leading-relaxed">{displayText(outcome.message, "This case is closed.")}</p>
                            </div>
                          )}
                          <p className="mt-2 opacity-80">{tone.footer}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Activity history</div>
                  <div className="mt-0.5 text-xs text-slate-500">Track your change and issue requests.</div>

                  {pendingDeleteAudit && (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                      <div className="text-sm font-semibold text-rose-800">Delete Request</div>
                      <div className="mt-1 text-xs text-rose-700">
                        Are you sure you want to delete this request from your audit flow?
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setPendingDeleteAudit(null)}
                          disabled={Boolean(deletingAuditId)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAuditItem(pendingDeleteAudit)}
                          disabled={Boolean(deletingAuditId)}
                          className="rounded-lg border border-rose-300 bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {deletingAuditId ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  )}

                  {auditItems.length === 0 ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      No change requests or issue reports yet.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {auditItems.map((entry) => (
                        <div key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="text-xs font-semibold text-slate-800">{entry.title}</div>
                            <div className="inline-flex items-center gap-2">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusToneClass(entry.status)}`}>
                                {statusDisplayText(entry.status)}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteAudit({ id: entry.id, kind: entry.kind })}
                                disabled={deletingAuditId === entry.id}
                                title="Delete request"
                                aria-label="Delete request"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {deletingAuditId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {entry.kind === "CHANGE_REQUEST" ? "Change Request" : "Issue Report"}
                          </div>
                          <div className="mt-1 text-xs text-slate-700 break-words">{entry.message}</div>
                          <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                            <span>{entry.createdAt ? entry.createdAt.toLocaleString() : "Time unavailable"}</span>
                            {entry.changeType ? <span>Type: {entry.changeType}</span> : null}
                            {entry.issueType ? <span>Category: {entry.issueType}</span> : null}
                            {entry.severity ? <span>Severity: {entry.severity}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </div>
            )
          )}
          </div>
        </section>

        {!loading && !error && item && isCompleted ? (
          <AgentReviewSection bookingId={id} />
        ) : null}
      </div>
    </div>
  );
}

type ReviewData = {
  punctualityRating: number;
  customerCareRating: number;
  communicationRating: number;
  comment?: string | null;
  createdAt?: string;
};

const REVIEW_DIMENSIONS: Array<{ key: "punctualityRating" | "customerCareRating" | "communicationRating"; label: string; hint: string }> = [
  { key: "punctualityRating", label: "Punctuality", hint: "On time for pickups & activities" },
  { key: "customerCareRating", label: "Customer care", hint: "Attentive and helpful throughout" },
  { key: "communicationRating", label: "Communication", hint: "Clear and responsive" },
];

function StarRating({
  value,
  onChange,
  readOnly = false,
}: {
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= value;
        return (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            onClick={readOnly ? undefined : () => onChange?.(star)}
            aria-label={`${star} star${star > 1 ? "s" : ""}`}
            className={`${readOnly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
          >
            <Star
              className={`h-6 w-6 ${active ? "fill-amber-400 text-amber-400" : "fill-transparent text-slate-300"}`}
            />
          </button>
        );
      })}
    </div>
  );
}

function AgentReviewSection({ bookingId }: { bookingId: string }) {
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({
    punctualityRating: 0,
    customerCareRating: 0,
    communicationRating: 0,
  });
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(bookingId)}/agent-review`);
        if (!alive) return;
        setEligible(!!res.data?.eligible);
        setReview(res.data?.review ?? null);
      } catch {
        if (alive) setEligible(false);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookingId]);

  const allRated = REVIEW_DIMENSIONS.every((d) => scores[d.key] >= 1);

  async function submit() {
    if (!allRated || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.post(`/api/customer/tour-bookings/${encodeURIComponent(bookingId)}/agent-review`, {
        punctualityRating: scores.punctualityRating,
        customerCareRating: scores.customerCareRating,
        communicationRating: scores.communicationRating,
        comment: comment.trim() || undefined,
      });
      setReview(res.data?.review ?? null);
    } catch (err: any) {
      const code = String(err?.response?.data?.error || "");
      if (code === "already_reviewed") {
        setErrorMsg("You have already reviewed this trip.");
      } else {
        setErrorMsg(String(err?.response?.data?.message || "Could not submit your review. Please try again."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="card overflow-hidden">
        <div className="card-section">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
        </div>
      </section>
    );
  }

  if (!eligible && !review) return null;

  return (
    <section className="card overflow-hidden">
      <div className="card-section space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Rate your operator</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {review
              ? "Thanks for your feedback — here's the review you left."
              : "Your honest rating helps other travellers and recognises great operators."}
          </p>
        </div>

        {review ? (
          <div className="space-y-3">
            {REVIEW_DIMENSIONS.map((d) => (
              <div key={d.key} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">{d.label}</span>
                <StarRating value={(review as any)[d.key]} readOnly />
              </div>
            ))}
            {review.comment ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                “{review.comment}”
              </p>
            ) : null}
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Review submitted
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {REVIEW_DIMENSIONS.map((d) => (
              <div key={d.key} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-slate-800">{d.label}</div>
                  <div className="text-xs text-slate-500">{d.hint}</div>
                </div>
                <StarRating value={scores[d.key]} onChange={(v) => setScores((s) => ({ ...s, [d.key]: v }))} />
              </div>
            ))}

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 1000))}
              placeholder="Add a comment (optional)"
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
            />

            {errorMsg ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMsg}</div>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={!allRated || submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
              Submit review
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
