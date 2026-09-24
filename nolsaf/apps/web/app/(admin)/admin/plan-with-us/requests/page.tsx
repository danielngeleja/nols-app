"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X, Calendar, MapPin, Clock, User, BarChart3, TrendingUp, Loader2, FileText, AlertTriangle, Edit, Send, Eye, MessageSquare, ChevronDown, Star } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import axios from "axios";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = axios.create({ baseURL: "", withCredentials: true });
function authify() {
  if (typeof window === "undefined") return;

  const lsToken =
    window.localStorage.getItem("token") ||
    window.localStorage.getItem("nolsaf_token") ||
    window.localStorage.getItem("__Host-nolsaf_token");

  if (lsToken) {
    api.defaults.headers.common["Authorization"] = `Bearer ${lsToken}`;
    return;
  }

  const m = String(document.cookie || "").match(/(?:^|;\s*)(?:nolsaf_token|__Host-nolsaf_token)=([^;]+)/);
  const cookieToken = m?.[1] ? decodeURIComponent(m[1]) : "";
  if (cookieToken) {
    api.defaults.headers.common["Authorization"] = `Bearer ${cookieToken}`;
  }
}

type ConversationMessage = {
  type: string;
  message: string;
  timestamp: Date;
  formattedDate: string;
  sender: 'user' | 'admin';
};

function ConversationHistoryDisplay({ requestId }: { requestId: number }) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const loadMessages = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/api/admin/plan-with-us/requests/${requestId}/messages`);
        if (response.data.success && response.data.messages) {
          const formattedMessages: ConversationMessage[] = response.data.messages.map((m: any) => ({
            type: m.messageType || (m.senderRole === 'ADMIN' ? 'Admin Response' : 'General'),
            message: m.message,
            timestamp: new Date(m.createdAt),
            formattedDate: new Date(m.createdAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
            sender: m.senderRole === 'ADMIN' ? 'admin' : 'user',
          }));
          setMessages(formattedMessages);
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
        setMessages([]);
      } finally {
        setLoading(false);
      }
    };
    
    if (requestId) {
      loadMessages();
    }
  }, [requestId]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      </div>
    );
  }
  
  if (messages.length === 0) return null;
  
  return (
    <div className="space-y-3 max-h-[300px] overflow-y-auto">
      {messages.map((msg, index) => (
        <div
          key={index}
          className={`flex ${msg.sender === 'user' ? 'justify-start' : 'justify-end'}`}
        >
          <div className={`flex flex-col ${msg.sender === 'user' ? 'items-start max-w-[80%] sm:max-w-[70%]' : 'items-end max-w-[80%] sm:max-w-[70%]'}`}>
            <div className={`flex items-center gap-2 mb-1.5 ${msg.sender === 'user' ? '' : 'flex-row-reverse'}`}>
              {msg.sender === 'user' && (
                <span className="text-[10px] font-medium text-[#02665e] px-2 py-0.5 rounded-md bg-[#02665e]/10">
                  {msg.type}
                </span>
              )}
              {msg.sender === 'admin' && (
                <span className="text-[10px] font-medium text-blue-700 px-2 py-0.5 rounded-md bg-blue-100">
                  Admin
                </span>
              )}
              <span className="text-[10px] text-slate-400">{msg.formattedDate}</span>
            </div>
            <div
              className={`rounded-xl px-3 py-2 shadow-sm ${
                msg.sender === 'user'
                  ? 'bg-[#02665e] text-white rounded-tl-sm'
                  : 'bg-blue-50 border border-blue-100 text-slate-800 rounded-tr-sm'
              }`}
            >
              <p className={`text-xs sm:text-sm whitespace-pre-wrap leading-relaxed ${msg.sender === 'user' ? 'text-white' : 'text-slate-700'}`}>
                {msg.message}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type PlanRequestRow = {
  id: number;
  role: string;
  tripType: string;
  destinations: string;
  dateFrom: string | null;
  dateTo: string | null;
  groupSize: number | null;
  budget: string | null;
  notes: string;
  status: string;
  isUrgent: boolean;
  hoursSinceCreation: number;
  customer: {
    name: string;
    email: string;
    phone: string | null;
  };
  transportRequired: boolean;
  adminResponse?: string | null;
  suggestedItineraries?: string | null;
  requiredPermits?: string | null;
  estimatedTimeline?: string | null;
  assignedAgentId?: number | null;
  assignedAgent?: string | null;
  respondedAt?: string | null;
  createdAt: string;
};

type PlanRequestStats = {
  trends: { date: string; count: number; pending: number; inProgress: number; completed: number }[];
  roleBreakdown: Record<string, number>;
  tripTypeBreakdown: Record<string, number>;
  period: string;
  startDate: string;
  endDate: string;
};

export default function AdminPlanWithUsRequestsPage() {
  const searchParams = useSearchParams();
  
  // Initialize state from URL params if present
  const [role, setRole] = useState<string>("");
  const [tripType, setTripType] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [date, setDate] = useState<string | string[]>("");
  const [q, setQ] = useState("");

  // Initialize from URL params on mount - clear filters if no params in URL
  useEffect(() => {
    if (searchParams) {
      const urlRole = searchParams.get("role");
      const urlTripType = searchParams.get("tripType");
      const urlStatus = searchParams.get("status");
      const urlDate = searchParams.get("date");
      const urlQ = searchParams.get("q");
      
      // Set or clear filters based on URL params
      setRole(urlRole || "");
      setTripType(urlTripType || "");
      setStatus(urlStatus || "");
      setDate(urlDate || "");
      setQ(urlQ || "");
    }
  }, [searchParams]);
  const [list, setList] = useState<PlanRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pickerAnim, setPickerAnim] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Stats state
  const [statsPeriod, setStatsPeriod] = useState<string>("30d");
  const [statsData, setStatsData] = useState<PlanRequestStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Action modal state
  const [selectedRequest, setSelectedRequest] = useState<PlanRequestRow | null>(null);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Response form state
  const [responseForm, setResponseForm] = useState({
    suggestedItineraries: "",
    requiredPermits: "",
    estimatedTimeline: "",
    assignedAgent: "",
    assignedAgentId: null as number | null,
    adminResponse: "",
  });
  const [quickMessage, setQuickMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const [assignmentSaving, setAssignmentSaving] = useState(false);
  
  // Agent selection state
  const [agents, setAgents] = useState<any[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  // ── Structured feedback builder state ──────────────────────────────────────
  type ItineraryOption = {
    id: string; name: string; days: number; pricePerPerson: string;
    inclusions: string[]; customInclusion: string; dayOutline: string;
  };
  const [itineraryOptions, setItineraryOptions] = useState<ItineraryOption[]>([]);
  const [activeSections, setActiveSections] = useState<Set<string>>(
    new Set(["itinerary", "permits", "timeline", "agent"])
  );
  const [selectedPermits, setSelectedPermits] = useState<string[]>([]);
  const [customPermitInput, setCustomPermitInput] = useState("");
  const [tripSpecificNotes, setTripSpecificNotes] = useState("");
  // ───────────────────────────────────────────────────────────────────────────

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(event.target as Node)) {
        setShowAgentDropdown(false);
      }
    }
    
    if (showAgentDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showAgentDropdown]);

  async function load() {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
      };
      // Only include filters if they have values (not empty strings)
      if (role && role.trim()) params.role = role.trim();
      if (tripType && tripType.trim()) params.tripType = tripType.trim();
      if (status && status.trim()) params.status = status.trim();
      if (date) {
        if (Array.isArray(date) && date.length > 0) {
          if (date[0]) params.start = date[0];
          if (date[1]) params.end = date[1];
        } else if (date && !Array.isArray(date)) {
          params.date = date;
        }
      }
      if (q && q.trim()) params.q = q.trim();

      console.log('Loading plan requests with params:', params);
      const r = await api.get<{ items: PlanRequestRow[]; total: number }>("/api/admin/plan-with-us/requests", { params });
      console.log('Plan requests response:', { 
        itemsCount: Array.isArray(r.data?.items) ? r.data.items.length : 0, 
        total: r.data?.total || 0, 
        items: r.data?.items,
        fullResponse: r.data
      });
      setList(Array.isArray(r.data?.items) ? r.data.items : []);
      setTotal(r.data?.total ?? 0);
    } catch (err: any) {
      console.error("Failed to load plan requests", err);
      console.error("Error details:", err?.response?.data || err?.message);
      // Show error to user
      if (err?.response?.data?.error) {
        alert(`Error loading requests: ${err.response.data.error}`);
      }
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await api.get<PlanRequestStats>("/api/admin/plan-with-us/requests/stats", {
        params: { period: statsPeriod },
      });
      setStatsData(r.data);
    } catch (err) {
      console.error("Failed to load plan request statistics", err);
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  }, [statsPeriod]);

  // Load data when filters change
  useEffect(() => {
    authify();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, role, tripType, status, date, q]);

  useEffect(() => {
    authify();
    loadStats();
  }, [loadStats]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Load agents for selection
  const loadAgents = async (searchQuery: string = "") => {
    setAgentsLoading(true);
    try {
      const params: any = {
        page: 1,
        pageSize: 50,
        status: "ACTIVE",
        available: "true",
      };
      if (searchQuery && searchQuery.trim()) {
        params.q = searchQuery.trim();
      }
      const response = await api.get("/api/admin/agents", { params });
      const body = response.data as any;
      const items = body?.data?.items ?? body?.items ?? [];
      setAgents(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error("Failed to load agents", err);
      setAgents([]);
    } finally {
      setAgentsLoading(false);
    }
  };

  const handleSaveAssignment = async () => {
    if (!selectedRequest) return;
    if (!responseForm.assignedAgentId) {
      alert("Please select an agent first.");
      return;
    }

    setAssignmentSaving(true);
    try {
      const selectedAgent = agents.find((a) => Number(a?.id) === Number(responseForm.assignedAgentId));

      const submitData: any = {
        assignedAgentId: responseForm.assignedAgentId,
        assignedAgent: selectedAgent?.user?.name || responseForm.assignedAgent || "",
      };

      // Nice default: when assigning an agent to a pending request, mark it in-progress.
      if (String(selectedRequest.status || "").toUpperCase() === "PENDING") {
        submitData.status = "IN_PROGRESS";
      }

      await api.patch(`/api/admin/plan-with-us/requests/${selectedRequest.id}`, submitData);

      // Refresh list + selected request details
      await load();
      const refreshed = await api.get(`/api/admin/plan-with-us/requests/${selectedRequest.id}`);
      setSelectedRequest(refreshed.data);
      setResponseForm((prev) => ({
        ...prev,
        assignedAgent: refreshed.data?.assignedAgent || prev.assignedAgent,
        assignedAgentId: refreshed.data?.assignedAgentId ?? prev.assignedAgentId,
      }));

      window.dispatchEvent(
        new CustomEvent("nols:toast", {
          detail: { type: "success", title: "Agent Assigned", message: "Agent assignment saved successfully.", duration: 3000 },
        })
      );
    } catch (err) {
      console.error("Failed to save assignment", err);
      alert("Failed to save assignment. Please try again.");
    } finally {
      setAssignmentSaving(false);
    }
  };

  // Handle opening response modal
  const handleOpenResponse = async (request: PlanRequestRow) => {
    // Load agents when opening modal
    await loadAgents();
    
    // Fetch the full request details to get updated notes
    try {
      const response = await api.get(`/api/admin/plan-with-us/requests/${request.id}`);
      setSelectedRequest(response.data);
      setResponseForm({
        suggestedItineraries: response.data.suggestedItineraries || "",
        requiredPermits: response.data.requiredPermits || "",
        estimatedTimeline: response.data.estimatedTimeline || "",
        assignedAgent: response.data.assignedAgent || "",
        assignedAgentId: response.data.assignedAgentId || null,
        adminResponse: response.data.adminResponse || "",
      });
      setQuickMessage("");
      // Reset structured builder state
      setItineraryOptions([]);
      setSelectedPermits([]);
      setCustomPermitInput("");
      setTripSpecificNotes("");
      setActiveSections(new Set(["itinerary", "permits", "timeline", "agent"]));
    } catch (err) {
      console.error("Failed to load request details", err);
      // Fallback to the request from the list
      setSelectedRequest(request);
      setResponseForm({
        suggestedItineraries: request.suggestedItineraries || "",
        requiredPermits: request.requiredPermits || "",
        estimatedTimeline: request.estimatedTimeline || "",
        assignedAgent: request.assignedAgent || "",
        assignedAgentId: null,
        adminResponse: request.adminResponse || "",
      });
    }
    setShowResponseModal(true);
  };

  
  // Handle agent selection
  const handleSelectAgent = (agent: any) => {
    setResponseForm({
      ...responseForm,
      assignedAgentId: agent.id,
      assignedAgent: agent.user?.name || "",
    });
    setShowAgentDropdown(false);
    setAgentSearchQuery(agent.user?.name || "");
  };

  const getAgentRatingSummary = (agent: any): { avg: number | null; totalReviews: number | null } => {
    const performanceMetrics = agent?.performanceMetrics ?? {};
    const punctuality = typeof performanceMetrics?.punctualityRating === "number" ? performanceMetrics.punctualityRating : null;
    const customerCare = typeof performanceMetrics?.customerCareRating === "number" ? performanceMetrics.customerCareRating : null;
    const communication = typeof performanceMetrics?.communicationRating === "number" ? performanceMetrics.communicationRating : null;
    const totalReviews = typeof performanceMetrics?.totalReviews === "number" ? performanceMetrics.totalReviews : null;

    const parts = [punctuality, customerCare, communication].filter((n): n is number => typeof n === "number" && n > 0);
    if (parts.length === 0) return { avg: null, totalReviews };
    const avg = parts.reduce((sum, n) => sum + n, 0) / parts.length;
    return { avg, totalReviews };
  };

  const renderStars = (avg: number | null) => {
    const rounded = typeof avg === "number" ? Math.max(0, Math.min(5, Math.round(avg))) : 0;
    return (
      <div className="flex items-center gap-0.5" aria-label={avg ? `Rating ${avg.toFixed(1)} out of 5` : "No rating"}>
        {Array.from({ length: 5 }).map((_, i) => {
          const filled = i + 1 <= rounded;
          return (
            <Star
              key={i}
              className={
                "h-3.5 w-3.5 " +
                (filled ? "text-yellow-500 fill-yellow-500" : "text-gray-300")
              }
            />
          );
        })}
      </div>
    );
  };
  
  // Initialize agent search query when modal opens with existing agent
  useEffect(() => {
    if (showResponseModal && responseForm.assignedAgent) {
      setAgentSearchQuery(responseForm.assignedAgent);
    }
  }, [showResponseModal, responseForm.assignedAgent]);

  // Handle sending quick message
  const handleSendQuickMessage = async () => {
    if (!selectedRequest || !quickMessage.trim()) return;
    
    setSendingMessage(true);
    try {
      await api.post(`/api/admin/plan-with-us/requests/${selectedRequest.id}/message`, {
        message: quickMessage.trim(),
      });
      
      // Clear the message input (messages will reload automatically via ConversationHistoryDisplay useEffect)
      setQuickMessage("");
      
      // Show success message
      window.dispatchEvent(
        new CustomEvent("nols:toast", {
          detail: { type: "success", title: "Message Sent", message: "Your response has been sent to the customer.", duration: 3000 },
        })
      );
    } catch (err) {
      console.error("Failed to send message", err);
      alert("Failed to send message. Please try again.");
    } finally {
      setSendingMessage(false);
    }
  };

  // Handle starting work on request
  const handleStartWork = async (requestId: number) => {
    try {
      await api.patch(`/api/admin/plan-with-us/requests/${requestId}`, {
        status: "IN_PROGRESS",
      });
      await load();
    } catch (err) {
      console.error("Failed to update status", err);
      alert("Failed to update status. Please try again.");
    }
  };

  // Chart data for Requests by Role (Donut Chart)
  const roleDonutChartData = useMemo<ChartData<"doughnut">>(() => {
    if (!statsData || !statsData.roleBreakdown) {
      return { labels: [], datasets: [] };
    }
    const labels = Object.keys(statsData.roleBreakdown).filter(key => statsData.roleBreakdown[key] > 0);
    const data = Object.values(statsData.roleBreakdown).filter((v, i) => Object.values(statsData.roleBreakdown)[i] > 0);
    const colors = [
      "rgba(59, 130, 246, 0.8)", // Blue
      "rgba(16, 185, 129, 0.8)", // Green
      "rgba(245, 158, 11, 0.8)", // Amber
      "rgba(139, 92, 246, 0.8)", // Purple
      "rgba(239, 68, 68, 0.8)", // Red
    ];
    return {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: "#fff",
        borderWidth: 2,
        hoverOffset: 4,
      }],
    };
  }, [statsData]);

  // Chart data for Requests by Trip Type (Bar Chart)
  const tripTypeBarChartData = useMemo<ChartData<"bar">>(() => {
    if (!statsData || !statsData.tripTypeBreakdown) {
      return { labels: [], datasets: [] };
    }
    const labels = Object.keys(statsData.tripTypeBreakdown).filter(key => statsData.tripTypeBreakdown[key] > 0);
    const data = Object.values(statsData.tripTypeBreakdown).filter((v, i) => Object.values(statsData.tripTypeBreakdown)[i] > 0);
    return {
      labels,
      datasets: [{
        label: "Number of Requests",
        data,
        backgroundColor: "rgba(59, 130, 246, 0.8)",
        borderColor: "rgba(59, 130, 246, 1)",
        borderWidth: 1,
      }],
    };
  }, [statsData]);

  // Chart data for Request Trends (Line Chart)
  const requestTrendsLineChartData = useMemo<ChartData<"line">>(() => {
    if (!statsData || !statsData.trends) {
      return { labels: [], datasets: [] };
    }
    const labels = statsData.trends.map(t => new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    return {
      labels,
      datasets: [
        {
          label: "Total Requests",
          data: statsData.trends.map(t => t.count),
          fill: true,
          backgroundColor: "rgba(59, 130, 246, 0.2)",
          borderColor: "rgba(59, 130, 246, 1)",
          borderWidth: 2,
          pointBackgroundColor: "rgba(59, 130, 246, 1)",
          pointBorderColor: "#fff",
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderColor: "rgba(59, 130, 246, 1)",
          tension: 0.4,
        },
        {
          label: "New",
          data: statsData.trends.map(t => t.pending),
          fill: true,
          backgroundColor: "rgba(245, 158, 11, 0.2)",
          borderColor: "rgba(245, 158, 11, 1)",
          borderWidth: 2,
          pointBackgroundColor: "rgba(245, 158, 11, 1)",
          pointBorderColor: "#fff",
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderColor: "rgba(245, 158, 11, 1)",
          tension: 0.4,
        },
        {
          label: "In Progress",
          data: statsData.trends.map(t => t.inProgress),
          fill: true,
          backgroundColor: "rgba(16, 185, 129, 0.2)",
          borderColor: "rgba(16, 185, 129, 1)",
          borderWidth: 2,
          pointBackgroundColor: "rgba(16, 185, 129, 1)",
          pointBorderColor: "#fff",
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderColor: "rgba(16, 185, 129, 1)",
          tension: 0.4,
        },
        {
          label: "Completed",
          data: statsData.trends.map(t => t.completed),
          fill: true,
          backgroundColor: "rgba(34, 197, 94, 0.2)",
          borderColor: "rgba(34, 197, 94, 1)",
          borderWidth: 2,
          pointBackgroundColor: "rgba(34, 197, 94, 1)",
          pointBorderColor: "#fff",
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderColor: "rgba(34, 197, 94, 1)",
          tension: 0.4,
        },
      ],
    };
  }, [statsData]);

  // ── Structured feedback helpers ─────────────────────────────────────────────
  const INCLUSION_PRESETS = [
    "Accommodation","Meals (Full Board)","Meals (Half Board)","Meals (Bed & Breakfast)",
    "Transport","Game Drives","Park Entry Fees","Guided Tours","Equipment/Gear",
    "Airport Transfers","Cultural Activities","Photography Session","Boat Safari","Walking Safari",
  ];
  const PERMIT_PRESETS: Record<string, string[]> = {
    "Safari": ["National Park Entry Permit","Vehicle Entry Fee","Photography/Filming Permit","Yellow Fever Certificate","Valid International Passport","Travel Insurance"],
    "Cultural": ["Cultural Site Entry Permit","Photography/Filming Permit","Local Guide Certification","Travel Insurance","Valid ID"],
    "Adventure / Hiking": ["Hiking/Trekking Permit","Mountain Climbing Certificate","Medical Fitness Certificate","Travel Insurance","Emergency Contact Registration","Gear Checklist Confirmation"],
    "School / Teacher": ["Parent/Guardian Consent Forms","School Authorization Letter","Student ID/School Registry","First Aid Certificate (Staff)","Emergency Contact List","Dietary/Medical Requirements Sheet"],
    "Local tourism": ["Entry Tickets for Sites","Transport Charter Permit","Travel Insurance","Valid ID Documents"],
    "Multi-destination tour": ["National Park Entry Permits","Cross-Border Documents (if applicable)","Transport Charter Permit","Yellow Fever Certificate","Travel Insurance","Valid Passport"],
  };
  const SECTION_DEFS: Record<string, { id: string; label: string }[]> = {
    "Safari":             [{ id:"itinerary",label:"Itinerary Options"},{ id:"permits",label:"Park Permits & Docs"},{ id:"timeline",label:"Timeline"},{ id:"tripSpecific",label:"Game Drive & Lodges"},{ id:"agent",label:"Assign Agent"}],
    "Cultural":           [{ id:"itinerary",label:"Itinerary Options"},{ id:"permits",label:"Permits & Docs"},{ id:"timeline",label:"Timeline"},{ id:"tripSpecific",label:"Cultural Sites & Guide"},{ id:"agent",label:"Assign Agent"}],
    "Adventure / Hiking": [{ id:"itinerary",label:"Itinerary Options"},{ id:"permits",label:"Permits & Gear"},{ id:"timeline",label:"Timeline"},{ id:"tripSpecific",label:"Safety & Fitness Info"},{ id:"agent",label:"Assign Agent"}],
    "School / Teacher":   [{ id:"itinerary",label:"Itinerary Options"},{ id:"permits",label:"Required Documents"},{ id:"timeline",label:"Timeline"},{ id:"tripSpecific",label:"Educational Objectives"},{ id:"agent",label:"Assign Agent"}],
    "Local tourism":      [{ id:"itinerary",label:"Itinerary Options"},{ id:"permits",label:"Permits & Docs"},{ id:"timeline",label:"Timeline"},{ id:"tripSpecific",label:"Route & Highlights"},{ id:"agent",label:"Assign Agent"}],
    "default":            [{ id:"itinerary",label:"Itinerary Options"},{ id:"permits",label:"Permits & Documents"},{ id:"timeline",label:"Timeline"},{ id:"tripSpecific",label:"Trip Details"},{ id:"agent",label:"Assign Agent"}],
  };
  const TIMELINE_PRESETS = [
    { label:"2-Week Window", value:"Booking confirmation required within 14 days. 50% deposit on booking, balance 7 days before departure." },
    { label:"30-Day Standard", value:"Best booked 30 days in advance. 30% deposit on confirmation, full payment 14 days before departure." },
    { label:"Last Minute (<7 days)", value:"Available as last-minute booking. Full payment required at booking. Subject to availability." },
    { label:"3-Month Safari Plan", value:"Recommended 3 months in advance for peak season. 25% deposit to secure dates, balance 30 days before." },
  ];
  const getAvailableSections = (tripType: string) => SECTION_DEFS[tripType] || SECTION_DEFS["default"];
  const getPermitPresets = (tripType: string) => PERMIT_PRESETS[tripType] || ["Travel Insurance","Valid ID Documents","Entry Permits"];
  const getTripSpecificLabel = (tripType: string) => (({ "Safari":"Game Drive & Lodge Options","Cultural":"Cultural Sites & Local Guide Info","Adventure / Hiking":"Safety, Fitness & Gear Requirements","School / Teacher":"Educational Objectives & Safety Protocols","Local tourism":"Route Highlights & Local Tips" } as Record<string,string>)[tripType] || "Trip-Specific Information");
  const getTripSpecificPlaceholder = (tripType: string) => (({ "Safari":"Describe lodge options, game reserve highlights, Big Five sightings, best drive times...","Cultural":"List cultural sites, local guides, historical significance, cultural etiquette...","Adventure / Hiking":"Fitness requirements, altitude info, gear checklist, emergency protocols...","School / Teacher":"Learning objectives, age-appropriate activities, emergency plan, dietary notes...","Local tourism":"Route map notes, local gems, viewpoints, lunch spots, photo opportunities..." } as Record<string,string>)[tripType] || "Any trip-specific details, highlights, or important information...");
  const toggleSection = (id: string) => setActiveSections(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const addItineraryOption = () => setItineraryOptions(prev => [...prev, { id: Date.now().toString(), name: `Option ${String.fromCharCode(65 + prev.length)}`, days: 3, pricePerPerson: "", inclusions: [], customInclusion: "", dayOutline: "" }]);
  const removeItineraryOption = (id: string) => setItineraryOptions(prev => prev.filter(o => o.id !== id));
  const updateItineraryOption = (id: string, field: string, value: unknown) => setItineraryOptions(prev => prev.map(o => o.id === id ? { ...o, [field]: value } : o));
  const toggleInclusion = (optId: string, item: string) => setItineraryOptions(prev => prev.map(o => o.id === optId ? { ...o, inclusions: o.inclusions.includes(item) ? o.inclusions.filter(i => i !== item) : [...o.inclusions, item] } : o));
  const addCustomInclusion = (optId: string) => setItineraryOptions(prev => prev.map(o => o.id === optId ? { ...o, inclusions: o.customInclusion.trim() ? [...o.inclusions, o.customInclusion.trim()] : o.inclusions, customInclusion: "" } : o));
  const togglePermit = (item: string) => setSelectedPermits(prev => prev.includes(item) ? prev.filter(p => p !== item) : [...prev, item]);
  const addCustomPermit = () => { if (customPermitInput.trim()) { togglePermit(customPermitInput.trim()); setCustomPermitInput(""); } };

  const handleSubmitResponseNew = async () => {
    if (!selectedRequest) return;
    setSubmitting(true);
    try {
      const itineraryText = itineraryOptions.length > 0
        ? itineraryOptions.map((opt, i) => {
            const lines: string[] = [`=== ${opt.name || `Option ${String.fromCharCode(65 + i)}`} ===`];
            lines.push(`Duration: ${opt.days} ${opt.days === 1 ? "day" : "days"}`);
            if (opt.pricePerPerson) lines.push(`Price per person: TZS ${opt.pricePerPerson}`);
            if (opt.inclusions.length > 0) lines.push(`Includes: ${opt.inclusions.join(", ")}`);
            if (opt.dayOutline.trim()) lines.push(`\nItinerary:\n${opt.dayOutline.trim()}`);
            return lines.join("\n");
          }).join("\n\n")
        : responseForm.suggestedItineraries;

      const permitsText = selectedPermits.length > 0
        ? selectedPermits.map((p, i) => `${i + 1}. ${p}`).join("\n")
        : responseForm.requiredPermits;

      const fullAdminResponse = [responseForm.adminResponse, tripSpecificNotes].filter(Boolean).join("\n\n");

      const submitData: Record<string, unknown> = {
        status: "COMPLETED",
        suggestedItineraries: itineraryText,
        requiredPermits: permitsText,
        estimatedTimeline: responseForm.estimatedTimeline,
        adminResponse: fullAdminResponse,
      };
      if (responseForm.assignedAgentId) {
        submitData.assignedAgentId = responseForm.assignedAgentId;
        const sel = agents.find(a => a.id === responseForm.assignedAgentId);
        if (sel) submitData.assignedAgent = sel.user?.name || "";
      }
      await api.patch(`/api/admin/plan-with-us/requests/${selectedRequest.id}`, submitData);
      await load();
      setShowResponseModal(false);
      setSelectedRequest(null);
      setResponseForm({ suggestedItineraries:"", requiredPermits:"", estimatedTimeline:"", assignedAgent:"", assignedAgentId:null, adminResponse:"" });
      setItineraryOptions([]);
      setSelectedPermits([]);
      setCustomPermitInput("");
      setTripSpecificNotes("");
      setActiveSections(new Set(["itinerary","permits","timeline","agent"]));
      setQuickMessage("");
      setAgentSearchQuery("");
      setShowAgentDropdown(false);
    } catch (err) {
      console.error("Failed to submit response", err);
      alert("Failed to submit response. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };
  // ───────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div
        className="relative rounded-xl overflow-hidden shadow-sm"
        style={{ background: "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 45%, #0f766e 100%)" }}
      >
        {/* SVG geometric overlay */}
        <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none" viewBox="0 0 800 160">
          <line x1="0" y1="40" x2="800" y2="40" stroke="white" strokeWidth="1"/>
          <line x1="0" y1="80" x2="800" y2="80" stroke="white" strokeWidth="1"/>
          <line x1="0" y1="120" x2="800" y2="120" stroke="white" strokeWidth="1"/>
          <line x1="200" y1="0" x2="200" y2="160" stroke="white" strokeWidth="1"/>
          <line x1="500" y1="0" x2="500" y2="160" stroke="white" strokeWidth="1"/>
          <circle cx="680" cy="30" r="60" stroke="white" strokeWidth="1" fill="none"/>
          <circle cx="100" cy="140" r="45" stroke="white" strokeWidth="1" fill="none"/>
        </svg>
        <div className="relative z-10 px-8 py-8 flex items-center gap-6">
          <div className="h-16 w-16 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center flex-shrink-0 shadow-lg">
            <FileText className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Plan Requests</h1>
            <p className="text-blue-100 text-sm mt-1">Review requests and provide feedback to customers</p>
          </div>
        </div>
      </div>

      {/* Search and Filters - Moved to Top */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-col gap-4 w-full max-w-full">
          {/* Search and Filters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 w-full max-w-full">
            {/* Search Box */}
            <div className="relative w-full min-w-0 sm:col-span-2 lg:col-span-2 xl:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm max-w-full box-border"
                placeholder="Search requests..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Role Filter */}
            <div className="w-full min-w-0">
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm bg-white max-w-full box-border"
              >
                <option value="">All Roles</option>
                <option value="Event planner">Event Planner</option>
                <option value="School / Teacher">School / Teacher</option>
                <option value="University">University</option>
                <option value="Community group">Community Group</option>
                <option value="Tourist">Tourist</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Trip Type Filter */}
            <div className="w-full min-w-0">
              <select
                value={tripType}
                onChange={(e) => {
                  setTripType(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm bg-white max-w-full box-border"
              >
                <option value="">All Trip Types</option>
                <option value="Local tourism">Local Tourism</option>
                <option value="Safari">Safari</option>
                <option value="Cultural">Cultural</option>
                <option value="Adventure / Hiking">Adventure / Hiking</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Status Filter */}
            <div className="w-full min-w-0">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm bg-white max-w-full box-border"
              >
                <option value="">All Status</option>
                <option value="NEW">New</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>

            {/* Date Picker */}
            <div className="relative w-full min-w-0">
              <button
                type="button"
                onClick={() => {
                  setPickerAnim(true);
                  setTimeout(() => setPickerAnim(false), 350);
                  setPickerOpen((v) => !v);
                }}
                className={`w-full px-3 py-2 rounded-lg border border-gray-300 text-sm flex items-center justify-center gap-2 text-gray-700 bg-white transition-all ${
                  pickerAnim ? "ring-2 ring-blue-100" : "hover:bg-gray-50"
                } box-border`}
              >
                <Calendar className="h-4 w-4" />
                <span>Date</span>
              </button>
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm" onClick={() => setPickerOpen(false)} />
                  <div className="fixed z-40 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
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
        </div>
      </div>

      {/* KPI Stats Strip */}
      {statsData?.trends && statsData.trends.length > 0 && (() => {
        interface TrendItem { count: number; pending: number; inProgress: number; completed: number; }
        const kpis = [
          { label: "Total", value: statsData.trends.reduce((s: number, t: TrendItem) => s + t.count, 0), color: "blue" },
          { label: "New", value: statsData.trends.reduce((s: number, t: TrendItem) => s + t.pending, 0), color: "amber" },
          { label: "In Progress", value: statsData.trends.reduce((s: number, t: TrendItem) => s + t.inProgress, 0), color: "indigo" },
          { label: "Completed", value: statsData.trends.reduce((s: number, t: TrendItem) => s + t.completed, 0), color: "emerald" },
        ] as const;
        const periodLabel = statsPeriod === "7d" ? "Last 7 days" : statsPeriod === "30d" ? "Last 30 days" : statsPeriod === "month" ? "This month" : "This year";
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {kpis.map(({ label, value, color }) => (
              <div key={label} className={`bg-${color}-50 rounded-xl border border-${color}-100 p-4 shadow-sm`}>
                <div className={`text-2xl font-bold text-${color}-700 leading-none`}>{value}</div>
                <div className="text-xs font-semibold text-gray-700 mt-1.5">{label}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{periodLabel}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Requests Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-teal-500" />
        {loading ? (
          <>
            {/* Skeleton Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trip Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dates</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Group Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Budget</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {[...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-12"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-24"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-32 mb-2"></div>
                        <div className="h-3 bg-gray-200 rounded w-40"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-28"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-32"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-16"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-6 bg-gray-200 rounded-full w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="h-8 bg-gray-200 rounded w-24 ml-auto"></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : list.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No plan requests found.</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trip Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dates</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Group Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Budget</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {list.map((request) => {
                    return (
                      <tr key={request.id} className={`hover:bg-gray-50 transition-colors duration-150 ${request.isUrgent ? "bg-amber-50 border-l-4 border-l-amber-500" : ""}`}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          <div className="flex items-center gap-2">
                            #{request.id}
                            {request.isUrgent && (
                              <div title="Urgent request">
                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.role}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <div>
                            <div className="font-medium">{request.customer.name}</div>
                            <div className="text-xs text-gray-400">{request.customer.email}</div>
                            {request.customer.phone && (
                              <div className="text-xs text-gray-400">{request.customer.phone}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.tripType}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            <span className="max-w-xs truncate">{request.destinations || "N/A"}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {request.dateFrom && request.dateTo ? (
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-gray-400" />
                              <span>{new Date(request.dateFrom).toLocaleDateString()} - {new Date(request.dateTo).toLocaleDateString()}</span>
                            </div>
                          ) : (
                            "Flexible"
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.groupSize || "N/A"}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.budget || "N/A"}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full border ${
                            request.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                            request.status === "IN_PROGRESS" ? "bg-blue-50 text-blue-700 border-blue-200" :
                            "bg-amber-50 text-amber-700 border-amber-200"
                          }`}>
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${request.status === "COMPLETED" ? "bg-emerald-500" : request.status === "IN_PROGRESS" ? "bg-blue-500" : "bg-amber-500"}`} />{request.status === "NEW" ? "New" : request.status === "IN_PROGRESS" ? "In Progress" : "Completed"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-2">
                            {request.status === "NEW" && (
                              <button
                                onClick={() => handleStartWork(request.id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold hover:bg-blue-100 hover:border-blue-300 transition-all"
                              >
                                <Edit className="h-4 w-4" />
                                Start Work
                              </button>
                            )}
                            {request.status === "IN_PROGRESS" && (
                              <button
                                onClick={() => handleOpenResponse(request)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-all shadow-sm"
                              >
                                <Send className="h-4 w-4" />
                                Provide Feedback
                              </button>
                            )}
                            {request.status === "COMPLETED" && (
                              <button
                                onClick={() => handleOpenResponse(request)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 text-xs font-semibold hover:bg-gray-200 transition-all"
                              >
                                <Eye className="h-4 w-4" />
                                View Response
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-gray-200">
              {list.map((request) => {
                const responseTimeColor = request.hoursSinceCreation > 48 
                  ? "text-red-600" 
                  : request.hoursSinceCreation > 24 
                  ? "text-amber-600" 
                  : "text-green-600";
                const responseTimeText = request.hoursSinceCreation < 24
                  ? `${request.hoursSinceCreation}h`
                  : `${Math.floor(request.hoursSinceCreation / 24)}d`;
                
                return (
                  <div key={request.id} className={`p-4 bg-white hover:bg-gray-50 transition-colors duration-150 ${request.isUrgent ? "bg-amber-50 border-l-4 border-l-amber-500" : ""}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">Request #{request.id}</span>
                        {request.isUrgent && (
                          <div title="Urgent request">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                          </div>
                        )}
                      </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full border ${
                      request.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                      request.status === "IN_PROGRESS" ? "bg-blue-50 text-blue-700 border-blue-200" :
                      "bg-amber-50 text-amber-700 border-amber-200"
                    }`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${request.status === "COMPLETED" ? "bg-emerald-500" : request.status === "IN_PROGRESS" ? "bg-blue-500" : "bg-amber-500"}`} />{request.status === "NEW" ? "New" : request.status === "IN_PROGRESS" ? "In Progress" : "Completed"}
                    </span>
                    </div>
                    <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                      <Clock className={`h-4 w-4 ${responseTimeColor}`} />
                      <span className={responseTimeColor}>
                        Response: {request.respondedAt ? "Responded" : responseTimeText}
                      </span>
                      {request.hoursSinceCreation > 48 && request.status === "NEW" && (
                        <span className="text-xs text-red-600 font-medium">· Overdue</span>
                      )}
                    </div>
                  <div className="text-sm text-gray-600 mb-1">
                    <span>Role: {request.role} · Type: {request.tripType}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <User className="h-4 w-4 text-gray-400" />
                    <span>Customer: {request.customer.name}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span>Destination: {request.destinations || "N/A"}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span>
                      {request.dateFrom && request.dateTo
                        ? `${new Date(request.dateFrom).toLocaleDateString()} - ${new Date(request.dateTo).toLocaleDateString()}`
                        : "Flexible dates"}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1">
                    <span>Group Size: {request.groupSize || "N/A"}</span>
                    {request.transportRequired && (
                      <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Transport</span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2 justify-end">
                    {request.status === "NEW" && (
                      <button
                        onClick={() => handleStartWork(request.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold hover:bg-blue-100 transition-all"
                      >
                        <Edit className="h-4 w-4" />
                        Start Work
                      </button>
                    )}
                    {request.status === "IN_PROGRESS" && (
                      <button
                        onClick={() => handleOpenResponse(request)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-all shadow-sm"
                      >
                        <Send className="h-4 w-4" />
                        Provide Feedback
                      </button>
                    )}
                    {request.status === "COMPLETED" && (
                      <button
                        onClick={() => handleOpenResponse(request)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 text-xs font-semibold hover:bg-gray-200 transition-all"
                      >
                        <Eye className="h-4 w-4" />
                        View Response
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {list.length > 0 && (
        <div className="flex justify-center py-4">
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
              Page {page} of {pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </nav>
        </div>
      )}

      {/* Charts Section - Moved Below Table */}
      {statsData && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Donut Chart - Requests by Role */}
            <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-1 group">
              <div className="flex items-center gap-2 mb-6">
                <User className="h-5 w-5 text-blue-600 group-hover:scale-110 group-hover:rotate-12 transition-all duration-300" />
                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors duration-300">Requests by Role</h3>
              </div>

              {statsLoading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
                </div>
              ) : statsData && Object.keys(statsData.roleBreakdown).some(k => statsData.roleBreakdown[k] > 0) ? (
                <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
                  <Chart
                    type="doughnut"
                    data={roleDonutChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: "right",
                          labels: {
                            usePointStyle: true,
                            padding: 20,
                            font: {
                              size: 12,
                            },
                          },
                        },
                        tooltip: {
                          callbacks: {
                            label: (context: any) => {
                              const label = context.label || "";
                              const value = context.parsed || 0;
                              const total = context.dataset.data.reduce((sum: number, val: number) => sum + val, 0);
                              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                              return `${label}: ${value} requests (${percentage}%)`;
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-center">
                  <div>
                    <User className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No role data available.</p>
                    <p className="text-xs text-gray-400 mt-1">Try adjusting your filters.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Bar Chart - Requests by Trip Type */}
            <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-green-300 hover:-translate-y-1 group">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-green-600 transition-colors duration-300">
                    <BarChart3 className="h-5 w-5 text-green-600 group-hover:scale-110 transition-transform duration-300" />
                    Requests by Trip Type
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Distribution of requests by trip type</p>
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
                      onClick={() => setStatsPeriod(p.value)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                        statsPeriod === p.value
                          ? "bg-green-50 border-green-300 text-green-700 scale-105 shadow-md"
                          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:scale-105 hover:shadow-sm"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {statsLoading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-green-600"></div>
                </div>
              ) : statsData && Object.keys(statsData.tripTypeBreakdown).some(k => statsData.tripTypeBreakdown[k] > 0) ? (
                <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
                  <Chart
                    type="bar"
                    data={tripTypeBarChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: false,
                        },
                        tooltip: {
                          callbacks: {
                            label: (context: any) => {
                              const label = context.dataset.label || "";
                              const value = context.parsed.y || 0;
                              return `${label}: ${value} requests`;
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
                            text: "Number of Requests",
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
                  {/* Skeleton Bar Chart */}
                  <div className="relative h-full w-full">
                    <div className="absolute left-0 top-0 bottom-8 w-8 flex flex-col justify-between">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      ))}
                    </div>
                    <div className="ml-10 h-full relative">
                      <div className="absolute inset-0 flex flex-col justify-between">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className="h-px bg-gray-200"></div>
                        ))}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 h-full flex items-end justify-around px-2">
                        {[...Array(5)].map((_, i) => (
                          <div
                            key={i}
                            className="w-8 bg-gray-200 rounded-t animate-pulse"
                            style={{ height: `${Math.random() * 70 + 30}%` }}
                          ></div>
                        ))}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className="h-3 w-10 bg-gray-200 rounded animate-pulse"></div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Request Trends Chart */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-1 group">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-blue-600 transition-colors duration-300">
                  <TrendingUp className="h-5 w-5 text-blue-600 group-hover:scale-110 transition-transform duration-300" />
                  Request Trends
                </h3>
                <p className="text-sm text-gray-500 mt-1">Daily request trends over time</p>
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
                    onClick={() => setStatsPeriod(p.value)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                      statsPeriod === p.value
                        ? "bg-blue-50 border-blue-300 text-blue-700 scale-105 shadow-md"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:scale-105 hover:shadow-sm"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {statsLoading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
              </div>
            ) : statsData && statsData.trends.length > 0 ? (
              <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
                <Chart
                  type="line"
                  data={requestTrendsLineChartData}
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
                            return `${label}: ${value} requests`;
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
                          text: "Number of Requests",
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
                        },
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="h-64 w-full flex flex-col justify-end p-4">
                {/* Skeleton Line Chart */}
                <div className="relative h-full w-full">
                  <div className="absolute left-0 top-0 bottom-8 w-8 flex flex-col justify-between">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-4 bg-gray-200 rounded animate-pulse"></div>
                    ))}
                  </div>
                  <div className="ml-10 h-full relative">
                    <div className="absolute inset-0 flex flex-col justify-between">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-px bg-gray-200"></div>
                      ))}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-full">
                      <svg className="w-full h-full" viewBox="0 0 400 300" preserveAspectRatio="none">
                        <path
                          d="M 0 250 Q 80 200, 160 180 T 320 150 T 400 100"
                          fill="rgba(59, 130, 246, 0.1)"
                          stroke="rgba(59, 130, 246, 0.3)"
                          strokeWidth="2"
                          className="animate-pulse"
                        />
                      </svg>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2">
                      {[...Array(6)].map((_, i) => (
                        <div key={i} className="h-3 w-12 bg-gray-200 rounded animate-pulse"></div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Response Modal */}
      {showResponseModal && selectedRequest && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={() => setShowResponseModal(false)}
          />
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[5vh] overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-8 h-[90vh] flex flex-col overflow-hidden">

              {/* ── Modal Header ── */}
              <div
                className="sticky top-0 z-10 flex-shrink-0 rounded-t-2xl"
                style={{ background: "linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 50%,#0f766e 100%)" }}
              >
                <div className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-white/15 border border-white/25 flex-shrink-0">
                      {selectedRequest.status === "COMPLETED"
                        ? <Eye className="h-5 w-5 text-white" />
                        : <Send className="h-5 w-5 text-white" />}
                    </span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-white leading-tight">{selectedRequest.status === "COMPLETED" ? "View Response" : "Provide Feedback"}</h2>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/15 border border-white/25 text-white/80 font-mono">#{selectedRequest.id}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${selectedRequest.status === "COMPLETED" ? "bg-emerald-500/70 text-white" : selectedRequest.status === "IN_PROGRESS" ? "bg-blue-400/70 text-white" : "bg-amber-400/70 text-white"}`}>{selectedRequest.status === "NEW" ? "New" : selectedRequest.status === "IN_PROGRESS" ? "In Progress" : "Completed"}</span>
                      </div>
                      <p className="text-blue-200 text-xs mt-1">
                        {selectedRequest.tripType} · {selectedRequest.role} · Group of {selectedRequest.groupSize ?? "?"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowResponseModal(false)}
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>
              </div>

              {/* ── Scrollable Content ── */}
              <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden px-5 py-5 space-y-4 bg-gray-50">

                {/* Request Details - full context panel */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="h-1 bg-gradient-to-r from-blue-400 to-indigo-500" />
                  <div className="p-5">
                    <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2 mb-4">
                      <span className="inline-flex h-7 w-7 rounded-md bg-blue-50 border border-blue-100 items-center justify-center">
                        <FileText className="h-4 w-4 text-blue-600" />
                      </span>
                      Request Details
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {[
                        { label:"Customer", value:selectedRequest.customer.name, color:"blue" },
                        { label:"Email", value:selectedRequest.customer.email, color:"blue" },
                        { label:"Phone", value:selectedRequest.customer.phone||"-", color:"blue" },
                        { label:"Role", value:selectedRequest.role, color:"purple" },
                        { label:"Trip Type", value:selectedRequest.tripType, color:"emerald" },
                        { label:"Group Size", value:selectedRequest.groupSize?`${selectedRequest.groupSize} people`:"-", color:"amber" },
                        { label:"Travel Dates", value:selectedRequest.dateFrom?`${selectedRequest.dateFrom}${selectedRequest.dateTo?" "+selectedRequest.dateTo:""}`:"Not specified", color:"teal" },
                        { label:"Budget", value:selectedRequest.budget?`TZS ${Number(selectedRequest.budget).toLocaleString()}`:"Not specified", color:"green" },
                        { label:"Transport", value:selectedRequest.transportRequired?"Required":"Not required", color:selectedRequest.transportRequired?"orange":"gray" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                          <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 text-${color}-600`}>{label}</div>
                          <div className="text-sm font-medium text-gray-900 break-words">{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2.5 bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <div className="text-[10px] font-bold uppercase tracking-wider mb-1 text-teal-600">Destination(s)</div>
                      <div className="text-sm text-gray-900">{selectedRequest.destinations || "-"}</div>
                    </div>
                    {selectedRequest.notes && (
                      <div className="mt-2.5 bg-amber-50 rounded-lg p-3 border border-amber-200">
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-1 text-amber-700">Guest Special Requirements / Notes</div>
                        <div className="text-sm text-amber-900 whitespace-pre-line">{selectedRequest.notes}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Conversation History */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="h-1 bg-gradient-to-r from-slate-400 to-gray-400" />
                  <div className="p-5">
                    <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2 mb-3">
                      <span className="inline-flex h-7 w-7 rounded-md bg-slate-50 border border-slate-200 items-center justify-center">
                        <MessageSquare className="h-4 w-4 text-slate-600" />
                      </span>
                      Conversation History
                    </h3>
                    <ConversationHistoryDisplay requestId={selectedRequest.id} />
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Send Quick Message</label>
                      <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                        <textarea
                          value={quickMessage}
                          onChange={(e) => setQuickMessage(e.target.value)}
                          placeholder="Send a quick update to the customer..."
                          rows={2}
                          className="w-full sm:flex-1 max-w-full box-border px-3 py-2 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm resize-none"
                        />
                        <button
                          onClick={handleSendQuickMessage}
                          disabled={sendingMessage || !quickMessage.trim()}
                          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 sm:self-end transition-all"
                        >
                          {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Feedback builder (only when not COMPLETED) ── */}
                {selectedRequest.status !== "COMPLETED" && (
                  <>
                    {/* Section selector chips */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-3">
                        Select sections to include in your feedback
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {getAvailableSections(selectedRequest.tripType).map(sec => (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() => toggleSection(sec.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                              activeSections.has(sec.id)
                                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                            }`}
                          >
                            {activeSections.has(sec.id) ? "✓ " : "+ "}{sec.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Itinerary Options */}
                    {activeSections.has("itinerary") && (
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
                        <div className="p-5">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                              <span className="inline-flex h-7 w-7 rounded-md bg-blue-50 border border-blue-100 items-center justify-center">
                                <MapPin className="h-4 w-4 text-blue-600" />
                              </span>
                              Itinerary Options
                            </h3>
                            <button
                              type="button"
                              onClick={addItineraryOption}
                              className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-all"
                            >
                              + Add Option
                            </button>
                          </div>
                          {itineraryOptions.length === 0 && (
                            <div className="text-center py-7 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-xl">
                              Click <strong>+ Add Option</strong> to build proposals (e.g. Budget Option, Premium Option)
                            </div>
                          )}
                          <div className="space-y-4">
                            {itineraryOptions.map((opt, idx) => (
                              <div key={opt.id} className="w-full min-w-0 border border-gray-200 rounded-xl overflow-hidden">
                                {/* Option name bar */}
                                <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between border-b border-gray-200 min-w-0">
                                  <input
                                    type="text"
                                    value={opt.name}
                                    onChange={e => updateItineraryOption(opt.id, "name", e.target.value)}
                                    className="bg-transparent text-sm font-bold text-gray-900 outline-none flex-1 min-w-0"
                                    placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeItineraryOption(opt.id)}
                                    className="text-xs text-gray-400 hover:text-red-500 transition-colors ml-3"
                                  >
                                    Remove
                                  </button>
                                </div>
                                {/* Days + Price */}
                                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                                  <div>
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1">Duration (days)</label>
                                    <input
                                      type="number"
                                      min={1}
                                      value={opt.days}
                                      onChange={e => updateItineraryOption(opt.id, "days", Number(e.target.value))}
                                      className="w-full max-w-full box-border px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1">Price / Person (TZS)</label>
                                    <input
                                      type="text"
                                      value={opt.pricePerPerson}
                                      onChange={e => updateItineraryOption(opt.id, "pricePerPerson", e.target.value)}
                                      className="w-full max-w-full box-border px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                      placeholder="e.g. 850,000"
                                    />
                                  </div>
                                </div>
                                {/* Inclusions */}
                                <div className="px-4 pb-3">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-2">What&apos;s Included - click to toggle</label>
                                  <div className="flex flex-wrap gap-1.5 mb-2">
                                    {INCLUSION_PRESETS.map(item => (
                                      <button
                                        key={item}
                                        type="button"
                                        onClick={() => toggleInclusion(opt.id, item)}
                                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                                          opt.inclusions.includes(item)
                                            ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                                            : "bg-gray-50 text-gray-600 border-gray-200 hover:border-emerald-300"
                                        }`}
                                      >
                                        {opt.inclusions.includes(item) ? "✓ " : ""}{item}
                                      </button>
                                    ))}
                                  </div>
                                  <input
                                    type="text"
                                    value={opt.customInclusion}
                                    onChange={e => updateItineraryOption(opt.id, "customInclusion", e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") { addCustomInclusion(opt.id); e.preventDefault(); } }}
                                    placeholder="Custom item + Enter to add"
                                    className="w-full max-w-full box-border px-3 py-2 border-2 border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                  />
                                </div>
                                {/* Day outline */}
                                <div className="px-4 pb-4 overflow-hidden">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1">
                                    Day-by-Day Outline <span className="font-normal text-gray-400 normal-case">(optional)</span>
                                  </label>
                                  <textarea
                                    value={opt.dayOutline}
                                    onChange={e => updateItineraryOption(opt.id, "dayOutline", e.target.value)}
                                    rows={3}
                                    className="w-full min-w-0 max-w-full box-border px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                                    placeholder="Day 1: Arrive Arusha, transfer to lodge..."
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Permits & Documents */}
                    {activeSections.has("permits") && (
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-500" />
                        <div className="p-5">
                          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2 mb-4">
                            <span className="inline-flex h-7 w-7 rounded-md bg-amber-50 border border-amber-100 items-center justify-center">
                              <FileText className="h-4 w-4 text-amber-600" />
                            </span>
                            Required Permits &amp; Documents
                          </h3>
                          <p className="text-xs text-gray-500 mb-3">Click items to add them to the checklist</p>
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {getPermitPresets(selectedRequest.tripType).map(item => (
                              <button
                                key={item}
                                type="button"
                                onClick={() => togglePermit(item)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                                  selectedPermits.includes(item)
                                    ? "bg-amber-100 text-amber-800 border-amber-300"
                                    : "bg-gray-50 text-gray-600 border-gray-200 hover:border-amber-300"
                                }`}
                              >
                                {selectedPermits.includes(item) ? "✓ " : ""}{item}
                              </button>
                            ))}
                          </div>

                          {selectedPermits.length > 0 && (
                            <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-2">
                                Checklist ({selectedPermits.length} items)
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {selectedPermits.map(p => (
                                  <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                                    {p}
                                    <button
                                      onClick={() => togglePermit(p)}
                                      className="text-amber-500 hover:text-amber-700 ml-0.5 leading-none"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Timeline */}
                    {activeSections.has("timeline") && (
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden w-full">
                        <div className="h-1 bg-gradient-to-r from-teal-400 to-cyan-500" />
                        <div className="p-4">
                          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2 mb-3">
                            <span className="inline-flex h-7 w-7 shrink-0 rounded-md bg-teal-50 border border-teal-100 items-center justify-center">
                              <Calendar className="h-4 w-4 text-teal-600" />
                            </span>
                            Estimated Timeline &amp; Booking Windows
                          </h3>

                          {/* Preset chips */}
                          <p className="text-[11px] text-gray-400 mb-2">Quick presets tap to apply</p>
                          <div className="flex flex-wrap gap-2 mb-5">
                            {TIMELINE_PRESETS.map(preset => (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => setResponseForm(prev => ({ ...prev, estimatedTimeline: preset.value }))}
                                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                                  responseForm.estimatedTimeline === preset.value
                                    ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                                    : "bg-white text-gray-600 border-gray-300 hover:border-teal-400 hover:text-teal-700"
                                }`}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>

                          {/* Payment term cards */}
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Payment Terms</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                            {/* Card 1 */}
                            <div className="flex flex-col gap-1.5 bg-teal-50 border border-teal-100 rounded-xl p-3 w-full">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-500">Confirm within</span>
                              <div className="flex items-baseline gap-1.5">
                                <input
                                  type="number"
                                  min={1}
                                  placeholder="14"
                                  className="w-full box-border px-3 py-2 bg-white border border-teal-200 rounded-lg text-sm font-bold text-teal-700 text-center focus:ring-2 focus:ring-teal-400 outline-none"
                                  onChange={e => {
                                    const v = e.target.value;
                                    if (!v) return;
                                    setResponseForm(prev => ({
                                      ...prev,
                                      estimatedTimeline: prev.estimatedTimeline.replace(/Booking confirmation required within \d+ days?\.?/, `Booking confirmation required within ${v} days.`).trim() || `Booking confirmation required within ${v} days.`,
                                    }));
                                  }}
                                />
                              </div>
                              <span className="text-[11px] text-teal-400 text-center">days</span>
                            </div>
                            {/* Card 2 */}
                            <div className="flex flex-col gap-1.5 bg-cyan-50 border border-cyan-100 rounded-xl p-3 w-full">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-500">Deposit</span>
                              <div className="flex items-baseline gap-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  placeholder="50"
                                  className="w-full box-border px-3 py-2 bg-white border border-cyan-200 rounded-lg text-sm font-bold text-cyan-700 text-center focus:ring-2 focus:ring-cyan-400 outline-none"
                                  onChange={e => {
                                    const v = e.target.value;
                                    if (!v) return;
                                    setResponseForm(prev => ({
                                      ...prev,
                                      estimatedTimeline: prev.estimatedTimeline.replace(/\d+% deposit[^,\.]*/, `${v}% deposit on booking`).trim() || `${v}% deposit on booking.`,
                                    }));
                                  }}
                                />
                              </div>
                              <span className="text-[11px] text-cyan-400 text-center">% on booking</span>
                            </div>
                            {/* Card 3 */}
                            <div className="flex flex-col gap-1.5 bg-slate-50 border border-slate-100 rounded-xl p-3 w-full">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Balance due</span>
                              <div className="flex items-baseline gap-1.5">
                                <input
                                  type="number"
                                  min={1}
                                  placeholder="7"
                                  className="w-full box-border px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 text-center focus:ring-2 focus:ring-slate-400 outline-none"
                                  onChange={e => {
                                    const v = e.target.value;
                                    if (!v) return;
                                    setResponseForm(prev => ({
                                      ...prev,
                                      estimatedTimeline: prev.estimatedTimeline.replace(/balance \d+ days before departure/, `balance ${v} days before departure`).trim() || `Balance due ${v} days before departure.`,
                                    }));
                                  }}
                                />
                              </div>
                              <span className="text-[11px] text-slate-400 text-center">days before departure</span>
                            </div>
                          </div>

                          {/* Live summary */}
                          {responseForm.estimatedTimeline && (
                            <div className="mt-3 flex items-start gap-2 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2.5 w-full overflow-hidden">
                              <Clock className="h-3.5 w-3.5 text-teal-500 mt-0.5 shrink-0" />
                              <p className="text-[11px] text-teal-700 leading-relaxed break-words min-w-0">
                                {responseForm.estimatedTimeline}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Trip-type specific section */}
                    {activeSections.has("tripSpecific") && (
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-purple-400 to-violet-500" />
                        <div className="p-5">
                          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2 mb-3">
                            <span className="inline-flex h-7 w-7 rounded-md bg-purple-50 border border-purple-100 items-center justify-center">
                              <MapPin className="h-4 w-4 text-purple-600" />
                            </span>
                            {getTripSpecificLabel(selectedRequest.tripType)}
                          </h3>
                          <textarea
                            value={tripSpecificNotes}
                            onChange={e => setTripSpecificNotes(e.target.value)}
                            rows={4}
                            className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-y"
                            placeholder={getTripSpecificPlaceholder(selectedRequest.tripType)}
                          />
                        </div>
                      </div>
                    )}

                    {/* Assign Agent */}
                    {activeSections.has("agent") && (
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-hidden overflow-y-visible">
                        <div className="h-1 bg-gradient-to-r from-indigo-400 to-blue-500" />
                        <div className="p-5 overflow-x-hidden overflow-y-visible">
                          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2 mb-4">
                            <span className="inline-flex h-7 w-7 rounded-md bg-indigo-50 border border-indigo-100 items-center justify-center">
                              <User className="h-4 w-4 text-indigo-600" />
                            </span>
                            Assign Agent
                          </h3>
                          <div className="w-full relative" ref={agentDropdownRef}>
                            <div className="relative">
                              <input
                                type="text"
                                value={agentSearchQuery || responseForm.assignedAgent || ""}
                                onChange={(e) => {
                                  setAgentSearchQuery(e.target.value);
                                  setShowAgentDropdown(true);
                                  if (e.target.value) { loadAgents(e.target.value); } else { loadAgents(); }
                                }}
                                onFocus={() => { setShowAgentDropdown(true); if (agents.length === 0) loadAgents(); }}
                                className="w-full max-w-full box-border pl-4 pr-10 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm bg-white placeholder:text-gray-400"
                                placeholder="Search and select an agent..."
                              />
                              <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 transition-transform ${showAgentDropdown ? "rotate-180" : ""}`} />
                            </div>
                            {showAgentDropdown && (
                              <div className="relative z-50 w-full mt-1 bg-white border-2 border-gray-200 rounded-xl shadow-xl max-h-80 overflow-y-auto">
                                {agentsLoading ? (
                                  <div className="p-4 text-center text-sm text-gray-500">Loading agents...</div>
                                ) : agents.length === 0 ? (
                                  <div className="p-4 text-center text-sm text-gray-500">No agents found. Try a different search.</div>
                                ) : (
                                  <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {agents.map((agent) => {
                                      const name = agent.user?.name || "N/A";
                                      const email = agent.user?.email || "";
                                      const initials = String(name).split(" ").filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join("") || "A";
                                      const { avg, totalReviews } = getAgentRatingSummary(agent);
                                      const selected = Number(responseForm.assignedAgentId) === Number(agent.id);
                                      const capClass = agent.currentActiveRequests >= agent.maxActiveRequests ? "bg-red-100 text-red-700" : agent.currentActiveRequests >= agent.maxActiveRequests * 0.8 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700";
                                      return (
                                        <button
                                          key={agent.id}
                                          type="button"
                                          onClick={() => handleSelectAgent(agent)}
                                          className={`group w-full text-left rounded-xl border p-3 transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${selected ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
                                        >
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-2">
                                                <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white text-xs font-bold flex items-center justify-center">{initials}</div>
                                                <div className="min-w-0">
                                                  <div className="font-semibold text-gray-900 truncate text-sm">{name}</div>
                                                  <div className="text-xs text-gray-500 truncate">{email}</div>
                                                </div>
                                              </div>
                                              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                                                {agent.yearsOfExperience ? <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">{agent.yearsOfExperience} yrs exp.</span> : null}
                                                {Array.isArray(agent.areasOfOperation) && agent.areasOfOperation.length > 0 ? <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">{agent.areasOfOperation.slice(0, 2).join(", ")}</span> : null}
                                              </div>
                                            </div>
                                            <div className="shrink-0 flex flex-col items-end gap-1">
                                              <div className={`text-xs px-2 py-0.5 rounded-md font-semibold ${capClass}`}>{agent.currentActiveRequests}/{agent.maxActiveRequests}</div>
                                              <div className="flex items-center gap-1">{renderStars(avg)}<span className="text-xs text-gray-700 font-semibold">{typeof avg === "number" ? avg.toFixed(1) : "-"}{typeof totalReviews === "number" ? ` (${totalReviews})` : ""}</span></div>
                                            </div>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {responseForm.assignedAgentId && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-xs text-gray-500">Selected: <span className="font-semibold text-gray-900">{responseForm.assignedAgent}</span></span>
                              <button type="button" onClick={() => { setResponseForm({ ...responseForm, assignedAgentId: null, assignedAgent: "" }); setAgentSearchQuery(""); }} className="text-xs text-red-500 hover:text-red-700 underline">Clear</button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── View completed response (read-only) ── */}
                {selectedRequest.status === "COMPLETED" && (
                  <div className="bg-white rounded-xl border border-emerald-200 shadow-sm overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-500" />
                    <div className="p-5 space-y-4">
                      <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 rounded-md bg-emerald-50 border border-emerald-200 items-center justify-center">
                          <Eye className="h-4 w-4 text-emerald-600" />
                        </span>
                        Feedback Sent to Customer
                      </h3>
                      {selectedRequest.suggestedItineraries && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600 mb-1.5">Itineraries &amp; Prices</div>
                          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 text-sm text-gray-800 whitespace-pre-wrap">{selectedRequest.suggestedItineraries}</div>
                        </div>
                      )}
                      {selectedRequest.requiredPermits && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1.5">Required Permits &amp; Documents</div>
                          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 text-sm text-gray-800 whitespace-pre-wrap">{selectedRequest.requiredPermits}</div>
                        </div>
                      )}
                      {selectedRequest.estimatedTimeline && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-teal-600 mb-1.5">Timeline</div>
                          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 text-sm text-gray-800 whitespace-pre-wrap">{selectedRequest.estimatedTimeline}</div>
                        </div>
                      )}
                      {selectedRequest.assignedAgent && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 mb-1.5">Assigned Agent</div>
                          <div className="text-sm font-semibold text-gray-900">{selectedRequest.assignedAgent}</div>
                        </div>
                      )}
                      {selectedRequest.respondedAt && (
                        <div className="text-xs text-gray-400 pt-2 border-t border-gray-100">
                          Sent on {new Date(selectedRequest.respondedAt).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Footer actions ── */}
              {selectedRequest.status !== "COMPLETED" && (
                <div className="flex-shrink-0 flex flex-col sm:flex-row justify-end gap-3 px-5 py-4 border-t border-gray-200 bg-white rounded-b-2xl">
                  <button
                    onClick={() => setShowResponseModal(false)}
                    className="w-full sm:w-auto px-5 py-2.5 border-2 border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAssignment}
                    disabled={assignmentSaving || !responseForm.assignedAgentId || Number(responseForm.assignedAgentId) === Number(selectedRequest.assignedAgentId ?? 0)}
                    className="w-full sm:w-auto px-5 py-2.5 border-2 border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-sm font-semibold hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                  >
                    {assignmentSaving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><User className="h-4 w-4" />Save Assignment</>}
                  </button>
                  <button
                    onClick={handleSubmitResponseNew}
                    disabled={submitting || (activeSections.has("itinerary") && itineraryOptions.length === 0)}
                    className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg"
                  >
                    {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Sending...</> : <><Send className="h-4 w-4" />Send Feedback to Customer</>}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
