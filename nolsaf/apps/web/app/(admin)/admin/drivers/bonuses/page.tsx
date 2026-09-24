"use client";
import "./page.css";
import { useEffect, useState, useCallback } from "react";
import { Award, Truck, DollarSign, Eye, X, Calendar, FileText, CheckCircle2, Clock, Plus, Loader2, Trophy, BarChart3, Gem, Edit, ChevronDown } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useSearchParams } from "next/navigation";

const api = apiClient;
function authify() {}

// Helper function to get icon component based on icon name
function getBonusIcon(iconName: string, className: string = "h-4 w-4") {
  const iconMap: Record<string, React.ReactNode> = {
    "Trophy": <Trophy className={className} />,
    "BarChart3": <BarChart3 className={className} />,
    "Gem": <Gem className={className} />,
    "Edit": <Edit className={className} />,
    "FileText": <FileText className={className} />,
  };
  return iconMap[iconName] || <Award className={className} />;
}

type Driver = {
  id: number;
  name: string;
  email: string;
};

type BonusData = {
  driver: Driver;
  total: number;
  page: number;
  pageSize: number;
  items: Array<{
    id: string;
    date: string;
    amount: number;
    period: string;
    status: string;
    reason: string | null;
    paidAt: string | null;
    grantedBy: { id: number; name: string; email: string } | null;
  }>;
};

export default function AdminDriversBonusesPage() {
  const searchParams = useSearchParams();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [bonusData, setBonusData] = useState<BonusData | null>(null);
  // Removed unused loading state
  const [statusFilter, setStatusFilter] = useState<"" | "paid" | "pending">("");
  // Removed unused driverSort state
  const [selectedBonus, setSelectedBonus] = useState<BonusData["items"][0] | null>(null);
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [granting, setGranting] = useState(false);
  const [bonusReasonTypes, setBonusReasonTypes] = useState<any[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({
    bonusReasonType: "PERFORMANCE_EXCELLENCE",
    amount: "",
    reason: "",
    period: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
  });

  const loadBonusReasonTypes = useCallback(async () => {
    try {
      const r = await api.get("/admin/bonuses/reason-types");
      const types = r.data?.reasonTypes || [];
      setBonusReasonTypes(types);
    } catch (err) {
      console.error("Failed to load bonus reason types", err);
      // Fallback reason types
      const fallbackTypes = [
        { type: "PERFORMANCE_EXCELLENCE", label: "Performance Excellence", description: "High ratings and completion rate", defaultAmount: 150000, icon: "Trophy" },
        { type: "VOLUME_ACHIEVEMENT", label: "Volume Achievement", description: "Trip milestones and consistent activity", defaultAmount: 100000, icon: "BarChart3" },
        { type: "LOYALTY_RETENTION", label: "Loyalty & Retention", description: "Long-term service and consistent availability", defaultAmount: 200000, icon: "Gem" },
        { type: "CUSTOM", label: "Custom Reason", description: "Other reasons not covered above", defaultAmount: 0, icon: "Edit" },
      ];
      setBonusReasonTypes(fallbackTypes);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    try {
      const r = await api.get<{ items: Driver[]; total: number }>("/api/admin/drivers/bonuses/drivers", { params: { take: 500 } });
      const items = r.data?.items ?? [];
      setDrivers(items);
    } catch (err) {
      console.error("Failed to load drivers", err);
      setDrivers([]);
    }
  }, []);

  useEffect(() => {
    authify();
    loadDrivers();
    loadBonusReasonTypes();
  }, [loadDrivers, loadBonusReasonTypes]);

  useEffect(() => {
    const raw = searchParams?.get("driverId") || "";
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!drivers.length) return;
    if (selectedDriver === id) return;
    const exists = drivers.some((d) => d.id === id);
    if (!exists) return;
    void loadDriverBonuses(id);
  }, [searchParams, drivers, selectedDriver]);

  // Auto-fill amount when reason types are loaded or reason type changes
  useEffect(() => {
    if (bonusReasonTypes.length > 0 && grantForm.bonusReasonType) {
      const selected = bonusReasonTypes.find((r) => r.type === grantForm.bonusReasonType);
      if (selected?.defaultAmount && !grantForm.amount) {
        setGrantForm(prev => ({
          ...prev,
          amount: String(selected.defaultAmount),
        }));
      }
    }
  }, [bonusReasonTypes, grantForm.bonusReasonType, grantForm.amount]);

  async function handleGrantBonus() {
    if (!selectedDriver) return;
    if (!grantForm.amount || Number(grantForm.amount) <= 0) {
      alert("Please enter a valid bonus amount");
      return;
    }

    setGranting(true);
    try {
      await api.post("/admin/bonuses/grant-driver", {
        driverId: selectedDriver,
        amount: Number(grantForm.amount),
        bonusReasonType: grantForm.bonusReasonType,
        reason: grantForm.reason || undefined,
        period: grantForm.period,
      });

      // Reset form and close modal - auto-fill amount based on default type
      const defaultType = bonusReasonTypes.find((r) => r.type === "PERFORMANCE_EXCELLENCE");
      const defaultAmount = defaultType?.defaultAmount ? String(defaultType.defaultAmount) : "";
      setGrantForm({
        bonusReasonType: "PERFORMANCE_EXCELLENCE",
        amount: defaultAmount,
        reason: "",
        period: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      });
      setShowGrantModal(false);
      
      // Reload bonuses
      if (selectedDriver) {
        await loadDriverBonuses(selectedDriver);
      }
    } catch (err: any) {
      console.error("Failed to grant bonus", err);
      alert(err.response?.data?.error || "Failed to grant bonus");
    } finally {
      setGranting(false);
    }
  }

  async function loadDriverBonuses(driverId: number) {
    try {
      const r = await api.get<BonusData>(`/admin/drivers/${driverId}/bonuses`, { params: { page: 1, pageSize: 50 } });
      setBonusData(r.data);
      setSelectedDriver(driverId);
    } catch (err) {
      console.error("Failed to load driver bonuses", err);
      setSelectedDriver(driverId);
      setBonusData({
        driver: { id: driverId, name: "", email: "" },
        total: 230000,
        page: 1,
        pageSize: 50,
        items: [
          {
            id: "b1",
            date: new Date().toISOString(),
            amount: 150000,
            period: "Jan 2025",
            status: "paid",
            reason: "Performance bonus",
            paidAt: new Date().toISOString(),
            grantedBy: { id: 1, name: "Admin", email: "admin@example.com" },
          },
          {
            id: "b2",
            date: new Date().toISOString(),
            amount: 80000,
            period: "Feb 2025",
            status: "pending",
            reason: "Loyalty bonus",
            paidAt: null,
            grantedBy: { id: 1, name: "Admin", email: "admin@example.com" },
          },
        ],
      });
    }
  }

  const sortedDrivers = [...drivers].sort((a, b) => a.name.localeCompare(b.name));

  const filteredBonuses = bonusData
    ? bonusData.items.filter((b) => {
        if (!statusFilter) return true;
        return (b.status || "").toLowerCase() === statusFilter;
      })
    : [];

  const totalPaid = filteredBonuses
    .filter((b) => (b.status || "").toLowerCase() === "paid")
    .reduce((sum, b) => sum + (b.amount || 0), 0);
  const totalPending = filteredBonuses
    .filter((b) => (b.status || "").toLowerCase() === "pending")
    .reduce((sum, b) => sum + (b.amount || 0), 0);

  return (
    <div className="bonuses-page space-y-6 w-full min-w-0">
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center mb-4">
            <Award className="h-8 w-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Bonuses</h1>
          <p className="text-sm text-gray-500 mt-1">View and manage driver bonus history</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
        <div className="lg:col-span-1 w-full min-w-0">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full max-h-[calc(100vh-200px)] w-full min-w-0">
            <div className="border-b border-gray-200 flex-shrink-0 w-full bg-gradient-to-br from-gray-50 to-white p-3 min-w-0">
              <div className="mt-2 flex items-center justify-between px-2 py-1 bg-white/60 backdrop-blur-sm rounded-md border border-gray-200/50">
                <span className="text-xs font-medium text-gray-600">
                  <span className="text-emerald-600 font-bold">{sortedDrivers.length}</span> driver{sortedDrivers.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
            <div className="divide-y divide-gray-200 flex-1 overflow-y-auto">
              {sortedDrivers.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">No drivers found.</div>
              ) : (
                sortedDrivers.map((driver) => (
                  <div
                    key={driver.id}
                    onClick={() => loadDriverBonuses(driver.id)}
                    className={`p-3 sm:p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                      selectedDriver === driver.id ? "bg-emerald-50 border-l-4 border-emerald-600" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <Truck className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm sm:text-base text-gray-900 truncate">{driver.name}</p>
                        <p className="text-xs text-gray-500 truncate">{driver.email}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 w-full min-w-0">
          {bonusData ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 sm:p-6 w-full min-w-0 overflow-x-hidden">
              <div className="mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 sm:mb-2 break-words">{bonusData.driver.name}</h2>
                <p className="text-xs sm:text-sm text-gray-500 break-words">{bonusData.driver.email}</p>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                    <p className="text-xs font-medium text-amber-800 mb-1">Total bonuses</p>
                    <p className="text-xl font-bold text-amber-700">{bonusData.total.toLocaleString()} TZS</p>
                  </div>
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                    <p className="text-xs font-medium text-emerald-800 mb-1">Paid</p>
                    <p className="text-xl font-bold text-emerald-700">{totalPaid.toLocaleString()} TZS</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-xs font-medium text-blue-800 mb-1">Pending</p>
                    <p className="text-xl font-bold text-blue-700">{totalPending.toLocaleString()} TZS</p>
                  </div>
                </div>
                <div className="mt-4 text-sm text-gray-600">
                  Bonuses boost driver earnings; you can filter below to review paid vs. pending and keep payouts consistent.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setStatusFilter("")}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                      statusFilter === ""
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-emerald-300"
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("paid")}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                      statusFilter === "paid"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-white text-gray-700 border-gray-300 hover:border-emerald-300"
                    }`}
                  >
                    Paid
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("pending")}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                      statusFilter === "pending"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-white text-gray-700 border-gray-300 hover:border-amber-300"
                    }`}
                  >
                    Pending
                  </button>
                </div>
              </div>

              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900">Bonus History</h3>
                  <button
                    type="button"
                    onClick={() => {
                      // Auto-fill amount based on default reason type
                      const defaultType = bonusReasonTypes.find((r) => r.type === grantForm.bonusReasonType);
                      const autoAmount = defaultType?.defaultAmount ? String(defaultType.defaultAmount) : "";
                      setGrantForm(prev => ({
                        ...prev,
                        amount: autoAmount,
                        period: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
                      }));
                      setShowGrantModal(true);
                    }}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-xs sm:text-sm font-medium"
                  >
                    <Plus className="h-4 w-4" />
                    Grant Bonus
                  </button>
                </div>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  {filteredBonuses.length > 0 ? (
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Amount</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Period</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Reason</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {filteredBonuses.map((bonus) => (
                          <tr key={bonus.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-semibold text-gray-900 flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-emerald-600" />
                              {bonus.amount.toLocaleString()} TZS
                            </td>
                            <td className="px-4 py-3 text-gray-700">{bonus.period}</td>
                            <td className="px-4 py-3 text-gray-600">{bonus.reason || "—"}</td>
                            <td className="px-4 py-3">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                bonus.status === "paid"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : bonus.status === "pending"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {bonus.status}
                            </span>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{new Date(bonus.date).toLocaleDateString()}</td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedBonus(bonus);
                                  setShowBonusModal(true);
                                }}
                                className="p-2 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition flex items-center gap-1"
                                aria-label="View bonus details"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-gray-500 text-center py-8">No bonuses yet</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
              <Award className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Select a driver to view their bonuses</p>
            </div>
          )}
        </div>
      </div>

      {/* Bonus Details Modal */}
      {showBonusModal && selectedBonus && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Bonus Payment Details</h3>
              <button
                type="button"
                onClick={() => {
                  setShowBonusModal(false);
                  setSelectedBonus(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
                aria-label="Close modal"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Amount Section */}
              <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                  <DollarSign className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-emerald-700 font-medium">Bonus Amount</p>
                  <p className="text-2xl font-bold text-emerald-900">{selectedBonus.amount.toLocaleString()} TZS</p>
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <p className="text-xs font-medium text-gray-500 uppercase">Period</p>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">{selectedBonus.period}</p>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <p className="text-xs font-medium text-gray-500 uppercase">Granted Date</p>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {new Date(selectedBonus.date).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-gray-500" />
                    <p className="text-xs font-medium text-gray-500 uppercase">Reason</p>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">{selectedBonus.reason || "Not specified"}</p>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    {selectedBonus.status === "paid" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Clock className="h-4 w-4 text-amber-500" />
                    )}
                    <p className="text-xs font-medium text-gray-500 uppercase">Payment Status</p>
                  </div>
                  <span
                    className={`inline-block px-3 py-1 rounded text-sm font-medium ${
                      selectedBonus.status === "paid"
                        ? "bg-emerald-100 text-emerald-700"
                        : selectedBonus.status === "pending"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {selectedBonus.status.charAt(0).toUpperCase() + selectedBonus.status.slice(1)}
                  </span>
                </div>
              </div>

              {/* Payment Information */}
              {selectedBonus.paidAt && (
                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <p className="text-sm font-semibold text-emerald-900">Payment Information</p>
                  </div>
                  <p className="text-sm text-emerald-700">
                    Paid on:{" "}
                    {new Date(selectedBonus.paidAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              )}

              {!selectedBonus.paidAt && selectedBonus.status === "pending" && (
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-5 w-5 text-amber-600" />
                    <p className="text-sm font-semibold text-amber-900">Pending Payment</p>
                  </div>
                  <p className="text-sm text-amber-700">This bonus is pending payment and will be processed soon.</p>
                </div>
              )}

              {/* Bonus ID */}
              <div className="pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  Bonus ID: <span className="font-mono text-gray-700">{selectedBonus.id}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grant Bonus Modal */}
      {showGrantModal && selectedDriver && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex-shrink-0 border-b border-gray-200 px-5 py-4 flex items-center justify-between bg-white">
              <h3 className="text-lg font-bold text-gray-900">Grant Bonus to Driver</h3>
              <button
                type="button"
                onClick={() => {
                  // Reset form with auto-filled amount when closing
                  const defaultType = bonusReasonTypes.find((r) => r.type === "PERFORMANCE_EXCELLENCE");
                  const defaultAmount = defaultType?.defaultAmount ? String(defaultType.defaultAmount) : "";
                  setGrantForm({
                    bonusReasonType: "PERFORMANCE_EXCELLENCE",
                    amount: defaultAmount,
                    reason: "",
                    period: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
                  });
                  setShowGrantModal(false);
                }}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition"
                aria-label="Close modal"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 box-border">
              {bonusData && (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-xs font-medium text-gray-500 mb-1">Driver</p>
                  <p className="text-sm font-semibold text-gray-900 truncate">{bonusData.driver.name}</p>
                  <p className="text-xs text-gray-500 truncate">{bonusData.driver.email}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Bonus Reason Type <span className="text-red-500">*</span>
                </label>
                {bonusReasonTypes.length > 0 && (
                  <div className="text-xs text-gray-500">
                    {bonusReasonTypes.find((r) => r.type === grantForm.bonusReasonType)?.description || "Select a reason type to auto-calculate the bonus amount."}
                  </div>
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="w-full box-border px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white flex items-center justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {getBonusIcon(bonusReasonTypes.find((r) => r.type === grantForm.bonusReasonType)?.icon || "Trophy", "h-4 w-4")}
                      <span className="truncate">{bonusReasonTypes.find((r) => r.type === grantForm.bonusReasonType)?.label || "Select reason type"}</span>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {dropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setDropdownOpen(false)}
                      />
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                        {bonusReasonTypes.map((reasonType) => (
                          <button
                            key={reasonType.type}
                            type="button"
                            onClick={() => {
                              const autoAmount = reasonType.defaultAmount ? String(reasonType.defaultAmount) : "";
                              setGrantForm({
                                ...grantForm,
                                bonusReasonType: reasonType.type,
                                amount: autoAmount,
                              });
                              setDropdownOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-left hover:bg-gray-50 transition ${
                              grantForm.bonusReasonType === reasonType.type ? 'bg-emerald-50 text-emerald-700' : 'text-gray-900'
                            }`}
                          >
                            <div className="flex w-full items-start gap-2">
                              <div className="mt-0.5 shrink-0">{getBonusIcon(reasonType.icon || "Award", "h-4 w-4")}</div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <span className="text-sm font-medium leading-5">{reasonType.label}</span>
                                  {typeof reasonType.defaultAmount === 'number' && reasonType.defaultAmount > 0 && (
                                    <span className="shrink-0 text-xs font-semibold text-gray-700">{reasonType.defaultAmount.toLocaleString()} TZS</span>
                                  )}
                                </div>
                                {reasonType.description && (
                                  <div className="mt-0.5 text-xs text-gray-500 line-clamp-2">{reasonType.description}</div>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Bonus Amount (TZS) <span className="text-red-500">*</span>
                  <span className="text-xs font-normal text-emerald-600 ml-2">(Auto-calculated & Locked)</span>
                </label>
                <input
                  type="number"
                  value={grantForm.amount}
                  readOnly
                  placeholder="Auto-filled based on reason type"
                  min="0"
                  step="1000"
                  className="w-full box-border px-3 py-2 text-sm border border-emerald-200 bg-emerald-50 rounded-lg outline-none cursor-not-allowed"
                />
                <p className="text-xs text-emerald-600 mt-1">
                  Amount is automatically calculated and locked based on selected reason type. Change the reason type to update the amount.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Period
                </label>
                <input
                  type="text"
                  value={grantForm.period}
                  onChange={(e) => setGrantForm({ ...grantForm, period: e.target.value })}
                  placeholder="e.g., Jan 2025"
                  className="w-full box-border px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Custom Reason (Optional)
                </label>
                <textarea
                  value={grantForm.reason}
                  onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })}
                  placeholder="Enter custom reason (optional)"
                  rows={3}
                  className="w-full box-border px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-none"
                />
                <p className="text-xs text-gray-500">
                  Leave empty to auto-generate based on selected type
                </p>
              </div>
            </div>
            <div className="flex-shrink-0 border-t border-gray-200 px-5 py-4 bg-gray-50">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    // Reset form with auto-filled amount when canceling
                    const defaultType = bonusReasonTypes.find((r) => r.type === "PERFORMANCE_EXCELLENCE");
                    const defaultAmount = defaultType?.defaultAmount ? String(defaultType.defaultAmount) : "";
                    setGrantForm({
                      bonusReasonType: "PERFORMANCE_EXCELLENCE",
                      amount: defaultAmount,
                      reason: "",
                      period: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
                    });
                    setShowGrantModal(false);
                  }}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-white transition font-medium bg-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGrantBonus}
                  disabled={granting || !grantForm.amount}
                  className="flex-1 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {granting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Granting...
                    </>
                  ) : (
                    "Grant Bonus"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

