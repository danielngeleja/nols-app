"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import SalesCardResult, { VerifyShell } from "@/components/verify/SalesCardResult";

export default function SalesCardVerifyPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  return (
    <VerifyShell>
      <SalesCardResult endpoint={`/api/public/sales-cards/${encodeURIComponent(token)}`} />
      <p className="m-0 mt-4 text-center text-[13px] text-slate-500">
        Have a card code instead? <Link href="/verify/sales" className="font-semibold text-[#02665e] no-underline">Type it here</Link>
      </p>
    </VerifyShell>
  );
}
