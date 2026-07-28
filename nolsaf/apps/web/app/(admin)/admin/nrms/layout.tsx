"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";

export default function NrmsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showFinanceAccess = pathname === "/admin/nrms/health"
    || pathname === "/admin/nrms/billing"
    || pathname.includes("/pricing")
    || pathname.includes("/reconciliation")
    || pathname.includes("/support")
    || /^\/admin\/nrms\/\d+(\/|$)/.test(pathname);

  return (
    <>
      {showFinanceAccess ? <FinanceGrantPanel listenForRequired={false} /> : null}
      <div key={pathname} className="nols-entrance">
        {children}
      </div>
    </>
  );
}
