"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Users, Search, X, Calendar, MapPin, Clock, User, BarChart3, UsersRound, CheckCircle, AlertCircle, Loader2, XCircle, Mail, Phone, FileText, Truck, Bus, Coffee, Wrench, Send, MessageSquare, Edit, CheckCircle2, Building2, Plus, Trash2, Tag, ChevronDown, Globe, DollarSign, Sparkles, Gift, ArrowRight } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";
import Image from "next/image";
import Link from "next/link";
import TablePagination from "@/components/TablePagination";
import { useSearchParams } from "next/navigation";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;

function authify() {}

type GroupBookingRow = {
  id: number;
  groupType: string;
  accommodationType: string;
  headcount: number;
  maleCount?: number | null;
  femaleCount?: number | null;
  otherCount?: number | null;
  roomsNeeded: number;
  toRegion: string;
  toDistrict: string | null;
  toLocation: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  user: { id: number; name: string; email: string; phone: string | null } | null;
  createdAt: string;
  updatedAt?: string | null;
  arrPickup: boolean;
  arrTransport: boolean;
  arrMeals: boolean;
  arrGuide: boolean;
  arrEquipment: boolean;
  pickupLocation?: string | null;
  pickupTime?: string | null;
  arrangementNotes?: string | null;
  notes?: string | null;
  isOpenForClaims?: boolean; // Whether booking is open for owner claims/offers
  openedForClaimsAt?: string | null; // When booking was opened for claims
  // Check-in milestone + earnings split (NoLSAF commission = deposit)
  checkedInAt?: string | null;
  totalAmount?: number | null;
  depositAmount?: number | null;
  currency?: string | null;
};

// Wording for the Quick Actions confirmation dialog in the booking details modal.
const STATUS_ACTION_COPY = {
  REVIEWING: { title: "Start reviewing?", verb: "start reviewing", confirmLabel: "Start reviewing", detail: "The customer will be notified that their request is under review." },
  PROCESSING: { title: "Start processing?", verb: "start processing", confirmLabel: "Start processing", detail: "The customer will be notified that their booking is being processed." },
  CONFIRMED: { title: "Confirm this booking?", verb: "confirm", confirmLabel: "Confirm booking", detail: "The customer will be notified that their group stay is confirmed." },
  COMPLETED: { title: "Mark as completed?", verb: "mark as completed", confirmLabel: "Mark completed", detail: "This closes the booking as a finished stay and the customer will be notified." },
  CANCELED: { title: "Cancel this booking?", verb: "cancel", confirmLabel: "Yes, cancel booking", detail: "The customer will be notified. This cannot be undone from here." },
} as const;

// NRMS-style status pill tones (see STATUS_CLS in owner/nrms/reservations).
function statusPillClasses(v: string) {
  switch (v) {
    case "AWAITING_DEPOSIT": return "bg-amber-50 text-amber-700";
    case "CONFIRMED": return "bg-emerald-50 text-emerald-700";
    case "PROCESSING": return "bg-blue-50 text-blue-700";
    case "REVIEWING": return "bg-purple-50 text-purple-700";
    case "COMPLETED": return "bg-teal-50 text-teal-700";
    case "CANCELED":
    case "CANCELLED": return "bg-rose-50 text-rose-700";
    default: return "bg-neutral-100 text-neutral-600";
  }
}

function humanizeGroupLabel(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

// "dar-es-salaam" -> "Dar es Salaam", "ILALA CBD" -> "Ilala CBD".
function formatPlaceName(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i > 0 && ["es", "la", "wa", "na", "ya"].includes(word.toLowerCase())) return word.toLowerCase();
      // Keep real abbreviations only; "DAR" in "DAR es Salaam" is a word, not one.
      if (["CBD", "UDSM", "JNIA", "KIA"].includes(word.toUpperCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function badgeClasses(v: string) {
  switch (v) {
    case "PENDING":
      return "bg-gray-100 text-gray-700";
    case "REVIEWING":
      return "bg-purple-100 text-purple-700";
    case "CONFIRMED":
      return "bg-blue-100 text-blue-700";
    case "PROCESSING":
      return "bg-yellow-100 text-yellow-700";
    case "COMPLETED":
      return "bg-green-100 text-green-700";
    case "CANCELED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

type BookingStats = {
  date: string;
  count: number;
  confirmed: number;
  totalHeadcount: number;
};

type BookingStatsResponse = {
  stats: BookingStats[];
  period: string;
  startDate: string;
  endDate: string;
};

type SummaryData = {
  totalBookings?: number;
  pendingBookings?: number;
  confirmedBookings?: number;
  processingBookings?: number;
  completedBookings?: number;
  canceledBookings?: number;
};

export default function AdminGroupStaysBookingsPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<string>("");
  const [groupType, setGroupType] = useState<string>("");
  const [date, setDate] = useState<string | string[]>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<GroupBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pickerAnim, setPickerAnim] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Histogram state
  const [histogramPeriod, setHistogramPeriod] = useState<string>("30d");
  const [histogramData, setHistogramData] = useState<BookingStatsResponse | null>(null);
  const [histogramLoading, setHistogramLoading] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  // Modal state for booking details
  const [bookingDetails, setBookingDetails] = useState<GroupBookingRow | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Admin action state
  const [quickMessage, setQuickMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [auditHistory, setAuditHistory] = useState<any[]>([]);
  const [loadingAuditHistory, setLoadingAuditHistory] = useState(false);
  const [showPassengers, setShowPassengers] = useState(false);
  const [passengers, setPassengers] = useState<any[]>([]);
  const [loadingPassengers, setLoadingPassengers] = useState(false);
  const [conversationMessages, setConversationMessages] = useState<any[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [showConversation, setShowConversation] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showArrangementNotes, setShowArrangementNotes] = useState(false);
  const [pendingStatusAction, setPendingStatusAction] = useState<keyof typeof STATUS_ACTION_COPY | null>(null);

  // Property recommendation state
  const [showPropertySearch, setShowPropertySearch] = useState(false);
  const [propertySearchLoading, setPropertySearchLoading] = useState(false);
  const [propertySearchResults, setPropertySearchResults] = useState<any[]>([]);
  const [selectedProperties, setSelectedProperties] = useState<any[]>([]);
  const [attachingProperties, setAttachingProperties] = useState(false);
  const [recommendedPropertyIds, setRecommendedPropertyIds] = useState<number[]>([]);

  // Claims review state - Premium admin interface for reviewing owner offers
  const [claimsData, setClaimsData] = useState<any>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [selectedClaimIds, setSelectedClaimIds] = useState<number[]>([]); // Selected claims for recommendation (max 3)
  const [recommendingClaims, setRecommendingClaims] = useState(false);
  const [startingClaimsReview, setStartingClaimsReview] = useState(false);
  const [comparisonView, setComparisonView] = useState<"grid" | "list">("grid");
  const [claimsFilter, setClaimsFilter] = useState<"all" | "pending" | "accepted" | "rejected">("all");
  const [showShortlistOnly, setShowShortlistOnly] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
      };
      // Only include filters if they have values (not empty strings) - matching Plan with Us pattern
      if (status && status.trim()) params.status = status.trim();
      if (groupType && groupType.trim()) params.groupType = groupType.trim();
      if (date) {
        if (Array.isArray(date) && date.length > 0) {
          if (date[0]) params.start = date[0];
          if (date[1]) params.end = date[1];
        } else if (date && !Array.isArray(date)) {
          params.date = date;
        }
      }
      if (q && q.trim()) params.q = q.trim();

      console.log('Loading group bookings with params:', params);
      const r = await api.get<{ items: GroupBookingRow[]; total: number }>("/api/admin/group-stays/bookings", { params });
      console.log('Group bookings response:', { 
        itemsCount: Array.isArray(r.data?.items) ? r.data.items.length : 0, 
        total: r.data?.total || 0, 
        items: r.data?.items,
        fullResponse: r.data
      });
      setList(Array.isArray(r.data?.items) ? r.data.items : []);
      setTotal(r.data?.total ?? 0);
    } catch (err: any) {
      console.error("Failed to load group bookings", err);
      console.error("Error details:", err?.response?.data || err?.message);
      // Show error to user
      if (err?.response?.data?.error) {
        alert(`Error loading bookings: ${err.response.data.error}`);
      }
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadStatusCounts() {
    try {
      const r = await api.get<SummaryData>("/api/admin/group-stays/summary");
      if (r?.data) {
        setStatusCounts({
          "": r.data.totalBookings || 0,
          "PENDING": r.data.pendingBookings || 0,
          "CONFIRMED": r.data.confirmedBookings || 0,
          "PROCESSING": r.data.processingBookings || 0,
          "COMPLETED": r.data.completedBookings || 0,
          "CANCELED": r.data.canceledBookings || 0,
        });
      }
    } catch (err) {
      console.error("Failed to load status counts", err);
    }
  }

  const loadHistogram = useCallback(async () => {
    setHistogramLoading(true);
    try {
      const r = await api.get<BookingStatsResponse>("/api/admin/group-stays/bookings/stats", {
        params: { period: histogramPeriod },
      });
      setHistogramData(r.data);
    } catch (err) {
      console.error("Failed to load booking statistics", err);
      setHistogramData(null);
    } finally {
      setHistogramLoading(false);
    }
  }, [histogramPeriod]);

  // Load booking details
  const loadBookingDetails = async (bookingId: number) => {
    setDetailsLoading(true);
    try {
      const r = await api.get<GroupBookingRow & { recommendedPropertyIds?: number[] | null; needsPrivateRoom?: boolean; privateRoomCount?: number; roomSize?: number; adminNotes?: string | null }>(`/api/admin/group-stays/bookings/${bookingId}`);
      setBookingDetails(r.data);
      if (r.data.recommendedPropertyIds && Array.isArray(r.data.recommendedPropertyIds)) {
        setRecommendedPropertyIds(r.data.recommendedPropertyIds);
      } else {
        setRecommendedPropertyIds([]);
      }
      
      setShowDetailsModal(true);
      // Load audit history
      await loadAuditHistory(bookingId);
      // Load passengers
      await loadPassengers(bookingId);
      // Load conversation messages
      await loadConversationMessages(bookingId);
      // Load submitted claims if booking is open for claims
      if ((r.data as any).isOpenForClaims === true) {
        await loadClaims(bookingId);
      }
    } catch (err) {
      console.error("Failed to load booking details", err);
      alert("Failed to load booking details");
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleViewBooking = (booking: GroupBookingRow) => {
    loadBookingDetails(booking.id);
  };

  // Message templates
  const messageTemplates = {
    reviewing: "Thanks for posting your group stay request on NoLSAF! It is now open for verified property owners in your destination area to bid with their best offers. Our team is reviewing the responses and will share the top picks here so you can pick the one that suits your group best. We appreciate your patience!",
    processing: "Great news! We're now processing your group stay booking. Our team is working on finding the best accommodation options for your group. We'll contact you shortly with recommendations and pricing details.",
    confirmed: "Excellent! Your group stay booking has been confirmed. We've found suitable accommodation options for your group. Please review the recommendations we've sent and let us know if you'd like to proceed.",
    propertiesRecommended: "We've found some great accommodation options that match your requirements! Please review the recommended properties and let us know which one you prefer. We're here to help make your group stay memorable.",
  };

  // Auto-fill message template
  const handleFillTemplate = (templateKey: keyof typeof messageTemplates) => {
    setQuickMessage(messageTemplates[templateKey]);
  };

  // Parse and format admin suggestions text (handles markdown-like formatting)
  const formatAdminText = (text: string) => {
    if (!text) return null;
    
    const lines = text.split('\n');
    const sections: Array<{ type: 'heading' | 'bullet' | 'text' | 'discount' | 'savings' | 'finalPrice'; content: string; value?: string }> = [];
    
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      // Check for bold headings (e.g., **Pricing Details:**)
      if (trimmed.startsWith('**') && trimmed.endsWith(':**')) {
        const heading = trimmed.replace(/\*\*/g, '').replace(':', '');
        sections.push({ type: 'heading', content: heading });
      }
      // Check for discount section (🎉 Special Discount)
      else if (trimmed.includes('🎉') || trimmed.includes('Special Discount')) {
        sections.push({ type: 'discount', content: trimmed.replace(/\*\*/g, '').replace('🎉', '').trim() });
      }
      // Check for savings line (💰 You Save)
      else if (trimmed.includes('💰') || trimmed.includes('You Save')) {
        const savingsMatch = trimmed.match(/(\d[\d,]*)\s*TZS/);
        sections.push({ 
          type: 'savings', 
          content: trimmed.replace(/\*\*/g, '').replace('💰', '').trim(),
          value: savingsMatch ? savingsMatch[1] : undefined
        });
      }
      // Check for Final Price (bolded)
      else if (trimmed.includes('Final Price') && trimmed.includes('**')) {
        const priceMatch = trimmed.match(/(\d[\d,]*)\s*TZS/);
        sections.push({ 
          type: 'finalPrice', 
          content: trimmed.replace(/\*\*/g, '').trim(),
          value: priceMatch ? priceMatch[1] : undefined
        });
      }
      // Check for bold text (e.g., **Final Price:**)
      else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
        sections.push({ type: 'heading', content: trimmed.replace(/\*\*/g, '') });
      }
      // Check for bullet points
      else if (trimmed.startsWith('•')) {
        sections.push({ type: 'bullet', content: trimmed.substring(1).trim() });
      }
      // Regular text
      else {
        sections.push({ type: 'text', content: trimmed });
      }
    });
    
    return sections;
  };

  // Load audit history
  // Load conversation messages
  const loadConversationMessages = async (bookingId: number) => {
    setLoadingConversation(true);
    try {
      // Get all messages for this booking (including internal admin notes for admin view)
      const messages = await api.get(`/api/admin/group-stays/bookings/${bookingId}/messages`);
      if (messages.data.success && messages.data.messages) {
        const formattedMessages = messages.data.messages.map((m: any) => ({
          id: m.id,
          messageType: m.messageType || 'General',
          message: m.message || m.body,
          senderRole: m.senderRole,
          senderName: m.senderName || 'Unknown',
          createdAt: m.createdAt,
          formattedDate: m.formattedDate || new Date(m.createdAt).toLocaleString(),
        }));
        setConversationMessages(formattedMessages);
      } else {
        setConversationMessages([]);
      }
    } catch (err) {
      console.error("Failed to load conversation messages", err);
      setConversationMessages([]);
    } finally {
      setLoadingConversation(false);
    }
  };

  // Load audit history
  const loadAuditHistory = async (bookingId: number) => {
    setLoadingAuditHistory(true);
    try {
      const r = await api.get(`/api/admin/group-stays/bookings/${bookingId}/audit`);
      // Also get booking details to access adminNotes for SUGGESTIONS_PROVIDED entries
      const bookingR = await api.get(`/api/admin/group-stays/bookings/${bookingId}`);
      const adminNotes = bookingR.data.adminNotes;
      
      // Filter out message-related audit entries (they'll be shown in conversation)
      // Keep only non-message actions like STATUS_CHANGED, SUGGESTIONS_PROVIDED, etc.
      const filteredAudits = (r.data.items || []).filter((audit: any) => {
        return audit.action !== 'MESSAGE_SENT' && 
               audit.action !== 'CUSTOMER_MESSAGE_SENT' &&
               audit.action !== 'STATUS_CHANGED_TO_REVIEWING' &&
               audit.action !== 'STATUS_CHANGED_TO_PROCESSING';
      });
      
      // Enrich audit entries with adminNotes for SUGGESTIONS_PROVIDED
      const enrichedAudits = filteredAudits.map((audit: any) => {
        if (audit.action === 'SUGGESTIONS_PROVIDED' && adminNotes) {
          try {
            const parsed = typeof adminNotes === 'string' ? JSON.parse(adminNotes) : adminNotes;
            return {
              ...audit,
              adminSuggestions: parsed,
            };
          } catch (e) {
            return audit;
          }
        }
        return audit;
      });
      
      setAuditHistory(enrichedAudits);
    } catch (err) {
      console.error("Failed to load audit history", err);
      setAuditHistory([]);
    } finally {
      setLoadingAuditHistory(false);
    }
  };

  // Load passengers
  const loadPassengers = async (bookingId: number) => {
    setLoadingPassengers(true);
    try {
      const r = await api.get(`/api/admin/group-stays/passengers?bookingId=${bookingId}&pageSize=100`);
      setPassengers(r.data.items || []);
    } catch (err) {
      console.error("Failed to load passengers", err);
      setPassengers([]);
    } finally {
      setLoadingPassengers(false);
    }
  };

  // Load submitted claims for a group booking
  const loadClaims = async (bookingId: number) => {
    setClaimsLoading(true);
    // Prevent stale selections from a previously opened booking.
    setSelectedClaimIds([]);
    try {
      const response = await api.get(`/api/admin/group-stays/claims/${bookingId}`);
      setClaimsData(response.data);

      const serverRecommendedIds = Array.isArray(response.data?.recommendedClaimIds)
        ? response.data.recommendedClaimIds
        : [];
      const validIds = Array.isArray(response.data?.claims)
        ? new Set((response.data.claims as any[]).map((c: any) => Number(c?.id)).filter((v: any) => Number.isFinite(v)))
        : null;
      const initial = validIds ? serverRecommendedIds.filter((id: any) => validIds.has(Number(id))) : serverRecommendedIds;
      setSelectedClaimIds(Array.from(new Set(initial.map((v: any) => Number(v)).filter((v: any) => Number.isFinite(v)))));

      const shortlistIds = [
        response.data?.shortlist?.high?.id,
        response.data?.shortlist?.mid?.id,
        response.data?.shortlist?.low?.id,
      ].filter(Boolean);
      setShowShortlistOnly(shortlistIds.length > 0);
    } catch (err: any) {
      console.error("Failed to load claims:", err);
      setClaimsData(null);
    } finally {
      setClaimsLoading(false);
    }
  };

  // Toggle claim selection for recommendation (max 3)
  const toggleClaimSelection = (claimId: number) => {
    setSelectedClaimIds((prev) => {
      if (prev.includes(claimId)) {
        // Deselect
        return prev.filter((id) => id !== claimId);
      } else {
        // Select (max 3)
        if (prev.length >= 3) {
          alert("You can only select up to 3 claims for recommendation");
          return prev;
        }
        return [...prev, claimId];
      }
    });
  };

  // Submit selected claims as recommendations
  const handleRecommendClaims = async () => {
    if (!bookingDetails || selectedClaimIds.length === 0) return;
    
    setRecommendingClaims(true);
    try {
      const validIds = claimsData?.claims ? new Set(claimsData.claims.map((c: any) => Number(c.id)).filter((v: any) => Number.isFinite(v))) : null;
      const claimIds = validIds ? selectedClaimIds.filter((id) => validIds.has(id)) : selectedClaimIds;
      const uniqueClaimIds = Array.from(new Set(claimIds));
      if (uniqueClaimIds.length === 0) {
        setSelectedClaimIds([]);
        return;
      }
      if (uniqueClaimIds.length !== selectedClaimIds.length) {
        setSelectedClaimIds(uniqueClaimIds);
      }

      const response = await api.post(`/api/admin/group-stays/claims/${bookingDetails.id}/recommendations`, { claimIds: uniqueClaimIds });

      if (response.data.success) {
        // Reload claims to update status
        await loadClaims(bookingDetails.id);
        // Reload booking details
        await loadBookingDetails(bookingDetails.id);
        alert(`Successfully recommended ${uniqueClaimIds.length} claim(s) to customer`);
      }
    } catch (err: any) {
      console.error("Failed to recommend claims:", err);
      alert(err?.response?.data?.error || "Failed to recommend claims");
    } finally {
      setRecommendingClaims(false);
    }
  };

  const handleStartClaimsReview = async () => {
    if (!bookingDetails) return;
    setStartingClaimsReview(true);
    try {
      const r = await api.post(`/api/admin/group-stays/claims/${bookingDetails.id}/start-review`);

      if (r.data?.success) {
        await loadClaims(bookingDetails.id);
        await loadBookingDetails(bookingDetails.id);
        alert("Claims marked as REVIEWING");
      }
    } catch (err: any) {
      console.error("Failed to start claims review:", err);
      alert(err?.response?.data?.error || "Failed to start review");
    } finally {
      setStartingClaimsReview(false);
    }
  };

  const handleUpdateClaimStatus = async (claimId: number, status: string) => {
    if (!bookingDetails) return;
    
    try {
      const response = await api.patch(`/api/admin/group-stays/claims/${claimId}/status`, {
        status,
      });

      if (response.data.success) {
        // Reload claims to update
        await loadClaims(bookingDetails.id);
      }
    } catch (err: any) {
      console.error("Failed to update claim status:", err);
      alert(err?.response?.data?.error || "Failed to update claim status");
    }
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setBookingDetails(null);
    setQuickMessage("");
    setShowPassengers(false);
    setShowArrangementNotes(false);
    setPassengers([]);
    setClaimsData(null);
    setSelectedClaimIds([]);
    setClaimsFilter("all");
    setComparisonView("grid");
    setShowShortlistOnly(true);
  };

  // Handle sending quick message to customer
  const handleSendQuickMessage = async () => {
    if (!bookingDetails || !quickMessage.trim()) return;
    
    setSendingMessage(true);
    try {
      const response = await api.post(`/api/admin/group-stays/bookings/${bookingDetails.id}/message`, {
        message: quickMessage.trim(),
      });
      
      // Reload audit history and conversation
      await loadAuditHistory(bookingDetails.id);
      await loadConversationMessages(bookingDetails.id);
      
      // Reload booking details if status changed
      if (response.data.statusChanged && response.data.newStatus) {
        await loadBookingDetails(bookingDetails.id);
        // Reload list to reflect status change
        load();
      }
      
      window.dispatchEvent(
        new CustomEvent("nols:toast", {
          detail: { 
            type: "success", 
            title: "Message Sent", 
            message: response.data.statusChanged 
              ? `Message sent and status updated to ${response.data.newStatus}. Customer has been notified.`
              : "Your message has been sent to the customer and logged in audit history.", 
            duration: 3000 
          },
        })
      );
      setQuickMessage("");
    } catch (err: any) {
      console.error("Failed to send message", err);
      alert(err?.response?.data?.error || "Failed to send message. Please try again.");
    } finally {
      setSendingMessage(false);
    }
  };

  // Handle status update
  const handleUpdateStatus = async (newStatus: string) => {
    if (!bookingDetails) return;
    
    setUpdatingStatus(true);
    try {
      await api.patch(`/api/admin/group-stays/bookings/${bookingDetails.id}`, {
        status: newStatus,
      });
      
      // Reload audit history and conversation
      await loadAuditHistory(bookingDetails.id);
      await loadConversationMessages(bookingDetails.id);
      
      window.dispatchEvent(
        new CustomEvent("nols:toast", {
          detail: { 
            type: "success", 
            title: "Status Updated", 
            message: `Booking status updated to ${newStatus}.`, 
            duration: 3000 
          },
        })
      );
      
      // Reload booking details
      if (bookingDetails.id) {
        loadBookingDetails(bookingDetails.id);
      }
      // Reload list
      load();
    } catch (err: any) {
      console.error("Failed to update status", err);
      alert(err?.response?.data?.error || "Failed to update status. Please try again.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Search properties for recommendation
  const handleSearchProperties = async () => {
    if (!bookingDetails) return;
    
    setPropertySearchLoading(true);
    try {
      const params: any = {
        region: bookingDetails.toRegion,
        page: 1,
        pageSize: 20,
      };
      
      if (bookingDetails.toDistrict) {
        params.district = bookingDetails.toDistrict;
      }
      
      if (bookingDetails.accommodationType) {
        params.accommodationType = bookingDetails.accommodationType;
      }
      
      if (bookingDetails.roomsNeeded) {
        params.minRooms = bookingDetails.roomsNeeded;
      }
      
      if (bookingDetails.headcount) {
        params.headcount = bookingDetails.headcount;
      }
      
      const r = await api.get("/api/admin/group-stays/recommendations/search", { params });
      setPropertySearchResults(r.data.items || []);
      setShowPropertySearch(true);
    } catch (err: any) {
      console.error("Failed to search properties", err);
      alert("Failed to search properties. Please try again.");
    } finally {
      setPropertySearchLoading(false);
    }
  };

  // Add property to selection
  const handleAddProperty = (property: any) => {
    if (selectedProperties.length >= 2) {
      alert("You can only select up to 2 properties");
      return;
    }
    if (selectedProperties.find(p => p.id === property.id)) {
      alert("Property already selected");
      return;
    }
    setSelectedProperties([...selectedProperties, property]);
  };

  // Remove property from selection
  const handleRemoveProperty = (propertyId: number) => {
    setSelectedProperties(selectedProperties.filter(p => p.id !== propertyId));
  };

  // Attach recommended properties to booking
  const handleAttachProperties = async () => {
    if (!bookingDetails || selectedProperties.length === 0) return;
    
    setAttachingProperties(true);
    try {
      const propertyIds = selectedProperties.map(p => p.id);
      await api.patch(`/api/admin/group-stays/recommendations/bookings/${bookingDetails.id}/recommendations`, {
        propertyIds,
      });
      
      setRecommendedPropertyIds(propertyIds);
      setShowPropertySearch(false);
      
      window.dispatchEvent(
        new CustomEvent("nols:toast", {
          detail: { 
            type: "success", 
            title: "Properties Attached", 
            message: `${selectedProperties.length} propert${selectedProperties.length > 1 ? 'ies' : 'y'} attached to booking. Customer will be notified.`, 
            duration: 3000 
          },
        })
      );
      
      // Reload booking details
      if (bookingDetails.id) {
        loadBookingDetails(bookingDetails.id);
      }
      load();
    } catch (err: any) {
      console.error("Failed to attach properties", err);
      alert(err?.response?.data?.error || "Failed to attach properties. Please try again.");
    } finally {
      setAttachingProperties(false);
    }
  };

  // Normalize date to string for stable dependency array
  const dateKey = useMemo(() => {
    if (Array.isArray(date)) {
      return `${date[0] || ''}-${date[1] || ''}`;
    }
    return String(date || '');
  }, [date]);

  // Check for bookingId in URL params and open modal when list is loaded
  useEffect(() => {
    const bookingIdParam = searchParams?.get("bookingId");
    if (bookingIdParam && !isNaN(Number(bookingIdParam)) && !loading && list.length > 0) {
      const bookingId = Number(bookingIdParam);
      const existingBooking = list.find((b) => b.id === bookingId);
      if (existingBooking) {
        loadBookingDetails(bookingId);
        // Clean up URL without reloading
        window.history.replaceState({}, "", "/admin/group-stays/bookings");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, list, searchParams]);

  useEffect(() => {
    authify();
    load();
    loadStatusCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, groupType, dateKey, q]);

  useEffect(() => {
    authify();
    loadHistogram();
  }, [loadHistogram]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const recommendedClaimIds = Array.isArray(claimsData?.recommendedClaimIds) ? claimsData.recommendedClaimIds : [];
  const shortlistClaimIds = [
    claimsData?.shortlist?.high?.id,
    claimsData?.shortlist?.mid?.id,
    claimsData?.shortlist?.low?.id,
  ].filter(Boolean) as number[];

  // Prepare histogram chart data
  const histogramChartData = useMemo<ChartData<"bar">>(() => {
    if (!histogramData || histogramData.stats.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const labels = histogramData.stats.map((s) => {
      const d = new Date(s.date);
      return histogramPeriod === "year"
        ? d.toLocaleDateString("en-US", { month: "short" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });

    return {
      labels,
      datasets: [
        {
          label: "Total Bookings",
          data: histogramData.stats.map((s) => s.count),
          backgroundColor: "rgba(139, 92, 246, 0.8)", // Purple
          borderColor: "rgba(139, 92, 246, 1)",
          borderWidth: 1,
        },
        {
          label: "Confirmed",
          data: histogramData.stats.map((s) => s.confirmed),
          backgroundColor: "rgba(59, 130, 246, 0.8)", // Blue
          borderColor: "rgba(59, 130, 246, 1)",
          borderWidth: 1,
        },
      ],
    };
  }, [histogramData, histogramPeriod]);

  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-solid border-gray-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 ring-1 ring-inset ring-purple-100 sm:h-12 sm:w-12">
            <UsersRound className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold tracking-tight text-gray-900 sm:text-xl">Group Stay Bookings</h1>
            <p className="m-0 mt-0.5 text-xs text-gray-500 sm:text-sm">View and manage all group accommodation bookings</p>
          </div>
        </div>
        <Link
          href="/admin/group-stays"
          className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-solid border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 no-underline transition-colors hover:border-gray-300 hover:bg-gray-50 hover:no-underline sm:self-auto"
        >
          <BarChart3 className="h-3.5 w-3.5 text-purple-600" />
          Group Stays overview
        </Link>
      </div>

      {/* Search and Filters */}
      <div className="rounded-xl border border-solid border-gray-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden box-border">
        {/* Top Row: Search and Date Picker */}
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
          <div className="relative w-full min-w-0 sm:flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              className="box-border h-10 w-full rounded-lg border border-solid border-gray-200 bg-gray-50/60 pl-10 pr-10 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-purple-400 focus:bg-white focus:ring-4 focus:ring-purple-100"
              placeholder="Search bookings"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search bookings"
              title="Search bookings"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setPage(1);
                  load();
                }
              }}
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setPage(1);
                  load();
                }}
                className="absolute right-2.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Date Picker */}
          <div className="relative w-full sm:w-auto sm:flex-shrink-0">
            {(() => {
              const dateCount = Array.isArray(date) ? date.filter(Boolean).length : date ? 1 : 0;
              return (
                <button
                  type="button"
                  onClick={() => {
                    setPickerAnim(true);
                    setTimeout(() => setPickerAnim(false), 350);
                    setPickerOpen((v) => !v);
                  }}
                  className={`box-border inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-solid px-3.5 text-sm font-medium transition-all sm:w-auto ${
                    dateCount > 0
                      ? "border-purple-300 bg-purple-50 text-purple-700"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  } ${pickerAnim ? "ring-4 ring-purple-100" : ""}`}
                >
                  <Calendar className="h-4 w-4" />
                  <span>{dateCount === 0 ? "Any date" : dateCount === 1 ? "1 date" : `${dateCount} dates`}</span>
                </button>
              );
            })()}
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                  <DatePicker
                    selected={date || undefined}
                    onSelectAction={(s) => {
                      setDate(s as string | string[]);
                      setPage(1);
                    }}
                    onCloseAction={() => setPickerOpen(false)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Status tiles */}
        <div className="grid grid-cols-2 gap-2.5 px-4 pb-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
          {[
            { label: "All bookings", value: "", icon: UsersRound, tone: "text-purple-600 bg-purple-50", active: "border-purple-400 bg-purple-50/60 ring-purple-100", count: "text-purple-700" },
            { label: "Pending", value: "PENDING", icon: Clock, tone: "text-slate-600 bg-slate-100", active: "border-slate-400 bg-slate-50 ring-slate-100", count: "text-slate-800" },
            { label: "Confirmed", value: "CONFIRMED", icon: CheckCircle, tone: "text-emerald-600 bg-emerald-50", active: "border-emerald-400 bg-emerald-50/60 ring-emerald-100", count: "text-emerald-700" },
            { label: "Processing", value: "PROCESSING", icon: Loader2, tone: "text-blue-600 bg-blue-50", active: "border-blue-400 bg-blue-50/60 ring-blue-100", count: "text-blue-700" },
            { label: "Completed", value: "COMPLETED", icon: CheckCircle2, tone: "text-teal-600 bg-teal-50", active: "border-teal-400 bg-teal-50/60 ring-teal-100", count: "text-teal-700" },
            { label: "Canceled", value: "CANCELED", icon: XCircle, tone: "text-rose-600 bg-rose-50", active: "border-rose-400 bg-rose-50/60 ring-rose-100", count: "text-rose-700" },
          ].map((s) => {
            const Icon = s.icon;
            const isActive = status === s.value;
            const count = statusCounts[s.value] || 0;

            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setStatus(s.value);
                  // Clear groupType filter when clicking "All bookings" to show all types
                  if (s.value === "") {
                    setGroupType("");
                  }
                  setPage(1);
                  setTimeout(() => load(), 0);
                }}
                className={`flex items-center gap-3 rounded-xl border border-solid px-3.5 py-3 text-left transition-all duration-200 ${
                  isActive
                    ? `${s.active} ring-4`
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/70"
                }`}
              >
                <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${s.tone}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-gray-500">{s.label}</span>
                  <span className={`block text-xl font-bold leading-tight tabular-nums ${isActive ? s.count : "text-gray-900"}`}>
                    {loading && !statusCounts[s.value] ? "..." : count.toLocaleString()}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Group Type Filters */}
        <div className="flex items-center gap-3 border-0 border-t border-solid border-gray-100 bg-gray-50/50 px-4 py-3 sm:px-5">
          <span className="flex-shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">Type</span>
          <div className="flex min-w-0 gap-1.5 overflow-x-auto scrollbar-hide">
            {[
              { label: "All types", value: "" },
              { label: "Family", value: "family" },
              { label: "Workers", value: "workers" },
              { label: "Event", value: "event" },
              { label: "Students", value: "students" },
              { label: "Team", value: "team" },
              { label: "Other", value: "other" },
            ].map((gt) => {
              const isActive = groupType === gt.value;
              return (
                <button
                  key={gt.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setGroupType(gt.value);
                    setPage(1);
                    setTimeout(() => load(), 0);
                  }}
                  className={`flex-shrink-0 whitespace-nowrap rounded-full border border-solid px-3 py-1 text-xs font-semibold transition-colors ${
                    isActive
                      ? "border-purple-600 bg-purple-600 text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
                  }`}
                >
                  {gt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <>
            {/* Skeleton Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  {/* Same header row as the NRMS reservations table. */}
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="whitespace-nowrap px-4 py-3">Booking</th>
                    <th className="whitespace-nowrap px-4 py-3">Group</th>
                    <th className="whitespace-nowrap px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3">Destination</th>
                    <th className="whitespace-nowrap px-4 py-3">Check-in</th>
                    <th className="whitespace-nowrap px-4 py-3 text-center">Status</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {[16, 28, 32, 28, 24, 20, 14].map((w, c) => (
                        <td key={c} className="border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <div className="h-3.5 rounded bg-neutral-200" style={{ width: `${w * 0.25}rem`, marginLeft: c === 6 ? "auto" : undefined }} />
                          {c > 0 && c < 5 ? <div className="mt-1.5 h-2.5 w-16 rounded bg-neutral-100" /> : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : list.length === 0 ? (
          <>
            <div className="px-6 py-12 text-center">
              <UsersRound className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No bookings found.</p>
              <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
            </div>

            {/* Booking Statistics Histogram */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm group transition-all duration-300 hover:shadow-lg hover:border-purple-300 hover:-translate-y-1">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-purple-600 transition-colors duration-300">
                    <BarChart3 className="h-5 w-5 text-purple-600 group-hover:scale-110 transition-transform duration-300" />
                    Booking Statistics
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Visualize booking data over time</p>
                </div>

                {/* Period Filter */}
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: "7 Days", value: "7d" },
                    { label: "30 Days", value: "30d" },
                    { label: "This Month", value: "month" },
                    { label: "This Year", value: "year" },
                  ].map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setHistogramPeriod(p.value)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                        histogramPeriod === p.value
                          ? "bg-purple-50 border-purple-300 text-purple-700 scale-105 shadow-md"
                          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:scale-105 hover:shadow-sm"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {histogramLoading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-purple-600"></div>
                </div>
              ) : histogramData?.stats && histogramData.stats.length > 0 ? (
                <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
                  <Chart
                    type="bar"
                    data={histogramChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: true,
                          position: "top",
                          labels: {
                            padding: 15,
                            font: {
                              size: 12,
                            },
                            usePointStyle: true,
                          },
                        },
                        tooltip: {
                          callbacks: {
                            label: (context: any) => {
                              const label = context.dataset.label || "";
                              const value = context.parsed.y || 0;
                              return `${label}: ${value} bookings`;
                            },
                          },
                        },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            stepSize: 1,
                            font: {
                              size: 11,
                            },
                          },
                          grid: {
                            color: "rgba(0, 0, 0, 0.1)",
                          },
                          title: {
                            display: true,
                            text: "Number of Bookings",
                            font: {
                              size: 12,
                            },
                          },
                        },
                        x: {
                          grid: {
                            display: false,
                          },
                          ticks: {
                            font: {
                              size: 11,
                            },
                            maxRotation: 45,
                            minRotation: 45,
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-64 w-full flex flex-col justify-end p-4">
                  {/* Skeleton Chart */}
                  <div className="relative h-full w-full">
                    {/* Y-axis skeleton */}
                    <div className="absolute left-0 top-0 bottom-8 w-8 flex flex-col justify-between">
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                    </div>

                    {/* Chart area skeleton */}
                    <div className="ml-10 h-full relative">
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex flex-col justify-between">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className="h-px bg-gray-200"></div>
                        ))}
                      </div>

                      {/* Skeleton bars */}
                      <div className="absolute bottom-0 left-0 right-0 h-full flex items-end justify-around px-2">
                        {[...Array(7)].map((_, i) => (
                          <div
                            key={i}
                            className="w-8 bg-gray-200 rounded-t animate-pulse"
                            style={{ height: `${Math.random() * 70 + 30}%` }}
                          ></div>
                        ))}
                      </div>

                      {/* X-axis labels skeleton */}
                      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2">
                        {[...Array(7)].map((_, i) => (
                          <div key={i} className="h-3 w-10 bg-gray-200 rounded animate-pulse"></div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Desktop Table: follows the NRMS reservations table (two lines per cell at most) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  {/* Same header row as the NRMS reservations table. */}
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="whitespace-nowrap px-4 py-3">Booking</th>
                    <th className="whitespace-nowrap px-4 py-3">Group</th>
                    <th className="whitespace-nowrap px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3">Destination</th>
                    <th className="whitespace-nowrap px-4 py-3">Check-in</th>
                    <th className="whitespace-nowrap px-4 py-3 text-center">Status</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((booking) => {
                    const checkIn = booking.checkIn ? new Date(booking.checkIn) : null;
                    const checkOut = booking.checkOut ? new Date(booking.checkOut) : null;
                    const nights = checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000)) : null;
                    return (
                      <tr key={booking.id} className="transition-colors hover:bg-neutral-50/80">
                        <td className="whitespace-nowrap border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-700">
                            GS-{String(booking.id).padStart(4, "0")}
                          </span>
                        </td>
                        <td className="max-w-[13rem] border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <div className="truncate font-bold text-neutral-900">{humanizeGroupLabel(booking.groupType)}</div>
                          <div className="mt-0.5 text-xs text-neutral-400">
                            {booking.headcount} {booking.headcount === 1 ? "guest" : "guests"} · {booking.roomsNeeded} {booking.roomsNeeded === 1 ? "room" : "rooms"}
                          </div>
                        </td>
                        <td className="max-w-[15rem] border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <div className="truncate font-bold text-neutral-900" title={booking.user?.name || undefined}>{booking.user?.name || "Unknown customer"}</div>
                          {booking.user?.email ? <div className="mt-0.5 truncate text-xs text-neutral-400" title={booking.user.email}>{booking.user.email}</div> : null}
                        </td>
                        <td className="max-w-[15rem] border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <div className="truncate font-semibold text-neutral-800">{booking.toRegion ? formatPlaceName(booking.toRegion) : "Not set"}</div>
                          {booking.toDistrict ? <div className="mt-0.5 truncate text-xs text-neutral-400">{formatPlaceName(booking.toDistrict)}</div> : null}
                        </td>
                        <td className="whitespace-nowrap border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          {checkIn ? (
                            <>
                              <div className="font-semibold text-neutral-800">{checkIn.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
                              <div className="mt-0.5 text-xs text-neutral-400">{nights != null ? `${nights} ${nights === 1 ? "night" : "nights"}` : "Open checkout"}</div>
                            </>
                          ) : (
                            <div className="font-semibold text-neutral-400">Flexible</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap border-0 border-t border-solid border-neutral-100 px-4 py-3.5 text-center">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusPillClasses(booking.status)}`}>
                            {booking.status.replace(/_/g, " ").toLowerCase()}
                          </span>
                        </td>
                        <td className="whitespace-nowrap border-0 border-t border-solid border-neutral-100 px-4 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleViewBooking(booking)}
                            className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-800"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-gray-200">
              {list.map((booking) => (
                <div key={booking.id} className="p-4 bg-white hover:bg-gray-50 transition-colors duration-150">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-900">#{booking.id}</span>
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${badgeClasses(booking.status)}`}>
                      {booking.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <User className="h-4 w-4 text-gray-400" />
                    <span>Customer: {booking.user?.name || "N/A"}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <Users className="h-4 w-4 text-gray-400" />
                    <span>Type: {booking.groupType} • {booking.headcount} people ({booking.roomsNeeded} rooms)</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span>Destination: {booking.toRegion}{booking.toDistrict ? `, ${booking.toDistrict}` : ""}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span>Check-In: {booking.checkIn ? new Date(booking.checkIn).toLocaleDateString() : "Flexible"}</span>
                  </div>
                  <div className="mt-3 text-right">
                    <button 
                      onClick={() => handleViewBooking(booking)}
                      className="text-purple-600 hover:text-purple-900 text-sm transition-colors"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Pagination: the shared table footer used by the NRMS reservations table */}
        {!loading && list.length > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={(next) => setPage(Math.min(pages, Math.max(1, next)))}
          />
        )}
      </div>

      {/* Booking Details Modal */}
      {showDetailsModal && (
        <>
          <div
            className="fixed inset-0 z-50 bg-neutral-950/50 backdrop-blur-sm"
            onClick={closeDetailsModal}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-6">
            <div className="box-border flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-neutral-50 shadow-2xl">
              {/* Header: identity, status and close in one row */}
              <div className="flex items-start gap-3 border-0 border-b border-solid border-neutral-200 bg-white px-4 py-4 sm:gap-4 sm:px-6">
                <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 ring-1 ring-inset ring-purple-100">
                  <UsersRound className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-lg font-bold tracking-tight text-neutral-900">
                      {bookingDetails ? `Booking GS-${String(bookingDetails.id).padStart(4, "0")}` : "Booking details"}
                    </h2>
                    {bookingDetails ? (
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusPillClasses(bookingDetails.status)}`}>
                        {bookingDetails.status.replace(/_/g, " ").toLowerCase()}
                      </span>
                    ) : null}
                  </div>
                  <p className="m-0 mt-1 text-xs text-neutral-500">
                    {bookingDetails
                      ? `Created ${new Date(bookingDetails.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} at ${new Date(bookingDetails.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                      : "Group stay booking"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDetailsModal}
                  className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900"
                  aria-label="Close modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                {detailsLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="text-center">
                      <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-purple-600" />
                      <p className="m-0 text-sm text-neutral-500">Loading booking details...</p>
                    </div>
                  </div>
                ) : bookingDetails ? (
                  <div className="space-y-4">
                    {/* Key facts */}
                    {(() => {
                      const checkIn = bookingDetails.checkIn ? new Date(bookingDetails.checkIn) : null;
                      const checkOut = bookingDetails.checkOut ? new Date(bookingDetails.checkOut) : null;
                      const nights = checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000)) : null;
                      const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                      const facts = [
                        { icon: UsersRound, label: "Group", value: humanizeGroupLabel(bookingDetails.groupType), sub: bookingDetails.accommodationType ? humanizeGroupLabel(bookingDetails.accommodationType) : null },
                        { icon: Users, label: "Guests", value: `${bookingDetails.headcount} ${bookingDetails.headcount === 1 ? "guest" : "guests"}`, sub: `${bookingDetails.roomsNeeded} ${bookingDetails.roomsNeeded === 1 ? "room" : "rooms"} needed` },
                        { icon: MapPin, label: "Destination", value: bookingDetails.toRegion ? formatPlaceName(bookingDetails.toRegion) : "Not set", sub: [bookingDetails.toDistrict ? formatPlaceName(bookingDetails.toDistrict) : null, bookingDetails.toLocation].filter(Boolean).join(" · ") || null },
                        { icon: Calendar, label: "Stay", value: checkIn ? fmt(checkIn) : "Flexible dates", sub: checkIn ? `${checkOut ? `to ${fmt(checkOut)}` : "Open checkout"}${nights != null ? ` · ${nights} ${nights === 1 ? "night" : "nights"}` : ""}` : null },
                      ];
                      const gender = [
                        { label: "Male", value: bookingDetails.maleCount },
                        { label: "Female", value: bookingDetails.femaleCount },
                        { label: "Other", value: bookingDetails.otherCount },
                      ].filter((g) => g.value && g.value > 0);
                      return (
                        <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                          {/* 1px gaps over a tinted grid draw the dividers at every breakpoint */}
                          <div className="grid grid-cols-1 gap-px bg-neutral-100 sm:grid-cols-2 lg:grid-cols-4">
                            {facts.map((fact) => {
                              const Icon = fact.icon;
                              return (
                                <div
                                  key={fact.label}
                                  className="flex min-w-0 items-start gap-3 bg-white p-4"
                                >
                                  <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                                    <Icon className="h-4 w-4" />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">{fact.label}</p>
                                    <p className="m-0 mt-0.5 truncate text-sm font-bold text-neutral-900" title={fact.value}>{fact.value}</p>
                                    {fact.sub ? <p className="m-0 mt-0.5 truncate text-xs text-neutral-500" title={fact.sub}>{fact.sub}</p> : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {gender.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-2.5">
                              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Group mix</span>
                              {gender.map((g) => (
                                <span key={g.label} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
                                  {g.label} <span className="tabular-nums text-neutral-900">{g.value}</span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}

                    {/* Earnings split: NoLSAF commission is the deposit; the owner collects the balance at the property */}
                    {(() => {
                      const isRelevant = !!bookingDetails.checkedInAt || ["CONFIRMED", "COMPLETED"].includes(String(bookingDetails.status).toUpperCase());
                      if (!isRelevant) return null;

                      const cur = bookingDetails.currency || "TZS";
                      const total = Number(bookingDetails.totalAmount || 0);
                      const deposit = Number(bookingDetails.depositAmount || 0);
                      const ownerCollects = Math.max(0, Math.round(total - deposit));
                      const money = (n: number) => `${cur} ${Math.round(n).toLocaleString("en-US")}`;

                      return (
                        <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                          <div className="mb-3 flex items-center gap-2">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                              <DollarSign className="h-4 w-4" />
                            </span>
                            <h4 className="m-0 text-sm font-bold text-neutral-900">Earnings split</h4>
                            {bookingDetails.checkedInAt && (
                              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                <CheckCircle className="h-3.5 w-3.5" /> Checked in
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
                              <p className="m-0 text-[11px] font-semibold text-neutral-500">Booking total</p>
                              <p className="m-0 mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{money(total)}</p>
                            </div>
                            <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
                              <p className="m-0 text-[11px] font-semibold text-neutral-500">NoLSAF commission (deposit)</p>
                              <p className="m-0 mt-0.5 text-sm font-bold tabular-nums text-neutral-900">{money(deposit)}</p>
                            </div>
                            <div className="rounded-lg bg-emerald-50 px-3 py-2.5">
                              <p className="m-0 text-[11px] font-semibold text-emerald-700">Owner collects at property</p>
                              <p className="m-0 mt-0.5 text-sm font-bold tabular-nums text-emerald-800">{money(ownerCollects)}</p>
                            </div>
                          </div>
                          <p className="m-0 mt-3 text-xs leading-relaxed text-neutral-500">
                            NoLSAF&apos;s commission is the deposit the guest paid online. The owner collects the balance ({money(ownerCollects)}) directly from the guest at the property. NoLSAF does not disburse anything to the owner.
                          </p>
                        </div>
                      );
                    })()}

                    {/* Customer */}
                    {bookingDetails.user && (
                      <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-purple-50 text-sm font-bold text-purple-700">
                            {(bookingDetails.user.name || bookingDetails.user.email || "?").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Customer</p>
                            <p className="m-0 mt-0.5 truncate text-sm font-bold text-neutral-900">{bookingDetails.user.name || "Unknown customer"}</p>
                          </div>
                          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                            {bookingDetails.user.email ? (
                              <a
                                href={`mailto:${bookingDetails.user.email}`}
                                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 no-underline transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-800 hover:no-underline"
                              >
                                <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="truncate">{bookingDetails.user.email}</span>
                              </a>
                            ) : null}
                            {bookingDetails.user.phone ? (
                              <a
                                href={`tel:${bookingDetails.user.phone}`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 no-underline transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-800 hover:no-underline"
                              >
                                <Phone className="h-3.5 w-3.5" />
                                {bookingDetails.user.phone}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Arrangements */}
                    {(bookingDetails.arrPickup || bookingDetails.arrTransport || bookingDetails.arrMeals || bookingDetails.arrGuide || bookingDetails.arrEquipment) && (
                      <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                        {/* Title and requested services share one row; chips wrap under the title on small screens */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                              <FileText className="h-3.5 w-3.5" />
                            </span>
                            <h4 className="m-0 text-sm font-bold text-neutral-900">Arrangements</h4>
                          </div>
                          <div className="flex flex-wrap gap-1.5 sm:ml-auto">
                            {[
                              { on: bookingDetails.arrPickup, icon: Truck, label: "Pickup" },
                              { on: bookingDetails.arrTransport, icon: Bus, label: "Transport" },
                              { on: bookingDetails.arrMeals, icon: Coffee, label: "Meals" },
                              { on: bookingDetails.arrGuide, icon: User, label: "Guide" },
                              { on: bookingDetails.arrEquipment, icon: Wrench, label: "Equipment" },
                            ].filter((a) => a.on).map((a) => {
                              const Icon = a.icon;
                              return (
                                <span key={a.label} className="inline-flex items-center gap-1 rounded-full border border-solid border-neutral-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-neutral-700">
                                  <Icon className="h-3 w-3 text-indigo-600" />
                                  {a.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        {((bookingDetails as any).pickupLocation || (bookingDetails as any).pickupTime) && (
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-neutral-50 px-3 py-2.5 text-sm">
                            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Pickup</span>
                            {(bookingDetails as any).pickupLocation && (
                              <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-neutral-900">
                                <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
                                <span className="truncate">{(bookingDetails as any).pickupLocation}</span>
                              </span>
                            )}
                            {(bookingDetails as any).pickupTime && (
                              <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-neutral-900">
                                <Clock className="h-3.5 w-3.5 text-neutral-400" />
                                {(bookingDetails as any).pickupTime}
                              </span>
                            )}
                          </div>
                        )}

                        {(bookingDetails as any).arrangementNotes && (() => {
                          const notes = String((bookingDetails as any).arrangementNotes);
                          const long = notes.length > 220 || notes.split("\n").length > 3;
                          return (
                            <div className="mt-3 border-0 border-l-2 border-solid border-indigo-200 pl-3">
                              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Notes from the customer</p>
                              <p className={`m-0 mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 ${long && !showArrangementNotes ? "line-clamp-3" : ""}`}>
                                {notes}
                              </p>
                              {long && (
                                <button
                                  type="button"
                                  onClick={() => setShowArrangementNotes((v) => !v)}
                                  className="mt-1 border-0 bg-transparent p-0 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                >
                                  {showArrangementNotes ? "Show less" : "Show more"}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Passengers List - Collapsible */}
                    {passengers.length > 0 && (
                      <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                        {/* Slim one-line toggle. m-0 matters: preflight is off, so h4/p keep UA margins. */}
                        <button
                          type="button"
                          onClick={() => setShowPassengers(!showPassengers)}
                          aria-expanded={showPassengers}
                          className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left transition-colors hover:bg-neutral-50"
                        >
                          <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-teal-50">
                            <Users className="h-3.5 w-3.5 text-teal-600" />
                          </span>
                          <h4 className="m-0 text-sm font-semibold text-neutral-900">Passengers</h4>
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-600">
                            {passengers.length} registered
                          </span>
                          <ChevronDown className={`ml-auto h-4 w-4 flex-shrink-0 text-neutral-400 transition-transform duration-200 ${showPassengers ? "rotate-180" : ""}`} />
                        </button>
                        <div 
                          className={`overflow-hidden transition-all duration-300 ease-in-out ${
                            showPassengers ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                          }`}
                        >
                          <div className="p-4 pt-0">
                            {loadingPassengers ? (
                              <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                {passengers.map((passenger) => (
                                  <div
                                    key={passenger.id}
                                    className="bg-gray-50 rounded-lg border border-gray-200 p-2.5 flex items-start gap-2.5 transition-shadow duration-200 hover:shadow-sm"
                                  >
                                    <div className="h-8 w-8 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                                      <User className="h-3.5 w-3.5 text-teal-600" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-medium text-gray-900">
                                        {passenger.firstName} {passenger.lastName}
                                      </div>
                                      <div className="flex flex-col gap-1 mt-1">
                                        {passenger.nationality && (
                                          <div className="flex items-center gap-1 text-xs text-gray-600">
                                            <Globe className="h-3 w-3" />
                                            {passenger.nationality}
                                          </div>
                                        )}
                                        {passenger.phone && (
                                          <div className="flex items-center gap-1 text-xs text-gray-600">
                                            <Phone className="h-3 w-3" />
                                            <a href={`tel:${passenger.phone}`} className="hover:text-teal-600 transition-colors">
                                              {passenger.phone}
                                            </a>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Additional Notes - Enhanced */}
                    {(bookingDetails as any).notes && (
                      <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                        <h4 className="m-0 mb-3 text-sm font-bold text-neutral-900 flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center">
                            <FileText className="h-4 w-4 text-slate-600" />
                          </div>
                          Additional Notes
                        </h4>
                        <div className="rounded-lg border border-solid border-neutral-100 bg-neutral-50/60 p-4">
                          <p className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">{(bookingDetails as any).notes}</p>
                        </div>
                      </div>
                    )}

                    {/* Conversation Messages Section - Collapsible */}
                    {(conversationMessages.length > 0 || loadingConversation) && (
                      <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                        <button
                          type="button"
                          onClick={() => setShowConversation(!showConversation)}
                          aria-expanded={showConversation}
                          className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left transition-colors hover:bg-neutral-50"
                        >
                          <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-blue-50">
                            <MessageSquare className="h-3.5 w-3.5 text-blue-600" />
                          </span>
                          <h4 className="m-0 text-sm font-semibold text-neutral-900">Conversation</h4>
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral-600">
                            {conversationMessages.length} {conversationMessages.length === 1 ? "message" : "messages"}
                          </span>
                          <ChevronDown className={`ml-auto h-4 w-4 flex-shrink-0 text-neutral-400 transition-transform duration-200 ${showConversation ? "rotate-180" : ""}`} />
                        </button>
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-in-out ${
                            showConversation ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                          }`}
                        >
                          {/* Chat thread: customer on the left, admin on the right. Scrolls instead of growing the modal. */}
                          <div className="max-h-80 space-y-2.5 overflow-y-auto border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-3 py-3 sm:px-4">
                            {loadingConversation ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
                              </div>
                            ) : conversationMessages.length === 0 ? (
                              <p className="m-0 py-6 text-center text-sm text-neutral-500">No messages yet.</p>
                            ) : (
                              conversationMessages.map((msg: any) => {
                                const fromAdmin = msg.senderRole === "ADMIN";
                                const sentAt = msg.createdAt ? new Date(msg.createdAt) : null;
                                const when = sentAt && !Number.isNaN(sentAt.getTime())
                                  ? sentAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                                  : msg.formattedDate;
                                // "STATUS_CHANGED_TO_REVIEWING" -> "Status changed to reviewing"
                                const topic = msg.messageType && msg.messageType !== "General"
                                  ? String(msg.messageType).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())
                                  : null;
                                return (
                                  <div key={msg.id} className={`flex ${fromAdmin ? "justify-end" : "justify-start"}`}>
                                    <div className="max-w-[85%] sm:max-w-[75%]">
                                      <div className={`mb-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-neutral-400 ${fromAdmin ? "justify-end" : ""}`}>
                                        <span className={`font-semibold ${fromAdmin ? "text-blue-700" : "text-emerald-700"}`}>
                                          {fromAdmin ? "Admin" : "Customer"}
                                        </span>
                                        <span className="text-neutral-500">{msg.senderName}</span>
                                        {topic ? <span>· {topic}</span> : null}
                                        <span>· {when}</span>
                                      </div>
                                      <div
                                        className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                                          fromAdmin
                                            ? "rounded-tr-md bg-blue-600 text-white"
                                            : "rounded-tl-md border border-solid border-neutral-200 bg-white text-neutral-800"
                                        }`}
                                      >
                                        {String(msg.message ?? "").trim()}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Suggestions & Recommendations - Independent Cards */}
                    {auditHistory.filter((a: any) => a.action === 'SUGGESTIONS_PROVIDED' && a.adminSuggestions).length > 0 && (
                      <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                        <h4 className="m-0 mb-4 text-sm font-bold text-neutral-900 flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg bg-[#02665e] flex items-center justify-center">
                            <Sparkles className="h-4 w-4 text-white" />
                          </div>
                          Recommendations & Suggestions
                        </h4>
                        <div className="space-y-4">
                          {auditHistory
                            .filter((a: any) => a.action === 'SUGGESTIONS_PROVIDED' && a.adminSuggestions)
                            .map((audit: any) => (
                              <div key={audit.id} className="space-y-4">
                                  {/* Pricing & Budget - Sidebar Style */}
                                  {audit.adminSuggestions.pricing && (() => {
                                    const formatted = formatAdminText(audit.adminSuggestions.pricing);
                                    return (
                                      <div className="bg-white rounded-2xl border-l-4 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden" style={{ borderLeftColor: '#02665e' }}>
                                        <div className="flex flex-col sm:flex-row">
                                          <div className="w-full sm:w-48 px-4 sm:px-5 py-4 sm:py-5 flex sm:flex-col items-center sm:items-start justify-center sm:justify-start gap-3" style={{ backgroundColor: '#02665e' }}>
                                            <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center">
                                              <DollarSign className="h-5 w-5" style={{ color: '#02665e' }} />
                                            </div>
                                            <div className="text-center sm:text-left">
                                              <h5 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Pricing & Budget</h5>
                                              <div className="h-0.5 w-12 bg-white/30 mx-auto sm:mx-0"></div>
                                            </div>
                                          </div>
                                          <div className="flex-1 p-4 sm:p-5">
                                            {formatted ? (
                                              <div className="space-y-3">
                                                {formatted.map((item, idx) => {
                                                  if (item.type === 'heading') {
                                                    return (
                                                      <div key={idx} className="font-bold text-gray-900 text-sm sm:text-base mt-4 first:mt-0 flex items-center gap-2">
                                                        <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#02665e' }}></div>
                                                        {item.content}
                                                      </div>
                                                    );
                                                  } else if (item.type === 'discount') {
                                                    return (
                                                      <div key={idx} className="mt-4 pt-4 border-t-2 border-gray-200">
                                                        <div className="flex items-center gap-2.5 mb-3">
                                                          <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: '#02665e' }}>
                                                            <Gift className="h-4 w-4 text-white" />
                                                          </div>
                                                          <span className="font-bold text-gray-900 text-sm sm:text-base">{item.content}</span>
                                                        </div>
                                                      </div>
                                                    );
                                                  } else if (item.type === 'finalPrice') {
                                                    return (
                                                      <div key={idx} className="mt-3 p-3 sm:p-4 bg-gray-50 rounded-lg border-2 border-gray-200">
                                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                          <span className="font-semibold text-gray-700 text-sm sm:text-base">Final Price:</span>
                                                          <span className="font-bold text-lg sm:text-xl" style={{ color: '#02665e' }}>
                                                            {item.value ? `${item.value.replace(/,/g, ',')} TZS` : item.content.match(/(\d[\d,]*)\s*TZS/)?.[0] || item.content}
                                                          </span>
                                                        </div>
                                                      </div>
                                                    );
                                                  } else if (item.type === 'savings') {
                                                    return (
                                                      <div key={idx} className="mt-3 p-3 sm:p-4 bg-gray-100 rounded-lg border-2 border-gray-300 shadow-sm">
                                                        <div className="flex items-center gap-2.5">
                                                          <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: '#02665e' }}>
                                                            <Tag className="h-4 w-4 text-white" />
                                                          </div>
                                                          <div className="flex-1">
                                                            <span className="font-bold text-sm sm:text-base block" style={{ color: '#02665e' }}>
                                                              {item.content}
                                                            </span>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    );
                                                  } else if (item.type === 'bullet') {
                                                    const isDiscountInfo = item.content.includes('Discount:') || item.content.includes('Original Price:') || item.content.includes('Discount Amount:');
                                                    const isPriceInfo = item.content.includes('Price per Night:') || item.content.includes('Total Nights:') || item.content.includes('Total Amount:');
                                                    
                                                    return (
                                                      <div key={idx} className={`flex items-start gap-3 text-sm sm:text-base ${isDiscountInfo ? 'text-gray-900 font-semibold' : isPriceInfo ? 'text-gray-800' : 'text-gray-700'}`}>
                                                        <span className="mt-1.5 flex-shrink-0 font-bold" style={{ color: '#02665e' }}>•</span>
                                                        <span className="flex-1 leading-relaxed">{item.content}</span>
                                                      </div>
                                                    );
                                                  } else {
                                                    return (
                                                      <div key={idx} className="text-sm sm:text-base text-gray-700 leading-relaxed">
                                                        {item.content}
                                                      </div>
                                                    );
                                                  }
                                                })}
                                              </div>
                                            ) : (
                                              <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                                {audit.adminSuggestions.pricing}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* Accommodation Options - Top Bar Style */}
                                  {audit.adminSuggestions.accommodationOptions && (
                                    <div className="bg-white rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                                      <div className="border-b-2 px-4 sm:px-5 py-3.5 bg-gray-50" style={{ borderBottomColor: '#02665e' }}>
                                        <div className="flex items-center gap-3">
                                          <div className="h-10 w-10 rounded-xl border-2 bg-white flex items-center justify-center" style={{ borderColor: '#02665e' }}>
                                            <Building2 className="h-5 w-5" style={{ color: '#02665e' }} />
                                          </div>
                                          <div>
                                            <span className="text-sm sm:text-base font-bold text-gray-900 uppercase tracking-wider block">Accommodation Options</span>
                                            <div className="h-0.5 w-16 mt-1" style={{ backgroundColor: '#02665e' }}></div>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="p-4 sm:p-5">
                                        <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                          {audit.adminSuggestions.accommodationOptions}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Recommendations - Icon Badge Style */}
                                  {audit.adminSuggestions.recommendations && (
                                    <div className="bg-white rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                                      <div className="p-4 sm:p-5">
                                        <div className="flex items-start gap-4 mb-4">
                                          <div className="h-14 w-14 rounded-2xl border-2 bg-gray-50 flex items-center justify-center flex-shrink-0" style={{ borderColor: '#02665e' }}>
                                            <Sparkles className="h-7 w-7" style={{ color: '#02665e' }} />
                                          </div>
                                          <div className="flex-1 pt-1">
                                            <h5 className="text-sm sm:text-base font-bold text-gray-900 uppercase tracking-wider mb-1">Recommendations</h5>
                                            <div className="h-1 w-20 rounded-full" style={{ backgroundColor: '#02665e' }}></div>
                                          </div>
                                        </div>
                                        <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed pl-0 sm:pl-18">
                                          {audit.adminSuggestions.recommendations}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Next Steps - Bottom Accent Style */}
                                  {audit.adminSuggestions.nextSteps && (
                                    <div className="bg-white rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                                      <div className="p-4 sm:p-5 pb-6">
                                        <div className="flex items-center gap-3 mb-4">
                                          <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#02665e' }}>
                                            <ArrowRight className="h-5 w-5 text-white" />
                                          </div>
                                          <div>
                                            <h5 className="text-sm sm:text-base font-bold text-gray-900 uppercase tracking-wider">Next Steps</h5>
                                            <div className="flex items-center gap-1 mt-1">
                                              <div className="h-1 w-8 rounded-full" style={{ backgroundColor: '#02665e' }}></div>
                                              <div className="h-1 w-1 bg-gray-400 rounded-full"></div>
                                              <div className="h-1 w-1 bg-gray-400 rounded-full"></div>
                                            </div>
                                          </div>
                                        </div>
                                        <div className="text-sm sm:text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                                          {audit.adminSuggestions.nextSteps}
                                        </div>
                                      </div>
                                      <div className="h-1" style={{ backgroundColor: '#02665e' }}></div>
                                    </div>
                                  )}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Admin Actions Section */}
                    {bookingDetails.status !== "COMPLETED" && bookingDetails.status !== "CANCELED" && (
                      <div className="space-y-4 border-0 border-t border-solid border-neutral-200 pt-4">
                        {/* Direct Contact Section */}
                        <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                          {/* Title with the off-platform contact options on the right */}
                          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                                <MessageSquare className="h-3.5 w-3.5" />
                              </span>
                              <h4 className="m-0 text-sm font-bold text-neutral-900">Message customer</h4>
                            </div>
                            {bookingDetails.user && (
                              <div className="flex flex-wrap gap-1.5 sm:ml-auto">
                                <a
                                  href={`mailto:${bookingDetails.user.email}?subject=Group Stay Booking GS-${String(bookingDetails.id).padStart(4, "0")}`}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 no-underline transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 hover:no-underline"
                                >
                                  <Mail className="h-3.5 w-3.5" />
                                  Email
                                </a>
                                {bookingDetails.user.phone && (
                                  <a
                                    href={`tel:${bookingDetails.user.phone}`}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 no-underline transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 hover:no-underline"
                                  >
                                    <Phone className="h-3.5 w-3.5" />
                                    Call
                                  </a>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Composer: one bordered box holding the textarea and its toolbar */}
                          <div className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white transition focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100">
                            <textarea
                              value={quickMessage}
                              onChange={(e) => setQuickMessage(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && quickMessage.trim() && !sendingMessage) {
                                  e.preventDefault();
                                  handleSendQuickMessage();
                                }
                              }}
                              placeholder="Write a message to the customer, or start from a template below"
                              rows={3}
                              aria-label="Message to customer"
                              // font-family: inherit, otherwise the UA default renders textareas in monospace (preflight is off)
                              className="block w-full resize-y border-0 bg-transparent px-3 py-2.5 font-[inherit] text-sm leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400"
                            />
                            <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-2.5 py-2">
                              <span className="pl-0.5 text-[11px] font-semibold text-neutral-400">Templates</span>
                              {[
                                { key: "reviewing", label: "Reviewing" },
                                { key: "processing", label: "Processing" },
                                { key: "propertiesRecommended", label: "Properties ready" },
                              ].map((t) => (
                                <button
                                  key={t.key}
                                  type="button"
                                  onClick={() => handleFillTemplate(t.key as keyof typeof messageTemplates)}
                                  className="rounded-full border border-solid border-neutral-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600 transition hover:border-blue-300 hover:text-blue-700"
                                  title={`Fill in the ${t.label.toLowerCase()} message`}
                                >
                                  {t.label}
                                </button>
                              ))}
                              <span className="ml-auto hidden text-[11px] text-neutral-400 sm:inline">Ctrl + Enter to send</span>
                              <button
                                type="button"
                                onClick={handleSendQuickMessage}
                                disabled={sendingMessage || !quickMessage.trim()}
                                className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 max-sm:ml-auto"
                              >
                                {sendingMessage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                {sendingMessage ? "Sending..." : "Send"}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Property Recommendations Section */}
                        <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                          <h4 className="m-0 mb-4 text-sm font-bold text-neutral-900 flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                              <Building2 className="h-4 w-4 text-indigo-600" />
                            </div>
                            Property Recommendations
                          </h4>
                          
                          {recommendedPropertyIds.length > 0 ? (
                            <div className="rounded-lg border border-solid border-neutral-100 bg-neutral-50/60 p-4 mb-4">
                              <p className="text-sm font-medium text-gray-700 mb-2">
                                {recommendedPropertyIds.length} propert{recommendedPropertyIds.length > 1 ? 'ies' : 'y'} recommended
                              </p>
                              <p className="text-xs text-gray-500">
                                Customer has been notified and can view the recommended properties.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {!showPropertySearch ? (
                                <button
                                  onClick={handleSearchProperties}
                                  disabled={propertySearchLoading}
                                  className="w-full px-4 py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all shadow-sm"
                                >
                                  {propertySearchLoading ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Searching...
                                    </>
                                  ) : (
                                    <>
                                      <Search className="h-4 w-4" />
                                      Search Matching Properties
                                    </>
                                  )}
                                </button>
                              ) : (
                                <div className="space-y-4">
                                  {/* Selected Properties */}
                                  {selectedProperties.length > 0 && (
                                    <div className="rounded-lg border border-solid border-neutral-100 bg-neutral-50/60 p-4">
                                      <p className="text-xs font-semibold text-gray-700 mb-3">
                                        Selected Properties ({selectedProperties.length}/2)
                                      </p>
                                      <div className="space-y-2">
                                        {selectedProperties.map((prop) => (
                                          <div key={prop.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                                            <div className="flex-1">
                                              <p className="text-sm font-medium text-gray-900">{prop.title}</p>
                                              <p className="text-xs text-gray-500">{prop.regionName} {prop.district ? `• ${prop.district}` : ''}</p>
                                            </div>
                                            <button
                                              onClick={() => handleRemoveProperty(prop.id)}
                                              aria-label="Remove property"
                                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                      <button
                                        onClick={handleAttachProperties}
                                        disabled={attachingProperties || selectedProperties.length === 0}
                                        className="w-full mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                                      >
                                        {attachingProperties ? (
                                          <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Attaching...
                                          </>
                                        ) : (
                                          <>
                                            <CheckCircle className="h-4 w-4" />
                                            Attach {selectedProperties.length} Propert{selectedProperties.length > 1 ? 'ies' : 'y'} to Booking
                                          </>
                                        )}
                                      </button>
                                    </div>
                                  )}

                                  {/* Search Results */}
                                  <div className="rounded-lg border border-solid border-neutral-100 bg-neutral-50/60 p-4 max-h-96 overflow-y-auto">
                                    <div className="flex items-center justify-between mb-3">
                                      <p className="text-xs font-semibold text-gray-700">
                                        Matching Properties ({propertySearchResults.length})
                                      </p>
                                      <button
                                        onClick={() => {
                                          setShowPropertySearch(false);
                                          setPropertySearchResults([]);
                                        }}
                                        className="text-xs text-gray-500 hover:text-gray-700"
                                      >
                                        Close
                                      </button>
                                    </div>
                                    {propertySearchResults.length === 0 ? (
                                      <p className="text-sm text-gray-500 text-center py-4">
                                        No matching properties found. Try adjusting the filters.
                                      </p>
                                    ) : (
                                      <div className="space-y-3">
                                        {propertySearchResults.map((prop) => {
                                          const isSelected = selectedProperties.find(p => p.id === prop.id);
                                          const canAdd = selectedProperties.length < 2;
                                          
                                          return (
                                            <div key={prop.id} className="flex gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-indigo-300 transition-colors">
                                              {prop.imageUrl && (
                                                <Image
                                                  src={prop.imageUrl}
                                                  alt={prop.title}
                                                  width={80}
                                                  height={80}
                                                  className="w-20 h-20 object-cover rounded-lg"
                                                />
                                              )}
                                              <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-900 truncate">{prop.title}</p>
                                                <p className="text-xs text-gray-500 mt-1">
                                                  {prop.type} • {prop.regionName} {prop.district ? `• ${prop.district}` : ''}
                                                </p>
                                                {prop.basePrice && (
                                                  <p className="text-xs font-semibold text-indigo-600 mt-1">
                                                    {prop.currency} {Number(prop.basePrice).toLocaleString()}/night
                                                  </p>
                                                )}
                                              </div>
                                              <button
                                                onClick={() => isSelected ? handleRemoveProperty(prop.id) : handleAddProperty(prop)}
                                                disabled={!isSelected && !canAdd}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                                  isSelected
                                                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                                    : canAdd
                                                    ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                }`}
                                              >
                                                {isSelected ? (
                                                  <>
                                                    <X className="h-3 w-3 inline mr-1" />
                                                    Remove
                                                  </>
                                                ) : (
                                                  <>
                                                    <Plus className="h-3 w-3 inline mr-1" />
                                                    Add
                                                  </>
                                                )}
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Submitted Claims Review Section - Premium Admin Interface */}
                        {(bookingDetails as any).isOpenForClaims && (
                          <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                            <div className="flex items-center justify-between mb-5">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                                  <Gift className="h-5 w-5 text-emerald-600" />
                                </div>
                                <div>
                                  <h4 className="text-lg font-bold text-gray-900">Submitted Claims & Offers</h4>
                                  <p className="text-xs text-gray-600 mt-0.5">Review and select top 3 recommendations for customer</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {shortlistClaimIds.length > 0 && (
                                  <button
                                    onClick={() => setShowShortlistOnly((v) => !v)}
                                    className="px-3 py-1.5 text-xs font-semibold bg-white/80 border border-emerald-200 rounded-lg hover:bg-white hover:border-emerald-300 transition-all text-gray-700"
                                    title={showShortlistOnly ? "Showing auto-picked shortlist" : "Showing all claims"}
                                  >
                                    {showShortlistOnly ? "⭐ Shortlist" : "📦 All"}
                                  </button>
                                )}
                                <button
                                  onClick={handleStartClaimsReview}
                                  disabled={startingClaimsReview}
                                  className="px-3 py-1.5 text-xs font-semibold bg-white/80 border border-emerald-200 rounded-lg hover:bg-white hover:border-emerald-300 transition-all text-gray-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                  title="Mark all pending claims as REVIEWING"
                                >
                                  {startingClaimsReview ? "Starting..." : "Mark Reviewing"}
                                </button>
                                <button
                                  onClick={() => setComparisonView(comparisonView === "grid" ? "list" : "grid")}
                                  className="px-3 py-1.5 text-xs font-semibold bg-white/80 border border-emerald-200 rounded-lg hover:bg-white hover:border-emerald-300 transition-all text-gray-700"
                                  title={`Switch to ${comparisonView === "grid" ? "list" : "grid"} view`}
                                >
                                  {comparisonView === "grid" ? "📋 List" : "🔲 Grid"}
                                </button>
                              </div>
                            </div>

                            {/* Claims Summary Stats */}
                            {claimsData && claimsData.summary && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                                <div className="bg-white/90 rounded-lg p-3 border border-emerald-100 shadow-sm">
                                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total</div>
                                  <div className="text-xl font-bold text-emerald-700 mt-1">{claimsData.summary.total}</div>
                                </div>
                                <div className="bg-white/90 rounded-lg p-3 border border-blue-100 shadow-sm">
                                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Pending</div>
                                  <div className="text-xl font-bold text-blue-700 mt-1">{claimsData.summary.pending}</div>
                                </div>
                                <div className="bg-white/90 rounded-lg p-3 border border-green-100 shadow-sm">
                                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Recommended</div>
                                  <div className="text-xl font-bold text-green-700 mt-1">{recommendedClaimIds.length}</div>
                                </div>
                                <div className="bg-white/90 rounded-lg p-3 border border-gray-100 shadow-sm">
                                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Selected</div>
                                  <div className="text-xl font-bold text-teal-700 mt-1">{selectedClaimIds.length}/3</div>
                                </div>
                              </div>
                            )}

                            {/* Claims Loading State */}
                            {claimsLoading ? (
                              <div className="bg-white/90 rounded-xl p-8 border border-emerald-200 text-center">
                                <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mx-auto mb-3" />
                                <p className="text-sm text-gray-600">Loading submitted claims...</p>
                              </div>
                            ) : claimsData && claimsData.claims && claimsData.claims.length > 0 ? (
                              <>
                                {/* Filter Tabs */}
                                <div className="flex items-center gap-2 mb-4 flex-wrap">
                                  <button
                                    onClick={() => setClaimsFilter("all")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                      claimsFilter === "all"
                                        ? "bg-emerald-600 text-white shadow-md"
                                        : "bg-white/80 text-gray-700 border border-emerald-200 hover:bg-emerald-50"
                                    }`}
                                  >
                                    All ({claimsData.summary?.total || 0})
                                  </button>
                                  <button
                                    onClick={() => setClaimsFilter("pending")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                      claimsFilter === "pending"
                                        ? "bg-blue-600 text-white shadow-md"
                                        : "bg-white/80 text-gray-700 border border-blue-200 hover:bg-blue-50"
                                    }`}
                                  >
                                    Pending ({claimsData.summary?.pending || 0})
                                  </button>
                                  <button
                                    onClick={() => setClaimsFilter("accepted")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                      claimsFilter === "accepted"
                                        ? "bg-green-600 text-white shadow-md"
                                        : "bg-white/80 text-gray-700 border border-green-200 hover:bg-green-50"
                                    }`}
                                  >
                                    Recommended ({recommendedClaimIds.length})
                                  </button>
                                  <button
                                    onClick={() => setClaimsFilter("rejected")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                      claimsFilter === "rejected"
                                        ? "bg-red-600 text-white shadow-md"
                                        : "bg-white/80 text-gray-700 border border-red-200 hover:bg-red-50"
                                    }`}
                                  >
                                    Rejected ({claimsData.summary?.rejected || 0})
                                  </button>
                                </div>

                                {/* Claims Display - Grid or List View */}
                                <div className={`${comparisonView === "grid" ? "grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4" : "space-y-4"} mb-5`}>
                                  {claimsData.claims
                                    .filter((claim: any) => {
                                      if (showShortlistOnly && shortlistClaimIds.length > 0 && !shortlistClaimIds.includes(claim.id)) {
                                        return false;
                                      }
                                      if (claimsFilter === "all") return true;
                                      if (claimsFilter === "pending") return ["PENDING", "REVIEWING"].includes(claim.status);
                                      if (claimsFilter === "accepted") return recommendedClaimIds.includes(claim.id);
                                      if (claimsFilter === "rejected") return claim.status === "REJECTED";
                                      return true;
                                    })
                                    .map((claim: any) => {
                                      const isSelected = selectedClaimIds.includes(claim.id);
                                      const canSelect = selectedClaimIds.length < 3 && ["PENDING", "REVIEWING"].includes(claim.status);
                                      const isRecommended = recommendedClaimIds.includes(claim.id);
                                      const isShortlistHigh = claimsData?.shortlist?.high?.id === claim.id;
                                      const isShortlistMid = claimsData?.shortlist?.mid?.id === claim.id;
                                      const isShortlistLow = claimsData?.shortlist?.low?.id === claim.id;

                                      return (
                                        <div
                                          key={claim.id}
                                          className={`bg-white rounded-xl border-2 p-5 shadow-md hover:shadow-xl transition-all duration-300 ${
                                            isSelected
                                              ? "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-200"
                                              : isRecommended
                                              ? "border-green-400 bg-green-50/30"
                                              : "border-gray-200 hover:border-emerald-300"
                                          }`}
                                        >
                                          {/* Claim Header */}
                                          <div className="flex items-start justify-between mb-4">
                                            <div className="flex-1">
                                              <div className="flex items-center gap-2 mb-2">
                                                {isSelected && (
                                                  <div className="h-6 w-6 rounded-full bg-emerald-600 flex items-center justify-center">
                                                    <CheckCircle2 className="h-4 w-4 text-white" />
                                                  </div>
                                                )}
                                                {isRecommended && !isSelected && (
                                                  <div className="h-6 w-6 rounded-full bg-green-600 flex items-center justify-center">
                                                    <Sparkles className="h-4 w-4 text-white" />
                                                  </div>
                                                )}
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${
                                                  claim.status === "PENDING" ? "bg-blue-100 text-blue-700" :
                                                  claim.status === "REVIEWING" ? "bg-purple-100 text-purple-700" :
                                                  claim.status === "ACCEPTED" ? "bg-green-100 text-green-700" :
                                                  claim.status === "REJECTED" ? "bg-red-100 text-red-700" :
                                                  "bg-gray-100 text-gray-700"
                                                }`}>
                                                  {claim.status}
                                                </span>
                                                {(isShortlistHigh || isShortlistMid || isShortlistLow) && (
                                                  <span
                                                    className={`px-2 py-1 text-[10px] font-bold rounded-lg border ${
                                                      isShortlistHigh
                                                        ? "bg-amber-50 text-amber-800 border-amber-200"
                                                        : isShortlistMid
                                                        ? "bg-slate-50 text-slate-800 border-slate-200"
                                                        : "bg-indigo-50 text-indigo-800 border-indigo-200"
                                                    }`}
                                                    title="Auto-picked shortlist"
                                                  >
                                                    {isShortlistHigh ? "HIGH" : isShortlistMid ? "MID" : "LOW"}
                                                  </span>
                                                )}
                                              </div>
                                              {claim.property && (
                                                <h5 className="text-sm font-bold text-gray-900 leading-tight mb-1">
                                                  {claim.property.title}
                                                </h5>
                                              )}
                                              {claim.owner && (
                                                <p className="text-xs text-gray-600">
                                                  Owner: <span className="font-semibold">{claim.owner.name}</span>
                                                </p>
                                              )}
                                            </div>
                                          </div>

                                          {/* Property Image */}
                                          {claim.property?.primaryImage && (
                                            <div className="mb-4 rounded-lg overflow-hidden border border-gray-200">
                                              <Image
                                                src={claim.property.primaryImage}
                                                alt={claim.property.title || "Property"}
                                                width={300}
                                                height={200}
                                                className="w-full h-32 object-cover"
                                              />
                                            </div>
                                          )}

                                          {/* Pricing Details */}
                                          <div className="space-y-2 mb-4">
                                            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-lg p-3 border border-emerald-200">
                                              <div className="flex items-baseline justify-between mb-1">
                                                <span className="text-xs font-medium text-gray-600">Price/Night</span>
                                                <span className="text-lg font-bold text-emerald-700">
                                                  {claim.currency} {claim.offeredPricePerNight.toLocaleString()}
                                                </span>
                                              </div>
                                              {claim.discountPercent && claim.discountPercent > 0 && (
                                                <div className="flex items-center justify-between text-xs">
                                                  <span className="text-gray-600">Discount</span>
                                                  <span className="font-semibold text-green-600">
                                                    -{claim.discountPercent}%
                                                  </span>
                                                </div>
                                              )}
                                              {claim.savingsAmount && (
                                                <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-emerald-200">
                                                  <span className="text-gray-600">You Save</span>
                                                  <span className="font-bold text-green-700">
                                                    {claim.currency} {claim.savingsAmount.toLocaleString()}
                                                  </span>
                                                </div>
                                              )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                              <div className="bg-gray-50 rounded-lg p-2">
                                                <div className="text-gray-500">Total Amount</div>
                                                <div className="font-bold text-gray-900 mt-0.5">
                                                  {claim.currency} {claim.totalAmount.toLocaleString()}
                                                </div>
                                              </div>
                                              {claim.pricePerGuest && (
                                                <div className="bg-gray-50 rounded-lg p-2">
                                                  <div className="text-gray-500">Per Guest</div>
                                                  <div className="font-bold text-gray-900 mt-0.5">
                                                    {claim.currency} {claim.pricePerGuest.toFixed(0)}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          {/* Special Offers */}
                                          {claim.specialOffers && (
                                            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                              <div className="flex items-center gap-2 mb-1">
                                                <Tag className="h-3.5 w-3.5 text-amber-600" />
                                                <span className="text-xs font-semibold text-amber-800">Special Offers</span>
                                              </div>
                                              <p className="text-xs text-amber-900 leading-relaxed">{claim.specialOffers}</p>
                                            </div>
                                          )}

                                          {/* Notes */}
                                          {claim.notes && (
                                            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                              <div className="flex items-center gap-2 mb-1">
                                                <FileText className="h-3.5 w-3.5 text-blue-600" />
                                                <span className="text-xs font-semibold text-blue-800">Owner Notes</span>
                                              </div>
                                              <p className="text-xs text-blue-900 leading-relaxed">{claim.notes}</p>
                                            </div>
                                          )}

                                          {/* Location Info */}
                                          {claim.property && (
                                            <div className="mb-4 flex items-center gap-2 text-xs text-gray-600">
                                              <MapPin className="h-3.5 w-3.5" />
                                              <span className="truncate">
                                                {[claim.property.regionName, claim.property.district, claim.property.city].filter(Boolean).join(", ")}
                                              </span>
                                            </div>
                                          )}

                                          {/* Action Buttons */}
                                          <div className="flex flex-col gap-2 pt-3 border-t border-gray-200">
                                            {canSelect && (
                                              <button
                                                onClick={() => toggleClaimSelection(claim.id)}
                                                className={`w-full px-4 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                                                  isSelected
                                                    ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md"
                                                    : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-300"
                                                }`}
                                              >
                                                {isSelected ? (
                                                  <>
                                                    <CheckCircle2 className="h-4 w-4 inline mr-1.5" />
                                                    Selected for Recommendation
                                                  </>
                                                ) : (
                                                  <>
                                                    <Plus className="h-4 w-4 inline mr-1.5" />
                                                    Select for Recommendation
                                                  </>
                                                )}
                                              </button>
                                            )}
                                            {isRecommended && (
                                              <div className="text-center py-2 px-3 bg-green-100 border border-green-300 rounded-lg">
                                                <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-green-700">
                                                  <Sparkles className="h-3.5 w-3.5" />
                                                  Already Recommended
                                                </div>
                                              </div>
                                            )}
                                            {["PENDING", "REVIEWING"].includes(claim.status) && !canSelect && !isSelected && (
                                              <div className="text-center py-2 px-3 bg-amber-100 border border-amber-300 rounded-lg">
                                                <p className="text-xs font-semibold text-amber-700">
                                                  Max 3 selections reached
                                                </p>
                                              </div>
                                            )}
                                            {["PENDING", "REVIEWING"].includes(claim.status) && (
                                              <div className="grid grid-cols-2 gap-2">
                                                <button
                                                  onClick={() => handleUpdateClaimStatus(claim.id, "REJECTED")}
                                                  className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-all"
                                                >
                                                  Reject
                                                </button>
                                                <button
                                                  onClick={() => {
                                                    if (bookingDetails && claim.property) {
                                                      window.open(`/admin/properties/${claim.propertyId}`, "_blank");
                                                    }
                                                  }}
                                                  className="px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-all"
                                                >
                                                  View Property
                                                </button>
                                              </div>
                                            )}
                                          </div>

                                          {/* Submitted Time */}
                                          <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 text-center">
                                            Submitted {new Date(claim.createdAt).toLocaleDateString("en-US", {
                                              month: "short",
                                              day: "numeric",
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>

                                {/* Selection Summary & Submit */}
                                {selectedClaimIds.length > 0 && (
                                  <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl p-5 border-2 border-emerald-400 shadow-xl">
                                    <div className="flex items-center justify-between mb-4">
                                      <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                          <Sparkles className="h-5 w-5 text-white" />
                                        </div>
                                        <div>
                                          <h5 className="text-base font-bold text-white">
                                            {selectedClaimIds.length} Claim{selectedClaimIds.length > 1 ? 's' : ''} Selected
                                          </h5>
                                          <p className="text-xs text-emerald-100 mt-0.5">
                                            Ready to recommend to customer
                                          </p>
                                        </div>
                                      </div>
                                      <button
                                        onClick={handleRecommendClaims}
                                        disabled={recommendingClaims || selectedClaimIds.length === 0}
                                        className="px-6 py-3 bg-white text-emerald-700 rounded-xl text-sm font-bold hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all shadow-lg hover:shadow-xl"
                                      >
                                        {recommendingClaims ? (
                                          <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Recommending...
                                          </>
                                        ) : (
                                          <>
                                            <CheckCircle2 className="h-4 w-4" />
                                            Recommend {selectedClaimIds.length} to Customer
                                          </>
                                        )}
                                      </button>
                                    </div>
                                    <div className="text-xs text-emerald-100 bg-white/10 rounded-lg p-3 backdrop-blur-sm">
                                      💡 <strong>Premium Service:</strong> These recommendations will be presented to the customer for their final selection. Choose the best offers that provide value and meet their requirements.
                                    </div>
                                  </div>
                                )}

                                {/* Empty State for Filter */}
                                {claimsData.claims.filter((c: any) => {
                                  if (claimsFilter === "all") return true;
                                  return c.status === claimsFilter.toUpperCase();
                                }).length === 0 && (
                                  <div className="bg-white/90 rounded-xl p-8 border border-emerald-200 text-center">
                                    <AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-3" />
                                    <p className="text-sm text-gray-600 font-medium">
                                      No {claimsFilter === "all" ? "" : claimsFilter} claims found
                                    </p>
                                  </div>
                                )}
                              </>
                            ) : claimsData && claimsData.claims && claimsData.claims.length === 0 ? (
                              <div className="bg-white/90 rounded-xl p-8 border border-emerald-200 text-center">
                                <Gift className="h-8 w-8 text-gray-400 mx-auto mb-3" />
                                <p className="text-sm text-gray-600 font-medium mb-1">No Claims Submitted Yet</p>
                                <p className="text-xs text-gray-500">
                                  Owners can submit competitive offers when this booking is open for claims.
                                </p>
                              </div>
                            ) : (
                              <div className="bg-white/90 rounded-xl p-6 border border-emerald-200 text-center">
                                <button
                                  onClick={() => bookingDetails && loadClaims(bookingDetails.id)}
                                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-all"
                                >
                                  Load Submitted Claims
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Quick Status Actions */}
                        <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
                          <h4 className="m-0 mb-4 text-sm font-bold text-neutral-900 flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-green-50 flex items-center justify-center">
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            </div>
                            Quick Actions
                          </h4>
                          
                          {/* Every status change notifies the customer, so each action asks first. */}
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                            {bookingDetails.status === "PENDING" && (
                              <button
                                type="button"
                                onClick={() => setPendingStatusAction("REVIEWING")}
                                disabled={updatingStatus}
                                className="flex items-center justify-center gap-2 rounded-lg border-0 bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Loader2 className="h-4 w-4" />
                                Start reviewing
                              </button>
                            )}
                            {bookingDetails.status === "REVIEWING" && (
                              <button
                                type="button"
                                onClick={() => setPendingStatusAction("PROCESSING")}
                                disabled={updatingStatus}
                                className="flex items-center justify-center gap-2 rounded-lg border-0 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Loader2 className="h-4 w-4" />
                                Start processing
                              </button>
                            )}
                            {bookingDetails.status === "PROCESSING" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setPendingStatusAction("CONFIRMED")}
                                  disabled={updatingStatus}
                                  className="flex items-center justify-center gap-2 rounded-lg border-0 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                  Confirm booking
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingStatusAction("COMPLETED")}
                                  disabled={updatingStatus}
                                  className="flex items-center justify-center gap-2 rounded-lg border-0 bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  Mark completed
                                </button>
                              </>
                            )}
                            {bookingDetails.status !== "CANCELED" && (
                              <button
                                type="button"
                                onClick={() => setPendingStatusAction("CANCELED")}
                                disabled={updatingStatus}
                                className="flex items-center justify-center gap-2 rounded-lg border border-solid border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <XCircle className="h-4 w-4" />
                                Cancel booking
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">Failed to load booking details</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-white px-4 py-3 sm:px-6">
                <button type="button"
                  onClick={closeDetailsModal}
                  className="rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-900"
                >
                  Close
                </button>
              </div>
            </div>
          </div>

          {/* Status change confirmation */}
          {pendingStatusAction && bookingDetails && (() => {
            const copy = STATUS_ACTION_COPY[pendingStatusAction];
            const reference = `GS-${String(bookingDetails.id).padStart(4, "0")}`;
            const danger = pendingStatusAction === "CANCELED";
            return (
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="gs-status-confirm-title">
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="absolute inset-0 border-0 bg-neutral-950/40 backdrop-blur-[2px]"
                  onClick={() => !updatingStatus && setPendingStatusAction(null)}
                />
                <div className="relative box-border w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
                  <div className="flex items-start gap-3">
                    <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${danger ? "bg-rose-50 text-rose-600" : "bg-purple-50 text-purple-600"}`}>
                      {danger ? <AlertCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0">
                      <h3 id="gs-status-confirm-title" className="m-0 text-base font-bold text-neutral-900">{copy.title}</h3>
                      <p className="m-0 mt-1.5 text-sm leading-relaxed text-neutral-600">
                        Are you sure you want to {copy.verb} booking <span className="font-semibold text-neutral-900">{reference}</span>? {copy.detail}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setPendingStatusAction(null)}
                      disabled={updatingStatus}
                      className="rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {danger ? "Keep booking" : "Go back"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleUpdateStatus(pendingStatusAction);
                        setPendingStatusAction(null);
                      }}
                      disabled={updatingStatus}
                      className={`inline-flex items-center justify-center gap-2 rounded-lg border-0 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-purple-600 hover:bg-purple-700"}`}
                    >
                      {updatingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {updatingStatus ? "Updating..." : copy.confirmLabel}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

