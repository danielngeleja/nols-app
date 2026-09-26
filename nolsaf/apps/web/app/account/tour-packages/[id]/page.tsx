"use client";

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  CreditCard,
  FileCheck2,
  FileText,
  Loader2,
  MapPin,
  Minus,
  PenLine,
  Receipt,
  Route,
  Share2,
  Star,
  Ticket,
  Trash2,
  XCircle,
} from "lucide-react";

const api = apiClient;
const MAX_ACTION_WORDS = 30;
const MAX_CANCELLATION_WORDS = 120;
const MIN_CANCELLATION_WORDS = 5;

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
  const router = useRouter();
  const id = String(params?.id || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activeActionForm, setActiveActionForm] = useState<"change" | "issue" | "cancellation" | null>(null);
  const [actionTitle, setActionTitle] = useState("");
  const [actionDraft, setActionDraft] = useState("");
  const [cancellationReviewOpen, setCancellationReviewOpen] = useState(false);
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
  const [withdrawingCaseId, setWithdrawingCaseId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
        if (!alive) return;
        const nextItem = res.data || null;
        setItem(nextItem);
        if (/^\d+$/.test(id) && nextItem?.tourReference) {
          router.replace(`/account/tour-packages/${encodeURIComponent(nextItem.tourReference)}`);
        }
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
  }, [id, router]);

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

  const withdrawCancellation = async (caseId: number) => {
    if (!id || withdrawingCaseId) return;
    setWithdrawingCaseId(caseId);
    setActionMessage(null);
    try {
      await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/cases/${caseId}/withdraw`, {});
      const latest = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
      setItem(latest.data || null);
      setActionMessage("Your cancellation request was withdrawn. Your booking stays active.");
    } catch (err: any) {
      setActionMessage(displayText(err?.response?.data?.error, "Could not withdraw the request. Please try again."));
    } finally {
      setWithdrawingCaseId(null);
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
    setCancellationReviewOpen(false);
  };

  const closeActionForm = () => {
    if (actionLoading) return;
    setActiveActionForm(null);
    setActionTitle("");
    setActionDraft("");
    setCancellationReviewOpen(false);
  };

  const confirmTourCompletion = async () => {
    if (!id || completionLoading) return;
    setCompletionLoading(true);
    setActionMessage(null);
    try {
      await api.post(`/api/customer/tour-bookings/${encodeURIComponent(id)}/confirm-completion`);
      const latest = await api.get(`/api/customer/tour-bookings/${encodeURIComponent(id)}`);
      setItem(latest.data || null);
      setActionMessage("Tour completion confirmed. Thank you, your review is now available.");
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
      if (countWords(message) < MIN_CANCELLATION_WORDS) {
        setActionMessage(`Please explain your reason in at least ${MIN_CANCELLATION_WORDS} words.`);
        return;
      }
      if (!cancellationReviewOpen) {
        setActionMessage(null);
        setCancellationReviewOpen(true);
        return;
      }
      await submitCancellationRequest(title, message);
      setCancellationReviewOpen(false);
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
  // The payment status is the source of truth. A booking marked paid must never
  // read "Not yet paid" just because the timestamp or reference was not stored.
  const statusSaysPaid = ["APPROVED", "PAID", "DISBURSED", "SETTLED"].includes(String(item?.paymentStatus || "").trim().toUpperCase());
  const paidAtValue = item?.paidAt ? new Date(item.paidAt).toLocaleString() : statusSaysPaid ? "Not recorded" : "Not yet paid";
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
  const hasPaymentEvidence = Boolean(statusSaysPaid || item?.paidAt || paymentRef || paymentProviderRaw);
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

  // ── Presentation model ────────────────────────────────────────────────
  const detailBase = `/account/tour-packages/${encodeURIComponent(String(id))}`;
  const operatorName = String(item?.operatorSnapshot?.companyName || "").trim() || null;
  const amountText = `${item?.currency || ""} ${Number(item?.grossAmount || 0).toLocaleString("en-US")}`.trim();
  const placeCode = (() => {
    const letters = String(item?.destination || item?.title || "").replace(/[^A-Za-z]/g, "");
    return (letters.slice(0, 3) || "TRP").toUpperCase();
  })();
  const daysToStart = item?.startDate ? Math.round((dayStart(item.startDate) - dayStart(Date.now())) / 86_400_000) : null;
  const tourStage: "DRAFT" | "EXPIRED" | "UPCOMING" | "ON_TOUR" | "COMPLETED" = isDraft
    ? (draftTokenExpired ? "EXPIRED" : "DRAFT")
    : isCompleted
      ? "COMPLETED"
      : dashboardBucket === "ACTIVE_TIMELINE"
        ? "ON_TOUR"
        : "UPCOMING";
  const journeyReached = tourStage === "DRAFT" || tourStage === "EXPIRED" ? 0 : tourStage === "UPCOMING" ? (pickupValidated ? 2 : 1) : tourStage === "ON_TOUR" ? 3 : 4;
  const heroStatus = (() => {
    if (tourStage === "EXPIRED") return "Payment window closed";
    if (tourStage === "DRAFT") return "Awaiting payment";
    if (tourStage === "ON_TOUR") return "On tour now";
    if (tourStage === "COMPLETED") return "Trip completed";
    if (daysToStart == null) return "Paid · date to be confirmed";
    if (daysToStart < 0) return pickupValidated ? "Meetup done · itinerary opening" : "Start date passed";
    if (daysToStart === 0) return "Paid · departs today";
    if (daysToStart === 1) return "Paid · departs tomorrow";
    return `Paid · departs in ${daysToStart} days`;
  })();
  const isPaid = paymentStatusDisplay === "PAID";
  const supportLocked = ["CANCELED", "REFUNDED", "COMPLETED"].includes(String(item?.status || "").toUpperCase());

  return (
    <div id="tour-detail-page" className="w-full min-w-0 space-y-5">
      <style>{DETAIL_BOX_SIZING}</style>

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/account/tour-packages"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 no-underline shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-[#02665e] hover:text-[#02665e]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          My tours
        </Link>
        {item?.bookingCode ? <span className="min-w-0 truncate font-mono text-[12px] text-slate-400">{item.bookingCode}</span> : null}
      </div>

      {loading ? (
        <div className="space-y-5" aria-busy="true">
          <span role="status" className="sr-only">Loading your trip</span>
          <div className="h-64 rounded-3xl bg-[#02665e]/15" />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-5">
              <div className="h-40 rounded-3xl border border-solid border-slate-200 bg-white" />
              <div className="h-56 rounded-3xl border border-solid border-slate-200 bg-white" />
            </div>
            <div className="h-72 rounded-3xl border border-solid border-slate-200 bg-white" />
          </div>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : !item ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-sm text-slate-500">We could not find this trip.</div>
      ) : (
        <>
          {/* ── Trip pass ── */}
          <section
            aria-label="Trip summary"
            className={`relative overflow-hidden rounded-3xl ${isDraft ? "border border-solid border-amber-300 bg-white text-slate-900" : "text-white shadow-[0_24px_48px_-30px_rgba(2,102,94,0.9)]"}`}
            style={isDraft ? undefined : { backgroundColor: BRAND }}
          >
            <div className="grid md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0 p-5 sm:p-7">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                    isDraft
                      ? tourStage === "EXPIRED" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"
                      : "bg-white/15 text-white"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isDraft ? (tourStage === "EXPIRED" ? "bg-rose-500" : "bg-amber-500") : "bg-white"}`} aria-hidden />
                  {heroStatus}
                </span>

                <div className="mt-4 flex items-end gap-3 sm:gap-4">
                  <span className={`text-[40px] font-black leading-none tracking-[0.08em] sm:text-[56px] ${isDraft ? "text-[#02665e]" : "text-white"}`}>{placeCode}</span>
                  <div className="min-w-0 pb-1">
                    <h1 className={`m-0 break-words text-[20px] font-bold leading-tight sm:text-[24px] ${isDraft ? "text-slate-900" : "text-white"}`}>{item.title}</h1>
                    {item.destination || operatorName ? (
                      <p className={`m-0 mt-0.5 text-[13px] ${isDraft ? "text-slate-500" : "text-white/70"}`}>
                        {[item.destination, operatorName ? `with ${operatorName}` : null].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </div>

                <dl className="m-0 mt-6 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
                  {[
                    { label: "Depart", value: item.startDate ? new Date(item.startDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "To confirm" },
                    { label: "Duration", value: packageDaysValue > 0 ? packageDaysText : "To confirm" },
                    { label: "Travellers", value: String(Number(item.travelerCount || 0)) },
                    { label: "Meet at", value: meetingPoints[0] || "To confirm" },
                  ].map((fact) => (
                    <div key={fact.label} className="min-w-0">
                      <dt className={`text-[10.5px] font-bold uppercase tracking-[0.12em] ${isDraft ? "text-slate-400" : "text-white/55"}`}>{fact.label}</dt>
                      <dd className={`m-0 mt-1 truncate text-[15px] font-bold ${isDraft ? "text-slate-900" : "text-white"}`} title={fact.value}>{fact.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-6">
                  <JourneySteps reached={journeyReached} onBrand={!isDraft} blocked={tourStage === "EXPIRED"} />
                </div>
              </div>

              {/* Stub */}
              <div
                className={`relative flex flex-wrap items-center justify-between gap-4 border-0 border-t-2 border-dashed px-5 py-4 md:flex-col md:flex-nowrap md:justify-center md:border-l-2 md:border-t-0 md:p-6 md:text-center ${
                  isDraft ? "border-amber-200 bg-amber-50/40" : "border-white/25"
                }`}
              >
                {!isDraft ? (
                  <>
                    <span aria-hidden className="absolute -top-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-neutral-50 md:block" />
                    <span aria-hidden className="absolute -bottom-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-neutral-50 md:block" />
                  </>
                ) : null}
                {isDraft ? (
                  <>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700">{draftTokenExpired ? "Payment window" : "Pay within"}</div>
                      <div className={`mt-1 text-[30px] font-black leading-none tabular-nums md:text-[34px] ${draftTokenExpired ? "text-rose-600" : "text-slate-900"}`}>
                        {draftTokenExpired ? "Closed" : formatRemaining(effectiveRemainingSeconds)}
                      </div>
                      <div className="mt-1.5 text-[13px] font-semibold text-slate-600">{amountText} due</div>
                    </div>
                    <Link
                      href={paymentResume?.paymentUrl || "#"}
                      aria-disabled={!canContinuePayment}
                      className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-5 text-[13px] font-bold no-underline transition-colors md:w-full ${
                        canContinuePayment ? "bg-amber-500 text-white hover:bg-amber-600" : "pointer-events-none bg-slate-200 text-slate-500"
                      }`}
                    >
                      <CreditCard className="h-4 w-4" aria-hidden />
                      {draftTokenExpired ? "Link expired" : "Continue payment"}
                    </Link>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">{isPaid ? "Paid in full" : paymentStatusDisplay.replace(/_/g, " ").toLowerCase()}</div>
                      <div className="mt-1 text-[26px] font-black leading-none tabular-nums text-white md:text-[30px]">{Number(item.grossAmount || 0).toLocaleString("en-US")}</div>
                      <div className="mt-1 text-[12px] font-semibold text-white/70">{item.currency}</div>
                    </div>
                    <Link
                      href={`${detailBase}/timeline`}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-white px-5 text-[13px] font-bold text-[#02665e] no-underline transition-colors hover:bg-white/90 md:w-full"
                    >
                      <Route className="h-4 w-4" aria-hidden />
                      {tourStage === "ON_TOUR" ? "Live itinerary" : "Itinerary"}
                    </Link>
                  </>
                )}
              </div>
            </div>
          </section>

          {isDraft ? (
            /* ── Awaiting payment ── */
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
              <div className="min-w-0 space-y-5">
                <p className="m-0 rounded-2xl border border-solid border-amber-200 bg-amber-50/60 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
                  {draftTokenExpired
                    ? "This payment window has closed. Book the tour again to secure your places."
                    : "Draft reservations are held for 12 hours. Complete payment before the timer ends to confirm your places with the operator."}
                </p>
                <PackagePanel inclusions={inclusions} exclusions={exclusions} meetingPoints={meetingPoints} packageDaysText={packageDaysText} />
              </div>
              <aside className="min-w-0">
                <Panel title="Booking summary">
                  <dl className="m-0 divide-y divide-solid divide-slate-200 [&>*]:border-x-0">
                    <SummaryRow label="Status" value={<StatusChip tone="amber">{paymentStatusDisplay.replace(/_/g, " ").toLowerCase()}</StatusChip>} />
                    <SummaryRow label="Amount due" value={<span className="font-bold text-slate-900">{amountText}</span>} />
                    <SummaryRow label="Destination" value={item.destination || "Not set"} />
                    <SummaryRow label="Travellers" value={String(Number(item.travelerCount || 0))} />
                    <SummaryRow label="Travel date" value={item.startDate ? new Date(item.startDate).toLocaleDateString() : "To confirm"} />
                    <SummaryRow label="Booked" value={item.createdAt ? new Date(item.createdAt).toLocaleString() : "Not recorded"} />
                  </dl>
                </Panel>
              </aside>
            </div>
          ) : (
            /* ── Paid trip ── */
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
              <div className="min-w-0 space-y-5">
                {String(item?.status || "").toUpperCase() === "OPERATOR_COMPLETED" ? (
                  <section className="flex flex-col gap-3 rounded-3xl border border-solid border-emerald-200 bg-emerald-50 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="m-0 text-[15px] font-bold text-emerald-950">Your operator marked the tour complete</h2>
                      <p className="m-0 mt-1 text-[13px] leading-relaxed text-emerald-900">Confirm only if the agreed package was delivered. If something is unresolved, report an issue instead: an open case holds completion and payout.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void confirmTourCompletion()}
                      disabled={completionLoading}
                      className="inline-flex h-10 flex-shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-emerald-700 px-5 text-[13px] font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      {completionLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                      {completionLoading ? "Confirming..." : "Confirm completion"}
                    </button>
                  </section>
                ) : null}

                <Panel title="Trip documents" subtitle="Everything you may be asked for on the day.">
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                    {/* Each document has its own colour so they read apart at a
                        glance: voucher gold (the ticket), receipt green (money),
                        itinerary blue (the calendar). Class strings stay literal
                        so Tailwind generates them. */}
                    {[
                      {
                        href: `${detailBase}/voucher`, icon: Ticket, title: "Voucher", text: "Show this at the meetup",
                        tile: "border-amber-200 bg-amber-50/70 hover:border-amber-400 hover:shadow-[0_10px_24px_-18px_rgba(217,119,6,0.7)]",
                        icon_: "bg-amber-500 text-white", title_: "text-amber-950", text_: "text-amber-800/70", arrow: "text-amber-300 group-hover:text-amber-600",
                      },
                      {
                        href: `${detailBase}/receipt`, icon: Receipt, title: "Receipt", text: "Proof of your payment",
                        tile: "border-emerald-200 bg-emerald-50/70 hover:border-emerald-500 hover:shadow-[0_10px_24px_-18px_rgba(2,102,94,0.7)]",
                        icon_: "bg-[#02665e] text-white", title_: "text-emerald-950", text_: "text-emerald-800/70", arrow: "text-emerald-300 group-hover:text-emerald-700",
                      },
                      {
                        href: `${detailBase}/timeline`, icon: CalendarDays, title: "Itinerary", text: "Day-by-day timetable",
                        tile: "border-sky-200 bg-sky-50/70 hover:border-sky-400 hover:shadow-[0_10px_24px_-18px_rgba(2,132,199,0.7)]",
                        icon_: "bg-sky-600 text-white", title_: "text-sky-950", text_: "text-sky-800/70", arrow: "text-sky-300 group-hover:text-sky-600",
                      },
                      {
                        href: `${detailBase}/visa-itinerary`, icon: FileCheck2, title: "Visa itinerary", text: "Print for an application",
                        tile: "border-violet-200 bg-violet-50/70 hover:border-violet-400 hover:shadow-[0_10px_24px_-18px_rgba(109,40,217,0.55)]",
                        icon_: "bg-violet-600 text-white", title_: "text-violet-950", text_: "text-violet-800/70", arrow: "text-violet-300 group-hover:text-violet-600",
                      },
                    ].map((doc) => (
                      <Link
                        key={doc.title}
                        href={doc.href}
                        className={`group flex min-w-0 items-center gap-3 rounded-2xl border border-solid p-3.5 no-underline transition-all hover:-translate-y-px ${doc.tile}`}
                      >
                        <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl shadow-sm ${doc.icon_}`}>
                          <doc.icon className="h-5 w-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[14px] font-bold ${doc.title_}`}>{doc.title}</span>
                          <span className={`block truncate text-[12px] ${doc.text_}`}>{doc.text}</span>
                        </span>
                        <ChevronRight className={`h-4 w-4 flex-shrink-0 transition-all group-hover:translate-x-0.5 ${doc.arrow}`} aria-hidden />
                      </Link>
                    ))}
                  </div>
                </Panel>

                <PackagePanel inclusions={inclusions} exclusions={exclusions} meetingPoints={meetingPoints} packageDaysText={packageDaysText} />

                {/* ── Support ── */}
                {activeCancellationCase ? (
                  <CancellationCase
                    tourCase={activeCancellationCase}
                    currency={item?.currency || "TZS"}
                    amountPaid={Number(item?.grossAmount || 0)}
                    evidenceHref={`${detailBase}/documents?caseId=${activeCancellationCase.id}`}
                    onWithdraw={() => void withdrawCancellation(Number(activeCancellationCase.id))}
                    withdrawing={withdrawingCaseId === Number(activeCancellationCase.id)}
                  />
                ) : (
                  <Panel title="Need help with this trip?" subtitle="Requests go to your operator and are kept in your activity below.">
                    <div className="divide-y divide-solid divide-slate-200 [&>*]:border-x-0 overflow-hidden rounded-2xl border border-solid border-slate-200">
                      <SupportRow href={`${detailBase}/documents`} icon={FileText} title={`Documents${uploadedDocsCount ? ` (${uploadedDocsCount})` : ""}`} text="Upload passports, permits or other required files" />
                      <SupportRow onClick={() => openActionForm("change")} disabled={actionLoading} active={activeActionForm === "change"} icon={PenLine} title="Request a change" text="Dates, travellers, pickup or itinerary" />
                      <SupportRow onClick={() => openActionForm("issue")} disabled={actionLoading} active={activeActionForm === "issue"} icon={AlertTriangle} title="Report an issue" text="A service, timing or communication problem" tone="rose" />
                      <SupportRow onClick={() => openActionForm("cancellation")} disabled={actionLoading || supportLocked} active={activeActionForm === "cancellation"} icon={XCircle} title="Request cancellation" text={supportLocked ? "Not available for this booking" : "Check the policy and submit a request"} tone="amber" />
                    </div>
                  </Panel>
                )}

                {activeActionForm && !(activeActionForm === "cancellation" && activeCancellationCase) ? (
                  <Panel
                    title={activeActionForm === "change" ? "Request a change" : activeActionForm === "issue" ? "Report an issue" : "Request cancellation"}
                    subtitle={
                      activeActionForm === "change"
                        ? "Tell the operator what should be updated in your package."
                        : activeActionForm === "issue"
                          ? "Describe the issue clearly so the operator can resolve it quickly."
                          : "Your eligibility and provisional refund are calculated immediately. The booking stays active until NoLSAF approves it."
                    }
                  >
                    {activeActionForm === "cancellation" && cancellationReviewOpen ? (
                      <div>
                        <div className="rounded-2xl border border-solid border-[#02665e]/20 bg-[#02665e]/5 px-4 py-3">
                          <div className="text-[14px] font-bold text-slate-900">Review your cancellation request</div>
                          <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-slate-600">Nothing is sent to NoLSAF until you confirm.</p>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-solid border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Reason</div>
                            <div className="mt-1 text-[14px] font-semibold text-slate-900">{actionTitle.trim()}</div>
                          </div>
                          <div className="rounded-2xl border border-solid border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Booking</div>
                            <div className="mt-1 truncate text-[14px] font-semibold text-slate-900">{String(item?.title || packageSnapshot?.title || "Tour package")}</div>
                            {item?.bookingCode ? <div className="mt-1 font-mono text-[12px] text-slate-500">{String(item.bookingCode)}</div> : null}
                          </div>
                          <div className="rounded-2xl border border-solid border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                            <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Details</div>
                            <p className="m-0 mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">{actionDraft.trim()}</p>
                            <div className="mt-2 text-[11px] text-slate-500">{countWords(actionDraft)} words</div>
                          </div>
                          <div className="rounded-2xl border border-solid border-amber-200 bg-amber-50/70 p-4 sm:col-span-2">
                            <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-amber-800">What happens next</div>
                            <ul className="m-0 mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-amber-900">
                              <li>Your policy eligibility and provisional refund are calculated immediately.</li>
                              <li>Your booking stays active until NoLSAF approves the cancellation.</li>
                              <li>NoLSAF may ask for supporting evidence during the review.</li>
                            </ul>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                          <button type="button" onClick={() => setCancellationReviewOpen(false)} disabled={actionLoading} className={SECONDARY_BUTTON}>Edit request</button>
                          <button type="button" onClick={submitActiveAction} disabled={actionLoading} className={PRIMARY_BUTTON}>{actionLoading ? "Submitting..." : "Confirm and submit"}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3.5">
                        <div className="grid gap-3.5 sm:grid-cols-2">
                          <label className="block min-w-0">
                            <span className={FIELD_LABEL}>Title <span className="text-rose-600">*</span></span>
                            <input
                              type="text"
                              value={actionTitle}
                              onChange={(e) => setActionTitle(e.target.value)}
                              placeholder={activeActionForm === "change" ? "e.g. Change pickup time" : activeActionForm === "issue" ? "e.g. Delay at the meetup point" : "e.g. Medical emergency"}
                              className={FIELD_INPUT}
                            />
                          </label>
                          <label className="block min-w-0">
                            <span className={FIELD_LABEL}>{activeActionForm === "change" ? "Type of request" : activeActionForm === "issue" ? "Type of issue" : "Reason category"}</span>
                            {activeActionForm === "change" ? (
                              <select value={changeType} onChange={(e) => setChangeType(e.target.value as any)} className={`${FIELD_INPUT} pr-9`}>
                                <option value="GENERAL">General</option>
                                <option value="DATE_CHANGE">Date change</option>
                                <option value="TRAVELERS">Traveller count</option>
                                <option value="DOCUMENTS">Documents</option>
                                <option value="PICKUP">Pickup or meetup</option>
                                <option value="ITINERARY">Itinerary</option>
                                <option value="OTHER">Other</option>
                              </select>
                            ) : activeActionForm === "issue" ? (
                              <select value={issueType} onChange={(e) => setIssueType(e.target.value as any)} className={`${FIELD_INPUT} pr-9`}>
                                <option value="GENERAL">General</option>
                                <option value="SERVICE">Service quality</option>
                                <option value="TIMING">Timing or delay</option>
                                <option value="PICKUP">Pickup or meetup</option>
                                <option value="DOCUMENTS">Documents</option>
                                <option value="PAYMENT">Payment</option>
                                <option value="COMMUNICATION">Communication</option>
                                <option value="OTHER">Other</option>
                              </select>
                            ) : (
                              <span className="block rounded-xl border border-solid border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">Taken from the title. Supporting evidence can be requested during review.</span>
                            )}
                          </label>
                        </div>

                        {activeActionForm === "issue" ? (
                          <div>
                            <span className={FIELD_LABEL}>Severity</span>
                            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Severity">
                              {(["LOW", "MEDIUM", "HIGH"] as const).map((level) => {
                                const on = issueSeverity === level;
                                return (
                                  <button
                                    key={level}
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    onClick={() => setIssueSeverity(level)}
                                    className={`h-10 cursor-pointer rounded-xl border border-solid text-[13px] font-semibold capitalize transition-colors ${
                                      on
                                        ? level === "HIGH" ? "border-rose-500 bg-rose-50 text-rose-700" : level === "MEDIUM" ? "border-amber-500 bg-amber-50 text-amber-800" : "border-[#02665e] bg-[#02665e]/5 text-[#02665e]"
                                        : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                                    }`}
                                  >
                                    {level.toLowerCase()}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        <label className="block">
                          <span className={FIELD_LABEL}>
                            {activeActionForm === "change" ? "What should change" : activeActionForm === "issue" ? "What happened" : "Why you need to cancel"} <span className="text-rose-600">*</span>
                          </span>
                          <textarea
                            rows={4}
                            value={actionDraft}
                            onChange={handleActionDraftChange}
                            placeholder={activeActionForm === "cancellation" ? `Explain your reason (at least ${MIN_CANCELLATION_WORDS} words)` : `Keep it short (up to ${MAX_ACTION_WORDS} words)`}
                            className={`${FIELD_INPUT} h-auto min-h-[7rem] resize-y py-2.5`}
                          />
                          <span className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-slate-500">
                            <span>
                              {activeActionForm === "cancellation" && countWords(actionDraft) < MIN_CANCELLATION_WORDS ? (
                                <span className="font-semibold text-amber-700">At least {MIN_CANCELLATION_WORDS} words</span>
                              ) : null}
                            </span>
                            <span className="tabular-nums">{countWords(actionDraft)}/{activeActionForm === "cancellation" ? MAX_CANCELLATION_WORDS : MAX_ACTION_WORDS} words</span>
                          </span>
                        </label>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button type="button" onClick={closeActionForm} disabled={actionLoading} className={SECONDARY_BUTTON}>Cancel</button>
                          <button
                            type="button"
                            onClick={submitActiveAction}
                            disabled={actionLoading || !actionTitle.trim() || !actionDraft.trim() || (activeActionForm === "cancellation" && countWords(actionDraft) < MIN_CANCELLATION_WORDS)}
                            className={PRIMARY_BUTTON}
                          >
                            {actionLoading ? "Sending..." : activeActionForm === "change" ? "Send request" : activeActionForm === "issue" ? "Submit issue" : "Review request"}
                          </button>
                        </div>
                      </div>
                    )}
                  </Panel>
                ) : null}

                {actionMessage ? (
                  <div role="status" className="rounded-2xl border border-solid border-[#02665e]/25 bg-[#02665e]/5 px-4 py-3">
                    <div className="text-[13px] font-bold text-slate-900">Request update</div>
                    <p className="m-0 mt-1 text-[13px] leading-relaxed text-slate-700">{actionMessage}</p>
                  </div>
                ) : null}

                {/* Decided or withdrawn requests: the most recent in full, earlier ones as a short list. */}
                {cancellationCases.length > 0 && !activeCancellationCase ? (
                  <div className="space-y-3">
                    <CancellationCase
                      tourCase={cancellationCases[0]}
                      currency={item?.currency || "TZS"}
                      amountPaid={Number(item?.grossAmount || 0)}
                    />
                    {cancellationCases.length > 1 ? (
                      <div className="rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3">
                        <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Earlier cancellation requests</div>
                        <ul className="m-0 mt-2 list-none divide-y divide-solid divide-slate-200 [&>*]:border-x-0 p-0">
                          {cancellationCases.slice(1).map((tourCase: any) => {
                            const meta = cancellationStatusMeta(String(tourCase.status || ""));
                            return (
                              <li key={tourCase.id} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                                <span className="text-slate-600">Requested {tourCase.createdAt ? new Date(tourCase.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : ""}</span>
                                <StatusChip tone={meta.chip}>{meta.label}</StatusChip>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <Panel title="Activity" subtitle="Your change requests and issue reports.">
                  {pendingDeleteAudit ? (
                    <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-solid border-rose-200 bg-rose-50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-[13px] text-rose-800"><span className="font-bold">Delete this request?</span> It will be removed from your activity.</div>
                      <div className="flex flex-shrink-0 gap-2">
                        <button type="button" onClick={() => setPendingDeleteAudit(null)} disabled={Boolean(deletingAuditId)} className={SECONDARY_BUTTON}>Keep</button>
                        <button
                          type="button"
                          onClick={() => deleteAuditItem(pendingDeleteAudit)}
                          disabled={Boolean(deletingAuditId)}
                          className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full border-0 bg-rose-600 px-5 text-[13px] font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingAuditId ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {auditItems.length === 0 ? (
                    <p className="m-0 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-[13px] text-slate-500">No requests yet. Anything you send will be tracked here.</p>
                  ) : (
                    <ol className="m-0 list-none space-y-0 p-0">
                      {auditItems.map((entry, index) => {
                        const statusText = statusDisplayText(entry.status);
                        const tone = statusText === "Changed" ? "emerald" : statusText === "Not Changed" ? "rose" : "amber";
                        return (
                          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
                            {index < auditItems.length - 1 ? <span aria-hidden className="absolute left-[15px] top-8 bottom-0 w-px bg-slate-200" /> : null}
                            <span className={`relative inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${entry.kind === "CHANGE_REQUEST" ? "bg-[#02665e]/10 text-[#02665e]" : "bg-rose-50 text-rose-600"}`}>
                              {entry.kind === "CHANGE_REQUEST" ? <PenLine className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
                            </span>
                            <div className="min-w-0 flex-1 rounded-2xl border border-solid border-slate-200 bg-white px-3.5 py-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[13.5px] font-bold text-slate-900">{entry.title}</div>
                                  <div className="text-[11.5px] text-slate-500">{entry.kind === "CHANGE_REQUEST" ? "Change request" : "Issue report"}{entry.createdAt ? ` · ${entry.createdAt.toLocaleString()}` : ""}</div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <StatusChip tone={tone}>{statusText === "Not Changed" ? "Not changed" : statusText}</StatusChip>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteAudit({ id: entry.id, kind: entry.kind })}
                                    disabled={deletingAuditId === entry.id}
                                    title="Delete request"
                                    aria-label={`Delete ${entry.title}`}
                                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {deletingAuditId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                                  </button>
                                </div>
                              </div>
                              <p className="m-0 mt-1.5 break-words text-[13px] leading-relaxed text-slate-700">{entry.message}</p>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {[entry.changeType, entry.issueType, entry.severity ? `${entry.severity.toLowerCase()} severity` : null]
                                  .filter(Boolean)
                                  .map((tag) => (
                                    <span key={String(tag)} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-600">{String(tag).replace(/_/g, " ").toLowerCase()}</span>
                                  ))}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </Panel>
              </div>

              {/* ── Side column ── */}
              <aside className="min-w-0 space-y-5">
                <Panel title="Payment">
                  <dl className="m-0 divide-y divide-solid divide-slate-200 [&>*]:border-x-0">
                    <SummaryRow label="Status" value={<StatusChip tone={isPaid ? "emerald" : "amber"}>{isPaid ? "Paid" : paymentStatusDisplay.replace(/_/g, " ").toLowerCase()}</StatusChip>} />
                    <SummaryRow label="Total" value={<span className="font-bold text-slate-900">{totalPaidText}</span>} />
                    <SummaryRow label="Paid on" value={paidAtValue} />
                    <SummaryRow label="Method" value={paidViaText} />
                    <SummaryRow label="Reference" value={paymentRef ? <span className="break-all font-mono text-[12px]">{paymentRef}</span> : "Not recorded"} />
                  </dl>
                </Panel>

                <Panel
                  title="Travel team"
                  action={
                    <StatusChip tone={pickupValidated ? "emerald" : "amber"}>
                      {pickupValidated ? "Meetup validated" : "Opens at meetup"}
                    </StatusChip>
                  }
                >
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[28px] font-black leading-none tabular-nums text-slate-900">
                        {timelineJoinedTotal}<span className="text-[16px] font-bold text-slate-400">/{timelineTotalTravellers}</span>
                      </div>
                      <div className="mt-1 text-[12.5px] text-slate-500">travellers connected to the itinerary</div>
                    </div>
                    <span className="rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[11.5px] font-bold text-[#02665e]">
                      {timelineRemainingTravellers} {timelineRemainingTravellers === 1 ? "slot" : "slots"} left
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#02665e]" style={{ width: `${Math.min(100, Math.max(0, (timelineJoinedTotal / timelineTotalTravellers) * 100))}%` }} />
                  </div>

                  {pickupValidated ? (
                    <button
                      type="button"
                      onClick={createTimelineInvite}
                      disabled={shareLoading}
                      className="mt-4 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border-2 border-solid border-[#02665e] bg-white text-[13px] font-bold text-[#02665e] transition-colors hover:bg-[#02665e] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {shareLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
                      {timelineInviteUrl ? "Copy invite link" : "Invite your travellers"}
                    </button>
                  ) : (
                    <p className="m-0 mt-4 rounded-2xl bg-slate-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-slate-600">
                      Once your operator validates the meetup, you can invite the rest of your group to follow the itinerary.
                    </p>
                  )}

                  {shareMessage || timelineInviteUrl ? (
                    <div className="mt-3 space-y-2">
                      {shareMessage ? <p className="m-0 text-[12.5px] font-semibold text-slate-700">{shareMessage}</p> : null}
                      {timelineInviteUrl ? (
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 truncate rounded-xl border border-solid border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">{timelineInviteUrl}</div>
                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(`Join our tour timeline on NoLSAF: ${timelineInviteUrl}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Share invite on WhatsApp"
                            title="Share on WhatsApp"
                            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 no-underline hover:bg-emerald-100"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                              <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.512 5.26l-.999 3.648 3.476-.911zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                            </svg>
                          </a>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!navigator.clipboard?.writeText) return;
                              await navigator.clipboard.writeText(timelineInviteUrl);
                              setShareMessage("Invite link copied.");
                            }}
                            aria-label="Copy invite link"
                            title="Copy invite link"
                            className="inline-flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-600 hover:border-[#02665e] hover:text-[#02665e]"
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                      ) : null}
                      <p className="m-0 text-[11.5px] text-slate-400">One invite link is kept for this trip. Invited travellers sign in before they can open it.</p>
                    </div>
                  ) : null}
                </Panel>
              </aside>
            </div>
          )}
        </>
      )}

      {!loading && !error && item && isCompleted ? <AgentReviewSection bookingId={id} /> : null}
    </div>
  );
}

// ── Presentation pieces ─────────────────────────────────────────────────

const BRAND = "#02665e";
// Preflight is off in this app, so nothing sets border-box globally: a w-full
// field with padding would overflow its column on phones. Scoped to this page.
const DETAIL_BOX_SIZING = "#tour-detail-page, #tour-detail-page * { box-sizing: border-box; }";
const FIELD_LABEL = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500";
const FIELD_INPUT = "block h-10 w-full min-w-0 rounded-xl border border-solid border-slate-300 bg-white px-3 text-[13.5px] text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]";
const PRIMARY_BUTTON = "inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BUTTON = "inline-flex h-10 cursor-pointer items-center justify-center rounded-full border border-solid border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700 transition-colors hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60";
const JOURNEY_STEPS = ["Booked", "Paid", "Meetup", "On tour", "Completed"] as const;

function dayStart(value: string | number | Date): number {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-3xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[15.5px] font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
        </div>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function StatusChip({ tone, children }: { tone: "emerald" | "amber" | "rose" | "slate"; children: ReactNode }) {
  const style = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-600",
  }[tone];
  const dot = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-400" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="flex-shrink-0 text-[12.5px] text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-[13px] font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function SupportRow({
  href,
  onClick,
  disabled,
  active,
  icon: Icon,
  title,
  text,
  tone = "brand",
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  icon: typeof FileText;
  title: string;
  text: string;
  tone?: "brand" | "rose" | "amber";
}) {
  const iconTone = { brand: "bg-[#02665e]/10 text-[#02665e]", rose: "bg-rose-50 text-rose-600", amber: "bg-amber-50 text-amber-700" }[tone];
  const body = (
    <>
      <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[13.5px] font-bold text-slate-900">{title}</span>
        <span className="block text-[12px] text-slate-500">{text}</span>
      </span>
      <ChevronRight className={`h-4 w-4 flex-shrink-0 transition-transform ${active ? "rotate-90 text-[#02665e]" : "text-slate-300 group-hover:text-slate-500"}`} aria-hidden />
    </>
  );
  const rowClass = `group flex w-full items-center gap-3 px-4 py-3.5 transition-colors ${active ? "bg-[#02665e]/5" : "bg-white hover:bg-slate-50"}`;
  if (href) {
    return <Link href={href} className={`${rowClass} no-underline`}>{body}</Link>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={active}
      className={`${rowClass} cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50`}
      style={{ fontFamily: "inherit" }}
    >
      {body}
    </button>
  );
}

/** Five named steps on a line; filled up to where this trip is. */
function JourneySteps({ reached, onBrand, blocked }: { reached: number; onBrand?: boolean; blocked?: boolean }) {
  return (
    <ol className="m-0 grid list-none grid-cols-5 p-0" aria-label={`Journey: ${JOURNEY_STEPS[reached]}, step ${reached + 1} of ${JOURNEY_STEPS.length}`}>
      {JOURNEY_STEPS.map((step, index) => {
        const done = index <= reached && !blocked;
        const current = index === reached;
        const lineDone = index + 1 <= reached && !blocked;
        const dot = onBrand
          ? done ? "bg-white" : "bg-white/25"
          : done ? "bg-[#02665e]" : "bg-slate-200";
        const line = onBrand ? (lineDone ? "bg-white/70" : "bg-white/20") : (lineDone ? "bg-[#02665e]/50" : "bg-slate-200");
        const label = onBrand
          ? current ? "text-white" : done ? "text-white/75" : "text-white/45"
          : current ? "text-slate-900" : done ? "text-slate-600" : "text-slate-400";
        return (
          <li key={step} className="relative flex flex-col items-center gap-1.5 text-center">
            {index < JOURNEY_STEPS.length - 1 ? <span aria-hidden className={`absolute left-1/2 top-[5px] h-px w-full ${line}`} /> : null}
            <span className={`relative h-2.5 w-2.5 rounded-full ${dot} ${current && !blocked ? (onBrand ? "ring-4 ring-white/20" : "ring-4 ring-[#02665e]/15") : ""}`} />
            <span className={`text-[10.5px] font-semibold leading-tight sm:text-[11.5px] ${label}`}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PackagePanel({
  inclusions,
  exclusions,
  meetingPoints,
  packageDaysText,
}: {
  inclusions: string[];
  exclusions: string[];
  meetingPoints: string[];
  packageDaysText: string;
}) {
  return (
    <Panel title="What's in your package">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Included</div>
          {inclusions.length ? (
            <ul className="m-0 list-none space-y-2 p-0">
              {inclusions.map((inc, idx) => (
                <li key={`${inc}-${idx}`} className="flex items-start gap-2 text-[13.5px] leading-5 text-slate-800">
                  <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e] text-white"><Check className="h-3 w-3" aria-hidden /></span>
                  <span className="min-w-0 break-words">{inc}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-slate-400">Not provided by the operator</p>
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Not included</div>
          {exclusions.length ? (
            <ul className="m-0 list-none space-y-2 p-0">
              {exclusions.map((exc, idx) => (
                <li key={`${exc}-${idx}`} className="flex items-start gap-2 text-[13.5px] leading-5 text-slate-600">
                  <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600"><Minus className="h-3 w-3" aria-hidden /></span>
                  <span className="min-w-0 break-words">{exc}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-slate-400">Nothing listed</p>
          )}
        </div>
      </div>
      <dl className="m-0 mt-5 grid gap-3 border-0 border-t border-solid border-slate-100 pt-4 sm:grid-cols-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]"><MapPin className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0">
            <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Meeting point</dt>
            <dd className="m-0 mt-0.5 break-words text-[13.5px] font-semibold text-slate-900">{meetingPoints.length ? meetingPoints.join(" · ") : "To be confirmed"}</dd>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]"><CalendarDays className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0">
            <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Duration</dt>
            <dd className="m-0 mt-0.5 text-[13.5px] font-semibold text-slate-900">{packageDaysText}</dd>
          </div>
        </div>
      </dl>
    </Panel>
  );
}


// ── Cancellation case ───────────────────────────────────────────────────
// Mirrors the server lifecycle (customer.tourBookings + admin.tourCases):
// ELIGIBLE / UNDER_REVIEW / OPEN / ACKNOWLEDGED / ESCALATED -> APPROVED (booking
// cancelled, refund queued) -> RESOLVED (refund recorded), or REJECTED, or
// WITHDRAWN by the traveller before a decision.

const CANCELLATION_PENDING = ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW", "ELIGIBLE"];

type ChipTone = "emerald" | "amber" | "rose" | "slate";

function cancellationStatusMeta(status: string): { label: string; chip: ChipTone } {
  const s = status.toUpperCase();
  if (CANCELLATION_PENDING.includes(s)) return { label: "In review", chip: "amber" };
  if (s === "APPROVED") return { label: "Approved", chip: "emerald" };
  if (s === "RESOLVED") return { label: "Refunded", chip: "emerald" };
  if (s === "REJECTED") return { label: "Not approved", chip: "rose" };
  if (s === "WITHDRAWN") return { label: "Withdrawn", chip: "slate" };
  return { label: "Closed", chip: "slate" };
}

/** Customer-facing wording for case events; internal events are left out. */
const CASE_EVENT_LABEL: Record<string, string> = {
  ELIGIBILITY_CALCULATED: "Request received",
  OPERATOR_NOTIFIED: "Operator informed",
  DELIVER_TO_OPERATOR: "Operator informed",
  ACKNOWLEDGE: "Operator acknowledged",
  ESCALATE: "Passed to NoLSAF review",
  REQUEST_EVIDENCE: "Evidence requested",
  TRAVELER_EVIDENCE_SUBMITTED: "You sent evidence",
  APPROVE_CANCELLATION: "Cancellation approved",
  REJECT: "Not approved",
  RECORD_REFUND: "Refund completed",
  WITHDRAWN: "You withdrew the request",
};

function CancellationCase({
  tourCase,
  currency,
  amountPaid,
  evidenceHref,
  onWithdraw,
  withdrawing = false,
}: {
  tourCase: any;
  currency: string;
  amountPaid: number;
  evidenceHref?: string;
  onWithdraw?: () => void;
  withdrawing?: boolean;
}) {
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const status = String(tourCase?.status || "").toUpperCase();
  const events: any[] = Array.isArray(tourCase?.events) ? [...tourCase.events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) : [];
  const typeOf = (event: any) => String(event?.type || "").toUpperCase();
  const policy = events.find((event) => typeOf(event) === "ELIGIBILITY_CALCULATED")?.data || null;
  const decisionEvent = [...events].reverse().find((event) => ["APPROVE_CANCELLATION", "REJECT"].includes(typeOf(event)));
  const refundEvent = [...events].reverse().find((event) => typeOf(event) === "RECORD_REFUND");
  const lastEvidenceRequestIndex = events.map(typeOf).lastIndexOf("REQUEST_EVIDENCE");
  const evidenceOutstanding = lastEvidenceRequestIndex >= 0 && !events.slice(lastEvidenceRequestIndex + 1).some((event) => typeOf(event) === "TRAVELER_EVIDENCE_SUBMITTED");
  const evidenceMessage = lastEvidenceRequestIndex >= 0 ? events[lastEvidenceRequestIndex]?.message : null;
  const pending = CANCELLATION_PENDING.includes(status);
  const meta = cancellationStatusMeta(status);
  const money = (value: unknown) => `${Number(value || 0).toLocaleString("en-US")} ${currency}`;
  const finalRefund = tourCase?.resolutionAmount != null ? Number(tourCase.resolutionAmount) : null;
  const requestedOn = tourCase?.createdAt ? new Date(tourCase.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : null;

  const outcome = (() => {
    if (pending) return { tone: "amber" as const, title: evidenceOutstanding ? "We need a document from you" : "We are reviewing your request", text: "Your booking stays active until NoLSAF makes a decision." };
    if (status === "APPROVED") return { tone: "emerald" as const, title: "Cancellation approved", text: finalRefund != null ? `Your refund of ${money(finalRefund)} is being processed.` : "Your refund is being processed." };
    if (status === "RESOLVED") return { tone: "emerald" as const, title: "Refund completed", text: finalRefund != null ? `${money(finalRefund)} was returned to you.` : "Your refund has been recorded." };
    if (status === "REJECTED") return { tone: "rose" as const, title: "Cancellation not approved", text: "Your booking remains active and your trip goes ahead as planned." };
    if (status === "WITHDRAWN") return { tone: "slate" as const, title: "You withdrew this request", text: "Your booking remains active." };
    return { tone: "slate" as const, title: "This case is closed", text: "" };
  })();
  const toneBox: Record<ChipTone, string> = {
    amber: "border-amber-200 bg-amber-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
    rose: "border-rose-200 bg-rose-50/70",
    slate: "border-slate-200 bg-slate-50",
  };
  const toneTitle: Record<ChipTone, string> = { amber: "text-amber-950", emerald: "text-emerald-950", rose: "text-rose-950", slate: "text-slate-900" };

  // Four stages; a rejected case ends at the decision, a withdrawn one at review.
  const stages = [
    { key: "requested", label: "Requested", state: "done" as const },
    { key: "review", label: "Review", state: (pending ? "current" : status === "WITHDRAWN" ? "stopped" : "done") as "done" | "current" | "stopped" | "todo" },
    { key: "decision", label: status === "REJECTED" ? "Not approved" : "Decision", state: (["APPROVED", "RESOLVED"].includes(status) ? "done" : status === "REJECTED" ? "stopped" : "todo") as "done" | "current" | "stopped" | "todo" },
    { key: "refund", label: "Refund", state: (status === "RESOLVED" ? "done" : status === "APPROVED" ? "current" : "todo") as "done" | "current" | "stopped" | "todo" },
  ];

  const timeline = [...events]
    .reverse()
    .filter((event) => CASE_EVENT_LABEL[typeOf(event)]);

  return (
    <section className="overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-0 border-b border-solid border-slate-200 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400">Cancellation request</div>
          <h2 className="m-0 mt-1 text-[16px] font-bold text-slate-900">{outcome.title}</h2>
          {requestedOn ? <p className="m-0 mt-0.5 text-[12px] text-slate-500">Requested {requestedOn}</p> : null}
        </div>
        <StatusChip tone={meta.chip}>{meta.label}</StatusChip>
      </div>

      {/* Stage tracker */}
      {status !== "CLOSED" ? (
        <ol className="m-0 grid list-none grid-cols-4 gap-0 px-5 pb-1 pt-5 sm:px-6" aria-label={`Cancellation progress: ${meta.label}`}>
          {stages.map((stage, index) => {
            const dot =
              stage.state === "done" ? "bg-[#02665e] text-white"
              : stage.state === "current" ? "bg-white text-[#02665e] ring-2 ring-[#02665e]"
              : stage.state === "stopped" ? "bg-rose-500 text-white"
              : "bg-slate-100 text-slate-400";
            const nextDone = index < stages.length - 1 && ["done", "current", "stopped"].includes(stages[index + 1].state) && stage.state === "done";
            return (
              <li key={stage.key} className="relative flex flex-col items-center gap-1.5 text-center">
                {index < stages.length - 1 ? (
                  <span aria-hidden className={`absolute left-1/2 top-[11px] h-0.5 w-full ${nextDone ? "bg-[#02665e]" : "bg-slate-200"}`} />
                ) : null}
                <span className={`relative inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black ${dot}`}>
                  {stage.state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : stage.state === "stopped" ? <XCircle className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                </span>
                <span className={`text-[11px] font-semibold ${stage.state === "todo" ? "text-slate-400" : stage.state === "stopped" ? "text-rose-700" : "text-slate-700"}`}>{stage.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="space-y-4 px-5 py-5 sm:px-6">
        {/* Outcome */}
        <div className={`rounded-2xl border border-solid px-4 py-3.5 ${toneBox[outcome.tone]}`}>
          <p className={`m-0 text-[13.5px] font-semibold ${toneTitle[outcome.tone]}`}>{outcome.text || outcome.title}</p>
          {decisionEvent?.message ? (
            <div className="mt-3 rounded-xl bg-white/80 px-3.5 py-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Note from NoLSAF</div>
              <p className="m-0 mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{displayText(decisionEvent.message, "")}</p>
            </div>
          ) : null}
          {status === "RESOLVED" && refundEvent?.message ? (
            <p className="m-0 mt-2 text-[12.5px] text-emerald-900">{displayText(refundEvent.message, "")}</p>
          ) : null}
        </div>

        {/* Evidence action */}
        {pending && evidenceOutstanding && evidenceHref ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-solid border-[#02665e]/25 bg-[#02665e]/5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold text-slate-900">Upload supporting evidence</div>
              <p className="m-0 mt-0.5 text-[12.5px] leading-relaxed text-slate-600">{displayText(evidenceMessage, "NoLSAF needs a document to continue the review.")}</p>
            </div>
            <Link href={evidenceHref} className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#02665e] px-5 text-[13px] font-bold text-white no-underline hover:bg-[#014d47]">
              <FileText className="h-4 w-4" aria-hidden />
              Upload evidence
            </Link>
          </div>
        ) : null}

        {/* Figures */}
        <dl className="m-0 grid grid-cols-1 overflow-hidden rounded-2xl border border-solid border-slate-200 sm:grid-cols-3">
          {[
            { label: "You paid", value: money(policy?.amountPaid ?? amountPaid) },
            { label: "Policy estimate", value: policy ? `${Number(policy.refundPercent || 0)}% · ${money(policy.estimatedRefundAmount)}` : "Manual review" },
            {
              label: status === "RESOLVED" ? "Refunded" : "Final refund",
              value: ["APPROVED", "RESOLVED"].includes(status) && finalRefund != null ? money(finalRefund) : status === "REJECTED" || status === "WITHDRAWN" ? "None" : "After decision",
              strong: ["APPROVED", "RESOLVED"].includes(status),
            },
          ].map((figure, index) => (
            <div key={figure.label} className={`min-w-0 px-4 py-3 ${index > 0 ? "border-0 border-t border-solid border-slate-200 sm:border-l sm:border-t-0" : ""}`}>
              <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{figure.label}</dt>
              <dd className={`m-0 mt-1 truncate text-[14px] font-bold ${figure.strong ? "text-[#02665e]" : "text-slate-900"}`}>{figure.value}</dd>
            </div>
          ))}
        </dl>
        {policy?.reason ? <p className="m-0 text-[12px] leading-relaxed text-slate-500">{displayText(policy.reason, "")}</p> : null}

        {/* Activity */}
        {timeline.length ? (
          <div>
            <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Activity</div>
            <ol className="m-0 list-none p-0">
              {timeline.map((event, index) => (
                <li key={event.id ?? index} className="relative flex gap-3 pb-3 last:pb-0">
                  {index < timeline.length - 1 ? <span aria-hidden className="absolute bottom-0 left-[5px] top-4 w-px bg-slate-200" /> : null}
                  <span aria-hidden className={`relative mt-1.5 h-[11px] w-[11px] flex-shrink-0 rounded-full ${index === 0 ? "bg-[#02665e]" : "bg-slate-300"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[13px] font-semibold text-slate-800">{CASE_EVENT_LABEL[typeOf(event)]}</span>
                      <span className="text-[11px] text-slate-400">{event.createdAt ? new Date(event.createdAt).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    </div>
                    {event.message && !["ELIGIBILITY_CALCULATED", "APPROVE_CANCELLATION", "REJECT"].includes(typeOf(event)) ? (
                      <p className="m-0 mt-0.5 break-words text-[12.5px] leading-relaxed text-slate-500">{displayText(event.message, "")}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      {/* Withdraw: only before a decision */}
      {pending && onWithdraw ? (
        <div className="flex flex-col gap-2 border-0 border-t border-solid border-slate-200 bg-slate-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="text-[12px] text-slate-500">Changed your mind? You can withdraw until NoLSAF decides.</span>
          {confirmWithdraw ? (
            <div className="flex flex-shrink-0 items-center gap-2">
              <button type="button" onClick={() => setConfirmWithdraw(false)} disabled={withdrawing} className="inline-flex h-9 cursor-pointer items-center rounded-full border border-solid border-slate-300 bg-white px-4 text-[12.5px] font-semibold text-slate-700 disabled:opacity-60">
                Keep request
              </button>
              <button type="button" onClick={onWithdraw} disabled={withdrawing} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-rose-600 px-4 text-[12.5px] font-bold text-white hover:bg-rose-700 disabled:opacity-60">
                {withdrawing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                {withdrawing ? "Withdrawing..." : "Yes, withdraw"}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmWithdraw(true)} className="inline-flex h-9 flex-shrink-0 cursor-pointer items-center rounded-full border border-solid border-slate-300 bg-white px-4 text-[12.5px] font-semibold text-slate-700 hover:border-rose-300 hover:text-rose-700">
              Withdraw request
            </button>
          )}
        </div>
      ) : null}
    </section>
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
    <div className="flex min-w-0 flex-wrap items-center gap-1" role={readOnly ? undefined : "radiogroup"} aria-label="Rating out of five stars">
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= value;
        return (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            onClick={readOnly ? undefined : () => onChange?.(star)}
            aria-label={`${star} star${star > 1 ? "s" : ""}`}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 ${readOnly ? "cursor-default" : "cursor-pointer hover:bg-amber-50 hover:scale-105"} transition-transform`}
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
      <section className="rounded-3xl border border-solid border-slate-200 bg-white p-5 sm:p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
      </section>
    );
  }

  if (!eligible && !review) return null;

  return (
    <section className="min-w-0 rounded-3xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="m-0 text-[15.5px] font-bold text-slate-900">Rate your operator</h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
            {review
              ? "Thanks for your feedback. Here is the review you left."
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
              <p className="m-0 rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-700">
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
              <div key={d.key} className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{d.label}</div>
                  <div className="text-xs text-slate-500">{d.hint}</div>
                </div>
                <div className="flex justify-start sm:justify-end"><StarRating value={scores[d.key]} onChange={(v) => setScores((s) => ({ ...s, [d.key]: v }))} /></div>
              </div>
            ))}

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 1000))}
              placeholder="Add a comment (optional)"
              rows={3}
              className={`${FIELD_INPUT} h-auto min-h-24 resize-y py-2.5`}
            />

            {errorMsg ? (
              <div className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{errorMsg}</div>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={!allRated || submitting}
              className={`${PRIMARY_BUTTON} w-full sm:w-auto`}
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
