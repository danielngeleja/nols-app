"use client";
import { useEffect, useState, useRef } from "react";
import apiClient from "@/lib/apiClient";
import Image from "next/image";
import { User, Mail, Phone, Save, LogOut, Copy, Check, Share2, Upload, AlertCircle, MessageCircle } from "lucide-react";

const api = apiClient;

function SkeletonLine({ w = "w-full", className = "" }: { w?: string; className?: string }) {
  return <div className={`h-4 ${w} ${className} rounded-full bg-slate-200/80 animate-pulse`} />;
}

export default function PublicProfile() {
  const [me, setMe] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [entered, setEntered] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.get('/api/account/me');
        if (!mounted) return;
        setMe(r.data);
        setForm(r.data);
      } catch (err: any) {
        console.error('Failed to load profile', err);
        if (mounted) setError(String(err?.message ?? err));
        const status = err?.response?.status;
        const code = err?.response?.data?.code;
        if (status === 403 && code === 'ACCOUNT_SUSPENDED') {
          return;
        }
        if (typeof window !== 'undefined') window.location.href = '/account/login';
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Gentle mount animation
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  // referral link best-effort
  useEffect(() => {
    if (!me) return;
    let mounted = true;
    (async () => {
      try {
        const r = await api.get('/api/account/referral');
        if (!mounted) return;
        const referral = r?.data?.data ?? r?.data ?? {};
        if (referral?.code) { setReferralLink(`${window.location.origin}/account/register?ref=${encodeURIComponent(String(referral.code))}`); return; }
        if (referral?.link) { setReferralLink(String(referral.link)); return; }
      } catch (e) {
        // ignore
      }
      try {
        const id = (me as any).id || (me as any)._id || (me as any).email || String(Math.random()).slice(2,10);
        if (mounted) setReferralLink(`${window.location.origin}/account/register?ref=${encodeURIComponent(String(id))}`);
      } catch (e) {
        if (mounted) setReferralLink(null);
      }
    })();
    return () => { mounted = false; };
  }, [me]);

  const handleAvatarClick = () => {
    avatarFileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      setTimeout(() => setError(null), 3000);
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image size must be less than 5MB');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      // Create a preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm({ ...form, avatarUrl: reader.result as string });
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Failed to process image', err);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: any = {
        fullName: form.fullName || form.name,
      };
      if (typeof form.avatarUrl === "string" && form.avatarUrl.trim()) {
        payload.avatarUrl = form.avatarUrl.trim();
      }

      // Handle file uploads if any
      const formData = new FormData();
      Object.keys(payload).forEach(key => {
        if (payload[key] !== null && payload[key] !== undefined) {
          formData.append(key, payload[key]);
        }
      });

      if (avatarFileInputRef.current?.files?.[0]) {
        formData.append('avatarFile', avatarFileInputRef.current.files[0]);
      }

      // Use FormData if files exist, otherwise use JSON
      if (avatarFileInputRef.current?.files?.[0]) {
        await api.put('/api/account/profile', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await api.put('/api/account/profile', payload);
      }

      setSuccess('Profile saved successfully!');
      setMe({ ...(me ?? {}), ...payload });
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to save profile', err);
      setError(err?.response?.data?.error || 'Could not save profile');
      setTimeout(() => setError(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!referralLink) {
      setError('No referral link available');
      setTimeout(() => setError(null), 3000);
      return;
    }
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError('Could not copy to clipboard');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleWhatsApp = () => {
    if (!referralLink) {
      setError('No referral link available');
      setTimeout(() => setError(null), 3000);
      return;
    }
    const message = encodeURIComponent(`Hi! I'm using NoLSAF and thought you might like it too. Use my referral link to sign up:\n\n${referralLink}\n\nYou'll get great benefits and I'll earn credits too!`);
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-16 w-16 rounded-full bg-slate-200/80 animate-pulse" />
            <div className="flex-1">
              <SkeletonLine w="w-48" />
              <SkeletonLine w="w-32" className="mt-2" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i}>
                <SkeletonLine w="w-24" />
                <SkeletonLine w="w-full" className="mt-2 h-10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "mx-auto w-full max-w-5xl space-y-6 transition-all duration-300 ease-out",
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
      ].join(" ")}
    >
      {/* Page Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[#02665e]/10 to-[#014d47]/10 flex items-center justify-center mb-4">
            <User className="h-8 w-8 text-[#02665e]" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Your Profile</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your personal information</p>
        </div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-3 transition-all duration-300">
          <Check className="h-5 w-5 text-green-600 flex-shrink-0" />
          <span className="text-sm font-medium text-green-800">{success}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center gap-3 transition-all duration-300">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <span className="text-sm font-medium text-red-800">{error}</span>
        </div>
      )}

      {/* Profile Card */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md">
        <div className="p-6 sm:p-8">
          {/* Avatar Section */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 mb-8">
            <div className="relative group flex-shrink-0">
              <div
                onClick={handleAvatarClick}
                className="relative h-20 w-20 sm:h-24 sm:w-24 rounded-2xl bg-gradient-to-br from-[#02665e]/10 to-[#014d47]/10 ring-2 ring-[#02665e]/15 overflow-hidden flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 hover:ring-[#02665e]/30"
              >
                {form.avatarUrl ? (
                  <Image
                    src={form.avatarUrl}
                    alt={form.fullName || "Profile"}
                    fill
                    sizes="(min-width: 640px) 96px, 80px"
                    unoptimized={/^https?:\/\//i.test(form.avatarUrl)}
                    className="object-cover"
                  />
                ) : (
                  <User className="h-10 w-10 sm:h-12 sm:w-12 text-[#02665e]" strokeWidth={2} />
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-[#02665e] border-2 border-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer" onClick={handleAvatarClick}>
                <Upload className="h-4 w-4 text-white" />
              </div>
              <input
                ref={avatarFileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>
            <div className="flex-1 min-w-0 text-center sm:text-left w-full sm:w-auto">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 break-words">
                {form.fullName || form.name || 'Your profile'}
              </h2>
              <div className="mt-1 flex items-center justify-center sm:justify-start gap-2 text-sm text-slate-600">
                <Mail className="h-4 w-4 flex-shrink-0" />
                <span className="break-all">{form.email || 'No email'}</span>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <label className="text-sm grid gap-2">
              <span className="font-medium text-slate-700 flex items-center gap-2">
                <User className="h-4 w-4 text-[#02665e]" />
                Full name
              </span>
              <input
                className="border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#02665e]/50 focus:outline-none focus:ring-1 focus:ring-[#02665e]/20 hover:border-slate-300 transition-all duration-300 ease-out"
                value={form.fullName || form.name || ''}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="Enter your full name"
              />
            </label>

            <label className="text-sm grid gap-2">
              <span className="font-medium text-slate-700 flex items-center gap-2">
                <Phone className="h-4 w-4 text-[#02665e]" />
                Phone
              </span>
              <input
                readOnly
                className="cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
                value={form.phone || ''}
                placeholder="+255700000001"
                title="Phone changes require contact verification"
              />
            </label>
          </div>

          {/* Referral Section */}
          <div className="pt-6 border-t border-slate-200">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Share2 className="h-5 w-5 text-[#02665e]" />
                Invite Friends
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Share your referral link and get rewards when friends sign up.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-sm grid gap-2">
                <span className="font-medium text-slate-700 flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-[#02665e]" />
                  Referral Link
                </span>
                <input
                  readOnly
                  value={referralLink ?? ''}
                  placeholder="Generating link…"
                  className="border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50/50 focus:border-[#02665e]/50 focus:outline-none focus:ring-1 focus:ring-[#02665e]/20 focus:bg-white hover:border-slate-300 hover:bg-white transition-all duration-300 ease-out"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>

              <div className="flex flex-col justify-end gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="group inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-slate-300 bg-white text-slate-700 font-medium text-sm hover:bg-slate-50 hover:border-[#02665e] hover:text-[#02665e] active:scale-[0.98] transition-all duration-200 flex-1"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleWhatsApp}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-slate-300 bg-white text-slate-700 font-medium text-sm hover:bg-slate-50 hover:border-[#02665e] hover:text-[#02665e] active:scale-[0.98] transition-all duration-200 flex-1"
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span>WhatsApp</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="group inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#02665e] text-white font-semibold text-sm hover:bg-[#014d47] hover:shadow-md active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-[#02665e]"
        >
          {saving ? (
            <>
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save
            </>
          )}
        </button>

        <button
          onClick={async () => {
            try {
              await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
            } catch {}
            window.location.href = "/public";
          }}
          className="group inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border-2 border-red-200 bg-white text-red-600 font-semibold text-sm hover:bg-red-50 hover:border-red-300 active:scale-[0.98] transition-all duration-200"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </div>
  );
}
