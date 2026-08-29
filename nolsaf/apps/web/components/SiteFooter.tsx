"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import FooterBridge from "@/components/FooterBridge";

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export default function SiteFooter({ withRail = true, topSeparator = true }: { withRail?: boolean; topSeparator?: boolean }) {
  const year = new Date().getFullYear();
  const innerRailClass = withRail ? 'md:ml-56' : '';
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<string | null>(null);

  // Set navigation context for policy pages and determine user role
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const role = getCookie('role');
      if (role) {
        setUserRole(role);
        sessionStorage.setItem('navigationContext', role.toLowerCase());
      } else {
        // Fallback to pathname
        if (pathname?.includes('/owner')) {
          setUserRole('OWNER');
          sessionStorage.setItem('navigationContext', 'owner');
        } else if (pathname?.includes('/driver')) {
          setUserRole('DRIVER');
          sessionStorage.setItem('navigationContext', 'driver');
        } else if (pathname?.includes('/admin')) {
          setUserRole('ADMIN');
          sessionStorage.setItem('navigationContext', 'admin');
        }
      }
    }
  }, [pathname]);

  return (
    <footer className="w-full mt-12 page-bottom-buffer bg-slate-50">
      <FooterBridge variant="plain" />
      {/* full-width separator line (brand color) - optional */}
      {topSeparator ? <div className="mx-auto h-px w-[min(74rem,calc(100%-2rem))] bg-slate-200" /> : null}
      <h2 className="sr-only">Footer</h2>

      <div className={`max-w-6xl mx-auto px-4 py-6 flex flex-col items-center gap-4 ${innerRailClass}`}>
        <div className="w-full">
          <div className="max-w-4xl mx-auto text-center">
            <h3 className="text-lg font-semibold text-gray-800">About NoLSAF</h3>
            <p className="mt-2 text-sm text-gray-600">Who we are and what we do and why You have to choose us.</p>
          </div>
        </div>
        <nav aria-label="Footer navigation" className="w-full flex justify-center">
          <ul className="flex flex-wrap items-center justify-center gap-6 text-sm">
            <li><a role="button" onClick={() => window.dispatchEvent(new CustomEvent('open-legal', { detail: { type: 'terms' } }))} className="text-[#02665e] font-semibold no-underline hover:no-underline">Terms of Service</a></li>
            <li><a role="button" onClick={() => window.dispatchEvent(new CustomEvent('open-legal', { detail: { type: 'privacy' } }))} className="text-[#02665e] font-semibold no-underline hover:no-underline">Privacy Policy</a></li>
            <li><Link href="/cookies-policy" className="text-[#02665e] font-semibold no-underline hover:no-underline">Cookies Policy</Link></li>
            <li><Link href="/verification-policy" className="text-[#02665e] font-semibold no-underline hover:no-underline">Verification Policy</Link></li>
            {/* The corporate identity page, distinct from the verification policy:
                this is where someone confirms NoLSAF itself is genuine. */}
            <li><Link href="/verify" className="text-[#02665e] font-semibold no-underline hover:no-underline">Verify NoLSAF</Link></li>
            <li><Link href="/cancellation-policy" className="text-[#02665e] font-semibold no-underline hover:no-underline">Cancellation Policy</Link></li>
            {userRole === 'DRIVER' ? (
              <li><Link href="/driver-disbursement-policy" className="text-[#02665e] font-semibold no-underline hover:no-underline">Disbursement Policy</Link></li>
            ) : userRole === 'OWNER' ? (
              <li><Link href="/property-owner-disbursement-policy" className="text-[#02665e] font-semibold no-underline hover:no-underline">Disbursement Policy</Link></li>
            ) : (
              <>
                <li><Link href="/driver-disbursement-policy" className="text-[#02665e] font-semibold no-underline hover:no-underline">Driver Disbursement Policy</Link></li>
                <li><Link href="/property-owner-disbursement-policy" className="text-[#02665e] font-semibold no-underline hover:no-underline">Property Owner Disbursement Policy</Link></li>
              </>
            )}
            <li><Link href="/docs" className="text-[#02665e] font-semibold no-underline hover:no-underline">Docs</Link></li>
            <li><Link href="/version" className="text-[#02665e] font-semibold no-underline hover:no-underline">v0.1.0</Link></li>
          </ul>
        </nav>

        {/* Centered logo and copyright below links */}
        <div className="w-full flex flex-col items-center gap-1 mt-1">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={120} height={30} className="object-contain" style={{ width: "auto", height: "auto" }} />
          <div className="text-sm text-[#02665e] font-semibold">&copy; {year} NoLSAF | All rights reserved</div>
        </div>
      </div>
    </footer>
  );
}
