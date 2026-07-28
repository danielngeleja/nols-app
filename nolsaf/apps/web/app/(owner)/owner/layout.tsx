"use client";

// apps/web/app/(owner)/owner/layout.tsx
import "@/styles/globals.css";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import OwnerSiteHeader from "@/components/OwnerSiteHeader";
import OwnerFooter from "@/components/OwnerFooter";
import OwnerSidebar from "@/components/OwnerSidebar";
import LayoutFrame from "@/components/LayoutFrame";
import MobileOwnerNav from "@/components/MobileOwnerNav";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch unread notification count for bell badge
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch("/api/owner/notifications?tab=unread&page=1&pageSize=1", { credentials: "include" });
        if (!r.ok || !mounted) return;
        const j = await r.json();
        setUnreadCount(Number(j?.totalUnread ?? j?.total ?? 0));
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, []);
  // Listen for global toggle events dispatched from the header so the header
  // can control the sidebar without prop drilling. Use useEffect to ensure
  // listener is registered once and properly cleaned up.
  useEffect(() => {
    const handler = () => {
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      if (isDesktop) {
        setSidebarOpen((v) => !v);
      } else {
        setMobileSidebarOpen((v) => !v);
      }
    };

    window.addEventListener('toggle-owner-sidebar', handler as EventListener);
    return () => window.removeEventListener('toggle-owner-sidebar', handler as EventListener);
  }, []);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  // NRMS is a self-contained operational workspace. It owns its navigation and
  // deliberately hides the marketplace owner chrome until the user exits NRMS.
  if (pathname.startsWith("/owner/nrms")) {
    return <div className="min-h-screen min-w-0 bg-neutral-100">{children}</div>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <OwnerSiteHeader unreadMessages={unreadCount} />

      {/* Centered container so the LayoutFrame can span both sidebar and content */}
      <div className="flex-1 w-full overflow-x-hidden relative z-10">
        <div className="public-container w-full relative">
          <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" box />

          {/* Sidebar toggle controlled from SiteHeader (header-only menu icon). */}

          {/* Sidebar placed inside the centered container so it is considered part of the frame */}
          {/* Sidebar inside the frame container on md+; collapsed shows icons only */}
          <aside className={`hidden md:block absolute left-2 sm:left-3 md:left-4 top-16 transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-56' : 'w-16'} owner-sidebar-container rounded-2xl z-0 h-[calc(100vh-4rem)] overflow-hidden`}>
            <div className="sidebar-scroll h-full overflow-y-auto scroll-smooth pb-4">
              <div className={sidebarOpen ? 'p-2 pt-2' : 'p-1.5 pt-2'}>
                <OwnerSidebar collapsed={!sidebarOpen} />
              </div>
            </div>
          </aside>

          {/* Mobile off-canvas sidebar (same links, responsive presentation) */}
          {mobileSidebarOpen && (
            <div className="md:hidden fixed inset-0 z-40">
              <button
                type="button"
                aria-label="Close sidebar"
                className="absolute inset-0 bg-black/20 backdrop-blur-sm nols-soft-overlay"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <aside className="absolute left-0 top-16 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] w-[min(20rem,calc(100vw-1rem))] p-3 nols-soft-popover">
                <div
                  className="h-full overflow-y-auto scroll-smooth rounded-3xl pb-4"
                  onClickCapture={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest("a[href]")) {
                      setMobileSidebarOpen(false);
                    }
                  }}
                >
                  <OwnerSidebar collapsed={false} />
                </div>
              </aside>
            </div>
          )}

          {/* Main content: add left padding on md+ equal to sidebar width plus small gap so content clears it */}
          <div className={`pt-16 pb-24 md:pb-6 transition-all duration-300 ease-in-out box-border max-w-full overflow-x-hidden ${sidebarOpen ? 'owner-content-gap' : 'md:ml-16'} ${sidebarOpen ? 'md:border-l md:border-slate-200' : ''}`}>
            <main className="w-full max-w-full overflow-x-hidden">
              <div className="w-full">
                {children}
              </div>
            </main>
          </div>
        </div>
      </div>

      <div className="hidden md:block pb-20 md:pb-0">
        <OwnerFooter />
      </div>

      <MobileOwnerNav />
    </div>
  );
}
