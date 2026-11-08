"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import SalesCardResult, { VerifyShell } from "@/components/verify/SalesCardResult";

export default function SalesCardVerifyPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  return (
    <VerifyShell footer={<>Have a card code instead? <Link href="/verify/sales" className="font-semibold text-[#02665e] no-underline">Type it here</Link></>}>
      <SalesCardResult endpoint={`/api/public/sales-cards/${encodeURIComponent(token)}`} />
    </VerifyShell>
  );
}
