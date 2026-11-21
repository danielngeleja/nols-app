"use client";

import { useParams } from "next/navigation";
import TenancyDetail from "@/components/longStay/TenancyDetail";

export default function AccountLongStayPage() {
  const params = useParams<{ ref: string }>();
  return (
    <div className="w-full py-6 sm:py-8">
      <TenancyDetail side="TENANT" tenancyRef={String(params?.ref || "")} backHref="/account/long-stays" />
    </div>
  );
}
