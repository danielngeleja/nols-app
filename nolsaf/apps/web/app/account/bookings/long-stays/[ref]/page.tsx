"use client";

import { useParams } from "next/navigation";
import TenancyDetail from "@/components/longStay/TenancyDetail";

export default function AccountLongStayPage() {
  const params = useParams<{ ref: string }>();
  return (
    <div className="w-full">
      <TenancyDetail side="TENANT" tenancyRef={String(params?.ref || "")} backHref="/account/bookings/long-stays" />
    </div>
  );
}
