"use client";

// The old operator overview ("All in One" banner + submitted profile card) is
// retired. This address now only forwards to the live operator page, where
// travellers see the packages and can book. Kept so shared links and the
// certificate's "View on NoLSAF" button keep working.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import LogoSpinner from "@/components/LogoSpinner";
import { slugifyProfile } from "@/lib/profileSlug";

export default function PublicTourOperatorRedirect() {
  const router = useRouter();
  const routeParams = useParams<{ id: string }>();
  const routeId = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const publicKey = String(routeId || "").trim().toLowerCase();
    if (!/^[a-z0-9]{20,40}$/.test(publicKey)) {
      setFailed(true);
      return;
    }
    apiClient
      .get<{ profile?: { companyName?: string } | null }>(`/api/public/agents/${encodeURIComponent(publicKey)}`)
      .then((res) => {
        if (cancelled) return;
        const slug = slugifyProfile(String(res.data?.profile?.companyName || "tour-operator"));
        router.replace(`/public/tour-packages/operators/${publicKey}/${slug}`);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [routeId, router]);

  if (failed) {
    return (
      <main className="public-container py-10">
        <div className="rounded-lg border border-solid border-slate-200 bg-white p-8 text-center">
          <p className="m-0 text-sm font-semibold text-slate-700">This operator is not available right now.</p>
          <Link href="/public/tour-packages" className="mt-4 inline-flex rounded-md bg-[#02665e] px-5 py-2.5 text-sm font-semibold text-white no-underline">
            Back to tour packages
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LogoSpinner size="lg" />
    </div>
  );
}
