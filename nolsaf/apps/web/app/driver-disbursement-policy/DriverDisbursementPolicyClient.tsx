"use client";

import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import { DRIVER_DISBURSEMENT_POLICY_LAST_UPDATED, DRIVER_DISBURSEMENT_POLICY_SECTIONS } from "@/components/driverDisbursementPolicyContent";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import SiteHeader from "@/components/SiteHeader";
import OwnerSiteHeader from "@/components/OwnerSiteHeader";
import DriverSiteHeader from "@/components/DriverSiteHeader";
import SiteFooter from "@/components/SiteFooter";
import DriverFooter from "@/components/DriverFooter";
import LayoutFrame from "@/components/LayoutFrame";
import { DollarSign } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export default function DriverDisbursementPolicyPage() {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<"ADMIN" | "OWNER" | "DRIVER" | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublicContext, setIsPublicContext] = useState<boolean | null>(null);

  useEffect(() => {
    // PRIORITY 1: Check sessionStorage for navigation context (set by headers/footers)
    let navigationContext: 'public' | 'owner' | 'driver' | 'admin' | null = null;
    if (typeof window !== 'undefined') {
      navigationContext = sessionStorage.getItem('navigationContext') as 'public' | 'owner' | 'driver' | 'admin' | null;
    }

    if (navigationContext) {
      if (navigationContext === 'public') {
        setIsPublicContext(true);
        setUserRole(null);
        setIsLoading(false);
        return;
      } else {
        setIsPublicContext(false);
        setUserRole(navigationContext.toUpperCase() as "ADMIN" | "OWNER" | "DRIVER");
        setIsLoading(false);
        return;
      }
    }

    // PRIORITY 2: Check referrer
    let isFromPublicRoute = false;
    if (typeof document !== 'undefined') {
      const referrer = document.referrer;
      const origin = window.location.origin;
      isFromPublicRoute = !!referrer && (
        referrer.includes('/public') || 
        referrer === origin || 
        referrer === origin + '/' ||
        (!referrer.includes('/owner') && !referrer.includes('/driver') && !referrer.includes('/admin') && referrer.startsWith(origin))
      );
    }

    if (isFromPublicRoute) {
      setIsPublicContext(true);
      setUserRole(null);
      setIsLoading(false);
      return;
    }

    // PRIORITY 3: Check if user is authenticated via cookie
    const role = getCookie('role') as "ADMIN" | "OWNER" | "DRIVER" | null;
    if (role) {
      setIsPublicContext(false);
      setUserRole(role);
      setIsLoading(false);
      return;
    }
    
    // PRIORITY 4: Check pathname as final fallback
    if (pathname?.includes('/driver')) {
      setIsPublicContext(false);
      setUserRole('DRIVER');
    } else if (pathname?.includes('/owner')) {
      setIsPublicContext(false);
      setUserRole('OWNER');
    } else if (pathname?.includes('/admin')) {
      setIsPublicContext(false);
      setUserRole('ADMIN');
    } else {
      setIsPublicContext(true);
      setUserRole(null);
    }
    
    setIsLoading(false);
  }, [pathname]);

  const shouldUsePublicLayout = isPublicContext === true || (isPublicContext === null && userRole === null);
  const isAuthenticated = !shouldUsePublicLayout && userRole !== null;
  const isDriver = userRole === "DRIVER";
  const isOwner = userRole === "OWNER";
  const _isAdmin = userRole === "ADMIN";

  if (isLoading || isPublicContext === null) {
    return (
      <>
        <PublicHeader />
        <main className="min-h-screen bg-white text-slate-900">
          <div className="public-container py-10">
            <div className="text-center">Loading...</div>
          </div>
        </main>
        <PublicFooter withRail={false} />
      </>
    );
  }

  return (
    <>
      {shouldUsePublicLayout ? (
        <PublicHeader />
      ) : isAuthenticated ? (
        isDriver ? (
          <DriverSiteHeader />
        ) : isOwner ? (
          <OwnerSiteHeader />
        ) : (
          <SiteHeader role="ADMIN" />
        )
      ) : (
        <PublicHeader />
      )}
      
      <main className="min-h-screen bg-white text-slate-900">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />
        
        <PolicyDocumentHeader title="Driver Disbursement Policy" Icon={DollarSign} />
        
        <section className="relative bg-[#f7f9fb] pt-6 sm:pt-8 md:pt-10 pb-4 sm:pb-6 md:pb-10 overflow-x-hidden">
          <div className="public-container">
            <div className="w-full bg-white rounded-lg shadow-sm border border-gray-100 p-4 sm:p-6 md:p-10 lg:p-12 box-border overflow-x-hidden">
              <Terms headline="" lastUpdated={DRIVER_DISBURSEMENT_POLICY_LAST_UPDATED} sections={DRIVER_DISBURSEMENT_POLICY_SECTIONS} />
            </div>
          </div>
        </section>
      </main>
      
      {shouldUsePublicLayout ? (
        <PublicFooter withRail={false} />
      ) : isDriver ? (
        <DriverFooter />
      ) : isAuthenticated ? (
        <SiteFooter withRail={false} topSeparator={true} />
      ) : (
        <PublicFooter withRail={false} />
      )}
    </>
  );
}
