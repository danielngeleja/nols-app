"use client";
import { useEffect, useState, useRef } from "react";
import apiClient from "@/lib/apiClient";
import { User, Mail, Phone, CalendarDays, Car, Users, ArrowRight, Compass, Hotel, Shield, CheckCircle, AlertCircle, Share2, Copy, Check, Upload, Save, MessageCircle, Heart, MapPin, IdCard, Eye, EyeOff, Loader2, ShieldCheck, X } from "lucide-react";
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
  const [copied, setCopied] = useState<null | "link" | "code">(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  // Read after mount so server and client render the same markup first.
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(typeof (navigator as any).share === "function");
  }, []);
  const [showIdentityNumber, setShowIdentityNumber] = useState(false);
  const [emailVerificationOpen, setEmailVerificationOpen] = useState(false);
  const [emailVerificationCode, setEmailVerificationCode] = useState("");
  const [sendingEmailVerification, setSendingEmailVerification] = useState(false);
  const [confirmingEmailVerification, setConfirmingEmailVerification] = useState(false);
  const [stats, setStats] = useState<{ bookings: number; rides: number; groupStays: number; tourPackages: number; savedProperties: number; bookingsUnpaid: number; toursUnpaid: number }>({
    bookings: 0,
    rides: 0,
    groupStays: 0,
    tourPackages: 0,
    savedProperties: 0,
    bookingsUnpaid: 0,
    toursUnpaid: 0,
  });
  const [statsLoaded, setStatsLoaded] = useState(false);
  /** Soonest closing payment window among unpaid stays and tours (ms epoch) */
  const [paymentDeadline, setPaymentDeadline] = useState<number | null>(null);
  const [, setNowTick] = useState(0);
  // Keep the countdown fresh, and drop the banner once the window closes
  useEffect(() => {
    if (!paymentDeadline) return;
    const id = window.setInterval(() => {
      setNowTick((t) => t + 1);
      // Window closed: reload counts so the banner and badges clear themselves
      if (Date.now() >= paymentDeadline) void loadStatsRef.current?.();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [paymentDeadline]);
  const loadStatsRef = useRef<null | (() => Promise<void>)>(null);
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

  // Passkey count for the security check. null = unknown, so the check is skipped rather than shown as missing.
  const [passkeyCount, setPasskeyCount] = useState<number | null>(null);
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    api.get('/api/account/security/passkeys')
      .then((r) => { if (mounted) setPasskeyCount(Array.isArray(r?.data?.items) ? r.data.items.length : null); })
      .catch(() => { if (mounted) setPasskeyCount(null); });
    return () => { mounted = false; };
  }, [user]);

  // referral link best-effort
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      try {
        const r = await api.get('/api/account/referral');
        if (!mounted) return;
        const referral = r?.data?.data ?? r?.data ?? {};
        if (referral?.code) {
          setReferralCode(String(referral.code));
          setReferralLink(`${window.location.origin}/account/register?ref=${encodeURIComponent(String(referral.code))}`);
          return;
        }
        if (referral?.link) { setReferralLink(String(referral.link)); return; }
      } catch (e) {
        // ignore
      }
      // No guessed fallback: codes are opaque and issued by the server, so a link
      // built here from an id or a random number would credit nobody.
      if (mounted) setReferralLink(null);
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
    // All counts load in parallel and each one fails soft: a tile with no data
    // keeps its last value instead of blocking the others.
    const total = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? Number(r.value?.data?.total) || 0 : null;
    const [bookingsActive, stayDrafts, rides, groupStays, tours, tourDrafts, saved] = await Promise.allSettled([
      // Confirmed stays plus drafts still inside their payment window.
      api.get("/api/customer/bookings?page=1&pageSize=1&activeDraftsOnly=1"),
      // Recent stays with their own draft flags; only drafts whose payment window is still open count as "needs payment".
      api.get("/api/customer/bookings?page=1&pageSize=50&activeDraftsOnly=1"),
      api.get("/api/customer/rides?page=1&pageSize=1"),
      api.get("/api/customer/group-stays?page=1&pageSize=1"),
      api.get("/api/customer/tour-bookings?page=1&pageSize=1"),
      // Same for tours: expired payment windows must not keep asking for payment.
      api.get("/api/customer/tour-bookings?page=1&pageSize=50&bucket=DRAFT"),
      api.get("/api/customer/saved-properties?page=1&pageSize=1"),
    ]);

    type Payable = { id: number; expiresAt: number };
    const payableDrafts = (r: PromiseSettledResult<any>): Payable[] | null => {
      if (r.status !== "fulfilled") return null;
      const data = r.value?.data;
      const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data?.bookings) ? data.bookings : Array.isArray(data?.data) ? data.data : [];
      const now = Date.now();
      return items
        .filter((it) => it?.dashboardBucket === "DRAFT" && it?.draftExpiryStatus === "ACTIVE")
        .map((it) => ({ id: Number(it.id), expiresAt: new Date(it.draftExpiresAt).getTime() }))
        .filter((d) => Number.isFinite(d.expiresAt) && d.expiresAt > now);
    };
    const stayDue = payableDrafts(stayDrafts);
    const tourDue = payableDrafts(tourDrafts);
    const soonest = [...(stayDue ?? []).map((d) => ({ ...d, kind: "stay" as const })), ...(tourDue ?? []).map((d) => ({ ...d, kind: "tour" as const }))]
      .sort((a, b) => a.expiresAt - b.expiresAt)[0];

    setStats((prev) => ({
      bookings: total(bookingsActive) ?? prev.bookings,
      rides: total(rides) ?? prev.rides,
      groupStays: total(groupStays) ?? prev.groupStays,
      tourPackages: total(tours) ?? prev.tourPackages,
      savedProperties: total(saved) ?? prev.savedProperties,
      bookingsUnpaid: stayDue ? stayDue.length : prev.bookingsUnpaid,
      toursUnpaid: tourDue ? tourDue.length : prev.toursUnpaid,
    }));
    setPaymentDeadline(soonest ? soonest.expiresAt : null);
    setStatsLoaded(true);
  };
  loadStatsRef.current = loadStats;
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

  const handleCopy = async (what: "link" | "code" = "link") => {
    const text = what === "code" ? referralCode : referralLink;
    if (!text) {
      setError('No referral link available');
      setTimeout(() => setError(null), 3000);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      setError('Could not copy to clipboard');
      setTimeout(() => setError(null), 3000);
    }
  };

  const referralMessage = referralLink ? `Join me on NoLSAF! Use my referral link: ${referralLink}` : "";

  const handleWhatsApp = () => {
    if (!referralLink) {
      setError('No referral link available');
      setTimeout(() => setError(null), 3000);
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(referralMessage)}`, '_blank', 'noopener,noreferrer');
  };


  /** The phone's own share sheet (Instagram, Telegram, Messages...). Falls back to copying. */
  const handleNativeShare = async () => {
    if (!referralLink) return;
    try {
      await (navigator as any).share({ title: "Join me on NoLSAF", text: "Join me on NoLSAF!", url: referralLink });
    } catch (e: any) {
      if (e?.name !== "AbortError") void handleCopy("link");
    }
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
      {/* ══════ HERO: who you are, at a glance ══════ */}
      {(() => {
        const displayName = form.fullName || form.name || user?.name || "My account";
        const firstName = String(displayName).trim().split(/\s+/)[0];
        const hour = new Date().getHours();
        const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
        const avatarSrc = form.avatarUrl || user?.avatarUrl || "";
        const photoPending = Boolean(form.avatarUrl) && form.avatarUrl !== (user?.avatarUrl || undefined);
        const initials = String(displayName).trim().split(/\s+/).slice(0, 2).map((part: string) => part.charAt(0).toUpperCase()).join("");
        const memberSince = user?.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : null;
        const emailVerified = Boolean(form.emailVerifiedAt || user?.emailVerifiedAt);

        return (
          <section
            className="relative overflow-hidden rounded-3xl text-white shadow-[0_18px_44px_-20px_rgba(1,40,36,0.75)]"
            style={{ background: "linear-gradient(135deg, #011a18 0%, #023a35 45%, #02665e 100%)" }}
            aria-labelledby="account-hero-name"
          >
            {/* Texture: soft light from the top right and a faint dot grid that fades out */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <div className="absolute inset-0" style={{ background: "radial-gradient(600px circle at 90% -10%, rgba(52,211,153,0.28), transparent 60%), radial-gradient(420px circle at -5% 110%, rgba(2,102,94,0.55), transparent 60%)" }} />
              <div
                className="absolute inset-0 opacity-[0.18]"
                style={{
                  backgroundImage: "radial-gradient(rgba(255,255,255,0.55) 1px, transparent 1px)",
                  backgroundSize: "18px 18px",
                  WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 55%, #000 100%)",
                  maskImage: "linear-gradient(90deg, transparent 0%, #000 55%, #000 100%)",
                }}
              />
              <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full border border-solid border-white/10" />
              <div className="absolute -right-4 -top-4 h-32 w-32 rounded-full border border-solid border-white/10" />
            </div>

            <div className="relative flex flex-col gap-5 px-5 py-5 sm:px-7 sm:py-7 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
              <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-4">
                {/* Avatar with change-photo control */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-0 bg-white/10 p-0 ring-[3px] ring-white/20 transition hover:ring-white/35 focus-visible:outline-none focus-visible:ring-emerald-300/60 sm:h-20 sm:w-20"
                    aria-label="Change profile photo"
                  >
                    {avatarSrc ? (
                      /^https?:\/\//i.test(avatarSrc) ? (
                        <Image src={avatarSrc} alt="" width={96} height={96} unoptimized className="h-full w-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
                      )
                    ) : (
                      <span className="text-[26px] font-bold tracking-tight text-white sm:text-[30px]">{initials || <User className="h-9 w-9" />}</span>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden="true">
                      <Upload className="h-5 w-5 text-white" />
                    </span>
                  </button>
                  <span
                    className="pointer-events-none absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#02665e] shadow-md ring-2 ring-[#023a35]"
                    aria-hidden="true"
                  >
                    <Upload className="h-3 w-3" strokeWidth={2.6} />
                  </span>
                </div>

                <div className="min-w-0">
                  <p className="m-0 text-[12px] font-medium text-emerald-200/80">{greeting}, {firstName}</p>
                  <h1 id="account-hero-name" className="m-0 truncate text-[22px] font-extrabold leading-tight tracking-tight sm:text-[28px]">
                    {displayName}
                  </h1>
                  {(form.email || user?.email) && (
                    <p className="m-0 mt-0.5 truncate text-[13px] text-white/65">{form.email || user?.email}</p>
                  )}
                </div>
              </div>

                  {/* Status chips: their own full-width row, lined up with the text on wider screens */}
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 sm:pl-24">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${emailVerified ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/25" : "bg-amber-400/15 text-amber-200 ring-amber-300/25"}`}>
                      {emailVerified ? <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                      {emailVerified ? "Verified" : "Email not verified"}
                    </span>
                    {user?.twoFactorEnabled && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] font-semibold text-white/85 ring-1 ring-inset ring-white/15">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        2-step on
                      </span>
                    )}
                    {memberSince && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] font-medium text-white/75 ring-1 ring-inset ring-white/15">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                        Member since {memberSince}
                      </span>
                    )}
                  </div>
              </div>

              {/* Right side: save a new photo when one is pending, otherwise quick actions */}
              {photoPending ? (
                <div className="flex flex-col gap-2 rounded-2xl bg-white/10 p-3 ring-1 ring-inset ring-white/15 sm:flex-row sm:items-center lg:shrink-0">
                  <span className="px-1 text-[13px] font-medium text-white/85">New photo selected</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setForm((current: any) => ({ ...current, avatarUrl: user?.avatarUrl ?? null }));
                        if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
                      }}
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border-0 bg-white/10 px-4 text-[13px] font-semibold text-white transition hover:bg-white/20 sm:flex-none"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border-0 bg-white px-4 text-[13px] font-semibold text-[#02665e] shadow-sm transition hover:bg-emerald-50 disabled:opacity-60 sm:flex-none"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                      {saving ? "Saving" : "Save photo"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 sm:pl-24 lg:shrink-0 lg:pl-0">
                  <Link
                    href="/public/properties"
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 text-[13px] font-semibold text-[#02665e] no-underline shadow-[0_6px_16px_-8px_rgba(0,0,0,0.5)] transition hover:bg-emerald-50 sm:flex-none"
                  >
                    <Hotel className="h-4 w-4" aria-hidden="true" />
                    Book a stay
                  </Link>
                  <Link
                    href="/account/bookings"
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3.5 text-[13px] font-semibold text-white no-underline ring-1 ring-inset ring-white/20 transition hover:bg-white/15 sm:flex-none"
                  >
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    My trips
                  </Link>
                </div>
              )}
            </div>

            <input ref={avatarFileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" title="Upload profile picture" />
          </section>
        );
      })()}
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

      {/* ══════ ACTIVITY OVERVIEW ══════ */}
      {(() => {
        const unpaidStays = statsLoaded ? stats.bookingsUnpaid : 0;
        const unpaidTours = statsLoaded ? stats.toursUnpaid : 0;
        const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
        // Real time left on the soonest payment window; once it passes, the next stats load clears the count
        const msLeft = paymentDeadline ? paymentDeadline - Date.now() : null;
        const deadlineText =
          msLeft === null
            ? "Complete payment before the window closes to keep your booking."
            : msLeft <= 0
              ? "The payment window has just closed. Refresh to see the latest status."
              : (() => {
                  const mins = Math.ceil(msLeft / 60_000);
                  const h = Math.floor(mins / 60);
                  const m = mins % 60;
                  const left = h > 0 ? `${h} h ${m} min` : `${m} min`;
                  const at = new Date(paymentDeadline!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  return `Pay within ${left} (by ${at}) or the booking is released.`;
                })();
        const attention =
          unpaidStays > 0 && unpaidTours > 0
            ? `${plural(unpaidStays, "stay")} and ${plural(unpaidTours, "tour")} need payment`
            : unpaidStays > 0
              ? `${plural(unpaidStays, "stay")} ${unpaidStays === 1 ? "needs" : "need"} payment`
              : unpaidTours > 0
                ? `${plural(unpaidTours, "tour")} ${unpaidTours === 1 ? "needs" : "need"} payment`
                : null;

        const tiles = [
          { href: "/account/bookings", Icon: CalendarDays, label: "Stays", count: stats.bookings, unpaid: unpaidStays, span: "sm:col-span-2" },
          { href: "/account/rides", Icon: Car, label: "Rides", count: stats.rides, unpaid: 0, span: "sm:col-span-2" },
          { href: "/account/group-stays", Icon: Users, label: "Group stays", count: stats.groupStays, unpaid: 0, span: "sm:col-span-2" },
          { href: "/account/tour-packages", Icon: Compass, label: "Tours", count: stats.tourPackages, unpaid: unpaidTours, span: "sm:col-span-3" },
          // Last tile spans the row on phones so it is never left alone in a half-width slot.
          { href: "/account/saved", Icon: Heart, label: "Saved", count: stats.savedProperties, unpaid: 0, span: "col-span-2 sm:col-span-3" },
        ];

        return (
          <div className="space-y-3">
            {attention && (
              <div
                role="status"
                className="flex flex-col gap-3 rounded-2xl border border-solid border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/60 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-[0_6px_16px_-6px_rgba(217,119,6,0.7)]" aria-hidden="true">
                    <AlertCircle className="h-5 w-5" strokeWidth={2.4} />
                    <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-amber-400" />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[15px] font-bold text-amber-950">{attention}</p>
                    <p className="m-0 mt-0.5 text-[12.5px] text-amber-900/75">{deadlineText}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {unpaidStays > 0 && (
                    <Link
                      href="/account/bookings"
                      className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 text-[13.5px] font-semibold text-white no-underline shadow-sm transition hover:bg-amber-700 sm:flex-none"
                    >
                      {unpaidTours > 0 ? "Pay stays" : "Pay now"}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  {unpaidTours > 0 && (
                    <Link
                      href="/account/tour-packages"
                      className={`inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-4 text-[13.5px] font-semibold no-underline transition sm:flex-none ${
                        unpaidStays > 0
                          ? "border border-solid border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
                          : "bg-amber-600 text-white shadow-sm hover:bg-amber-700"
                      }`}
                    >
                      {unpaidStays > 0 ? "Pay tours" : "Pay now"}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </div>
            )}

            <nav aria-label="Your activity">
              <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-6 lg:grid-cols-5">
                {tiles.map(({ href, Icon, label, count, unpaid, span }) => (
                  <li key={href} className={`${span} lg:col-span-1`}>
                    <Link
                      href={href}
                      aria-label={`${label}: ${count}${unpaid > 0 ? `, ${unpaid} unpaid` : ""}`}
                      className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-solid border-[#02665e]/10 py-3 pl-3 pr-2.5 no-underline shadow-[0_1px_2px_rgba(2,102,94,0.06)] transition-all duration-200 hover:-translate-y-px hover:border-[#02665e]/30 hover:shadow-[0_10px_24px_-12px_rgba(2,102,94,0.45)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#02665e]/20"
                      style={{
                        background:
                          "radial-gradient(120% 140% at 100% 0%, rgba(2,102,94,0.10) 0%, rgba(2,102,94,0) 55%), linear-gradient(135deg, #ffffff 0%, #f6fbfa 60%, #eef7f5 100%)",
                      }}
                    >
                      {/* Faded watermark of the tile's own icon: texture that also says what the tile is */}
                      <Icon
                        className="pointer-events-none absolute -bottom-4 right-6 h-20 w-20 rotate-[-12deg] text-[#02665e] opacity-[0.06] transition-all duration-300 group-hover:rotate-0 group-hover:opacity-[0.1]"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      <span className="relative shrink-0" aria-hidden="true">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-[0_2px_6px_-2px_rgba(2,102,94,0.25)] ring-1 ring-inset ring-[#02665e]/10 text-[#02665e] transition-colors duration-200 group-hover:bg-[#02665e] group-hover:text-white">
                          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                        </span>
                        {/* Notification-style count: the one thing on this tile that needs you */}
                        {unpaid > 0 && (
                          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-white">
                            {unpaid > 9 ? "9+" : unpaid}
                          </span>
                        )}
                      </span>

                      <span className="relative min-w-0 flex-1" aria-hidden="true">
                        <span className="block text-[20px] font-bold leading-none tracking-tight tabular-nums text-slate-900">
                          {statsLoaded ? (count || 0).toLocaleString() : <span className="inline-block h-5 w-7 animate-pulse rounded-md bg-slate-100 align-middle" />}
                        </span>
                        <span className="mt-1 block truncate text-[12.5px] font-medium text-slate-500">{label}</span>
                      </span>

                      <ArrowRight
                        className="relative h-4 w-4 shrink-0 text-[#02665e]/35 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#02665e]"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        );
      })()}
      {/* ══════ PROFILE SECTION ══════ */}
      {(() => {
        const nameValue = form.fullName || form.name || user?.name || "";
        const emailValue = form.email || user?.email || "";
        const emailVerified = Boolean(form.emailVerifiedAt || user?.emailVerifiedAt);
        const phoneVerified = Boolean(form.phoneVerifiedAt || user?.phoneVerifiedAt);
        const hasAvatar = Boolean(form.avatarUrl || user?.avatarUrl);
        const focusField = (id: string) => {
          const el = document.getElementById(id);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          window.setTimeout(() => el?.focus(), 250);
        };
        // What a complete, trustworthy profile needs, in the order we suggest it.
        const checklist = [
          { done: Boolean(nameValue), label: "Add your name", run: null as null | (() => void) },
          { done: emailVerified, label: emailValue ? "Verify your email" : "Add an email", run: emailValue ? () => { void sendEmailVerificationCode(); } : null },
          { done: Boolean(form.phone), label: "Link a phone number", run: null },
          { done: hasAvatar, label: "Add a profile photo", run: () => handleAvatarClick() },
          { done: Boolean(String(form.address || "").trim()), label: "Add your address", run: () => focusField("profile-address") },
          { done: Boolean(String(form.nin || "").trim()), label: "Add an ID or passport number", run: () => focusField("profile-nin") },
        ];
        const doneCount = checklist.filter((item) => item.done).length;
        const nextStep = checklist.find((item) => !item.done);
        const isDirty =
          String(form.address || "").trim() !== String(user?.address || "").trim() ||
          String(form.nin || "").trim() !== String(user?.nin || "").trim() ||
          (form.avatarUrl || null) !== (user?.avatarUrl || null);

        const contacts = [
          {
            key: "name",
            Icon: User,
            label: "Full name",
            value: nameValue,
            empty: "Not set",
            status: null as null | { tone: "ok" | "muted" | "warn"; text: string },
          },
          {
            key: "email",
            Icon: Mail,
            label: "Email",
            value: emailValue,
            empty: "Not provided",
            status: emailValue ? (emailVerified ? { tone: "ok" as const, text: "Verified" } : { tone: "warn" as const, text: "Not verified" }) : null,
          },
          {
            key: "phone",
            Icon: Phone,
            label: "Phone",
            value: form.phone || "",
            empty: "Not provided",
            status: form.phone
              ? phoneVerified ? { tone: "ok" as const, text: "Verified" } : { tone: "muted" as const, text: "Linked" }
              : { tone: "warn" as const, text: "Required" },
          },
        ];

        return (
          <section
            className="overflow-hidden rounded-3xl border border-solid border-slate-200/80 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.05)]"
            aria-labelledby="profile-heading"
          >
            {/* Header with completion meter */}
            <div className="flex flex-col gap-4 px-5 pb-5 pt-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_6px_16px_-8px_rgba(2,102,94,0.8)]"
                  style={{ background: "linear-gradient(135deg, #011a18, #02665e)" }}
                  aria-hidden="true"
                >
                  <User className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <h2 id="profile-heading" className="m-0 text-[16px] font-bold tracking-tight text-slate-900">Personal information</h2>
                  <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">Used for bookings, receipts and support</p>
                </div>
              </div>

              <div className="w-full sm:w-[260px]">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-slate-700">Profile {Math.round((doneCount / checklist.length) * 100)}% complete</span>
                  <span className="tabular-nums text-slate-400">{doneCount}/{checklist.length}</span>
                </div>
                <div
                  className="mt-1.5 grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${checklist.length}, minmax(0, 1fr))` }}
                  role="progressbar"
                  aria-label="Profile completion"
                  aria-valuemin={0}
                  aria-valuemax={checklist.length}
                  aria-valuenow={doneCount}
                >
                  {checklist.map((item, index) => (
                    <span key={index} className={`h-1.5 rounded-full ${item.done ? "bg-[#02665e]" : "bg-slate-200"}`} />
                  ))}
                </div>
                {nextStep && !nextStep.run ? (
                  <p className="m-0 mt-2 text-[12px] font-semibold text-slate-600">Next: {nextStep.label}</p>
                ) : nextStep?.run ? (
                  <button
                    type="button"
                    onClick={nextStep.run}
                    className="mt-2 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12px] font-semibold text-[#02665e] hover:underline"
                  >
                    Next: {nextStep.label}
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                ) : (
                  <p className="m-0 mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
                    <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Your profile is complete
                  </p>
                )}
              </div>
            </div>

            {/* Contact tiles */}
            <div className="grid gap-3 px-5 sm:px-6 md:grid-cols-3">
              {contacts.map(({ key, Icon, label, value, empty, status }) => (
                <div key={key} className="flex min-w-0 flex-col rounded-2xl border border-solid border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#02665e] ring-1 ring-inset ring-slate-200">
                      <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                    </span>
                    {status && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                          status.tone === "ok"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : status.tone === "warn"
                              ? "bg-amber-50 text-amber-800 ring-amber-200"
                              : "bg-white text-slate-600 ring-slate-200"
                        }`}
                      >
                        {status.tone === "ok" && <CheckCircle className="h-3 w-3" aria-hidden="true" />}
                        {status.text}
                      </span>
                    )}
                  </div>
                  <p className="m-0 mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
                  <p className="m-0 mt-0.5 min-w-0 truncate text-[14.5px] font-semibold text-slate-900" title={value || undefined}>
                    {value || <span className="font-normal text-slate-400">{empty}</span>}
                  </p>

                  {key === "email" && emailValue && !emailVerified && (
                    <button
                      type="button"
                      onClick={sendEmailVerificationCode}
                      disabled={sendingEmailVerification || confirmingEmailVerification}
                      className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-3 text-[12.5px] font-semibold text-white transition hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sendingEmailVerification ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                      {sendingEmailVerification ? "Sending" : emailVerificationOpen ? "Resend code" : "Verify email"}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {emailVerificationOpen && !emailVerified && (
              <div className="mx-5 mt-3 rounded-2xl border border-solid border-[#02665e]/20 bg-[#02665e]/[0.03] p-4 sm:mx-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold text-slate-900">Enter the code sent to {emailValue}</div>
                    <p className="mb-0 mt-0.5 text-[12px] leading-5 text-slate-500">It expires after five minutes. Check spam if it is not in your inbox.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setEmailVerificationOpen(false); setEmailVerificationCode(""); }}
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border-0 bg-transparent text-slate-400 transition hover:bg-white hover:text-slate-700"
                    aria-label="Close email verification"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:max-w-md sm:flex-row">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={emailVerificationCode}
                    onChange={(event) => setEmailVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                    onKeyDown={(event) => { if (event.key === "Enter" && !confirmingEmailVerification) void confirmEmailVerificationCode(); }}
                    placeholder="Verification code"
                    aria-label="Email verification code"
                    className="box-border h-11 min-w-0 flex-1 rounded-xl border border-solid border-slate-200 bg-white px-3.5 text-[15px] font-semibold tracking-[0.2em] text-slate-900 outline-none transition placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:border-[#02665e] focus:shadow-[0_0_0_3px_rgba(2,102,94,0.12)]"
                  />
                  <button
                    type="button"
                    onClick={confirmEmailVerificationCode}
                    disabled={confirmingEmailVerification || emailVerificationCode.trim().length < 4}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-4 text-[13.5px] font-semibold text-white transition hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirmingEmailVerification ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle className="h-4 w-4" aria-hidden="true" />}
                    {confirmingEmailVerification ? "Verifying" : "Confirm"}
                  </button>
                </div>
              </div>
            )}

            {/* Editable details */}
            <div className="px-5 pb-6 pt-6 sm:px-6">
              <div className="flex items-center gap-3">
                <h3 className="m-0 text-[13.5px] font-bold text-slate-900">Additional details</h3>
                <span className="h-px flex-1 bg-slate-100" aria-hidden="true" />
                <span className="text-[11.5px] font-medium text-slate-400">Optional, private to you</span>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="profile-address" className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">Address</label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      id="profile-address"
                      className="box-border h-11 w-full rounded-xl border border-solid border-slate-200 bg-white pl-10 pr-3.5 text-[14px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#02665e] focus:shadow-[0_0_0_3px_rgba(2,102,94,0.12)]"
                      value={form.address || ""}
                      onChange={(event) => setForm({ ...form, address: event.target.value })}
                      maxLength={500}
                      autoComplete="street-address"
                      placeholder="Residential or business address"
                    />
                  </div>
                </div>

                <div className="min-w-0">
                  <label htmlFor="profile-nin" className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">National ID or passport</label>
                  <div className="relative">
                    <IdCard className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      id="profile-nin"
                      type={showIdentityNumber ? "text" : "password"}
                      className="box-border h-11 w-full rounded-xl border border-solid border-slate-200 bg-white pl-10 pr-11 text-[14px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#02665e] focus:shadow-[0_0_0_3px_rgba(2,102,94,0.12)]"
                      value={form.nin || ""}
                      onChange={(event) => setForm({ ...form, nin: event.target.value })}
                      maxLength={50}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="ID or passport number"
                    />
                    <button
                      type="button"
                      onClick={() => setShowIdentityNumber((current) => !current)}
                      className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg border-0 bg-transparent text-slate-400 transition hover:bg-slate-100 hover:text-[#02665e]"
                      aria-label={showIdentityNumber ? "Hide identity number" : "Show identity number"}
                      aria-pressed={showIdentityNumber}
                      aria-controls="profile-nin"
                    >
                      {showIdentityNumber ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
                <span className="text-center text-[12px] text-slate-400 sm:text-right" aria-live="polite">
                  {isDirty ? "You have unsaved changes" : "All changes saved"}
                </span>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !isDirty}
                  aria-busy={saving || undefined}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border-0 px-5 text-[13.5px] font-semibold text-white transition-all hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                  style={{ background: "linear-gradient(135deg, #011a18 0%, #02665e 100%)" }}
                >
                  {saving ? (
                    <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Saving</>
                  ) : (
                    <><Save className="h-4 w-4" aria-hidden="true" />Save changes</>
                  )}
                </button>
              </div>
            </div>
          </section>
        );
      })()}
      {/* ══════ REFERRAL CARD ══════ */}
      <section
        className="relative overflow-hidden rounded-3xl border border-solid border-slate-200/80 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.05)]"
        aria-labelledby="referral-heading"
      >
        {/* Header: same structure as the other account cards */}
        <div className="flex flex-col gap-4 px-5 pb-2 pt-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_6px_16px_-8px_rgba(2,102,94,0.8)]"
              style={{ background: "linear-gradient(135deg, #011a18, #02665e)" }}
              aria-hidden="true"
            >
              <Share2 className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h3 id="referral-heading" className="m-0 text-[16px] font-bold tracking-tight text-slate-900">Invite friends</h3>
              <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">Share your link and earn rewards</p>
            </div>
          </div>

          {referralCode && (
            <button
              type="button"
              onClick={() => void handleCopy("code")}
              className="group inline-flex items-center gap-3 self-start rounded-xl border border-dashed border-[#02665e]/35 bg-[#02665e]/[0.04] py-2 pl-3.5 pr-3 text-left transition hover:border-[#02665e]/60 hover:bg-[#02665e]/[0.07] sm:self-auto"
              aria-label={`Copy referral code ${referralCode}`}
            >
              <span className="flex flex-col">
                <span className="text-[10.5px] font-semibold text-slate-500">Your code</span>
                <span className="font-mono text-[15px] font-bold tracking-[0.06em] text-slate-900">{referralCode}</span>
              </span>
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${copied === "code" ? "bg-emerald-500 text-white" : "bg-white text-[#02665e] ring-1 ring-inset ring-slate-200 group-hover:ring-[#02665e]/30"}`} aria-hidden="true">
                {copied === "code" ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" />}
              </span>
            </button>
          )}
        </div>
        <div className="px-5 pb-6 pt-5 sm:px-6">
          {/* Link + copy */}
          <label htmlFor="referral-link" className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">Your invite link</label>
          <div className="flex items-stretch gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-solid border-slate-200 bg-slate-50 pl-3.5 pr-2">
              <input
                id="referral-link"
                readOnly
                value={referralLink ?? ""}
                placeholder="Preparing your link"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13.5px] text-slate-700 outline-none"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleCopy("link")}
              disabled={!referralLink}
              className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border-0 px-4 text-[13.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                copied === "link" ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" : "bg-[#02665e] text-white hover:bg-[#014e47]"
              }`}
              aria-live="polite"
            >
              {copied === "link" ? <><Check className="h-4 w-4" aria-hidden="true" />Copied</> : <><Copy className="h-4 w-4" aria-hidden="true" />Copy</>}
            </button>
          </div>

          {/* Share targets */}
          <div className={`mt-3 grid gap-2 ${canNativeShare ? "grid-cols-2" : "grid-cols-1"}`}>
            <button
              type="button"
              onClick={handleWhatsApp}
              disabled={!referralLink}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-solid border-[#25D366]/40 bg-[#25D366]/[0.08] px-4 text-[13.5px] font-semibold text-[#128C4B] transition hover:bg-[#25D366]/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              WhatsApp
            </button>
            {canNativeShare && (
              <button
                type="button"
                onClick={() => void handleNativeShare()}
                disabled={!referralLink}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-solid border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                More options
              </button>
            )}
          </div>

          {/* How it works */}
          <ol className="m-0 mt-5 grid list-none gap-3 border-0 border-t border-solid border-slate-100 p-0 pt-5 sm:grid-cols-3">
            {[
              { n: 1, title: "Share your link", text: "Send it to friends and family" },
              { n: 2, title: "They sign up", text: "Using your link or code" },
              { n: 3, title: "You earn rewards", text: "When they join NoLSAF" },
            ].map((step) => (
              <li key={step.n} className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#02665e]/[0.08] text-[11.5px] font-bold text-[#02665e]" aria-hidden="true">
                  {step.n}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-slate-800">{step.title}</span>
                  <span className="block text-[11.5px] leading-snug text-slate-500">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
      {/* ══════ SECURITY CARD ══════ */}
      {(() => {
        const emailVerified = Boolean(form.emailVerifiedAt || user?.emailVerifiedAt);
        const phoneVerified = Boolean(form.phoneVerifiedAt || user?.phoneVerifiedAt);
        const checks = [
          { key: "password", label: "Password", done: user?.hasPassword !== false, doneText: "Set", todoText: "Create one", href: "/account/security" },
          { key: "2fa", label: "Two-step verification", done: Boolean(user?.twoFactorEnabled), doneText: "On", todoText: "Turn on", href: "/account/security/2fa" },
          ...(passkeyCount === null
            ? []
            : [{ key: "passkey", label: "Passkey", done: passkeyCount > 0, doneText: passkeyCount === 1 ? "1 added" : `${passkeyCount} added`, todoText: "Add one", href: "/account/security" }]),
          { key: "email", label: "Verified email", done: emailVerified, doneText: "Verified", todoText: "Verify", href: null as string | null },
          { key: "phone", label: "Verified phone", done: phoneVerified, doneText: "Verified", todoText: form.phone ? "Not verified" : "Add a phone", href: null as string | null },
        ];
        const passed = checks.filter((c) => c.done).length;
        const ratio = checks.length ? passed / checks.length : 0;
        // Two-step verification carries the most weight: without it a stolen password is enough.
        const level = !user?.twoFactorEnabled
          ? { label: "Needs attention", tone: "text-amber-700", ring: "#d97706", chip: "bg-amber-50 text-amber-800 ring-amber-200" }
          : ratio >= 0.99
            ? { label: "Strong", tone: "text-emerald-700", ring: "#059669", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
            : { label: "Good", tone: "text-[#02665e]", ring: "#02665e", chip: "bg-[#02665e]/[0.06] text-[#02665e] ring-[#02665e]/20" };
        const firstTodo = checks.find((c) => !c.done && c.href);
        const circumference = 2 * Math.PI * 22;

        return (
          <section
            className="overflow-hidden rounded-3xl border border-solid border-slate-200/80 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.05)]"
            aria-labelledby="security-heading"
          >
            <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
              {/* Score ring */}
              <div className="flex items-center gap-4 sm:w-[300px] sm:shrink-0">
                <div className="relative h-14 w-14 shrink-0" role="img" aria-label={`Security ${passed} of ${checks.length} checks passed`}>
                  <svg viewBox="0 0 52 52" className="h-14 w-14 -rotate-90" aria-hidden="true">
                    <circle cx="26" cy="26" r="22" fill="none" stroke="#e2e8f0" strokeWidth="5" />
                    <circle
                      cx="26" cy="26" r="22" fill="none" stroke={level.ring} strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)}
                      style={{ transition: "stroke-dashoffset 600ms ease" }}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Shield className={`h-5 w-5 ${level.tone}`} strokeWidth={2.2} aria-hidden="true" />
                  </span>
                </div>
                <div className="min-w-0">
                  <h3 id="security-heading" className="m-0 text-[16px] font-bold tracking-tight text-slate-900">Account security</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${level.chip}`}>{level.label}</span>
                    <span className="text-[12px] tabular-nums text-slate-500">{passed} of {checks.length} checks</span>
                  </div>
                </div>
              </div>

              {/* Checklist */}
              <ul className="m-0 grid min-w-0 flex-1 list-none grid-cols-1 gap-x-5 gap-y-2 p-0 sm:grid-cols-2">
                {checks.map((c) => {
                  const row = (
                    <>
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${c.done ? "bg-emerald-500 text-white" : "bg-amber-100 text-amber-700"}`}
                        aria-hidden="true"
                      >
                        {c.done ? <Check className="h-3 w-3" strokeWidth={3} /> : <AlertCircle className="h-3 w-3" strokeWidth={2.5} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{c.label}</span>
                      <span className={`shrink-0 text-[12px] font-semibold ${c.done ? "text-slate-400" : c.href ? "text-[#02665e]" : "text-amber-700"}`}>
                        {c.done ? c.doneText : c.todoText}
                      </span>
                    </>
                  );
                  return (
                    <li key={c.key} className="min-w-0">
                      {!c.done && c.href ? (
                        <Link href={c.href} className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 no-underline transition hover:bg-[#02665e]/[0.05]">
                          {row}
                        </Link>
                      ) : (
                        <div className="-mx-2 flex items-center gap-2.5 px-2 py-1.5">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="m-0 text-[12.5px] text-slate-500">
                {firstTodo
                  ? firstTodo.key === "2fa"
                    ? "Turn on two-step verification so a stolen password is not enough to get in."
                    : `Recommended next: ${firstTodo.label.toLowerCase()}.`
                  : "Your sign-in is well protected. Review active sessions from time to time."}
              </p>
              <Link
                href={firstTodo?.href || "/account/security"}
                className="group inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold text-white no-underline transition-all hover:shadow-md"
                style={{ background: "linear-gradient(135deg, #011a18 0%, #02665e 100%)" }}
              >
                {firstTodo ? firstTodo.todoText : "Manage security"}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </div>
          </section>
        );
      })()}
    </div>
  );
}
