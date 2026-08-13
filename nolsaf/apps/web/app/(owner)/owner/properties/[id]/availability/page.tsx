"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import apiClient from "@/lib/apiClient";
import { AFRICA_NATIONALITY_OPTIONS } from "@nolsaf/shared";
import { 
  Calendar, 
  Plus, 
  Edit, 
  Trash2, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Home,
  BedDouble,
  Save,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Info,
  AlertTriangle,
  Layers,
  User,
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import DatePicker from "@/components/ui/DatePicker";

const api = apiClient;

// Each room-type filter card gets its own accent colour so the owner can
// instantly tell the filters apart. Cycles if there are more types than entries.
// Each room-type card gets its own dark gradient so the owner can tell them apart at a glance.
const ROOM_PALETTE: Array<{
  inactiveBg: string; activeBg: string;
  border: string; activeBorder: string;
  dot: string; badgeClass: string; activeBadgeClass: string;
}> = [
  // amber / yellow
  {
    inactiveBg:     "linear-gradient(135deg, #451a03 0%, #78350f 100%)",
    activeBg:       "linear-gradient(135deg, #78350f 0%, #92400e 100%)",
    border:         "border-amber-600/50",   activeBorder: "border-amber-400/80",
    dot:            "bg-amber-400",
    badgeClass:     "border-amber-600/40 bg-amber-900/60 text-amber-300",
    activeBadgeClass: "border-amber-400/60 bg-amber-800/80 text-amber-200",
  },
  // sky / blue
  {
    inactiveBg:     "linear-gradient(135deg, #0c1a2e 0%, #0c4a6e 100%)",
    activeBg:       "linear-gradient(135deg, #0c4a6e 0%, #075985 100%)",
    border:         "border-sky-600/50",     activeBorder: "border-sky-400/80",
    dot:            "bg-sky-400",
    badgeClass:     "border-sky-600/40 bg-sky-900/60 text-sky-300",
    activeBadgeClass: "border-sky-400/60 bg-sky-800/80 text-sky-200",
  },
  // violet / purple
  {
    inactiveBg:     "linear-gradient(135deg, #1e0a3c 0%, #3b0764 100%)",
    activeBg:       "linear-gradient(135deg, #3b0764 0%, #4c1d95 100%)",
    border:         "border-violet-600/50",  activeBorder: "border-violet-400/80",
    dot:            "bg-violet-400",
    badgeClass:     "border-violet-600/40 bg-violet-900/60 text-violet-300",
    activeBadgeClass: "border-violet-400/60 bg-violet-800/80 text-violet-200",
  },
  // rose / pink
  {
    inactiveBg:     "linear-gradient(135deg, #2d0a14 0%, #881337 100%)",
    activeBg:       "linear-gradient(135deg, #881337 0%, #9f1239 100%)",
    border:         "border-rose-600/50",    activeBorder: "border-rose-400/80",
    dot:            "bg-rose-400",
    badgeClass:     "border-rose-600/40 bg-rose-900/60 text-rose-300",
    activeBadgeClass: "border-rose-400/60 bg-rose-800/80 text-rose-200",
  },
  // orange
  {
    inactiveBg:     "linear-gradient(135deg, #431407 0%, #7c2d12 100%)",
    activeBg:       "linear-gradient(135deg, #7c2d12 0%, #9a3412 100%)",
    border:         "border-orange-600/50",  activeBorder: "border-orange-400/80",
    dot:            "bg-orange-400",
    badgeClass:     "border-orange-600/40 bg-orange-900/60 text-orange-300",
    activeBadgeClass: "border-orange-400/60 bg-orange-800/80 text-orange-200",
  },
  // cyan / teal
  {
    inactiveBg:     "linear-gradient(135deg, #042f2e 0%, #134e4a 100%)",
    activeBg:       "linear-gradient(135deg, #134e4a 0%, #115e59 100%)",
    border:         "border-cyan-600/50",    activeBorder: "border-cyan-400/80",
    dot:            "bg-cyan-400",
    badgeClass:     "border-cyan-600/40 bg-cyan-900/60 text-cyan-300",
    activeBadgeClass: "border-cyan-400/60 bg-cyan-800/80 text-cyan-200",
  },
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// Format date as "17 Jan 26" (day, short month, 2-digit year)
function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "Select date";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "Select date";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() % 100}`;
}

function formatLocalDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatConfirmDate(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatLocalYMD(d: Date) {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${year}-${month}-${day}`;
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

type AvailabilityBlock = {
  id: number;
  propertyId: number;
  propertyTitle: string;
  startDate: string;
  endDate: string;
  roomCode: string | null;
  source: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
  nationality?: string | null;
  roomRate?: number | null;
  calculatedAmount?: number | null;
  amountPaid?: number | null;
  paidVia?: string | null;
  currency?: string | null;
  bedsBlocked: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type Booking = {
  id: number;
  checkIn: string;
  checkOut: string;
  status: string;
  guestName: string;
  guestPhone: string | null;
  roomCode: string | null;
  guests: { adults: number; children: number };
};

type RoomType = {
  roomType: string;
  roomCode: string | null;
  roomsCount: number;
  basePrice?: number | null;
  currency?: string | null;
};

type CalendarData = {
  property: {
    id: number;
    title: string;
    roomTypes: RoomType[];
  };
  dateRange: {
    start: string;
    end: string;
  };
  bookings: Booking[];
  blocks: AvailabilityBlock[];
};

type BlockRangeAvailability = {
  ok?: boolean;
  summary?: {
    totalAvailableRooms?: number;
  };
  byRoomType?: Record<string, {
    roomType?: string;
    totalRooms?: number;
    availableRooms?: number;
  }>;
};

const SOURCE_OPTIONS = [
  { value: "AIRBNB", label: "Airbnb" },
  { value: "BOOKING_COM", label: "Booking.com" },
  { value: "WALK_IN", label: "Walk-in" },
  { value: "PHONE", label: "Phone Booking" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "OTHER", label: "Other" },
];

const GUEST_COUNTRY_OPTIONS = AFRICA_NATIONALITY_OPTIONS;

function formatMoney(value: number | null | undefined, currency = "TZS") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Price not set";
  return `${currency} ${Math.round(n).toLocaleString("en-US")}`;
}

function nightsBetween(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  return Math.max(0, Math.ceil((+end - +start) / 864e5));
}

function emptyBlockFormData(roomCode = "") {
  return {
    startDate: "",
    endDate: "",
    roomCode,
    source: "",
    guestName: "",
    guestPhone: "",
    nationality: "",
    roomRate: 0,
    calculatedAmount: 0,
    amountPaid: 0,
    paidVia: "",
    currency: "TZS",
    bedsBlocked: 1,
    notes: "",
  };
}

export default function PropertyAvailabilityPage() {
  const params = useParams();
  const router = useRouter();
  const [initialDeepLink] = useState(() => {
    if (typeof window === "undefined") return { roomCode: "", openExternalBlock: false };
    const searchParams = new URLSearchParams(window.location.search);
    return {
      roomCode: searchParams.get("roomCode") || "",
      openExternalBlock: searchParams.get("externalBlock") === "1",
    };
  });
  const roomCodeParam = initialDeepLink.roomCode;
  const openExternalBlockParam = initialDeepLink.openExternalBlock;
  const consumedRoomCodeParamRef = useRef(false);
  
  // Safely extract propertyId from params
  const propertyIdParam = params?.id;
  const propertyId = propertyIdParam ? Number(propertyIdParam) : NaN;
  
  const [loading, setLoading] = useState(true);
  const [propertyLoading, setPropertyLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [property, setProperty] = useState<any>(null);
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedRoomCode, setSelectedRoomCode] = useState<string | null>(null);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [editingBlock, setEditingBlock] = useState<AvailabilityBlock | null>(null);
  const [, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictData, setConflictData] = useState<{ conflictingBookings: any[]; conflictingBlocks: any[] } | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState<(() => Promise<void>) | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [showDayDetails, setShowDayDetails] = useState(false);
  const [dayDetails, setDayDetails] = useState<{ date: Date; bookings: Booking[]; blocks: AvailabilityBlock[] } | null>(null);
  const [dayDetailsBookingStatusFilter, setDayDetailsBookingStatusFilter] = useState<string | null>(null);
  const [dayDetailsBlockSourceFilter, setDayDetailsBlockSourceFilter] = useState<string | null>(null);
  const [calendarQuickFilter, setCalendarQuickFilter] = useState<"all" | "bookings" | "blocks">("all");
  const [showRangeInsights, setShowRangeInsights] = useState(false);
  const [rangeInsightsTab, setRangeInsightsTab] = useState<"bookings" | "blocks">("bookings");
  const [capacityError, setCapacityError] = useState<{
    error: string;
    message: string;
    roomType: string;
    roomsLeft: number;
    totalRooms?: number;
    bookedRooms?: number;
    blockedRooms?: number;
    bedsRequested?: number;
    otherRoomTypes?: { type: string; roomsLeft: number }[];
  } | null>(null);
  
  // Availability dashboard state
  const [availabilitySummary, setAvailabilitySummary] = useState<any>(null);
  const [filterStartDate, setFilterStartDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [filterEndDate, setFilterEndDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [filterRangePickerOpen, setFilterRangePickerOpen] = useState(false);
  const [filterPicking, setFilterPicking] = useState<"start" | "end">("start");
  const [, setFilterAwaitingEnd] = useState(false);
  
  // Date picker states (block form)
  const [blockRangePickerOpen, setBlockRangePickerOpen] = useState(false);
  const [blockPicking, setBlockPicking] = useState<"checkin" | "checkout">("checkin");
  const [startDateOnly, setStartDateOnly] = useState<string>("");
  const [endDateOnly, setEndDateOnly] = useState<string>("");
  
  // Form state
  const [formData, setFormData] = useState(() => emptyBlockFormData());
  const [blockRangeAvailability, setBlockRangeAvailability] = useState<BlockRangeAvailability | null>(null);
  const [loadingBlockRangeAvailability, setLoadingBlockRangeAvailability] = useState(false);
  const [blockRangeAvailabilityError, setBlockRangeAvailabilityError] = useState<string | null>(null);

  // Load property details
  useEffect(() => {
    if (isNaN(propertyId)) {
      setError("Invalid property ID");
      setPropertyLoading(false);
      setLoading(false);
      return;
    }

    setPropertyLoading(true);
    api.get(`/api/owner/properties/${propertyId}`)
      .then((res) => {
        setProperty(res.data);
        setPropertyLoading(false);
      })
      .catch((err) => {
        setError(err?.response?.data?.error || "Failed to load property");
        setPropertyLoading(false);
      });
  }, [propertyId]);

  // Load calendar data
  const loadCalendarData = useCallback(async () => {
    if (isNaN(propertyId)) return;

    try {
      const start = new Date(selectedDate);
      start.setDate(1); // First day of month
      const end = new Date(start);
      end.setMonth(end.getMonth() + 3); // 3 months ahead

      const res = await api.get("/api/owner/availability/calendar", {
        params: {
          propertyId,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          ...(selectedRoomCode && { roomCode: selectedRoomCode }),
        },
      });

      setCalendarData(res.data);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load calendar data");
    } finally {
      setLoading(false);
    }
  }, [propertyId, selectedDate, selectedRoomCode]);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  // Load availability summary
  const loadAvailabilitySummary = useCallback(async () => {
    if (isNaN(propertyId) || !filterStartDate || !filterEndDate) return;

    const start = new Date(`${filterStartDate}T00:00:00`);
    const end = new Date(`${filterEndDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return;
    }
    
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const res = await api.get("/api/owner/availability/calculate", {
        params: {
          propertyId,
          startDate: `${filterStartDate}T00:00:00`,
          endDate: `${filterEndDate}T00:00:00`,
        },
      });
      setAvailabilitySummary(res.data);
    } catch (err: any) {
      console.error("Failed to load availability summary:", err);
      setSummaryError(err?.response?.data?.error || err?.message || "Failed to load availability summary");
    } finally {
      setLoadingSummary(false);
    }
  }, [propertyId, filterStartDate, filterEndDate]);

  useEffect(() => {
    loadAvailabilitySummary();
  }, [loadAvailabilitySummary]);

  // Socket.IO connection for real-time updates
  useEffect(() => {
    if (isNaN(propertyId)) return;

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

    const newSocket = io(socketUrl.replace(/\/$/, ""), {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    newSocket.on("connect", () => {
      setConnected(true);
      newSocket.emit("join-property-availability", { propertyId });
    });

    newSocket.on("disconnect", () => {
      setConnected(false);
    });

    newSocket.on("availability:update", (_data: any) => {
      // Reload calendar data and summary when availability changes
      loadCalendarData();
      loadAvailabilitySummary();
    });

    setSocket(newSocket);

    return () => {
      newSocket.emit("leave-property-availability", { propertyId });
      newSocket.disconnect();
    };
  }, [propertyId, loadCalendarData, loadAvailabilitySummary]);

  // Check for conflicts before saving
  const checkConflicts = useCallback(async (startDate: string, endDate: string, roomCode: string | null, excludeBlockId?: number) => {
    try {
      const res = await api.get("/api/owner/availability/check-conflicts", {
        params: {
          propertyId,
          startDate,
          endDate,
          ...(roomCode && { roomCode }),
          ...(excludeBlockId && { excludeBlockId }),
        },
      });
      return res.data;
    } catch (err: any) {
      return { hasConflicts: false, conflictingBookings: [], conflictingBlocks: [] };
    }
  }, [propertyId]);

  const roomTypes = calendarData?.property.roomTypes || [];

  useEffect(() => {
    if (consumedRoomCodeParamRef.current || !roomCodeParam || roomTypes.length === 0) return;

    const match = roomTypes.find((rt) => {
      const value = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
      return (
        String(value).toLowerCase() === roomCodeParam.toLowerCase() ||
        String(rt.roomCode || "").toLowerCase() === roomCodeParam.toLowerCase() ||
        String(rt.roomType || "").toLowerCase() === roomCodeParam.toLowerCase()
      );
    });

    if (!match) return;

    const selectedValue = (match.roomCode && match.roomCode.trim() !== "") ? match.roomCode : match.roomType;
    consumedRoomCodeParamRef.current = true;
    setSelectedRoomCode(selectedValue || null);
    setFormData((prev) => ({ ...prev, roomCode: selectedValue || "" }));

    if (openExternalBlockParam) {
      setEditingBlock(null);
      setStartDateOnly("");
      setEndDateOnly("");
      setShowBlockForm(true);
    }
  }, [openExternalBlockParam, roomCodeParam, roomTypes]);

  const getRoomAvailabilityForForm = useCallback((roomTypeName: string) => {
    const byRoomType = blockRangeAvailability?.byRoomType || {};
    return (
      byRoomType[roomTypeName] ||
      Object.values(byRoomType).find((entry) => String(entry.roomType || "").toLowerCase() === String(roomTypeName || "").toLowerCase()) ||
      Object.entries(byRoomType).find(([key]) => key.toLowerCase() === String(roomTypeName || "").toLowerCase())?.[1] ||
      null
    );
  }, [blockRangeAvailability]);

  const isRoomTypeAvailableForForm = useCallback((rt: RoomType) => {
    if (!formData.startDate || !formData.endDate || !blockRangeAvailability) return true;
    const availability = getRoomAvailabilityForForm(rt.roomType);
    return Number(availability?.availableRooms || 0) > 0;
  }, [blockRangeAvailability, formData.endDate, formData.startDate, getRoomAvailabilityForForm]);

  const availableRoomTypesForForm = roomTypes.filter(isRoomTypeAvailableForForm);
  const blockRangeHasDates = Boolean(formData.startDate && formData.endDate);
  const blockRangeHasNoRooms =
    blockRangeHasDates &&
    !loadingBlockRangeAvailability &&
    !!blockRangeAvailability &&
    Number(blockRangeAvailability.summary?.totalAvailableRooms || 0) <= 0;

  const getRoomTypeLabel = useCallback((value: string) => {
    const rt = (calendarData?.property.roomTypes || []).find((x) => {
      const v = (x.roomCode && x.roomCode.trim() !== "") ? x.roomCode : x.roomType;
      return String(v) === String(value);
    });
    if (!rt) return value;
    return rt.roomCode ? `${rt.roomType} (${rt.roomCode})` : rt.roomType;
  }, [calendarData?.property.roomTypes]);

  const submitBlock = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      const start = new Date(formData.startDate);
      const end = new Date(formData.endDate);

      if (!formData.startDate || !formData.endDate || isNaN(start.getTime()) || isNaN(end.getTime())) {
        setError("Please select check-in and check-out dates");
        return;
      }

      if (end <= start) {
        setError("Check-out must be after check-in");
        return;
      }

      const selectedRoomType = roomTypes.find((rt) => {
        const value = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
        return String(value) === String(formData.roomCode || "");
      });
      const roomRate = Number(formData.roomRate || selectedRoomType?.basePrice || 0);
      const nights = nightsBetween(formData.startDate, formData.endDate);
      const calculatedAmount = Math.max(0, nights * Math.max(0, roomRate) * Math.max(1, Number(formData.bedsBlocked || 1)));
      const amountPaid = Number(formData.amountPaid || calculatedAmount || 0);
      const currency = formData.currency || selectedRoomType?.currency || "TZS";
      const startDateISO = formData.startDate ? new Date(formData.startDate).toISOString() : formData.startDate;
      const endDateISO = formData.endDate ? new Date(formData.endDate).toISOString() : formData.endDate;
      const blockPayload = {
        startDate: startDateISO,
        endDate: endDateISO,
        roomCode: formData.roomCode || null,
        source: formData.source || null,
        guestName: formData.guestName || null,
        guestPhone: formData.guestPhone || null,
        nationality: formData.nationality || null,
        roomRate: roomRate > 0 ? roomRate : null,
        calculatedAmount,
        amountPaid,
        paidVia: formData.paidVia || null,
        currency,
        bedsBlocked: formData.bedsBlocked,
        notes: formData.notes || null,
      };

      // Check for conflicts
      const conflictCheck = await checkConflicts(
        formData.startDate,
        formData.endDate,
        formData.roomCode || null,
        editingBlock?.id
      );

      if (conflictCheck.hasConflicts && conflictCheck.conflictingBookings.length > 0) {
        // Store conflict data and show modal
        setConflictData({
          conflictingBookings: conflictCheck.conflictingBookings || [],
          conflictingBlocks: conflictCheck.conflictingBlocks || [],
        });
        setPendingSubmit(() => async () => {
          if (editingBlock) {
            await api.put(`/api/owner/availability/blocks/${editingBlock.id}`, blockPayload);
          } else {
            await api.post("/api/owner/availability/blocks", {
              propertyId,
              ...blockPayload,
            });
          }

          setShowBlockForm(false);
          setEditingBlock(null);
          setStartDateOnly("");
          setEndDateOnly("");
          setFormData(emptyBlockFormData());
          await loadCalendarData();
          await loadAvailabilitySummary();
        });
        setShowConflictModal(true);
        return;
      }

      if (editingBlock) {
        await api.put(`/api/owner/availability/blocks/${editingBlock.id}`, blockPayload);
      } else {
        await api.post("/api/owner/availability/blocks", {
          propertyId,
          ...blockPayload,
        });
      }

      setShowBlockForm(false);
      setEditingBlock(null);
      setStartDateOnly("");
      setEndDateOnly("");
      setFormData(emptyBlockFormData());
      await loadCalendarData();
      await loadAvailabilitySummary();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error === "ROOMS_AT_CAPACITY") {
        setCapacityError(data);
        setError(null);
      } else {
        setError(data?.error || "Failed to save availability block");
      }
    } finally {
      setSaving(false);
    }
  }, [
    checkConflicts,
    editingBlock,
    formData,
    loadAvailabilitySummary,
    loadCalendarData,
    propertyId,
    roomTypes,
    saving,
  ]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || showConfirmModal) return;
    setError(null);

    if (loadingBlockRangeAvailability) {
      setError("Please wait while available rooms are checked for the selected dates.");
      return;
    }

    if (blockRangeHasNoRooms) {
      setError("No rooms are available for the selected stay dates. Please choose another date range.");
      return;
    }

    if (!formData.roomCode || !formData.source || !formData.startDate || !formData.endDate) {
      setError("Please fill in all required fields");
      return;
    }

    if (!formData.guestName.trim()) {
      setError("Please enter the guest name for this external booking");
      return;
    }

    if (!formData.nationality.trim()) {
      setError("Please select the guest country");
      return;
    }

    const selectedRoomType = roomTypes.find((rt) => {
      const value = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
      return String(value) === String(formData.roomCode || "");
    });
    const selectedAvailability = selectedRoomType ? getRoomAvailabilityForForm(selectedRoomType.roomType) : null;
    if (blockRangeAvailability && selectedAvailability && Number(formData.bedsBlocked || 1) > Number(selectedAvailability.availableRooms || 0)) {
      setError(`Only ${selectedAvailability.availableRooms} room${Number(selectedAvailability.availableRooms) === 1 ? "" : "s"} available for the selected dates.`);
      return;
    }

    // Open confirmation modal before saving
    setTosAccepted(false);
    setShowConfirmModal(true);
  };

  // Handle conflict confirmation
  const handleConflictConfirm = async () => {
    setShowConflictModal(false);
    setSaving(true);
    setError(null);
    
    try {
      if (pendingSubmit) {
        await pendingSubmit();
      }
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error === "ROOMS_AT_CAPACITY") {
        setCapacityError(data);
        setShowConflictModal(false);
        setPendingSubmit(null);
        setConflictData(null);
      } else {
        setError(data?.error || "Failed to save availability block");
      }
    } finally {
      setSaving(false);
      setPendingSubmit(null);
      setConflictData(null);
    }
  };

  const handleConflictCancel = () => {
    setShowConflictModal(false);
    setPendingSubmit(null);
    setConflictData(null);
    setSaving(false);
  };

  // Handle delete
  const handleDelete = async (blockId: number) => {
    if (!window.confirm("Are you sure you want to delete this availability block?")) {
      return;
    }

    try {
      await api.delete(`/api/owner/availability/blocks/${blockId}`);
      await loadCalendarData();
      await loadAvailabilitySummary();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to delete availability block");
    }
  };

  // Sync date with formData (default time to 00:00:00 for ISO format)
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      startDate: startDateOnly ? `${startDateOnly}T00:00:00` : "",
    }));
  }, [startDateOnly]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      endDate: endDateOnly ? `${endDateOnly}T00:00:00` : "",
    }));
  }, [endDateOnly]);

  useEffect(() => {
    const room = roomTypes.find((rt) => {
      const value = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
      return String(value) === String(formData.roomCode || "");
    });
    const rate = Number(formData.roomRate || room?.basePrice || 0);
    const currency = formData.currency || room?.currency || "TZS";
    const previousCalculatedAmount = Number(formData.calculatedAmount || 0);
    const calculatedAmount = Math.max(0, nightsBetween(formData.startDate, formData.endDate) * Math.max(0, rate) * Math.max(1, Number(formData.bedsBlocked || 1)));
    setFormData((prev) => {
      const shouldSyncAmountPaid = Number(prev.amountPaid || 0) === previousCalculatedAmount;
      const nextAmountPaid = shouldSyncAmountPaid ? calculatedAmount : Number(prev.amountPaid || 0);
      if (
        Number(prev.roomRate || 0) === rate &&
        Number(prev.calculatedAmount || 0) === calculatedAmount &&
        prev.currency === currency &&
        Number(prev.amountPaid || 0) === nextAmountPaid
      ) {
        return prev;
      }
      return {
        ...prev,
        roomRate: rate,
        currency,
        calculatedAmount,
        amountPaid: nextAmountPaid,
      };
    });
  }, [formData.roomCode, formData.roomRate, formData.currency, formData.startDate, formData.endDate, formData.bedsBlocked, roomTypes]);

  useEffect(() => {
    const start = formData.startDate;
    const end = formData.endDate;
    if (isNaN(propertyId) || !start || !end) {
      setBlockRangeAvailability(null);
      setBlockRangeAvailabilityError(null);
      setLoadingBlockRangeAvailability(false);
      return;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      setBlockRangeAvailability(null);
      setBlockRangeAvailabilityError(null);
      setLoadingBlockRangeAvailability(false);
      return;
    }

    let cancelled = false;
    setLoadingBlockRangeAvailability(true);
    setBlockRangeAvailabilityError(null);

    api.get("/api/owner/availability/calculate", {
      params: {
        propertyId,
        startDate: start,
        endDate: end,
        ...(editingBlock?.id ? { excludeBlockId: editingBlock.id } : {}),
      },
    })
      .then((res) => {
        if (cancelled) return;
        setBlockRangeAvailability(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setBlockRangeAvailability(null);
        setBlockRangeAvailabilityError(err?.response?.data?.error || "Failed to load available rooms for the selected dates");
      })
      .finally(() => {
        if (!cancelled) setLoadingBlockRangeAvailability(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editingBlock?.id, formData.endDate, formData.startDate, propertyId]);

  useEffect(() => {
    if (!blockRangeAvailability || !formData.roomCode) return;
    const selected = roomTypes.find((rt) => {
      const value = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
      return String(value) === String(formData.roomCode);
    });
    if (selected && !isRoomTypeAvailableForForm(selected)) {
      setFormData((prev) => ({
        ...prev,
        roomCode: "",
        roomRate: 0,
        calculatedAmount: 0,
        amountPaid: 0,
      }));
    }
  }, [blockRangeAvailability, formData.roomCode, isRoomTypeAvailableForForm, roomTypes]);

  // Handle edit
  const handleEdit = (block: AvailabilityBlock) => {
    setEditingBlock(block);
    const start = new Date(block.startDate);
    const end = new Date(block.endDate);
    const startDateStr = start.toISOString().slice(0, 10);
    const endDateStr = end.toISOString().slice(0, 10);
    
    setStartDateOnly(startDateStr);
    setEndDateOnly(endDateStr);
    
    setFormData({
      startDate: `${startDateStr}T00:00:00`,
      endDate: `${endDateStr}T00:00:00`,
      roomCode: block.roomCode || "",
      source: block.source || "",
      guestName: block.guestName || "",
      guestPhone: block.guestPhone || "",
      nationality: block.nationality || "",
      roomRate: Number(block.roomRate || 0),
      calculatedAmount: Number(block.calculatedAmount || 0),
      amountPaid: Number(block.amountPaid || block.calculatedAmount || 0),
      paidVia: block.paidVia || "",
      currency: block.currency || "TZS",
      bedsBlocked: block.bedsBlocked || 1,
      notes: block.notes || "",
    });
    setShowBlockForm(true);
  };

  const addOneDayYMD = (ymd: string) => {
    // Use local date math to avoid timezone issues.
    const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return ymd;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const next = addDays(new Date(y, mo - 1, d), 1);
    return formatLocalYMD(next);
  };

  // Generate calendar days
  const generateCalendarDays = () => {
    if (!calendarData) return [];

    const start = new Date(selectedDate);
    start.setDate(1);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0); // Last day of month

    const days: Array<{ date: Date; bookings: Booking[]; blocks: AvailabilityBlock[] }> = [];
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayBookings = calendarData.bookings.filter((b) => {
        const checkIn = new Date(b.checkIn).toISOString().split('T')[0];
        const checkOut = new Date(b.checkOut).toISOString().split('T')[0];
        return dateStr >= checkIn && dateStr < checkOut;
      });
      const dayBlocks = calendarData.blocks.filter((b) => {
        const blockStart = new Date(b.startDate).toISOString().split('T')[0];
        const blockEnd = new Date(b.endDate).toISOString().split('T')[0];
        return dateStr >= blockStart && dateStr < blockEnd;
      });

      days.push({
        date: new Date(current),
        bookings: dayBookings,
        blocks: dayBlocks,
      });

      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  if ((loading && !calendarData) || propertyLoading) {
    return (
      <div className="relative min-h-screen overflow-hidden rounded-3xl border border-white/5 bg-slate-950">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-[420px] w-[520px] rounded-full bg-sky-500/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <div className="h-10 w-24 rounded-xl bg-white/8 animate-pulse" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-10 w-28 rounded-xl bg-white/8 animate-pulse" />
              <div className="h-10 w-28 rounded-xl bg-white/8 animate-pulse" />
              <div className="h-10 w-32 rounded-xl bg-emerald-500/20 animate-pulse" />
            </div>
          </div>

          <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="h-16 w-16 rounded-2xl bg-white/10 animate-pulse" />
              <div className="flex-1 space-y-3">
                <div className="h-4 w-40 rounded-full bg-white/10 animate-pulse" />
                <div className="h-8 w-72 rounded-full bg-white/12 animate-pulse" />
                <div className="h-4 w-full max-w-2xl rounded-full bg-white/8 animate-pulse" />
              </div>
              <div className="flex gap-2 sm:flex-col sm:items-end">
                <div className="h-8 w-24 rounded-full bg-white/10 animate-pulse" />
                <div className="h-8 w-28 rounded-full bg-white/10 animate-pulse" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-xl shadow-black/25">
                <div className="h-36 bg-white/8 animate-pulse" />
                <div className="p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="h-5 w-40 rounded-full bg-white/10 animate-pulse" />
                      <div className="h-4 w-56 rounded-full bg-white/8 animate-pulse" />
                    </div>
                    <div className="h-7 w-20 rounded-full bg-white/10 animate-pulse" />
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {Array.from({ length: 3 }).map((_, statIndex) => (
                      <div key={statIndex} className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
                        <div className="h-3 w-14 rounded-full bg-white/8 animate-pulse" />
                        <div className="mt-3 h-6 w-12 rounded-full bg-white/10 animate-pulse" />
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-white/4 overflow-hidden">
                    <div className="grid grid-cols-4 px-3 py-2 border-b border-white/8 bg-white/5">
                      {Array.from({ length: 4 }).map((_, headIndex) => (
                        <div key={headIndex} className="h-3 rounded-full bg-white/8 animate-pulse" />
                      ))}
                    </div>
                    {Array.from({ length: 2 }).map((_, rowIndex) => (
                      <div key={rowIndex} className="grid grid-cols-4 gap-3 px-3 py-3 border-t border-white/8">
                        <div className="h-4 rounded-full bg-white/10 animate-pulse" />
                        <div className="h-4 rounded-full bg-white/8 animate-pulse" />
                        <div className="h-4 rounded-full bg-white/8 animate-pulse" />
                        <div className="h-4 rounded-full bg-white/8 animate-pulse" />
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="h-3 w-28 rounded-full bg-white/8 animate-pulse" />
                    <div className="h-9 w-24 rounded-xl bg-emerald-500/20 animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex items-center justify-center gap-3 text-sm text-white/45">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            <span>Loading room availability…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!propertyLoading && !property) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-lg font-semibold text-gray-900">Property not found</p>
          <button
            onClick={() => router.push("/owner/properties/approved")}
            className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
          >
            Back to Properties
          </button>
        </div>
      </div>
    );
  }

  const calendarDays = generateCalendarDays();
  const totalBookings = calendarData?.bookings.length || 0;
  const totalBlocks = calendarData?.blocks.length || 0;
  const selectedFormRoomType = roomTypes.find((rt) => {
    const value = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
    return String(value) === String(formData.roomCode || "");
  });
  const formCurrency = formData.currency || selectedFormRoomType?.currency || "TZS";
  const formRoomRate = Number(formData.roomRate || selectedFormRoomType?.basePrice || 0);
  const formNights = nightsBetween(formData.startDate, formData.endDate);
  const calculatedExternalAmount = Math.max(0, formNights * Math.max(0, formRoomRate) * Math.max(1, Number(formData.bedsBlocked || 1)));
  const todayYmd = formatLocalYMD(new Date());

  const selectRoomTypeFromCapacityModal = (roomTypeName: string) => {
    const match = roomTypes.find(
      (rt) => String(rt.roomType || "").toLowerCase() === String(roomTypeName || "").toLowerCase()
    );
    const key =
      match?.roomCode && match.roomCode.trim() !== ""
        ? match.roomCode
        : (match?.roomType || roomTypeName);

    setSelectedRoomCode(key || null);
    setFormData((prev) => ({ ...prev, roomCode: key || "" }));
    setCapacityError(null);
  };

  const openQuickBlock = (day: Date) => {
    const startYmd = formatLocalYMD(day);
    const endYmd = formatLocalYMD(addDays(day, 1));
    setEditingBlock(null);
    setStartDateOnly(startYmd);
    setEndDateOnly(endYmd);
    setFormData({
      ...emptyBlockFormData(selectedRoomCode || ""),
      startDate: `${startYmd}T00:00:00`,
      endDate: `${endYmd}T00:00:00`,
    });
    setShowBlockForm(true);
  };

  const openDayDetailsFor = (day: { date: Date; bookings: Booking[]; blocks: AvailabilityBlock[] }) => {
    setDayDetails({ date: new Date(day.date), bookings: Array.isArray(day.bookings) ? day.bookings : [], blocks: Array.isArray(day.blocks) ? day.blocks : [] });
    setDayDetailsBookingStatusFilter(null);
    setDayDetailsBlockSourceFilter(null);
    setShowDayDetails(true);
  };

  const openBlockFormFromSelectedDate = () => {
    setEditingBlock(null);
    setStartDateOnly("");
    setEndDateOnly("");
    setFormData(emptyBlockFormData(selectedRoomCode || ""));
    setShowBlockForm(true);
  };

  return (
    <div className="relative min-h-screen bg-slate-950 rounded-3xl overflow-hidden border border-white/5">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-[420px] w-[520px] rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header — clear hierarchy: nav bar, then title → property → status */}
        <header className="mb-8">
          {/* Top bar: Back (left) | Actions (right) */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/owner/properties/${propertyId}/layout`}
                className="no-underline inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white transition"
                title="Open building visualization"
              >
                <Home className="h-4 w-4" />
                Floor plan
              </Link>
              <button
                onClick={loadCalendarData}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white transition"
                title="Refresh availability"
                aria-label="Refresh availability"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                onClick={() => {
                  openBlockFormFromSelectedDate();
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition"
              >
                <Plus className="h-4 w-4" />
                Add block
              </button>
            </div>
          </div>

          {/* Title block: primary title → property (context) → status & info */}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Room Availability</h1>
            <p className="mt-1.5 text-base text-white/70">{property.title}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              {connected && (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                    style={{ animation: "nols-seq-blink 1.2s ease-in-out infinite", animationDelay: "0ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-sky-400"
                    style={{ animation: "nols-seq-blink 1.2s ease-in-out infinite", animationDelay: "400ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-rose-500"
                    style={{ animation: "nols-seq-blink 1.2s ease-in-out infinite", animationDelay: "800ms" }}
                  />
                  Live updates
                </span>
              )}
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/70">
                <Calendar className="h-3.5 w-3.5" />
                {totalBookings} bookings · {totalBlocks} blocks
              </span>
              <span className="text-xs text-white/50 inline-flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 flex-shrink-0" />
                Updates here reflect public availability automatically.
              </span>
            </div>
          </div>
        </header>

        {/* Error message */}
        {error && (
          <div className="mb-6 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-100">Error</p>
              <p className="text-sm text-red-100/80 mt-1">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-200 hover:text-white"
              title="Dismiss error"
              aria-label="Dismiss error message"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Availability Dashboard - Simple Cards */}
        <div className="mb-8 space-y-6">
          {/* Date Range Filter - Premium */}
          <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/[0.08] via-white/5 to-white/[0.03] p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
            <div className="absolute inset-0 pointer-events-none rounded-3xl bg-gradient-to-b from-white/[0.04] to-transparent" />
            <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center ring-1 ring-emerald-400/20">
                  <Calendar className="h-5 w-5 text-emerald-300" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Filter by Date Range</h2>
                  <p className="text-xs text-white/50 mt-0.5">Select dates to see availability</p>
                </div>
              </div>
              <button
                onClick={loadAvailabilitySummary}
                disabled={loadingSummary}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/25 hover:border-emerald-400/40 transition-all disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={`h-4 w-4 ${loadingSummary ? "animate-spin" : ""}`} />
                Update
              </button>
            </div>

            {summaryError && (
              <div className="relative mb-4 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-200 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Failed to load availability summary</p>
                    <p className="mt-0.5 text-xs text-rose-100/80 break-words">{summaryError}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* From - opens range picker (check-in); picker stays open until end date selected */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider">From</label>
                <button
                  type="button"
                  onClick={() => {
                    setFilterPicking("start");
                    setFilterAwaitingEnd(true);
                    setFilterRangePickerOpen(true);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/15 bg-white/5 text-left text-white/90 hover:bg-white/10 hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:border-emerald-400/40 transition-all"
                  aria-label="Select start date"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                      <Calendar className="w-4 h-4 text-emerald-300" />
                    </div>
                    <span className="font-medium">{formatDateShort(filterStartDate)}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/40 rotate-90" />
                </button>
              </div>
              {/* To - opens same range picker (checkout); picker stays open until end date selected */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-wider">To</label>
                <button
                  type="button"
                  onClick={() => {
                    setFilterPicking("end");
                    setFilterAwaitingEnd(false);
                    setFilterRangePickerOpen(true);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/15 bg-white/5 text-left text-white/90 hover:bg-white/10 hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:border-emerald-400/40 transition-all"
                  aria-label="Select end date"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                      <Calendar className="w-4 h-4 text-emerald-300" />
                    </div>
                    <span className="font-medium">{formatDateShort(filterEndDate)}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/40 rotate-90" />
                </button>
              </div>
            </div>
            {/* Single range DatePicker: stays open after first click (start), closes only after second click (end/checkout) */}
            {filterRangePickerOpen && (
              <>
                <div className="fixed inset-0 z-[100] bg-black/50" onClick={() => setFilterRangePickerOpen(false)} aria-hidden="true" />
                <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
                  <div className="pointer-events-auto">
                    <DatePicker
                      selected={filterStartDate && filterEndDate ? [filterStartDate, filterEndDate] : filterStartDate ? [filterStartDate] : undefined}
                      onSelectAction={(s) => {
                        if (Array.isArray(s) && s.length === 2) {
                          const start = s[0];
                          const end = s[1];
                          if (start && end) {
                            setFilterStartDate(start);
                            setFilterEndDate(end);
                          }
                          setFilterRangePickerOpen(false);
                          setFilterAwaitingEnd(false);
                        } else {
                          const d = Array.isArray(s) ? s[0] : s;
                          if (d) {
                            const clicked = new Date(`${d}T00:00:00`);
                            if (Number.isNaN(clicked.getTime())) return;

                            const start = filterStartDate ? new Date(`${filterStartDate}T00:00:00`) : null;
                            const end = filterEndDate ? new Date(`${filterEndDate}T00:00:00`) : null;
                            const nextDay = formatLocalYMD(addDays(clicked, 1));

                            if (filterPicking === "start") {
                              setFilterStartDate(d);
                              // keep a safe end date so API never gets a 0-night range
                              if (!end || Number.isNaN(end.getTime()) || end <= clicked) {
                                setFilterEndDate(nextDay);
                              }
                              // keep open so owner can pick end date (range selection)
                              setFilterAwaitingEnd(true);
                              return;
                            }

                            // picking end
                            if (!start || Number.isNaN(start.getTime()) || clicked <= start) {
                              // if owner clicked earlier/equal, treat that as a new start and wait for end
                              setFilterStartDate(d);
                              setFilterEndDate(nextDay);
                              setFilterAwaitingEnd(true);
                              return;
                            }

                            setFilterEndDate(d);
                            setFilterRangePickerOpen(false);
                            setFilterAwaitingEnd(false);
                          }
                        }
                      }}
                      onCloseAction={() => setFilterRangePickerOpen(false)}
                      allowRange={true}
                      minDate="2000-01-01"
                      twoMonths
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Summary Cards */}
          {availabilitySummary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Rooms Card */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <Home className="h-5 w-5 text-blue-300" />
                  </div>
                </div>
                <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-1">Total Rooms</p>
                <p className="text-3xl font-bold text-white">{availabilitySummary.summary.totalRooms}</p>
              </div>

              {/* Booked Rooms Card */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <BedDouble className="h-5 w-5 text-amber-300" />
                  </div>
                </div>
                <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-1">Booked</p>
                <p className="text-3xl font-bold text-white">{availabilitySummary.summary.totalBookedRooms}</p>
                <p className="text-xs text-white/50 mt-1">Nolsaf bookings</p>
              </div>

              {/* Blocked Rooms Card */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-red-300" />
                  </div>
                </div>
                <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-1">Blocked</p>
                <p className="text-3xl font-bold text-white">{availabilitySummary.summary.totalBlockedRooms}</p>
                <p className="text-xs text-white/50 mt-1">External bookings</p>
              </div>

              {/* Available Rooms Card */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                  </div>
                </div>
                <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-1">Available</p>
                <p className="text-3xl font-bold text-white">{availabilitySummary.summary.totalAvailableRooms}</p>
                <p className="text-xs text-white/50 mt-1">{availabilitySummary.summary.overallAvailabilityPercentage}% free</p>
              </div>
            </div>
          )}

          {/* Room Type Breakdown */}
          {availabilitySummary && Object.keys(availabilitySummary.byRoomType || {}).length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-white/70" />
                  <h2 className="text-base font-semibold text-white">Room Classifications</h2>
                </div>
                <button
                  onClick={() => {
                    setEditingBlock(null);
                    setStartDateOnly(filterStartDate);
                    setEndDateOnly(filterEndDate);
                    setFormData({
                      ...emptyBlockFormData(),
                      startDate: `${filterStartDate}T00:00:00`,
                      endDate: `${filterEndDate}T00:00:00`,
                    });
                    setShowBlockForm(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add External Booking
                </button>
              </div>
              <div className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-emerald-300 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-emerald-100">
                    <p className="font-semibold mb-1">Quick Update External Bookings:</p>
                    <p className="text-emerald-100/80">When you receive a booking from Airbnb, Booking.com, or other platforms, click "Add External Booking" above, select the room type, dates, and source. This prevents double-booking and keeps your calendar accurate.</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(availabilitySummary.byRoomType).map(([roomType, data]: [string, any]) => (
                  <div key={roomType} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-white">{roomType}</h3>
                      <span className="text-xs text-white/50">{data.availabilityPercentage}%</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/60">Total:</span>
                        <span className="text-white font-semibold">{data.totalRooms}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/60">Booked:</span>
                        <span className="text-amber-300 font-semibold">{data.bookedRooms}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/60">Blocked:</span>
                        <span className="text-red-300 font-semibold">{data.blockedRooms}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-white/10">
                        <span className="text-white/60">Available:</span>
                        <span className="text-emerald-300 font-bold">{data.availableRooms}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Sidebar */}
          <aside className="lg:col-span-4 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-white/60">Property</p>
                  <p className="mt-1 text-lg font-semibold text-white">{property.title}</p>
                  <p className="mt-1 text-sm text-white/60">Tap a day to view details, or use filters below.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 flex flex-col items-center gap-1.5">
                  <p className="text-xs text-white/60 self-start">Live</p>
                  {connected ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        {/* Green — fires first */}
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.7)]"
                          style={{ animation: "nols-seq-blink 1.2s ease-in-out infinite", animationDelay: "0ms" }}
                        />
                        {/* Blue — fires second */}
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-sky-400 shadow-[0_0_6px_2px_rgba(56,189,248,0.7)]"
                          style={{ animation: "nols-seq-blink 1.2s ease-in-out infinite", animationDelay: "400ms" }}
                        />
                        {/* Red — fires third */}
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_6px_2px_rgba(244,63,94,0.7)]"
                          style={{ animation: "nols-seq-blink 1.2s ease-in-out infinite", animationDelay: "800ms" }}
                        />
                      </div>
                      <p className="text-xs font-bold text-emerald-300 self-start">Connected</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                      </div>
                      <p className="text-xs font-bold text-white/40 self-start">Offline</p>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {/* ── Bookings card — deep emerald gradient ── */}
                <button
                  type="button"
                  onClick={() => {
                    setCalendarQuickFilter((prev) => (prev === "bookings" ? "all" : "bookings"));
                    setRangeInsightsTab("bookings");
                    setShowRangeInsights(true);
                  }}
                  style={{
                    background: calendarQuickFilter === "bookings"
                      ? "linear-gradient(135deg, #064e3b 0%, #065f46 100%)"
                      : "linear-gradient(135deg, #022c22 0%, #064e3b 100%)",
                  }}
                  className={`rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-400/60 hover:brightness-125 ${
                    calendarQuickFilter === "bookings" ? "border-emerald-400/50" : "border-emerald-900/60"
                  }`}
                  title="Filter calendar to bookings + view insights"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-emerald-300/80 font-semibold">Bookings</p>
                    {calendarQuickFilter === "bookings" && (
                      <span className="text-[10px] font-bold rounded-full border border-emerald-400/40 bg-emerald-900/60 px-2 py-0.5 text-emerald-200">
                        Filtering
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xl font-bold text-white">{totalBookings}</p>
                  <p className="mt-1 text-[11px] text-emerald-300/50">Click to filter + visualize</p>
                </button>

                {/* ── Blocks card — deep amber gradient ── */}
                <button
                  type="button"
                  onClick={() => {
                    setCalendarQuickFilter((prev) => (prev === "blocks" ? "all" : "blocks"));
                    setRangeInsightsTab("blocks");
                    setShowRangeInsights(true);
                  }}
                  style={{
                    background: calendarQuickFilter === "blocks"
                      ? "linear-gradient(135deg, #78350f 0%, #92400e 100%)"
                      : "linear-gradient(135deg, #3a1a05 0%, #78350f 100%)",
                  }}
                  className={`rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-amber-400/60 hover:brightness-125 ${
                    calendarQuickFilter === "blocks" ? "border-amber-400/50" : "border-amber-900/60"
                  }`}
                  title="Filter calendar to blocks + view insights"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-amber-300/80 font-semibold">Blocks</p>
                    {calendarQuickFilter === "blocks" && (
                      <span className="text-[10px] font-bold rounded-full border border-amber-400/40 bg-amber-900/60 px-2 py-0.5 text-amber-200">
                        Filtering
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xl font-bold text-white">{totalBlocks}</p>
                  <p className="mt-1 text-[11px] text-amber-300/50">Click to filter + visualize</p>
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BedDouble className="h-4 w-4 text-white/70" />
                  <h2 className="text-sm font-semibold text-white">Rooms & Types</h2>
                </div>
                <span className="text-xs text-white/50">Filter the calendar</span>
              </div>

              <div className="mt-4 space-y-2">
                {/* ── All rooms (emerald gradient) ── */}
                <button
                  type="button"
                  onClick={() => setSelectedRoomCode(null)}
                  style={{ background: !selectedRoomCode
                    ? "linear-gradient(135deg, #064e3b 0%, #065f46 100%)"
                    : "linear-gradient(135deg, #022c22 0%, #064e3b 100%)"
                  }}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    !selectedRoomCode ? "border-emerald-400/70" : "border-emerald-700/50 hover:border-emerald-500/60"
                  } text-white`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold">All rooms</p>
                        <p className="text-xs text-white/60">NoLSAF & non&#8209;NoLSAF sources</p>
                      </div>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      !selectedRoomCode
                        ? "border-emerald-400/50 bg-emerald-900/60 text-emerald-200"
                        : "border-emerald-700/40 bg-emerald-900/40 text-emerald-400"
                    }`}>
                      {roomTypes.length}
                    </span>
                  </div>
                </button>

                {/* ── Per room-type — each gets its own dark gradient ── */}
                {roomTypes.map((rt, index) => {
                  const key = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
                  const active = selectedRoomCode === key;
                  const p = ROOM_PALETTE[index % ROOM_PALETTE.length];
                  return (
                    <button
                      key={rt.roomCode ? `room-${rt.roomCode}` : `room-type-${rt.roomType}-${index}`}
                      type="button"
                      onClick={() => setSelectedRoomCode(key || null)}
                      style={{ background: active ? p.activeBg : p.inactiveBg }}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition text-white ${
                        active ? p.activeBorder : `${p.border} hover:brightness-125`
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${p.dot}`} />
                          <div>
                            <p className="text-sm font-semibold">{rt.roomType}</p>
                            <p className="text-xs text-white/60">{rt.roomCode ? `Code: ${rt.roomCode}` : "No code (uses type name)"}</p>
                          </div>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                          active ? p.activeBadgeClass : p.badgeClass
                        }`}>
                          {rt.roomsCount}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-white/70" />
                  <h2 className="text-sm font-semibold text-white">Window</h2>
                </div>
                <button
                  onClick={loadCalendarData}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white transition"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => {
                    const prev = new Date(selectedDate);
                    prev.setMonth(prev.getMonth() - 1);
                    setSelectedDate(prev);
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/80 hover:bg-white/10 hover:text-white transition"
                  title="Previous month"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <label className="sr-only" htmlFor="availability-month-picker">Select month</label>
                <input
                  id="availability-month-picker"
                  type="month"
                  value={`${selectedDate.getFullYear()}-${pad2(selectedDate.getMonth() + 1)}`}
                  onChange={(e) => {
                    const [year, month] = e.target.value.split("-").map(Number);
                    setSelectedDate(new Date(year, month - 1));
                  }}
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  aria-label="Select month for availability calendar"
                />
                <button
                  onClick={() => {
                    const next = new Date(selectedDate);
                    next.setMonth(next.getMonth() + 1);
                    setSelectedDate(next);
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/80 hover:bg-white/10 hover:text-white transition"
                  title="Next month"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="lg:col-span-8 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 shadow-xl shadow-black/20 overflow-hidden">
              <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold text-white">Calendar</h2>
                  <p className="mt-1 text-xs text-white/60">
                    Showing {selectedRoomCode ? `room code ${selectedRoomCode}` : "all rooms"} • Click a date to view details
                  </p>
                  {calendarQuickFilter !== "all" && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setCalendarQuickFilter("all")}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                        title="Clear calendar filter"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        Filter: {calendarQuickFilter === "bookings" ? "Bookings" : "Blocks"} • Clear
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-white/60">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-400" /> Bookings
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-orange-300" /> Blocks
                  </span>
                </div>
              </div>

              <div className="p-5">
                <div className="grid grid-cols-7 gap-2 mb-3">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <div key={day} className="text-center text-xs font-semibold text-white/60 py-2">
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {calendarDays.map((day, idx) => {
                    const isToday = day.date.toDateString() === new Date().toDateString();
                    const isPast = day.date < new Date() && !isToday;
                    const visibleBookings = calendarQuickFilter === "blocks" ? [] : day.bookings;
                    const visibleBlocks = calendarQuickFilter === "bookings" ? [] : day.blocks;
                    const hasBookings = visibleBookings.length > 0;
                    const hasBlocks = visibleBlocks.length > 0;

                    return (
                      <button
                        type="button"
                        key={idx}
                        onClick={() => openDayDetailsFor(day)}
                        className={`min-h-[110px] text-left rounded-2xl border p-3 transition focus:outline-none focus:ring-2 focus:ring-emerald-400/60 ${
                          isToday
                            ? "border-emerald-400/30 bg-emerald-400/10"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        } ${isPast ? "opacity-60" : ""}`}
                        title="View bookings & blocks"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-semibold ${isToday ? "text-emerald-200" : "text-white"}`}>
                            {day.date.getDate()}
                          </span>
                          {(hasBookings || hasBlocks) && (
                            <div className="flex gap-1">
                              {hasBookings && (
                                <div className="w-2 h-2 bg-blue-400 rounded-full" title="Bookings" />
                              )}
                              {hasBlocks && (
                                <div className="w-2 h-2 bg-orange-300 rounded-full" title="Blocks" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          {visibleBookings.slice(0, 2).map((booking) => (
                            <div
                              key={booking.id}
                              className="text-[11px] px-2 py-1 rounded-lg bg-blue-500/15 text-blue-100 border border-blue-400/20 truncate"
                              title={`Booking: ${booking.guestName}`}
                            >
                              {booking.guestName}
                            </div>
                          ))}
                          {visibleBlocks.slice(0, 2).map((block) => (
                            <div
                              key={block.id}
                              className="text-[11px] px-2 py-1 rounded-lg bg-orange-500/15 text-orange-100 border border-orange-400/20 truncate"
                              title={`External booking: ${block.guestName || block.source || "External"}`}
                            >
                              {block.guestName || block.source || "External booking"}
                            </div>
                          ))}
                          {(() => {
                            const shown = Math.min(2, visibleBookings.length) + Math.min(2, visibleBlocks.length);
                            const remaining = visibleBookings.length + visibleBlocks.length - shown;
                            if (remaining <= 0) return null;
                            return <div className="text-[11px] text-white/60">+{remaining} more</div>;
                          })()}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 shadow-xl shadow-black/20">
              <div className="p-5 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold text-white">Availability Blocks</h2>
                  <p className="mt-1 text-xs text-white/60">
                    {selectedRoomCode ? `Filtered to ${selectedRoomCode}` : "All rooms"} • Manage blocks and OTA holds
                  </p>
                </div>
              </div>

              <div className="px-5 pb-5">
                {calendarData && calendarData.blocks.length === 0 ? (
                  <div className="text-center py-12 text-white/60">
                    <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No availability blocks found for this period</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {calendarData?.blocks.map((block) => (
                      <div
                        key={block.id}
                        className="rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="text-sm font-semibold text-white">
                                {new Date(block.startDate).toLocaleDateString()} - {new Date(block.endDate).toLocaleDateString()}
                              </span>
                              <span className="px-2 py-1 text-xs font-semibold rounded-full border border-emerald-400/25 bg-emerald-500/15 text-emerald-100">
                                External booking
                              </span>
                              {block.source && (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full border border-orange-400/20 bg-orange-500/15 text-orange-100">
                                  {block.source}
                                </span>
                              )}
                              {block.roomCode && (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full border border-white/10 bg-white/5 text-white/70">
                                  {block.roomCode}
                                </span>
                              )}
                            </div>
                            <div className="mb-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                              <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/80">
                                Guest: <strong className="text-white">{block.guestName || "Guest"}</strong>
                              </span>
                              <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/80">
                                Phone: <strong className="text-white">{block.guestPhone || "Not set"}</strong>
                              </span>
                              <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/80">
                                Paid: <strong className="text-white">{formatMoney(block.amountPaid, block.currency || "TZS")}</strong>
                              </span>
                            </div>
                            {block.notes && (
                              <p className="text-sm text-white/70 mb-2">{block.notes}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-4 text-xs text-white/50">
                              <span>Beds: {block.bedsBlocked || 1}</span>
                              <span>Created: {formatLocalDateTime(block.createdAt)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleEdit(block)}
                              className="p-2 rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition"
                              title="Edit"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(block.id)}
                              className="p-2 rounded-xl border border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/15 transition"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Day Details Modal (opens when clicking a date) */}
      {showDayDetails && dayDetails && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl max-w-3xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-5 border-b border-slate-200/60 bg-gradient-to-br from-white via-slate-50/40 to-white">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 shadow-sm">
                      <Calendar className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                        {dayDetails.date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                      </h2>
                      <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
                        {selectedRoomCode ? `Filtered to ${selectedRoomCode}` : "All rooms"} • Review bookings before adding a block
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowDayDetails(false);
                    setDayDetails(null);
                    setDayDetailsBookingStatusFilter(null);
                    setDayDetailsBlockSourceFilter(null);
                  }}
                  className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 active:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all flex-shrink-0"
                  title="Close"
                  aria-label="Close day details"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-5">
              {(() => {
                const bookingsCount = dayDetails.bookings.length;
                const blocksCount = dayDetails.blocks.length;
                const total = bookingsCount + blocksCount;

                const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
                const bookingsPct = pct(bookingsCount);
                const blocksPct = pct(blocksCount);

                const byKey = <T,>(items: T[], keyFn: (item: T) => string) => {
                  return items.reduce<Record<string, number>>((acc, item) => {
                    const k = keyFn(item);
                    acc[k] = (acc[k] || 0) + 1;
                    return acc;
                  }, {});
                };

                const bookingByStatus = byKey(dayDetails.bookings, (b) => String((b as any).status || "UNKNOWN"));
                const blockBySource = byKey(dayDetails.blocks, (b) => String((b as any).source || "EXTERNAL"));

                const statusEntries = Object.entries(bookingByStatus).sort((a, b) => b[1] - a[1]);
                const sourceEntries = Object.entries(blockBySource).sort((a, b) => b[1] - a[1]);

                const filteredBookings = dayDetailsBookingStatusFilter
                  ? dayDetails.bookings.filter((b) => String((b as any).status || "UNKNOWN") === dayDetailsBookingStatusFilter)
                  : dayDetails.bookings;
                const filteredBlocks = dayDetailsBlockSourceFilter
                  ? dayDetails.blocks.filter((b) => String((b as any).source || "EXTERNAL") === dayDetailsBlockSourceFilter)
                  : dayDetails.blocks;

                const GRADIENTS = [
                  "bg-gradient-to-r from-blue-600 to-sky-500",
                  "bg-gradient-to-r from-emerald-600 to-teal-500",
                  "bg-gradient-to-r from-fuchsia-600 to-pink-500",
                  "bg-gradient-to-r from-amber-500 to-orange-500",
                  "bg-gradient-to-r from-indigo-600 to-violet-500",
                  "bg-gradient-to-r from-rose-600 to-red-500",
                  "bg-gradient-to-r from-cyan-600 to-teal-400",
                  "bg-gradient-to-r from-slate-700 to-slate-500",
                ] as const;

                const hashKey = (key: string) => {
                  let h = 0;
                  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
                  return Math.abs(h);
                };

                const pickGradient = (key: string) => GRADIENTS[hashKey(key) % GRADIENTS.length];

                const renderStackedBar = (
                  entries: [string, number][],
                  totalCount: number,
                  label: string,
                  activeKey: string | null,
                  onToggle: (key: string) => void
                ) => {
                  if (totalCount <= 0) {
                    return (
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                        <div className="h-full w-full" />
                      </div>
                    );
                  }

                  return (
                    <div
                      className="h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200"
                      role="img"
                      aria-label={`${label} stacked graph`}
                    >
                      <div className="flex h-full w-full">
                        {entries.map(([k, v]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => onToggle(k)}
                            className={`h-full ${pickGradient(`${label}:${k}`)} ${
                              activeKey && k !== activeKey ? "opacity-35" : "opacity-100"
                            } cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20`}
                            style={{ width: `${(v / totalCount) * 100}%` }}
                            title={`${k.replaceAll("_", " ")}: ${v}`}
                            aria-label={`${label}: ${k.replaceAll("_", " ")} (${v})`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                };

                return (
                  <>
                    {/* Summary tiles */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">NoLSAF bookings</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <div className="text-2xl font-extrabold text-slate-900">{bookingsCount}</div>
                          <div className="text-xs font-semibold text-slate-500">({bookingsPct}%)</div>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">External blocks</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <div className="text-2xl font-extrabold text-slate-900">{blocksCount}</div>
                          <div className="text-xs font-semibold text-slate-500">({blocksPct}%)</div>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total items</div>
                        <div className="mt-1 text-2xl font-extrabold text-slate-900">{total}</div>
                      </div>
                    </div>

                    {/* Visual graph (stacked by status/source) */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-extrabold text-slate-900">Day graph</div>
                        <div className="flex items-center gap-2">
                          {(dayDetailsBookingStatusFilter || dayDetailsBlockSourceFilter) && (
                            <button
                              type="button"
                              onClick={() => {
                                setDayDetailsBookingStatusFilter(null);
                                setDayDetailsBlockSourceFilter(null);
                              }}
                              className="text-xs font-bold rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50"
                              title="Clear filters"
                            >
                              Clear filters
                            </button>
                          )}
                          <div className="text-xs text-slate-500">Stacked breakdown</div>
                        </div>
                      </div>

                      <div className="mt-4 space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Bookings</div>
                            <div className="text-xs font-semibold text-slate-500">
                              {dayDetailsBookingStatusFilter ? (
                                <span>
                                  {filteredBookings.length}/{bookingsCount}
                                </span>
                              ) : (
                                <span>{bookingsCount}</span>
                              )}
                            </div>
                          </div>
                          <div className="mt-2">
                            {renderStackedBar(statusEntries, bookingsCount, "Bookings", dayDetailsBookingStatusFilter, (k) => {
                              setDayDetailsBookingStatusFilter((prev) => (prev === k ? null : k));
                            })}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                            {(statusEntries.length ? statusEntries : ([['NO_BOOKINGS', 0]] as [string, number][])).slice(0, 6).map(([k, v]) => (
                              <span
                                key={k}
                                role="button"
                                tabIndex={0}
                                onClick={() => setDayDetailsBookingStatusFilter((prev) => (prev === k ? null : k))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setDayDetailsBookingStatusFilter((prev) => (prev === k ? null : k));
                                  }
                                }}
                                className={`inline-flex items-center gap-2 rounded-full border bg-white px-2.5 py-1 font-semibold text-slate-700 cursor-pointer select-none transition ${
                                  dayDetailsBookingStatusFilter === k ? "border-slate-900/20 ring-2 ring-slate-900/10" : "border-slate-200 hover:bg-slate-50"
                                }`}
                                title={`${String(k).replaceAll("_", " ")}: ${v}`}
                              >
                                <span className={`h-2 w-2 rounded-full ${pickGradient(`Bookings:${k}`)}`} />
                                {String(k).replaceAll("_", " ")} {v ? `(${v})` : ""}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-extrabold uppercase tracking-wider text-slate-700">External blocks</div>
                            <div className="text-xs font-semibold text-slate-500">
                              {dayDetailsBlockSourceFilter ? (
                                <span>
                                  {filteredBlocks.length}/{blocksCount}
                                </span>
                              ) : (
                                <span>{blocksCount}</span>
                              )}
                            </div>
                          </div>
                          <div className="mt-2">
                            {renderStackedBar(sourceEntries, blocksCount, "Blocks", dayDetailsBlockSourceFilter, (k) => {
                              setDayDetailsBlockSourceFilter((prev) => (prev === k ? null : k));
                            })}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                            {(sourceEntries.length ? sourceEntries : ([['NO_BLOCKS', 0]] as [string, number][])).slice(0, 6).map(([k, v]) => (
                              <span
                                key={k}
                                role="button"
                                tabIndex={0}
                                onClick={() => setDayDetailsBlockSourceFilter((prev) => (prev === k ? null : k))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setDayDetailsBlockSourceFilter((prev) => (prev === k ? null : k));
                                  }
                                }}
                                className={`inline-flex items-center gap-2 rounded-full border bg-white px-2.5 py-1 font-semibold text-slate-700 cursor-pointer select-none transition ${
                                  dayDetailsBlockSourceFilter === k ? "border-slate-900/20 ring-2 ring-slate-900/10" : "border-slate-200 hover:bg-slate-50"
                                }`}
                                title={`${String(k).replaceAll("_", " ")}: ${v}`}
                              >
                                <span className={`h-2 w-2 rounded-full ${pickGradient(`Blocks:${k}`)}`} />
                                {String(k).replaceAll("_", " ")} {v ? `(${v})` : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Bookings by status</div>
                        <div className="mt-3 space-y-2">
                          {statusEntries.length === 0 ? (
                            <div className="text-sm text-slate-500">No bookings for this date.</div>
                          ) : (
                            statusEntries.map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-slate-800 truncate">{k.replaceAll("_", " ")}</div>
                                <span className="text-xs font-bold text-slate-600 rounded-full border border-slate-200 px-2 py-0.5">{v}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="text-xs font-extrabold uppercase tracking-wider text-slate-700">External blocks by source</div>
                        <div className="mt-3 space-y-2">
                          {sourceEntries.length === 0 ? (
                            <div className="text-sm text-slate-500">No external blocks for this date.</div>
                          ) : (
                            sourceEntries.map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-slate-800 truncate">{k.replaceAll("_", " ")}</div>
                                <span className="text-xs font-bold text-slate-600 rounded-full border border-slate-200 px-2 py-0.5">{v}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Detailed items */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
                          <div className="text-xs font-extrabold uppercase tracking-wider text-slate-800">NoLSAF bookings</div>
                          <span className="text-[11px] font-bold text-slate-600 rounded-full border border-slate-200 px-2 py-0.5">
                            {dayDetailsBookingStatusFilter ? `${filteredBookings.length}/${bookingsCount}` : bookingsCount}
                          </span>
                        </div>
                        <div className="p-4">
                          {filteredBookings.length === 0 ? (
                            <div className="text-sm text-slate-500">No bookings on this date.</div>
                          ) : (
                            <div className="space-y-3">
                              {filteredBookings.map((b) => (
                                <div key={b.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-slate-900 truncate">{b.guestName || "Guest"}</div>
                                      <div className="mt-0.5 text-xs text-slate-600">
                                        {new Date(b.checkIn).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – {new Date(b.checkOut).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                      </div>
                                    </div>
                                    <span className="text-[11px] font-bold rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">
                                      {String(b.status || "").replaceAll("_", " ")}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                                    {b.roomCode ? <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">Room: {b.roomCode}</span> : null}
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">Guests: {b.guests?.adults ?? 0}A {b.guests?.children ?? 0}C</span>
                                    {b.guestPhone ? <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{b.guestPhone}</span> : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
                          <div className="text-xs font-extrabold uppercase tracking-wider text-slate-800">External blocks</div>
                          <span className="text-[11px] font-bold text-slate-600 rounded-full border border-slate-200 px-2 py-0.5">
                            {dayDetailsBlockSourceFilter ? `${filteredBlocks.length}/${blocksCount}` : blocksCount}
                          </span>
                        </div>
                        <div className="p-4">
                          {filteredBlocks.length === 0 ? (
                            <div className="text-sm text-slate-500">No external blocks on this date.</div>
                          ) : (
                            <div className="space-y-3">
                              {filteredBlocks.map((blk) => (
                                <div key={blk.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-slate-900 truncate">
                                        {blk.guestName || (blk.source || "External").replaceAll("_", " ")}
                                      </div>
                                      <div className="mt-0.5 text-xs text-slate-600">
                                        {new Date(blk.startDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – {new Date(blk.endDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                      </div>
                                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                          External booking
                                        </span>
                                        {blk.amountPaid != null ? (
                                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                                            Paid: {formatMoney(blk.amountPaid, blk.currency || "TZS")}
                                          </span>
                                        ) : null}
                                        {blk.roomCode ? <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">Room: {blk.roomCode}</span> : null}
                                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">Beds: {blk.bedsBlocked || 1}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setShowDayDetails(false);
                                          setDayDetails(null);
                                          handleEdit(blk);
                                        }}
                                        className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-700 hover:bg-slate-50 transition"
                                        title="Edit block"
                                        aria-label="Edit block"
                                      >
                                        <Edit className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDelete(blk.id)}
                                        className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700 hover:bg-rose-100 transition"
                                        title="Delete block"
                                        aria-label="Delete block"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 md:px-8 py-4 border-t border-slate-200/60 bg-gradient-to-b from-slate-50/50 to-white">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const d = dayDetails.date;
                    setShowDayDetails(false);
                    setDayDetails(null);
                    openQuickBlock(d);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-extrabold text-white shadow-[0_16px_40px_-24px_rgba(2,102,94,0.6)] ring-1 ring-inset ring-white/15 hover:to-cyan-600 active:scale-[0.99] transition"
                >
                  <Plus className="h-4 w-4" />
                  Add external block
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDayDetails(false);
                    setDayDetails(null);
                  }}
                  className="px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Range Insights Modal (opens from Bookings/Blocks tiles) */}
      {showRangeInsights && calendarData && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-5 border-b border-slate-200/60 bg-gradient-to-br from-white via-slate-50/40 to-white">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 shadow-sm">
                      <Layers className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">Insights</h2>
                      <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
                        {selectedRoomCode ? `Filtered to ${selectedRoomCode}` : "All rooms"} • {formatConfirmDate(calendarData.dateRange.start)} – {formatConfirmDate(calendarData.dateRange.end)}
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowRangeInsights(false)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 active:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all flex-shrink-0"
                  title="Close"
                  aria-label="Close insights"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRangeInsightsTab("bookings")}
                  className={`rounded-full px-4 py-2 text-sm font-bold border transition ${
                    rangeInsightsTab === "bookings"
                      ? "border-blue-200 bg-blue-50 text-blue-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Bookings ({calendarData.bookings.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRangeInsightsTab("blocks")}
                  className={`rounded-full px-4 py-2 text-sm font-bold border transition ${
                    rangeInsightsTab === "blocks"
                      ? "border-orange-200 bg-orange-50 text-orange-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Blocks ({calendarData.blocks.length})
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-5">
              {(() => {
                const byKey = <T,>(items: T[], keyFn: (item: T) => string) => {
                  return items.reduce<Record<string, number>>((acc, item) => {
                    const k = keyFn(item);
                    acc[k] = (acc[k] || 0) + 1;
                    return acc;
                  }, {});
                };

                const palette = [
                  "#2563eb",
                  "#0ea5e9",
                  "#10b981",
                  "#f59e0b",
                  "#f97316",
                  "#ec4899",
                  "#8b5cf6",
                  "#06b6d4",
                  "#64748b",
                ] as const;

                const hashKey = (key: string) => {
                  let h = 0;
                  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
                  return Math.abs(h);
                };

                const pickColor = (key: string) => palette[hashKey(key) % palette.length];

                const donutGradient = (entries: [string, number][]) => {
                  const total = entries.reduce((s, [, v]) => s + v, 0);
                  if (total <= 0) return "conic-gradient(#e2e8f0 0 100%)";
                  let acc = 0;
                  const stops = entries.map(([k, v]) => {
                    const start = (acc / total) * 100;
                    acc += v;
                    const end = (acc / total) * 100;
                    const color = pickColor(k);
                    return `${color} ${start}% ${end}%`;
                  });
                  return `conic-gradient(${stops.join(", ")})`;
                };

                const renderStack = (entries: [string, number][]) => {
                  const total = entries.reduce((s, [, v]) => s + v, 0);
                  return (
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                      <div className="flex h-full w-full">
                        {entries.map(([k, v]) => (
                          <div
                            key={k}
                            style={{ width: `${total > 0 ? (v / total) * 100 : 0}%`, backgroundColor: pickColor(k) }}
                            className="h-full"
                            title={`${k.replaceAll("_", " ")}: ${v}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                };

                const entries =
                  rangeInsightsTab === "bookings"
                    ? Object.entries(byKey(calendarData.bookings, (b) => String((b as any).status || "UNKNOWN"))).sort((a, b) => b[1] - a[1])
                    : Object.entries(byKey(calendarData.blocks, (b) => String((b as any).source || "EXTERNAL"))).sort((a, b) => b[1] - a[1]);

                const total = entries.reduce((s, [, v]) => s + v, 0);

                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-1">
                        <div className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                          {rangeInsightsTab === "bookings" ? "Bookings" : "External blocks"} distribution
                        </div>
                        <div className="mt-4 flex items-center justify-center">
                          <div
                            className="relative h-44 w-44 rounded-full"
                            style={{ backgroundImage: donutGradient(entries as [string, number][]) }}
                            aria-label="Donut chart"
                            role="img"
                          >
                            <div className="absolute inset-6 rounded-full bg-white ring-1 ring-slate-200 shadow-sm" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="text-center">
                                <div className="text-2xl font-extrabold text-slate-900">{total}</div>
                                <div className="text-xs font-semibold text-slate-500">total</div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 text-xs text-slate-500">
                          Tip: click the sidebar tiles to filter the calendar.
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-extrabold text-slate-900">Breakdown</div>
                          <div className="text-xs text-slate-500">Stacked view</div>
                        </div>
                        <div className="mt-4">{renderStack(entries as [string, number][])}</div>
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {(entries as [string, number][]).slice(0, 10).map(([k, v]) => (
                            <div key={k} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                              <div className="min-w-0 flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: pickColor(k) }} />
                                <span className="text-sm font-semibold text-slate-800 truncate">{k.replaceAll("_", " ")}</span>
                              </div>
                              <span className="text-xs font-extrabold text-slate-700">{v}</span>
                            </div>
                          ))}
                          {entries.length === 0 && <div className="text-sm text-slate-500">No data for this range.</div>}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="px-4 sm:px-6 md:px-8 py-4 border-t border-slate-200/60 bg-gradient-to-b from-slate-50/50 to-white">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setShowRangeInsights(false)}
                  className="px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Block Form Modal */}
      {showBlockForm && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto bg-black/60 p-3 py-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-sm animate-in fade-in duration-200 sm:p-4 md:p-6">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-slate-900 leading-tight">
                      {editingBlock ? "Edit availability block" : "Add availability block"}
                    </h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Record the guest details and block rooms for this external stay.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowBlockForm(false);
                    setEditingBlock(null);
                    setStartDateOnly("");
                    setEndDateOnly("");
                    setFormData(emptyBlockFormData());
                  }}
                  className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition flex-shrink-0"
                  title="Close form"
                  aria-label="Close availability block form"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Inline capacity error banner — shown at top of form instead of a blocking overlay */}
            {capacityError && (
              <div className="mx-4 mt-3 sm:mx-5 rounded-xl border border-rose-200 bg-rose-50 p-3 sm:p-4 animate-in fade-in duration-200">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-rose-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <AlertCircle className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-rose-900">Rooms at capacity</p>
                    <p className="text-xs text-rose-700 mt-0.5">
                      <strong>{capacityError.roomType}</strong>: {capacityError.roomsLeft} room{capacityError.roomsLeft !== 1 ? "s" : ""} left
                      {capacityError.totalRooms != null && (
                        <span className="text-rose-600/80"> · Total {capacityError.totalRooms} · Booked {capacityError.bookedRooms ?? 0} · Blocked {capacityError.blockedRooms ?? 0}{capacityError.bedsRequested != null ? ` · Requested ${capacityError.bedsRequested}` : ""}</span>
                      )}
                    </p>
                    {(capacityError.otherRoomTypes?.length ?? 0) > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {capacityError.otherRoomTypes!.map((o, i) => (
                          <button
                            key={`${o.type}-${i}`}
                            type="button"
                            onClick={() => selectRoomTypeFromCapacityModal(o.type)}
                            className="text-xs px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200 font-semibold transition"
                          >
                            {o.type}: {o.roomsLeft} left
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => setCapacityError(null)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-rose-200 text-rose-500 transition flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Form Content */}
            <form onSubmit={handleSubmit} className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
              <div className="p-4 sm:p-5 space-y-4 sm:space-y-5">
                {/* Date Range Section */}
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-2 pb-1">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                      <Clock className="w-3.5 h-3.5 text-slate-600" />
                    </div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 uppercase tracking-wider">Date Range</h3>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500">
                    Select the dates when the guest will stay.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    {/* Start Date */}
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700">
                        Check-in <span className="text-red-500 font-normal">*</span>
                      </label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setBlockPicking("checkin");
                            setBlockRangePickerOpen(true);
                          }}
                          className="w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border border-slate-300 rounded-lg sm:rounded-xl bg-white text-slate-900 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-emerald-600" />
                            <span>{startDateOnly ? new Date(startDateOnly + "T00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Select date"}</span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 rotate-90" />
                        </button>
                      </div>
                    </div>
                    {/* End Date */}
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="block text-xs sm:text-sm font-semibold text-slate-700">
                        Check-out <span className="text-red-500 font-normal">*</span>
                      </label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setBlockPicking(startDateOnly ? "checkout" : "checkin");
                            setBlockRangePickerOpen(true);
                          }}
                          className="w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border border-slate-300 rounded-lg sm:rounded-xl bg-white text-slate-900 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-emerald-600" />
                            <span>{endDateOnly ? new Date(endDateOnly + "T00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Select date"}</span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 rotate-90" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* One range picker for the block form: first click sets check-in, second click sets check-out */}
                  {blockRangePickerOpen && (
                    <>
                      <div className="fixed inset-0 z-[100] bg-black/40" onClick={() => setBlockRangePickerOpen(false)} aria-hidden="true" />
                      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
                        <div className="pointer-events-auto">
                          <DatePicker
                            selected={
                              startDateOnly && endDateOnly
                                ? [startDateOnly, endDateOnly]
                                : startDateOnly
                                  ? [startDateOnly]
                                  : undefined
                            }
                            onSelectAction={(s) => {
                              if (Array.isArray(s) && s.length === 2) {
                                const a = s[0];
                                let b = s[1];
                                if (b <= a) b = addOneDayYMD(a);
                                setStartDateOnly(a);
                                setEndDateOnly(b);
                                setBlockRangePickerOpen(false);
                              } else {
                                const d = Array.isArray(s) ? s[0] : s;
                                if (d) {
                                  if (blockPicking === "checkout" && startDateOnly) {
                                    let b = d;
                                    if (b <= startDateOnly) b = addOneDayYMD(startDateOnly);
                                    setEndDateOnly(b);
                                    setBlockRangePickerOpen(false);
                                    return;
                                  }
                                  setStartDateOnly(d);
                                  setEndDateOnly("");
                                  // keep open until owner chooses a check-out date
                                }
                              }
                            }}
                            onCloseAction={() => setBlockRangePickerOpen(false)}
                            allowRange={true}
                            minDate={todayYmd}
                            twoMonths
                            initialViewDate={formatLocalYMD(selectedDate)}
                            resetRangeAnchor={blockPicking === "checkin"}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Room & Source Section */}
                <div className="space-y-4 sm:space-y-5">
                  <div className="flex items-center gap-2 pb-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                      <Home className="w-3.5 h-3.5 text-slate-600" />
                    </div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 uppercase tracking-wider">Room & Source</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div className="space-y-2">
                      <label htmlFor="block-room-code-modal" className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Room Type <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <select
                          id="block-room-code-modal"
                          value={formData.roomCode}
                          onChange={(e) => {
                            const selectedValue = e.target.value;
                            const selected = roomTypes.find((rt) => {
                              const value = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
                              return String(value) === String(selectedValue);
                            });
                            const rate = Number(selected?.basePrice || 0);
                            const currency = selected?.currency || formData.currency || "TZS";
                            const nextAmount = Math.max(0, formNights * Math.max(0, rate) * Math.max(1, Number(formData.bedsBlocked || 1)));
                            setFormData({
                              ...formData,
                              roomCode: selectedValue,
                              roomRate: rate,
                              currency,
                              calculatedAmount: nextAmount,
                              amountPaid: nextAmount,
                            });
                          }}
                          required
                          disabled={loadingBlockRangeAvailability || blockRangeHasNoRooms || !blockRangeHasDates}
                          className="w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border border-slate-300 rounded-lg sm:rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all appearance-none cursor-pointer shadow-sm hover:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                          aria-label="Select room type for availability block"
                          aria-required="true"
                        >
                          <option value="" disabled>
                            {!blockRangeHasDates
                              ? "Select date range first"
                              : loadingBlockRangeAvailability
                                ? "Checking availability..."
                                : blockRangeHasNoRooms
                                  ? "No rooms available"
                                  : "Select Room Type"}
                          </option>
                          {availableRoomTypesForForm.map((rt, index) => {
                            const value = (rt.roomCode && rt.roomCode.trim() !== "") ? rt.roomCode : rt.roomType;
                            if (!value) return null;
                            const availability = getRoomAvailabilityForForm(rt.roomType);
                            const availableRooms = availability?.availableRooms;
                            return (
                              <option key={`room-${value}-${index}`} value={value}>
                                {rt.roomType} - {formatMoney(rt.basePrice, rt.currency || "TZS")}
                                {availableRooms != null ? ` - ${availableRooms} available` : ""}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      {loadingBlockRangeAvailability && (
                        <p className="text-xs text-slate-500">Checking available rooms for the selected dates...</p>
                      )}
                      {blockRangeAvailabilityError && (
                        <p className="text-xs text-rose-600">{blockRangeAvailabilityError}</p>
                      )}
                      {blockRangeHasNoRooms && (
                        <p className="text-xs font-semibold text-rose-600">
                          All rooms are occupied for this date range. Choose another stay date.
                        </p>
                      )}
                      {blockRangeAvailability && !blockRangeHasNoRooms && !loadingBlockRangeAvailability && (
                        <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                          <span className="font-semibold text-emerald-800">
                            {blockRangeAvailability.summary?.totalAvailableRooms ?? availableRoomTypesForForm.length} room{Number(blockRangeAvailability.summary?.totalAvailableRooms ?? availableRoomTypesForForm.length) === 1 ? "" : "s"} available
                          </span>
                          <span className="text-slate-500">for selected dates</span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="block-source" className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Source <span className="text-red-500 font-normal">*</span>
                      </label>
                      <div className="relative">
                        <select
                          id="block-source"
                          value={formData.source}
                          onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                          required
                          className="w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm sm:text-base border border-slate-300 rounded-lg sm:rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all appearance-none cursor-pointer shadow-sm hover:border-slate-400 pr-8 sm:pr-10"
                          aria-label="Select booking source"
                        >
                          <option value="">Select source</option>
                          {SOURCE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Guest Details Section */}
                <div className="space-y-4 sm:space-y-5">
                  <div className="flex items-center gap-2 pb-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                      <User className="w-3.5 h-3.5 text-slate-600" />
                    </div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 uppercase tracking-wider">Guest Details</h3>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                    <div className="min-w-0 space-y-1.5 sm:col-span-2">
                      <label htmlFor="external-guest-name" className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Guest Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="external-guest-name"
                        value={formData.guestName}
                        onChange={(e) => setFormData({ ...formData, guestName: e.target.value })}
                        className="box-border h-12 w-full max-w-full min-w-0 px-3 text-sm border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm hover:border-slate-400"
                        placeholder="Full name"
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <label htmlFor="external-nationality" className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Country <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <select
                          id="external-nationality"
                          value={formData.nationality}
                          onChange={(e) => setFormData({ ...formData, nationality: e.target.value })}
                          required
                          className="box-border h-12 w-full max-w-full min-w-0 px-3 pr-9 text-sm border border-slate-300 rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all appearance-none cursor-pointer shadow-sm hover:border-slate-400"
                        >
                          <option value="">Select country</option>
                          {GUEST_COUNTRY_OPTIONS.map((country) => (
                            <option key={country.value} value={country.value}>
                              {country.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <label htmlFor="external-guest-phone" className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Phone Number
                      </label>
                      <input
                        id="external-guest-phone"
                        value={formData.guestPhone}
                        onChange={(e) => setFormData({ ...formData, guestPhone: e.target.value })}
                        className="box-border h-12 w-full max-w-full min-w-0 px-3 text-sm border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm hover:border-slate-400"
                        placeholder="+255..."
                      />
                    </div>
                  </div>
                </div>

                {/* Quantity Section */}
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-2 pb-1">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                      <BedDouble className="w-3.5 h-3.5 text-slate-600" />
                    </div>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 uppercase tracking-wider">Quantity</h3>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 sm:grid-cols-3 gap-4 items-start">
                    <div className="min-w-0 space-y-1.5">
                      <label htmlFor="block-beds" className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Beds/Rooms Blocked <span className="text-red-500 font-normal">*</span>
                      </label>
                      <input
                        id="block-beds"
                        type="number"
                        min="1"
                        value={formData.bedsBlocked}
                        onChange={(e) => setFormData({ ...formData, bedsBlocked: Number(e.target.value) || 1 })}
                        required
                        className="box-border h-12 w-full max-w-full min-w-0 px-3 text-sm border border-slate-300 rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm hover:border-slate-400"
                        aria-label="Number of beds or rooms blocked"
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <label htmlFor="external-amount-paid" className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Total Amount Paid
                      </label>
                      <input
                        id="external-amount-paid"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={formData.amountPaid}
                        onChange={(e) => setFormData({ ...formData, amountPaid: Number(e.target.value) || 0 })}
                        className="box-border h-12 w-full max-w-full min-w-0 px-3 text-sm border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm hover:border-slate-400"
                        placeholder={formatMoney(calculatedExternalAmount, formCurrency)}
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <label htmlFor="external-paid-via" className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                        Paid via
                      </label>
                      <select
                        id="external-paid-via"
                        value={formData.paidVia}
                        onChange={(e) => setFormData({ ...formData, paidVia: e.target.value })}
                        className="box-border h-12 w-full max-w-full min-w-0 px-3 text-sm border border-slate-300 rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all appearance-none cursor-pointer shadow-sm hover:border-slate-400"
                      >
                        <option value="">Select payment</option>
                        <option value="CASH">Cash</option>
                        <option value="MOBILE">Mobile</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50/80 p-3 sm:p-4 flex items-start gap-2 sm:gap-3 animate-in slide-in-from-top-2 duration-200">
                    <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs sm:text-sm text-red-700 leading-relaxed">{error}</p>
                  </div>
                )}
              </div>

              {/* Footer Actions */}
              <div className="px-4 py-3.5 sm:px-5 sm:py-4 border-t border-slate-200/60 bg-gradient-to-b from-slate-50/50 to-white">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 bg-emerald-600 text-white rounded-lg sm:rounded-xl text-sm sm:text-base font-semibold shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 hover:shadow-xl hover:shadow-emerald-700/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>{editingBlock ? "Update Block" : "Create Block"}</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBlockForm(false);
                      setEditingBlock(null);
                      setStartDateOnly("");
                      setEndDateOnly("");
                      setFormData(emptyBlockFormData());
                    }}
                    className="px-4 sm:px-6 py-2.5 sm:py-3 border border-slate-300 text-slate-700 rounded-lg sm:rounded-xl text-sm sm:text-base font-semibold bg-white hover:bg-slate-50 active:scale-[0.98] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Conflict Confirmation Modal */}
      {showConflictModal && conflictData && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl max-w-md sm:max-w-lg w-full my-auto animate-in zoom-in-95 duration-200 max-h-[95vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-orange-50 flex-shrink-0 rounded-t-2xl sm:rounded-t-3xl">
              <div className="flex items-start gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-amber-500 flex items-center justify-center shadow-sm flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Booking Conflict Detected</h2>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">
                    This availability block conflicts with existing bookings
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 flex-1 overflow-y-auto">
              <div className="mb-4">
                <p className="text-xs sm:text-sm text-slate-700 mb-4 leading-relaxed">
                  Creating this block will overlap with <strong>{conflictData.conflictingBookings.length}</strong> existing booking{conflictData.conflictingBookings.length !== 1 ? 's' : ''}. This may cause double-booking issues.
                </p>

                {/* Conflicting Bookings List */}
                {conflictData.conflictingBookings.length > 0 && (
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 sm:p-4 mb-4">
                    <h3 className="text-[10px] sm:text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2 sm:mb-3">Conflicting Bookings</h3>
                    <div className="space-y-1.5 sm:space-y-2 max-h-40 sm:max-h-48 overflow-y-auto">
                      {conflictData.conflictingBookings.slice(0, 5).map((booking: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-2 sm:gap-3 p-1.5 sm:p-2 bg-white rounded-lg border border-slate-200">
                          <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-amber-500 mt-1 sm:mt-1.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs sm:text-sm font-medium text-slate-900 truncate">
                              {booking.guestName || "Guest"}
                            </p>
                            <p className="text-[10px] sm:text-xs text-slate-600 mt-0.5 leading-relaxed break-words">
                              {new Date(booking.checkIn).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} - {new Date(booking.checkOut).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {booking.roomCode && (
                                <span className="text-[10px] sm:text-xs text-slate-500">Room: {booking.roomCode}</span>
                              )}
                              {booking.totalAmount !== undefined && booking.totalAmount !== null && Number(booking.totalAmount) > 0 && (
                                <span className="text-[10px] sm:text-xs font-semibold text-emerald-700">
                                  Amount: TZS {typeof booking.totalAmount === 'number' ? booking.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : Number(booking.totalAmount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {conflictData.conflictingBookings.length > 5 && (
                        <p className="text-[10px] sm:text-xs text-slate-500 text-center pt-1 sm:pt-2">
                          + {conflictData.conflictingBookings.length - 5} more booking{conflictData.conflictingBookings.length - 5 !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 sm:p-3 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] sm:text-xs text-amber-800 leading-relaxed">
                  <strong>Warning:</strong> Proceeding will create a conflict. Please review your calendar to avoid double-booking.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 flex-shrink-0 rounded-b-2xl sm:rounded-b-3xl">
              <button
                type="button"
                onClick={handleConflictCancel}
                className="w-full sm:w-auto px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold bg-white hover:bg-slate-50 active:scale-[0.98] transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConflictConfirm}
                className="w-full sm:w-auto px-4 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-semibold shadow-md hover:bg-amber-700 active:scale-[0.98] transition-all"
              >
                Continue Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl max-w-lg w-full max-h-[95vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200 bg-gradient-to-r from-emerald-50 via-white to-sky-50 flex-shrink-0 rounded-t-2xl sm:rounded-t-3xl">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-600/20 flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                    {editingBlock ? "Confirm update" : "Confirm creation"}
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {editingBlock
                      ? "Please confirm you want to update this availability block."
                      : "Please confirm you want to create this availability block."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 active:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all flex-shrink-0"
                  aria-label="Close confirmation"
                  title="Close"
                  disabled={saving}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 flex-1 overflow-y-auto">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Room type</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 break-words">
                      {getRoomTypeLabel(formData.roomCode || "")}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Source</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 break-words">
                      {formData.source || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Guest</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 break-words">
                      {formData.guestName || "Guest"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Amount paid</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 break-words">
                      {formatMoney(formData.amountPaid || calculatedExternalAmount, formCurrency)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Paid via</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 break-words">
                      {formData.paidVia === "CASH" ? "Cash" : formData.paidVia === "MOBILE" ? "Mobile" : "Not selected"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check-in</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {formatConfirmDate(formData.startDate)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check-out</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {formatConfirmDate(formData.endDate)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Beds/rooms blocked</p>
                    <p className="mt-1 text-sm font-bold text-emerald-900">{formData.bedsBlocked}</p>
                  </div>
                  <div className="text-[11px] text-emerald-800/80 text-right">
                    This affects availability
                    <br />
                    on your public calendar.
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <label className="flex cursor-pointer items-center justify-between gap-4 text-sm text-slate-800">
                  <span className="min-w-0 leading-relaxed">
                    <span>
                      I agree to the{" "}
                      <Link href="/terms" target="_blank" className="font-semibold text-emerald-700 no-underline hover:text-emerald-800">
                        Terms of Service
                      </Link>
                      .
                    </span>
                    <span className="block text-xs text-slate-500 mt-1">
                      Required before you can {editingBlock ? "update" : "create"} this block.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={tosAccepted}
                    onChange={(e) => setTosAccepted(e.target.checked)}
                  />
                  <span
                    aria-hidden="true"
                    className="relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full border border-slate-300 bg-slate-200 shadow-inner transition-colors peer-checked:border-emerald-600 peer-checked:bg-emerald-600"
                  >
                    <span className="inline-block h-6 w-6 translate-x-1 rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition-transform peer-checked:translate-x-7" />
                  </span>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 flex-shrink-0 rounded-b-2xl sm:rounded-b-3xl">
              <button
                type="button"
                className="w-full sm:w-auto px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold bg-white hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-60"
                onClick={() => setShowConfirmModal(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`w-full sm:w-auto px-4 py-2.5 rounded-lg text-sm font-semibold text-white shadow-md active:scale-[0.98] transition-all ${
                  tosAccepted
                    ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20"
                    : "bg-emerald-300 cursor-not-allowed"
                }`}
                onClick={async () => {
                  if (!tosAccepted) return;
                  setShowConfirmModal(false);
                  await submitBlock();
                }}
                disabled={!tosAccepted || saving}
              >
                {saving ? "Processing…" : (editingBlock ? "Yes, update" : "Yes, create")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
