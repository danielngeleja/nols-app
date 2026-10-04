"use client";
import { useEffect, useState, useRef } from "react";
import apiClient from "@/lib/apiClient";
import Image from "next/image";
import axios from "axios";
import { User, Upload, X, CheckCircle, Save, Lock, LogOut, Mail, Phone, MapPin, Pencil, Shield, KeyRound, Clock } from 'lucide-react';
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
  const [confirmLogout, setConfirmLogout] = useState(false);
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
    if (!value) return "Not recorded";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "Not recorded";
    return `${date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
  };

  const refreshProfile = async () => {
    const r = await api.get("/api/account/me");
    const user = (r as any)?.data?.data ?? (r as any)?.data;
    setForm(user);
    setMe(user);
    try { (window as any).ME = user; } catch (e) { /* ignore */ }
  };

  const formatAction = (value: unknown) =>
    String(value || "UNKNOWN").replace(/^USER_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (m) => m.toUpperCase());

  const restricted = Boolean(form?.suspendedAt || form?.isDisabled);
  const name = form.fullName || form.name || "Administrator";
  const initials = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join("");
  const checks = [
    { key: "password", label: "Password set", ok: Boolean(form?.hasPassword), detail: form?.hasPassword ? "Configured" : "Set one under Change password", fix: form?.hasPassword ? null : { label: "Set password", href: "/admin/settings/password" } },
    { key: "2fa", label: "Two-factor sign-in", ok: Boolean(form?.twoFactorEnabled), detail: form?.twoFactorEnabled ? `On${form.twoFactorMethod ? `, ${String(form.twoFactorMethod).toLowerCase()}` : ""}` : "Off: turn it on below", fix: form?.twoFactorEnabled ? null : { label: "Turn on", href: "#two-factor" } },
    { key: "email", label: "Email verified", ok: Boolean(form?.emailVerifiedAt), detail: form?.emailVerifiedAt ? formatDateTime(form.emailVerifiedAt) : "Not verified yet", fix: null },
    { key: "phone", label: "Phone verified", ok: Boolean(form?.phoneVerifiedAt), detail: form?.phoneVerifiedAt ? formatDateTime(form.phoneVerifiedAt) : "Not verified yet", fix: null },
  ];
  const score = checks.filter((c) => c.ok).length;

  const permissions = ["Users", "Bookings", "Payments", "Drivers", "Properties", "Reports", "Audit logs", "Observability"];

  const card = "min-w-0 rounded-lg border border-solid border-slate-200 bg-white";
  const sectionTitle = "m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500";

  const fields: Array<{ key: string; label: string; icon: any; value: any; required?: boolean; editable: boolean; multiline?: boolean; type?: string }> = [
    { key: "fullName", label: "Full name", icon: User, value: form.fullName || form.name, required: true, editable: true },
    { key: "email", label: "Email", icon: Mail, value: form.email, required: true, editable: true, type: "email" },
    { key: "phone", label: "Phone", icon: Phone, value: form.phone, editable: true, type: "tel" },
    { key: "address", label: "Address", icon: MapPin, value: form.address, editable: true, multiline: true },
    { key: "role", label: "Role", icon: Shield, value: "Administrator", editable: false },
  ];
  const cancelEdit = (key: string) => {
    setForm((f: any) => ({ ...f, [key]: key === "fullName" ? me?.fullName ?? me?.name : me?.[key] }));
    setEditingField(null);
  };

  return (
    <div id="admin-profile-page" className="w-full min-w-0 space-y-4 pb-16">
      <style>{`#admin-profile-page, #admin-profile-page * { box-sizing: border-box; }`}</style>
      <input
        ref={avatarFileInputRef}
        type="file"
        accept="image/*"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) await uploadAvatar(f); }}
        className="hidden"
      />

      {(success || error) && (
        <div className={`fixed right-6 top-6 z-50 flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-white shadow-lg ${success ? "bg-[#0b2420]" : "bg-rose-600"}`} role="status">
          {success ? <CheckCircle className="h-4 w-4 text-emerald-300" /> : <X className="h-4 w-4" />}{success || error}
        </div>
      )}

      {/* Identity */}
      <header className={card}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-5">
          <div className="relative shrink-0">
            <div className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-md bg-[#02665e]/10 text-lg font-bold text-[#02665e]">
              {form.avatarUrl ? <Image src={form.avatarUrl} alt="Profile photo" fill sizes="64px" unoptimized={/^https?:\/\//i.test(form.avatarUrl)} className="object-cover" /> : initials}
            </div>
            <button type="button" onClick={() => avatarFileInputRef.current?.click()} disabled={avatarUploading} aria-label="Change profile photo" title="Change profile photo" className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-md border-2 border-solid border-white bg-[#02665e] text-white transition hover:bg-[#014d47] disabled:opacity-60">
              <Upload className={`h-3.5 w-3.5 ${avatarUploading ? "animate-pulse" : ""}`} />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 truncate text-xl font-bold tracking-tight text-slate-900">{name}</h1>
              <span className="rounded bg-[#02665e]/10 px-2 py-0.5 text-[11px] font-semibold text-[#02665e]">Administrator</span>
              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${restricted ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${restricted ? "bg-rose-500" : "bg-emerald-500"}`} />{restricted ? "Restricted" : "Active"}
              </span>
            </div>
            <p className="m-0 mt-1 truncate text-sm text-slate-500">{form.email || "No email"}{form.phone ? ` · ${form.phone}` : ""}</p>
            <p className="m-0 mt-0.5 text-[11px] text-slate-400">Admin since {formatDateTime(form.createdAt)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/admin/settings/password" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 no-underline hover:bg-slate-50 hover:no-underline"><Lock className="h-3.5 w-3.5" /> Change password</a>
            {confirmLogout ? (
              <>
                <button type="button" onClick={() => setConfirmLogout(false)} className="inline-flex h-9 items-center rounded-md border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Stay</button>
                <button type="button" onClick={async () => { try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch {} window.location.href = "/admin/login"; }} className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"><LogOut className="h-3.5 w-3.5" /> Sign out now</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmLogout(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-rose-700 hover:border-rose-200 hover:bg-rose-50"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
            )}
          </div>
        </div>

        {/* Security readiness */}
        <div className="border-0 border-t border-solid border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={sectionTitle}>Security readiness</p>
            <p className={`m-0 text-xs font-semibold ${score === 4 ? "text-emerald-700" : score >= 3 ? "text-amber-700" : "text-rose-700"}`}>{score} of 4 checks{score === 4 ? ", fully protected" : ""}</p>
          </div>
          <span className="mt-2 flex h-1.5 gap-0.5">{checks.map((c) => <span key={c.key} className={`h-full flex-1 ${c.ok ? "bg-[#02665e]" : "bg-amber-300"}`} />)}</span>
          <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-4">
            {checks.map((c) => (
              <li key={c.key} className={`flex items-start gap-2.5 rounded-md border border-solid px-3 py-2.5 ${c.ok ? "border-slate-200" : "border-amber-200 bg-amber-50/50"}`}>
                {c.ok ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-slate-900">{c.label}</span>
                  <span className="block truncate text-[11px] text-slate-500">{c.detail}</span>
                </span>
                {c.fix ? <a href={c.fix.href} className="shrink-0 text-[11px] font-semibold text-[#02665e] no-underline hover:underline">{c.fix.label}</a> : null}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        {/* Details */}
        <section className={card}>
          <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-5 py-3.5">
            <p className={sectionTitle}>Profile details</p>
            <span className="text-[11px] text-slate-400">Edit a line, then save it</span>
          </div>
          <ul className="m-0 list-none p-0">
            {fields.map((f) => {
              const editing = editingField === f.key;
              const empty = !f.value;
              return (
                <li key={f.key} className="grid grid-cols-1 items-start gap-2 border-0 border-b border-solid border-slate-100 px-5 py-3 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
                  <span className="flex items-center gap-2 text-xs font-semibold text-slate-500"><f.icon className="h-3.5 w-3.5 text-slate-400" />{f.label}{f.required ? <span className="text-rose-500">*</span> : null}</span>
                  {editing ? (
                    f.multiline ? (
                      <textarea value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} rows={2} autoFocus className="block w-full resize-none rounded-md border border-solid border-[#02665e]/40 px-3 py-2 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                    ) : (
                      <input type={f.type || "text"} value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") cancelEdit(f.key); }} autoFocus className="block h-9 w-full rounded-md border border-solid border-[#02665e]/40 px-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                    )
                  ) : (
                    <span className={`min-w-0 break-words text-sm ${empty ? "text-slate-400" : "font-medium text-slate-900"}`}>{f.value || (f.required ? "Not provided" : "Not set")}</span>
                  )}
                  <span className="flex items-center gap-1.5 justify-self-start sm:justify-self-end">
                    {!f.editable ? (
                      <span className="text-[11px] text-slate-400">Fixed</span>
                    ) : editing ? (
                      <>
                        <button type="button" onClick={() => cancelEdit(f.key)} className="h-8 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                        <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-8 items-center gap-1 rounded-md border-0 bg-[#02665e] px-2.5 text-xs font-semibold text-white hover:bg-[#014d47] disabled:opacity-60"><Save className="h-3.5 w-3.5" />{saving ? "Saving" : "Save"}</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setEditingField(f.key)} className="inline-flex h-8 items-center gap-1 rounded-md border border-solid border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:border-[#02665e]/40 hover:text-[#02665e]"><Pencil className="h-3 w-3" /> Edit</button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="min-w-0 space-y-4">
          {/* Access */}
          <section className={card}>
            <div className="border-0 border-b border-solid border-slate-200 px-5 py-3.5"><p className={sectionTitle}>Admin access</p></div>
            <div className="flex flex-wrap gap-1.5 px-5 py-4">
              {permissions.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded border border-solid border-emerald-100 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800"><CheckCircle className="h-3 w-3" />{p}</span>
              ))}
            </div>
          </section>

          {/* Activity */}
          <section className={card}>
            <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-5 py-3.5">
              <p className={sectionTitle}>Recent activity</p>
              <a href="/admin/management/audit-log" className="text-[11px] font-semibold text-[#02665e] no-underline hover:underline">Audit log</a>
            </div>
            {auditLoading ? (
              <p className="m-0 px-5 py-5 text-xs text-slate-500">Loading activity</p>
            ) : auditItems.length ? (
              <ol className="m-0 list-none px-5 py-3">
                {auditItems.slice(0, 5).map((item, i) => (
                  <li key={item.id} className="relative flex gap-3 pb-3 last:pb-0">
                    {i < Math.min(5, auditItems.length) - 1 ? <span className="absolute left-[5px] top-3 h-full w-px bg-slate-200" aria-hidden /> : null}
                    <span className={`relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.impactLevel === "high" ? "bg-rose-500" : item.impactLevel === "medium" ? "bg-amber-400" : "bg-emerald-500"}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-900">{formatAction(item.action)}</span>
                      <span className="block text-[11px] text-slate-500">{formatDateTime(item.createdAt)}{Array.isArray(item.changedFields) && item.changedFields.length ? ` · ${item.changedFields.length} field${item.changedFields.length === 1 ? "" : "s"}` : ""}{item.impactLevel ? ` · ${item.impactLevel} impact` : ""}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 px-5 py-5 text-xs text-slate-500">No recent account activity.</p>
            )}
          </section>
        </div>
      </div>

      {/* Two-factor */}
      <section id="two-factor" className={card}>
        <div className="flex items-center gap-2 border-0 border-b border-solid border-slate-200 px-5 py-3.5">
          <KeyRound className="h-4 w-4 text-[#02665e]" />
          <p className={sectionTitle}>Two-factor sign-in</p>
        </div>
        <div className="px-5 py-4">
          <TotpSettingsSection
            enabled={!!form.twoFactorEnabled}
            setupUrl="/api/account/2fa/totp/setup"
            verifyUrl="/api/account/2fa/totp/verify"
            disableUrl="/api/account/2fa/disable"
            regenerateCodesUrl="/api/account/2fa/codes/regenerate"
            onStatusChangeAction={() => { void refreshProfile(); }}
            embedded
          />
        </div>
      </section>
    </div>
  );
}
