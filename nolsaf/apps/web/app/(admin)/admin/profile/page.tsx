"use client";
import { useEffect, useState, useRef } from "react";
import apiClient from "@/lib/apiClient";
import Image from "next/image";
import axios from "axios";
import type { ReactNode } from "react";
import { User, Upload, X, CheckCircle, Save, Lock, LogOut, Mail, Phone, MapPin, Pencil, Shield, BadgeCheck, CalendarDays, Activity, KeyRound, Clock, History } from 'lucide-react';
import TotpSettingsSection from "@/components/security/TotpSettingsSection";
// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function AdminProfile() {
  const [form, setForm] = useState<any>({});
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [auditItems, setAuditItems] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setError(null);
      try {
        const r = await api.get("/api/account/me");
        if (!mounted) return;
        const user = (r as any)?.data?.data ?? (r as any)?.data;
        // Check if user is an admin
        if (user?.role !== 'ADMIN') {
          window.location.href = '/admin/login';
          return;
        }
        setForm(user);
        setMe(user);
        try { (window as any).ME = user; } catch (e) { /* ignore */ }
        setAuditLoading(true);
        api.get("/api/account/audit-history?page=1&pageSize=5")
          .then((audit: any) => {
            if (!mounted) return;
            const payload = audit?.data?.data ?? audit?.data;
            setAuditItems(Array.isArray(payload?.items) ? payload.items : []);
          })
          .catch((auditErr: any) => {
            console.warn("Failed to load admin profile audit history", auditErr);
          })
          .finally(() => {
            if (mounted) setAuditLoading(false);
          });
      } catch (err: any) {
        console.error('Failed to load profile', err);
        if (mounted) setLoadError(String(err?.message ?? err));
        const status = err?.response?.status;
        const code = err?.response?.data?.code;
        if (status === 403 && code === 'ACCOUNT_SUSPENDED') {
          return;
        }
        if (typeof window !== 'undefined') window.location.href = '/admin/login';
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  type CloudinarySig = {
    signature: string;
    timestamp: number;
    folder: string;
    cloudName: string;
    apiKey: string;
  };

  const isPersistableUrl = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed);
  };

  const optionalText = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };

  const textChanged = (next: unknown, previous: unknown) =>
    String(next ?? "").trim() !== String(previous ?? "").trim();

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
      const updatedMe = { ...(me ?? {}), avatarUrl: url };
      setMe(updatedMe);
      try { (window as any).ME = updatedMe; } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent("account:avatarUrl", { detail: { avatarUrl: url } })); } catch { /* ignore */ }
      setSuccess("Profile photo updated.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error("Failed to upload profile photo", err);
      setError("Failed to upload profile photo. Please try again.");
    } finally {
      setAvatarUploading(false);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
    }
  };

  const save = async () => {
    setSaving(true);
    setEditingField(null); // Close any open edit fields
    try {
      const payload: any = {};
      const fullName = optionalText(form.fullName) || optionalText(form.name);
      const phone = optionalText(form.phone);
      const email = optionalText(form.email);
      const address = optionalText(form.address);
      if (fullName && textChanged(fullName, me?.fullName || me?.name)) payload.fullName = fullName;
      if (phone && textChanged(phone, me?.phone)) payload.phone = phone;
      if (email && textChanged(email, me?.email)) payload.email = email;
      if (address !== undefined && textChanged(address, me?.address)) payload.address = address;
      if (isPersistableUrl(form.avatarUrl) && textChanged(form.avatarUrl, me?.avatarUrl)) payload.avatarUrl = form.avatarUrl.trim();

      await api.put("/api/account/profile", payload);
      
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
    } catch (err: any) {
      console.error('Failed to save profile', err);
      const details = err?.response?.data?.data;
      const firstIssue = Array.isArray(details) ? details[0]?.message : null;
      setError(firstIssue || err?.response?.data?.message || 'Could not save profile. Please check the fields and try again.');
      setSuccess(null);
    } finally {
      setSaving(false);
    }
  };

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
          <p className="text-sm text-slate-500 mt-4">Loading profile</p>
        </div>
      </div>
    );
  }
  
  if (loadError) {
    return (
      <div className="w-full max-w-full">
        <div className="rounded-md bg-red-50 border-2 border-red-200 p-4">
          <div className="text-sm font-medium text-red-800">Error loading profile: {loadError}</div>
        </div>
      </div>
    );
  }

  const formatDateTime = (value: unknown) => {
    if (!value) return "-";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };

  const refreshProfile = async () => {
    const r = await api.get("/api/account/me");
    const user = (r as any)?.data?.data ?? (r as any)?.data;
    setForm(user);
    setMe(user);
    try { (window as any).ME = user; } catch (e) { /* ignore */ }
  };

  const formatAction = (value: unknown) =>
    String(value || "UNKNOWN").replace(/^USER_/, "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

  const accountStatus = form?.suspendedAt || form?.isDisabled ? "Restricted" : "Active";
  const securityScore = [
    Boolean(form?.emailVerifiedAt),
    Boolean(form?.phoneVerifiedAt),
    Boolean(form?.twoFactorEnabled),
    Boolean(form?.hasPassword),
  ].filter(Boolean).length;

  const permissions = [
    "Users",
    "Bookings",
    "Payments",
    "Drivers",
    "Properties",
    "Reports",
    "Audit logs",
    "Observability",
  ];

  const renderInfoTile = (label: string, value: ReactNode, icon: any, tone: "emerald" | "slate" | "amber" | "red" = "slate") => {
    const Icon = icon;
    const tones = {
      emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
      slate: "bg-slate-50 text-slate-700 border-slate-100",
      amber: "bg-amber-50 text-amber-700 border-amber-100",
      red: "bg-red-50 text-red-700 border-red-100",
    };
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className={`grid h-10 w-10 place-items-center rounded-xl border ${tones[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderField = (label: string, value: any, icon: any, required: boolean = false, fieldKey?: string, fieldType: 'text' | 'textarea' = 'text') => {
    const Icon = icon;
    const displayValue = value || (required ? 'Not provided' : '—');
    const isEmpty = !value;
    
    return (
      <div className="w-full max-w-full min-w-0 p-3 sm:p-4 bg-white border-2 border-slate-200 rounded-xl hover:border-[#02665e]/30 transition-all duration-300 hover:shadow-md group overflow-hidden box-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2 w-full max-w-full min-w-0 overflow-hidden">
          <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
            <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 transition-colors duration-300 group-hover:text-[#02665e] flex-shrink-0" />
            <span className="truncate min-w-0">{label}</span>
            {required && <span className="text-red-500 flex-shrink-0">*</span>}
          </label>
          {fieldKey && (
            <button 
              type="button" 
              onClick={() => setEditingField(editingField === fieldKey ? null : fieldKey)}
              className="text-xs sm:text-sm text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium flex items-center gap-1 transition-all duration-200 hover:scale-105 self-start sm:self-auto flex-shrink-0 whitespace-nowrap"
            >
              <Pencil className="w-3 h-3 flex-shrink-0" />
              <span>{editingField === fieldKey ? 'Cancel' : 'Edit'}</span>
            </button>
          )}
        </div>
        <div className="w-full max-w-full min-w-0 overflow-hidden">
          {editingField === fieldKey && fieldKey ? (
            fieldType === 'textarea' ? (
              <textarea
                value={value || ''}
                onChange={(e) => setForm({...form, [fieldKey]: e.target.value})}
                className="block w-full max-w-full rounded-lg border-2 border-[#02665e]/20 px-3 py-2.5 text-sm focus:border-[#02665e] focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 transition-all duration-200 resize-none min-w-0 box-border"
                rows={3}
                autoFocus
              />
            ) : (
              <input
                type={fieldKey === 'email' ? 'email' : fieldKey === 'phone' ? 'tel' : 'text'}
                value={value || ''}
                onChange={(e) => setForm({...form, [fieldKey]: e.target.value})}
                className="block w-full max-w-full rounded-lg border-2 border-[#02665e]/20 px-3 py-2.5 text-sm focus:border-[#02665e] focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 transition-all duration-200 min-w-0 box-border"
                autoFocus
              />
            )
          ) : (
            <div className={`text-xs sm:text-sm font-medium transition-colors duration-200 break-words overflow-wrap-anywhere w-full max-w-full ${isEmpty ? 'text-slate-400 italic' : 'text-slate-900'}`}>
              {displayValue}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 pb-24 sm:px-6 sm:pb-28 lg:px-8">
        {/* Header Card */}
        <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white/70 shadow-sm backdrop-blur">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
          <div className="relative p-6">
            <div className="flex flex-col items-center text-center">
              {form.avatarUrl ? (
                <div className="relative group">
                  <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-slate-200/60 bg-gradient-to-br from-emerald-50 to-slate-50 shadow-sm">
                    <Image
                      src={form.avatarUrl}
                      alt="avatar"
                      fill
                      sizes="56px"
                      unoptimized={/^https?:\/\//i.test(form.avatarUrl)}
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-xl border border-white bg-[#02665e] text-white shadow-sm transition-all duration-200 hover:bg-[#014d47] hover:shadow-md active:scale-95"
                    aria-label="Change avatar"
                  >
                    <Upload className={`h-3.5 w-3.5 ${avatarUploading ? "animate-pulse" : ""}`} />
                  </button>
                </div>
              ) : (
                <div className="relative group">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-50 to-slate-50 border border-slate-200/60 flex items-center justify-center shadow-sm">
                    <Shield className="h-7 w-7 text-[#02665e]" />
                  </div>
                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-xl border border-white bg-[#02665e] text-white shadow-sm transition-all duration-200 hover:bg-[#014d47] hover:shadow-md active:scale-95"
                    aria-label="Upload avatar"
                  >
                    <Upload className={`h-3.5 w-3.5 ${avatarUploading ? "animate-pulse" : ""}`} />
                  </button>
                </div>
              )}
            <input
              ref={avatarFileInputRef}
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                await uploadAvatar(f);
              }}
              className="hidden"
            />
              <h1 className="mt-4 text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
                Administrator Profile
              </h1>
              <p className="mt-1 text-sm text-slate-600">Manage your administrative account information</p>
            </div>
          </div>
        </div>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {renderInfoTile("Admin ID", `#${form.id ?? "-"}`, Shield, "slate")}
          {renderInfoTile("Account status", accountStatus, BadgeCheck, accountStatus === "Active" ? "emerald" : "red")}
          {renderInfoTile("Created", formatDateTime(form.createdAt), CalendarDays, "slate")}
          {renderInfoTile("Security readiness", `${securityScore}/4 checks`, Activity, securityScore >= 3 ? "emerald" : "amber")}
        </section>

        {/* Success/Error Messages */}
        {success && (
          <div className="bg-white rounded-lg shadow-md border-2 border-green-200 p-3 animate-in fade-in slide-in-from-top-2 duration-300 transition-all">
            <div className="flex items-center gap-2 text-sm font-medium text-green-800">
              <CheckCircle className="h-4 w-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-white rounded-lg shadow-md border-2 border-red-200 p-3 animate-in fade-in slide-in-from-top-2 duration-300 transition-all">
            <div className="flex items-center gap-2 text-sm font-medium text-red-800">
              <X className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Profile Details Section */}
        <section className="rounded-3xl border border-slate-200/60 bg-white/70 p-4 shadow-sm backdrop-blur w-full max-w-full overflow-hidden box-border">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-200">
            <div className="h-8 w-8 rounded-lg bg-[#02665e]/10 flex items-center justify-center transition-all duration-300 group-hover:bg-[#02665e]/20">
              <Shield className="w-4 h-4 text-[#02665e]" />
            </div>
            <h2 className="text-base font-bold text-slate-900">Profile Information</h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-full overflow-hidden">
            <div className="min-w-0 max-w-full overflow-hidden">
              {renderField("Full name", form.fullName || form.name, User, true, 'fullName')}
            </div>
            <div className="min-w-0 max-w-full overflow-hidden">
              {renderField("Email", form.email, Mail, true, 'email')}
            </div>
            <div className="min-w-0 max-w-full overflow-hidden">
              {renderField("Phone", form.phone, Phone, false, 'phone')}
            </div>
            <div className="min-w-0 max-w-full overflow-hidden">
              {renderField("Role", "Administrator", Shield, false)}
            </div>
            <div className="col-span-1 sm:col-span-2 min-w-0 max-w-full overflow-hidden">
              {renderField("Address", form.address, MapPin, false, 'address', 'textarea')}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
          <section className="rounded-3xl border border-slate-200/60 bg-white/70 p-4 shadow-sm backdrop-blur w-full max-w-full overflow-hidden box-border">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-200">
              <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <KeyRound className="h-4 w-4 text-[#02665e]" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Security</h2>
                <p className="text-xs text-slate-500">Production account protection checks</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {renderInfoTile("Password", form.hasPassword ? "Configured" : "Missing", Lock, form.hasPassword ? "emerald" : "red")}
              {renderInfoTile("Two-factor auth", form.twoFactorEnabled ? `Enabled${form.twoFactorMethod ? ` (${form.twoFactorMethod})` : ""}` : "Disabled", KeyRound, form.twoFactorEnabled ? "emerald" : "amber")}
              {renderInfoTile("Email verification", form.emailVerifiedAt ? formatDateTime(form.emailVerifiedAt) : "Not verified", Mail, form.emailVerifiedAt ? "emerald" : "amber")}
              {renderInfoTile("Phone verification", form.phoneVerifiedAt ? formatDateTime(form.phoneVerifiedAt) : "Not verified", Phone, form.phoneVerifiedAt ? "emerald" : "amber")}
            </div>

            <div className="mt-4 pb-2">
              <TotpSettingsSection
                enabled={!!form.twoFactorEnabled}
                setupUrl="/api/account/2fa/totp/setup"
                verifyUrl="/api/account/2fa/totp/verify"
                disableUrl="/api/account/2fa/disable"
                onStatusChangeAction={() => { void refreshProfile(); }}
                embedded
              />
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200/60 bg-white/70 p-4 shadow-sm backdrop-blur w-full max-w-full overflow-hidden box-border">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-200">
              <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center">
                <Shield className="h-4 w-4 text-slate-700" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Admin Access</h2>
                <p className="text-xs text-slate-500">Areas available to this role</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {permissions.map((permission) => (
                <span key={permission} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {permission}
                </span>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-slate-200/60 bg-white/70 p-4 shadow-sm backdrop-blur w-full max-w-full overflow-hidden box-border">
          <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center">
                <History className="h-4 w-4 text-slate-700" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Recent Account Activity</h2>
                <p className="text-xs text-slate-500">Profile and security audit trail</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { window.location.href = "/admin/management/audit-log"; }}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-[#02665e]/30 hover:text-[#02665e]"
            >
              Open Audit Log
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {auditLoading ? (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-medium text-slate-500">Loading activity</div>
            ) : auditItems.length ? (
              auditItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-950">{formatAction(item.action)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatDateTime(item.createdAt)}</span>
                      {Array.isArray(item.changedFields) && item.changedFields.length > 0 && (
                        <span>{item.changedFields.length} field{item.changedFields.length === 1 ? "" : "s"} changed</span>
                      )}
                    </div>
                  </div>
                  <span className={`self-start rounded-full px-2.5 py-1 text-xs font-bold capitalize sm:self-auto ${
                    item.impactLevel === "high" ? "bg-red-50 text-red-700" : item.impactLevel === "medium" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                  }`}>
                    {item.impactLevel || "low"} impact
                  </span>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-medium text-slate-500">No recent account activity found.</div>
            )}
          </div>
        </section>

        {/* Actions Section */}
        <section className="rounded-3xl border border-slate-200/60 bg-white/70 p-4 shadow-sm backdrop-blur w-full max-w-full overflow-hidden box-border">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-200">
            <div className="h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center transition-all duration-300 group-hover:bg-slate-100">
              <Lock className="h-4 w-4 text-slate-600" />
            </div>
            <h2 className="text-base font-bold text-gray-900">Account Actions</h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-full min-w-0 overflow-hidden">
            <button
              className={`w-full max-w-full min-w-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all duration-300 border-2 shadow-md hover:shadow-lg box-border overflow-hidden ${
                saving 
                  ? 'text-slate-400 bg-slate-50 border-slate-200 opacity-60 cursor-wait' 
                  : 'text-white bg-[#02665e] hover:bg-[#014d47] border-[#02665e] hover:border-[#014d47] hover:scale-105 active:scale-95'
              }`}
              onClick={save}
              disabled={saving}
              aria-live="polite"
            >
              <Save className="h-4 w-4 flex-shrink-0" />
              <span className="truncate min-w-0">{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
            
            <button 
              className="w-full max-w-full min-w-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-all duration-300 border-2 border-slate-200 hover:border-slate-300 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 box-border overflow-hidden" 
              onClick={() => { window.location.href = '/admin/settings/password'; }}
            >
              <Lock className="h-4 w-4 flex-shrink-0" />
              <span className="truncate min-w-0">Change Password</span>
            </button>
            
            <button 
              className="w-full max-w-full min-w-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all duration-300 border-2 border-red-600 hover:border-red-700 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 box-border overflow-hidden" 
              onClick={async () => {
                const ok = confirm('Are you sure you want to logout?');
                if (!ok) return;
                try {
                  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                } catch {}
                window.location.href = "/admin/login";
              }}
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              <span className="truncate min-w-0">Logout</span>
            </button>
          </div>
        </section>
    </div>
  );
}

