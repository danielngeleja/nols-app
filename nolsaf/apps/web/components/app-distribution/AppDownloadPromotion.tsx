"use client";

import { useEffect, useState } from "react";

export type PublicAppDistribution = {
  enabled: boolean;
  showOnHome: boolean;
  showInFooter: boolean;
  androidStoreUrl: string | null;
  iosStoreUrl: string | null;
};

type Placement = "home" | "footer";
type StoreLink = { href: string; platform: string; store: string; kind: "android" | "ios" };

function AppleStoreMark({ compact }: { compact: boolean }) {
  // Apple mark from Apple's Download on the App Store badge artwork.
  return <svg viewBox="10 8 18 23" aria-hidden="true" className={compact ? "h-5 w-5 shrink-0" : "h-7 w-7 shrink-0"}>
    <path fill="currentColor" d="M24.76888,20.30068a4.94881,4.94881,0,0,1,2.35656-4.15206,5.06566,5.06566,0,0,0-3.99116-2.15768c-1.67924-.17626-3.30719,1.00483-4.1629,1.00483-.87227,0-2.18977-.98733-3.6085-.95814a5.31529,5.31529,0,0,0-4.47292,2.72787c-1.934,3.34842-.49141,8.26947,1.3612,10.97608.9269,1.32535,2.01018,2.8058,3.42763,2.7533,1.38706-.05753,1.9051-.88448,3.5794-.88448,1.65876,0,2.14479.88448,3.591.8511,1.48838-.02416,2.42613-1.33124,3.32051-2.66914a10.962,10.962,0,0,0,1.51842-3.09251A4.78205,4.78205,0,0,1,24.76888,20.30068Z" />
    <path fill="currentColor" d="M22.03725,12.21089a4.87248,4.87248,0,0,0,1.11452-3.49062,4.95746,4.95746,0,0,0-3.20758,1.65961,4.63634,4.63634,0,0,0-1.14371,3.36139A4.09905,4.09905,0,0,0,22.03725,12.21089Z" />
  </svg>;
}

function GooglePlayMark({ compact }: { compact: boolean }) {
  return <svg viewBox="0 0 48 48" aria-hidden="true" className={compact ? "h-5 w-5 shrink-0" : "h-7 w-7 shrink-0"}>
    <path fill="#34a853" d="M7 5.5c1.2-.8 2.5-.7 3.8.2L29 23 22 30 7 5.5Z" />
    <path fill="#4285f4" d="M7 5.5 23 24 7 42.5c-.6-.5-1-1.3-1-2.4V8c0-1.1.4-2 1-2.5Z" />
    <path fill="#fbbc04" d="m23 24 7-7 10.5 6c.8.5 1.2.9 1.2 1s-.4.5-1.2 1L30 31l-7-7Z" />
    <path fill="#ea4335" d="m7 42.5 15-18.5 7 7-18.2 11.3c-1.3.9-2.6 1-3.8.2Z" />
  </svg>;
}

function StoreBadge({ item, compact, dark = false }: { item: StoreLink; compact: boolean; dark?: boolean }) {
  const content = <>
    {item.kind === "ios" ? <AppleStoreMark compact={compact} /> : <GooglePlayMark compact={compact} />}
    <span className="min-w-0 text-left">
      <span className={`block font-medium leading-none ${compact ? "text-[8px]" : "text-[9px]"}`}>{item.kind === "ios" ? "Download on the" : "GET IT ON"}</span>
      <span className={`mt-0.5 block whitespace-nowrap font-semibold leading-none tracking-tight ${compact ? "text-sm" : "text-base"}`}>{item.store}</span>
    </span>
  </>;
  // Dark: an outlined badge that sits inside the dark footer instead of a white block.
  const tone = dark
    ? "border-white/15 bg-white/[0.04] text-white hover:border-emerald-300/50 hover:bg-white/[0.08] hover:text-white"
    : "border-slate-300 bg-white text-[#111] hover:border-emerald-300 hover:bg-white hover:text-[#111]";
  const className = `box-border inline-flex shrink-0 items-center justify-center rounded-lg border border-solid no-underline transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${tone} ${compact ? "h-10 w-[136px] gap-2 px-2.5" : "h-[52px] w-[168px] gap-2 px-2"}`;
  return <a href={item.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.store} for ${item.platform}`} className={className}>{content}</a>;
}

function AppDownloadPromotionView({ settings, placement }: {
  settings: PublicAppDistribution | null;
  placement: Placement;
}) {
  if (!settings?.enabled || !(placement === "home" ? settings.showOnHome : settings.showInFooter)) return null;
  const links: StoreLink[] = [
    settings.androidStoreUrl ? { href: settings.androidStoreUrl, platform: "Android", store: "Google Play", kind: "android" as const } : null,
    settings.iosStoreUrl ? { href: settings.iosStoreUrl, platform: "iPhone & iPad", store: "App Store", kind: "ios" as const } : null,
  ].filter((item): item is StoreLink => !!item);
  if (links.length === 0) return null;

  const body = <div className="mx-auto max-w-lg px-5 py-5 sm:px-8">
    <div className={`flex flex-wrap items-center justify-center gap-4 ${links.length === 1 ? "" : "sm:justify-between"}`}>
      {links.map((item) => <StoreBadge key={item.store} item={item} compact={false} />)}
    </div>
  </div>;

  return placement === "footer"
    ? <section aria-label="Download the NoLSAF app" className="col-span-full mt-2 flex min-w-0 flex-wrap items-center justify-end gap-x-6 gap-y-3 border-0 border-t border-solid border-white/[0.08] pt-5">
        <div className="flex flex-wrap gap-2.5">
          {links.map((item) => <StoreBadge key={item.store} item={item} compact dark />)}
        </div>
      </section>
    : <section aria-label="Download the NoLSAF app" className="public-container py-5 sm:py-8">
        <div className="overflow-hidden rounded-[28px] bg-[linear-gradient(110deg,#073b37_0%,#0b2420_65%,#10201e_100%)] shadow-lg shadow-emerald-950/10">{body}</div>
      </section>;
}

export default function AppDownloadPromotion({ placement }: { placement: Placement }) {
  const [settings, setSettings] = useState<PublicAppDistribution | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/app-distribution", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!controller.signal.aborted) setSettings(data); })
      .catch(() => { if (!controller.signal.aborted) setSettings(null); });
    return () => controller.abort();
  }, []);

  return <AppDownloadPromotionView settings={settings} placement={placement} />;
}
