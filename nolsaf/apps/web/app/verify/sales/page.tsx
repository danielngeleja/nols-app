"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import SalesCardResult, { VerifyShell } from "@/components/verify/SalesCardResult";

export default function SalesCardCodePage() {
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  return (
    <VerifyShell>
      <section className="rounded-xl border border-solid border-slate-200 bg-white p-5">
        <h1 className="m-0 text-xl font-bold text-slate-900">Verify a NoLSAF representative</h1>
        <p className="m-0 mt-1 text-sm text-slate-600">Type the card code printed at the bottom of their NoLSAF ID card, or scan the QR code with your camera.</p>
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
            className="h-11 min-w-0 flex-1 rounded-lg border border-solid border-slate-300 px-3 font-mono text-sm text-slate-900 outline-none focus:border-[#02665e]"
            aria-label="Card code"
          />
          <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white [font-family:inherit]">
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
