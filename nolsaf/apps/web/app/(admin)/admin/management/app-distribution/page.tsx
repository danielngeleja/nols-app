"use client";

import { useEffect, useState } from "react";
import { Apple, ExternalLink, Save, Smartphone } from "lucide-react";
import apiClient from "@/lib/apiClient";
import type { PublicAppDistribution } from "@/components/app-distribution/AppDownloadPromotion";

type Settings = {
  enabled: boolean;
  showOnHome: boolean;
  showInFooter: boolean;
  headline: string;
  description: string;
  androidEnabled: boolean;
  androidStoreUrl: string | null;
  iosEnabled: boolean;
  iosStoreUrl: string | null;
  updatedAt?: string;
  updatedById?: number | null;
};

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 accent-emerald-700" />
    </label>
  );
}

export default function AppDistributionSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [preview, setPreview] = useState<PublicAppDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiClient.get<{ settings: Settings; publicPreview: PublicAppDistribution }>("/api/admin/app-distribution")
      .then(({ data }) => { setSettings(data.settings); setPreview(data.publicPreview); })
      .catch(() => setMessage({ ok: false, text: "Could not load app distribution settings. Please try again." }))
      .finally(() => setLoading(false));
  }, []);

  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => current ? { ...current, [key]: value } : current);
    setMessage(null);
  };

  const save = async () => {
    if (!settings || saving) return;
    setSaving(true);
    setMessage(null);
    const { enabled, showOnHome, showInFooter, headline, description, androidEnabled, androidStoreUrl, iosEnabled, iosStoreUrl } = settings;
    try {
      const { data } = await apiClient.put<{ settings: Settings; publicPreview: PublicAppDistribution }>("/api/admin/app-distribution", {
        enabled, showOnHome, showInFooter,
        headline: headline.trim(), description: description.trim(),
        androidEnabled, androidStoreUrl: androidStoreUrl?.trim() || null,
        iosEnabled, iosStoreUrl: iosStoreUrl?.trim() || null,
      });
      setSettings(data.settings);
      setPreview(data.publicPreview);
      setMessage({ ok: true, text: "Saved. Website app promotions now use these settings." });
    } catch (error: any) {
      const detail = error?.response?.data?.details?.[0]?.message;
      setMessage({ ok: false, text: detail || "Could not save app distribution settings." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-7 sm:px-6">
      <div>
        <p className="m-0 text-xs font-bold uppercase tracking-widest text-emerald-700">Management</p>
        <h1 className="m-0 mt-1 text-2xl font-bold text-slate-900">App distribution</h1>
        <p className="m-0 mt-2 text-sm text-slate-600">Manage Android and iOS download links and where they appear on the public website.</p>
      </div>

      {loading ? <p role="status" className="text-sm text-slate-600">Loading settings…</p> : null}
      {settings ? (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div>
              <h2 className="m-0 text-lg font-bold text-slate-900">Website visibility</h2>
              <p className="m-0 mt-1 text-sm text-slate-600">Turning this off hides all app download promotions. It does not disable existing installed apps, passkeys, or domain association files.</p>
            </div>
            <Switch label="Show app download promotions" checked={settings.enabled} onChange={(value) => change("enabled", value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Switch label="Show on homepage" checked={settings.showOnHome} onChange={(value) => change("showOnHome", value)} />
              <Switch label="Show in desktop footer" checked={settings.showInFooter} onChange={(value) => change("showInFooter", value)} />
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="m-0 flex items-center gap-2 text-lg font-bold text-slate-900"><Smartphone className="h-5 w-5 text-emerald-700" />Android</h2>
              <Switch label="Enable Google Play button" checked={settings.androidEnabled} onChange={(value) => change("androidEnabled", value)} />
              <label className="block text-sm font-semibold text-slate-800" htmlFor="android-store-url">Google Play listing URL</label>
              <input id="android-store-url" type="url" value={settings.androidStoreUrl ?? ""} onChange={(event) => change("androidStoreUrl", event.target.value)} placeholder="https://play.google.com/store/apps/details?id=com.nolsaf.app" className="box-border w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
              <p className="m-0 text-xs text-slate-500">Use the published com.nolsaf.app listing.</p>
            </div>
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="m-0 flex items-center gap-2 text-lg font-bold text-slate-900"><Apple className="h-5 w-5 text-emerald-700" />iOS</h2>
              <Switch label="Enable App Store button" checked={settings.iosEnabled} onChange={(value) => change("iosEnabled", value)} />
              <label className="block text-sm font-semibold text-slate-800" htmlFor="ios-store-url">App Store listing URL</label>
              <input id="ios-store-url" type="url" value={settings.iosStoreUrl ?? ""} onChange={(event) => change("iosStoreUrl", event.target.value)} placeholder="https://apps.apple.com/app/nolsaf/id123456789" className="box-border w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
              <p className="m-0 text-xs text-slate-500">The iOS homepage Smart App Banner uses this listing ID when promotions are enabled.</p>
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="m-0 text-lg font-bold text-slate-900">Promotion copy</h2>
            <div>
              <label htmlFor="app-headline" className="mb-1 block text-sm font-semibold text-slate-800">Headline</label>
              <input id="app-headline" type="text" maxLength={120} value={settings.headline} onChange={(event) => change("headline", event.target.value)} className="box-border w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="app-description" className="mb-1 block text-sm font-semibold text-slate-800">Description</label>
              <textarea id="app-description" maxLength={300} rows={3} value={settings.description} onChange={(event) => change("description", event.target.value)} className="box-border w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </section>

          <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
            <h2 className="m-0 text-base font-bold text-slate-900">Currently published</h2>
            <p className="m-0 mt-1 text-sm text-slate-700">{preview?.enabled ? `${preview.showOnHome ? "Homepage" : ""}${preview.showOnHome && preview.showInFooter ? " and " : ""}${preview.showInFooter ? "desktop footer" : ""}${!preview.showOnHome && !preview.showInFooter ? "No placement selected" : ""}` : "Promotions hidden"}</p>
            <p className="m-0 mt-2 text-xs text-slate-600">{settings.updatedAt ? `Last saved ${new Date(settings.updatedAt).toLocaleString()}` : "Not saved yet"}</p>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 py-3 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-60"><Save className="h-4 w-4" />{saving ? "Saving…" : "Save settings"}</button>
            {message ? <p role="status" className={`m-0 text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
          </div>

          <aside className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
            <p className="m-0 font-semibold text-slate-800">App and domain links</p>
            <p className="m-0 mt-1">Android App Links and iOS Universal Links use app entitlements and domain association files. They stay active when promotions are hidden. Store listing links can be changed here without rebuilding the apps.</p>
            <div className="mt-2 flex flex-wrap gap-4">
              <a href="/.well-known/assetlinks.json" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700">Android asset links <ExternalLink className="h-3 w-3" /></a>
              <a href="/.well-known/apple-app-site-association" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700">Apple association <ExternalLink className="h-3 w-3" /></a>
            </div>
          </aside>
        </>
      ) : null}
    </main>
  );
}
