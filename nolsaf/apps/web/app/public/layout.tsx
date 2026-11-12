"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { captureAgencyRefFromUrl } from "@/lib/agencyRef";
import { AnimatePresence, motion } from "framer-motion";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import FloatingChatWidget from "@/components/FloatingChatWidget";
import { CurrencyProvider } from "@/contexts/CurrencyContext";

export default function PublicLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Agency Desk booking links land on public pages with ?ag=...
  useEffect(() => {
    captureAgencyRefFromUrl();
  }, [pathname]);

  return (
    <CurrencyProvider>
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      <div className="relative min-h-screen" style={{ ['--footer-height' as any]: '0px' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            className="relative z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {children}
            <PublicFooter withRail={false} />
          </motion.div>
        </AnimatePresence>
      </div>

      <FloatingChatWidget position="bottom-right" mobileBottomOffset={56} />
    </div>
    </CurrencyProvider>
  );
}
