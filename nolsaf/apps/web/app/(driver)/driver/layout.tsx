"use client";
// apps/web/app/(driver)/driver/layout.tsx
import "@/styles/globals.css";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import DriverSiteHeader from "@/components/DriverSiteHeader";
import DriverFooter from "@/components/DriverFooter";
import DriverSidebar from "@/components/DriverSidebar";
import LayoutFrame from "@/components/LayoutFrame";
import MobileDriverNav from "@/components/MobileDriverNav";
import Link from "next/link";
import { Clock, ShieldX, CheckCircle2, AlertTriangle, RefreshCw, MessageSquare, Edit3 } from "lucide-react";

type KycStatus = 'PENDING_KYC' | 'APPROVED_KYC' | 'REJECTED_KYC' | null;

type DriverAccountSnapshot = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  nationality?: string | null;
  nin?: string | null;
  region?: string | null;
  district?: string | null;
  operationArea?: string | null;
  vehicleType?: string | null;
  plateNumber?: string | null;
  licenseNumber?: string | null;
  paymentPhone?: string | null;
  paymentVerified?: boolean | null;
  documents?: Array<{ type?: string | null; url?: string | null }> | null;
};

const REQUIRED_DRIVER_DOCUMENT_GROUPS = [
  ['DRIVER_LICENSE', 'DRIVING_LICENSE', 'DRIVER_LICENCE', 'DRIVING_LICENCE', 'LICENSE'],
  ['NATIONAL_ID', 'ID', 'PASSPORT'],
  ['VEHICLE_REGISTRATION', 'LATRA', 'VEHICLE_REG'],
  ['INSURANCE'],
];

function isDriverOnboardingComplete(account: DriverAccountSnapshot | null | undefined): boolean {
  if (!account) return false;
  const requiredTextFields = [
    account.name,
    account.email,
    account.phone,
    account.gender,
    account.nationality,
    account.nin,
    account.region,
    account.district,
    account.operationArea,
    account.vehicleType,
    account.plateNumber,
    account.licenseNumber,
    account.paymentPhone,
  ];
  if (requiredTextFields.some((value) => !String(value ?? '').trim())) return false;
  if (!Boolean(account.paymentVerified)) return false;

  const docs = Array.isArray(account.documents) ? account.documents : [];
  const docTypes = new Set(
    docs
      .filter((doc) => doc?.url)
      .map((doc) => String(doc?.type ?? '').toUpperCase())
  );

  return REQUIRED_DRIVER_DOCUMENT_GROUPS.every((group) => group.some((type) => docTypes.has(type)));
}

function cleanDecisionReason(note: string | null | undefined): string {
  const value = String(note ?? '').trim();
  if (!value) return 'Your access to the NoLSAF driver account is currently inactive.';
  return value
    .replace(/^Rejection reason:\s*/i, '')
    .replace(/^Revocation reason:\s*/i, '')
    .trim();
}

function PendingApprovalScreen({ kycNote }: { kycNote: string | null }) {
  const hasNote = !!kycNote;

  if (hasNote) {
    // Admin has requested additional information / corrections
    return (
      <div className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 45%, #02665e 100%)" }}>
        <div className="max-w-md w-full">
          {/* Card */}
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  <MessageSquare className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-white/60 uppercase tracking-[0.12em]">Action Required</p>
                  <h1 className="text-lg font-extrabold text-white leading-tight">Update Your Application</h1>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Admin note box */}
              <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                  <span className="text-xs font-black text-orange-700">Message from NoLSAF Team</span>
                </div>
                <p className="text-sm text-orange-900 leading-relaxed">{kycNote}</p>
              </div>

              {/* What to do */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">What to do</p>
                <ul className="space-y-1.5 text-xs text-slate-600">
                  <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#02665e] flex-shrink-0" />Read the message above carefully</li>
                  <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#02665e] flex-shrink-0" />Click the button below to update your profile</li>
                  <li className="flex items-start gap-2"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#02665e] flex-shrink-0" />Re-submit for review once corrections are made</li>
                </ul>
              </div>

              {/* CTA */}
              <Link
                href="/account/onboard/driver"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white no-underline transition-all shadow-md hover:shadow-lg animate-pulse hover:animate-none"
                style={{ background: "linear-gradient(135deg, #0e2a7a, #02665e)" }}
              >
                <Edit3 className="w-4 h-4" />
                Update My Application
              </Link>

              <div className="text-center">
                <p className="text-xs text-slate-400">
                  Questions? <a href="mailto:support@nolsaf.com" className="text-[#02665e] hover:underline font-medium">support@nolsaf.com</a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Normal pending — waiting for admin review
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50/30 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-amber-200/60 overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500 to-amber-400 p-6 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <Clock className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Application Under Review</h1>
          <p className="text-amber-100 text-sm mt-1">Your driver application is being processed</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-3">
            {[
              { icon: CheckCircle2, text: "Registration details submitted", done: true },
              { icon: Clock, text: "Admin review in progress", done: false },
              { icon: CheckCircle2, text: "Account activation", done: false },
            ].map(({ icon: Icon, text, done }, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                  <Icon className={`w-4 h-4 ${done ? 'text-emerald-600' : 'text-amber-500'}`} />
                </div>
                <span className={`text-sm ${done ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>{text}</span>
              </div>
            ))}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm text-amber-800 font-medium mb-1">What happens next?</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Our team will verify your documents and details within <strong>1–2 business days</strong>.
              You'll be notified by SMS once your account is approved and you can start receiving trip requests.
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-400">Need help? Contact us at <a href="mailto:support@nolsaf.com" className="text-amber-600 hover:underline">support@nolsaf.com</a></p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Check status
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectedScreen({ driverName, kycNote }: { driverName: string | null; kycNote: string | null }) {
  const displayName = String(driverName ?? 'Driver').trim() || 'Driver';
  const reason = cleanDecisionReason(kycNote);
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-red-50/30 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-red-200/60 overflow-hidden">
        <div className="bg-gradient-to-r from-red-600 to-red-500 p-6 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <ShieldX className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Application Not Approved</h1>
          <p className="text-red-100 text-sm mt-1">Your driver application was not accepted</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-white border border-red-100 rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-red-500">Account holder</p>
            <p className="mt-1 text-base font-bold text-slate-900">{displayName}</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 mb-1">Why you cannot access this account</p>
              <p className="text-xs text-red-700 leading-relaxed">
                {reason}
              </p>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-medium text-slate-800 mb-2">Next steps</p>
            <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
              <li>Contact NoLSAF support if you believe this decision should be reviewed</li>
              <li>Prepare any corrected documents or clarification requested by the team</li>
              <li>Wait for the support review before attempting to use this account again</li>
            </ul>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-medium text-amber-900 mb-1">Payout handling</p>
            <p className="text-xs text-amber-800 leading-relaxed">
              Any active and unpaid payout already recorded before the revocation date will still be reviewed and processed under NoLSAF payout policy.
            </p>
          </div>
          <a
            href="mailto:support@nolsaf.com"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium no-underline hover:bg-red-700 transition-colors animate-pulse hover:animate-none"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}

function CompleteOnboardingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #09111f 0%, #0e2a7a 48%, #02665e 100%)' }}>
      <div className="max-w-lg w-full bg-white rounded-3xl shadow-2xl overflow-hidden border border-white/10">
        <div className="bg-gradient-to-r from-[#0e2a7a] via-[#0a5c82] to-[#02665e] px-6 py-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
              <Edit3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-black tracking-[0.16em] uppercase text-white/60">Driver Onboarding</p>
              <h1 className="text-xl font-extrabold text-white leading-tight">Finish Your Professional Profile</h1>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
            <p className="text-sm font-semibold text-amber-900">Driver activities stay locked until onboarding is complete.</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              Complete your operation area, verify the payout phone, and upload the full driver document pack so the admin team can review the complete application in one pass.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 mb-2">Required before access</p>
            <ul className="space-y-1.5 text-sm text-slate-700">
              <li>Personal and vehicle details completed</li>
              <li>Region, district, and operation area selected</li>
              <li>Payment phone verified</li>
              <li>Driving licence, National ID, vehicle registration, and insurance uploaded</li>
            </ul>
          </div>
          <Link
            href="/account/onboard/driver"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm text-white no-underline transition-all shadow-md hover:shadow-lg"
            style={{ background: 'linear-gradient(135deg, #0e2a7a, #02665e)' }}
          >
            <Edit3 className="w-4 h-4" />
            Continue Driver Onboarding
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function DriverLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [kycStatus, setKycStatus] = useState<KycStatus | 'loading'>('loading');
  const [kycNote, setKycNote] = useState<string | null>(null);
  const [driverName, setDriverName] = useState<string | null>(null);
  const [accountSuspended, setAccountSuspended] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/account/me', { credentials: 'include' });
        if (!r.ok) { window.location.href = '/driver/login'; return; }
        const json = await r.json().catch(() => null);
        const me = json?.data ?? json;
        setKycStatus((me?.kycStatus as KycStatus) ?? null);
        setKycNote(me?.kycNote ?? null);
        setDriverName(me?.name ?? null);
        setAccountSuspended(Boolean(me?.suspendedAt) || Boolean(me?.isDisabled));
        setOnboardingComplete(isDriverOnboardingComplete(me as DriverAccountSnapshot));
      } catch {
        setKycStatus(null);
      }
    })();
  }, []);

  // Listen for global toggle events (header hamburger can dispatch `toggle-driver-sidebar`)
  useEffect(() => {
    const handler = () => {
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      if (isDesktop) {
        setSidebarOpen((v) => !v);
      } else {
        setMobileSidebarOpen((v) => !v);
      }
    };
    window.addEventListener("toggle-driver-sidebar", handler as EventListener);
    return () => window.removeEventListener("toggle-driver-sidebar", handler as EventListener);
  }, []);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  // Loading state — show minimal spinner while checking approval
  if (kycStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div role="status" aria-live="polite" className="flex flex-col items-center justify-center text-center">
          <div className="dot-spinner mb-3" aria-hidden>
            <span className="dot dot-green" />
            <span className="dot dot-yellow" />
            <span className="dot dot-blue" />
            <span className="dot dot-black" />
          </div>
        </div>
      </div>
    );
  }

  // Pending KYC — driver must wait for admin approval (or action required if note present)
  if (kycStatus === 'PENDING_KYC') return <PendingApprovalScreen kycNote={kycNote} />;

  if (kycStatus === null && !onboardingComplete) return <CompleteOnboardingScreen />;

  if (accountSuspended) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-red-50/30 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-red-200/60 overflow-hidden">
          <div className="bg-gradient-to-r from-red-600 to-red-500 p-6 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <ShieldX className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">Your Account Is Suspended</h1>
            <p className="text-red-100 text-sm mt-1">This driver account cannot access the NoLSAF platform right now</p>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-white border border-red-100 rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-red-500">Account holder</p>
              <p className="mt-1 text-base font-bold text-slate-900">{String(driverName ?? 'Driver').trim() || 'Driver'}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 mb-1">Reason for suspension</p>
                <p className="text-xs text-red-700 leading-relaxed">{cleanDecisionReason(kycNote)}</p>
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-800 mb-2">What to do next</p>
              <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
                <li>Contact NoLSAF support if you want this suspension reviewed</li>
                <li>Use your suspension reference number from the email or login notice when appealing</li>
                <li>Wait for an official review before trying to use this account again</li>
              </ul>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-medium text-amber-900 mb-1">Payout handling</p>
              <p className="text-xs text-amber-800 leading-relaxed">
                Any active and unpaid payout already recorded before the suspension date will still be reviewed and processed under NoLSAF payout policy.
              </p>
            </div>
            <a
              href="mailto:support@nolsaf.com"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium no-underline hover:bg-red-700 transition-colors animate-pulse hover:animate-none"
            >
              Contact Support
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Rejected — application was denied
  if (kycStatus === 'REJECTED_KYC') return <RejectedScreen driverName={driverName} kycNote={kycNote} />;

  // null (legacy / pre-approval drivers) or APPROVED_KYC — allow access
  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* Full-width header in driver mode */}
      <DriverSiteHeader />

      <div className="flex-1 w-full overflow-x-hidden relative z-10">
        <div className="public-container w-full relative">
          {/* Frame spanning sidebar + content (match admin layout) */}
          <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" box boxRadiusClass="rounded-2xl" className="mb-2" />

          {/* Sidebar anchored inside the frame container */}
          <aside
            className={`${sidebarOpen ? "md:block" : "md:hidden"} hidden absolute left-2 sm:left-3 md:left-4 top-16 w-56 owner-sidebar-container rounded-2xl z-0 h-[calc(100vh-4rem)] overflow-hidden`}
          >
            <div className="h-full overflow-y-auto scroll-smooth pb-4">
              <div className="p-2 pt-2">
                <DriverSidebar />
              </div>
            </div>
          </aside>

          {/* Mobile off-canvas sidebar */}
          {mobileSidebarOpen && (
            <div className="md:hidden fixed inset-0 z-40">
              <button
                type="button"
                aria-label="Close sidebar"
                className="absolute inset-0 bg-black/20 backdrop-blur-sm nols-soft-overlay"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <aside className="absolute left-0 top-16 h-[calc(100%-4rem)] w-[min(17.5rem,calc(100vw-1rem))] p-2 nols-soft-popover">
                <div className="sidebar-scroll h-full overflow-y-auto scroll-smooth rounded-3xl">
                  <DriverSidebar />
                </div>
              </aside>
            </div>
          )}

          {/* Main content with gap matching sidebar (owner style) */}
          <div className={`pt-16 pb-24 md:pb-6 app-driver-layout ${sidebarOpen ? "owner-content-gap" : ""} ${sidebarOpen ? "md:border-l md:border-slate-200" : ""}`}>
            <main className="w-full max-w-full overflow-x-hidden">
              {children}
            </main>
          </div>
        </div>
      </div>

      <div className="pb-20 md:pb-0">
        <DriverFooter />
      </div>

      <MobileDriverNav />
    </div>
  );
}
