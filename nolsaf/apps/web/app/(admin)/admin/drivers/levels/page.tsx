"use client";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Trophy, Truck, Search, Star, TrendingUp, Users, Target, Award, CheckCircle, Eye, X, BarChart3, PieChart as PieChartIcon, Car, Bike, CarTaxiFront, MessageSquare, Send, Clock, Bell, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useAdminQueryId } from "@/lib/adminRecordRefs";
import { io, Socket } from "socket.io-client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const api = apiClient;
function authify() {}

const formatMoney = (value: number | null | undefined) => `${Math.round(Number(value ?? 0)).toLocaleString()} TZS`;
const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

type DriverWithLevel = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  suspendedAt: string | null;
  createdAt: string;
  region: string | null;
  district: string | null;
  operationArea?: string | null;
  vehicleType: string; // "Tuktuk" | "MotorCycle" | "Car"
  plateNumber: string;
  vehiclePlate?: string | null;
  kycStatus?: string | null;
  currentLevel: number;
  levelName: string;
  totalEarnings: number;
  grossRevenue: number;
  nolsafRevenue: number;
  paidEarnings: number;
  totalTrips: number;
  paidTrips: number;
  invoiceCount: number;
  pendingPayouts: number;
  verifiedPayouts: number;
  approvedPayouts: number;
  averageRating: number;
  totalReviews: number;
  goalsCompleted: number;
  lastTripAt: string | null;
  lastPaidAt: string | null;
  progress: {
    earnings: number;
    trips: number;
    rating: number;
    reviews: number;
    goals: number;
  };
  levelBenefits: string[];
};

type Summary = {
  total: number;
  silver: number;
  gold: number;
  diamond: number;
};

type DriverLevelMessage = {
  id: number;
  driverId: number;
  driverName: string;
  driverEmail: string;
  driverPhone: string | null;
  message: string;
  status: "PENDING" | "RESPONDED" | "RESOLVED";
  createdAt: string;
  responses?: Array<{
    id: number;
    message: string;
    adminName: string;
    createdAt: string;
  }>;
};

type DriverTableSortKey = "driver" | "vehicle" | "level" | "progress" | "metrics" | "rating";

export default function AdminDriversLevelsPage() {
  const searchParams = useSearchParams();
  const queryDriverId = useAdminQueryId("driver", searchParams?.get("driverId"), "driverId");
  const router = useRouter();
  const pathname = usePathname();
  const [drivers, setDrivers] = useState<DriverWithLevel[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, silver: 0, gold: 0, diamond: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<"" | "1" | "2" | "3">("");
  const [tablePage, setTablePage] = useState(1);
  const tablePageSize = 10;
  const [sortBy, setSortBy] = useState<DriverTableSortKey>("level");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedDriver, setSelectedDriver] = useState<DriverWithLevel | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"drivers" | "messages">("drivers");
  
  // Messages state
  const [messages, setMessages] = useState<DriverLevelMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<DriverLevelMessage | null>(null);
  const [responseText, setResponseText] = useState("");
  const [sending, setSending] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "RESPONDED" | "RESOLVED">("ALL");
  const socketRef = useRef<Socket | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'success' } | null>(null);

  // Add box-sizing style to prevent overflow
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .driver-levels-container *,
      .driver-levels-container *::before,
      .driver-levels-container *::after {
        box-sizing: border-box;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const r = await api.get<{ messages: DriverLevelMessage[] }>("/api/admin/drivers/level-messages");
      setMessages(r.data?.messages ?? []);
    } catch (err: any) {
      // Only log non-4xx errors to avoid console spam for expected errors (e.g., missing tables, permissions)
      if (!err?.response || err.response.status >= 500) {
        console.error("Failed to load messages", err);
      } else {
        console.debug("Could not load messages (expected):", err.response?.status, err.response?.data);
      }
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page: 1, pageSize: 200 };
      if (search) params.search = search;
      if (levelFilter) params.level = levelFilter;
      
      const r = await api.get<{ drivers: DriverWithLevel[]; summary: Summary }>("/api/admin/drivers/levels", { params });
      const apiDrivers = r.data?.drivers ?? [];
      const apiSummary = r.data?.summary ?? { total: 0, silver: 0, gold: 0, diamond: 0 };
      
      setDrivers(apiDrivers);
      setSummary(apiSummary);
    } catch (err) {
      console.error("Failed to load drivers", err);
      setDrivers([]);
      setSummary({ total: 0, silver: 0, gold: 0, diamond: 0 });
    } finally {
      setLoading(false);
    }
  }, [search, levelFilter]);

  useEffect(() => {
    authify();
    if (activeTab === "drivers") {
      void loadDrivers();
    } else {
      void loadMessages();
    }

    // Setup Socket.IO for real-time driver messages
    try {
      const socketUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? window.location.origin : "http://localhost:4000");
      const socket = io(socketUrl, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
      });

      socket.on("connect", () => {
        console.log("Socket connected for admin level messages");
        // Join admin room
        socket.emit("join-admin-room");
      });

      socket.on("connect_error", (err) => {
        // Silently handle connection errors - Socket.IO will attempt reconnection
        console.debug("Socket connection error (will retry):", err.message);
      });

      // Listen for new driver messages
      socket.on("driver-level-message", (data: { driverId: number; driverName: string; message: string; timestamp: string }) => {
        // Reload messages to get the latest
        void loadMessages();
        
        // Show notification
        setNotification({
          message: `New message from ${data.driverName}`,
          type: 'info',
        });
        
        // Auto-dismiss notification after 5 seconds
        setTimeout(() => setNotification(null), 5000);
      });

      socketRef.current = socket;
    } catch (err) {
      // If Socket.IO fails to initialize, just continue without real-time updates
      console.debug("Socket.IO initialization failed, continuing without real-time updates:", err);
      socketRef.current = null;
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [activeTab, loadDrivers, loadMessages]);

  useEffect(() => {
    const id = queryDriverId ?? 0;
    if (!Number.isFinite(id) || id <= 0) return;
    if (!drivers.length) return;
    const found = drivers.find((d) => d.id === id) || null;
    if (!found) return;
    if (selectedDriver?.id === id && showDetailsModal) return;
    setSelectedDriver(found);
    setShowDetailsModal(true);
  }, [queryDriverId, drivers, selectedDriver, showDetailsModal]);

  const closeDetailsModal = useCallback(() => {
    setShowDetailsModal(false);
    setSelectedDriver(null);

    // If the modal was opened via deep-link (?driverId=...), remove it so it doesn't instantly reopen.
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (params.has("driverId")) {
      params.delete("driverId");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!showDetailsModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetailsModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDetailsModal, showDetailsModal]);

  async function sendResponse(messageId: number) {
    if (!responseText.trim() || !selectedMessage) return;

    setSending(true);
    try {
      const r = await api.post(`/api/admin/drivers/level-messages/${messageId}/respond`, {
        message: responseText.trim(),
      });

      if (r.status === 200) {
        setResponseText("");
        await loadMessages();
        setSelectedMessage(null);
      }
    } catch (err) {
      console.error("Failed to send response", err);
      alert("Failed to send response. Please try again.");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void loadDrivers();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [loadDrivers]);

  const getLevelColor = (level: number) => {
    switch (level) {
      case 3:
        return { bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-300", badge: "bg-purple-600" };
      case 2:
        return { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-300", badge: "bg-amber-500" };
      case 1:
        return { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300", badge: "bg-slate-500" };
      default:
        return { bg: "bg-gray-100", text: "text-gray-700", border: "border-gray-300", badge: "bg-gray-500" };
    }
  };

  const getLevelIcon = (level: number) => {
    switch (level) {
      case 3:
        return <Award className="h-5 w-5 text-purple-600" />;
      case 2:
        return <Trophy className="h-5 w-5 text-amber-600" />;
      case 1:
        return <Star className="h-5 w-5 text-slate-600" />;
      default:
        return <Trophy className="h-5 w-5 text-gray-600" />;
    }
  };

  const viewDriverDetails = (driver: DriverWithLevel) => {
    setSelectedDriver(driver);
    setShowDetailsModal(true);
  };

  const overallProgress = (driver: DriverWithLevel) => {
    if (driver.currentLevel === 3) return 100;
    return Math.round(
      (driver.progress.earnings +
        driver.progress.trips +
        driver.progress.rating +
        driver.progress.reviews +
        driver.progress.goals) /
        5
    );
  };

  // Filter drivers based on levelFilter
  const filteredDrivers = useMemo(() => {
    if (!levelFilter) {
      return drivers; // Show all when "All" is selected
    }
    return drivers.filter((driver) => driver.currentLevel === Number(levelFilter));
  }, [drivers, levelFilter]);

  const sortedDrivers = useMemo(() => {
    const next = [...filteredDrivers];
    const readValue = (driver: DriverWithLevel): string | number => {
      switch (sortBy) {
        case "driver":
          return `${driver.name || ""} ${driver.email || ""}`.toLowerCase();
        case "vehicle":
          return `${driver.vehicleType || ""} ${driver.plateNumber || ""}`.toLowerCase();
        case "level":
          return driver.currentLevel;
        case "progress":
          return overallProgress(driver);
        case "metrics":
          return (driver.paidEarnings || driver.totalEarnings || 0) + ((driver.totalTrips || 0) * 1000) + ((driver.paidTrips || 0) * 5000);
        case "rating":
          return driver.averageRating || 0;
        default:
          return "";
      }
    };

    next.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return next;
  }, [filteredDrivers, sortBy, sortDir]);

  const tableTotal = sortedDrivers.length;
  const tableTotalPages = Math.max(1, Math.ceil(tableTotal / tablePageSize));
  const safeTablePage = Math.min(tablePage, tableTotalPages);
  const tableStartIndex = (safeTablePage - 1) * tablePageSize;
  const pagedDrivers = sortedDrivers.slice(tableStartIndex, tableStartIndex + tablePageSize);

  function handleSort(field: DriverTableSortKey) {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "level" || field === "progress" || field === "metrics" || field === "rating" ? "desc" : "asc");
  }

  function renderSortIcon(field: DriverTableSortKey) {
    if (sortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-emerald-600" />
      : <ChevronDown className="h-3.5 w-3.5 text-emerald-600" />;
  }

  useEffect(() => {
    setTablePage(1);
  }, [search, levelFilter, sortBy, sortDir]);

  // Calculate message counts
  const messageCounts = useMemo(() => {
    return {
      pending: messages.filter((msg) => msg.status === "PENDING").length,
      responded: messages.filter((msg) => msg.status === "RESPONDED").length,
      resolved: messages.filter((msg) => msg.status === "RESOLVED").length,
      total: messages.length,
    };
  }, [messages]);

  // Prepare chart data
  const levelDistributionData = [
    { name: "Silver", value: summary.silver, color: "#64748b" },
    { name: "Gold", value: summary.gold, color: "#f59e0b" },
    { name: "Diamond", value: summary.diamond, color: "#9333ea" },
  ];

  const averageMetricsByLevel = () => {
    const levelGroups = {
      silver: drivers.filter((d) => d.currentLevel === 1),
      gold: drivers.filter((d) => d.currentLevel === 2),
      diamond: drivers.filter((d) => d.currentLevel === 3),
    };

    const calculateAverage = (group: DriverWithLevel[], key: keyof DriverWithLevel) => {
      if (group.length === 0) return 0;
      const sum = group.reduce((acc, d) => acc + (typeof d[key] === 'number' ? d[key] : 0), 0);
      return Math.round(sum / group.length);
    };

    return [
      {
        level: "Silver",
        earnings: calculateAverage(levelGroups.silver, 'totalEarnings'),
        trips: calculateAverage(levelGroups.silver, 'totalTrips'),
        rating: levelGroups.silver.length > 0 
          ? parseFloat((levelGroups.silver.reduce((acc, d) => acc + d.averageRating, 0) / levelGroups.silver.length).toFixed(1))
          : 0,
        reviews: calculateAverage(levelGroups.silver, 'totalReviews'),
      },
      {
        level: "Gold",
        earnings: calculateAverage(levelGroups.gold, 'totalEarnings'),
        trips: calculateAverage(levelGroups.gold, 'totalTrips'),
        rating: levelGroups.gold.length > 0 
          ? parseFloat((levelGroups.gold.reduce((acc, d) => acc + d.averageRating, 0) / levelGroups.gold.length).toFixed(1))
          : 0,
        reviews: calculateAverage(levelGroups.gold, 'totalReviews'),
      },
      {
        level: "Diamond",
        earnings: calculateAverage(levelGroups.diamond, 'totalEarnings'),
        trips: calculateAverage(levelGroups.diamond, 'totalTrips'),
        rating: levelGroups.diamond.length > 0 
          ? parseFloat((levelGroups.diamond.reduce((acc, d) => acc + d.averageRating, 0) / levelGroups.diamond.length).toFixed(1))
          : 0,
        reviews: calculateAverage(levelGroups.diamond, 'totalReviews'),
      },
    ];
  };

  const metricsComparisonData = averageMetricsByLevel();


  return (
    <div className="driver-levels-container w-full space-y-6 overflow-x-hidden" style={{ boxSizing: 'border-box', maxWidth: '100%' }}>
      {/* Notification Banner */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in ${
          notification.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'
        }`}>
          <Bell className="h-5 w-5" />
          <span>{notification.message}</span>
          <button onClick={() => setNotification(null)} className="ml-2 hover:opacity-75">
            ×
          </button>
        </div>
      )}

      {/* Premium Banner */}
      <div style={{ position: "relative", borderRadius: "1.25rem", overflow: "hidden", background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)", padding: "2rem 2rem 1.75rem" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.13, pointerEvents: "none" }} viewBox="0 0 900 160" preserveAspectRatio="xMidYMid slice">
          <circle cx="820" cy="30" r="90" fill="none" stroke="white" strokeWidth="1.2" />
          <circle cx="820" cy="30" r="55" fill="none" stroke="white" strokeWidth="0.7" />
          <circle cx="60" cy="140" r="70" fill="none" stroke="white" strokeWidth="1.0" />
          <line x1="0" y1="40" x2="900" y2="40" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="72" x2="900" y2="72" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="104" x2="900" y2="104" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="136" x2="900" y2="136" stroke="white" strokeWidth="0.4" />
          <polyline points="0,130 90,112 180,96 270,80 360,65 450,88 540,52 630,68 720,36 810,50 900,32" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,130 90,112 180,96 270,80 360,65 450,88 540,52 630,68 720,36 810,50 900,32 900,160 0,160" fill="white" opacity={0.06} />
          <polyline points="0,145 90,133 180,119 270,130 360,112 450,125 540,100 630,115 720,92 810,105 900,82" fill="none" stroke="white" strokeWidth="1.2" strokeDasharray="6 4" opacity={0.5} />
          <circle cx="540" cy="52" r="5" fill="white" opacity={0.75} />
          <circle cx="720" cy="36" r="5" fill="white" opacity={0.75} />
          <circle cx="900" cy="32" r="5" fill="white" opacity={0.75} />
          <defs><radialGradient id="lvlBannerGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="white" stopOpacity="0.12" /><stop offset="100%" stopColor="white" stopOpacity="0" /></radialGradient></defs>
          <ellipse cx="450" cy="90" rx="200" ry="70" fill="url(#lvlBannerGlow)" />
        </svg>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Trophy style={{ width: 22, height: 22, color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.01em" }}>Driver Levels</h1>
            <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>Connected to paid payouts, accomplished trips, ratings &amp; NoLSAF revenue</p>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(255,255,255,0.70)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Total</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "white", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{summary.total}</div>
          </div>
          <div style={{ background: "rgba(100,116,139,0.22)", border: "1px solid rgba(148,163,184,0.40)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(203,213,225,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Silver</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#cbd5e1", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{summary.silver}</div>
          </div>
          <div style={{ background: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(252,211,77,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Gold</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#fcd34d", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{summary.gold}</div>
          </div>
          <div style={{ background: "rgba(147,51,234,0.18)", border: "1px solid rgba(196,181,253,0.40)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(216,180,254,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Diamond</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#c4b5fd", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{summary.diamond}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "0.85rem 1.25rem" }}>
        <div className="flex flex-wrap gap-2 justify-center">
          <div
            onClick={() => setActiveTab("drivers")}
            className="px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer"
            style={activeTab === "drivers" ? { background: "linear-gradient(135deg,#059669,#047857)", color: "white", boxShadow: "0 4px 14px rgba(5,150,105,0.40)" } : { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.70)" }}
          >
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              <span>Drivers</span>
            </div>
          </div>
          <div
            onClick={() => setActiveTab("messages")}
            className="px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer"
            style={activeTab === "messages" ? { background: "linear-gradient(135deg,#059669,#047857)", color: "white", boxShadow: "0 4px 14px rgba(5,150,105,0.40)" } : { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.70)" }}
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span>Messages</span>
              {messageCounts.total > 0 && (
                <span style={{ background: activeTab === "messages" ? "rgba(255,255,255,0.20)" : "rgba(16,185,129,0.25)", color: activeTab === "messages" ? "white" : "#6ee7b7", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "9999px", padding: "0 6px", fontSize: "0.7rem", fontWeight: 700 }}>
                  {messageCounts.total}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Drivers Tab Content */}
      {activeTab === "drivers" && (
        <>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => setLevelFilter("")}
          className="cursor-pointer transition-all hover:scale-[1.02]"
          style={{ borderRadius: "1rem", border: levelFilter === "" ? "1px solid rgba(16,185,129,0.50)" : "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1rem 1.25rem" }}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>Total Drivers</p>
              <p style={{ fontSize: "1.35rem", fontWeight: 800, color: "white" }}>{summary.total}</p>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.30)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Truck className="h-5 w-5" style={{ color: "#6ee7b7" }} />
            </div>
          </div>
        </div>
        <div
          onClick={() => setLevelFilter("1")}
          className="cursor-pointer transition-all hover:scale-[1.02]"
          style={{ borderRadius: "1rem", border: levelFilter === "1" ? "1px solid rgba(148,163,184,0.55)" : "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1rem 1.25rem" }}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>Silver Level</p>
              <p style={{ fontSize: "1.35rem", fontWeight: 800, color: "#cbd5e1" }}>{summary.silver}</p>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(100,116,139,0.20)", border: "1px solid rgba(148,163,184,0.30)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Star className="h-5 w-5" style={{ color: "#cbd5e1" }} />
            </div>
          </div>
        </div>
        <div
          onClick={() => setLevelFilter("2")}
          className="cursor-pointer transition-all hover:scale-[1.02]"
          style={{ borderRadius: "1rem", border: levelFilter === "2" ? "1px solid rgba(245,158,11,0.55)" : "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1rem 1.25rem" }}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>Gold Level</p>
              <p style={{ fontSize: "1.35rem", fontWeight: 800, color: "#fcd34d" }}>{summary.gold}</p>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.30)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Trophy className="h-5 w-5" style={{ color: "#fcd34d" }} />
            </div>
          </div>
        </div>
        <div
          onClick={() => setLevelFilter("3")}
          className="cursor-pointer transition-all hover:scale-[1.02]"
          style={{ borderRadius: "1rem", border: levelFilter === "3" ? "1px solid rgba(196,181,253,0.55)" : "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1rem 1.25rem" }}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>Diamond Level</p>
              <p style={{ fontSize: "1.35rem", fontWeight: 800, color: "#c4b5fd" }}>{summary.diamond}</p>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(147,51,234,0.18)", border: "1px solid rgba(196,181,253,0.30)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Award className="h-5 w-5" style={{ color: "#c4b5fd" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Statistical Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Level Distribution Pie Chart */}
        <div className="bg-white rounded-xl p-4 md:p-6 border-2 border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <PieChartIcon className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-gray-900">Level Distribution</h2>
          </div>
          {summary.total > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={levelDistributionData.filter((d) => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {levelDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">
              <p>No data available</p>
            </div>
          )}
        </div>

        {/* Average Metrics Comparison Bar Chart */}
        <div className="bg-white rounded-xl p-4 md:p-6 border-2 border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-gray-900">Average Metrics by Level</h2>
          </div>
          {drivers.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={metricsComparisonData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="level" />
                <YAxis />
                <Tooltip 
                  formatter={(value: any, name: string) => {
                    if (name === 'Paid Earnings (TZS)') {
                      return [`${(value / 1000).toFixed(0)}K TZS`, name];
                    }
                    return [value, name];
                  }}
                />
                <Legend />
                <Bar dataKey="earnings" fill="#10b981" name="Paid Earnings (TZS)" />
                <Bar dataKey="trips" fill="#3b82f6" name="Trips" />
                <Bar dataKey="reviews" fill="#8b5cf6" name="Reviews" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">
              <p>No data available</p>
            </div>
          )}
        </div>
      </div>

      {/* Rating Comparison Chart */}
      {drivers.length > 0 && (
        <div className="bg-white rounded-xl p-4 md:p-6 border-2 border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-gray-900">Rating Comparison by Level</h2>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metricsComparisonData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="level" />
              <YAxis domain={[0, 5]} />
              <Tooltip />
              <Bar dataKey="rating" fill="#f59e0b" name="Average Rating" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 border-2 border-slate-200 shadow-sm w-full" style={{ maxWidth: '100%', overflow: 'hidden' }}>
        <div className="flex flex-col gap-4 w-full" style={{ maxWidth: '100%' }}>
          {/* Search Bar - Properly Contained */}
          <div className="w-full relative" style={{ maxWidth: '100%' }}>
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none z-10" />
                <input
                  type="text"
                  placeholder="Search drivers..."
                  value={search}
                  onChange={(e) => {
                    setTablePage(1);
                    setSearch(e.target.value);
                  }}
              className="w-full pl-10 pr-4 py-2.5 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm"
              style={{ boxSizing: 'border-box', maxWidth: '100%', width: '100%' }}
                />
              </div>
          {/* Level Filter Buttons - Responsive */}
          <div className="flex flex-wrap gap-2 w-full">
            <button
              onClick={() => {
                setTablePage(1);
                setLevelFilter("");
              }}
              className={`px-3 md:px-4 py-2 rounded-lg border-2 transition-all text-xs md:text-sm font-medium whitespace-nowrap ${
                levelFilter === ""
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white text-gray-700 border-slate-300 hover:border-emerald-300"
              }`}
            >
              All
            </button>
            <button
              onClick={() => {
                setTablePage(1);
                setLevelFilter("1");
              }}
              className={`px-3 md:px-4 py-2 rounded-lg border-2 transition-all text-xs md:text-sm font-medium whitespace-nowrap ${
                levelFilter === "1"
                  ? "bg-slate-600 text-white border-slate-600"
                  : "bg-white text-gray-700 border-slate-300 hover:border-slate-300"
              }`}
            >
              Silver
            </button>
            <button
              onClick={() => {
                setTablePage(1);
                setLevelFilter("2");
              }}
              className={`px-3 md:px-4 py-2 rounded-lg border-2 transition-all text-xs md:text-sm font-medium whitespace-nowrap ${
                levelFilter === "2"
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-white text-gray-700 border-slate-300 hover:border-amber-300"
              }`}
            >
              Gold
            </button>
            <button
              onClick={() => {
                setTablePage(1);
                setLevelFilter("3");
              }}
              className={`px-3 md:px-4 py-2 rounded-lg border-2 transition-all text-xs md:text-sm font-medium whitespace-nowrap ${
                levelFilter === "3"
                  ? "bg-purple-600 text-white border-purple-600"
                  : "bg-white text-gray-700 border-slate-300 hover:border-purple-300"
              }`}
            >
              Diamond
            </button>
          </div>
        </div>
      </div>

      {/* Drivers Table */}
      <div className="bg-white rounded-xl border-2 border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
            <p className="mt-4 text-gray-500">Loading drivers...</p>
          </div>
        ) : filteredDrivers.length === 0 ? (
          <div className="p-12 text-center">
            <Trophy className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No drivers found{levelFilter ? ` for ${levelFilter === "1" ? "Silver" : levelFilter === "2" ? "Gold" : "Diamond"} level` : ""}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
              <thead className="bg-slate-50 border-b-2 border-slate-200">
                <tr>
                  <th className="px-4 md:px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase whitespace-nowrap">
                    <button type="button" onClick={() => handleSort("driver")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                      Driver {renderSortIcon("driver")}
                    </button>
                  </th>
                  <th className="px-4 md:px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase whitespace-nowrap">
                    <button type="button" onClick={() => handleSort("vehicle")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                      Vehicle {renderSortIcon("vehicle")}
                    </button>
                  </th>
                  <th className="px-4 md:px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase whitespace-nowrap">
                    <button type="button" onClick={() => handleSort("level")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                      Level {renderSortIcon("level")}
                    </button>
                  </th>
                  <th className="px-4 md:px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase whitespace-nowrap">
                    <button type="button" onClick={() => handleSort("progress")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                      Progress {renderSortIcon("progress")}
                    </button>
                  </th>
                  <th className="px-4 md:px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase whitespace-nowrap">
                    <button type="button" onClick={() => handleSort("metrics")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                      Metrics {renderSortIcon("metrics")}
                    </button>
                  </th>
                  <th className="px-4 md:px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase whitespace-nowrap">
                    <button type="button" onClick={() => handleSort("rating")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-slate-900">
                      Rating {renderSortIcon("rating")}
                    </button>
                  </th>
                  <th className="px-4 md:px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pagedDrivers.map((driver) => {
                  const colors = getLevelColor(driver.currentLevel);
                  return (
                    <tr key={driver.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 md:px-6 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Truck className="h-5 w-5 text-emerald-600" />
                    </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 truncate">{driver.name}</p>
                            <p className="text-xs text-gray-500 truncate">{driver.email}</p>
                            {driver.phone && <p className="text-xs text-gray-400 truncate">{driver.phone}</p>}
                    </div>
                  </div>
                      </td>
                      <td className="px-4 md:px-6 py-4">
                        <div className="space-y-1 min-w-[120px]">
                          <div className="flex items-center gap-2">
                            {driver.vehicleType === "Car" && <Car className="h-4 w-4 text-blue-600 flex-shrink-0" />}
                            {driver.vehicleType === "MotorCycle" && <Bike className="h-4 w-4 text-orange-600 flex-shrink-0" />}
                            {driver.vehicleType === "Tuktuk" && <CarTaxiFront className="h-4 w-4 text-green-600 flex-shrink-0" />}
                            <span className="text-xs font-medium text-gray-700 truncate">
                              {driver.vehicleType}
                            </span>
                </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 truncate font-mono">
                              {driver.plateNumber}
                            </span>
            </div>
          </div>
                      </td>
                      <td className="px-4 md:px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-shrink-0">{getLevelIcon(driver.currentLevel)}</div>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white whitespace-nowrap ${colors.badge}`}>
                            {driver.levelName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 md:px-6 py-4">
                        <div className="w-24 md:w-32 min-w-[96px]">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-600">Overall</span>
                            <span className="text-xs font-semibold text-emerald-600">{overallProgress(driver)}%</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-2">
                            <div
                              className="bg-emerald-600 h-2 rounded-full transition-all"
                              style={{ width: `${overallProgress(driver)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 md:px-6 py-4">
                        <div className="space-y-1 text-xs min-w-[120px]">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-3 w-3 text-gray-400 flex-shrink-0" />
                            <span className="text-gray-600 truncate">{formatMoney(driver.paidEarnings || driver.totalEarnings)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Users className="h-3 w-3 text-gray-400 flex-shrink-0" />
                            <span className="text-gray-600 truncate">{driver.totalTrips} accomplished</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-3 w-3 text-gray-400 flex-shrink-0" />
                            <span className="text-gray-600 truncate">{driver.paidTrips} paid payouts</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 md:px-6 py-4">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400 flex-shrink-0" />
                          <span className="font-semibold text-gray-900">{driver.averageRating.toFixed(1)}</span>
                          <span className="text-xs text-gray-500">({driver.totalReviews})</span>
                        </div>
                      </td>
                      <td className="px-4 md:px-6 py-4">
                        <button
                          onClick={() => viewDriverDetails(driver)}
                          className="flex items-center justify-center p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                Showing {tableTotal === 0 ? 0 : tableStartIndex + 1}-{Math.min(tableStartIndex + tablePageSize, tableTotal)} of {tableTotal}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                  disabled={safeTablePage <= 1}
                  className="px-3 py-1 text-sm border border-slate-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-slate-600">Page {safeTablePage} of {tableTotalPages}</span>
                <button
                  type="button"
                  onClick={() => setTablePage((p) => Math.min(tableTotalPages, p + 1))}
                  disabled={safeTablePage >= tableTotalPages}
                  className="px-3 py-1 text-sm border border-slate-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
        </div>

      {/* Driver Details Modal */}
      {showDetailsModal && selectedDriver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDetailsModal();
          }}
        >
          <div className="bg-white rounded-xl p-4 md:p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto border-2 border-slate-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                {getLevelIcon(selectedDriver.currentLevel)}
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{selectedDriver.name}</h2>
                  <p className="text-sm text-gray-500">{selectedDriver.email}</p>
                </div>
              </div>
              <button
                onClick={closeDetailsModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
              </div>

            {/* Level Badge */}
            <div className={`mb-6 p-6 rounded-lg border-2 ${getLevelColor(selectedDriver.currentLevel).bg} ${getLevelColor(selectedDriver.currentLevel).border}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Current Level</p>
                    <div className="flex items-center gap-3">
                    <span className={`px-4 py-2 rounded-lg text-white font-bold text-xl ${getLevelColor(selectedDriver.currentLevel).badge}`}>
                      {selectedDriver.levelName}
                    </span>
                    {selectedDriver.currentLevel < 3 && (
                        <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-gray-600" />
                        <span className="text-sm text-gray-700">
                          Next: {selectedDriver.currentLevel === 1 ? "Gold" : "Diamond"}
                        </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                  <p className="text-sm text-gray-600 mb-1">Overall Progress</p>
                  <p className="text-2xl font-bold text-gray-900">{overallProgress(selectedDriver)}%</p>
                  </div>
                </div>
              </div>

            {/* Progress Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 w-full">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                  <h3 className="font-semibold text-gray-900">Paid Earnings</h3>
                  </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-gray-900">{formatMoney(selectedDriver.paidEarnings || selectedDriver.totalEarnings)}</span>
                  <span className="text-sm text-gray-500">{selectedDriver.progress.earnings}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-emerald-600 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(selectedDriver.progress.earnings, 100)}%` }}
                    />
                  </div>
                </div>

              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-5 w-5 text-blue-600" />
                  <h3 className="font-semibold text-gray-900">Accomplished Trips</h3>
                  </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-gray-900">{selectedDriver.totalTrips}</span>
                  <span className="text-sm text-gray-500">{selectedDriver.progress.trips}%</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(selectedDriver.progress.trips, 100)}%` }}
                    />
                  </div>
                </div>

              <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                <div className="flex items-center gap-2 mb-3">
                  <Star className="h-5 w-5 text-amber-600" />
                  <h3 className="font-semibold text-gray-900">Average Rating</h3>
                  </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-gray-900">{selectedDriver.averageRating.toFixed(1)}</span>
                  <span className="text-sm text-gray-500">{selectedDriver.progress.rating}%</span>
                </div>
                <div className="w-full bg-amber-200 rounded-full h-2">
                  <div
                    className="bg-amber-600 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(selectedDriver.progress.rating, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">{selectedDriver.totalReviews} reviews</p>
              </div>

              <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="h-5 w-5 text-purple-600" />
                  <h3 className="font-semibold text-gray-900">Connected Achievements</h3>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-gray-900">{selectedDriver.goalsCompleted}</span>
                  <span className="text-sm text-gray-500">{selectedDriver.progress.goals}%</span>
                </div>
                <div className="w-full bg-purple-200 rounded-full h-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(selectedDriver.progress.goals, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700 mb-2">Gross</p>
                <p className="text-lg font-bold text-gray-950">{formatMoney(selectedDriver.grossRevenue)}</p>
              </div>
              <div className="p-4 rounded-lg border border-orange-200 bg-orange-50">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-orange-700 mb-2">NoLSAF</p>
                <p className="text-lg font-bold text-orange-700">{formatMoney(selectedDriver.nolsafRevenue)}</p>
              </div>
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 mb-2">Payouts</p>
                <p className="text-lg font-bold text-gray-950">{selectedDriver.paidTrips} paid / {selectedDriver.invoiceCount} total</p>
              </div>
              <div className="p-4 rounded-lg border border-blue-200 bg-blue-50">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700 mb-2">Last Paid</p>
                <p className="text-sm font-semibold text-gray-950 leading-snug">{formatDateTime(selectedDriver.lastPaidAt)}</p>
              </div>
            </div>

            {/* Level Benefits */}
            <div className={`p-6 rounded-lg border-2 ${getLevelColor(selectedDriver.currentLevel).bg} ${getLevelColor(selectedDriver.currentLevel).border}`}>
              <div className="flex items-center gap-2 mb-4">
                <Award className={`h-6 w-6 ${getLevelColor(selectedDriver.currentLevel).text}`} />
                <h3 className={`text-xl font-semibold ${getLevelColor(selectedDriver.currentLevel).text}`}>
                  {selectedDriver.levelName} Level Benefits
                </h3>
              </div>
              <ul className="space-y-2">
                {selectedDriver.levelBenefits.map((benefit, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                    <CheckCircle className={`h-5 w-5 mt-0.5 flex-shrink-0 ${getLevelColor(selectedDriver.currentLevel).text}`} />
                    <span className={`text-sm ${getLevelColor(selectedDriver.currentLevel).text}`}>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Messages Tab Content */}
      {activeTab === "messages" && (
        <div className="space-y-6">
          {/* Messages Filters */}
          <div className="bg-white rounded-xl p-4 border-2 border-slate-200 shadow-sm">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by driver name, email, or message..."
                  value={messageSearch}
                  onChange={(e) => setMessageSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setStatusFilter("ALL")}
                  className={`px-4 py-2 rounded-lg border-2 transition-all text-sm shadow-sm ${
                    statusFilter === "ALL"
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-gray-700 border-slate-300 hover:border-emerald-300"
                  }`}
                >
                  All
                  {messageCounts.total > 0 && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                      statusFilter === "ALL"
                        ? "bg-white/20 text-white"
                        : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {messageCounts.total}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setStatusFilter("PENDING")}
                  className={`px-4 py-2 rounded-lg border-2 transition-all text-sm shadow-sm ${
                    statusFilter === "PENDING"
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-white text-gray-700 border-slate-300 hover:border-amber-300"
                  }`}
                >
                  Pending
                  {messageCounts.pending > 0 && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                      statusFilter === "PENDING"
                        ? "bg-white/20 text-white"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {messageCounts.pending}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setStatusFilter("RESPONDED")}
                  className={`px-4 py-2 rounded-lg border-2 transition-all text-sm shadow-sm ${
                    statusFilter === "RESPONDED"
                      ? "bg-blue-500 text-white border-blue-500"
                      : "bg-white text-gray-700 border-slate-300 hover:border-blue-300"
                  }`}
                >
                  Responded
                  {messageCounts.responded > 0 && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                      statusFilter === "RESPONDED"
                        ? "bg-white/20 text-white"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {messageCounts.responded}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setStatusFilter("RESOLVED")}
                  className={`px-4 py-2 rounded-lg border-2 transition-all text-sm shadow-sm ${
                    statusFilter === "RESOLVED"
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-white text-gray-700 border-slate-300 hover:border-emerald-300"
                  }`}
                >
                  Resolved
                  {messageCounts.resolved > 0 && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                      statusFilter === "RESOLVED"
                        ? "bg-white/20 text-white"
                        : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {messageCounts.resolved}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Messages List */}
          {messagesLoading ? (
            <div className="bg-white rounded-xl p-12 border-2 border-slate-200 shadow-sm text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
              <p className="mt-4 text-gray-500">Loading messages...</p>
            </div>
          ) : (() => {
            const filteredMessages = messages.filter((msg) => {
              const matchesSearch =
                !messageSearch ||
                msg.driverName.toLowerCase().includes(messageSearch.toLowerCase()) ||
                msg.driverEmail.toLowerCase().includes(messageSearch.toLowerCase()) ||
                msg.message.toLowerCase().includes(messageSearch.toLowerCase());
              const matchesStatus = statusFilter === "ALL" || msg.status === statusFilter;
              return matchesSearch && matchesStatus;
            });

            const getStatusBadge = (status: string) => {
              switch (status) {
                case "PENDING":
                  return (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 border border-amber-300">
                      Pending
                    </span>
                  );
                case "RESPONDED":
                  return (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 border border-blue-300">
                      Responded
                    </span>
                  );
                case "RESOLVED":
                  return (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300">
                      Resolved
                    </span>
                  );
                default:
                  return null;
              }
            };

            return filteredMessages.length === 0 ? (
              <div className="bg-white rounded-xl p-12 border-2 border-slate-200 shadow-sm text-center">
                <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No messages found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Messages List */}
                <div className="space-y-4">
                  {filteredMessages.map((msg) => (
                    <div
                      key={msg.id}
                      onClick={() => setSelectedMessage(msg)}
                      className={`bg-white rounded-xl p-4 border-2 shadow-sm cursor-pointer transition-all hover:shadow-lg ${
                        selectedMessage?.id === msg.id
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 hover:border-emerald-300"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                            <Users className="h-5 w-5 text-emerald-600" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{msg.driverName}</p>
                            <p className="text-xs text-gray-500">{msg.driverEmail}</p>
                          </div>
                        </div>
                        {getStatusBadge(msg.status)}
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-2 mb-2">{msg.message}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(msg.createdAt).toLocaleString()}</span>
                        {msg.responses && msg.responses.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{msg.responses.length} response(s)</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  </div>

                {/* Message Detail & Response */}
                <div className="bg-white rounded-xl p-6 border-2 border-slate-200 shadow-sm">
                  {selectedMessage ? (
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h2 className="text-lg font-semibold text-gray-900">Message Details</h2>
                          {getStatusBadge(selectedMessage.status)}
                        </div>
                        <div className="bg-slate-50 rounded-lg p-4 mb-4">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                              <Users className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900">{selectedMessage.driverName}</p>
                              <p className="text-xs text-gray-500">{selectedMessage.driverEmail}</p>
                              {selectedMessage.driverPhone && (
                                <p className="text-xs text-gray-500">{selectedMessage.driverPhone}</p>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedMessage.message}</p>
                          <p className="text-xs text-gray-500 mt-2">
                            {new Date(selectedMessage.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>

                      {/* Previous Responses */}
                      {selectedMessage.responses && selectedMessage.responses.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900 mb-3">Previous Responses</h3>
                          <div className="space-y-3">
                            {selectedMessage.responses.map((response) => (
                              <div key={response.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-blue-900">{response.adminName}</span>
                                  <span className="text-xs text-blue-700">
                                    {new Date(response.createdAt).toLocaleString()}
                                  </span>
                                </div>
                                <p className="text-sm text-blue-900 whitespace-pre-wrap">{response.message}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Response Form */}
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">Send Response</h3>
                        <textarea
                          value={responseText}
                          onChange={(e) => setResponseText(e.target.value)}
                          placeholder="Type your response here..."
                          rows={4}
                          className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500 resize-none"
                        />
                        <div className="flex gap-3 mt-3">
                          <button
                            onClick={() => sendResponse(selectedMessage.id)}
                            disabled={!responseText.trim() || sending}
                            className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            <Send className="h-4 w-4" />
                            {sending ? "Sending..." : "Send Response"}
                          </button>
                          {selectedMessage.status === "PENDING" && (
                            <button
                              onClick={async () => {
                                try {
                                  await api.post(`/api/admin/drivers/level-messages/${selectedMessage.id}/resolve`);
                                  await loadMessages();
                                  setSelectedMessage(null);
                                } catch (err) {
                                  console.error("Failed to mark as resolved", err);
                                }
                              }}
                              className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-all flex items-center gap-2"
                            >
                              <CheckCircle className="h-4 w-4" />
                              Mark Resolved
                            </button>
                          )}
                        </div>
              </div>
            </div>
          ) : (
                    <div className="text-center py-12 text-gray-500">
                      <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                      <p>Select a message to view details and respond</p>
            </div>
          )}
        </div>
      </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
