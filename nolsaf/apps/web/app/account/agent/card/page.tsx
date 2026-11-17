"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, ExternalLink, Info, PenLine } from "lucide-react";
import apiClient from "@/lib/apiClient";
import LogoSpinner from "@/components/LogoSpinner";
import PublicTourOperatorCard, {
  type PublicTourOperatorProfile,
  type PublicTourPackageItem,
} from "@/components/PublicTourOperatorCard";
import { slugifyProfile } from "@/lib/profileSlug";

const api = apiClient;

// Same rule the public listing uses to decide which packages are on sale.
const LIVE_PACKAGE_STATUSES = ["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"];
const isLivePackage = (pkg: PublicTourPackageItem) => LIVE_PACKAGE_STATUSES.includes(String(pkg.status || "APPROVED").toUpperCase());

type CardState =
  | { kind: "live"; agentId: number; publicKey: string; profile: PublicTourOperatorProfile; packages: PublicTourPackageItem[]; pendingChanges: boolean }
  | { kind: "no-packages"; agentId: number; publicKey: string; profile: PublicTourOperatorProfile }
  | { kind: "not-approved"; agentId: number; profile: PublicTourOperatorProfile; packages: PublicTourPackageItem[] };

/**
 * The operator's card exactly as travellers see it on the tour packages page:
 * the same component, fed from the same public, approved profile. Only when
 * nothing is approved yet does it fall back to a labelled draft.
 */
export default function OperatorCardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<CardState | null>(null);
  const [commission, setCommission] = useState<number>(15);

  const load = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const meRes = await api.get("/api/agent/me", { params: { _t: Date.now() } });
      const agent = (meRes as any)?.data?.agent ?? null;
      const agentId = Number(agent?.id || 0);
      const publicKey = String(agent?.publicKey || "");
      const own = (agent?.operatorProfile ?? {}) as Record<string, any>;
      const reviewStatus = String(own.reviewStatus || own.review?.status || "").toUpperCase();

      try {
        const s = await fetch("/api/public/support/system-settings", { cache: "no-store" });
        if (s.ok) {
          const data = await s.json();
          const pct = Number(data?.agentCommissionPercent ?? data?.commissionPercent ?? 15);
          if (Number.isFinite(pct)) setCommission(pct);
        }
      } catch {
        // Keep the default.
      }

      // The public, approved version: what the marketplace actually shows.
      let publicProfile: PublicTourOperatorProfile | null = null;
      if (/^[a-z0-9]{20,40}$/.test(publicKey)) {
        try {
          const pubRes = await api.get(`/api/public/agents/${encodeURIComponent(publicKey)}`, { params: { _t: Date.now() } });
          publicProfile = ((pubRes as any)?.data?.profile ?? null) as PublicTourOperatorProfile | null;
        } catch {
          publicProfile = null;
        }
      }

      if (publicProfile) {
        const packages = (publicProfile.packageItems || []).filter(isLivePackage);
        setState(
          packages.length
            ? { kind: "live", agentId, publicKey, profile: publicProfile, packages, pendingChanges: reviewStatus !== "" && reviewStatus !== "APPROVED" }
            : { kind: "no-packages", agentId, publicKey, profile: publicProfile }
        );
      } else {
        const draftPackages = (Array.isArray(own.packageItems) ? own.packageItems : []) as PublicTourPackageItem[];
        setState({ kind: "not-approved", agentId, profile: own as PublicTourOperatorProfile, packages: draftPackages });
      }
      setError(null);
    } catch {
      if (!isBackground) setError("Your card could not be loaded.");
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Refresh when the operator comes back from the editor.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LogoSpinner size="lg" />
      </div>
    );
  }

  const publicHref =
    state && state.kind !== "not-approved"
      ? `/public/tour-packages/operators/${state.publicKey}/${slugifyProfile(state.profile.companyName || "Approved Tour Operator")}`
      : null;

  const status =
    state?.kind === "live"
      ? {
          tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
          icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
          label: "Live on NoLSAF",
          text: `This is your card on the tour packages page, with ${state.packages.length} tour${state.packages.length === 1 ? "" : "s"} on sale. Prices include the ${
            Number.isFinite(Number(state.profile.commissionPercent)) && state.profile.commissionPercent !== "" && state.profile.commissionPercent != null
              ? Number(state.profile.commissionPercent)
              : commission
          }% NoLSAF commission travellers pay on top of your price.`,
        }
      : state?.kind === "no-packages"
        ? {
            tone: "border-amber-200 bg-amber-50 text-amber-900",
            icon: <Info className="h-4 w-4" aria-hidden />,
            label: "Approved, not listed yet",
            text: "Your profile is approved, but the marketplace only lists operators with at least one approved package. Add a package and submit it for review.",
          }
        : {
            tone: "border-neutral-200 bg-neutral-50 text-neutral-700",
            icon: <Clock3 className="h-4 w-4" aria-hidden />,
            label: "Draft preview",
            text: "Your profile is not approved yet, so travellers cannot see this card. This draft uses your saved profile; the live card will match it once NoLSAF approves it.",
          };

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="sticky top-0 z-20 border-0 border-b border-solid border-neutral-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link
            href="/account/agent"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 no-underline transition hover:bg-neutral-100 hover:text-[#02665e]"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="m-0 text-[15px] font-semibold text-neutral-900">Your operator card</h1>
            <p className="m-0 text-[12.5px] text-neutral-500">How travellers see you on the tour packages page</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        {error || !state ? (
          <div className="max-w-md rounded-lg border border-solid border-neutral-200 bg-white p-5">
            <p className="m-0 text-sm font-semibold text-rose-700">{error || "Your card could not be loaded."}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 cursor-pointer rounded-md border border-solid border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[18.5rem_minmax(0,24rem)] md:items-start">
            {/* The card at the width it has in the public grid (about 18rem), never squeezed. */}
            <div className="mx-auto w-full max-w-[18.5rem] md:mx-0">
              <div className={state.kind === "not-approved" ? "opacity-95" : ""}>
                <PublicTourOperatorCard
                  agentId={state.agentId}
                  agentPublicKey={state.kind === "not-approved" ? "" : state.publicKey}
                  profile={state.profile}
                  packages={state.kind === "live" ? state.packages : state.kind === "not-approved" ? state.packages : []}
                  commissionPercent={commission}
                />
              </div>
            </div>

            <aside className="space-y-3">
              <div className={`rounded-lg border border-solid px-4 py-3.5 ${status.tone}`}>
                <p className="m-0 flex items-center gap-1.5 text-[13.5px] font-semibold">
                  {status.icon}
                  {status.label}
                </p>
                <p className="m-0 mt-1.5 text-[12.5px] leading-5">{status.text}</p>
              </div>

              {state.kind === "live" && state.pendingChanges ? (
                <div className="rounded-lg border border-solid border-sky-200 bg-sky-50 px-4 py-3 text-[12.5px] leading-5 text-sky-900">
                  You have changes waiting for review. Travellers keep seeing the approved card above until NoLSAF approves them.
                </div>
              ) : null}

              <div className="rounded-lg border border-solid border-neutral-200 bg-white p-4">
                <p className="m-0 text-[13px] font-semibold text-neutral-900">What the card shows</p>
                <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[12.5px] leading-5 text-neutral-600">
                  <li>Your first attraction photo, or a gallery or vehicle photo if you have none.</li>
                  <li>Your operating regions, the shortest tour length and your lowest price.</li>
                  <li>Your rating, once travellers have rated completed trips.</li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {publicHref ? (
                    <Link
                      href={publicHref}
                      target="_blank"
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#02665e] px-3 text-[13px] font-semibold text-white no-underline transition hover:bg-[#014e47]"
                    >
                      Open public page
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  ) : null}
                  <Link
                    href="/account/agent/profile"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-neutral-300 bg-white px-3 text-[13px] font-medium text-neutral-800 no-underline transition hover:bg-neutral-50"
                  >
                    <PenLine className="h-3.5 w-3.5" aria-hidden />
                    Edit profile
                  </Link>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
