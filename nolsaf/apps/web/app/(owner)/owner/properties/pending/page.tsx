"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { ownerPropertyPath } from "@/lib/ownerPropertyRefs";
import Image from "next/image";
import Link from "next/link";
import OwnerPropertyView from "@/components/owner-property/OwnerPropertyView";
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
  Star,
  Camera,
  MessageSquare,
  TrendingUp,
  FileCheck,
  Plus,
  RefreshCw,
  Building2,
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

function SectionHeader({ title, hint, count, icon: Icon, accent = "teal" }: { title: string; hint?: string; count?: number; icon?: any; accent?: "teal" | "amber" | "red" }) {
  const tone = {
    teal: "bg-emerald-50 text-[#02665e]",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
  }[accent];
  return (
    <div className="flex items-center gap-3">
      {Icon && <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span>}
      <div className="min-w-0 flex-1">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold text-slate-900">
          {title}
          {typeof count === "number" && <span className="rounded-full bg-slate-100 px-2 text-[11px] font-bold tabular-nums text-slate-600">{count}</span>}
        </h2>
        {hint && <p className="m-0 mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
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
          onClick={() => void ownerPropertyPath(p.id).then((path) => router.push(`/owner/properties/add?id=${path.split("/").pop()}`))}
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
            onClick={() => void ownerPropertyPath(p.id).then((path) => router.push(`/owner/properties/add?id=${path.split("/").pop()}`))}
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
                    href={`mailto:partners@nolsaf.com?subject=${encodeURIComponent(`Property appeal ${suspensionReference}`)}`}
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
const REVIEW_TIME = "usually within 1 to 2 business days";

/** The listing lifecycle, shown on the empty state and the review detail. */
const LIFECYCLE = [
  { label: "Draft", hint: "Fill in details, rooms and photos" },
  { label: "Submitted", hint: "Sent to NoLSAF for review" },
  { label: "In review", hint: REVIEW_TIME },
  { label: "Live", hint: "Guests can book it" },
];

function Lifecycle({ current }: { current: number }) {
  return (
    <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
      {LIFECYCLE.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.label} className={`rounded-xl px-3 py-2.5 ring-1 ring-inset ${active ? "bg-[#5eead4]/10 ring-[#5eead4]/35" : "bg-white/[0.04] ring-white/10"}`}>
            <span className="flex items-center gap-2">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done ? "bg-[#5eead4] text-[#012a26]" : active ? "bg-white text-[#012a26]" : "bg-white/10 text-white/50"}`}>
                {done ? <CheckCircle className="h-3 w-3" /> : index + 1}
              </span>
              <span className={`text-sm font-semibold ${done || active ? "text-white" : "text-white/55"}`}>{step.label}</span>
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-white/45">{step.hint}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function PendingProps() {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [suspended, setSuspended] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [selectedPendingProperty, setSelectedPendingProperty] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = () => Promise.all([
    api.get("/api/owner/properties/mine", { params: { status: "DRAFT", pageSize: 50 } }),
    api.get("/api/owner/properties/mine", { params: { status: "PENDING", pageSize: 50 } }),
    api.get("/api/owner/properties/mine", { params: { status: "SUSPENDED", pageSize: 50 } }),
  ]);

  useEffect(() => {
    let mounted = true;
    fetchAll()
      .then(([draftRes, pendingRes, suspendedRes]) => {
        if (!mounted) return;
        setDrafts((draftRes.data as any)?.items ?? []);
        setPending((pendingRes.data as any)?.items ?? []);
        setSuspended((suspendedRes.data as any)?.items ?? []);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err?.response?.data?.error || err?.response?.data?.message || err?.message || "Failed to load properties");
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUpdated() {
    fetchAll()
      .then(([draftRes, pendingRes, suspendedRes]) => {
        setDrafts((draftRes.data as any)?.items ?? []);
        setPending((pendingRes.data as any)?.items ?? []);
        setSuspended((suspendedRes.data as any)?.items ?? []);
      })
      .catch(() => {});
  }

  const shell = "w-full min-w-0 space-y-6 px-3 pb-12 sm:px-5 lg:px-6";
  const pendingClean = pending.filter((p) => getRejectionReasons(p).length === 0);
  const pendingNeedsFixes = pending.filter((p) => getRejectionReasons(p).length > 0);
  const allNeedsAttention = [...pendingNeedsFixes, ...suspended];
  const total = drafts.length + pending.length + suspended.length;

  // ── Owner view of a draft or a listing that needs attention
  if (selectedPropertyId) {
    return <OwnerPropertyView propertyId={selectedPropertyId} onBack={() => setSelectedPropertyId(null)} onUpdated={handleUpdated} />;
  }

  // ── Under review detail
  if (selectedPendingProperty) {
    const sp = selectedPendingProperty;
    const primaryImg = Array.isArray(sp.photos) && sp.photos.length > 0 ? sp.photos[0] : null;
    return (
      <div className={shell}>
        <header className="overflow-hidden rounded-3xl bg-[#012a26] text-white">
          <div className="px-5 pb-6 pt-5 sm:px-8 sm:pt-6">
            <button type="button" onClick={() => setSelectedPendingProperty(null)} className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-white/60 hover:text-white">
              <ArrowRight className="h-4 w-4 rotate-180" aria-hidden /> Awaiting approval
            </button>
            <div className="mt-4 flex items-center gap-4">
              <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/15">
                {primaryImg ? <Image src={primaryImg} alt="" fill className="object-cover" sizes="64px" /> : <ImageIcon className="absolute inset-0 m-auto h-6 w-6 text-white/50" />}
              </span>
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-200 ring-1 ring-inset ring-amber-300/30"><Hourglass className="h-3 w-3" /> In review</span>
                <h1 className="m-0 mt-1.5 truncate text-2xl font-bold tracking-tight text-white">{sp.title || "Your property"}</h1>
                <p className="m-0 mt-0.5 text-xs text-white/55">
                  {[sp.type, sp.lastSubmittedAt ? `submitted ${new Date(sp.lastSubmittedAt).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short", year: "numeric" })}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="mt-5"><Lifecycle current={2} /></div>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
            <h2 className="m-0 flex items-center gap-2 text-base font-bold text-slate-900"><Clock className="h-4 w-4 text-amber-600" /> What NoLSAF checks</h2>
            <ul className="m-0 mt-3 list-none space-y-2.5 p-0 text-sm text-slate-700">
              {[
                "Your details, room types and prices make sense together",
                "Photos are clear and show the real property",
                "The map pin matches the address",
                "Amenities and house rules are accurate",
              ].map((text) => (
                <li key={text} className="flex gap-2.5"><FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" />{text}</li>
              ))}
            </ul>
            <p className="m-0 mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs leading-5 text-slate-600">
              <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" />
              Review takes {REVIEW_TIME}. You get a notification and an email as soon as it is approved or needs changes.
            </p>
          </section>

          <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5">
            <h2 className="m-0 flex items-center gap-2 text-base font-bold text-slate-900"><BookOpen className="h-4 w-4 text-[#02665e]" /> Get ready while you wait</h2>
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {[
                { icon: Camera, title: "Set up your payout account", desc: "Payouts only go to a verified account in your name.", href: "/owner/payouts/account" },
                { icon: Star, title: "Learn how check-in works", desc: "Guests show a booking code; checking it starts your payout.", href: "/owner/docs" },
                { icon: MessageSquare, title: "Read the disbursement policy", desc: "Payout timing, holds and recoveries.", href: "/owner/property-owner-disbursement-policy" },
              ].map(({ icon: Icon, title, desc, href }) => (
                <li key={title}>
                  <Link href={href} className="group flex items-start gap-3 rounded-xl bg-slate-50 px-3.5 py-3 no-underline transition hover:bg-emerald-50/60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-[#02665e] ring-1 ring-inset ring-slate-200"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">{title}</span>
                      <span className="block text-xs leading-5 text-slate-500">{desc}</span>
                    </span>
                    <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-[#02665e]" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-solid border-slate-200 bg-white p-5 lg:col-span-2">
            <h2 className="m-0 flex items-center gap-2 text-base font-bold text-slate-900"><TrendingUp className="h-4 w-4 text-emerald-600" /> Once it is live</h2>
            <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2">
              {[
                "Guests find it in search and can book straight away",
                "Bookings arrive by notification and appear under All bookings",
                "You check guests in with their booking code on arrival",
                "Your payout is your full room rate; the NoLSAF fee is added on top for the guest",
              ].map((text) => (
                <li key={text} className="flex gap-2.5 text-sm text-slate-700"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{text}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    );
  }

  const header = (
    <header className="overflow-hidden rounded-3xl bg-[#012a26] text-white">
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-5 pt-5 sm:px-8 sm:pt-6">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5eead4]">Properties</p>
          <h1 className="m-0 mt-1 text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">Awaiting approval</h1>
          <p className="m-0 mt-1 max-w-xl text-sm text-white/60">Drafts you are still filling in, listings with NoLSAF for review, and anything that needs your attention.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/owner/properties/approved" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white no-underline hover:bg-white/[0.12]">
            <Building2 className="h-4 w-4" aria-hidden /> My properties
          </Link>
          <Link href="/owner/properties/add" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5eead4] px-4 text-sm font-bold text-[#012a26] no-underline hover:bg-[#8ff3e1]">
            <Plus className="h-4 w-4" aria-hidden /> Add a property
          </Link>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-px border-0 border-t border-solid border-white/10 bg-white/10">
        {[
          { label: "Drafts", value: loading ? null : drafts.length, hint: "still being filled in", tone: "text-white" },
          { label: "In review", value: loading ? null : pendingClean.length, hint: REVIEW_TIME, tone: "text-amber-200" },
          { label: "Need attention", value: loading ? null : allNeedsAttention.length, hint: "changes or suspended", tone: allNeedsAttention.length ? "text-rose-300" : "text-white/50" },
        ].map((tile) => (
          <div key={tile.label} className="bg-[#012a26] px-5 py-3.5 sm:px-8">
            <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45">{tile.label}</dt>
            <dd className={`m-0 mt-1 text-2xl font-extrabold tabular-nums ${tile.tone}`}>{tile.value === null ? <span className="inline-block h-6 w-8 rounded-md bg-white/10 align-middle" /> : tile.value}</dd>
            <p className="m-0 hidden truncate text-[11px] text-white/45 sm:block">{tile.hint}</p>
          </div>
        ))}
      </dl>
    </header>
  );

  // ── Loading: the page shape, steady
  if (loading) {
    return (
      <div className={shell} aria-busy="true" aria-label="Loading listings">
        {header}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-72 rounded-2xl border border-solid border-slate-200 bg-white" />)}
        </div>
      </div>
    );
  }

  // ── Error
  if (error) {
    return (
      <div className={shell}>
        {header}
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-solid border-rose-200 bg-rose-50 p-5">
          <AlertCircle className="h-6 w-6 shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-rose-900">Your listings could not be loaded</p>
            <p className="m-0 mt-0.5 text-xs text-rose-700">{error}</p>
          </div>
          <button type="button" onClick={() => window.location.reload()} className="inline-flex h-9 items-center gap-1.5 rounded-xl border-0 bg-rose-600 px-3.5 text-xs font-bold text-white hover:bg-rose-700">
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Nothing waiting
  if (total === 0) {
    return (
      <div className={shell}>
        {header}
        <section className="overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white">
          <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-[#02665e]"><CheckCircle className="h-7 w-7" /></span>
            <h2 className="m-0 mt-4 text-lg font-bold text-slate-900">Nothing is waiting</h2>
            <p className="m-0 mt-1 max-w-md text-sm leading-6 text-slate-500">
              You have no drafts, nothing in review and nothing that needs fixing. Your live listings are under My properties.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/owner/properties/add" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#02665e] px-4 text-sm font-bold text-white no-underline hover:bg-[#014d47]">
                <Plus className="h-4 w-4" /> Add a property
              </Link>
              <Link href="/owner/properties/approved" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50">
                <Building2 className="h-4 w-4" /> My properties
              </Link>
            </div>
          </div>
          <div className="bg-[#012a26] px-5 py-5 sm:px-8">
            <p className="m-0 mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#5eead4]">How a new listing goes live</p>
            <Lifecycle current={-1} />
          </div>
        </section>
      </div>
    );
  }

  // ── Main
  return (
    <div className={shell}>
      {header}

      {allNeedsAttention.length > 0 && (
        <section className="space-y-4">
          <SectionHeader title="Needs your attention" hint="Fix what NoLSAF raised, then submit again" count={allNeedsAttention.length} icon={AlertCircle} accent="red" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {allNeedsAttention.map((p) => <ActionRequiredCard key={p.id} p={p} onPreview={setSelectedPropertyId} />)}
          </div>
        </section>
      )}

      {drafts.length > 0 && (
        <section className="space-y-4">
          <SectionHeader title="Drafts" hint="Finish the missing steps and submit for review" count={drafts.length} icon={PenLine} accent="amber" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {drafts.map((p) => (
              <DraftCard key={p.id} p={p} onPreview={setSelectedPropertyId} onDeleted={(id) => setDrafts((prev) => prev.filter((d) => d.id !== id))} />
            ))}
          </div>
        </section>
      )}

      {pendingClean.length > 0 && (
        <section className="space-y-4">
          <SectionHeader title="In review" hint={`With NoLSAF, ${REVIEW_TIME}`} count={pendingClean.length} icon={Clock} accent="teal" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pendingClean.map((p) => (
              <PendingCard key={p.id} p={p} onPreview={(id) => {
                const prop = pendingClean.find((x) => x.id === id);
                if (prop) setSelectedPendingProperty(prop);
                else setSelectedPropertyId(id);
              }} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
