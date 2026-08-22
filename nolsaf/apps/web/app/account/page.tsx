"use client";
import { useEffect, useState, useRef } from "react";
import apiClient from "@/lib/apiClient";
import { User, Mail, Phone, CalendarDays, Car, Users, ArrowRight, ClipboardList, Shield, CheckCircle, AlertCircle, Share2, Copy, Check, Upload, Save, MessageCircle, Heart, MapPin, IdCard, Eye, EyeOff, Info, Loader2, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

const api = apiClient;

function SkeletonLine({ w = "w-full", className = "" }: { w?: string; className?: string }) {
  return <div className={`h-4 ${w} rounded-full bg-slate-200/80 animate-pulse ${className}`} />;
}

function StatCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-3xl bg-slate-200/80 animate-pulse" />
      <div className="flex items-start justify-between gap-3 pt-1">
        <div className="h-10 w-10 rounded-2xl bg-slate-200/80 animate-pulse" />
        <div className="h-5 w-5 rounded-full bg-slate-100 animate-pulse" />
      </div>
      <div className="mt-3 space-y-2">
        <SkeletonLine w="w-12" />
        <SkeletonLine w="w-24" />
      </div>
    </div>
  );
}

export default function AccountIndex() {
  const [user, setUser] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showIdentityNumber, setShowIdentityNumber] = useState(false);
  const [emailVerificationOpen, setEmailVerificationOpen] = useState(false);
  const [emailVerificationCode, setEmailVerificationCode] = useState("");
  const [sendingEmailVerification, setSendingEmailVerification] = useState(false);
  const [confirmingEmailVerification, setConfirmingEmailVerification] = useState(false);
  const [stats, setStats] = useState<{ bookings: number; rides: number; groupStays: number; tourPackages: number; savedProperties: number }>({
    bookings: 0,
    rides: 0,
    groupStays: 0,
    tourPackages: 0,
    savedProperties: 0,
  });
  const avatarFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProfile();
    loadStats();
  }, []);

  // Gentle mount animation
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  // referral link best-effort
  useEffect(() => {
    if (!user) return;
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
        const id = (user as any).id || (user as any)._id || (user as any).email || String(Math.random()).slice(2,10);
        if (mounted) setReferralLink(`${window.location.origin}/account/register?ref=${encodeURIComponent(String(id))}`);
      } catch (e) {
        if (mounted) setReferralLink(null);
      }
    })();
    return () => { mounted = false; };
  }, [user]);

  const loadProfile = async () => {
    try {
      const response = await api.get("/api/account/me");
      // API returns { ok: true, data: user } via sendSuccess — unwrap it
      const apiUser = response.data?.data ?? response.data;
      setUser(apiUser);
      setForm(apiUser);

      // OTP verification alone is not a completed traveller registration.
      // Require the same canonical identity fields used by API and mobile.
      const data = apiUser;
      const role = String(data?.role || '').toUpperCase();
      const isCustomer = role === 'CUSTOMER' || role === 'USER' || role === 'TRAVELLER' || role === '';
      const hasName = !!(data?.name || data?.fullName);
      const hasEmail = Boolean(String(data?.email || '').trim());
      const hasPhone = Boolean(String(data?.phone || '').trim());
      const hasPassword = data?.hasPassword !== false;
      const registrationComplete = data?.registrationStatus === 'COMPLETE' || (hasName && hasEmail && hasPhone);
      if (isCustomer && (!registrationComplete || !hasPassword) && typeof window !== 'undefined') {
        window.location.href = '/account/onboard/traveller';
        return;
      }
    } catch (err) {
      console.error("Failed to load profile", err);
      const anyErr: any = err as any;
      const status = anyErr?.response?.status;
      const code = anyErr?.response?.data?.code;
      if (status === 403 && code === "ACCOUNT_SUSPENDED") {
        return;
      }
      // Only redirect to login on auth errors (401/403), not network/server errors.
      // This prevents a transient 503 or network blip from silently logging the user out.
      if (status === 401 || status === 403) {
        try {
          if (typeof window !== "undefined") window.location.href = "/account/login";
        } catch {}
      }
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      // Count confirmed stays plus drafts that can still be paid. Expired unpaid
      // drafts remain in Booking history but stop affecting the dashboard immediately.
      try {
        const bookingsRes = await api.get(
          "/api/customer/bookings?page=1&pageSize=1&activeDraftsOnly=1"
        );
        setStats((prev) => ({ ...prev, bookings: bookingsRes.data?.total || 0 }));
      } catch {}

      // Fetch rides count
      try {
        const ridesRes = await api.get("/api/customer/rides?page=1&pageSize=1");
        setStats((prev) => ({ ...prev, rides: ridesRes.data?.total || 0 }));
      } catch {}

      // Fetch group stays count
      try {
        const groupStaysRes = await api.get("/api/customer/group-stays?page=1&pageSize=1");
        setStats((prev) => ({ ...prev, groupStays: groupStaysRes.data?.total || 0 }));
      } catch {}

      // Fetch tour packages count
      try {
        const tourPackagesRes = await api.get("/api/customer/tour-bookings?page=1&pageSize=1");
        setStats((prev) => ({ ...prev, tourPackages: tourPackagesRes.data?.total || 0 }));
      } catch {}

      // Fetch saved properties count
      try {
        const savedRes = await api.get("/api/customer/saved-properties?page=1&pageSize=1");
        setStats((prev) => ({ ...prev, savedProperties: savedRes.data?.total || 0 }));
      } catch {}
    } catch (err) {
      // Stats are optional, don't fail the page
      console.debug("Failed to load stats", err);
    }
  };

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
      const avatarFile = avatarFileInputRef.current?.files?.[0];
      let savedAvatarUrl =
        typeof form.avatarUrl === "string" && /^https?:\/\//i.test(form.avatarUrl.trim())
          ? form.avatarUrl.trim()
          : undefined;

      if (avatarFile) {
        const avatarUpload = new FormData();
        avatarUpload.append("file", avatarFile);
        avatarUpload.append("folder", "avatars");
        const uploadResponse = await api.post("/api/uploads/cloudinary/upload", avatarUpload);
        const uploadedUrl = String(uploadResponse.data?.secure_url || "").trim();
        if (!/^https:\/\/res\.cloudinary\.com\//i.test(uploadedUrl)) {
          throw new Error("Avatar upload did not return a valid image URL.");
        }
        savedAvatarUrl = uploadedUrl;
      }

      const payload: any = {
        fullName: form.fullName || form.name,
        address: String(form.address || "").trim(),
        nin: String(form.nin || "").trim(),
      };
      if (savedAvatarUrl) {
        payload.avatarUrl = savedAvatarUrl;
      }

      // Store one shared URL on the User record. The booking, Sales, Owner and
      // other workspaces all read this same avatarUrl.
      await api.put('/api/account/profile', payload);

      setSuccess('Profile saved successfully!');
      setUser({ ...(user ?? {}), ...payload });
      setForm((current: any) => ({ ...current, ...payload }));
      if (savedAvatarUrl) {
        try {
          window.dispatchEvent(new CustomEvent("account:avatarUrl", { detail: { avatarUrl: savedAvatarUrl } }));
          window.dispatchEvent(new CustomEvent("nolsaf:profile-updated", { detail: { avatarUrl: savedAvatarUrl } }));
        } catch {
          // The profile is already persisted; cross-header refresh is best effort.
        }
      }
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
      setTimeout(() => setSuccess(null), 3000);
      // Reload profile to get updated data
      await loadProfile();
    } catch (err: any) {
      console.error('Failed to save profile', err);
      setError(err?.response?.data?.error || 'Could not save profile');
      setTimeout(() => setError(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const sendEmailVerificationCode = async () => {
    const email = String(form.email || user?.email || "").trim().toLowerCase();
    if (!email) {
      setError("Add an email address before requesting verification.");
      return;
    }

    setSendingEmailVerification(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post("/api/account/contact/request-change", {
        field: "email",
        value: email,
      });
      setEmailVerificationOpen(true);
      setEmailVerificationCode("");
      setSuccess(`A verification code was sent to ${email}.`);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not send the verification code.");
    } finally {
      setSendingEmailVerification(false);
    }
  };

  const confirmEmailVerificationCode = async () => {
    const otp = emailVerificationCode.trim();
    if (otp.length < 4) {
      setError("Enter the verification code from your email.");
      return;
    }

    setConfirmingEmailVerification(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.post("/api/account/contact/confirm-change", {
        field: "email",
        otp,
      });
      const verifiedUser = response.data?.data?.user ?? response.data?.user;
      const verifiedAt = verifiedUser?.emailVerifiedAt ?? new Date().toISOString();
      setUser((current: any) => ({ ...(current ?? {}), ...(verifiedUser ?? {}), emailVerifiedAt: verifiedAt }));
      setForm((current: any) => ({ ...(current ?? {}), ...(verifiedUser ?? {}), emailVerifiedAt: verifiedAt }));
      setEmailVerificationOpen(false);
      setEmailVerificationCode("");
      setSuccess("Your email address is now verified.");
      await loadProfile();
    } catch (err: any) {
      setError(err?.response?.data?.error || "The verification code could not be confirmed.");
    } finally {
      setConfirmingEmailVerification(false);
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
    const message = encodeURIComponent(`Join me on NoLSAF! Use my referral link: ${referralLink}`);
    // Open WhatsApp with the referral link message
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  if (loading) {
    return (
      <div className="w-full space-y-6">
        {/* Hero skeleton */}
        <div className="relative overflow-hidden rounded-3xl animate-pulse"
          style={{ background: "linear-gradient(135deg, #011a18 0%, #023d38 52%, #02665e 100%)", minHeight: 260 }}>
          <div className="flex flex-col items-center justify-center gap-4 py-14">
            <div className="h-24 w-24 rounded-full bg-white/10" />
            <div className="h-7 w-48 rounded-full bg-white/10" />
            <div className="h-4 w-36 rounded-full bg-white/10" />
            <div className="flex gap-3 mt-1">
              {[72, 88, 72].map((w, i) => (
                <div key={i} className="h-7 rounded-full bg-white/10" style={{ width: w }} />
              ))}
      </div>
          </div>
        </div>
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
        {/* Profile card skeleton */}
        <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-slate-50 border border-slate-100 p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-slate-200 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-20 rounded-full bg-slate-200 animate-pulse" />
                <div className="h-4 w-40 rounded-full bg-slate-100 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "w-full space-y-6 transition-all duration-300 ease-out",
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
      ].join(" ")}
    >
      {/* ══════ PREMIUM HERO HEADER ══════ */}
      <div
        className="relative overflow-hidden rounded-3xl shadow-[0_4px_32px_rgba(14,42,122,0.38)]"
        style={{ background: "linear-gradient(135deg, #0c1222 0%, #0f2460 52%, #1d4ed8 100%)" }}
      >
        {/* Radial glows — revenue card style */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0" style={{
            background: "radial-gradient(520px circle at 18% 22%, rgba(56,189,248,0.22), transparent 56%), radial-gradient(520px circle at 88% 35%, rgba(59,130,246,0.18), transparent 62%)"
          }} />
          <div className="absolute inset-0 opacity-[0.05]">
            {[12, 32, 52, 70].map((top, i) => (
              <div key={i} className="absolute h-px"
                style={{ top: `${top}%`, left: `${6 + i * 2}%`, right: `${6 + i * 2}%`,
                  background: "linear-gradient(90deg, transparent, white, transparent)" }} />
            ))}
          </div>
        </div>

        <div className="relative px-6 py-10 sm:px-10 sm:py-12 flex flex-col items-center text-center gap-4">
          {/* Avatar */}
          <div className="relative">
            <div className="absolute inset-0 rounded-full blur-md scale-110" style={{ background: "rgba(56,189,248,0.22)" }} />
            <div
              className="relative h-24 w-24 rounded-full border-2 border-white/20 shadow-xl cursor-pointer group overflow-hidden flex items-center justify-center"
              style={{ background: (form.avatarUrl || user?.avatarUrl) ? undefined : "linear-gradient(135deg, rgba(56,189,248,0.18), rgba(59,130,246,0.12))" }}
              onClick={handleAvatarClick}
            >
              {form.avatarUrl || user?.avatarUrl ? (
                /^https?:\/\//i.test(form.avatarUrl || user?.avatarUrl || '') ? (
                  <Image src={form.avatarUrl || user?.avatarUrl} alt={form.fullName || form.name || "Profile"}
                    width={96} height={96} unoptimized className="w-full h-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.avatarUrl || user?.avatarUrl} alt={form.fullName || form.name || "Profile"}
                    className="w-full h-full object-cover" />
                )
              ) : (
                <User className="h-10 w-10 text-blue-200" />
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                <Upload className="h-6 w-6 text-white" />
              </div>
            </div>
            {/* Upload hint badge */}
            <div className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full border-2 flex items-center justify-center shadow-md" style={{ background: "linear-gradient(135deg, #38bdf8, #3b82f6)", borderColor: "#0f2460" }}>
              <Upload className="h-3.5 w-3.5 text-white" />
            </div>
          </div>

          {/* Name + subtitle */}
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow">
              {form.fullName || form.name || user?.name || 'My Account'}
            </h1>
            <p className="mt-1 text-sm text-blue-200/70 font-medium">
              {form.email || user?.email || 'Manage your personal information and preferences'}
            </p>
          </div>

          {/* Quick stat chips */}
          <div className="flex flex-wrap justify-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm"
              style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.28)", color: "#7dd3fc" }}>
              <CalendarDays className="h-3.5 w-3.5" />
              {stats.bookings} Bookings
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm"
              style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.28)", color: "#93c5fd" }}>
              <Car className="h-3.5 w-3.5" />
              {stats.rides} Rides
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm"
              style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.28)", color: "#c4b5fd" }}>
              <Heart className="h-3.5 w-3.5" />
              {stats.savedProperties} Saved
            </span>
          </div>
        </div>

        <input ref={avatarFileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" title="Upload profile picture" />
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

      {/* ══════ STATS GRID ══════ */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[
          { href: "/account/bookings", icon: CalendarDays, label: "Total Bookings", count: stats.bookings, color: "#7dd3fc", bg: "rgba(14,165,233,0.16)", border: "rgba(14,165,233,0.35)" },
          { href: "/account/rides", icon: Car, label: "Total Rides", count: stats.rides, color: "#c4b5fd", bg: "rgba(147,51,234,0.16)", border: "rgba(196,181,253,0.35)" },
          { href: "/account/group-stays", icon: Users, label: "Group Stays", count: stats.groupStays, color: "#fdba74", bg: "rgba(249,115,22,0.16)", border: "rgba(251,146,60,0.35)" },
          { href: "/account/tour-packages", icon: ClipboardList, label: "Tour Packages", count: stats.tourPackages, color: "#6ee7b7", bg: "rgba(16,185,129,0.16)", border: "rgba(16,185,129,0.35)" },
          { href: "/account/saved", icon: Heart, label: "Saved Properties", count: stats.savedProperties, color: "#fda4af", bg: "rgba(244,63,94,0.16)", border: "rgba(251,113,133,0.35)" },
        ].map(({ href, icon: Icon, label, count, color, bg, border }) => (
          <Link key={href} href={href}
            className="group no-underline relative overflow-hidden rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 58%, #0a1f2e 100%)",
              border: `1px solid ${border}`,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}>
            <div className="pointer-events-none absolute inset-0 opacity-[0.08]"
              style={{ backgroundImage: "linear-gradient(135deg, white 0 1px, transparent 1px 14px)" }} />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-110"
                  style={{ background: bg, border: `1px solid ${border}` }}>
                  <Icon className="h-5 w-5" style={{ color }} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">{label}</div>
                  <div className="mt-1 text-2xl font-black leading-none tabular-nums" style={{ color }}>
                    {(count || 0).toLocaleString()}
                  </div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-white/25 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-white/60" />
            </div>
          </Link>
        ))}
      </div>

      {/* ══════ PROFILE SECTION ══════ */}
      <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.05)]">
        {/* Section header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center gap-3">
          <div className="h-9 w-9 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #011a18, #02665e)" }}>
            <User className="h-4.5 w-4.5 text-white h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Personal Information</h2>
            <p className="text-xs text-slate-500">Your profile details</p>
          </div>
        </div>

        <div className="p-6 space-y-3">
          {/* Name — read only */}
          <div className="flex items-center gap-4 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3.5 transition-colors hover:bg-slate-50/80">
            <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
              <User className="h-5 w-5 text-[#02665e]" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Full Name</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900">
                {form.fullName || form.name || user?.name || 'Not set'}
              </div>
            </div>
          </div>

          {/* Email — read only */}
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
            <div className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-slate-50/80">
              <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
                <Mail className="h-5 w-5 text-[#02665e]" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Email Address</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900 break-all">
                  {form.email || user?.email || 'Not provided'}
                </div>
              </div>
              {(form.email || user?.email) && (
                form.emailVerifiedAt || user?.emailVerifiedAt ? (
                  <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                    <CheckCircle className="h-4 w-4" aria-hidden="true" />
                    Verified
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={sendEmailVerificationCode}
                    disabled={sendingEmailVerification || confirmingEmailVerification}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs font-bold text-[#02665e] transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sendingEmailVerification ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                    {sendingEmailVerification ? "Sending…" : emailVerificationOpen ? "Resend code" : "Verify email"}
                  </button>
                )
              )}
            </div>

            {emailVerificationOpen && !(form.emailVerifiedAt || user?.emailVerifiedAt) && (
              <div className="border-t border-slate-200 bg-white px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-slate-900">Enter the code from your email</div>
                    <p className="mb-0 mt-1 text-[11px] leading-5 text-slate-500">
                      The code expires after five minutes. Check your spam folder if it is not in your inbox.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEmailVerificationOpen(false);
                      setEmailVerificationCode("");
                    }}
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border-0 bg-transparent text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Close email verification"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={emailVerificationCode}
                    onChange={(event) => setEmailVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !confirmingEmailVerification) {
                        void confirmEmailVerificationCode();
                      }
                    }}
                    placeholder="Verification code"
                    aria-label="Email verification code"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold tracking-[0.18em] text-slate-900 outline-none transition placeholder:tracking-normal placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  />
                  <button
                    type="button"
                    onClick={confirmEmailVerificationCode}
                    disabled={confirmingEmailVerification || emailVerificationCode.trim().length < 4}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#02665e] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#01534d] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirmingEmailVerification ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle className="h-4 w-4" aria-hidden="true" />
                    )}
                    {confirmingEmailVerification ? "Verifying…" : "Confirm email"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Phone — editable */}
          <div className="flex items-center gap-4 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3.5">
            <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
              <Phone className="h-5 w-5 text-[#02665e]" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Phone</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900">{form.phone || "Not provided"}</div>
            </div>
            {form.phone ? (
              form.phoneVerifiedAt || user?.phoneVerifiedAt ? (
                <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-[10px] font-bold text-emerald-700">
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  VERIFIED
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-amber-600 flex-shrink-0">LINKED</span>
              )
            ) : (
              <span className="text-[10px] font-semibold text-red-600 flex-shrink-0">REQUIRED</span>
            )}
          </div>

          <div className="pt-3">
            <div className="flex items-start gap-3 border-l-2 border-[#02665e] px-3 py-1">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" />
              <div>
                <h3 className="m-0 text-xs font-bold text-slate-900">Additional information</h3>
                <p className="mb-0 mt-1 text-[11px] leading-5 text-slate-500">
                  You can add or update these optional profile details at any time.
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-4 rounded-xl border border-slate-200 px-4 py-3 transition-all hover:border-teal-200 focus-within:border-teal-300 focus-within:ring-2 focus-within:ring-teal-100">
            <MapPin className="h-5 w-5 shrink-0 text-[#02665e]" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Residential or business address</div>
              <input
                className="mt-0.5 w-full border-none bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-300"
                value={form.address || ""}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
                maxLength={500}
                autoComplete="street-address"
                placeholder="Add your address"
              />
            </div>
          </label>

          <label className="flex items-center gap-4 rounded-xl border border-slate-200 px-4 py-3 transition-all hover:border-teal-200 focus-within:border-teal-300 focus-within:ring-2 focus-within:ring-teal-100">
            <IdCard className="h-5 w-5 shrink-0 text-[#02665e]" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">National ID or passport number</div>
              <input
                type={showIdentityNumber ? "text" : "password"}
                className="mt-0.5 w-full border-none bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-300"
                value={form.nin || ""}
                onChange={(event) => setForm({ ...form, nin: event.target.value })}
                maxLength={50}
                autoComplete="off"
                spellCheck={false}
                placeholder="Add an ID or passport number"
              />
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                setShowIdentityNumber((current) => !current);
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-slate-400 transition hover:bg-slate-100 hover:text-[#02665e]"
              aria-label={showIdentityNumber ? "Hide identity number" : "Show identity number"}
            >
              {showIdentityNumber ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </label>
        </div>

        {/* Save button */}
        <div className="px-6 pb-6">
          <button
            onClick={save}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl text-white font-semibold text-sm py-3 hover:opacity-90 hover:shadow-md active:scale-[0.99] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #011a18 0%, #02665e 100%)" }}
          >
            {saving ? (
              <><div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</>
            ) : (
              <><Save className="h-4 w-4" />Save Changes</>
            )}
          </button>
        </div>
      </div>

      {/* ══════ REFERRAL CARD ══════ */}
      <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.05)]">
        <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #ccfbf1, #99f6e4)" }}>
                <Share2 className="h-5 w-5 text-[#02665e]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Invite Friends</h3>
                <p className="text-xs text-slate-500">Share your link and earn rewards</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                <input
                  readOnly
                  value={referralLink ?? ''}
                  placeholder="Generating link…"
                  className="flex-1 text-sm text-slate-700 bg-transparent border-none outline-none min-w-0"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  onClick={handleCopy}
                  className="flex-shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-[0.97]"
                  style={copied ? { background: "#d1fae5", color: "#065f46" } : { background: "linear-gradient(135deg, #011a18, #02665e)", color: "white" }}
                >
                  {copied ? <><Check className="h-3.5 w-3.5" />Copied!</> : <><Copy className="h-3.5 w-3.5" />Copy</>}
                </button>
              </div>
              <button
                onClick={handleWhatsApp}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 font-medium text-sm py-3 hover:bg-slate-100 active:scale-[0.99] transition-all"
              >
                <MessageCircle className="h-4 w-4 text-green-600" />
                Share via WhatsApp
              </button>
            </div>
        </div>
      </div>

      {/* ══════ SECURITY CARD ══════ */}
      <Link
        href="/account/security"
        className="group no-underline relative overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.05)] transition-all duration-200 hover:border-teal-100 hover:shadow-[0_10px_34px_rgba(2,102,94,0.12)] hover:-translate-y-[2px] active:scale-[0.99] block"
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-50/55 via-white to-slate-50/70 opacity-80" />
        <div className="relative flex items-center gap-4 px-6 py-5">
          <div className="h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105"
            style={{ background: "linear-gradient(135deg, #ccfbf1, #99f6e4)" }}>
            <Shield className="h-6 w-6 text-[#02665e]" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900">Account Security</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {user?.twoFactorEnabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                  <CheckCircle className="h-3 w-3" />2FA Enabled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                  <AlertCircle className="h-3 w-3" />2FA Not Enabled
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500">Manage password, 2FA, and sessions</div>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-[#02665e] group-hover:translate-x-1 transition-all duration-200 flex-shrink-0" />
        </div>
      </Link>
    </div>
  );
}
