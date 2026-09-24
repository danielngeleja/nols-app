"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, BadgeCheck, Building2, CheckCircle2, Clock3, Fingerprint, Loader2, MapPin, ShieldCheck, UserRound, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Profile = {
  legalName: string;
  tradingName: string | null;
  registrationNo: string | null;
  tin: string | null;
  licenseNo: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  countryCode: string;
  nationality: string | null;
  documents: Array<{ type: string }>;
  verificationStatus: string;
  verificationNote: string | null;
  verifiedAt?: string | null;
  updatedAt?: string | null;
};

const empty: Profile = {
  legalName: "",
  tradingName: null,
  registrationNo: null,
  tin: null,
  licenseNo: null,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  address: null,
  countryCode: "TZ",
  nationality: null,
  documents: [],
  verificationStatus: "PENDING",
  verificationNote: null,
};

function valueOrDash(value: string | null | undefined) {
  return String(value || "").trim() || "—";
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function InfoRow({ label, value, icon }: { label: string; value: string | null | undefined; icon?: ReactNode }) {
  const missing = !String(value || "").trim();
  return (
    <div className="grid min-w-0 grid-cols-[minmax(7.5rem,0.7fr)_minmax(0,1.3fr)] items-start gap-4 py-3.5">
      <span className="flex items-center gap-2 text-xs font-medium text-neutral-500">{icon}{label}</span>
      <span className={`min-w-0 break-words text-sm font-semibold leading-5 ${missing ? "text-neutral-400" : "text-neutral-900"}`}>{valueOrDash(value)}</span>
    </div>
  );
}

export default function AgentProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void apiClient.get<any>("/api/agent-portal/profile").then((response) => {
      if (live) setProfile({ ...empty, ...(response.data?.profile || {}), documents: Array.isArray(response.data?.profile?.documents) ? response.data.profile.documents : [] });
    }).catch((cause) => {
      if (live) setError(cause?.response?.data?.error || "Agency qualification could not be loaded");
    });
    return () => { live = false; };
  }, []);

  if (error) return (
    <div role="alert" className="mx-auto flex w-full max-w-5xl items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <div><p className="m-0 font-bold">Unable to show qualification</p><p className="m-0 mt-1 text-sm leading-5">{error}</p></div>
    </div>
  );

  if (!profile) return (
    <div className="mx-auto flex min-h-56 w-full max-w-5xl items-center justify-center rounded-2xl border border-neutral-200 bg-white text-sm text-neutral-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-600" /> Loading qualification…
    </div>
  );

  const verified = profile.verificationStatus === "VERIFIED";
  const rejected = profile.verificationStatus === "REJECTED";
  const verifiedDate = formatDate(profile.verifiedAt);
  const status = verified
    ? { label: "Verified", detail: verifiedDate ? `Approved ${verifiedDate}` : "Approved by NoLSAF", Icon: BadgeCheck, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" }
    : rejected
      ? { label: "Review required", detail: profile.verificationNote || "Qualification needs attention", Icon: XCircle, cls: "border-red-200 bg-red-50 text-red-700" }
      : { label: "Under review", detail: "NoLSAF review is in progress", Icon: Clock3, cls: "border-amber-200 bg-amber-50 text-amber-700" };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Identity &amp; compliance</p>
          <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-neutral-950">Agency profile &amp; KYC</h1>
          <p className="m-0 mt-1 text-sm leading-6 text-neutral-500">Your read-only NoLSAF qualification record.</p>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${status.cls}`}><status.Icon className="h-4 w-4" />{status.label}</span>
      </div>

      <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-neutral-950 text-white"><Building2 className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xl font-bold tracking-tight text-neutral-950">{profile.tradingName || profile.legalName || "Agency"}</p>
            {profile.tradingName && profile.legalName !== profile.tradingName ? <p className="m-0 mt-1 text-sm text-neutral-500">{profile.legalName}</p> : null}
          </div>
          <div className="sm:text-right"><p className="m-0 text-sm font-bold text-neutral-900">{status.detail}</p><p className="m-0 mt-1 text-xs text-neutral-500">Managed from My Profile</p></div>
        </div>

        <div className="grid gap-px border-0 border-y border-solid border-neutral-100 bg-neutral-200 sm:grid-cols-3">
          {[
            { Icon: Fingerprint, label: "Legal identity", value: profile.legalName ? "Confirmed" : "Not recorded" },
            { Icon: ShieldCheck, label: "KYC review", value: verified ? "Passed" : rejected ? "Action required" : "Pending" },
            { Icon: CheckCircle2, label: "Agency standing", value: verified ? "Qualified" : "Not yet qualified" },
          ].map(({ Icon, label, value }) => (
            <div key={label} className="flex min-w-0 items-center gap-3 bg-neutral-50/80 px-5 py-4">
              <Icon className={`h-5 w-5 shrink-0 ${verified ? "text-emerald-600" : "text-neutral-400"}`} />
              <div className="min-w-0"><p className="m-0 text-xs text-neutral-500">{label}</p><p className="m-0 mt-0.5 truncate text-sm font-bold text-neutral-900">{value}</p></div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2">
          <section className="min-w-0 p-5 sm:p-6 lg:border-0 lg:border-r lg:border-solid lg:border-neutral-100">
            <div className="mb-2 flex items-center gap-2.5"><Building2 className="h-5 w-5 text-neutral-400" /><h2 className="m-0 text-base font-bold text-neutral-950">Business record</h2></div>
            <div className="divide-y divide-neutral-100">
              <InfoRow label="Legal name" value={profile.legalName} />
              <InfoRow label="Trading name" value={profile.tradingName} />
              <InfoRow label="Registration" value={profile.registrationNo} />
              <InfoRow label="TIN" value={profile.tin} />
              <InfoRow label="Operating licence" value={profile.licenseNo} />
              <InfoRow label="Country" value={profile.countryCode} />
            </div>
          </section>

          <section className="min-w-0 border-0 border-t border-solid border-neutral-100 p-5 sm:p-6 lg:border-t-0">
            <div className="mb-2 flex items-center gap-2.5"><UserRound className="h-5 w-5 text-neutral-400" /><h2 className="m-0 text-base font-bold text-neutral-950">Representative</h2></div>
            <div className="divide-y divide-neutral-100">
              <InfoRow label="Contact person" value={profile.contactName} />
              <InfoRow label="Email" value={profile.contactEmail} />
              <InfoRow label="Phone" value={profile.contactPhone} />
              <InfoRow label="Nationality" value={profile.nationality} />
              <InfoRow label="Address" value={profile.address} icon={<MapPin className="h-3.5 w-3.5 shrink-0" />} />
            </div>
          </section>
        </div>

        <footer className="flex items-start gap-2.5 border-0 border-t border-solid border-neutral-100 bg-neutral-50 px-5 py-4 text-xs leading-5 text-neutral-500 sm:px-6">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span>This record is not editable here. Updates made in My Profile are reflected automatically while NoLSAF retains the qualification decision.</span>
        </footer>
      </article>
    </div>
  );
}
