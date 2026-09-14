"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SubmittedTourProfileCard from "@/components/SubmittedTourProfileCard";
import { slugifyProfile } from "@/lib/profileSlug";

type PackageItem = {
  status?: string;
};

type OperatorProfile = {
  companyName?: string;
  packageItems?: PackageItem[];
  [key: string]: unknown;
};

type PublicAgent = {
  id: number;
  publicKey: string;
  profile?: OperatorProfile | null;
};

export default function PublicTourOperatorProfilePage() {
  const routeParams = useParams<{ id: string }>();
  const routeId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const publicKey = String(routeId || "").trim().toLowerCase();
    if (!/^[a-z0-9]{20,40}$/.test(publicKey)) {
      setAgent(null);
      setError("Invalid operator profile link.");
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    async function loadOperator() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<PublicAgent>(`/api/public/agents/${encodeURIComponent(publicKey)}`);
        if (!cancelled) setAgent(res.data);
      } catch {
        if (!cancelled) setError("This operator profile is not available right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadOperator();
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const profile = agent?.profile || null;
  const hasApprovedPackage = useMemo(() => {
    const packages = Array.isArray(profile?.packageItems) ? profile.packageItems : [];
    return packages.some((pkg) => {
      const status = String(pkg?.status || "APPROVED").toUpperCase();
      return ["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"].includes(status);
    });
  }, [profile]);

  if (loading) {
    return <main className="public-container py-10 text-center text-sm font-bold text-[#02665e]">Loading operator profile...</main>;
  }

  if (error || !profile || !hasApprovedPackage) {
    return (
      <main className="public-container py-10">
        <div className="rounded-3xl border border-[#02665e]/20 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-700">{error || "Operator profile not found."}</p>
          <Link href="/public/tour-packages" className="mt-4 inline-flex rounded-full bg-[#02665e] px-5 py-2.5 text-sm font-bold text-white no-underline">
            Back to Tour Packages
          </Link>
        </div>
      </main>
    );
  }

  const companyName = String(profile.companyName || "Approved Tour Operator");
  const profileSlug = slugifyProfile(companyName);
  const operatorPublicKey = String(agent?.publicKey || "");

  return (
    <main className="min-h-screen bg-white">
      <section className="public-container py-8 sm:py-10">
        <Link
          href="/public/tour-packages"
          className="mb-6 inline-flex items-center justify-center rounded-full p-2 text-[#02665e] no-underline transition hover:bg-[#02665e]/10"
          aria-label="Back to tour packages"
          style={{ textDecoration: "none" }}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>

        {/* Hero title section */}
        <div className="mb-8 rounded-2xl bg-gradient-to-br from-[#02665e]/5 to-[#02665e]/10 px-6 py-8 text-center sm:px-10">
          <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-[#02665e] sm:text-3xl">
            All in One. No More Fragmentation.
          </h1>
          <p className="mb-6 text-sm text-slate-500 font-medium">
            Everything you need for your journey — now under one roof.
          </p>

          {/* Journey flow */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {/* Step 1 */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#02665e] text-white text-xl shadow-md">
                ✈️
              </div>
              <span className="text-xs font-semibold text-slate-700">Airport Pickup</span>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center pb-4">
              <span className="text-2xl font-bold text-[#02665e]">→</span>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#02665e] text-white text-xl shadow-md">
                🏨
              </div>
              <span className="text-xs font-semibold text-slate-700">Hotel / Lodge</span>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center pb-4">
              <span className="text-2xl font-bold text-[#02665e]">→</span>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#02665e] text-white text-xl shadow-md">
                🌍
              </div>
              <span className="text-xs font-semibold text-slate-700">Tour Site / Destination</span>
            </div>
          </div>

          <p className="mt-5 text-sm font-semibold text-[#02665e]">
            All belong to <span className="underline">your</span> decision.
          </p>
        </div>

        <SubmittedTourProfileCard
          profile={profile as Record<string, any>}
          reviewHref={`/public/tour-packages/operators/${operatorPublicKey}/submitted-profile/${profileSlug}`}
          reviewStatus="APPROVED"
          titleLabel="Submitted profile"
          showViewButton={false}
        />
      </section>
    </main>
  );
}
