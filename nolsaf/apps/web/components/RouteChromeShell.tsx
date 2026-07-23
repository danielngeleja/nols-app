"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { hidesPublicMobileNavigation } from "@/lib/publicMobileNavigation";

export default function RouteChromeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hidesPublicMobileNav = hidesPublicMobileNavigation(pathname);

  return (
    <div className={`min-h-screen bg-neutral-50 ${hidesPublicMobileNav ? "" : "pb-16 md:pb-0"}`}>
      {children}
    </div>
  );
}
