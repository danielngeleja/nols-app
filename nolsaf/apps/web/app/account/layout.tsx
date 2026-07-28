"use client";
import "@/styles/globals.css";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import AgentFooter from "@/components/AgentFooter";
import LayoutFrame from "@/components/LayoutFrame";
import FloatingChatWidget from "@/components/FloatingChatWidget";
import AgentPortalHeader from "@/components/AgentPortalHeader";
import MobileAgentNav from "@/components/MobileAgentNav";

const LegalModal = dynamic(() => import("@/components/LegalModal"), { ssr: false });

export default function CustomerAccountLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const isAgentPortalRoute = pathname === "/account/agent" || pathname.startsWith("/account/agent/");

  // Auth pages should not inherit the public marketing header/footer.
  // Keep them isolated and minimal for security/clarity.
  const isAuthRoute =
    pathname === "/account/register" ||
    pathname === "/account/login" ||
    pathname === "/account/forgot-password" ||
    pathname === "/account/reset-password";

  if (isAuthRoute) {
    return <div className="min-h-screen bg-neutral-50">{children}</div>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {isAgentPortalRoute ? <AgentPortalHeader /> : <PublicHeader />}

      <div className="flex-1 w-full overflow-x-hidden">
        <div className="public-container relative">
          <LayoutFrame
            heightVariant="sm"
            topVariant="sm"
            colorVariant="muted"
            variant="solid"
            box
            boxRadiusClass="rounded-2xl"
            className="mb-2"
          />

          {/* Main content */}
          <div className={isAgentPortalRoute ? "pt-6 pb-20 md:pb-6" : "pt-6 pb-6"}>
            <main className="w-full max-w-full overflow-x-hidden">
              {children}
            </main>
          </div>
        </div>
      </div>

      <div className="relative z-20">
        {isAgentPortalRoute ? <AgentFooter withRail /> : <PublicFooter withRail />}
      </div>

      {isAgentPortalRoute ? <LegalModal /> : null}
      {isAgentPortalRoute && <MobileAgentNav />}
      {!isAgentPortalRoute && <FloatingChatWidget position="bottom-right" mobileBottomOffset={56} />}
    </div>
  );
}
