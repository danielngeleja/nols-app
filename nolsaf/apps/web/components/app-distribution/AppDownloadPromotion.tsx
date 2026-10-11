"use client";

import { useEffect, useState } from "react";
import { Apple, Smartphone } from "lucide-react";

export type PublicAppDistribution = {
  enabled: boolean;
  showOnHome: boolean;
  showInFooter: boolean;
  headline: string;
  description: string;
  androidStoreUrl: string | null;
  iosStoreUrl: string | null;
};

export default function AppDownloadPromotion({ placement }: { placement: "home" | "footer" }) {
  const [settings, setSettings] = useState<PublicAppDistribution | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/app-distribution", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!controller.signal.aborted) setSettings(data); })
      .catch(() => { if (!controller.signal.aborted) setSettings(null); });
    return () => controller.abort();
  }, []);

  if (!settings?.enabled || !(placement === "home" ? settings.showOnHome : settings.showInFooter)) return null;
  const links = [
    settings.androidStoreUrl && { href: settings.androidStoreUrl, label: "Get it on Google Play", Icon: Smartphone },
    settings.iosStoreUrl && { href: settings.iosStoreUrl, label: "Download on the App Store", Icon: Apple },
  ].filter((item): item is { href: string; label: string; Icon: typeof Smartphone } => Boolean(item));
  if (links.length === 0) return null;

  if (placement === "footer") {
    return (
      <div className="relative flex flex-wrap items-center justify-between gap-4 border-0 border-t border-solid border-white/10 px-8 py-5 lg:px-10">
        <div>
          <p className="m-0 text-base font-semibold text-white">{settings.headline}</p>
          <p className="m-0 mt-1 text-sm text-white/60">{settings.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {links.map(({ href, label, Icon }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white no-underline hover:bg-white/20 hover:text-white hover:no-underline">
              <Icon className="h-4 w-4" aria-hidden />{label}
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Get the NoLSAF app" className="public-container py-5 sm:py-8">
      <div className="flex flex-col gap-5 rounded-2xl border border-emerald-100 bg-white px-5 py-6 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="min-w-0">
          <p className="m-0 text-xs font-bold uppercase tracking-widest text-emerald-700">NoLSAF on your phone</p>
          <h2 className="m-0 mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{settings.headline}</h2>
          <p className="m-0 mt-2 text-sm text-slate-600">{settings.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {links.map(({ href, label, Icon }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[#02665e] px-4 py-3 text-sm font-semibold text-white no-underline hover:bg-[#014d47] hover:text-white hover:no-underline">
              <Icon className="h-4 w-4" aria-hidden />{label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
