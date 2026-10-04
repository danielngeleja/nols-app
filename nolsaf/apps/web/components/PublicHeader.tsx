"use client";

import Link from "next/link";
import Image from "next/image";
import React, { useEffect, useState, useRef, useMemo } from "react";
import { BarChart3, Building2, Calculator, ChevronDown, ChevronRight, Compass, Home, MapPin, Menu, PlusSquare, Users, X } from 'lucide-react';
import { REGIONS } from '@/lib/tzRegions';
import UserMenu from '@/components/UserMenu';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';

import GlobalPicker from "@/components/GlobalPicker";
import { usePathname } from "next/navigation";
import { fetchAccountSession } from "@/lib/accountSession";

export default function PublicHeader({
  tools,
  compact = false,
}: {
  /** Optional right-side tools area (e.g. search, login, locale) */
  tools?: React.ReactNode;
  /** smaller height when embedded */
  compact?: boolean;
}) {
  const [authed, setAuthed] = React.useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [mobileRegionsOpen, setMobileRegionsOpen] = useState<boolean>(false);
  const [scrolled, setScrolled] = useState<boolean>(false);
  const [headerVisible, setHeaderVisible] = useState<boolean>(true);
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [scrollAmount, setScrollAmount] = useState<number>(0);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const headerRef = useRef<HTMLElement>(null);
  const phoneMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const pathname = usePathname();
  const [isOverHero, setIsOverHero] = useState<boolean>(false);
  const isPublicHome = pathname === "/public";

  // Auth state management
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchAccountSession();
        if (!alive) return;
        setAuthed(r.ok);
        return;
      } catch {
        // ignore
      }
      if (!alive) return;
      setAuthed(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Set navigation context for policy pages
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('navigationContext', 'public');
    }
  }, []);

  // Advanced scroll detection with smooth transitions and visual effects
  useEffect(() => {
    let ticking = false;
    let lastScrollTop = 0;
    let scrollTimeout: NodeJS.Timeout | null = null;
    let scrollStopTimeout: NodeJS.Timeout | null = null;
    let publicHideTimeout: NodeJS.Timeout | null = null;
    let lastPublicY = 0;
    let publicHidden = false;
    
    const handleScroll = () => {
      const isPublic = pathname?.startsWith("/public") ?? false;

      // Public pages: hide while scrolling, show again once scrolling stops.
      // This runs outside the rAF/ticking gate so it can't be skipped.
      if (isPublic) {
        const yNow = window.scrollY;
        const delta = Math.abs(yNow - lastPublicY);
        lastPublicY = yNow;

        // Cancel any delayed hide logic (only used on non-public routes).
        if (scrollTimeout) {
          clearTimeout(scrollTimeout);
          scrollTimeout = null;
        }

        if (publicHideTimeout) {
          clearTimeout(publicHideTimeout);
          publicHideTimeout = null;
        }

        // Near the top, always keep header visible.
        if (yNow <= 80) {
          publicHidden = false;
          setHeaderVisible(true);
          if (scrollStopTimeout) {
            clearTimeout(scrollStopTimeout);
            scrollStopTimeout = null;
          }
        } else {
          // Past the top: hide while actively scrolling, then show after a stop debounce.
          // Only trigger state changes on transitions to avoid flicker.
          if (delta > 0.5 && !publicHidden) {
            publicHidden = true;
            setHeaderVisible(false);
          }

          if (scrollStopTimeout) clearTimeout(scrollStopTimeout);
          const scheduledY = yNow;
          scrollStopTimeout = setTimeout(() => {
            // Show only if scroll position has stabilized.
            if (Math.abs(window.scrollY - scheduledY) < 2) {
              publicHidden = false;
              setHeaderVisible(true);
            }
          }, 260);
        }
      }

      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;
          const scrollDifference = currentScrollY - lastScrollTop;
          const scrollSpeed = Math.abs(scrollDifference);
          const isPublic = pathname?.startsWith("/public") ?? false;
          
          // Calculate scroll progress (0-1) for smooth transitions
          const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
          const progress = Math.min(currentScrollY / Math.max(maxScroll * 0.3, 100), 1);
          setScrollProgress(progress);
          setScrollAmount(currentScrollY);
          // Public home hero coupling: treat header as "over hero" until hero bottom is passed.
          let heroOverNow = false;
          try {
            if (pathname === "/public") {
              const hero = document.getElementById("public-hero");
              if (hero) {
                const rect = hero.getBoundingClientRect();
                // rect.bottom is relative to viewport; consider header "over hero" while hero still intersects the top region
                heroOverNow = rect.bottom > 72;
                setIsOverHero(heroOverNow);
              } else {
                setIsOverHero(false);
              }
            } else {
              setIsOverHero(false);
            }
          } catch {
            // ignore
          }
          
          // Always show header at the very top
          if (currentScrollY < 5) {
            setHeaderVisible(true);
            setScrolled(false);
          } else {
            // Determine scroll direction with better threshold
            if (!isPublic && scrollSpeed > 3) { // Lower threshold for more responsive feel
              if (scrollDifference > 0) {
                // Scrolling down
                // Hide header when scrolling down (with delay for smooth feel)
                if (currentScrollY > 80) {
                  // Clear any existing timeout
                  if (scrollTimeout) clearTimeout(scrollTimeout);
                  // Small delay before hiding for smoother UX
                  scrollTimeout = setTimeout(() => {
                    if (window.scrollY > 80) {
                      setHeaderVisible(false);
                    }
                  }, 150);
                }
              } else {
                // Scrolling up - show immediately
                if (scrollTimeout) clearTimeout(scrollTimeout);
                setHeaderVisible(true);
              }
            }
            
            // Update scrolled state for visual changes
            // On /public, keep header in "hero mode" (transparent/glass) while hero is visible,
            // then switch to the green glass header AFTER the hero ends.
            if (pathname === "/public" && heroOverNow) setScrolled(false);
            else setScrolled(currentScrollY > 15);
          }
          
          lastScrollTop = currentScrollY;
          ticking = false;
        });
        ticking = true;
      }
    };
    
    // Initial check
    handleScroll();
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) clearTimeout(scrollTimeout);
      if (scrollStopTimeout) clearTimeout(scrollStopTimeout);
      if (publicHideTimeout) clearTimeout(publicHideTimeout);
    };
  }, [pathname]);

  const heroBlend = pathname === "/public" && isOverHero ? Math.min(scrollAmount / 180, 1) : 1;
  const isPublicPath = pathname?.startsWith("/public") ?? false;
  // Detect non-public pages (like /account, /help, policy pages, etc.) that need strong visibility
  const isNonPublicPage = !isPublicPath && pathname !== "/public";
  // Account workspaces should keep the navigation in document flow. A fixed
  // marketing header can otherwise cover cancellation forms and case actions.
  const useFlowHeader = pathname?.startsWith("/account/") ?? false;

  // Header is always dark/glass — matches the premium hero background.
  // 'overHero'  = floating pill state (transparent dark glass, not scrolled yet)
  // 'scrolled'  = compact pill after user scrolls
  const overHero = isPublicPath && pathname === "/public" && isOverHero && !scrolled;
  const headerVariant: "light" | "dark" = "dark";

  const _navTextClass    = "text-white";
  const _navHoverBgClass = "hover:bg-white/12";
  const _navActiveBgClass = "bg-white/[0.14]";
  const _navDotBgClass   = "bg-emerald-400";

  // Nav pill: premium dark-glass matching hero outer surround palette
  const chromePillClass = overHero
    ? "bg-[rgba(5,14,35,0.52)] ring-1 ring-white/[0.16] shadow-[0_8px_32px_rgba(0,0,0,0.44)]"
    : scrolled
    ? "bg-[rgba(8,22,50,0.80)] ring-1 ring-[#02665e]/50 shadow-[0_4px_20px_rgba(0,0,0,0.32)]"
    : "bg-[rgba(11,31,92,0.88)] ring-1 ring-white/[0.14] shadow-[0_4px_16px_rgba(0,0,0,0.30)]";

  const useOwnerLikeMobileHeader = isMobile && isPublicPath;

  // Phones inside the account area get an app-style bar instead of the marketing header:
  // where you are and the tools, in the brand colours, without the marketing chrome.
  const mobileAccountBar = isMobile && (useFlowHeader || pathname === "/account");
  // Phones have no footer (the bottom nav covers navigation), so its essentials live in the menu.
  const footerEssentials = [
    { href: "/help", label: "Help Center" },
    { href: "/verify", label: "Verify NoLSAF" },
    { href: "/about/who", label: "About us" },
    { href: "/terms", label: "Terms" },
    { href: "/privacy", label: "Privacy" },
    { href: "/cancellation-policy", label: "Cancellation" },
  ];
  const menuIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    "/public": Home,
    "/public/properties": Building2,
    "/public/tour-packages": Compass,
    "/public/group-stays": Users,
    "/public/nolscope": Calculator,
    "/public/nrms": BarChart3,
  };

  // Logo handling:
  // - Always use the icon-only logo (no names), same as the footer.
  // - On dark/green header, adjust the icon so it's visible.
  const logoSrc = "/assets/NoLS2025-04.png";
  const logoDims = { width: 64, height: 64 };

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mobileMenuOpen && headerRef.current && !headerRef.current.contains(e.target as Node) && !phoneMenuRef.current?.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    if (mobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [mobileMenuOpen]);


  const phoneMenuSheet = isMobile && !mobileAccountBar && mobileMenuOpen;
  useEffect(() => {
    if (!phoneMenuSheet) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [phoneMenuSheet]);

  // Memoized navigation links for performance
  const navLinks = useMemo(() => [
    { href: '/public', label: 'Home' },
    { href: '/public/properties', label: 'Properties' },
    { href: '/public/tour-packages', label: 'Tour Packages' },
    { href: '/public/group-stays', label: 'Group Stays' },
    { href: '/public/nolscope', label: 'Cost Estimator' },
    { href: '/public/nrms', label: 'NRMS' },
  ], []);

  const NavLink = ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => {
    const isActive = pathname === href;
    return (
      <Link
        href={href}
        onClick={onClick}
        className={`relative text-white/90 font-medium no-underline rounded-full transition-all duration-300 ease-out hover:text-white hover:bg-white/12 hover:scale-105 active:scale-95 group ${
          isActive ? 'text-white bg-white/[0.14]' : ''
        }`}
        style={{
          fontSize: '13px',
          padding: scrolled ? '6px 12px' : '7px 13px',
          textShadow: '0 1px 3px rgba(0,0,0,0.35)',
          transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <span className="relative z-10">{children}</span>
        {isActive && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#2dd4bf] shadow-[0_0_8px_rgba(45,212,191,0.90)] transition-all duration-300" />
        )}
        {/* Hover fill */}
        <span className="absolute inset-0 rounded-full transition-all duration-300 transform scale-0 group-hover:scale-100 bg-white/10" />
      </Link>
    );
  };

  return (
    <>
      {mobileAccountBar ? (
        <header ref={headerRef} className="sticky top-0 z-50 box-border w-full max-w-full px-2 pt-2">
          <div
            className="relative overflow-hidden rounded-2xl text-white shadow-[0_12px_28px_-14px_rgba(1,40,36,0.85)] ring-1 ring-inset ring-white/10"
            style={{ background: "linear-gradient(135deg, #011a18 0%, #023a35 50%, #02665e 100%)" }}
          >
            {/* Same texture as the account hero: soft emerald light and a faint dot grid */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <div className="absolute inset-0" style={{ background: "radial-gradient(260px circle at 100% 0%, rgba(52,211,153,0.28), transparent 65%)" }} />
              <div
                className="absolute inset-0 opacity-[0.16]"
                style={{
                  backgroundImage: "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
                  backgroundSize: "16px 16px",
                  WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 70%)",
                  maskImage: "linear-gradient(90deg, transparent 0%, #000 70%)",
                }}
              />
            </div>

            <div className="relative flex h-14 items-center gap-3 px-3.5">
              <Link
                href="/"
                aria-label="NoLSAF home"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 no-underline ring-1 ring-inset ring-white/15"
              >
                <Image src={logoSrc} alt="" width={24} height={24} className="h-[22px] w-[22px] object-contain" style={{ filter: "brightness(0) invert(1)" }} />
              </Link>

              <div className="min-w-0 flex-1">
                <span className="text-[16px] font-bold tracking-tight text-white">NoLSAF</span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 ring-1 ring-inset ring-white/15">
                  <GlobalPicker variant="dark" />
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                  aria-expanded={mobileMenuOpen}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-0 ring-1 ring-inset transition active:scale-95 ${mobileMenuOpen ? "bg-white text-[#02665e] ring-white" : "bg-white/10 text-white ring-white/15"}`}
                >
                  {mobileMenuOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>
          </div>
          {/* Menu: a card that drops from the bar, grid of destinations first */}
          <div
            className={`absolute inset-x-2 top-full z-50 mt-2 origin-top overflow-hidden rounded-2xl border border-solid border-[#02665e]/15 bg-[#f3faf8] shadow-[0_24px_48px_-16px_rgba(2,40,36,0.45)] transition-all duration-200 ${
              mobileMenuOpen ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-[0.98] opacity-0"
            }`}
          >
            <nav className="grid grid-cols-3 gap-1.5 p-3" aria-label="Explore NoLSAF">
              {navLinks.map((link) => {
                const Icon = menuIcons[link.href] ?? Home;
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 text-center no-underline ring-1 ring-inset transition active:scale-95 ${active ? "bg-[#02665e] ring-[#02665e]" : "bg-white ring-[#02665e]/10 hover:ring-[#02665e]/25"}`}
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${active ? "bg-white/15 text-white" : "text-white"}`} style={active ? undefined : { background: "linear-gradient(135deg, #014e47, #02665e)" }}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className={`text-[11.5px] font-semibold leading-tight ${active ? "text-white" : "text-slate-700"}`}>{link.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="grid grid-cols-2 gap-x-1 border-0 border-t border-solid border-[#02665e]/10 px-2 py-1.5">
              {footerEssentials.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="truncate rounded-xl px-3 py-2 text-[12.5px] font-medium text-slate-500 no-underline transition-colors hover:bg-white hover:text-[#02665e]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="border-0 border-t border-solid border-[#02665e]/10 p-2">
              <button
                type="button"
                onClick={() => { setMobileMenuOpen(false); setMobileRegionsOpen(true); }}
                className="flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <MapPin className="h-4 w-4 text-[#02665e]" />
                <span className="flex-1">Browse by region</span>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </button>
              {authed ? (
                <WorkspaceSwitcher currentWorkspace="NORMAL" onSwitchStart={() => setMobileMenuOpen(false)} />
              ) : (
                <div className="mt-1 grid grid-cols-2 gap-2 px-1 pb-1">
                  <Link href="/account/login" onClick={() => setMobileMenuOpen(false)} className="inline-flex h-10 items-center justify-center rounded-xl border border-solid border-slate-200 bg-white text-[13.5px] font-semibold text-slate-800 no-underline">Sign in</Link>
                  <Link href="/account/register" onClick={() => setMobileMenuOpen(false)} className="inline-flex h-10 items-center justify-center rounded-xl bg-[#02665e] text-[13.5px] font-semibold text-white no-underline">Register</Link>
                </div>
              )}
            </div>
          </div>
        </header>
      ) : (
      <header 
        ref={headerRef}
        className={`${useFlowHeader ? "sticky top-0" : "fixed"} z-50 text-white ${
          (isMobile || headerVisible)
            ? 'translate-y-0 opacity-100' 
            : '-translate-y-full opacity-0 pointer-events-none'
        } w-full`}
        style={{
          top: 0,
          left: 0,
          right: 0,
          transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.4s ease-out',
          willChange: 'transform, opacity',
        }}
      >
        <div className="public-container">
          <div
            className={`relative ${compact ? 'h-14' : scrolled ? 'h-16' : 'h-14'}`}
            style={{
              // On /public, the header overlays the hero. Keep a small inset from the top
              // so the header + hero read as a single, intentional composition.
              marginTop: isMobile
                ? (useOwnerLikeMobileHeader ? '8px' : '0')
                : (isPublicHome ? 'clamp(10px, 1.5vw, 14px)' : (scrolled ? '10px' : '0')),
              borderRadius: isMobile
                ? (useOwnerLikeMobileHeader ? '30px' : '0 0 10px 10px')
                : (compact ? '20px' : (isPublicHome && !scrolled ? '28px' : '24px')),
              width: isMobile && useOwnerLikeMobileHeader ? 'calc(100% - 12px)' : '100%',
              // Always constrain width so logo and icons never get clipped to screen edges.
              maxWidth: isMobile ? '100%' : ((overHero || scrolled) ? '1200px' : '100%'),
              marginLeft: isMobile ? (useOwnerLikeMobileHeader ? 'auto' : 0) : ((overHero || scrolled) ? 'auto' : undefined),
              marginRight: isMobile ? (useOwnerLikeMobileHeader ? 'auto' : 0) : ((overHero || scrolled) ? 'auto' : undefined),
              // Naspers-style coupling: transparent over hero, then smoothly fills into our brand glass header.
              // Non-public pages get full opacity for maximum visibility
              // Dark premium glass — matches the hero card background (#05080f) with a subtle emerald tint.
              background: useOwnerLikeMobileHeader
                ? 'linear-gradient(135deg, rgba(2,91,83,0.96) 0%, rgba(2,102,94,0.98) 55%, rgba(3,120,103,0.96) 100%)'
                : overHero
                ? `linear-gradient(135deg, rgba(8,18,50,${0.62 + heroBlend * 0.14}) 0%, rgba(10,50,100,${0.44 + heroBlend * 0.12}) 55%, rgba(2,102,94,${0.12 + heroBlend * 0.10}) 100%)`
                : scrolled
                ? `linear-gradient(135deg, rgba(8,18,50,${0.90 + scrollProgress * 0.06}) 0%, rgba(10,92,130,${0.60 + scrollProgress * 0.14}) 55%, rgba(2,102,94,${0.50 + scrollProgress * 0.18}) 100%)`
                : isNonPublicPage
                ? `linear-gradient(135deg, #0b1f5c 0%, #0a5c82 52%, #02665e 100%)`
                : `linear-gradient(135deg, rgba(11,31,92,${pathname === "/public" ? (0.18 + heroBlend * 0.60) : 0.92}) 0%, rgba(10,92,130,${pathname === "/public" ? (0.10 + heroBlend * 0.48) : 0.80}) 55%, rgba(2,102,94,${pathname === "/public" ? (0.08 + heroBlend * 0.38) : 0.72}) 100%)`,

              backdropFilter: useOwnerLikeMobileHeader
                ? 'blur(20px) saturate(180%)'
                : overHero
                ? `blur(${18 + heroBlend * 8}px) saturate(180%)`
                : isNonPublicPage
                ? `blur(16px) saturate(180%)`
                : scrolled
                ? `blur(${16 + scrollProgress * 6}px) saturate(${160 + scrollProgress * 20}%)`
                : `blur(${6 + heroBlend * 10}px) saturate(${120 + heroBlend * 40}%)`,
              WebkitBackdropFilter: useOwnerLikeMobileHeader
                ? 'blur(20px) saturate(180%)'
                : overHero
                ? `blur(${18 + heroBlend * 8}px) saturate(180%)`
                : isNonPublicPage
                ? `blur(16px) saturate(180%)`
                : scrolled
                ? `blur(${16 + scrollProgress * 6}px) saturate(${160 + scrollProgress * 20}%)`
                : `blur(${6 + heroBlend * 10}px) saturate(${120 + heroBlend * 40}%)`,
              boxShadow: useOwnerLikeMobileHeader
                ? '0 18px 52px rgba(0,0,0,0.30), 0 0 0 1px rgba(255,255,255,0.10), inset 0 1px 0 rgba(255,255,255,0.10), 0 0 40px rgba(2,102,94,0.16)'
                : overHero
                ? `0 8px 32px rgba(2,102,94,0.18), inset 0 1px 0 rgba(255,255,255,0.10), inset 0 0 0 1px rgba(255,255,255,0.06)`
                : scrolled
                ? `0 12px 36px rgba(8,18,50,0.48), 0 0 0 1px rgba(2,102,94,0.30), inset 0 1px 0 rgba(255,255,255,0.10)`
                : isNonPublicPage
                ? `0 4px 20px rgba(2,102,94,0.28), 0 0 0 1px rgba(255,255,255,0.10)`
                : pathname === "/public" && heroBlend > 0.2
                ? `0 10px 32px rgba(8,18,50,0.32), 0 0 0 1px rgba(2,102,94,0.18)`
                : 'none',
              border: useOwnerLikeMobileHeader
                ? '1px solid rgba(255,255,255,0.12)'
                : overHero
                ? "none"
                : scrolled
                ? '1px solid rgba(255,255,255,0.11)'
                : isNonPublicPage
                ? '1px solid rgba(255,255,255,0.14)'
                : pathname === "/public" && heroBlend > 0.25
                ? '1px solid rgba(255,255,255,0.07)'
                : 'none',
              transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              willChange: 'border-radius, background, backdrop-filter, box-shadow',
            }}
          >
            {useOwnerLikeMobileHeader && (
              <>
                <div
                  className="pointer-events-none absolute inset-0"
                  aria-hidden
                  style={{
                    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                    opacity: 0.26,
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-y-0 left-[22%] w-28"
                  aria-hidden
                  style={{
                    background: 'radial-gradient(circle at 50% 50%, rgba(56,189,248,0.15) 0%, transparent 72%)',
                    filter: 'blur(18px)',
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 w-36"
                  aria-hidden
                  style={{
                    background: 'radial-gradient(circle at 40% 50%, rgba(45,212,191,0.18) 0%, transparent 74%)',
                    filter: 'blur(18px)',
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-x-6 top-0 h-px"
                  aria-hidden
                  style={{
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.14) 24%, rgba(255,255,255,0.38) 50%, rgba(255,255,255,0.14) 76%, transparent 100%)',
                  }}
                />
                <div
                  className="pointer-events-none absolute left-12 top-0 bottom-0 w-px"
                  aria-hidden
                  style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(45,212,191,0.18) 36%, rgba(255,255,255,0.04) 100%)',
                    opacity: 0.55,
                  }}
                />
              </>
            )}

            {/* Scroll Progress Indicator */}
            {scrolled && scrollProgress > 0 && (
              <div
                className="absolute bottom-0 left-0 h-[2px] transition-all duration-300"
                style={{
                  width: `${scrollProgress * 100}%`,
                  background: `linear-gradient(90deg, transparent 0%, rgba(52,211,153,0.6) 20%, rgba(56,189,248,0.8) 60%, rgba(52,211,153,0.6) 80%, transparent 100%)`,
                  borderRadius: '0 0 24px 24px',
                }}
              />
            )}

            <div 
              className={`flex items-center justify-between px-4 sm:px-5 ${
                compact ? 'h-14' : scrolled ? 'h-16' : 'h-14'
              }`}
              style={{
                textShadow: scrolled
                  ? `0 2px 4px rgba(0,0,0,${0.4 + scrollProgress * 0.2}), 0 0 12px rgba(0,0,0,${0.25 + scrollProgress * 0.15})`
                  : '0 1px 2px rgba(0,0,0,0.25)',
                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
          {/* Left: Logo */}
          <div 
            className="flex items-center z-30 flex-shrink-0"
            style={{
              gap: useOwnerLikeMobileHeader ? '12px' : (scrolled ? '10px' : '14px'),
              transition: 'gap 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <Link 
              href="/" 
              className="inline-flex items-center transition-all duration-300 hover:scale-105 active:scale-95 group" 
              aria-label="NoLSAF Home"
            >
              <Image 
                src={logoSrc}
                alt="NoLSAF" 
                width={logoDims.width}
                height={logoDims.height}
                sizes="64px"
                loading="eager"
                priority
                className="object-contain transition-all duration-300 group-hover:brightness-110 w-auto max-w-[56px] sm:max-w-[64px]"
                style={{
                  width: "auto",
                  // Bigger + responsive like footer brand presence, but compact when scrolled.
                  height: compact ? '32px' : (scrolled ? '36px' : '36px'),
                  transform: scrolled ? 'scale(0.98)' : 'scale(1)',
                  // Keep it readable on tinted/hero states:
                  // - light header or non-public pages: use brand green color (no filter needed)
                  // - dark/green header on public pages: make it white
                  filter: 'brightness(0) invert(1) drop-shadow(0 2px 10px rgba(0,0,0,0.28))',
                  boxShadow: undefined,
                  transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </Link>

            {/* Desktop Navigation */}
            <nav 
              className={`hidden xl:flex items-center rounded-full px-1.5 py-1 backdrop-blur-md ${chromePillClass}`}
              style={{
                gap: scrolled ? '4px' : '8px',
                opacity: scrolled ? 1 : 1,
                transform: scrolled ? 'scale(0.95)' : 'scale(1)',
                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              {navLinks.map((link) => (
                <NavLink key={link.href} href={link.href}>
                  {link.label}
                </NavLink>
              ))}
              <RegionsDropdown variant={headerVariant} />
            </nav>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right: Auth & Tools */}
          <div 
            className="flex items-center z-30 flex-shrink-0"
            style={{
              gap: useOwnerLikeMobileHeader ? '10px' : (scrolled ? '8px' : '12px'),
              transition: 'gap 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {tools ?? (
              <>
                {!authed && (
                  <>
                    <Link
                      href="/account/login"
                      className="hidden items-center justify-center rounded-full bg-white/95 font-semibold text-slate-900 no-underline shadow-[0_6px_20px_rgba(15,23,42,0.18)] ring-1 ring-white transition-all duration-300 hover:scale-105 hover:bg-white hover:text-emerald-800 active:scale-95 sm:inline-flex"
                      style={{
                        padding: scrolled ? '7px 15px' : '9px 18px',
                        fontSize: scrolled ? '13px' : '14px',
                        transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/account/register"
                      className="hidden sm:inline-flex items-center justify-center rounded-full no-underline transition-all duration-300 hover:scale-105 active:scale-95 font-semibold text-white"
                      style={{
                        padding: scrolled ? '7px 15px' : '9px 18px',
                        fontSize: scrolled ? '13px' : '14px',
                        background: 'linear-gradient(135deg,#0b1f5c 0%,#0a5c82 52%,#02665e 100%)',
                        boxShadow: '0 0 0 1px rgba(2,102,94,0.45), 0 4px 16px rgba(2,102,94,0.28)',
                        transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                    >
                      Register
                    </Link>
                  </>
                )}

                <div className={`flex items-center rounded-full px-1.5 py-1 ${isMobile ? '' : `backdrop-blur-md ${chromePillClass}`}`} style={{ gap: scrolled ? '4px' : '6px' }}>
                  <GlobalPicker variant={headerVariant} />

                  {authed && <span className="hidden xl:inline-flex"><UserMenu variant={headerVariant} /></span>}

                  {/* Mobile Menu Button */}
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    className="xl:hidden p-2 rounded-full bg-transparent transition-all duration-300 hover:scale-110 active:scale-95 border-0 outline-none focus:outline-none focus:ring-0 text-white hover:bg-white/10"
                    aria-label="Toggle menu"
                    aria-expanded={mobileMenuOpen}
                  >
                    {mobileMenuOpen ? (
                      <X className="h-6 w-6 transition-transform duration-300" />
                    ) : (
                      <Menu className="h-6 w-6 transition-transform duration-300" />
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Mobile Menu — compact left-anchored panel */}
        <div
          className={`${isMobile ? "hidden" : "xl:hidden"} absolute top-full left-2 sm:left-3 z-50 transition-all duration-300 ease-out overflow-hidden ${
            mobileMenuOpen
              ? 'max-h-[90vh] opacity-100 translate-y-0 pointer-events-auto overflow-y-auto'
              : 'max-h-0 opacity-0 -translate-y-2 pointer-events-none'
          }`}
          style={{
            width: 'min(280px, calc(100vw - 16px))',
            marginTop: '6px',
            background: 'linear-gradient(180deg, rgba(5,10,18,0.98) 0%, rgba(4,9,16,0.96) 100%)',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: '18px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.60), 0 0 0 1px rgba(45,212,191,0.06)',
          }}
        >
          {/* Top accent line */}
          <div className="h-px mx-3 mt-2 rounded-full bg-gradient-to-r from-transparent via-[#2dd4bf]/30 to-transparent" />
          <nav className="flex flex-col py-2 px-2 gap-0.5">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`relative text-white/90 font-medium text-[13px] py-2.5 px-3 rounded-2xl transition-all duration-200 active:scale-[0.97] no-underline hover:text-white ${
                  pathname === link.href
                    ? 'bg-white/[0.10] text-white'
                    : 'hover:bg-white/[0.06]'
                }`}
              >
                {pathname === link.href && (
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-[#2dd4bf] rounded-full shadow-[0_0_8px_rgba(45,212,191,0.70)]"></span>
                )}
                <span className="relative z-10 pl-2">{link.label}</span>
              </Link>
            ))}
            <div className="mt-1.5 mb-1 border-t border-white/[0.07] pt-2 px-1">
              <button
                type="button"
                onClick={() => { setMobileMenuOpen(false); setMobileRegionsOpen(true); }}
                className="w-full flex items-center justify-between text-white/85 font-medium text-[13px] py-2.5 px-3 rounded-2xl bg-white/[0.05] hover:bg-white/[0.10] active:scale-[0.97] transition-all duration-150 border-0 outline-none"
              >
                <span className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-[#2dd4bf]" />
                  Regions
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-white/35" />
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-1 border-t border-white/[0.07] pt-1.5">
              {footerEssentials.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="truncate rounded-2xl px-3 py-2 text-[12.5px] font-medium text-white/60 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            {authed && (
              <WorkspaceSwitcher
                currentWorkspace="NORMAL"
                variant="mobile-dark"
                onSwitchStart={() => setMobileMenuOpen(false)}
              />
            )}
            {!authed && (
              <div className="pt-1.5 border-t border-white/[0.07] mt-0.5 flex flex-col gap-1.5 px-1 pb-2">
                <Link
                  href="/account/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-white/80 font-medium text-[13px] py-2 px-3 rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] ring-1 ring-white/[0.09] transition-all duration-200 text-center active:scale-[0.97] no-underline"
                >
                  Sign in
                </Link>
                <Link
                  href="/account/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-white font-semibold text-[13px] py-2 px-3 rounded-2xl transition-all duration-200 text-center active:scale-[0.97] no-underline"
                  style={{ background: 'linear-gradient(135deg,#0b1f5c 0%,#0a5c82 52%,#02665e 100%)', boxShadow: '0 4px 14px rgba(2,102,94,0.28)' }}
                >
                  Register
                </Link>
              </div>
            )}
          </nav>
        </div>
          </div>
        </div>
      </header>
      )}

      {/* Spacer to prevent content from going under fixed header */}
      <div 
        style={{
          // On /public we want the hero image to be treated as the header background,
          // but on mobile keep a small owner-like gap so the fixed header feels separate.
          height: useFlowHeader
            ? 0
            : isPublicHome
            ? (useOwnerLikeMobileHeader ? '76px' : 0)
            : (scrolled ? 'calc(64px + 24px)' : (compact ? '56px' : '80px')),
          transition: 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />

      {/* ── Phone menu: solid bottom sheet above the bottom nav ── */}
      {phoneMenuSheet && (
        <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 border-0 bg-black/50 backdrop-blur-[2px]"
          />
          <div
            ref={phoneMenuRef}
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-[#f3faf8] shadow-[0_-20px_50px_rgba(0,0,0,0.35)]"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          >
            <div className="sticky top-0 z-10 mb-4 border-0 border-b border-solid border-[#02665e]/10 bg-[#f3faf8] px-4 pb-3 pt-2.5">
              <span className="mx-auto block h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "linear-gradient(135deg, #011a18, #02665e)" }}>
                    <Image src={logoSrc} alt="" width={22} height={22} className="h-[20px] w-[20px] object-contain" style={{ filter: "brightness(0) invert(1)" }} />
                  </span>
                  <span className="text-[16px] font-bold tracking-tight text-slate-900">Explore NoLSAF</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-full border-0 bg-white text-slate-600 ring-1 ring-inset ring-slate-200"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            {/* Section rhythm: label, then one card. Same inset, same gap, every time. */}
            <div className="space-y-5 px-4 pb-2 pt-1">
              <section aria-labelledby="phone-menu-explore">
                <h2 id="phone-menu-explore" className="m-0 mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Explore</h2>
                <nav className="grid grid-cols-3 overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-[#02665e]/10" aria-label="Explore NoLSAF">
                  {navLinks.map((link, index) => {
                    const Icon = menuIcons[link.href] ?? Home;
                    const active = pathname === link.href;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={[
                          "flex flex-col items-center gap-2 px-1 py-3.5 text-center no-underline transition active:bg-[#02665e]/[0.06]",
                          // Hairline grid inside one card instead of six separate boxes
                          index % 3 !== 2 ? "border-0 border-r border-solid border-slate-100" : "",
                          index < 3 ? "border-0 border-b border-solid border-slate-100" : "",
                          active ? "bg-[#02665e]/[0.06]" : "",
                        ].join(" ")}
                        aria-current={active ? "page" : undefined}
                      >
                        <span
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                          style={{ background: "linear-gradient(135deg, #014e47, #02665e)" }}
                        >
                          <Icon className="h-[17px] w-[17px]" />
                        </span>
                        <span className={`text-[12px] font-semibold leading-tight ${active ? "text-[#02665e]" : "text-slate-700"}`}>{link.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              </section>

              <section aria-labelledby="phone-menu-shortcuts">
                <h2 id="phone-menu-shortcuts" className="m-0 mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Shortcuts</h2>
                <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-[#02665e]/10">
                  <button
                    type="button"
                    onClick={() => { setMobileMenuOpen(false); setMobileRegionsOpen(true); }}
                    className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left text-[14px] font-semibold text-slate-800 active:bg-slate-50"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#02665e]/[0.08] text-[#02665e]">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <span className="flex-1">Browse by region</span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                  {/* Moved here from the bottom nav, which is now for travellers */}
                  <Link
                    href="/account/register?role=owner"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex w-full items-center gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-800 no-underline active:bg-slate-50"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#02665e]/[0.08] text-[#02665e]">
                      <PlusSquare className="h-4 w-4" />
                    </span>
                    <span className="flex-1">List your property</span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </Link>
                  {authed && (
                    <div className="border-0 border-t border-solid border-slate-100">
                      <WorkspaceSwitcher currentWorkspace="NORMAL" onSwitchStart={() => setMobileMenuOpen(false)} />
                    </div>
                  )}
                </div>
              </section>

              <section aria-labelledby="phone-menu-help">
                <h2 id="phone-menu-help" className="m-0 mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Help &amp; policies</h2>
                <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-[#02665e]/10">
                  {footerEssentials.map((item, index) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={[
                        "flex items-center justify-between gap-2 px-4 py-3 text-[13px] font-medium text-slate-600 no-underline active:bg-slate-50",
                        index % 2 === 0 ? "border-0 border-r border-solid border-slate-100" : "",
                        index < footerEssentials.length - 2 ? "border-0 border-b border-solid border-slate-100" : "",
                      ].join(" ")}
                    >
                      <span className="truncate">{item.label}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </section>

              {!authed && (
                <div className="grid grid-cols-2 gap-2">
                  <Link href="/account/login" onClick={() => setMobileMenuOpen(false)} className="inline-flex h-11 items-center justify-center rounded-xl bg-white text-[14px] font-semibold text-slate-800 no-underline ring-1 ring-inset ring-slate-200">Sign in</Link>
                  <Link href="/account/register" onClick={() => setMobileMenuOpen(false)} className="inline-flex h-11 items-center justify-center rounded-xl text-[14px] font-semibold text-white no-underline" style={{ background: "linear-gradient(135deg, #011a18, #02665e)" }}>Register</Link>
                </div>
              )}
            </div>          </div>
        </div>
      )}

      {/* ── Mobile Regions Full-Screen Overlay ── */}
      <div
        className={`fixed inset-0 z-[200] flex flex-col transition-all duration-300 ease-out ${
          mobileRegionsOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(4,8,18,0.88)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) setMobileRegionsOpen(false); }}
      >
        {/* Sheet — slides up from bottom */}
        <div
          className={`mt-auto rounded-t-3xl flex flex-col transition-transform duration-300 ease-out ${
            mobileRegionsOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
          style={{
            background: 'linear-gradient(175deg, #080e28 0%, #0a2235 52%, #012018 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderBottom: 'none',
            boxShadow: '0 -16px 60px rgba(0,0,0,0.60)',
            maxHeight: '88vh',
          }}
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <span className="w-10 h-1 rounded-full bg-white/20" />
          </div>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07]">
            <div>
              <p className="text-white font-semibold text-base leading-tight">Regions</p>
              <p className="text-white/40 text-xs mt-0.5">Select a region to explore stays</p>
            </div>
            <button
              type="button"
              aria-label="Close regions"
              onClick={() => setMobileRegionsOpen(false)}
              className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.15] transition-all border-0 outline-none active:scale-90"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Teal accent */}
          <div className="h-px mx-5" style={{ background: 'linear-gradient(90deg, transparent, rgba(45,212,191,0.50), transparent)' }} />
          {/* Grid */}
          <div className="overflow-y-auto px-4 py-4" style={{ maxHeight: 'calc(88vh - 106px)' }}>
            <div className="grid grid-cols-3 gap-2">
              {REGIONS.map((r: any) => (
                <Link
                  key={r.id}
                  href={`/public/properties?region=${encodeURIComponent(r.id)}`}
                  onClick={() => setMobileRegionsOpen(false)}
                  className="flex items-center justify-center px-2 py-3.5 rounded-2xl text-center text-[12px] font-medium leading-tight text-white/75 hover:text-white active:scale-95 transition-all duration-150 select-none"
                  style={{ textDecoration: 'none', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  {r.name}
                </Link>
              ))}
            </div>
          </div>
          {/* Bottom safe area pad */}
          <div style={{ height: 'env(safe-area-inset-bottom, 16px)', minHeight: '16px' }} />
        </div>
      </div>
    </>
  );
}

function RegionsDropdown({ variant = "dark", fullWidth = false }:{ variant?: "light" | "dark"; fullWidth?: boolean }) {
  const [open, setOpen] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<HTMLDivElement | null>(null);
  const [minimized, setMinimized] = useState<boolean>(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const draggingRef = useRef<{ active: boolean; startX: number; startY: number; origLeft: number; origTop: number }>({ active: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('nols_regions_pos');
      if (raw) setPos(JSON.parse(raw));
    } catch (e) {}
  }, []);

  const savePos = (p: { left: number; top: number }) => {
    try { localStorage.setItem('nols_regions_pos', JSON.stringify(p)); } catch (e) {}
  };

  useEffect(() => {
    const el = dragRef.current as HTMLDivElement | null;
    if (!el) return;
    if (pos) {
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
    } else {
      el.style.left = '';
      el.style.top = '';
    }
  }, [pos]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('nols_regions_minimized');
      if (raw) setMinimized(raw === '1');
    } catch (e) {}
  }, []);

  const saveMinimized = (m: boolean) => {
    try { localStorage.setItem('nols_regions_minimized', m ? '1' : '0'); } catch (e) {}
  };

  const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const isTouch = (e as React.TouchEvent).touches != null;
    const clientX = isTouch ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = isTouch ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    const rect = ref.current?.getBoundingClientRect();
    const origLeft = rect ? rect.left : (window.innerWidth - 400) / 2;
    const origTop = rect ? rect.top : 80;
    draggingRef.current = { active: true, startX: clientX, startY: clientY, origLeft, origTop };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!draggingRef.current.active) return;
      let moveX = 0, moveY = 0;
      if ((ev as TouchEvent).touches) {
        moveX = (ev as TouchEvent).touches[0].clientX; moveY = (ev as TouchEvent).touches[0].clientY;
      } else {
        moveX = (ev as MouseEvent).clientX; moveY = (ev as MouseEvent).clientY;
      }
      const dx = moveX - draggingRef.current.startX;
      const dy = moveY - draggingRef.current.startY;
      const newLeft = Math.max(8, Math.min(window.innerWidth - 16, draggingRef.current.origLeft + dx));
      const newTop = Math.max(8, Math.min(window.innerHeight - 16, draggingRef.current.origTop + dy));
      setPos({ left: newLeft, top: newTop });
    };

    const onUp = () => {
      if (!draggingRef.current.active) return;
      draggingRef.current.active = false;
      if (pos) savePos(pos);
      window.removeEventListener('mousemove', onMove as any);
      window.removeEventListener('touchmove', onMove as any);
      window.removeEventListener('mouseup', onUp as any);
      window.removeEventListener('touchend', onUp as any);
    };

    window.addEventListener('mousemove', onMove as any, { passive: false });
    window.addEventListener('touchmove', onMove as any, { passive: false });
    window.addEventListener('mouseup', onUp as any);
    window.addEventListener('touchend', onUp as any);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className={[
          fullWidth
            ? "w-full text-left font-semibold no-underline text-sm py-2.5 px-4 rounded-full bg-transparent appearance-none border-0 transition-all duration-200 active:scale-[0.98] group relative"
            : "inline-flex items-center justify-center font-semibold no-underline text-sm py-2 px-3.5 rounded-full bg-transparent appearance-none border-0 transition-all duration-200 active:scale-[0.98] group relative",
          variant === "light" ? "text-[#02665e] hover:bg-[#02665e]/10" : "text-white hover:bg-white/8",
        ].join(" ")}
      >
        <div className={fullWidth ? "flex items-center justify-between" : "flex items-center gap-2"}>
          <span className="relative z-10">Regions</span>
          <ChevronDown 
            className={`h-4 w-4 ml-2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} 
            aria-hidden 
          />
        </div>
      </button>

      {/* ── Inline accordion (mobile hamburger / fullWidth mode) ── */}
      {fullWidth && open && (
        <div className="mt-1 rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-2 py-2 grid grid-cols-3 gap-0.5">
            {REGIONS.map((r: any) => (
              <Link
                key={r.id}
                href={`/public/properties?region=${encodeURIComponent(r.id)}`}
                onClick={() => setOpen(false)}
                className="block px-1.5 py-2 text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/[0.10] transition-all duration-150 no-underline text-center rounded-xl cursor-pointer active:scale-95 leading-tight"
              >
                {r.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Floating panel (desktop nav trigger) ── */}
      {!fullWidth && open && (
        <div
          ref={dragRef}
          className={`${pos ? 'fixed' : 'absolute left-1/2 transform -translate-x-1/2'} mt-2 rounded-2xl z-50 w-[calc(100vw-2rem)] sm:w-auto sm:min-w-[32rem] lg:min-w-[40rem] xl:min-w-[48rem] max-w-[calc(100vw-2rem)] transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-2`}
          style={{ background: 'linear-gradient(155deg,#080e28 0%,#0a2235 55%,#012018 100%)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', boxShadow: '0 24px 64px rgba(0,0,0,0.60), 0 0 0 1px rgba(2,102,94,0.30)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* Top accent */}
          <div className="h-px bg-gradient-to-r from-transparent via-[#02665e]/60 to-transparent rounded-t-2xl" />
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] cursor-move select-none">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white/90">Regions</span>
              <span className="text-xs text-white/40">Select a region</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={minimized ? 'Restore regions' : 'Minimize regions'}
                onClick={(ev) => { ev.stopPropagation(); setMinimized(m => { const nm = !m; saveMinimized(nm); return nm; }); }}
                className="text-white/50 hover:text-white/90 text-sm px-2 py-1 rounded transition-colors"
              >
                {minimized ? '▸' : '▾'}
              </button>
              <div
                onMouseDown={startDrag}
                onTouchStart={startDrag}
                className="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white/70 cursor-move"
                title="Drag to move"
              >
                ≡
              </div>
            </div>
          </div>

          {!minimized && (
            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-0.5">
              {REGIONS.map((r: any) => (
                <Link
                  key={r.id}
                  href={`/public/properties?region=${encodeURIComponent(r.id)}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2.5 text-sm text-white/75 hover:text-white hover:bg-white/[0.08] hover:font-semibold transition-all duration-200 ease-out no-underline text-center rounded-lg cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#02665e]/60 transform hover:scale-105 active:scale-95"
                >
                  {r.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
