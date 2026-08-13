"use client";
import "@/styles/globals.css";
import "@/styles/admin-soft-ui.css";
import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import AdminSiteHeader from "@/components/AdminSiteHeader";
import AdminNav from "@/components/AdminSidebar";
import LayoutFrame from "@/components/LayoutFrame";
import AdminNotificationListener from "@/components/AdminNotificationListener";
import AdminReconcileAlertCard from "@/components/AdminReconcileAlertCard";
import AdminOperationalFooter from "@/components/AdminOperationalFooter";
import AdminNotificationDrawer from "@/components/AdminNotificationDrawer";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";
export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const mainRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);

  // Listen for global toggle events dispatched from the header to control sidebar
  useEffect(() => {
    const handler = () => setSidebarOpen((v) => !v);
    window.addEventListener("toggle-admin-sidebar", handler as EventListener);
    return () => window.removeEventListener("toggle-admin-sidebar", handler as EventListener);
  }, []);

  // One-way scroll sync: scrolling the main content should also scroll the sidebar.
  // Scrolling the sidebar should NOT affect the main content.
  useEffect(() => {
    const mainEl = mainRef.current;
    const sideEl = sidebarRef.current;
    if (!mainEl || !sideEl) return;

    const onMainScroll = () => {
      // Only sync when sidebar is visible on md+ screens
      const isVisible = sidebarOpen && window.matchMedia('(min-width: 768px)').matches;
      if (!isVisible) return;
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        sideEl.scrollTop = mainEl.scrollTop;
      } finally {
        syncingRef.current = false;
      }
    };

    mainEl.addEventListener('scroll', onMainScroll, { passive: true });
    return () => {
      mainEl.removeEventListener('scroll', onMainScroll as EventListener);
    };
  }, [sidebarOpen]);

  // Disbursements is a self-contained operational workspace (batch security
  // review, authorize, reconcile). It owns its own navigation and chrome —
  // same pattern as /owner/nrms — and deliberately hides the standard admin
  // sidebar/header until the user exits back to /admin/home.
  if (pathname.startsWith("/admin/disbursements")) {
    return <div className="min-h-screen min-w-0 bg-neutral-100">{children}</div>;
  }

  return (
    <div className="admin-soft-ui min-h-screen flex flex-col bg-neutral-100">
      <AdminNotificationListener />
      <AdminReconcileAlertCard />
      <AdminNotificationDrawer />
      {/* Full-width header. Fixed, and taller than the old bar because it carries
          an identity row plus a primary tab row (see AdminSiteHeader). The
          top-40 / pt-40 offsets below are measured against it. */}
      <AdminSiteHeader />
      {/* Keep the verification modal available globally without adding a banner to every admin page. */}
      <FinanceGrantPanel showTrigger={false} />

      {/* Mobile sidebar drawer */}
      <div className={`md:hidden fixed inset-0 z-[70] ${sidebarOpen ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!sidebarOpen}>
        <div
          className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${sidebarOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setSidebarOpen(false)}
        />
        <aside
          className={`absolute left-3 top-3 bottom-3 w-[18.5rem] max-w-[85vw] bg-[#082f2a] text-white border border-emerald-950/70 rounded-2xl overflow-hidden shadow-[0_14px_34px_rgba(8,47,42,0.18)] transition-transform duration-300 ease-out ${sidebarOpen ? "translate-x-0" : "-translate-x-[110%]"}`}
        >
          <div className="min-h-[5rem] flex items-center px-4 border-0 border-b border-solid border-white/10">
            <div className="text-base font-bold tracking-[-0.01em] text-white">Admin</div>
          </div>
          <div className="px-2.5 py-3 overflow-y-auto h-[calc(100%-5rem)]">
            <AdminNav variant="dark" collapsed={false} />
          </div>
        </aside>
      </div>

      {/* Centered container so LayoutFrame spans both sidebar and content (like Owner) */}
      <div className="flex-1 w-full overflow-hidden">
        <div className="public-container relative h-full">
          {/* Content frame/markers */}
          <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" box />

          {/* Sidebar inside the frame container on md+; collapsed shows icons only */}
          <aside
            ref={sidebarRef}
            className={`box-border absolute left-3 top-40 text-white border border-emerald-950/70 transition-all duration-300 ease-in-out hidden md:flex md:flex-col ${sidebarOpen ? "w-56 px-2.5 py-3" : "w-20 px-2 py-3"} bg-[#082f2a] h-[calc(100vh-10rem)] overflow-hidden rounded-2xl shadow-[0_14px_34px_rgba(8,47,42,0.18)]`}
          >
            <div className="flex min-h-0 flex-1 flex-col">
              <AdminNav variant="dark" collapsed={!sidebarOpen} />
            </div>
          </aside>

          {/* Main content: match Owner spacing and styling (no extra border/bg) */}
          <div className={`min-w-0 max-w-full overflow-x-hidden pt-40 transition-all duration-300 ease-in-out ${sidebarOpen ? 'owner-content-gap' : 'md:ml-20'}`}>
            <div className="admin-workspace-surface box-border relative flex h-[calc(100vh-10rem)] w-full min-w-0 max-w-full flex-col overflow-hidden">
              <div ref={mainRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <main className="min-w-0 overflow-x-hidden">
                  <div className="w-full min-w-0 overflow-x-hidden">
                    <div className="mx-auto w-full min-w-0 overflow-x-hidden">
                      {children}
                    </div>
                  </div>
                </main>
              </div>
              <AdminOperationalFooter />
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
