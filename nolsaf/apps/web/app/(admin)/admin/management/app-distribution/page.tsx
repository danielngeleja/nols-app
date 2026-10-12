"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Apple, ArrowLeft, Check, ChevronRight, CircleAlert, ExternalLink,
  Globe2, Loader2, Save, Smartphone,
} from "lucide-react";
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
type Tab = "overview" | "stores";
type StoreLink = { label: string; Icon: typeof Apple };

const card = "min-w-0 rounded-2xl border border-solid border-neutral-200 bg-white";
const field = "min-h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 disabled:bg-neutral-50";
const heroButton = "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-solid border-emerald-500 bg-emerald-500 px-4 text-xs font-bold text-[#0b2420] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-white/[0.08] disabled:text-white/40";

function Toggle({ label, detail, checked, onChange, disabled }: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-0 border-b border-solid border-neutral-100 px-5 py-4 last:border-b-0 sm:px-6">
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold text-neutral-900">{label}</p>
        <p className="m-0 mt-0.5 text-xs leading-5 text-neutral-500">{detail}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-emerald-700" : "bg-neutral-300"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export default function AppDistributionSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [published, setPublished] = useState<PublicAppDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    apiClient.get<{ settings: Settings; publicPreview: PublicAppDistribution }>("/api/admin/app-distribution")
      .then(({ data }) => { setSettings(data.settings); setSaved(data.settings); setPublished(data.publicPreview); })
      .catch(() => setMessage({ ok: false, text: "Could not load app distribution settings. Refresh the page to try again." }))
      .finally(() => setLoading(false));
  }, []);

  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => current ? { ...current, [key]: value } : current);
    setMessage(null);
  };
  const dirty = !!settings && !!saved && JSON.stringify(settings) !== JSON.stringify(saved);
  const links: StoreLink[] = settings ? [
    settings.androidEnabled && settings.androidStoreUrl?.trim() ? { label: "Get it on Google Play", Icon: Smartphone } : null,
    settings.iosEnabled && settings.iosStoreUrl?.trim() ? { label: "Download on the App Store", Icon: Apple } : null,
  ].filter((link): link is StoreLink => !!link) : [];
  const draftPlacements = settings ? [settings.showOnHome && "Homepage", settings.showInFooter && "Desktop footer"].filter(Boolean).join(" · ") : "";
  const publishedPlacementCount = Number(!!published?.showOnHome) + Number(!!published?.showInFooter);
  const publishedLinkCount = Number(!!published?.androidStoreUrl) + Number(!!published?.iosStoreUrl);
  const missingStoreLink = !!settings && ((settings.androidEnabled && !settings.androidStoreUrl?.trim()) || (settings.iosEnabled && !settings.iosStoreUrl?.trim()));
  const needsAttention = !!settings?.enabled && (links.length === 0 || !draftPlacements || missingStoreLink);

  const save = async () => {
    if (!settings || saving || !dirty) return;
    setSaving(true);
    setMessage(null);
    const { enabled, showOnHome, showInFooter, headline, description, androidEnabled, androidStoreUrl, iosEnabled, iosStoreUrl } = settings;
    try {
      const { data } = await apiClient.put<{ settings: Settings; publicPreview: PublicAppDistribution }>("/api/admin/app-distribution", {
        enabled, showOnHome, showInFooter, headline: headline.trim(), description: description.trim(),
        androidEnabled, androidStoreUrl: androidStoreUrl?.trim() || null,
        iosEnabled, iosStoreUrl: iosStoreUrl?.trim() || null,
      });
      setSettings(data.settings);
      setSaved(data.settings);
      setPublished(data.publicPreview);
      setMessage({ ok: true, text: "Changes saved. Website app links are up to date." });
    } catch (error: any) {
      setMessage({ ok: false, text: error?.response?.data?.details?.[0]?.message || "Could not save app distribution settings." });
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { key: "overview", label: "Overview", Icon: Globe2 },
    { key: "stores", label: "Store links", Icon: Smartphone },
  ] as const;
  const setup = settings ? [
    { done: settings.enabled, label: "App links switched on", hint: "Open website visibility", target: "overview" as Tab },
    { done: links.length > 0 && !missingStoreLink, label: "Store listing connected", hint: "Add a published listing", target: "stores" as Tab },
    { done: !!draftPlacements, label: "Placement selected", hint: "Choose where it appears", target: "overview" as Tab },
  ] : [];

  return (
    <div className="w-full min-w-0 space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link href="/admin/management" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80 no-underline hover:text-emerald-200">
                <ArrowLeft className="h-3 w-3" /> Management · Public website
              </Link>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">App distribution</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Choose how visitors discover the NoLSAF app and where its store links appear.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${published?.enabled ? "bg-emerald-400/15 text-emerald-200" : "bg-white/[0.06] text-white/70"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${published?.enabled ? "bg-emerald-400" : "bg-white/40"}`} aria-hidden />
                {loading ? "Loading" : !settings ? "Unavailable" : published?.enabled ? "App links live" : "App links off"}
              </span>
              <button type="button" disabled={saving || !dirty} onClick={() => void save()} className={heroButton}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 sm:flex sm:flex-wrap sm:items-end">
            <div><p className="m-0 text-2xl font-bold leading-none text-white sm:text-3xl">{loading ? "…" : published?.enabled ? "Live" : "Off"}</p><p className="m-0 mt-1 text-xs text-white/55">Website app links</p></div>
            <div><p className="m-0 text-2xl font-bold leading-none text-emerald-300 sm:text-3xl">{loading ? "…" : publishedPlacementCount}</p><p className="m-0 mt-1 text-xs text-white/55">Published placements</p></div>
            <div><p className="m-0 text-2xl font-bold leading-none text-emerald-300 sm:text-3xl">{loading ? "…" : publishedLinkCount}</p><p className="m-0 mt-1 text-xs text-white/55">Published store badges</p></div>
            <div><p className={`m-0 text-base font-semibold ${dirty ? "text-amber-300" : "text-white"}`}>{loading ? "Loading" : !settings ? "Unavailable" : dirty ? "Unsaved draft" : "All changes saved"}</p><p className="m-0 mt-1 text-xs text-white/55">Editor status</p></div>
          </div>

          <div className="mt-5 flex gap-1 overflow-x-auto" role="tablist" aria-label="App distribution workspace">
            {tabs.map(({ key, label, Icon }) => (
              <button key={key} type="button" role="tab" id={`distribution-tab-${key}`} aria-selected={tab === key} aria-controls={`distribution-panel-${key}`} onClick={() => setTab(key)}
                className={`relative inline-flex h-11 shrink-0 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${tab === key ? "text-white" : "text-white/50 hover:text-white/80"}`}>
                <Icon className="h-4 w-4" />{label}
                {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {message && <div role={message.ok ? "status" : "alert"} className={`flex items-start gap-2 rounded-xl border border-solid px-4 py-3 text-sm ${message.ok ? "border-emerald-200 bg-emerald-50/60 text-emerald-900" : "border-rose-200 bg-rose-50/60 text-rose-800"}`}>
        {message.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}{message.text}
      </div>}
      {loading && <div className={`${card} flex items-center gap-2 px-5 py-8 text-sm text-neutral-500`} role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading distribution settings…</div>}

      {settings && <>
        {!setup.every((step) => step.done) && <section className={`${card} p-2`} aria-label="Distribution setup">
          <div className="grid gap-2 sm:grid-cols-3">
            {setup.map((step, index) => (
              <button key={step.label} type="button" onClick={() => setTab(step.target)} className={`group flex min-w-0 items-center gap-3 rounded-xl border border-solid border-transparent p-3 text-left transition ${step.done ? "bg-emerald-50/60" : "bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${step.done ? "bg-emerald-600 text-white" : "bg-[#0b2420] text-emerald-300"}`}>{step.done ? <Check className="h-4 w-4" /> : index + 1}</span>
                <span className="min-w-0 flex-1"><span className={`block truncate text-sm font-semibold ${step.done ? "text-emerald-800" : "text-neutral-900"}`}>{step.label}</span><span className="block truncate text-[11px] text-neutral-500">{step.done ? "Ready" : step.hint}</span></span>
                {!step.done && <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5" />}
              </button>
            ))}
          </div>
        </section>}

        {tab === "overview" && <div id="distribution-panel-overview" role="tabpanel" aria-labelledby="distribution-tab-overview" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className={card} aria-labelledby="visibility-heading">
            <div className="flex items-center gap-3 px-5 py-4 sm:px-6"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0b2420] text-emerald-300"><Globe2 className="h-4 w-4" /></span><div><h2 id="visibility-heading" className="m-0 text-sm font-bold text-neutral-900">Website visibility</h2><p className="m-0 mt-0.5 text-xs text-neutral-500">Choose where the download buttons appear.</p></div></div>
            <div className="border-0 border-t border-solid border-neutral-100">
              <Toggle label="Show app links" detail="Show store download buttons on the website." checked={settings.enabled} disabled={saving} onChange={(value) => change("enabled", value)} />
              <Toggle label="Homepage" detail="Show a download panel on the public homepage." checked={settings.showOnHome} disabled={saving} onChange={(value) => change("showOnHome", value)} />
              <Toggle label="Desktop footer" detail="Show store download buttons within the website footer." checked={settings.showInFooter} disabled={saving} onChange={(value) => change("showInFooter", value)} />
            </div>
          </section>
          <aside className="min-w-0 space-y-5">
            <section className={`${card} p-5 sm:p-6`}>
              <h2 className="m-0 text-sm font-bold text-neutral-900">Publishing checklist</h2>
              <p className="m-0 mt-1 text-xs text-neutral-500">Choose a placement and enable at least one store link.</p>
              <div className="mt-4 space-y-2">
                {[{ ready: !!draftPlacements, label: draftPlacements || "Choose a placement" }, { ready: links.length > 0 && !missingStoreLink, label: links.length ? `${links.length} store ${links.length === 1 ? "button" : "buttons"} ready` : "Add a store listing" }].map((item) => (
                  <p key={item.label} className="m-0 flex items-center gap-2 text-xs text-neutral-700"><span className={`grid h-5 w-5 place-items-center rounded-full ${item.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.ready ? <Check className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}</span>{item.label}</p>
                ))}
              </div>
              {needsAttention && <p className="m-0 mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{!draftPlacements ? "Select a website placement before publishing." : missingStoreLink ? "Add a listing URL for each enabled platform before publishing." : "Enable a platform and add its store link before publishing."}</p>}
            </section>
            <section className={`${card} p-5 sm:p-6`}>
              <h2 className="m-0 text-sm font-bold text-neutral-900">Review on the website</h2>
              <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">Save changes, then check the buttons where visitors see them.</p>
              <div className="mt-3 flex flex-col gap-2">
                <a href="/public#app-download" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 no-underline hover:underline">Open homepage download area <ExternalLink className="h-3 w-3" /></a>
                <a href="/public#site-footer" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 no-underline hover:underline">Open website footer <ExternalLink className="h-3 w-3" /></a>
              </div>
            </section>
          </aside>
          </div>
        </div>}

        {tab === "stores" && <div id="distribution-panel-stores" role="tabpanel" aria-labelledby="distribution-tab-stores" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className={card} aria-labelledby="stores-heading">
            <div className="px-5 py-4 sm:px-6"><h2 id="stores-heading" className="m-0 text-sm font-bold text-neutral-900">Store destinations</h2><p className="m-0 mt-0.5 text-xs text-neutral-500">Only enabled platforms with a valid published listing are shown to visitors.</p></div>
            <div className="border-0 border-t border-solid border-neutral-100">
              <Toggle label="Google Play" detail="Android app download" checked={settings.androidEnabled} disabled={saving} onChange={(value) => change("androidEnabled", value)} />
              <div className="px-5 pb-5 sm:px-6"><label htmlFor="android-store-url" className="mb-1.5 block text-xs font-semibold text-neutral-700">Google Play listing URL</label><input id="android-store-url" type="url" value={settings.androidStoreUrl ?? ""} disabled={saving} onChange={(event) => change("androidStoreUrl", event.target.value)} placeholder="https://play.google.com/store/apps/details?id=com.nolsaf.app" className={field} /><p className="m-0 mt-1.5 text-[11px] text-neutral-500">The Google Play button opens this link.</p></div>
            </div>
            <div className="border-0 border-t border-solid border-neutral-100">
              <Toggle label="App Store" detail="iPhone and iPad download" checked={settings.iosEnabled} disabled={saving} onChange={(value) => change("iosEnabled", value)} />
              <div className="px-5 pb-5 sm:px-6"><label htmlFor="ios-store-url" className="mb-1.5 block text-xs font-semibold text-neutral-700">App Store listing URL</label><input id="ios-store-url" type="url" value={settings.iosStoreUrl ?? ""} disabled={saving} onChange={(event) => change("iosStoreUrl", event.target.value)} placeholder="https://apps.apple.com/app/nolsaf/id123456789" className={field} /><p className="m-0 mt-1.5 text-[11px] text-neutral-500">The App Store button opens this link. It also supplies the iOS Smart App Banner ID.</p></div>
            </div>
          </section>
          <aside className="min-w-0 space-y-5">
            <section className={`${card} p-5 sm:p-6`}><h2 className="m-0 text-sm font-bold text-neutral-900">How store links work</h2><ol className="m-0 mt-3 list-none space-y-3 p-0">{[["Add", "Paste the published listing URL for each platform."], ["Publish", "Save changes so visitors can tap the store buttons."], ["Review", "Open the homepage or footer to check the buttons in place."]].map(([title, detail], index) => <li key={title} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#0b2420] text-[11px] font-bold text-emerald-300">{index + 1}</span><span className="text-xs leading-5 text-neutral-600"><b className="text-neutral-900">{title}.</b> {detail}</span></li>)}</ol></section>
            <section className={`${card} p-5 sm:p-6`}><h2 className="m-0 text-sm font-bold text-neutral-900">App and domain links</h2><p className="m-0 mt-1 text-xs leading-5 text-neutral-500">Android App Links and iOS Universal Links remain active when the store badges are hidden.</p><div className="mt-3 flex flex-col gap-2"><a href="/.well-known/assetlinks.json" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 no-underline hover:underline">Android asset links <ExternalLink className="h-3 w-3" /></a><a href="/.well-known/apple-app-site-association" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 no-underline hover:underline">Apple association <ExternalLink className="h-3 w-3" /></a></div></section>
          </aside>
          </div>
        </div>}

        {dirty && <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6`}><p className="m-0 text-xs font-semibold text-amber-700">You have unpublished changes.</p><button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-9 items-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving…" : "Save changes"}</button></div>}
      </>}
    </div>
  );
}
