"use client";

import "@/styles/globals.css";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import OwnerSiteHeader from "@/components/OwnerSiteHeader";
import OwnerFooter from "@/components/OwnerFooter";
import OwnerSidebar from "@/components/OwnerSidebar";
import MobileOwnerNav from "@/components/MobileOwnerNav";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await fetch("/api/owner/notifications?tab=unread&page=1&pageSize=1", {
          credentials: "include",
        });
        if (!response.ok || !mounted) return;
        const payload = await response.json();
        setUnreadCount(Number(payload?.totalUnread ?? payload?.total ?? 0));
      } catch {
        // Notification count is non-critical layout data.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      if (window.matchMedia("(min-width: 768px)").matches) {
        setSidebarOpen((current) => !current);
      } else {
        setMobileSidebarOpen((current) => !current);
      }
    };
    window.addEventListener("toggle-owner-sidebar", handler as EventListener);
    return () => window.removeEventListener("toggle-owner-sidebar", handler as EventListener);
  }, []);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  // NRMS remains a self-contained operational workspace with its own shell.
  if (pathname.startsWith("/owner/nrms")) {
    return <div className="min-h-screen min-w-0 bg-neutral-100">{children}</div>;
  }

  return (
    <div className="owner-workspace flex h-dvh min-h-[36rem] min-w-0 flex-col overflow-hidden bg-neutral-100">
      <OwnerSiteHeader unreadMessages={unreadCount} />

      <div className="flex min-h-0 flex-1 overflow-hidden pt-16">
        <div
          className={`hidden shrink-0 p-3 pr-0 transition-[width] duration-300 ease-in-out md:block ${
            sidebarOpen ? "w-[15rem]" : "w-[4.75rem]"
          }`}
        >
          <aside className="owner-sidebar-container h-full min-h-0" aria-label="Owner workspace navigation">
            <OwnerSidebar collapsed={!sidebarOpen} />
          </aside>
        </div>

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close sidebar"
              className="absolute inset-0 border-0 bg-black/35 backdrop-blur-sm nols-soft-overlay"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="absolute bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-0 top-16 w-[min(18rem,calc(100vw-1rem))] p-3 nols-soft-popover">
              <div
                className="h-full min-h-0"
                onClickCapture={(event) => {
                  const target = event.target as HTMLElement | null;
                  if (target?.closest("a[href]")) setMobileSidebarOpen(false);
                }}
              >
                <OwnerSidebar collapsed={false} />
              </div>
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-24 pt-3 sm:px-3 md:pb-3">
            <div className="w-full min-w-0 max-w-none">{children}</div>
          </main>

          <div className="hidden shrink-0 md:block">
            <OwnerFooter />
          </div>
        </div>
      </div>

      <MobileOwnerNav />
    </div>
  );
}
