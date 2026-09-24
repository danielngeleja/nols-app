"use client";
import "@/styles/globals.css";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import LayoutFrame from "@/components/LayoutFrame";
import FloatingChatWidget from "@/components/FloatingChatWidget";
import AgentAccountSidebar from "@/components/AgentAccountSidebar";
import AgentWorkspaceHeader from "@/components/AgentWorkspaceHeader";
import AgentOperationalFooter from "@/components/AgentOperationalFooter";
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

  // The agent workspace is a fixed-height shell, like NRMS: the rail, header and
  // footer are flex siblings that never move, and only <main> scrolls. It cannot
  // use position:sticky inside the marketing layout because globals.css sets
  // `html, body { overflow-x: hidden }`, which makes the body a scroll container
  // and disables sticky for every descendant.
  if (isAgentPortalRoute) {
    return (
      <div className="flex h-dvh min-h-[36rem] w-full overflow-hidden bg-neutral-50">
        <div className="hidden shrink-0 py-3 pl-3 lg:block">
          <AgentAccountSidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-3 sm:px-4">
          <AgentWorkspaceHeader />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-20 md:pb-2">
            {children}
          </main>
          <AgentOperationalFooter />
        </div>

        <LegalModal />
        <MobileAgentNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <PublicHeader />

      <div className="w-full flex-1 overflow-x-hidden">
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
          <div className="pt-6 pb-6">
            <main className="w-full max-w-full overflow-x-hidden">{children}</main>
          </div>
        </div>
      </div>

      <div className="relative z-20">
        <PublicFooter withRail />
      </div>

      <FloatingChatWidget position="bottom-right" mobileBottomOffset={56} />
    </div>
  );
}
