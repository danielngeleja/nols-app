"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import SalesCardResult, { VerifyShell } from "@/components/verify/SalesCardResult";

export default function SalesCardCodePage() {
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  return (
    <VerifyShell title="Verify a NoLSAF representative">
      <section className="rounded-lg border border-solid border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="m-0 text-[16px] font-bold text-slate-900">Type the card code</h1>
        <p className="m-0 mt-1 text-sm text-slate-600">It is printed at the bottom of their NoLSAF ID card. Or scan the QR code with your phone camera.</p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const clean = code.trim();
            if (clean) setSubmitted(clean);
          }}
        >
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="e.g. NSA-DAR-0001-C1-K7P2M9QX"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-11 min-w-0 flex-1 rounded-md border border-solid border-slate-300 bg-slate-50 px-3 font-mono text-sm text-slate-900 outline-none focus:border-[#02665e] focus:bg-white focus:ring-2 focus:ring-[#02665e]/15"
            aria-label="Card code"
          />
          <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white [font-family:inherit] hover:bg-[#014d47]">
            <Search className="h-4 w-4" /> Check
          </button>
        </form>
      </section>
      {submitted && (
        <div className="mt-4">
          <SalesCardResult key={submitted} endpoint={`/api/public/sales-cards/code/${encodeURIComponent(submitted)}`} />
        </div>
      )}
    </VerifyShell>
  );
}
