"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, BedDouble, CheckCircle2, Loader2, ShieldCheck, User } from "lucide-react";
import apiClient from "@/lib/apiClient";

type ConfirmedMembership = {
  id: number;
  role: string;
  status: string;
  property: { id: number; title: string };
  outlet: { id: number; name: string; type: string } | null;
};

const ROLE_LABELS: Record<string, string> = {
  MANAGER: "NRMS manager",
  FRONT_DESK: "Front desk",
  RESTAURANT: "Restaurant staff",
  BAR: "Bar staff",
  OUTLET_SUPERVISOR: "Outlet supervisor",
};

function ConfirmContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [state, setState] = useState<"confirming" | "confirmed" | "error">("confirming");
  const [message, setMessage] = useState<string | null>(null);
  const [membership, setMembership] = useState<ConfirmedMembership | null>(null);
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    if (!token) {
      setState("error");
      setMessage("This confirmation link is missing its token. Open the link from your invitation email again.");
      return;
    }
    (async () => {
      try {
        const response = await apiClient.post("/api/nrms/operations/staff/confirm", { token });
        setMembership(response.data?.membership ?? null);
        setState("confirmed");
      } catch (cause: any) {
        setState("error");
        setMessage(cause?.response?.data?.error || "We could not confirm this assignment. Please try again.");
      }
    })();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-neutral-100 bg-[#082f2a] px-6 py-5 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400 text-emerald-950"><BedDouble className="h-5 w-5" /></span>
          <div>
            <p className="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300">NoLSAF</p>
            <h1 className="m-0 text-base font-bold">Staff assignment</h1>
          </div>
        </div>

        <div className="p-6">
          {state === "confirming" && (
            <div className="flex flex-col items-center gap-3 py-8 text-neutral-500">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="m-0 text-sm">Confirming your assignment...</p>
            </div>
          )}

          {state === "confirmed" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <p className="m-0 text-sm font-bold text-emerald-900">Assignment confirmed</p>
                  <p className="mb-0 mt-0.5 text-xs text-emerald-800">Your access is now active.</p>
                </div>
              </div>

              {membership && (
                <div className="rounded-2xl border border-neutral-200">
                  <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5"><span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Property</span><span className="text-xs font-bold text-neutral-900">{membership.property.title}</span></div>
                  <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5"><span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Role</span><span className="text-xs font-bold text-neutral-900">{ROLE_LABELS[membership.role] ?? membership.role}</span></div>
                  <div className="flex items-center justify-between px-4 py-2.5"><span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Work area</span><span className="text-xs font-bold text-neutral-900">{membership.outlet?.name ?? "All property"}</span></div>
                </div>
              )}

              <div className="grid gap-2">
                <Link href="/owner/nrms/orders" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#073c35] px-4 text-sm font-bold text-white no-underline transition hover:bg-emerald-800 hover:no-underline">
                  <ShieldCheck className="h-4 w-4" /> Open my workspace
                </Link>
                <Link href="/account" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 no-underline transition hover:bg-neutral-50 hover:no-underline">
                  <User className="h-4 w-4" /> Continue to my account
                </Link>
              </div>
            </div>
          )}

          {state === "error" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div>
                  <p className="m-0 text-sm font-bold text-red-800">Confirmation failed</p>
                  <p className="mb-0 mt-0.5 text-xs text-red-700">{message}</p>
                </div>
              </div>
              <Link href="/account" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 no-underline transition hover:bg-neutral-50 hover:no-underline">
                <User className="h-4 w-4" /> Go to my account
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NrmsStaffConfirmPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <ConfirmContent />
    </Suspense>
  );
}
