"use client";

import { useParams } from "next/navigation";
import TenancyDetail from "@/components/longStay/TenancyDetail";

export default function OwnerLongStayPage() {
  const params = useParams<{ ref: string }>();
  return <TenancyDetail side="LANDLORD" tenancyRef={String(params?.ref || "")} backHref="/owner/long-stays" />;
}
