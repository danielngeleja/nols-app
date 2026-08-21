"use client";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Link from "next/link";
import axios from "axios";import apiClient from "@/lib/apiClient";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, Clock,
  Eye, FileText, History, Lock, LogOut, Mail, MapPin, Pencil,
  Phone, Save, Trash2, Upload, User, X, AlertTriangle,
  ChevronDown, ChevronUp, ShieldCheck,
} from 'lucide-react';
import DatePickerField from "@/components/DatePickerField";
import SecurePayoutPreferenceCard from "@/components/SecurePayoutPreferenceCard";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type PayoutVerificationPreview = {
  challengeToken: string;
  expiresAt: string;
  destination: {
    type: "BANK" | "MOBILE_MONEY";
    provider: string;
    accountName: string;
    accountNumber: string;
    currency: string;
  };
  capabilities?: {
    nameLookupVerified: boolean;
    azamPayDisbursementEnabled: boolean;
  };
  draft: Record<string, string>;
};

type ContactChangeState = {
  field: "email" | "phone";
  value: string;
  stage: "ENTER" | "AUTHORIZE_EXISTING" | "VERIFY_NEW" | "STEP_UP";
  code: string;
  sentTo: string;
  currentPassword: string;
  totpCode: string;
  methods: { password: boolean; totp: boolean };
};



function EditableInfoItem({
  icon, label, value, fieldKey, fieldType = "text", selectOptions,
  editingField, onStartEdit, onStopEdit, onChange, maskFn,
}: {
  icon: React.ReactNode;
  label: string;
  value: any;
  fieldKey: string;
  fieldType?: "text" | "select" | "tel" | "textarea";
  selectOptions?: { value: string; label: string }[];
  editingField: string | null;
  onStartEdit: (k: string) => void;
  onStopEdit: () => void;
  onChange: (k: string, v: string) => void;
  maskFn?: (v: string) => string;
}) {
  const editing = editingField === fieldKey;
  const display = value ? (maskFn ? maskFn(String(value)) : value) : "—";

  if (editing) {
    return (
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md border border-[#02665e]/20 bg-[#02665e]/[0.03] p-3">
        <div className="flex items-center justify-between gap-1 mb-1.5 w-full min-w-0 max-w-full">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onStopEdit(); }}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md">
        {fieldType === "select" && selectOptions ? (
          <select
            value={value || ""}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            autoFocus
            onBlur={onStopEdit}
            className="block w-full min-w-0 max-w-full box-border rounded-md border border-[#02665e]/30 bg-[#02665e]/5 px-3 py-2.5 text-sm font-medium text-slate-800 focus:border-[#02665e] focus:bg-white focus:outline-none focus:ring-0"
          >
            <option value="">Select</option>
            {selectOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : fieldType === "textarea" ? (
          <textarea
            value={value || ""}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            autoFocus
            onBlur={onStopEdit}
            rows={3}
            className="block w-full min-w-0 max-w-full resize-none box-border rounded-md border border-[#02665e]/30 bg-[#02665e]/5 px-3 py-2.5 text-sm font-medium text-slate-800 focus:border-[#02665e] focus:bg-white focus:outline-none focus:ring-0"
          />
        ) : (
          <input
            type={fieldType === "tel" ? "tel" : "text"}
            value={value || ""}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            autoFocus
            onBlur={onStopEdit}
            onKeyDown={(e) => { if (e.key === "Enter") onStopEdit(); }}
            className="block w-full min-w-0 max-w-full box-border rounded-md border border-[#02665e]/30 bg-[#02665e]/5 px-3 py-2.5 text-sm font-medium text-slate-800 focus:border-[#02665e] focus:bg-white focus:outline-none focus:ring-0"
          />
        )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex min-w-0 items-start gap-3 overflow-hidden rounded-md border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50/60">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-[#02665e]/[0.06] text-[#02665e] [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-xs font-medium text-slate-500">{label}</div>
          <button
            type="button"
            onClick={() => onStartEdit(fieldKey)}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-400 opacity-100 transition-all hover:bg-[#02665e]/10 hover:text-[#02665e] focus-visible:outline-none sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            aria-label={"Edit " + label}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <div title={value ? String(value) : undefined} className={"mt-1 truncate text-sm font-semibold leading-5 " + (!value ? "text-slate-400" : "text-slate-800")}>
          {display}
        </div>
      </div>
    </div>
  );
}


export default function OwnerProfile() {
  const [form, setForm] = useState<any>({});
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutSuccess, setPayoutSuccess] = useState<string | null>(null);
  const [payoutPreview, setPayoutPreview] = useState<PayoutVerificationPreview | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [contactChange, setContactChange] = useState<ContactChangeState | null>(null);
  const [contactChangeLoading, setContactChangeLoading] = useState(false);
  const [contactChangeError, setContactChangeError] = useState<string | null>(null);
  const [auditHistory, setAuditHistory] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [showAllAuditHistory, setShowAllAuditHistory] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();

  const [docUploading, setDocUploading] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docSuccess, setDocSuccess] = useState<string | null>(null);
  const [docHelpOpen, setDocHelpOpen] = useState(false);
  const docHelpRef = useRef<HTMLDivElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocType, setSelectedDocType] = useState<string>("");
  const [businessLicenceExpiresOn, setBusinessLicenceExpiresOn] = useState<string>("");
  // Delete account
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'verify'>('confirm');
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);


  const requiredDocTypes = useMemo(
    () =>
      [
        { type: "BUSINESS_LICENCE", label: "Business Licence" },
        { type: "TIN_CERTIFICATE", label: "TIN Number Certificate" },
      ] as const,
    [],
  );

  type CloudinarySig = {
    timestamp: number;
    signature: string;
    folder: string;
    cloudName: string;
    apiKey: string;
  };

  async function uploadToCloudinary(file: File, folder: string) {
    const sig = await api.get(`/api/uploads/cloudinary/sign?folder=${encodeURIComponent(folder)}`);
    const sigData = sig.data as CloudinarySig;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("timestamp", String(sigData.timestamp));
    fd.append("api_key", sigData.apiKey);
    fd.append("signature", sigData.signature);
    fd.append("folder", sigData.folder);
    fd.append("overwrite", "true");
    const resp = await axios.post(`https://api.cloudinary.com/v1_1/${sigData.cloudName}/auto/upload`, fd);
    return (resp.data as { secure_url: string }).secure_url;
  }

  const uploadAvatar = async (file: File) => {
    setError(null);
    setSuccess(null);
    setAvatarUploading(true);
    try {
      const url = await uploadToCloudinary(file, "avatars");
      await api.put("/api/account/profile", { avatarUrl: url });

      setForm((prev: any) => ({ ...prev, avatarUrl: url }));
      try {
        const updatedMe = { ...(me ?? {}), avatarUrl: url };
        setMe(updatedMe);
        try { (window as any).ME = updatedMe; } catch { /* ignore */ }
      } catch { /* ignore */ }

      try {
        window.dispatchEvent(new CustomEvent("nolsaf:profile-updated", { detail: { avatarUrl: url } }));
      } catch {
        // ignore
      }

      setSuccess("Profile photo updated.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      console.warn("Failed to upload avatar", e);
      setError("Failed to upload profile photo. Please try again.");
    } finally {
      setAvatarUploading(false);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
    }
  };

  function getLatestDocByType(docs: any[] | undefined | null, type: string) {
    const canonicalType = (value: unknown) => {
      const normalized = String(value ?? "").trim().toUpperCase();
      if (["BUSINESS_LICENSE", "BUSINESS_LISENCE"].includes(normalized)) return "BUSINESS_LICENCE";
      if (["TIN_NUMBER", "TIN", "TIN_NUMBER_CERTIFICATE"].includes(normalized)) return "TIN_CERTIFICATE";
      return normalized;
    };
    const normalizedType = canonicalType(type);
    const items = Array.isArray(docs) ? docs : [];
    for (const d of items) {
      if (canonicalType(d?.type) === normalizedType) return d;
    }
    return null;
  }

  const allowedDocTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

  const todayIsoDate = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const parseDocExpiresAt = (doc: any): Date | null => {
    const raw = doc?.metadata?.expiresAt ?? doc?.metadata?.expires_on ?? doc?.metadata?.expiresOn;
    if (!raw) return null;
    const d = new Date(String(raw));
    if (!Number.isFinite(d.getTime())) return null;
    return d;
  };

  const isBusinessLicenceExpired = useCallback((doc: any): boolean => {
    const exp = parseDocExpiresAt(doc);
    if (!exp) return false;
    return exp.getTime() < Date.now();
  }, []);

  const uploadDocumentForType = async (type: string, file: File | null) => {
    if (!file || !type) return;
    setDocError(null);
    setDocSuccess(null);

    const normalizedType = String(type).toUpperCase();
    const isBusinessLicence = normalizedType === "BUSINESS_LICENCE";
    if (isBusinessLicence) {
      if (!businessLicenceExpiresOn) {
        setDocError("Please enter the Business Licence expiry date before uploading.");
        return;
      }
      const parsed = new Date(`${businessLicenceExpiresOn}T23:59:59.999Z`);
      if (!Number.isFinite(parsed.getTime())) {
        setDocError("Please enter a valid expiry date.");
        return;
      }
      const minIso = todayIsoDate();
      if (String(businessLicenceExpiresOn) < String(minIso)) {
        setDocError("Expiry date must be today or later.");
        return;
      }
    }

    if (!allowedDocTypes.has(file.type)) {
      setDocError("Please choose a PDF or image file (PDF, JPG, PNG, WebP).");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setDocError("File is too large. Maximum size is 15MB.");
      return;
    }

    try {
      setDocUploading(type);
      const url = await uploadToCloudinary(file, "owner-documents");
      const expiresAtIso = normalizedType === "BUSINESS_LICENCE" && businessLicenceExpiresOn
        ? new Date(`${businessLicenceExpiresOn}T23:59:59.999Z`).toISOString()
        : null;
      const resp = await api.put("/api/account/documents", {
        type,
        url,
        metadata: {
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          ...(expiresAtIso
            ? { expiresAt: expiresAtIso, expiresOn: businessLicenceExpiresOn }
            : null),
        },
      });

      const saved = (resp as any)?.data?.data?.doc ?? (resp as any)?.data?.doc ?? null;

      const applySavedDoc = (prev: any) => {
        if (!prev) return prev;
        const docs = Array.isArray(prev.documents) ? prev.documents : [];
        const nextDocs = saved ? [saved, ...docs.filter((d: any) => d?.id !== saved?.id)] : docs;
        return { ...prev, documents: nextDocs };
      };

      setMe(applySavedDoc);
      setForm(applySavedDoc);
      setDocSuccess("Document uploaded. Pending admin review.");
    } catch (e: any) {
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message;
      setDocError(String(serverMsg || e?.message || "Failed to upload document. Please try again."));
    } finally {
      setDocUploading(null);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  const triggerDocUpload = () => {
    setDocError(null);
    setDocSuccess(null);
    docInputRef.current?.click();
  };

  const onUploadDocumentFromPicker = async (file: File | null) => {
    await uploadDocumentForType(selectedDocType, file);
  };

  const documentsUnavailable = Boolean(me?.documentsUnavailable) || (Boolean(me) && !Array.isArray(me?.documents));

  const actionableDocTypes = useMemo(() => {
    if (documentsUnavailable) return [];
    const docs = Array.isArray(me?.documents) ? me.documents : [];
    return requiredDocTypes.filter((t) => {
      const doc = getLatestDocByType(docs, t.type);
      const hasUrl = Boolean(doc?.url);
      const status = (doc?.status ? String(doc.status) : "").toUpperCase();
      const expired = t.type === "BUSINESS_LICENCE" && status === "APPROVED" && isBusinessLicenceExpired(doc);
      if (!hasUrl) return true;
      if (status === "REJECTED") return true;
      if (expired) return true;
      return false;
    });
  }, [documentsUnavailable, me?.documents, requiredDocTypes, isBusinessLicenceExpired]);

  const showUploader = actionableDocTypes.length > 0;

  useEffect(() => {
    if (!selectedDocType) return;
    const stillSelectable = actionableDocTypes.some((t) => t.type === selectedDocType);
    if (!stillSelectable) setSelectedDocType("");
  }, [actionableDocTypes, selectedDocType]);

  useEffect(() => {
    if (String(selectedDocType).toUpperCase() !== "BUSINESS_LICENCE") {
      setBusinessLicenceExpiresOn("");
    }
  }, [selectedDocType]);

  useEffect(() => {
    if (!docHelpOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDocHelpOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const root = docHelpRef.current;
      if (!root) return;
      if (root.contains(e.target as Node)) return;
      setDocHelpOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [docHelpOpen]);

  // Check for email verification success
  useEffect(() => {
    if (searchParams?.get('email_verified') === '1') {
      setSuccess('Email verified successfully!');
      // Refresh user data
      api.get("/api/account/me").then((r) => {
        const meData = (r as any)?.data?.data ?? (r as any)?.data;
        setMe(meData);
        setForm((prev: any) => ({ ...prev, emailVerifiedAt: meData?.emailVerifiedAt }));
      }).catch(() => {});
      // Remove query parameter from URL
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('email_verified');
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.get("/api/account/me");
        if (!mounted) return;
        // `/api/account/me` returns `{ ok: true, data: user }`
        // but some callers historically expected the user object directly.
        const meData = (r as any)?.data?.data ?? (r as any)?.data;
        const meRole = String(meData?.role || '').toUpperCase();
        // Check if user is an owner
        if (meRole !== 'OWNER' && meRole !== 'ADMIN') {
          window.location.href = '/owner/login';
          return;
        }
        
        // Extract payout data from JSON field and merge into form data
        const payoutData = (meData?.payout && typeof meData.payout === 'object') ? meData.payout : {};
        
        // Helper to normalize empty strings to null
        const normalizeValue = (val: any) => {
          if (val === undefined || val === null || val === '') return null;
          return String(val).trim() || null;
        };
        
        const formData = {
          ...meData,
          // Extract payout fields to top level for form - API now attaches these directly to user object
          // Use || instead of ?? to handle empty strings
          bankAccountName: normalizeValue(meData.bankAccountName || payoutData.bankAccountName),
          bankName: normalizeValue(meData.bankName || payoutData.bankName),
          bankAccountNumber: normalizeValue(meData.bankAccountNumber || payoutData.bankAccountNumber),
          bankBranch: normalizeValue(meData.bankBranch || payoutData.bankBranch),
          mobileMoneyProvider: normalizeValue(meData.mobileMoneyProvider || payoutData.mobileMoneyProvider),
          mobileMoneyNumber: normalizeValue(meData.mobileMoneyNumber || payoutData.mobileMoneyNumber),
          payoutPreferred: normalizeValue(meData.payoutPreferred || payoutData.payoutPreferred),
        };
        
        setForm(formData);
        setMe(formData);
        try { (window as any).ME = formData; } catch (e) { /* ignore */ }
      } catch (err: any) {
        console.error('Failed to load profile', err);
        if (mounted) setError(String(err?.message ?? err));
        const status = err?.response?.status;
        const code = err?.response?.data?.code;
        if (status === 403 && code === 'ACCOUNT_SUSPENDED') {
          return;
        }
        if (typeof window !== 'undefined') window.location.href = '/owner/login';
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Load audit history
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingAudit(true);
      try {
        const r = await api.get("/api/account/audit-history", { params: { page: 1, pageSize: 20 } });
        if (!mounted) return;
        const data = (r as any)?.data?.data;
        if (data?.items) {
          setAuditHistory(data.items);
        }
      } catch (err) {
        console.warn('Failed to load audit history', err);
      } finally {
        if (mounted) setLoadingAudit(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const normalizeE164Phone = (raw: unknown): string | undefined => {
    if (raw === null || raw === undefined) return undefined;
    const s = String(raw).trim().replace(/\s+/g, '');
    if (!s) return undefined;
    if (s.startsWith('+')) return s;
    // Best-effort TZ normalization (common in this app). If unsure, keep original.
    if (/^0\d{9}$/.test(s)) return `+255${s.slice(1)}`;
    if (/^\d{9}$/.test(s)) return `+255${s}`;
    return s;
  };

  const isValidUrl = (value: string) => {
    try {
      // eslint-disable-next-line no-new
      new URL(value);
      return true;
    } catch {
      return false;
    }
  };

  const openContactChange = (field: "email" | "phone") => {
    setContactChangeError(null);
    setContactChange({
      field,
      value: String(form?.[field] || me?.[field] || ""),
      stage: "ENTER",
      code: "",
      sentTo: "",
      currentPassword: "",
      totpCode: "",
      methods: { password: false, totp: false },
    });
  };

  const requestSecureContactChange = async () => {
    if (!contactChange) return;
    setContactChangeLoading(true);
    setContactChangeError(null);
    try {
      const normalizedValue = contactChange.field === "phone"
        ? String(normalizeE164Phone(contactChange.value) || "")
        : contactChange.value.trim().toLowerCase();
      if (contactChange.field === "phone" && !/^\+?[1-9]\d{1,14}$/.test(normalizedValue)) {
        setContactChangeError("Enter the phone number in international format, for example +2557XXXXXXXX.");
        return;
      }
      if (contactChange.field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedValue)) {
        setContactChangeError("Enter a valid email address.");
        return;
      }
      const response = await api.post("/api/account/contact/request-change", {
        field: contactChange.field,
        value: normalizedValue,
        ...(contactChange.currentPassword ? { currentPassword: contactChange.currentPassword } : {}),
        ...(contactChange.totpCode ? { totpCode: contactChange.totpCode } : {}),
      });
      const data = (response as any)?.data?.data ?? {};
      setContactChange((current) => current ? {
        ...current,
        value: normalizedValue,
        stage: data.stage === "AUTHORIZE_EXISTING" ? "AUTHORIZE_EXISTING" : "VERIFY_NEW",
        sentTo: String(data.sentTo || "your security contact"),
        code: "",
        currentPassword: "",
        totpCode: "",
      } : current);
    } catch (err: any) {
      const serverData = err?.response?.data;
      if (serverData?.code === "CONTACT_CHANGE_STEP_UP_REQUIRED") {
        setContactChange((current) => current ? {
          ...current,
          stage: "STEP_UP",
          methods: {
            password: Boolean(serverData?.methods?.password),
            totp: Boolean(serverData?.methods?.totp),
          },
        } : current);
      }
      setContactChangeError(String(serverData?.error || "Could not start the secure contact change."));
    } finally {
      setContactChangeLoading(false);
    }
  };

  const submitContactChangeCode = async () => {
    if (!contactChange || !/^\d{6}$/.test(contactChange.code)) return;
    setContactChangeLoading(true);
    setContactChangeError(null);
    try {
      if (contactChange.stage === "AUTHORIZE_EXISTING") {
        const response = await api.post("/api/account/contact/authorize-change", {
          field: contactChange.field,
          otp: contactChange.code,
        });
        const data = (response as any)?.data?.data ?? {};
        setContactChange((current) => current ? {
          ...current,
          stage: "VERIFY_NEW",
          code: "",
          sentTo: String(data.sentTo || "the new contact"),
        } : current);
        return;
      }

      const response = await api.post("/api/account/contact/confirm-change", {
        field: contactChange.field,
        otp: contactChange.code,
      });
      const data = (response as any)?.data?.data ?? {};
      const verifiedUser = data.user ?? {};
      setForm((current: any) => ({ ...current, ...verifiedUser }));
      setMe((current: any) => {
        const updated = { ...(current ?? {}), ...verifiedUser };
        try { (window as any).ME = updated; } catch { /* ignore */ }
        return updated;
      });
      setContactChange(null);
      setSuccess(data.securityCooldownUntil
        ? "Contact updated securely. Payout destination changes are protected during the 72-hour cooling period."
        : "Contact verified successfully.");
    } catch (err: any) {
      const serverData = err?.response?.data;
      const attempts = Number(serverData?.attemptsRemaining);
      setContactChangeError(
        String(serverData?.error || "The security code could not be confirmed.") +
        (Number.isFinite(attempts) ? ` ${attempts} attempt${attempts === 1 ? "" : "s"} remaining.` : "")
      );
      if (serverData?.code === "CONTACT_CHANGE_LOCKED" || serverData?.code === "CONTACT_CHANGE_EXPIRED") {
        setContactChange((current) => current ? { ...current, stage: "ENTER", code: "", sentTo: "" } : current);
      }
    } finally {
      setContactChangeLoading(false);
    }
  };

  const performSave = async () => {
    setSaving(true);
    setEditingField(null); // Close any open edit fields
    try {
      const payload: any = {};
      const fullName = String(form.fullName || form.name || '').trim();
      if (fullName) payload.fullName = fullName;

      const avatarUrl = String(form.avatarUrl || '').trim();
      if (avatarUrl) {
        // API requires a real URL (data: URLs will be rejected).
        if (!isValidUrl(avatarUrl) || avatarUrl.startsWith('data:')) {
          // Ignore invalid avatarUrl instead of failing the entire save.
          console.warn('Ignoring invalid avatarUrl for profile update');
        } else {
          payload.avatarUrl = avatarUrl;
        }
      }

      const tin = String(form.tin || '').trim();
      if (tin) payload.tin = tin;

      const address = String(form.address || '').trim();
      if (address) payload.address = address;

      await api.put("/api/account/profile", payload);
      // Profile writes are independent from payout verification and documents.
      setMe((current: any) => {
        const updated = { ...(current ?? {}), ...payload };
        try { (window as any).ME = updated; } catch { /* ignore */ }
        return updated;
      });
      
      setSuccess("Profile saved successfully!");
      setError(null);
      // Auto-hide success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
      // update local `me` shortcut and global window.ME
      try {
        const updatedMe = { ...(me ?? {}), ...payload };
        setMe(updatedMe);
        try { (window as any).ME = updatedMe; } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
      
      // Reload audit history after save
      try {
        const r = await api.get("/api/account/audit-history", { params: { page: 1, pageSize: 20 } });
        const data = (r as any)?.data?.data;
        if (data?.items) {
          setAuditHistory(data.items);
        }
      } catch (err) {
        console.warn('Failed to reload audit history', err);
      }
    } catch (err: any) {
      console.error('Failed to save profile', err);
      const serverData = err?.response?.data;
      const serverMessage = serverData?.error || serverData?.message;
      const details = Array.isArray(serverData?.details) ? serverData.details : null;
      const detailsText = details
        ? details.map((d: any) => d?.message).filter(Boolean).join('; ')
        : '';
      setError(
        'Could not save profile: ' +
          String(serverMessage || err?.message || err) +
          (detailsText ? ` (${detailsText})` : '')
      );
      setSuccess(null);
    } finally {
      setSaving(false);
    }
  };

  const save = async () => performSave();

  const buildPayoutDraft = () => {
    const preferred = String(form.payoutPreferred || "").trim().toUpperCase();
    return preferred === "BANK"
      ? {
          payoutPreferred: "BANK",
          bankName: String(form.bankName || "").trim(),
          bankAccountName: String(form.bankAccountName || "").trim(),
          bankAccountNumber: String(form.bankAccountNumber || "").trim(),
          bankBranch: String(form.bankBranch || "").trim(),
        }
      : {
          payoutPreferred: "MOBILE_MONEY",
          mobileMoneyProvider: String(form.mobileMoneyProvider || "").trim(),
          mobileMoneyNumber: String(form.mobileMoneyNumber || "").trim(),
        };
  };

  const requestPayoutSave = async () => {
    setPayoutError(null);
    setPayoutSuccess(null);
    setPayoutPreview(null);
    if (!payoutDetailsOk) {
      setPayoutError('Complete the selected payout destination before verifying.');
      return;
    }
    if (!payoutChanged) {
      setPayoutSuccess('This payout destination is already saved.');
      return;
    }

    setPayoutSaving(true);
    try {
      const draft = buildPayoutDraft();
      const response = await api.post('/api/account/payouts/verify', draft);
      const verification = (response as any)?.data?.data;
      if (!verification?.challengeToken || !verification?.destination?.accountName) {
        throw new Error('AzamPay did not return a valid account holder confirmation.');
      }
      setPayoutPreview({ ...verification, draft });
    } catch (err: any) {
      console.error('Failed to verify payout destination', err);
      const serverData = err?.response?.data;
      const failureCode = String(serverData?.code || '');
      if (failureCode === 'PAYOUT_PROVIDER_NOT_CONFIGURED') {
        setPayoutError('Payout verification is not configured. Your previous payout destination remains unchanged.');
      } else {
        setPayoutError(
          String(serverData?.error || serverData?.message || err?.message || 'Payout verification failed. Your previous payout destination remains unchanged.')
        );
      }
    } finally {
      setPayoutSaving(false);
    }
  };

  const confirmPayoutDestination = async () => {
    if (!payoutPreview) return;
    setPayoutSaving(true);
    setPayoutError(null);
    try {
      const response = await api.put('/api/account/payouts', { challengeToken: payoutPreview.challengeToken });
      const verifiedAccount = (response as any)?.data?.data?.payoutAccount;
      const preferred = payoutPreview.destination.type;
      const verifiedPatch = preferred === "BANK"
        ? {
            ...payoutPreview.draft,
            bankAccountName: String(verifiedAccount?.accountName || payoutPreview.destination.accountName).trim(),
            mobileMoneyProvider: "",
            mobileMoneyNumber: "",
            mobileMoneyAccountName: "",
          }
        : {
            ...payoutPreview.draft,
            mobileMoneyAccountName: String(verifiedAccount?.accountName || payoutPreview.destination.accountName).trim(),
            bankName: "",
            bankAccountName: "",
            bankAccountNumber: "",
            bankBranch: "",
          };

      setForm((current: any) => ({ ...current, ...verifiedPatch }));
      setMe((current: any) => {
        const updated = { ...(current ?? {}), ...verifiedPatch };
        try { (window as any).ME = updated; } catch { /* ignore */ }
        return updated;
      });
      setPayoutPreview(null);
      setPayoutSuccess(
        preferred === "BANK"
          ? "Bank account name verified and saved. Automated AzamPay bank payout remains disabled."
          : "Payout destination verified and saved."
      );
    } catch (err: any) {
      console.error('Failed to confirm payout destination', err);
      const serverData = err?.response?.data;
      const failureCode = String(serverData?.code || '');
      if (failureCode === 'PAYOUT_VERIFICATION_EXPIRED') {
        setPayoutPreview(null);
        setPayoutError('This verification has expired or was already used. Verify the destination again.');
      } else {
        setPayoutError(
          String(serverData?.error || serverData?.message || 'The verified destination could not be saved. Your previous destination remains unchanged.')
        );
      }
    } finally {
      setPayoutSaving(false);
    }
  };

  const avatarUrl = (form?.avatarUrl || me?.avatarUrl || null) as string | null;
  const bypassAvatarOptimizer = Boolean(avatarUrl && /^https?:\/\//i.test(avatarUrl));
  const displayName = String(form?.fullName || form?.name || me?.fullName || me?.name || '').trim();
  const emailValue = String(form?.email || me?.email || '').trim();
  const phoneValue = String(form?.phone || me?.phone || '').trim();
  const tinValue = String(form?.tin || me?.tin || '').trim();
  const addressValue = String(form?.address || me?.address || '').trim();

  const requiredDocsOk = useMemo(() => {
    return requiredDocTypes.every((t) => {
      const doc = getLatestDocByType(me?.documents, t.type);
      const hasUrl = Boolean(doc?.url);
      const status = (doc?.status ? String(doc.status) : '').toUpperCase();
      if (!hasUrl) return false;
      if (status === 'REJECTED') return false;

      if (t.type === 'BUSINESS_LICENCE') {
        const exp = parseDocExpiresAt(doc);
        if (!exp) return false;
        if (status === 'APPROVED' && isBusinessLicenceExpired(doc)) return false;
      }
      return true;
    });
  }, [isBusinessLicenceExpired, me?.documents, requiredDocTypes]);

  const payoutPreferred = String(form?.payoutPreferred || me?.payoutPreferred || '').toUpperCase();
  const payoutDetailsOk = useMemo(() => {
    if (!payoutPreferred) return false;
    if (payoutPreferred === 'BANK') {
      const bankName = String(form?.bankName || me?.bankName || '').trim();
      const bankAccountName = String(form?.bankAccountName || me?.bankAccountName || '').trim();
      const bankAccountNumber = String(form?.bankAccountNumber || me?.bankAccountNumber || '').trim();
      return Boolean(bankName && bankAccountName && bankAccountNumber);
    }
    if (payoutPreferred === 'MOBILE_MONEY') {
      const provider = String(form?.mobileMoneyProvider || me?.mobileMoneyProvider || '').trim();
      const number = String(form?.mobileMoneyNumber || me?.mobileMoneyNumber || '').trim();
      return Boolean(provider && number);
    }
    return true;
  }, [
    form?.bankAccountName,
    form?.bankAccountNumber,
    form?.bankName,
    form?.mobileMoneyNumber,
    form?.mobileMoneyProvider,
    me?.bankAccountName,
    me?.bankAccountNumber,
    me?.bankName,
    me?.mobileMoneyNumber,
    me?.mobileMoneyProvider,
    payoutPreferred,
  ]);

  const payoutChanged = useMemo(() => {
    const payoutKeys = [
      'payoutPreferred',
      'bankName',
      'bankAccountName',
      'bankAccountNumber',
      'bankBranch',
      'mobileMoneyProvider',
      'mobileMoneyNumber',
    ];
    return payoutKeys.some((key) => String(form?.[key] || '').trim() !== String(me?.[key] || '').trim());
  }, [form, me]);

  const profileCompletion = useMemo(() => {
    const checks: Array<boolean> = [
      Boolean(avatarUrl),
      Boolean(displayName && displayName !== '—'),
      Boolean(emailValue),
      Boolean(phoneValue),
      Boolean(tinValue),
      Boolean(addressValue),
      requiredDocsOk,
      Boolean(payoutPreferred),
      payoutDetailsOk,
    ];

    const total = checks.length;
    const done = checks.filter(Boolean).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return { pct, done, total };
  }, [addressValue, avatarUrl, displayName, emailValue, phoneValue, payoutDetailsOk, payoutPreferred, requiredDocsOk, tinValue]);

  const completionTone = useMemo(() => {
    const pct = profileCompletion.pct;
    if (pct >= 80) return 'good' as const;
    if (pct >= 50) return 'warn' as const;
    return 'bad' as const;
  }, [profileCompletion.pct]);

  if (loading) {
    return (
      <div className="w-full max-w-full flex items-center justify-center py-12">
        <div className="text-center">
          <div className="dot-spinner dot-md mx-auto" aria-hidden>
            <span className="dot dot-blue" />
            <span className="dot dot-black" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </div>
          <p className="text-sm text-slate-500 mt-4">Loading profile...</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="w-full max-w-full">
        <div className="rounded-md bg-red-50 border-2 border-red-200 p-4">
          <div className="text-sm font-medium text-red-800">Error loading profile: {error}</div>
        </div>
      </div>
    );
  }

  const editProps = {

    editingField,

    onStartEdit: (k: string) => {
      if (k === "email" || k === "phone") {
        openContactChange(k);
        return;
      }
      setEditingField(k);
    },

    onStopEdit: () => setEditingField(null),

    onChange: (k: string, v: string) => setForm((p: any) => ({ ...p, [k]: v })),

  };



  return (

    <div className="w-full py-2 sm:py-4">



      {/* -- Hero banner --------------------------------------------------- */}

      <div className="mb-6 relative rounded-3xl border border-[#02665e]/30 bg-[#040f0e] shadow-card overflow-hidden">

        <div className="absolute inset-0 bg-gradient-to-br from-[#02665e]/45 via-[#02665e]/10 to-slate-950" aria-hidden />

        <div className="pointer-events-none absolute -top-10 -left-10 h-64 w-64 rounded-full bg-[#02665e]/15 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-6 right-10 h-40 w-40 rounded-full bg-[#02665e]/10 blur-2xl" aria-hidden />

        <div className="relative p-5 sm:p-7">

          <div className="relative flex flex-col items-center justify-center min-h-[120px] py-3">

            <Link href="/owner" aria-label="Back"

              className="absolute left-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#02665e]/30 bg-[#02665e]/10 text-white/90 shadow-card transition-colors hover:bg-[#02665e]/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/50"

            >

              <ArrowLeft className="h-4 w-4" aria-hidden />

            </Link>



            {/* Completion ring */}

            <div className="absolute right-0 top-0 flex items-center gap-2 rounded-2xl border border-[#02665e]/30 bg-[#02665e]/10 px-2.5 py-2 backdrop-blur-sm">

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



            <div className="text-center">

              <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight">My Profile</h1>

              <p className="mt-2 text-sm sm:text-base text-white/70 leading-relaxed">Business details, payout info, and required documents.</p>

            </div>

          </div>

        </div>

      </div>



      {/* -- Save feedback ------------------------------------------------ */}

      {(success || error) && (

        <div className={`mb-5 rounded-2xl border px-5 py-3.5 text-sm font-semibold ${success ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>

          {success ?? error}

        </div>

      )}



      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">



        {/* -- Personal details -------------------------------------------- */}

        <div className="lg:col-span-12 min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="text-sm font-semibold text-slate-800">Personal details</div>
              <div className="mt-0.5 text-xs text-slate-500">Contact and business identity.</div>
            </div>
            {form.email && (
              me?.emailVerifiedAt ? (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />Email verified
                </span>
              ) : (
                <button type="button" disabled={verifyingEmail}
                  onClick={async () => {
                    setVerifyingEmail(true);
                    try {
                      await api.post('/api/owner/email/verify/send');
                      setSuccess('Verification email sent! Please check your inbox.');
                      const r = await api.get("/api/account/me");
                      const meData = (r as any)?.data?.data ?? (r as any)?.data;
                      setMe(meData); setForm((prev: any) => ({ ...prev, emailVerifiedAt: meData?.emailVerifiedAt }));
                    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to send verification email'); }
                    finally { setVerifyingEmail(false); }
                  }}
                  className="inline-flex min-h-8 w-fit items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-600 transition hover:border-[#02665e]/30 hover:text-[#02665e] disabled:opacity-50">
                  <ShieldCheck className="h-3.5 w-3.5" />{verifyingEmail ? 'Sending...' : 'Verify email'}
                </button>
              )
            )}
          </div>

          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex min-w-0 flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 border-white bg-slate-50 shadow-sm ring-1 ring-slate-200">
                  {avatarUrl
                    ? <Image src={avatarUrl} alt="Profile photo" fill sizes="56px" unoptimized={bypassAvatarOptimizer} className="object-cover" />
                    : <span className="grid h-full w-full place-items-center bg-[#02665e]/5"><User className="h-6 w-6 text-[#02665e]" aria-hidden /></span>}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">Profile photo</div>
                  <div className="mt-0.5 text-xs leading-4 text-slate-500">Visible on your owner account.</div>
                </div>
              </div>
              <input ref={avatarFileInputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; await uploadAvatar(f); }} />
              <button type="button" onClick={() => { if (!avatarUploading) avatarFileInputRef.current?.click(); }} disabled={avatarUploading}
                className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-[#02665e]/30 hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none">
                {avatarUploading
                  ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#02665e]/20 border-t-[#02665e]" aria-hidden />Uploading...</>
                  : <><Pencil className="h-3.5 w-3.5" aria-hidden />Change photo</>}
              </button>
            </div>

            <div
              className="mt-4 overflow-x-auto overscroll-x-contain pb-2 [scrollbar-color:#94a3b8_transparent] [scrollbar-width:thin]"
              role="region"
              aria-label="Personal details. Swipe or scroll horizontally to view all fields."
              tabIndex={0}
            >
              <div className="flex min-w-max snap-x snap-mandatory gap-3">
                <div className="w-[230px] shrink-0 snap-start">
                  <EditableInfoItem icon={<User />} label="Full name" value={form.fullName || form.name} fieldKey="fullName" {...editProps} />
                </div>
                <div className="w-[310px] shrink-0 snap-start">
                  <EditableInfoItem icon={<Mail />} label="Email" value={form.email} fieldKey="email" {...editProps} />
                </div>
                <div className="w-[235px] shrink-0 snap-start">
                  <EditableInfoItem icon={<Phone />} label="Phone" value={form.phone} fieldKey="phone" fieldType="tel" {...editProps} />
                </div>
                <div className="w-[200px] shrink-0 snap-start">
                  <EditableInfoItem icon={<FileText />} label="Business TIN" value={form.tin} fieldKey="tin" {...editProps} />
                </div>
                <div className="w-[300px] shrink-0 snap-start">
                  <EditableInfoItem icon={<MapPin />} label="Business address" value={form.address} fieldKey="address" fieldType="textarea" {...editProps} />
                </div>
              </div>
            </div>
          </div>

        </div>



        {/* One secure component owns method selection and destination details. */}
        <SecurePayoutPreferenceCard
          className="lg:col-span-12"
          value={form}
          disabled={payoutSaving}
          saving={payoutSaving}
          saveDisabled={!payoutDetailsOk || !payoutChanged}
          saveError={payoutError}
          saveSuccess={payoutSuccess}
          onSave={requestPayoutSave}
          onChange={(patch) => {
            setPayoutError(null);
            setPayoutSuccess(null);
            setPayoutPreview(null);
            setForm((current: any) => ({ ...current, ...patch }));
          }}
        />



        {/* -- Required documents ------------------------------------------ */}

        <div className="lg:col-span-12 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 bg-slate-50/60 p-4 sm:px-5">

            <div className="text-sm font-semibold text-slate-800">Required documents</div>

            <div className="mt-0.5 text-xs text-slate-500">PDF, JPG, PNG or WebP · maximum 15 MB each.</div>

          </div>

          <div className="space-y-4 p-4 sm:p-5">

            <input ref={docInputRef} type="file" className="hidden" accept="application/pdf,image/*"

              onChange={(e) => onUploadDocumentFromPicker(e.target.files?.[0] ?? null)} />



            {(docError || docSuccess) && (

              <div className="space-y-1">

                {docError  && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{docError}</div>}

                {docSuccess && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{docSuccess}</div>}

              </div>

            )}

            {documentsUnavailable && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                Saved document status could not be loaded. Your existing uploads have not been removed; refresh the page to try again.
              </div>
            )}



            {/* Upload widget */}

            {showUploader && (

              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">

                <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">

                  <div className="min-w-0">

                    <div className="text-xs font-medium text-slate-600">Document type</div>

                    <select value={selectedDocType} onChange={(e) => setSelectedDocType(e.target.value)} disabled={actionableDocTypes.length === 0}

                      className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/15">

                      <option value="">Select document</option>

                      {actionableDocTypes.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}

                    </select>

                  </div>

                  {String(selectedDocType).toUpperCase() === "BUSINESS_LICENCE" ? (
                    <div className="min-w-0">
                      <div className="mb-1.5 text-xs font-medium text-slate-600">Expiry date <span className="text-rose-500">*</span></div>
                      <DatePickerField label="Business licence expiry date" value={businessLicenceExpiresOn}
                        onChangeAction={(iso) => setBusinessLicenceExpiresOn(String(iso))} min={todayIsoDate()} widthClassName="w-full" size="sm" allowPast={false} twoMonths={false} />
                    </div>
                  ) : (
                    <div className="pb-2 text-xs leading-5 text-slate-500">Select a required document, then choose its file.</div>
                  )}

                  <button type="button" disabled={!selectedDocType || !!docUploading}
                    onClick={() => docInputRef.current?.click()}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-medium text-white transition hover:bg-[#01564f] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                    {docUploading
                      ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />Uploading...</>
                      : <><Upload className="h-4 w-4" aria-hidden />Choose file</>}
                  </button>

                </div>

                <div className="mt-2 text-[11px] text-slate-500">Your document is encrypted in transit and submitted for administrator review.</div>

              </div>

            )}

            {!showUploader && !documentsUnavailable && (

              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-5 text-center">

                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />

                <div className="text-sm font-semibold text-slate-900">All required documents uploaded</div>

                <div className="text-xs text-slate-500 mt-0.5">Pending admin review & approval.</div>

              </div>

            )}



            {/* Document status list */}

            <div className="overflow-hidden rounded-lg border border-slate-200 divide-y divide-slate-200">

              {requiredDocTypes.map((item) => {

                const docs = Array.isArray(me?.documents) ? me.documents : [];

                const doc = getLatestDocByType(docs, item.type);

                const status = (doc?.status ? String(doc.status) : "").toUpperCase();

                const hasUrl = Boolean(doc?.url);

                const statusText = documentsUnavailable ? "UNAVAILABLE" : hasUrl ? (status || "PENDING") : "NOT_UPLOADED";

                const expiresAt = item.type === "BUSINESS_LICENCE" ? parseDocExpiresAt(doc) : null;

                const isExpired = item.type === "BUSINESS_LICENCE" && status === "APPROVED" && Boolean(expiresAt) && (expiresAt as Date).getTime() < Date.now();

                const daysLeft = expiresAt ? Math.ceil(((expiresAt as Date).getTime() - Date.now()) / 86400000) : null;

                const canUpload = !documentsUnavailable && (!hasUrl || statusText === "REJECTED" || isExpired);

                const badgeCls = isExpired ? "bg-rose-50 text-rose-700 border-rose-200"

                  : statusText === "APPROVED" ? "bg-emerald-50 text-emerald-700 border-emerald-200"

                  : statusText === "REJECTED" ? "bg-rose-50 text-rose-700 border-rose-200"

                  : statusText === "PENDING" ? "bg-amber-50 text-amber-700 border-amber-200"

                  : statusText === "UNAVAILABLE" ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-slate-50 text-slate-600 border-slate-200";

                const badgeText = isExpired ? "Expired" : statusText === "APPROVED" ? "Approved" : statusText === "REJECTED" ? "Rejected" : statusText === "PENDING" ? "Pending review" : statusText === "UNAVAILABLE" ? "Status unavailable" : "Not uploaded";

                return (

                  <div key={item.type} className="bg-white p-3.5 sm:p-4">

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

                      <div className="flex items-center gap-2 min-w-0">

                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#02665e]/[0.06] text-[#02665e]">

                          <FileText className="w-4 h-4" />

                        </div>

                        <div className="min-w-0">

                          <div className="text-sm font-medium leading-snug text-slate-800">{item.label}</div>

                          {hasUrl && doc?.url && (

                            <a href={doc.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#02665e] hover:underline">

                              <Eye className="h-3 w-3" />View document

                            </a>

                          )}

                        </div>

                      </div>

                      <span className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium ${badgeCls}`}>

                        {statusText === "PENDING" && <Clock className="w-3 h-3" />}

                        {statusText === "APPROVED" && !isExpired && <CheckCircle2 className="w-3 h-3" />}

                        {badgeText}

                      </span>

                    </div>

                    {expiresAt && (

                      <div className={`ml-11 mt-1.5 text-[11px] font-medium ${isExpired ? "text-rose-600" : typeof daysLeft === "number" && daysLeft <= 10 ? "text-orange-600" : "text-slate-500"}`}>

                        {isExpired ? "⚠ Expired: " : "Expires: "}{new Date(expiresAt).toLocaleDateString()}

                        {!isExpired && typeof daysLeft === "number" && daysLeft <= 30 && ` (${daysLeft}d left)`}

                      </div>

                    )}

                    {statusText === "REJECTED" && doc?.reason && (

                      <div className="ml-11 mt-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">

                        <span className="font-semibold">Reason:</span> {doc.reason}

                      </div>

                    )}

                    {canUpload ? (

                      <button type="button" disabled={!!docUploading}

                        onClick={() => { setDocError(null); setDocSuccess(null); setSelectedDocType(item.type); triggerDocUpload(); }}

                        className="ml-11 mt-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">

                        <Upload className="w-3 h-3" />{!hasUrl ? "Upload" : isExpired ? "Renew" : "Re-upload"}

                      </button>

                    ) : (

                      <div className="ml-11 mt-2 flex items-center gap-1.5 text-[10px] font-medium text-slate-400">

                        <Lock className="w-3 h-3" />

                        {statusText === "UNAVAILABLE" ? "Refresh to load saved status" : statusText === "APPROVED" ? "Approved — locked" : "Under review — locked"}

                      </div>

                    )}

                  </div>

                );

              })}

            </div>

          </div>

        </div>



        {/* -- Account actions --------------------------------------------- */}

        <div className="lg:col-span-12 rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">

          <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/60">

            <div className="text-sm font-bold text-slate-900">Account actions</div>

            <div className="text-sm text-slate-600 mt-1">Profile security and account management.</div>

          </div>

          <div className="p-5 sm:p-6 grid grid-cols-2 gap-3">

            <button onClick={save} disabled={saving}

              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#02665e] text-white text-sm font-semibold hover:bg-[#02665e]/90 shadow-card transition-colors disabled:opacity-60 disabled:cursor-wait">

              <Save className="h-4 w-4" />{saving ? "Saving profile..." : "Save profile details"}

            </button>

            <button onClick={() => { window.location.href = "/owner/settings/password"; }}

              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 shadow-card transition-colors">

              <Lock className="h-4 w-4" />Change password

            </button>

            <button onClick={async () => { try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch {} window.location.href = "/owner/login"; }}

              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 shadow-card transition-colors">

              <LogOut className="h-4 w-4" />Logout

            </button>

            <button
              onClick={() => { setDeleteOpen(true); setDeleteStep('confirm'); setDeleteInput(''); setDeleteError(null); }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm font-semibold hover:bg-rose-100 transition-colors"
            >
              <Trash2 className="h-4 w-4" />Delete account
            </button>

          </div>

        </div>



        {/* -- Audit / Change history -------------------------------------- */}

        <div className="lg:col-span-12 rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">

          <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/60">

            <div className="text-sm font-bold text-slate-900">Change history</div>

            <div className="text-sm text-slate-600 mt-1">All modifications to your profile and payout details.</div>

          </div>

          <div className="p-5 sm:p-6">

            {loadingAudit ? (

              <div className="py-10 flex flex-col items-center gap-3">

                <div className="dot-spinner dot-sm" aria-hidden><span className="dot dot-blue" /><span className="dot dot-black" /><span className="dot dot-yellow" /><span className="dot dot-green" /></div>

                <p className="text-sm text-slate-500">Loading history—</p>

              </div>

            ) : auditHistory.length === 0 ? (

              <div className="py-10 flex flex-col items-center gap-3 text-center">

                <div className="h-14 w-14 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center"><History className="h-6 w-6 text-slate-300" /></div>

                <div className="text-sm font-semibold text-slate-600">No changes recorded yet</div>

                <div className="text-xs text-slate-400">Your change history will appear here.</div>

              </div>

            ) : (

              <div>

                <div className="space-y-3">

                  {(showAllAuditHistory ? auditHistory : auditHistory.slice(0, 3)).map((log: any) => {

                    const impactCls = log.impactLevel === "high" ? "bg-rose-50 border-rose-200" : log.impactLevel === "medium" ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200";

                    const badgeCls2 = log.impactLevel === "high" ? "bg-rose-600 text-white" : log.impactLevel === "medium" ? "bg-amber-500 text-white" : "bg-blue-500 text-white";

                    const fLabels: Record<string, string> = { bankAccountNumber: "Account Number", mobileMoneyNumber: "Mobile Money Number", bankName: "Bank Name", bankAccountName: "Account Name", bankBranch: "Branch", mobileMoneyProvider: "Provider", payoutPreferred: "Preferred Method", fullName: "Full Name", email: "Email", phone: "Phone", tin: "TIN", address: "Address" };

                    return (

                      <div key={log.id} className={`p-4 rounded-2xl border ${impactCls}`}>

                        <div className="flex items-start justify-between gap-3 mb-2">

                          <div className="flex items-center gap-2 flex-wrap">

                            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${badgeCls2}`}>{log.impactLevel} impact</span>

                            <span className="text-sm font-semibold text-slate-900">

                              {log.action === "USER_PAYOUT_UPDATE" ? "Payout Updated" : log.action === "USER_PROFILE_UPDATE" ? "Profile Updated" : log.action === "USER_PASSWORD_CHANGE" ? "Password Changed" : log.action === "USER_LOGIN" ? "Login" : log.action === "USER_LOGOUT" ? "Logout" : "Account Action"}

                            </span>

                          </div>

                          <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0">

                            <Clock className="h-3 w-3" />{new Date(log.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}

                          </div>

                        </div>

                        {log.changedFields?.length > 0 && (

                          <div className="flex flex-wrap gap-1.5">

                            {log.changedFields.map((f: string, i: number) => (

                              <span key={i} className="px-2 py-0.5 rounded-md text-xs bg-white border border-slate-200 text-slate-700">{fLabels[f] || f}</span>

                            ))}

                          </div>

                        )}

                        {log.ip && <div className="mt-2 text-[10px] text-slate-400 font-mono">IP: {log.ip}</div>}

                      </div>

                    );

                  })}

                </div>

                {auditHistory.length > 3 && (

                  <button onClick={() => setShowAllAuditHistory(!showAllAuditHistory)}

                    className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-200 transition-colors">

                    {showAllAuditHistory ? <><ChevronUp className="h-4 w-4" />Show less</> : <><ChevronDown className="h-4 w-4" />View {auditHistory.length - 3} more</>}

                  </button>

                )}

              </div>

            )}

          </div>

        </div>



      </div>



      {contactChange && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-change-title"
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-slate-950/55 px-3 py-4 backdrop-blur-[2px] sm:items-center sm:p-5"
        >
          <div className="relative my-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_70px_-24px_rgba(15,23,42,0.45)]">
            <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
                  {contactChange.field === "email" ? <Mail className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <h2 id="contact-change-title" className="m-0 text-[15px] font-semibold leading-5 text-slate-900 sm:text-base">
                    Secure {contactChange.field === "email" ? "email" : "phone"} change
                  </h2>
                  <p className="mb-0 mt-0.5 text-xs leading-4 text-slate-500">
                    Verify existing access before accepting a new contact.
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => { if (!contactChangeLoading) setContactChange(null); }} disabled={contactChangeLoading}
                className="grid h-8 w-8 shrink-0 appearance-none place-items-center rounded-lg border-0 bg-transparent p-0 text-slate-400 shadow-none transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" aria-label="Close contact change">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 border-t border-slate-100 px-4 py-4 sm:px-5">
              {(contactChange.stage === "ENTER" || contactChange.stage === "STEP_UP") && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">New {contactChange.field === "email" ? "email address" : "phone number"}</span>
                  <input
                    type={contactChange.field === "email" ? "email" : "tel"}
                    inputMode={contactChange.field === "phone" ? "tel" : "email"}
                    value={contactChange.value}
                    onChange={(event) => setContactChange((current) => current ? { ...current, value: event.target.value } : current)}
                    disabled={contactChangeLoading || contactChange.stage === "STEP_UP"}
                    className="box-border h-10 min-h-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-0 text-sm text-slate-800 outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 disabled:bg-slate-100"
                    autoComplete={contactChange.field === "email" ? "email" : "tel"}
                  />
                </label>
              )}

              {contactChange.stage === "ENTER" && (
                <div className="flex items-start gap-2.5 rounded-lg border border-[#02665e]/15 bg-[#02665e]/[0.04] px-3 py-2.5 text-xs leading-4 text-slate-600">
                  <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-[#02665e]" />
                  <p className="m-0">
                    <span className="font-medium text-slate-700">Two-step protection:</span>{" "}
                    authorize with a trusted contact, then verify the new {contactChange.field}.
                  </p>
                </div>
              )}

              {contactChange.stage === "STEP_UP" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-4 text-amber-800">
                    No mature verified contact is available. Use an independent account credential to continue.
                  </div>
                  {contactChange.methods.password && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-slate-700">Current password</span>
                      <input type="password" value={contactChange.currentPassword}
                        onChange={(event) => setContactChange((current) => current ? { ...current, currentPassword: event.target.value, totpCode: "" } : current)}
                        className="box-border h-10 min-h-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-0 text-sm text-slate-800 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10" autoComplete="current-password" />
                    </label>
                  )}
                  {contactChange.methods.totp && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-slate-700">Authenticator code</span>
                      <input type="text" inputMode="numeric" value={contactChange.totpCode}
                        onChange={(event) => setContactChange((current) => current ? { ...current, totpCode: event.target.value.replace(/\D/g, "").slice(0, 6), currentPassword: "" } : current)}
                        className="box-border h-10 min-h-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-0 text-sm tracking-[0.18em] text-slate-800 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10" autoComplete="one-time-code" />
                    </label>
                  )}
                </div>
              )}

              {(contactChange.stage === "AUTHORIZE_EXISTING" || contactChange.stage === "VERIFY_NEW") && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs leading-4 text-emerald-800">
                    {contactChange.stage === "AUTHORIZE_EXISTING"
                      ? `Authorization code sent to your existing trusted contact: ${contactChange.sentTo}.`
                      : `Verification code sent to the new contact: ${contactChange.sentTo}.`}
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-700">Six-digit security code</span>
                    <input type="text" inputMode="numeric" value={contactChange.code} autoFocus
                      onChange={(event) => setContactChange((current) => current ? { ...current, code: event.target.value.replace(/\D/g, "").slice(0, 6) } : current)}
                      onKeyDown={(event) => { if (event.key === "Enter" && contactChange.code.length === 6) void submitContactChangeCode(); }}
                      className="box-border h-10 min-h-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-0 text-center text-sm font-medium tracking-[0.3em] text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10" autoComplete="one-time-code" />
                  </label>
                </div>
              )}

              {contactChangeError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-4 text-rose-700">{contactChangeError}</div>
              )}
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-slate-100 px-4 py-3 sm:flex sm:justify-end sm:px-5">
              <button type="button" onClick={() => setContactChange(null)} disabled={contactChangeLoading}
                className="h-9 appearance-none rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 shadow-none hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              {(contactChange.stage === "ENTER" || contactChange.stage === "STEP_UP") ? (
                <button type="button" onClick={requestSecureContactChange} disabled={contactChangeLoading || !contactChange.value.trim() || (contactChange.stage === "STEP_UP" && !contactChange.currentPassword && contactChange.totpCode.length !== 6)}
                  className="inline-flex h-9 min-w-0 appearance-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border-0 bg-[#02665e] px-3 text-sm font-medium text-white shadow-none hover:bg-[#01564f] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-36">
                  {contactChangeLoading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Lock className="h-4 w-4" />}
                  Continue
                </button>
              ) : (
                <button type="button" onClick={submitContactChangeCode} disabled={contactChangeLoading || contactChange.code.length !== 6}
                  className="inline-flex h-9 min-w-0 appearance-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border-0 bg-[#02665e] px-3 text-sm font-medium text-white shadow-none hover:bg-[#01564f] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-36">
                  {contactChangeLoading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <ShieldCheck className="h-4 w-4" />}
                  {contactChange.stage === "AUTHORIZE_EXISTING" ? "Authorize change" : "Confirm new contact"}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {payoutPreview && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payout-confirmation-title"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={(event) => { if (event.target === event.currentTarget && !payoutSaving) setPayoutPreview(null); }}
        >
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" aria-hidden />
          <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                    <ShieldCheck className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 id="payout-confirmation-title" className="m-0 text-base font-semibold text-slate-900">Confirm account holder</h2>
                    <p className="mb-0 mt-1 text-xs leading-5 text-slate-500">AzamPay matched this destination. Review it before saving.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setPayoutPreview(null)} disabled={payoutSaving}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50" aria-label="Close confirmation">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Verified account holder
                </div>
                <div className="mt-2 break-words text-lg font-semibold tracking-tight text-slate-900">
                  {payoutPreview.destination.accountName}
                </div>
              </div>

              <dl className="overflow-hidden rounded-md border border-slate-200 divide-y divide-slate-200">
                <div className="grid grid-cols-[120px_1fr] gap-3 px-4 py-3 text-sm">
                  <dt className="text-slate-500">Method</dt>
                  <dd className="m-0 text-right font-medium text-slate-800">{payoutPreview.destination.type === 'BANK' ? 'Bank account' : 'Mobile money'}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3 px-4 py-3 text-sm">
                  <dt className="text-slate-500">Provider</dt>
                  <dd className="m-0 text-right font-medium text-slate-800">{{ azampesa: 'AzamPesa', airtel: 'Airtel Money', tigo: 'Mixx by Yas', yas: 'Mixx by Yas', mpesa: 'M-Pesa', vodacom: 'M-Pesa', halopesa: 'HaloPesa', halotel: 'HaloPesa' }[payoutPreview.destination.provider.toLowerCase()] || payoutPreview.destination.provider}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3 px-4 py-3 text-sm">
                  <dt className="text-slate-500">Destination</dt>
                  <dd className="m-0 text-right font-mono font-medium text-slate-800">{payoutPreview.destination.accountNumber}</dd>
                </div>
              </dl>

              {payoutPreview.destination.type === "BANK" && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  This confirms the bank account holder for your saved profile only. Automated AzamPay bank disbursement is not enabled.
                </div>
              )}

              <div className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                This secure confirmation expires at {new Date(payoutPreview.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Nothing changes until you confirm.
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPayoutPreview(null)} disabled={payoutSaving}
                className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={confirmPayoutDestination} disabled={payoutSaving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-medium text-white transition hover:bg-[#01564f] disabled:cursor-not-allowed disabled:opacity-60">
                {payoutSaving
                  ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />Saving...</>
                  : <><ShieldCheck className="h-4 w-4" aria-hidden />Confirm and save</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete account modal */}
      {deleteOpen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteOpen(false); }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
          <div className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-rose-600" />

            {deleteStep === 'confirm' && (
              <div className="p-6">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 border border-rose-100">
                  <Trash2 className="h-6 w-6 text-rose-600" />
                </div>
                <h2 className="text-center text-lg font-bold text-slate-900">Delete your account?</h2>
                <p className="mt-2 text-center text-sm text-slate-500">
                  This is{" "}<span className="font-semibold text-rose-600">permanent and irreversible</span>.{" "}
                  Everything linked to your account will be removed.
                </p>
                <ul className="mt-4 space-y-2 rounded-2xl border border-rose-100 bg-rose-50/60 px-4 py-3">
                  {[
                    'Your profile, listings and booking history will be permanently deleted.',
                    'Any active bookings linked to your account will be cancelled.',
                    'You will lose access immediately — no recovery is possible.',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs text-rose-800">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex gap-3">
                  <button
                    onClick={() => setDeleteOpen(false)}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    No, keep my account
                  </button>
                  <button
                    onClick={() => setDeleteStep('verify')}
                    className="flex-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors"
                  >
                    Yes, continue
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 'verify' && (
              <div className="p-6 overflow-x-hidden">
                <button
                  onClick={() => setDeleteStep('confirm')}
                  className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 border border-rose-100">
                  <ShieldCheck className="h-6 w-6 text-rose-600" />
                </div>
                <h2 className="text-center text-lg font-bold text-slate-900">Final confirmation</h2>
                <p className="mt-2 text-center text-sm text-slate-500">
                  Type your full name exactly as shown below to confirm deletion.
                </p>
                <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-mono font-semibold text-slate-700">
                  {form.fullName || '—'}
                </div>
                <div className="mt-3 flex justify-center">
                  <input
                    type="text"
                    autoFocus
                    autoComplete="off"
                    placeholder="Type your full name…"
                    value={deleteInput}
                    onChange={(e) => setDeleteInput(e.target.value)}
                    className="w-48 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-center placeholder:text-slate-400 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-rose-400/25"
                  />
                </div>
                {deleteError && (
                  <p className="mt-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">{deleteError}</p>
                )}
                <button
                  disabled={deleteInput.trim() !== (form.fullName ?? '').trim() || deleteLoading}
                  onClick={async () => {
                    setDeleteLoading(true);
                    setDeleteError(null);
                    try {
                      await api.delete('/api/account');
                      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
                      window.location.href = '/';
                    } catch (err: any) {
                      setDeleteLoading(false);
                      setDeleteError(err?.response?.data?.error ?? err?.message ?? 'Could not delete account. Please try again.');
                    }
                  }}
                  className="mt-4 w-full rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {deleteLoading ? 'Deleting…' : 'Permanently delete my account'}
                </button>
                <p className="mt-3 text-center text-xs text-slate-400">This cannot be undone.</p>
              </div>
            )}
          </div>
        </div>
      , document.body)}



    </div>

  );

}

