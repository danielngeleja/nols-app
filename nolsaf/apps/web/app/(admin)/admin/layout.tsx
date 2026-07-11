"use client";
import "@/styles/globals.css";
import "@/styles/admin-soft-ui.css";
import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import SiteHeader from "@/components/SiteHeader";
import AdminNav from "@/components/AdminSidebar";
import LayoutFrame from "@/components/LayoutFrame";
import AdminNotificationListener from "@/components/AdminNotificationListener";
import AdminOperationalFooter from "@/components/AdminOperationalFooter";
import AdminNotificationDrawer from "@/components/AdminNotificationDrawer";
export default function AdminLayout({ children }: { children: ReactNode }) {
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

  return (
    <div className="admin-soft-ui min-h-screen flex flex-col bg-slate-50">
      <AdminNotificationListener />
      <AdminNotificationDrawer />
      {/* Full-width header */}
      <SiteHeader role="ADMIN" />

      {/* Mobile sidebar drawer */}
      <div className={`md:hidden fixed inset-0 z-[70] ${sidebarOpen ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!sidebarOpen}>
        <div
          className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${sidebarOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setSidebarOpen(false)}
        />
        <aside
          className={`absolute left-3 top-3 bottom-3 w-[18.5rem] max-w-[85vw] bg-gradient-to-b from-[#0b1220] via-[#0a1624] to-[#070f1a] border border-white/10 rounded-3xl overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.48),0_0_40px_rgba(2,102,94,0.18)] transition-transform duration-300 ease-out ${sidebarOpen ? "translate-x-0" : "-translate-x-[110%]"}`}
        >
          <div className="h-16 flex items-center px-4 border-b border-white/10">
            <div className="text-sm font-semibold text-slate-100">Admin</div>
          </div>
          <div className="p-4 overflow-y-auto h-[calc(100%-4rem)]">
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
            className={`absolute left-3 top-16 text-slate-100 border border-white/10 transition-all duration-300 ease-in-out hidden md:block ${sidebarOpen ? "w-56 p-4" : "w-20 p-2"} bg-gradient-to-b from-[#0b1220] via-[#0a1624] to-[#070f1a] h-[calc(100vh-4rem)] overflow-y-auto rounded-3xl overflow-hidden shadow-[0_18px_50px_rgba(0,0,0,0.30),0_0_46px_rgba(2,102,94,0.20)]`}
          >
            <div className="sidebar-scroll">
              <AdminNav variant="dark" collapsed={!sidebarOpen} />
            </div>
          </aside>

          {/* Main content: match Owner spacing and styling (no extra border/bg) */}
          <div className={`min-w-0 max-w-full overflow-x-hidden pt-16 pb-6 transition-all duration-300 ease-in-out ${sidebarOpen ? 'owner-content-gap' : 'md:ml-20'}`}>
            <div className="admin-workspace-surface relative flex h-[calc(100vh-4rem)] w-full min-w-0 max-w-full flex-col overflow-hidden">
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
