"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";

export default function SalesAgreementInvitationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [fallbackPath, setFallbackPath] = useState("");

  useEffect(() => {
    const token = String(searchParams.get("t") || "").trim();
    if (!token) {
      setError("This agreement invitation is incomplete.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await apiClient.post("/api/sales/contracts/invitation/resolve", { token });
        if (!cancelled) router.replace(response.data?.entryPath || "/sales/contract");
      } catch (cause: any) {
        if (cancelled) return;
        setError(cause?.response?.data?.error || "This agreement invitation could not be opened.");
        setFallbackPath(cause?.response?.data?.entryPath || "");
      }
    })();
    return () => { cancelled = true; };
  }, [router, searchParams]);

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
          {error ? <ShieldCheck className="h-6 w-6" /> : <FileSignature className="h-6 w-6" />}
        </span>
        <h1 className="mb-0 mt-4 text-lg font-bold text-neutral-950">
          {error ? "Agreement invitation" : "Opening your agreement"}
        </h1>
        {error ? (
          <>
            <p className="mb-0 mt-2 text-sm leading-6 text-neutral-600">{error}</p>
            {fallbackPath ? (
              <button type="button" onClick={() => router.replace(fallbackPath)} className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800">
                <CheckCircle2 className="h-4 w-4" />Open my agreement
              </button>
            ) : (
              <button type="button" onClick={() => router.replace("/account")} className="mt-5 min-h-10 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50">
                Go to my account
              </button>
            )}
          </>
        ) : (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />Verifying the secure invitation…
          </div>
        )}
      </section>
    </main>
  );
}
