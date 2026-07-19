"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import Image from "next/image";
import PropertyPreview from "@/components/PropertyPreview";
import {
  Hourglass,
  AlertCircle,
  Ban,
  MapPin,
  ImageIcon,
  Eye,
  Bell,
  PenLine,
  ArrowRight,
  CheckCircle,
  Circle,
  Clock,
  Trash2,
  BookOpen,
  Shield as ShieldIcon,
  Star,
  Camera,
  MessageSquare,
  TrendingUp,
  FileCheck,
} from "lucide-react";

const api = apiClient;

function fmtMoney(amount: number | null | undefined, currency?: string | null) {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  const cur = currency || "TZS";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    return `${cur} ${Number(amount).toLocaleString()}`;
  }
}

function getRejectionReasons(property: any): string[] {
  if (!property.rejectionReasons) return [];
  try {
    if (typeof property.rejectionReasons === "string") {
      const parsed = JSON.parse(property.rejectionReasons);
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    return Array.isArray(property.rejectionReasons) ? property.rejectionReasons : [];
  } catch {
    return [];
  }
}

/**
 * Infers which of 4 listing sections the owner has completed.
 * Returns stepsCompleted[4] and the index of the next incomplete step.
 */
function getDraftProgress(p: any): { stepsCompleted: boolean[]; nextStep: number } {
  const hasBasics = !!(p.title && p.latitude && p.longitude);
  const hasRooms = !!(
    (Array.isArray(p.rooms) && p.rooms.length > 0) ||
    (Array.isArray(p.roomsSpec) && p.roomsSpec.length > 0) ||
    p.basePrice != null
  );
  const hasAmenities = !!(Array.isArray(p.services) && p.services.length > 0);
  const hasPhotos = !!(Array.isArray(p.photos) && p.photos.length > 0);
  const stepsCompleted = [hasBasics, hasRooms, hasAmenities, hasPhotos];
  const nextStep = stepsCompleted.findIndex((c) => !c);
  return { stepsCompleted, nextStep: nextStep === -1 ? 4 : nextStep };
}

function PropertyImage({ src }: { src: string | null }) {
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        fill
        sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="object-cover group-hover:scale-105 transition-transform duration-200"
      />
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
      <ImageIcon className="w-8 h-8 text-slate-400" />
    </div>
  );
}

function LocationRow({ p }: { p: any }) {
  const parts = [p.city, p.ward, p.district, p.regionName].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-600">
      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{parts.join(", ")}</span>
    </div>
  );
}

function SectionHeader({ title, icon: Icon, accent = "teal" }: { title: string; icon?: any; accent?: "teal" | "amber" | "red" }) {
  const colors = {
    teal: "from-[#02665e] to-emerald-600 text-white",
    amber: "from-amber-500 to-orange-500 text-white",
    red: "from-red-500 to-rose-600 text-white",
  };
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
      <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r ${colors[accent]} text-[11px] font-bold uppercase tracking-widest shadow-sm`}>
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {title}
      </div>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
    </div>
  );
}

// ── DRAFT CARD ──────────────────────────────────────────────────────────────────────
function DraftCard({ p, onPreview, onDeleted }: { p: any; onPreview: (id: number) => void; onDeleted: (id: number) => void }) {
  const router = useRouter();
  const { stepsCompleted, nextStep } = getDraftProgress(p);
  const primaryImage = Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null;
  const stepLabels = ["Basics", "Rooms", "Amenities", "Photos"];
  const totalDone = stepsCompleted.filter(Boolean).length;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/owner/properties/${p.id}`);
      onDeleted(p.id);
    } catch (err: any) {
      setDeleteError(err?.response?.data?.error || "Failed to delete. Try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="group bg-white rounded-2xl border-2 border-dashed border-slate-300 shadow-sm hover:shadow-md hover:border-slate-400 transition-all duration-200">
      <div className="px-4 pt-4 flex items-start justify-between gap-2">
        <div className="text-base font-bold text-slate-900 truncate">{p.title || "Untitled Draft"}</div>
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete draft"
            title="Delete draft"
            className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="px-4 mt-3">
        <div className="relative aspect-square bg-slate-100 rounded-2xl overflow-hidden">
          <PropertyImage src={primaryImage} />
          <div className="absolute bottom-2 left-2">
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-slate-800/80 text-white backdrop-blur-sm">
              <PenLine className="w-3 h-3 mr-1" />
              Draft
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <LocationRow p={p} />
        {p.type && (
          <span className="text-xs font-medium text-slate-500 uppercase">{p.type}</span>
        )}

        {/* Step progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Progress</span>
            <span className="text-xs text-slate-500">{totalDone} of 4 sections</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {stepLabels.map((label, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                {stepsCompleted[i] ? (
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Circle
                    className={`w-4 h-4 ${i === nextStep ? "text-amber-500" : "text-slate-300"}`}
                  />
                )}
                <span
                  className={`text-[10px] text-center leading-tight ${
                    stepsCompleted[i]
                      ? "text-emerald-700 font-medium"
                      : i === nextStep
                      ? "text-amber-700 font-medium"
                      : "text-slate-400"
                  }`}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
          <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-300"
              style={{ width: `${(totalDone / 4) * 100}%` }}
            />
          </div>
        </div>

        {/* Primary CTA: Continue editing */}
        <button
          onClick={() => router.push(`/owner/properties/add?id=${p.id}`)}
          className="inline-flex items-center justify-center gap-2 w-full rounded-xl bg-[#02665e] text-white py-2.5 text-sm font-semibold transition-colors hover:bg-[#014e47]"
        >
          <PenLine className="h-4 w-4" />
          <span>Continue editing</span>
          <ArrowRight className="h-4 w-4 ml-auto" />
        </button>

        {/* Secondary: preview (only if has at least a title) */}
        {p.title && (
          <button
            onClick={() => onPreview(p.id)}
            className="inline-flex items-center justify-center gap-2 w-full rounded-xl border border-slate-200 bg-white text-slate-700 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
          >
            <Eye className="h-4 w-4" />
            <span>Preview draft</span>
          </button>
        )}

        {/* Delete confirmation inline */}
        {confirmingDelete && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
            <p className="text-sm font-semibold text-red-700">Delete this draft?</p>
            <p className="text-xs text-red-600">This cannot be undone.</p>
            {deleteError && <p className="text-xs text-red-700 font-medium">{deleteError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 text-white py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {deleting ? (
                  <span className="dot-spinner dot-sm" aria-hidden>
                    <span className="dot dot-blue" />
                    <span className="dot dot-black" />
                    <span className="dot dot-yellow" />
                    <span className="dot dot-green" />
                  </span>
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete
              </button>
              <button
                type="button"
                onClick={() => { setConfirmingDelete(false); setDeleteError(null); }}
                disabled={deleting}
                className="flex-1 rounded-lg border border-slate-200 bg-white text-slate-700 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PENDING CARD ────────────────────────────────────────────────────────────────────
function PendingCard({ p, onPreview }: { p: any; onPreview: (id: number) => void }) {
  const primaryImage = Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null;
  return (
    <div className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
      <div className="px-4 pt-4">
        <div className="text-base font-bold text-slate-900 truncate">{p.title || "Untitled Property"}</div>
      </div>

      <div className="px-4 mt-3">
        <div className="relative aspect-square bg-slate-100 rounded-2xl overflow-hidden">
          <PropertyImage src={primaryImage} />
          <div className="absolute bottom-2 left-2">
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
              <Hourglass className="w-3 h-3 mr-1" />
              Under Review
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <LocationRow p={p} />
        {p.type && (
          <span className="text-xs font-medium text-slate-500 uppercase">{p.type}</span>
        )}
        {(() => {
          const bp = Number(p.basePrice) || 0;
          const roomPrices = Array.isArray(p.roomsSpec) ? p.roomsSpec.map((r: any) => Number(r.pricePerNight) || 0).filter((v: number) => v > 0) : [];
          const price = bp > 0 ? bp : (roomPrices.length > 0 ? Math.min(...roomPrices) : 0);
          const isFrom = bp <= 0 && roomPrices.length > 0;
          if (price <= 0) return null;
          return (
            <div className="flex items-baseline gap-1">
              {isFrom && <div className="text-[11px] text-slate-500">from</div>}
              <div className="text-sm font-bold text-[#02665e]">{fmtMoney(price, p.currency)}</div>
              <div className="text-[11px] text-slate-500">per night</div>
            </div>
          );
        })()}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2">
          <Clock className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-snug">
            Submitted for review. Our team will check your listing shortly. You will be notified once approved.
          </p>
        </div>
        <button
          onClick={() => onPreview(p.id)}
          className="inline-flex items-center justify-center gap-2 w-full rounded-xl bg-[#02665e] text-white py-2.5 text-sm font-semibold transition-colors hover:bg-[#014e47]"
        >
          <Eye className="h-4 w-4" />
          <span>View Submission</span>
        </button>
      </div>
    </div>
  );
}

// ── ACTION REQUIRED CARD (suspended / pending-with-fixes) ─────
function ActionRequiredCard({ p, onPreview }: { p: any; onPreview: (id: number) => void }) {
  const router = useRouter();
  const isSuspended = p.status === "SUSPENDED";
  const primaryImage = Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null;
  const rejectionReasons = getRejectionReasons(p);
  const suspensionReason: string | null = p.suspensionReason ?? null;
  const suspensionReference: string | null = p.suspensionReference ?? null;

  return (
    <div className="space-y-3">
      <div className="group bg-white rounded-2xl border border-red-200 shadow-sm hover:shadow-md transition-all duration-200">
        <div className="px-4 pt-4">
          <div className="text-base font-bold text-slate-900 truncate">{p.title || "Untitled Property"}</div>
        </div>

        <div className="px-4 mt-3">
          <div className="relative aspect-square bg-slate-100 rounded-2xl overflow-hidden">
            <PropertyImage src={primaryImage} />
            <div className="absolute bottom-2 left-2">
              {isSuspended ? (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
                  <Ban className="w-3 h-3 mr-1" />
                  Suspended
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-200">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Fixes Required
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <LocationRow p={p} />
          {p.type && (
            <span className="text-xs font-medium text-slate-500 uppercase">{p.type}</span>
          )}
          {(() => {
            const bp = Number(p.basePrice) || 0;
            const roomPrices = Array.isArray(p.roomsSpec) ? p.roomsSpec.map((r: any) => Number(r.pricePerNight) || 0).filter((v: number) => v > 0) : [];
            const price = bp > 0 ? bp : (roomPrices.length > 0 ? Math.min(...roomPrices) : 0);
            const isFrom = bp <= 0 && roomPrices.length > 0;
            if (price <= 0) return null;
            return (
              <div className="flex items-baseline gap-1">
                {isFrom && <div className="text-[11px] text-slate-500">from</div>}
                <div className="text-sm font-bold text-[#02665e]">{fmtMoney(price, p.currency)}</div>
                <div className="text-[11px] text-slate-500">per night</div>
              </div>
            );
          })()}

          {/* Rejection / fix reasons */}
          {rejectionReasons.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                <span className="text-xs font-semibold text-red-800">Fixes Required</span>
              </div>
              <div className="space-y-1">
                {rejectionReasons.map((reason: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-1.5 text-xs text-red-700">
                    <span className="text-red-500 mt-0.5">•</span>
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Primary CTA: Edit & Fix / Resubmit */}
          <button
            onClick={() => router.push(`/owner/properties/add?id=${p.id}`)}
            className="inline-flex items-center justify-center gap-2 w-full rounded-xl bg-red-600 text-white py-2.5 text-sm font-semibold transition-colors hover:bg-red-700"
          >
            <PenLine className="h-4 w-4" />
            <span>Edit &amp; {isSuspended ? "Resubmit" : "Fix"}</span>
            <ArrowRight className="h-4 w-4 ml-auto" />
          </button>

          <button
            onClick={() => onPreview(p.id)}
            className="inline-flex items-center justify-center gap-2 w-full rounded-xl border border-slate-200 bg-white text-slate-700 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
          >
            <Eye className="h-4 w-4" />
            <span>View Preview</span>
          </button>
        </div>
      </div>

      {/* Suspension notice below card (always shown for SUSPENDED) */}
      {isSuspended && (
        <div className="bg-gradient-to-br from-orange-50 via-amber-50 to-orange-50 border border-orange-200/60 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Bell className="w-[18px] h-[18px] text-orange-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-orange-900 tracking-wide uppercase">Suspension Notice</span>
                <div className="h-px flex-1 bg-gradient-to-r from-orange-300/50 to-transparent" />
              </div>
              <p className="text-sm text-orange-800/90 leading-relaxed whitespace-pre-wrap font-medium">
                {suspensionReason ||
                  "This property has been temporarily suspended and removed from public view. Please check your notifications for details and steps to resolve it."}
              </p>
              {suspensionReference && (
                <div className="mt-3 rounded-lg border border-orange-200 bg-white/75 px-3 py-2">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-orange-600">Appeal reference</p>
                  <p className="mb-0 mt-1 break-all font-mono text-sm font-bold text-orange-950">{suspensionReference}</p>
                  <a
                    href={`mailto:partnerships@nolsaf.com?subject=${encodeURIComponent(`Property appeal ${suspensionReference}`)}`}
                    className="mt-1.5 inline-flex text-xs font-bold text-[#02665e] underline underline-offset-2"
                  >
                    Appeal to partnerships
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PAGE ──
export default function PendingProps() {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [suspended, setSuspended] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [minWaitElapsed, setMinWaitElapsed] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [selectedPendingProperty, setSelectedPendingProperty] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => setMinWaitElapsed(true), 5000);

    Promise.all([
      api.get("/api/owner/properties/mine", { params: { status: "DRAFT", pageSize: 50 } }),
      api.get("/api/owner/properties/mine", { params: { status: "PENDING", pageSize: 50 } }),
      api.get("/api/owner/properties/mine", { params: { status: "SUSPENDED", pageSize: 50 } }),
    ])
      .then(([draftRes, pendingRes, suspendedRes]) => {
        if (!mounted) return;
        setDrafts((draftRes.data as any)?.items ?? []);
        setPending((pendingRes.data as any)?.items ?? []);
        setSuspended((suspendedRes.data as any)?.items ?? []);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(
          err?.response?.data?.error ||
            err?.response?.data?.message ||
            err?.message ||
            "Failed to load properties",
        );
        setDrafts([]);
        setPending([]);
        setSuspended([]);
      })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; clearTimeout(timer); };
  }, []);

  function handleUpdated() {
    Promise.all([
      api.get("/api/owner/properties/mine", { params: { status: "DRAFT", pageSize: 50 } }),
      api.get("/api/owner/properties/mine", { params: { status: "PENDING", pageSize: 50 } }),
      api.get("/api/owner/properties/mine", { params: { status: "SUSPENDED", pageSize: 50 } }),
    ])
      .then(([draftRes, pendingRes, suspendedRes]) => {
        setDrafts((draftRes.data as any)?.items ?? []);
        setPending((pendingRes.data as any)?.items ?? []);
        setSuspended((suspendedRes.data as any)?.items ?? []);
      })
      .catch(() => {});
  }

  // ── Loading
  if (loading && !minWaitElapsed) {
    return (
      <div className="min-h-[320px] flex flex-col items-center justify-center text-center">
        <div className="mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-[#02665e] to-emerald-600 flex items-center justify-center shadow-lg">
          <span aria-hidden className="dot-spinner" aria-live="polite">
            <span className="dot dot-blue" />
            <span className="dot dot-black" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">My Listings</h1>
        <div className="text-sm text-slate-500 mt-1">Loading your properties…</div>
      </div>
    );
  }

  // ── Error
  if (error) {
    return (
      <div className="min-h-[260px] flex flex-col items-center justify-center text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-2" />
        <h1 className="text-2xl font-semibold">Error Loading Properties</h1>
        <div className="text-sm text-red-600 mt-2">{error}</div>
        <button
          onClick={() => { setError(null); setLoading(true); window.location.reload(); }}
          className="mt-4 px-4 py-2 bg-[#02665e] text-white rounded-lg hover:bg-[#014e47] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Split pending into clean vs needs-fixes
  const pendingClean = pending.filter((p) => getRejectionReasons(p).length === 0);
  const pendingNeedsFixes = pending.filter((p) => getRejectionReasons(p).length > 0);
  const allNeedsAttention = [...pendingNeedsFixes, ...suspended];
  const total = drafts.length + pending.length + suspended.length;

  // ── Empty
  if (total === 0) {
    return (
      <div className="min-h-[320px] flex flex-col items-center justify-center text-center">
        <div className="mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-[#02665e] to-emerald-600 flex items-center justify-center shadow-lg">
          <Hourglass className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">My Listings</h1>
        <p className="text-sm text-slate-500 mt-1">No drafts, pending reviews, or suspended properties right now.</p>
      </div>
    );
  }

  // ── Pending property instructions view
  if (selectedPendingProperty) {
    const sp = selectedPendingProperty;
    const primaryImg = Array.isArray(sp.photos) && sp.photos.length > 0 ? sp.photos[0] : null;
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-8">
        {/* Header card */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#02665e] via-[#037a70] to-emerald-600 shadow-lg">
          <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative px-6 py-6">
            <div className="flex items-start gap-4">
              {primaryImg ? (
                <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-white/30 shadow-md">
                  <Image src={primaryImg} alt="" fill className="object-cover" sizes="64px" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  <ImageIcon className="w-6 h-6 text-white/70" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-bold text-white truncate">{sp.title || "Your Property"}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/20 text-amber-200 border border-amber-400/30">
                    <Hourglass className="w-2.5 h-2.5" />
                    UNDER REVIEW
                  </span>
                  {sp.type && <span className="text-xs text-white/60">{sp.type}</span>}
                </div>
                {sp.lastSubmittedAt && (
                  <p className="text-xs text-white/50 mt-1">
                    Submitted {new Date(sp.lastSubmittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Review status card */}
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Review In Progress</h2>
              <p className="text-sm text-slate-500">Typically takes 3–5 business days</p>
            </div>
          </div>
          <div className="px-5 py-5 space-y-3">
            <div className="flex items-start gap-3">
              <FileCheck className="w-5 h-5 text-[#02665e] mt-0.5 flex-shrink-0" />
              <p className="text-sm text-slate-700 leading-relaxed">Our team is verifying your property details, photos, and pricing to ensure they meet our quality standards.</p>
            </div>
            <div className="flex items-start gap-3">
              <Bell className="w-5 h-5 text-[#02665e] mt-0.5 flex-shrink-0" />
              <p className="text-sm text-slate-700 leading-relaxed">You will receive an email and in-app notification once the review is complete, whether approved or if changes are needed.</p>
            </div>
          </div>
        </div>

        {/* Prepare for Approval */}
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-[#02665e]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Prepare While You Wait</h2>
              <p className="text-sm text-slate-500">Get ready for your first guests</p>
            </div>
          </div>
          <div className="px-5 py-5 space-y-4">
            {[
              { icon: Camera, title: "Add more high-quality photos", desc: "Properties with 10+ clear photos of rooms, bathrooms, views, and surroundings receive up to 40% more bookings." },
              { icon: Star, title: "Set competitive pricing", desc: "Research similar properties in your area. Competitive starting rates help attract your first guests and build reviews." },
              { icon: MessageSquare, title: "Prepare a welcome message", desc: "A personal greeting for guests creates a great first impression and leads to better reviews." },
              { icon: ShieldIcon, title: "Review your house rules", desc: "Clear and fair house rules help set guest expectations and prevent misunderstandings during their stay." },
            ].map(({ icon: Icon, title, desc }, i) => (
              <div key={i} className="flex items-start gap-3.5 p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="h-9 w-9 rounded-lg bg-[#02665e]/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-[#02665e]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">{title}</p>
                  <p className="text-sm text-slate-500 leading-relaxed mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Once Approved */}
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Once Approved</h2>
              <p className="text-sm text-slate-500">What happens next</p>
            </div>
          </div>
          <div className="px-5 py-5 space-y-3">
            {[
              "Your property will appear in public search results and be available for booking by guests.",
              "Guests can browse your listing, photos, amenities, room types, and pricing details.",
              "You will receive booking requests via email and in-app notifications.",
              "You can update photos, pricing, and room availability anytime from your owner dashboard.",
              "Maintain a high response rate and quality standards to rank higher in search results.",
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-slate-700 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Disbursement & Payment Policy */}
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-blue-700" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Disbursement & Payment Policy</h2>
              <p className="text-sm text-slate-500">How you get paid</p>
            </div>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
              <h3 className="text-sm font-bold text-blue-900 mb-2">Payment Flow</h3>
              <p className="text-sm text-blue-800 leading-relaxed">All guest payments are collected by NoLSAF first. Your earnings are then disbursed to you after the booking is confirmed and the guest checks in with a valid booking code.</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-lg">💰</span>
                <div>
                  <p className="text-sm font-bold text-slate-800">Your Earnings</p>
                  <p className="text-sm text-slate-600 leading-relaxed">You receive your full base price. The platform commission is added on top of your price and paid by the guest. It does not reduce your earnings.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-lg">⏱️</span>
                <div>
                  <p className="text-sm font-bold text-slate-800">Payout Timing</p>
                  <p className="text-sm text-slate-600 leading-relaxed">Payouts are processed on a flexible on-demand basis. Once eligible, you can claim your payout anytime. Processing takes 30 minutes to 24 hours for mobile money, or 1–5 business days for bank transfers.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-lg">🎁</span>
                <div>
                  <p className="text-sm font-bold text-slate-800">Discounts & Bonuses</p>
                  <p className="text-sm text-slate-600 leading-relaxed">Any promotional discounts offered to guests are absorbed by NoLSAF — your base price remains unaffected. Bonuses may also be provided at NoLSAF&apos;s discretion.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-lg">🔄</span>
                <div>
                  <p className="text-sm font-bold text-slate-800">Cancellation & Refunds</p>
                  <p className="text-sm text-slate-600 leading-relaxed">If a guest cancels during the free cancellation period, the full amount is refunded. For cancellations 4+ days before check-in, you retain 50%. Non-refundable bookings and no-shows: you keep 100%.</p>
                </div>
              </div>
            </div>
            <a
              href="/owner/property-owner-disbursement-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-[#02665e] to-emerald-600 no-underline hover:from-[#025550] hover:to-emerald-700 transition-all shadow-md hover:shadow-lg group mt-2"
            >
              <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0 group-hover:bg-white/30 transition">
                <FileCheck className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">Read the Full Disbursement Policy</p>
                <p className="text-xs text-white/70">Understand your earnings, payouts, and refund obligations</p>
              </div>
              <ArrowRight className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </a>
          </div>
        </div>

        {/* Platform Guidelines */}
        <div className="rounded-2xl bg-gradient-to-br from-[#02665e] to-emerald-600 shadow-lg overflow-hidden">
          <div className="px-6 py-5">
            <div className="flex items-center gap-3 mb-4">
              <ShieldIcon className="w-5 h-5 text-white/90" />
              <h2 className="text-base font-bold text-white">Platform Guidelines</h2>
            </div>
            <div className="space-y-3">
              {[
                "Ensure your payout details (bank account or mobile money) are set up correctly in your profile before your first booking.",
                "Keep your calendar and room availability up to date to avoid double bookings and cancellations.",
                "Respond to booking requests within 24 hours. Slow responses may lower your listing visibility.",
                "Maintain accurate property descriptions. Misrepresentation may lead to suspension.",
                "Review the full Disbursement Policy to understand your payout schedule, commission structure, and refund obligations.",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/50 mt-2 flex-shrink-0" />
                  <p className="text-sm text-white/85 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom back button */}
        <button
          onClick={() => setSelectedPendingProperty(null)}
          className="w-full h-12 rounded-xl bg-[#02665e] text-sm font-bold text-white hover:bg-[#025550] transition shadow-sm"
        >
          Back to My Listings
        </button>
      </div>
    );
  }

  // ── Preview modal (drafts / action-required)
  if (selectedPropertyId) {
    return (
      <PropertyPreview
        propertyId={selectedPropertyId}
        mode="owner"
        onUpdated={handleUpdated}
      />
    );
  }

  const summaryParts = [
    drafts.length > 0 && `${drafts.length} draft${drafts.length > 1 ? "s" : ""}`,
    pendingClean.length > 0 && `${pendingClean.length} under review`,
    allNeedsAttention.length > 0 && `${allNeedsAttention.length} needing attention`,
  ].filter(Boolean) as string[];

  // ── Main
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#02665e] via-[#037a70] to-emerald-600 px-6 py-6 shadow-lg">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-20 h-20 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Hourglass className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">My Listings</h1>
            {summaryParts.length > 0 && (
              <p className="text-sm text-white/70 mt-0.5">{summaryParts.join(" · ")}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Incomplete Drafts */}
      {drafts.length > 0 && (
        <section>
          <SectionHeader title="Incomplete Drafts" icon={PenLine} accent="amber" />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {drafts.map((p) => (
              <DraftCard
                key={p.id}
                p={p}
                onPreview={setSelectedPropertyId}
                onDeleted={(id) => setDrafts((prev) => prev.filter((d) => d.id !== id))}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Submitted — Under Review */}
      {pendingClean.length > 0 && (
        <section>
          <SectionHeader title="Under Review" icon={Clock} accent="teal" />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {pendingClean.map((p) => (
              <PendingCard key={p.id} p={p} onPreview={(id) => {
                const prop = pendingClean.find(x => x.id === id);
                if (prop) setSelectedPendingProperty(prop);
                else setSelectedPropertyId(id);
              }} />
            ))}
          </div>
        </section>
      )}

      {/* ── Needs Attention */}
      {allNeedsAttention.length > 0 && (
        <section>
          <SectionHeader title="Needs Attention" icon={AlertCircle} accent="red" />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {allNeedsAttention.map((p) => (
              <ActionRequiredCard key={p.id} p={p} onPreview={setSelectedPropertyId} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
