"use client";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import axios from "axios";import apiClient from "@/lib/apiClient";
import Image from "next/image";
import {
  ArrowLeft, Car, CheckCircle2, Clock, CreditCard, Eye, FileText,
  Globe, Lock, LogOut, Mail, MapPin, Pencil, Phone, Plus, Save, Shield, Trash2,
  Truck, Upload, User, UserCircle, X, AlertCircle, Calendar,
} from "lucide-react";
import DatePickerField from "@/components/DatePickerField";
import SecurePayoutPreferenceCard from "@/components/SecurePayoutPreferenceCard";

// --- Driver document types --------------------------------------------------
const DRIVER_DOC_TYPES = [
  { type: "DRIVER_LICENSE",       label: "Driving Licence",              hasExpiry: true,  expiryLabel: "Licence expiry date" },
  { type: "NATIONAL_ID",          label: "National ID",                  hasExpiry: false },
  { type: "VEHICLE_REGISTRATION", label: "Vehicle Registration (LATRA)", hasExpiry: false },
  { type: "INSURANCE",            label: "Insurance Certificate",        hasExpiry: true,  expiryLabel: "Insurance expiry date" },
] as const;

function getLatestDriverDoc(docs: any[], type: string) {
  const t = type.toUpperCase();
  return (docs ?? []).find((d: any) => String(d?.type ?? "").toUpperCase() === t) ?? null;
}
function todayIso() { return new Date().toISOString().slice(0, 10); }

function maskRef(v?: string | null) {
  if (!v) return "—";
  const s = String(v);
  return s.length <= 8 ? s.slice(0, 2) + "————" + s.slice(-2) : s.slice(0, 4) + "————" + s.slice(-4);
}

const api = apiClient;

function EditableInfoItem({
  icon, label, value, fieldKey, fieldType = "text", selectOptions,
  editingField, onStartEdit, onStopEdit, onChange,
}: {
  icon: React.ReactNode; label: string; value: any; fieldKey: string;
  fieldType?: "text" | "select" | "date" | "tel";
  selectOptions?: { value: string; label: string }[];
  editingField: string | null;
  onStartEdit: (k: string) => void;
  onStopEdit: () => void;
  onChange: (k: string, v: string) => void;
}) {
  const editing = editingField === fieldKey;
  const display = value || "—";
  return (
    <div className="flex items-start gap-3 group w-full max-w-full min-w-0 overflow-hidden">
      <div className="h-10 w-10 rounded-2xl bg-[#02665e]/5 border border-[#02665e]/15 flex items-center justify-center text-[#02665e] flex-shrink-0">{icon}</div>
      <div className="min-w-0 flex-1 w-full max-w-full overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-600">{label}</div>
          <button
            type="button"
            onClick={() => editing ? onStopEdit() : onStartEdit(fieldKey)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[#02665e] hover:text-[#02665e]/80 focus-visible:opacity-100 focus-visible:outline-none"
            aria-label={editing ? "Cancel" : `Edit ${label}`}
          >
            {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          </button>
        </div>
        {editing ? (
          fieldType === "select" && selectOptions ? (
            <div className="mt-0.5 w-full max-w-full min-w-0 overflow-hidden rounded-xl">
              <select
                value={value || ""}
                onChange={(e) => onChange(fieldKey, e.target.value)}
                autoFocus
                onBlur={onStopEdit}
                className="block w-full max-w-full min-w-0 box-border rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 appearance-none shadow-none focus:outline-none focus:ring-0 focus:shadow-none focus:ring-offset-0 focus:border-[#02665e]/30"
              >
                <option value="">Select</option>
                {selectOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="mt-0.5 w-full max-w-full min-w-0 overflow-hidden rounded-xl">
              <input
                type={fieldType === "tel" ? "tel" : fieldType === "date" ? "date" : "text"}
                value={value || ""}
                onChange={(e) => onChange(fieldKey, e.target.value)}
                autoFocus
                onBlur={onStopEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onStopEdit();
                }}
                className="block w-full max-w-full min-w-0 box-border rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 appearance-none shadow-none focus:outline-none focus:ring-0 focus:shadow-none focus:ring-offset-0 focus:border-[#02665e]/30"
              />
            </div>
          )
        ) : (
          <div className={`text-sm font-normal mt-0.5 break-words ${!value ? "text-slate-400" : "text-slate-900"}`}>
            {fieldType === "date" && value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : display}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main component ----------------------------------------------------------
function pickExtendedBio(d: { name?: string|null; rating?: number|null; isVipDriver?: boolean; operationArea?: string|null; district?: string|null; vehicleMake?: string|null }): string {
  const first = (d.name ?? "").split(" ")[0] || "Your driver";
  if (d.isVipDriver) return `Exclusively trained for executive travel, ${first} is one of NoLSAF's Premium-certified specialists. Clients receive complete discretion and an on-time arrival record that only genuine professionalism builds.`;
  if (d.rating != null && d.rating >= 4.5) return `With a near-perfect rating, ${first} has built a reputation that only consistent excellence creates. Composed under any condition and unfailingly punctual.`;
  const area = d.operationArea || d.district;
  if (area) return `Nobody reads ${area} the way ${first} does. Every route is mentally mapped before the journey begins — peak-hour shortcuts, alternate roads, and local instinct.`;
  if (d.vehicleMake) return `Behind the wheel of a ${d.vehicleMake}, ${first} treats every trip as a VIP assignment — vehicle inspected before each journey, kept spotless, driven with steady care.`;
  return `Background-checked, fully licensed, and trusted by hundreds of NoLSAF passengers. ${first} brings calm conviction to every route — reliability is not a policy here, it is simply how ${first} works.`;
}
export default function DriverProfile() {
  const [form, setForm] = useState<any>({});
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<any[] | null>(null);
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Per-document upload
  const docInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocType, setSelectedDocType] = useState("");
  const [docUploading, setDocUploading] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docSuccess, setDocSuccess] = useState<string | null>(null);
  const [docDragOver, setDocDragOver] = useState(false);
  const [licenseExpiresOn, setLicenseExpiresOn] = useState("");
  const [insuranceExpiresOn, setInsuranceExpiresOn] = useState("");
  const [inlineExpiryType, setInlineExpiryType] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<null | 'confirm' | 'verify'>(null);
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showIdCard, setShowIdCard] = useState(false);
  const [idCardFlipped, setIdCardFlipped] = useState(false);
  type CloudinarySig = { timestamp: number; signature: string; folder: string; cloudName: string; apiKey: string };

  async function uploadToCloudinary(file: File, folder: string) {
    const sig = await api.get(`/api/uploads/cloudinary/sign?folder=${encodeURIComponent(folder)}`);
    const s = sig.data as CloudinarySig;
    const fd = new FormData();
    fd.append("file", file); fd.append("timestamp", String(s.timestamp));
    fd.append("api_key", s.apiKey); fd.append("signature", s.signature);
    fd.append("folder", s.folder); fd.append("overwrite", "true");
    const r = await axios.post(`https://api.cloudinary.com/v1_1/${s.cloudName}/auto/upload`, fd);
    return (r.data as { secure_url: string }).secure_url;
  }

  const uploadDocumentForType = async (type: string, file: File | null) => {
    if (!file || !type) return;
    setDocError(null); setDocSuccess(null);
    const dt = DRIVER_DOC_TYPES.find(d => d.type === type);
    if (!dt) return;
    if (dt.hasExpiry) {
      const ev = type === "DRIVER_LICENSE" ? licenseExpiresOn : insuranceExpiresOn;
      if (!ev) { setDocError(`Please enter the ${dt.expiryLabel} before uploading.`); return; }
      if (!Number.isFinite(new Date(`${ev}T23:59:59.999Z`).getTime())) { setDocError("Please enter a valid expiry date."); return; }
      if (ev < todayIso()) { setDocError("Expiry date must be today or later."); return; }
    }
    const allowed = new Set(["application/pdf","image/jpeg","image/png","image/webp","image/gif"]);
    if (!allowed.has(file.type)) { setDocError("Please choose a PDF or image file (PDF, JPG, PNG, WebP)."); return; }
    if (file.size > 15 * 1024 * 1024) { setDocError("File is too large. Maximum size is 15 MB."); return; }
    try {
      setDocUploading(type);
      const url = await uploadToCloudinary(file, "driver-documents");
      const ev = dt.hasExpiry ? (type === "DRIVER_LICENSE" ? licenseExpiresOn : insuranceExpiresOn) : null;
      const expiresAtIso = ev ? new Date(`${ev}T23:59:59.999Z`).toISOString() : null;
      const resp = await api.put("/api/account/documents", {
        type, url,
        metadata: { fileName: file.name, contentType: file.type, size: file.size, uploadedAt: new Date().toISOString(), ...(expiresAtIso ? { expiresAt: expiresAtIso, expiresOn: ev } : null) },
      });
      const saved = (resp as any)?.data?.data?.doc ?? (resp as any)?.data?.doc ?? null;
      setMe((prev: any) => {
        if (!prev) return prev;
        const docs = Array.isArray(prev.documents) ? prev.documents : [];
        return { ...prev, documents: saved ? [saved, ...docs.filter((d: any) => d?.id !== saved?.id)] : docs };
      });
      setDocSuccess("Document uploaded. Pending admin review.");
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message;
      setDocError(String(msg || e?.message || "Failed to upload document."));
    } finally {
      setDocUploading(null); setDocDragOver(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true); setLoadError(null);
      try {
        const r = await api.get("/api/account/me");
        if (!mounted) return;
        const d = r.data?.data ?? r.data;
        const norm = { ...(d ?? {}), fullName: (d as any)?.fullName ?? (d as any)?.name ?? "" };
        setForm(norm); setMe(norm);
        try { (window as any).ME = norm; } catch { /* ignore */ }
        try {
          setLoadingPaymentMethods(true);
          const pm = await api.get("/api/account/payment-methods");
          if (!mounted) return;
          const pd = pm.data?.data ?? pm.data;
          setPaymentMethods(pd?.methods ?? null);
          if (pd?.payout) {
            setForm((prev: any) => ({ ...prev, ...pd.payout }));
            setMe((prev: any) => ({ ...(prev || {}), ...pd.payout }));
          }
        } catch { /* ignore */ } finally { if (mounted) setLoadingPaymentMethods(false); }
      } catch (err: any) {
        if (!mounted) return;
        setLoadError(String(err?.message ?? err));
        const st = err?.response?.status; const code = err?.response?.data?.code;
        if (st === 403 && code === "ACCOUNT_SUSPENDED") return;
        if (typeof window !== "undefined") window.location.href = "/driver/login";
      } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const profileCompletion = useMemo(() => {
    const docs = Array.isArray(me?.documents) ? me.documents : [];
    const checks = [
      Boolean(form.avatarUrl),
      Boolean(form.fullName),
      Boolean(form.phone),
      Boolean(form.nationality),
      Boolean(form.region),
      Boolean(form.licenseNumber),
      Boolean(form.vehicleType),
      Boolean(form.plateNumber || form.vehiclePlate),
      ...DRIVER_DOC_TYPES.map(dt => {
        const d = getLatestDriverDoc(docs, dt.type);
        if (!d?.url) return false;
        const expAt = d?.metadata?.expiresAt ? new Date(d.metadata.expiresAt) : d?.metadata?.expiresOn ? new Date(d.metadata.expiresOn) : null;
        return !(expAt && expAt.getTime() < Date.now());
      }),
    ];
    const done = checks.filter(Boolean).length;
    return { pct: Math.round((done / checks.length) * 100), done, total: checks.length };
  }, [form, me]);

  const completionTone = profileCompletion.pct >= 80 ? "good" : profileCompletion.pct >= 50 ? "warn" : "bad";

  const save = async () => {
    setSaving(true); setEditingField(null);
    try {
      const avatarUrl = form.avatarUrl;
      const payload: any = {
        fullName: form.fullName ?? form.name, phone: form.phone,
        nationality: form.nationality, avatarUrl,
        timezone: form.timezone, region: form.region, district: form.district,
        nin: form.nin || form.nationalId, licenseNumber: form.licenseNumber,
        plateNumber: form.plateNumber, vehicleType: form.vehicleType,
        vehicleMake: form.vehicleMake, vehiclePlate: form.vehiclePlate,
        operationArea: form.operationArea || form.parkingArea, paymentPhone: form.paymentPhone,
      };
      if (typeof form.dateOfBirth !== "undefined") payload.dateOfBirth = form.dateOfBirth;
      if (typeof form.gender !== "undefined") payload.gender = form.gender;
      await api.put("/api/driver/profile", payload);
      setForm((p: any) => ({ ...p, avatarUrl }));
      const preferred = String(form.payoutPreferred || "").trim().toUpperCase();
      const payoutKeys = ["payoutPreferred", "bankName", "bankAccountName", "bankAccountNumber", "bankBranch", "mobileMoneyProvider", "mobileMoneyNumber"];
      const payoutChanged = payoutKeys.some((key) => String(form[key] || "").trim() !== String(me?.[key] || "").trim());
      let payoutDraft: Record<string, string> | null = null;
      if (payoutChanged && preferred === "BANK") {
        payoutDraft = {
          payoutPreferred: "BANK",
          bankName: String(form.bankName || "").trim(),
          bankAccountName: String(form.bankAccountName || "").trim(),
          bankAccountNumber: String(form.bankAccountNumber || "").trim(),
          bankBranch: String(form.bankBranch || "").trim(),
        };
      } else if (payoutChanged && preferred === "MOBILE_MONEY") {
        payoutDraft = {
          payoutPreferred: "MOBILE_MONEY",
          mobileMoneyProvider: String(form.mobileMoneyProvider || "").trim(),
          mobileMoneyNumber: String(form.mobileMoneyNumber || "").trim(),
        };
      }
      if (payoutDraft) {
        // Keep the driver flow compatible with the server's single-use,
        // name-verified confirmation contract. The owner profile presents the
        // resolved holder interactively before consuming this challenge.
        const verification = await api.post("/api/account/payouts/verify", payoutDraft);
        const challengeToken = (verification as any)?.data?.data?.challengeToken;
        if (!challengeToken) throw new Error("Payout verification did not return a confirmation token.");
        await api.put("/api/account/payouts", { challengeToken });
      }
      setSaveSuccess("Profile saved."); setSaveError(null);
      setTimeout(() => setSaveSuccess(null), 3000);
      const updated = {
        ...(me ?? {}),
        ...payload,
        payoutPreferred: form.payoutPreferred,
        bankName: form.bankName,
        bankAccountName: form.bankAccountName,
        bankAccountNumber: form.bankAccountNumber,
        bankBranch: form.bankBranch,
        mobileMoneyProvider: form.mobileMoneyProvider,
        mobileMoneyNumber: form.mobileMoneyNumber,
      };
      setMe(updated);
      try { (window as any).ME = updated; } catch { /* ignore */ }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.error;
      setSaveError("Could not save: " + String(msg ?? err?.message ?? err));
      setSaveSuccess(null);
    } finally { setSaving(false); }
  };

  const onUploadAvatar = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setAvatarError("Please choose an image file."); return; }
    if (file.size > 10 * 1024 * 1024) { setAvatarError("Image too large. Max 10 MB."); return; }
    try {
      setAvatarUploading(true); setAvatarError(null);
      const url = await uploadToCloudinary(file, "avatars");
      await api.put("/api/driver/profile", { avatarUrl: url });
      setForm((p: any) => ({ ...p, avatarUrl: url }));
      setMe((p: any) => p ? { ...p, avatarUrl: url } : p);
      try { window.dispatchEvent(new CustomEvent("account:avatarUrl", { detail: { avatarUrl: url } })); } catch { /* ignore */ }
    } catch (e: any) {
      setAvatarError("Failed to upload photo.");
    } finally { setAvatarUploading(false); if (avatarFileInputRef.current) avatarFileInputRef.current.value = ""; }
  };

  if (loading) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-20">
        <div className="dot-spinner dot-md mx-auto" aria-hidden>
          <span className="dot dot-blue" /><span className="dot dot-black" />
          <span className="dot dot-yellow" /><span className="dot dot-green" />
        </div>
        <p className="text-sm text-slate-600 mt-4">Loading profile...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <div className="text-sm font-bold text-rose-900">Error loading profile</div>
        <div className="text-sm text-rose-700 mt-1">{loadError}</div>
      </div>
    );
  }

  const avatarUrl = form.avatarUrl || null;
  const bypassAvatarOptimizer = Boolean(avatarUrl && /^https?:\/\//i.test(avatarUrl));

  const editProps = {
    editingField,
    onStartEdit: (k: string) => setEditingField(k),
    onStopEdit: () => setEditingField(null),
    onChange: (k: string, v: string) => setForm((p: any) => ({ ...p, [k]: v })),
  };

  const allDocs = Array.isArray(me?.documents) ? me.documents : [];
  const missingDocTypes = DRIVER_DOC_TYPES.filter(dt => !getLatestDriverDoc(allDocs, dt.type)?.url);

  return (
    <>
    <div className="w-full py-2 sm:py-4">

      {/* -- Hero banner --------------------------------------------------- */}
      <div className="mb-6 relative rounded-3xl border border-white/10 bg-slate-950 shadow-card overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#02665e]/20 via-slate-950 to-slate-900" aria-hidden />
        <div className="relative p-5 sm:p-7">
          <div className="relative min-h-10">
            <Link href="/driver" aria-label="Back"
              className="absolute left-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 shadow-card transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>

            {/* Completion ring */}
            <div className="absolute right-0 top-0 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
              <div className="relative h-11 w-11">
                <svg viewBox="0 0 36 36" className="h-11 w-11" aria-hidden>
                  <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" className="text-white/10" strokeWidth="3.5" />
                  <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor"
                    className={completionTone === "good" ? "text-emerald-500" : completionTone === "warn" ? "text-amber-500" : "text-rose-500"}
                    strokeWidth="3.5" strokeLinecap="round" pathLength="100"
                    strokeDasharray={`${profileCompletion.pct} 100`} transform="rotate(-90 18 18)"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-xs font-bold text-white tabular-nums">{profileCompletion.pct}%</div>
                </div>
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-[11px] font-semibold text-white/70 leading-tight">Profile status</div>
                <div className="text-[11px] font-semibold text-white/60 leading-tight">{profileCompletion.done}/{profileCompletion.total} items</div>
              </div>
            </div>

            <div className="mx-auto w-full max-w-2xl px-12 sm:px-16 pt-0.5 text-center">
              <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight">My Profile</h1>
              <p className="mt-2 text-sm sm:text-base text-white/70 leading-relaxed">Personal details, vehicle info, and required documents.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ID Card Banner */}
      <button
        onClick={() => { setShowIdCard(true); setIdCardFlipped(false); }}
        className="mb-5 w-full flex items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
        style={{ background: "linear-gradient(135deg, #0b1e35 0%, #0f2d4a 60%, #0c4a6e 100%)", border: "1px solid rgba(5,150,105,0.35)", boxShadow: "0 4px 20px rgba(5,150,105,0.12)" }}
      >
        <div className="flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(5,150,105,0.2)", border: "1px solid rgba(5,150,105,0.4)" }}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden>
              <rect x="2" y="5" width="20" height="14" rx="2" stroke="#10b981" strokeWidth="1.6" fill="none"/>
              <circle cx="8.5" cy="12" r="2.5" stroke="#10b981" strokeWidth="1.4"/>
              <path d="M13 10h5M13 14h3" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white">Your NoLSAF Driver ID Card</p>
            <p className="text-xs text-white/50 mt-0.5">View the ID card passengers see when booked with you</p>
          </div>
        </div>
        <div className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center" style={{ background: "rgba(5,150,105,0.18)", border: "1px solid rgba(5,150,105,0.35)" }}>
          <svg viewBox="0 0 10 10" className="h-3 w-3" fill="none" aria-hidden>
            <path d="M3.5 2L6.5 5L3.5 8" stroke="#10b981" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {/* -- Save feedback ------------------------------------------------ */}
      {(saveSuccess || saveError) && (
        <div className={`mb-5 rounded-2xl border px-5 py-3.5 text-sm font-semibold ${saveSuccess ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
          {saveSuccess ?? saveError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* -- Personal details -------------------------------------------- */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/60">
            <div className="text-sm font-bold text-slate-900">Personal details</div>
            <div className="text-sm text-slate-600 mt-1">Contact and identity information.</div>
          </div>
          <div className="p-5 sm:p-6">
            {/* Avatar row */}
            <div className="flex items-center justify-between gap-4 pb-5 border-b border-slate-100">
              <div className="flex items-center gap-4 min-w-0">
                <div className="relative h-14 w-14 rounded-full border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {avatarUrl
                    ? <Image src={avatarUrl} alt="Profile photo" fill sizes="56px" unoptimized={bypassAvatarOptimizer} className="object-cover" />
                    : <User className="h-6 w-6 text-slate-400" aria-hidden />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">Profile photo</div>
                  <div className="text-xs text-slate-600 mt-0.5">{!avatarUrl ? "Required — upload your photo." : "Keep your photo up to date."}</div>
                  {avatarError && <div className="text-xs text-rose-600 mt-1">{avatarError}</div>}
                </div>
              </div>
              <div className="shrink-0">
                <input ref={avatarFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onUploadAvatar(e.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => avatarFileInputRef.current?.click()} disabled={avatarUploading}
                  className="inline-flex items-center justify-center text-[#02665e] disabled:opacity-60 focus-visible:outline-none">
                  <span className="sr-only">{avatarUrl ? "Change photo" : "Upload photo"}</span>
                  {avatarUploading
                    ? <span className="h-4 w-4 rounded-full border-2 border-[#02665e]/20 border-t-[#02665e] animate-spin" aria-hidden />
                    : <Pencil className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>

            <div className="pt-5 grid grid-cols-2 gap-4">
              <EditableInfoItem icon={<User className="w-5 h-5" />} label="Full name" value={form.fullName} fieldKey="fullName" {...editProps} />
              <EditableInfoItem icon={<Mail className="w-5 h-5" />} label="Email" value={form.email} fieldKey="email" {...editProps} />
              <EditableInfoItem icon={<Phone className="w-5 h-5" />} label="Phone" value={form.phone} fieldKey="phone" fieldType="tel" {...editProps} />
              <EditableInfoItem icon={<Globe className="w-5 h-5" />} label="Nationality" value={form.nationality} fieldKey="nationality" {...editProps} />
              <EditableInfoItem icon={<MapPin className="w-5 h-5" />} label="Region" value={form.region} fieldKey="region" {...editProps} />
              <EditableInfoItem icon={<MapPin className="w-5 h-5" />} label="District" value={form.district} fieldKey="district" {...editProps} />
              <EditableInfoItem icon={<Calendar className="w-5 h-5" />} label="Date of birth" value={form.dateOfBirth} fieldKey="dateOfBirth" fieldType="date" {...editProps} />
              <EditableInfoItem icon={<User className="w-5 h-5" />} label="Gender" value={form.gender} fieldKey="gender" fieldType="select"
                selectOptions={[{value:"male",label:"Male"},{value:"female",label:"Female"},{value:"other",label:"Other"},{value:"prefer_not_to_say",label:"Prefer not to say"}]}
                {...editProps} />
            </div>
          </div>
        </div>

        {/* -- Driving details --------------------------------------------- */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/60">
            <div className="text-sm font-bold text-slate-900">Driving details</div>
            <div className="text-sm text-slate-600 mt-1">Vehicle and licence information.</div>
          </div>
          <div className="p-5 sm:p-6 grid grid-cols-2 gap-4">
            <EditableInfoItem icon={<FileText className="w-5 h-5" />} label="Licence number" value={form.licenseNumber} fieldKey="licenseNumber" {...editProps} />
            <EditableInfoItem icon={<Car className="w-5 h-5" />} label="Vehicle type" value={form.vehicleType} fieldKey="vehicleType" fieldType="select"
              selectOptions={[{value:"bajaji",label:"Bajaji"},{value:"bodaboda",label:"Bodaboda"},{value:"vehicle",label:"Vehicle"}]}
              {...editProps} />
            <EditableInfoItem icon={<Truck className="w-5 h-5" />} label="Plate number" value={form.plateNumber || form.vehiclePlate} fieldKey="plateNumber" {...editProps} />
            <EditableInfoItem icon={<Car className="w-5 h-5" />} label="Vehicle make" value={form.vehicleMake} fieldKey="vehicleMake" {...editProps} />
            <EditableInfoItem icon={<MapPin className="w-5 h-5" />} label="Operation area" value={form.operationArea || form.parkingArea} fieldKey="operationArea" {...editProps} />
            <EditableInfoItem icon={<FileText className="w-5 h-5" />} label="NIN" value={form.nin || form.nationalId} fieldKey="nin" {...editProps} />
            {/* VIP badge */}
            <div className="col-span-2 flex items-start gap-3">
              <div className="h-10 w-10 rounded-2xl bg-amber-50 border border-amber-200/70 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-600">VIP vehicle class</div>
                {form.isVipDriver
                  ? <span className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">VIP — Premium eligible</span>
                  : <div className="text-sm font-normal text-slate-900 mt-0.5">Standard class</div>}
                <div className="text-[10px] text-slate-400 mt-1">Set during registration, reviewed by our team.</div>
              </div>
            </div>
          </div>
        </div>

        {/* One shared component owns every payout method and destination. */}
        <SecurePayoutPreferenceCard
          className="lg:col-span-12"
          value={form}
          disabled={saving}
          onChange={(patch) => setForm((current: any) => ({ ...current, ...patch }))}
        />

        {/* -- Required documents ------------------------------------------ */}
        <div className="lg:col-span-12 rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/60">
            <div className="text-sm font-bold text-slate-900">Required documents</div>
            <div className="text-sm text-slate-600 mt-1">PDF, JPG, PNG or WebP — max 15 MB each.</div>
          </div>
          <div className="p-5 sm:p-6 space-y-4">
            <input ref={docInputRef} type="file" className="hidden" accept="application/pdf,image/*"
              onChange={(e) => { void uploadDocumentForType(selectedDocType, e.target.files?.[0] ?? null); }} />

            {(docError || docSuccess) && (
              <div className="space-y-1">
                {docError  && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{docError}</div>}
                {docSuccess && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{docSuccess}</div>}
              </div>
            )}

            {/* Upload widget — only when any doc is missing */}
            {missingDocTypes.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                  <div className="lg:col-span-4">
                    <div className="text-xs font-semibold text-slate-600">Document type</div>
                    <select value={selectedDocType} onChange={(e) => { setSelectedDocType(e.target.value); setDocError(null); setInlineExpiryType(null); }}
                      className="mt-2 w-full h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30">
                      <option value="">Select document—</option>
                      {missingDocTypes.map(dt => <option key={dt.type} value={dt.type}>{dt.label}</option>)}
                    </select>
                    <div className="text-xs text-slate-600 mt-2">Select type, then drag & drop or click to upload.</div>
                    {selectedDocType === "DRIVER_LICENSE" && (
                      <div className="mt-3">
                        <div className="text-[11px] font-semibold text-slate-700 mb-1.5">Licence expiry date <span className="text-red-500">*</span></div>
                        <DatePickerField label="Licence expiry date" value={licenseExpiresOn} onChangeAction={setLicenseExpiresOn} min={todayIso()} allowPast={false} twoMonths={false} widthClassName="w-full" size="sm" />
                        <div className="text-[10px] text-slate-400 mt-1">Reminders sent before expiry.</div>
                      </div>
                    )}
                    {selectedDocType === "INSURANCE" && (
                      <div className="mt-3">
                        <div className="text-[11px] font-semibold text-slate-700 mb-1.5">Insurance expiry date <span className="text-red-500">*</span></div>
                        <DatePickerField label="Insurance expiry date" value={insuranceExpiresOn} onChangeAction={setInsuranceExpiresOn} min={todayIso()} allowPast={false} twoMonths={false} widthClassName="w-full" size="sm" />
                        <div className="text-[10px] text-slate-400 mt-1">Reminders sent before expiry.</div>
                      </div>
                    )}
                  </div>
                  <div className="lg:col-span-8">
                    <div
                      role="button" tabIndex={0}
                      aria-label="Upload document"
                      className={`w-full rounded-2xl border-2 border-dashed px-4 py-4 sm:py-5 transition cursor-pointer ${!selectedDocType || docUploading ? "border-slate-200 bg-slate-50/60 opacity-70" : docDragOver ? "border-[#02665e] bg-[#02665e]/5" : "border-slate-200 bg-slate-50/60 hover:bg-slate-50"}`}
                      onClick={() => { if (!selectedDocType || docUploading) return; docInputRef.current?.click(); }}
                      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !docUploading && selectedDocType) { e.preventDefault(); docInputRef.current?.click(); } }}
                      onDragOver={(e) => { if (!selectedDocType || !!docUploading) return; e.preventDefault(); setDocDragOver(true); }}
                      onDragLeave={() => setDocDragOver(false)}
                      onDrop={(e) => { if (!selectedDocType || !!docUploading) return; e.preventDefault(); setDocDragOver(false); void uploadDocumentForType(selectedDocType, e.dataTransfer.files?.[0] ?? null); }}
                    >
                      <div className="flex items-center justify-center gap-3 text-center">
                        <div className="h-10 w-10 rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-[#02665e] shrink-0">
                          <Plus className="w-5 h-5" aria-hidden />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{docUploading ? "Uploading—" : !selectedDocType ? "Select a document type above" : "Drag & drop to upload"}</div>
                          <div className="text-xs font-semibold text-slate-600 mt-0.5">or click to browse</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Doc status cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {DRIVER_DOC_TYPES.map((dt) => {
                const doc = getLatestDriverDoc(allDocs, dt.type);
                const status = (doc?.status ? String(doc.status) : "").toUpperCase();
                const hasUrl = Boolean(doc?.url);
                const statusText = hasUrl ? (status || "PENDING") : "NOT_UPLOADED";
                const expiresOn = doc?.metadata?.expiresOn ?? null;
                const expiresAt = doc?.metadata?.expiresAt ? new Date(doc.metadata.expiresAt) : doc?.metadata?.expiresOn ? new Date(doc.metadata.expiresOn) : null;
                const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;
                const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000) : null;
                const DocIcon = dt.type === "NATIONAL_ID" ? UserCircle : dt.type === "VEHICLE_REGISTRATION" ? Truck : dt.type === "INSURANCE" ? Shield : FileText;
                const badgeCls = isExpired ? "bg-rose-50 text-rose-700 border-rose-200" : statusText === "APPROVED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : statusText === "REJECTED" ? "bg-rose-50 text-rose-700 border-rose-200" : statusText === "PENDING" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-slate-50 text-slate-600 border-slate-200";
                return (
                  <div key={dt.type} className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-8 w-8 rounded-xl bg-[#02665e]/5 border border-[#02665e]/15 flex items-center justify-center text-[#02665e] shrink-0">
                          <DocIcon className="w-4 h-4" />
                        </div>
                        <div className="text-sm font-semibold text-slate-900 leading-snug">{dt.label}</div>
                      </div>
                      {hasUrl && doc?.url && (
                        <a href={doc.url} target="_blank" rel="noreferrer" title="View document"
                          className="text-[#02665e] hover:text-[#02665e]/80 focus-visible:outline-none">
                          <Eye className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                    <div className="mt-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeCls}`}>
                        {statusText === "PENDING" && <Clock className="w-3 h-3" />}
                        {statusText === "APPROVED" && <CheckCircle2 className="w-3 h-3" />}
                        {statusText === "NOT_UPLOADED" ? "Not uploaded" : statusText === "PENDING" ? "Pending review" : statusText.charAt(0) + statusText.slice(1).toLowerCase()}
                      </span>
                    </div>
                    {expiresOn && (
                      <div className={`mt-1.5 text-[10px] font-medium ${isExpired ? "text-rose-600" : typeof daysLeft === "number" && daysLeft <= 10 ? "text-orange-600" : "text-slate-500"}`}>
                        {isExpired ? "? Expired: " : "Expires: "}{expiresOn}
                        {!isExpired && typeof daysLeft === "number" && daysLeft <= 30 && ` (${daysLeft}d left)`}
                      </div>
                    )}
                    {statusText === "REJECTED" && doc?.reason && (
                      <div className="mt-2 text-xs text-rose-700 bg-rose-50 rounded-lg px-2.5 py-2 border border-rose-200">
                        <span className="font-semibold">Reason:</span> {doc.reason}
                      </div>
                    )}
                    {/* Inline expiry picker for hasExpiry card's Change button */}
                    {inlineExpiryType === dt.type && (
                      <div className="mt-3 p-3 rounded-xl border-2 border-[#02665e]/20 bg-[#02665e]/5 space-y-2">
                        <div className="text-[11px] font-semibold text-slate-700">{dt.type === "DRIVER_LICENSE" ? "Licence" : "Insurance"} expiry date <span className="text-red-500">*</span></div>
                        <DatePickerField
                          label={dt.type === "DRIVER_LICENSE" ? "Licence expiry date" : "Insurance expiry date"}
                          value={dt.type === "DRIVER_LICENSE" ? licenseExpiresOn : insuranceExpiresOn}
                          onChangeAction={(v) => { if (dt.type === "DRIVER_LICENSE") setLicenseExpiresOn(v); else setInsuranceExpiresOn(v); }}
                          min={todayIso()} allowPast={false} twoMonths={false} widthClassName="w-full" size="sm"
                        />
                        <div className="text-[10px] text-slate-400">Reminders sent before expiry.</div>
                        <div className="flex items-center gap-2 pt-1">
                          <button type="button"
                            disabled={!(dt.type === "DRIVER_LICENSE" ? licenseExpiresOn : insuranceExpiresOn)}
                            onClick={() => { setSelectedDocType(dt.type); setInlineExpiryType(null); setTimeout(() => docInputRef.current?.click(), 50); }}
                            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#02665e] text-white hover:bg-[#02665e]/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                            <Upload className="w-3 h-3" />Choose file
                          </button>
                          <button type="button" onClick={() => setInlineExpiryType(null)} className="text-[11px] text-slate-500 hover:text-slate-700 underline">Cancel</button>
                        </div>
                      </div>
                    )}
                    {/* Upload / Change button — only available when not yet uploaded or rejected */}
                    {(() => {
                      const canUpload = !hasUrl || statusText === "REJECTED" || isExpired;
                      if (!canUpload) {
                        return (
                          <div className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                            <Lock className="w-3 h-3" />
                            {statusText === "APPROVED" ? "Approved — locked" : "Under review — locked"}
                          </div>
                        );
                      }
                      if (inlineExpiryType === dt.type) return null;
                      return (
                        <button type="button" disabled={!!docUploading}
                          onClick={() => {
                            setDocError(null); setDocSuccess(null);
                            if (dt.type === "DRIVER_LICENSE" && doc?.metadata?.expiresOn) setLicenseExpiresOn(doc.metadata.expiresOn);
                            if (dt.type === "INSURANCE" && doc?.metadata?.expiresOn) setInsuranceExpiresOn(doc.metadata.expiresOn);
                            if (dt.hasExpiry) { setInlineExpiryType(dt.type); }
                            else { setSelectedDocType(dt.type); setInlineExpiryType(null); setTimeout(() => docInputRef.current?.click(), 50); }
                          }}
                          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50">
                          <Upload className="w-3 h-3" />{hasUrl ? "Upload new" : "Upload"}
                        </button>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* -- Payment methods --------------------------------------------- */}
        <div className="lg:col-span-12 rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/60">
            <div className="text-sm font-bold text-slate-900">Payment methods</div>
            <div className="text-sm text-slate-600 mt-1">Recent payment sources used for bookings.</div>
          </div>
          <div className="p-5 sm:p-6">
            {loadingPaymentMethods ? (
              <div className="py-8 flex flex-col items-center gap-3">
                <div className="dot-spinner dot-sm" aria-hidden><span className="dot dot-blue" /><span className="dot dot-black" /><span className="dot dot-yellow" /><span className="dot dot-green" /></div>
                <p className="text-sm text-slate-500">Loading—</p>
              </div>
            ) : !paymentMethods || paymentMethods.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-3 text-center">
                <div className="h-14 w-14 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center"><CreditCard className="h-6 w-6 text-slate-300" /></div>
                <div className="text-sm font-semibold text-slate-600">No recent payment methods</div>
                <div className="text-xs text-slate-400">Your payment methods will appear here after bookings.</div>
              </div>
            ) : (
              <div className="space-y-2">
                {paymentMethods.map((m: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 sm:p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center"><CreditCard className="h-4 w-4 text-slate-500" /></div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{String(m.method || m.ref || "Unknown").toUpperCase()}</div>
                        {m.ref && <div className="text-xs text-slate-500 font-mono">Ref: {maskRef(String(m.ref))}</div>}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">{m.paidAt ? new Date(m.paidAt).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }) : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* -- Account actions --------------------------------------------- */}
        <div className="lg:col-span-12 rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/60">
            <div className="text-sm font-bold text-slate-900">Account actions</div>
            <div className="text-sm text-slate-600 mt-1">Save changes, security, and account management.</div>
          </div>
          <div className="p-5 sm:p-6 grid grid-cols-2 gap-3">
            <button onClick={save} disabled={saving}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#02665e] text-white text-sm font-semibold hover:bg-[#02665e]/90 shadow-card transition-colors disabled:opacity-60 disabled:cursor-wait">
              <Save className="h-4 w-4" />{saving ? "Saving..." : "Save changes"}
            </button>
            <button onClick={() => { window.location.href = "/driver/security"; }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 shadow-card transition-colors">
              <Lock className="h-4 w-4" />Change password
            </button>
            <button onClick={async () => { try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch {} window.location.href = "/driver/login"; }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 shadow-card transition-colors">
              <LogOut className="h-4 w-4" />Logout
            </button>
            <button onClick={() => { setDeleteStep('confirm'); setDeleteNameInput(""); }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 shadow-card transition-colors">
              <Trash2 className="h-4 w-4" />Delete account
            </button>
          </div>
        </div>

      </div>
    </div>

    {/* Delete account modal */}
    {deleteStep !== null && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete account"
        className="fixed inset-0 z-[9999] flex items-center justify-center p-5 pt-16 pb-20 md:p-8"
        onClick={(e) => { if (e.target === e.currentTarget) { setDeleteStep(null); setDeleteNameInput(""); } }}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
        <div className="relative w-full max-w-md rounded-3xl bg-white shadow-[0_32px_80px_rgba(0,0,0,0.22)] overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-rose-500 via-rose-600 to-rose-500" />

          {deleteStep === 'confirm' && (
            <div className="p-5">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 border border-rose-100">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <h2 className="text-center text-base font-bold text-slate-900">Delete your account?</h2>
              <p className="mt-1.5 text-center text-xs text-slate-500">
                This action is <span className="font-semibold text-rose-600">permanent and irreversible</span>. Before you continue, understand what will be lost:
              </p>
              <ul className="mt-4 space-y-2 rounded-2xl border border-rose-100 bg-rose-50/60 px-3.5 py-3">
                {[
                  "Your driver profile, ratings, and trip history will be permanently deleted.",
                  "Pending payouts or outstanding balances may be forfeited.",
                  "Any active bookings linked to your account will be cancelled.",
                  "You will lose access immediately \u2014 no recovery is possible.",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-rose-800">
                    <AlertCircle className="mt-px h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-2.5">
                <button
                  onClick={() => { setDeleteStep(null); setDeleteNameInput(""); }}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors" style={{padding:"0.5rem 1rem"}}>
                  No, keep my account
                </button>
                <button
                  onClick={() => setDeleteStep('verify')}
                  className="flex-1 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 transition-colors">
                  Yes, continue
                </button>
              </div>
            </div>
          )}

          {deleteStep === 'verify' && (
            <div className="p-5">
              <button
                onClick={() => setDeleteStep('confirm')}
                className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 border border-rose-100">
                <Shield className="h-5 w-5 text-rose-600" />
              </div>
              <h2 className="text-center text-base font-bold text-slate-900">Final confirmation</h2>
              <p className="mt-1.5 text-center text-xs text-slate-500">
                Type your full name exactly as registered to confirm deletion.
              </p>
              <p className="mt-2.5 text-center text-xs font-mono font-semibold tracking-wide text-slate-700 bg-slate-100 rounded-lg py-1.5 px-3">
                {form.fullName || "\u2014"}
              </p>
              <input
                type="text"
                autoFocus
                autoComplete="off"
                placeholder="Type your full name\u2026"
                value={deleteNameInput}
                onChange={(e) => setDeleteNameInput(e.target.value)}
                className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/25"
              />
              <button
                disabled={deleteNameInput.trim() !== (form.fullName ?? "").trim() || deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await api.delete("/api/account");
                    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch {}
                    window.location.href = "/";
                  } catch (err: any) {
                    setDeleting(false);
                    setDeleteStep(null);
                    setDeleteNameInput("");
                    alert("Could not delete account: " + String(err?.message ?? err));
                  }
                }}
                className="mt-3 w-full rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40">
                {deleting ? "Deleting\u2026" : "Permanently delete my account"}
              </button>
              <p className="mt-3 text-center text-xs text-slate-400">This cannot be undone.</p>
            </div>
          )}
        </div>
      </div>
    )}
    {/* Driver ID Card Modal */}
    {showIdCard && me && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }}
        onClick={() => setShowIdCard(false)}
      >
        <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl mx-auto">
          <div className="flex justify-end mb-2">
            <button onClick={() => setShowIdCard(false)} className="h-9 w-9 rounded-full flex items-center justify-center bg-transparent text-white hover:bg-white/10 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-center text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-3">Your NoLSAF Driver ID</p>
          <div style={{ perspective: "1200px" }}>
            <div className="h-[240px]" style={{ position: "relative", transformStyle: "preserve-3d", transition: "transform 0.7s cubic-bezier(0.4,0,0.2,1)", transform: idCardFlipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
              {/* FRONT */}
              <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }} className="rounded-[20px] overflow-hidden shadow-2xl select-none">
                <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #0b1e35 0%, #0f2d4a 48%, #0c4a6e 100%)" }} />
                {/* Decorative background */}
                {/* Large hollow ring — bottom-right */}
                <div className="absolute pointer-events-none" style={{ width: 220, height: 220, borderRadius: "50%", border: "1.5px solid rgba(16,185,129,0.10)", bottom: -70, right: -50 }} />
                {/* Medium ring — top-right */}
                <div className="absolute pointer-events-none" style={{ width: 130, height: 130, borderRadius: "50%", border: "1px solid rgba(56,189,248,0.10)", top: -45, right: 40 }} />
                {/* Small ring — center-left area */}
                <div className="absolute pointer-events-none" style={{ width: 70, height: 70, borderRadius: "50%", border: "1px solid rgba(5,150,105,0.13)", top: "35%", left: "28%" }} />
                {/* Diagonal subtle lines overlay */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.04 }} preserveAspectRatio="none">
                  <defs><pattern id="diag" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="18" stroke="white" strokeWidth="0.8"/></pattern></defs>
                  <rect width="100%" height="100%" fill="url(#diag)" />
                </svg>
                {/* Glowing orb — top-right corner */}
                <div className="absolute pointer-events-none" style={{ width: 160, height: 100, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(3,105,161,0.22) 0%, transparent 70%)", top: -20, right: -20 }} />
                {/* Glowing orb — bottom-left */}
                <div className="absolute pointer-events-none" style={{ width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(5,150,105,0.14) 0%, transparent 70%)", bottom: -30, left: 80 }} />
                <div className="absolute top-0 left-0 bottom-0 w-[110px] sm:w-[140px]" style={{ background: "linear-gradient(180deg, rgba(5,150,105,0.18) 0%, rgba(3,105,161,0.22) 100%)", borderRight: "1px solid rgba(5,150,105,0.18)" }} />
                <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(180deg, #10b981 0%, #0369a1 100%)" }} />
                <div className="absolute bottom-0 left-[110px] sm:left-[140px] right-0 h-[3px]" style={{ background: "linear-gradient(90deg, #059669, #0369a1)" }} />
                <div className="relative flex flex-row h-full">
                  <div className="w-[110px] sm:w-[140px] flex-shrink-0 flex flex-col items-center justify-center gap-2 px-2 sm:px-3">
                    <div className="h-[88px] w-[88px] rounded-full overflow-hidden flex items-center justify-center" style={{ border: "2.5px solid rgba(5,150,105,0.7)", boxShadow: "0 0 0 4px rgba(5,150,105,0.13)", background: "linear-gradient(135deg, rgba(56,189,248,0.2), rgba(5,150,105,0.18))" }}>
                      {(form.avatarUrl || me.avatarUrl)
                        ? <img src={form.avatarUrl || me.avatarUrl} alt="driver" className="h-full w-full object-cover" />
                        : <span className="font-black text-white text-3xl">{((form.fullName || me.name || "?")[0] || "?").toUpperCase()}</span>}
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "#059669" }}>
                      <span className="text-[7px] font-black uppercase tracking-widest text-white">Verified</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between py-2 pr-4 pl-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/40">NoLSAF</p>
                        <p className="text-[10px] font-black text-white/55 tracking-widest">DRIVER ID CARD</p>
                      </div>
                      <button onClick={() => setIdCardFlipped(true)} className="h-6 w-6 rounded-full flex items-center justify-center" style={{ border: "1px solid rgba(255,255,255,0.15)", background: "transparent" }}>
                        <svg viewBox="0 0 10 10" className="h-3 w-3" fill="none"><path d="M3.5 2L6.5 5L3.5 8" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                    <div>
                      <p className="font-black text-white uppercase" style={{ fontSize: "clamp(0.85rem,3.5vw,1.1rem)", textShadow: "0 2px 10px rgba(0,0,0,0.4)" }}>{form.fullName || me.name}</p>
                      <p className="text-[8px] font-black uppercase tracking-[0.25em] text-emerald-400 mt-0.5">{(form.isVipDriver ?? me.isVipDriver) ? "✶ Premium Certified" : "NoLSAF Certified Driver"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <div><p className="text-[7px] font-bold uppercase tracking-widest text-white/35">ID No.</p><p className="text-[10px] font-black text-white mt-0">NLS-{String(me.id).padStart(4,"0")}-{new Date().getFullYear()}</p></div>
                      <div><p className="text-[7px] font-bold uppercase tracking-widest text-white/35">Plate No.</p><p className="text-[10px] font-black text-white mt-0 truncate">{form.plateNumber || form.vehiclePlate || me.plateNumber || me.vehiclePlate || "\u2014"}</p></div>
                      <div><p className="text-[7px] font-bold uppercase tracking-widest text-white/35">Vehicle</p><p className="text-[10px] font-black text-white mt-0 truncate">{[form.vehicleMake||me.vehicleMake, form.vehicleType||me.vehicleType].filter(Boolean).join(" \u00b7 ") || "\u2014"}</p></div>
                      <div><p className="text-[7px] font-bold uppercase tracking-widest text-white/35">Region</p><p className="text-[10px] font-black text-white mt-0 truncate">{form.operationArea||form.region||me.operationArea||me.region||"Tanzania"}</p></div>
                                            <div className="col-span-2 mt-1.5">
                        <div style={{ background: "#ffffff", borderRadius: "3px", padding: "4px 6px 2px" }}>
                          <svg width="100%" height="28" viewBox="0 0 210 28" preserveAspectRatio="xMidYMid meet" aria-hidden style={{ display: "block" }}>
                            {(()=>{ const p=[1,1,3,1,2,1,1,3,1,1,2,1,3,1,1,2,1,1,3,2,1,1,1,3,1,2,1,1,2,1,3,1,1,2,1,1,3,1,2,1,1,3,1,2,1,1,2,1,1,3,1,2,1,1,3,1,1,2,1,3,1,1,2,1,1,3,1,2,1,1,1,3,1,2,1,1,3,1,2,1,1,3,1,1,2,1,3]; const r:ReactElement[]=[]; let x=2; p.forEach((w,i)=>{ if(i%2===0){r.push(<rect key={i} x={x} y={1} width={w} height={26} fill="#1a1a1a"/>);} x+=w; }); return r; })()}
                          </svg>
                          <p style={{ textAlign:"center", fontFamily:"monospace", fontSize:"5.5px", letterSpacing:"0.28em", color:"#444", marginTop:"1px", lineHeight:1 }}>NLS-{String(me.id).padStart(4,"0")}-{new Date().getFullYear()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* BACK FACE */}
              <div
                style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                className="rounded-[20px] overflow-hidden shadow-2xl select-none"
              >
                <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #0b1e35 0%, #0f2d4a 55%, #0c4a6e 100%)" }} />
                {/* Decorative background */}
                <div className="absolute pointer-events-none" style={{ width: 200, height: 200, borderRadius: "50%", border: "1.5px solid rgba(16,185,129,0.09)", bottom: -70, right: -60 }} />
                <div className="absolute pointer-events-none" style={{ width: 100, height: 100, borderRadius: "50%", border: "1px solid rgba(56,189,248,0.10)", top: -30, right: 60 }} />
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.035 }} preserveAspectRatio="none">
                  <defs><pattern id="diagB" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="18" stroke="white" strokeWidth="0.8"/></pattern></defs>
                  <rect width="100%" height="100%" fill="url(#diagB)" />
                </svg>
                <div className="absolute pointer-events-none" style={{ width: 180, height: 120, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(3,105,161,0.18) 0%, transparent 70%)", top: -30, right: -20 }} />
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500" />
                <div className="relative flex flex-row h-full">
                  <div className="w-[5px] flex-shrink-0" style={{ background: "linear-gradient(180deg, #10b981 0%, #0369a1 100%)" }} />
                  <div className="flex-1 min-w-0 flex flex-col py-3 px-4">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="text-[8px] font-black uppercase tracking-[0.28em]" style={{color:"rgba(255,255,255,0.35)"}}>NoLSAF \u00b7 Driver Profile</p>
                        <p className="text-[13px] font-black text-white mt-0.5 leading-none truncate">{form.fullName||me.name||"\u2014"}</p>
                      </div>
                      <button onClick={() => setIdCardFlipped(false)} className="h-6 w-6 rounded-full flex items-center justify-center ml-2 flex-shrink-0" style={{ border: "1px solid rgba(255,255,255,0.15)", background: "transparent" }}>
                        <svg viewBox="0 0 10 10" className="h-3 w-3" fill="none"><path d="M6.5 2L3.5 5L6.5 8" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                    <div className="mt-2 mb-2 h-px" style={{background:"linear-gradient(90deg,rgba(16,185,129,0.45),rgba(255,255,255,0.08),transparent)"}} />
                    <p className="text-[9px] leading-[1.65] text-white/65 mb-2 overflow-hidden" style={{maxHeight:"50px"}}>
                      {pickExtendedBio({ name: form.fullName||me.name, rating: me.rating, isVipDriver: form.isVipDriver??me.isVipDriver, operationArea: form.operationArea||me.operationArea, district: form.district||me.district, vehicleMake: form.vehicleMake||me.vehicleMake })}
                    </p>
                    <p className="text-[6.5px] font-black uppercase tracking-[0.32em] mb-1.5" style={{color:"rgba(52,211,153,0.55)"}}>Service Commitments</p>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                      {["Safety-first on every road","On-time, every time","Licensed \u0026 NoLSAF-verified","Clean vehicle, smooth ride"].map((item,i) => (
                        <div key={i} className="flex items-center gap-1.5 min-w-0">
                          <span className="flex-shrink-0 h-3.5 w-3.5 rounded-full flex items-center justify-center" style={{ background: "rgba(5,150,105,0.25)", border: "1.5px solid rgba(5,150,105,0.5)" }}>
                            <svg viewBox="0 0 6 6" className="h-2 w-2"><path d="M1 3L2.5 4.5L5 1.5" stroke="#10b981" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>
                          </span>
                          <p className="text-[9px] font-semibold leading-tight truncate" style={{color:"rgba(255,255,255,0.68)"}}>{item}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex-1" />
                    <div className="pt-2 border-t" style={{borderColor:"rgba(255,255,255,0.08)"}}>
                      <div className="flex items-center gap-2">
                        <p className="text-[7px] font-black uppercase tracking-widest flex-shrink-0" style={{color:"rgba(255,255,255,0.28)"}}>NoLSAF \u00a9 {new Date().getFullYear()}</p>
                        <svg className="flex-1" height="16" viewBox="0 0 130 16" preserveAspectRatio="xMidYMid meet" aria-hidden style={{background:"rgba(255,255,255,0.12)",borderRadius:"2px"}}>
                          {(()=>{ const pat=[1,1,3,1,2,1,1,2,1,1,3,1,1,2,1,3,1,1,2,1,1,3,1,2,1,1,2,3,1,1,2,1,1,3,1,1,2,1,3,1,1,2,1,1,3,2,1,1,2,1,3]; const r:ReactElement[]=[]; let x=2; pat.forEach((w,i)=>{ if(i%2===0){ r.push(<rect key={i} x={x} y={0} width={w} height={16} fill="rgba(255,255,255,0.85)"/>); } x+=w; }); return r; })()}
                        </svg>
                        <p className="text-[7px] font-mono tracking-widest flex-shrink-0" style={{color:"rgba(255,255,255,0.28)"}}>NLS-{String(me.id).padStart(4,"0")}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-center text-[10px] text-white/30 mt-3">Tap › to flip · tap backdrop to close</p>
        </div>
      </div>
    )}
    </>
  );
}
