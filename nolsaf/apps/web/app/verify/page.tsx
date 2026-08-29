"use client";

/**
 * /verify serves two audiences and must never break the first.
 *
 * - With `?t=` or `?token=`: the signed report verification experience. QR
 *   codes carrying these links are already printed on issued documents, so this
 *   path stays supported until those documents have aged out.
 * - With no token: the corporate Trust and Verification page.
 *
 * The report UI now lives in a component shared with /verify/report, which is
 * the preferred URL for newly generated report links.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import ReportVerificationView from "@/components/verify/ReportVerificationView";
import CorporateVerificationView from "@/components/verify/CorporateVerificationView";

export default function VerifyPage() {
  // Resolved on the client because the decision depends on the query string,
  // and rendering the wrong one first would flash the corporate page at someone
  // opening a document link.
  const [mode, setMode] = useState<"pending" | "report" | "corporate">("pending");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasToken = Boolean((params.get("t") || params.get("token") || "").trim());
    setMode(hasToken ? "report" : "corporate");
  }, []);

  if (mode === "pending") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="h-6 w-6 animate-spin text-[#02665e]" />
      </main>
    );
  }

  return mode === "report" ? <ReportVerificationView /> : <CorporateVerificationView />;
}
