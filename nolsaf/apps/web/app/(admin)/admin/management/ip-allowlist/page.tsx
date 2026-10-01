"use client";

// Admin IP allowlist, in the admin Sales page language: dark header band with
// a fact strip, a live list of allowed networks (single IPs and CIDR ranges),
// quiet guidance on the side, and a sticky save bar while edits are pending.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, ListFilter, Plus, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";

const SETTINGS_URL = "/api/admin/settings";

// Ghost buttons sitting on the dark header, as on the Sales pages.
const heroButton =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";

async function readJsonOrText(res: Response): Promise<{ isJson: boolean; data?: any; text?: string }> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return { isJson: true, data: await res.json() };
    } catch {
      return { isJson: false, text: "" };
    }
  }
  try {
    return { isJson: false, text: await res.text() };
  } catch {
    return { isJson: false, text: "" };
  }
}

function friendlyStatus(status: number) {
  if (status === 401 || status === 403) return "Your admin session is not active. Please sign in again.";
  return "Could not load settings. Please retry.";
}

function isValidIPv4(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^[0-9]{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isValidIPv4OrCidr(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("/")) return isValidIPv4(trimmed);
  const [ip, prefix] = trimmed.split("/");
  if (!isValidIPv4(ip)) return false;
  if (!/^[0-9]{1,2}$/.test(prefix)) return false;
  const p = Number(prefix);
  return Number.isInteger(p) && p >= 0 && p <= 32;
}

function parseList(text: string) {
  return text
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** How many addresses an entry admits: 1 for a single IP, 2^(32-prefix) for a range. */
function addressCount(entry: string) {
  if (!entry.includes("/")) return 1;
  const prefix = Number(entry.split("/")[1]);
  return Number.isFinite(prefix) ? 2 ** (32 - prefix) : 0;
}

function compactCount(n: number) {
  return new Intl.NumberFormat(undefined, { notation: n >= 100000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

export default function IpAllowlistPage() {
  const [value, setValue] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState("");
  const [textMode, setTextMode] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(SETTINGS_URL, { credentials: "include", cache: "no-store" });
        const parsed = await readJsonOrText(res);
        if (!mounted) return;
        if (!res.ok) return setError(friendlyStatus(res.status));
        // A non-JSON reply is most commonly a redirect to the login page.
        if (!parsed.isJson) return setError("Your admin session is not active. Please sign in again.");
        const current = parsed.data?.ipAllowlist ?? "";
        setValue(current);
        setSaved(current);
      } catch {
        if (mounted) setError("Could not load settings. Please retry.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const entries = useMemo(() => parseList(value), [value]);
  const invalid = useMemo(() => entries.filter((entry) => !isValidIPv4OrCidr(entry)), [entries]);
  const savedEntries = useMemo(() => parseList(saved), [saved]);
  const dirty = entries.join("\n") !== savedEntries.join("\n");
  const enabled = entries.length > 0;
  const savedEnabled = savedEntries.length > 0;
  // The header describes what is live (saved), the list below shows the draft.
  const liveValid = savedEntries.filter(isValidIPv4OrCidr);
  const ranges = liveValid.filter((entry) => entry.includes("/")).length;
  const singles = liveValid.length - ranges;
  const covered = liveValid.reduce((sum, entry) => sum + addressCount(entry), 0);

  const setEntries = (next: string[]) => {
    setValue(next.join("\n"));
    setNotice(null);
  };

  const addEntry = () => {
    const raw = newEntry.trim();
    if (!raw) return;
    const additions = parseList(raw);
    const bad = additions.filter((entry) => !isValidIPv4OrCidr(entry));
    if (bad.length) {
      setError(`Not a valid IPv4 address or CIDR range: ${bad.join(", ")}`);
      return;
    }
    const merged = [...entries];
    for (const entry of additions) if (!merged.includes(entry)) merged.push(entry);
    setEntries(merged);
    setNewEntry("");
    setError(null);
  };

  const removeEntry = (index: number) => setEntries(entries.filter((_, i) => i !== index));

  const onSave = async () => {
    setError(null);
    setNotice(null);
    if (invalid.length > 0) {
      setError(`Fix ${invalid.length} invalid ${invalid.length === 1 ? "entry" : "entries"} before saving.`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(SETTINGS_URL, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipAllowlist: entries.join("\n") }),
      });
      if (!res.ok) {
        setError(friendlyStatus(res.status));
        return;
      }
      let next = entries.join("\n");
      // Reload once to reflect any backend normalisation.
      try {
        const refreshed = await fetch(SETTINGS_URL, { credentials: "include", cache: "no-store" });
        const parsed = await readJsonOrText(refreshed);
        if (refreshed.ok && parsed.isJson) next = parsed.data?.ipAllowlist ?? "";
      } catch {
        // keep what was sent
      }
      setValue(next);
      setSaved(next);
      setNotice(parseList(next).length ? "Allowlist saved. Admin access is now limited to the listed networks." : "Allowlist cleared. Enforcement is off and every IP can reach admin tools.");
    } catch {
      setError("Failed to save the allowlist.");
    } finally {
      setSaving(false);
    }
  };

  const facts = [
    {
      label: "Enforcement",
      value: loading ? "..." : savedEnabled ? "On" : "Off",
      detail: loading ? "" : savedEnabled ? "Only listed networks reach admin" : "Every IP can reach admin",
      tone: savedEnabled ? "text-emerald-300" : "text-white",
    },
    {
      label: "Live entries",
      value: loading ? "..." : String(savedEntries.length),
      detail: loading ? "" : savedEntries.length ? `${singles} single ${singles === 1 ? "IP" : "IPs"}, ${ranges} ${ranges === 1 ? "range" : "ranges"}` : "Nothing listed",
      tone: "text-white",
    },
    {
      label: "Addresses allowed",
      value: loading ? "..." : savedEnabled ? compactCount(covered) : "All",
      detail: loading ? "" : savedEnabled ? "Across every live entry" : "No restriction in place",
      tone: "text-white",
    },
  ];

  return (
    <div className="box-border w-full min-w-0 space-y-5 pb-24">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Security</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">IP allowlist</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Limit admin tools to trusted networks. Changes apply to admin access checks straight away.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setTextMode((t) => !t)} className={heroButton} disabled={loading}>
                {textMode ? <ListFilter className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                {textMode ? "Edit as list" : "Edit as text"}
              </button>
            </div>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-1 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 sm:grid-cols-3 sm:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index > 0 ? "sm:border-0 sm:border-l sm:border-solid sm:border-white/10 sm:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail || " "}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800" role="alert">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Allowed networks */}
        <section className="min-w-0 rounded-2xl border border-solid border-neutral-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Allowed networks</h2>
              <p className="m-0 text-xs text-neutral-400">IPv4 addresses and CIDR ranges. An empty list turns enforcement off.</p>
            </div>
            {invalid.length ? (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-solid border-rose-100 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">
                <AlertTriangle className="h-3 w-3" /> {invalid.length} invalid
              </span>
            ) : null}
          </div>

          {loading ? (
            <div className="space-y-2 border-0 border-t border-solid border-neutral-100 p-4 sm:p-5">
              <div className="h-10 animate-pulse rounded-lg bg-neutral-100" />
              <div className="h-10 animate-pulse rounded-lg bg-neutral-100" />
            </div>
          ) : textMode ? (
            <div className="border-0 border-t border-solid border-neutral-100 p-4 sm:p-5">
              <textarea
                value={value}
                onChange={(e) => { setValue(e.target.value); setNotice(null); }}
                rows={10}
                aria-label="Allowed networks, one per line"
                className="box-border block w-full resize-y rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2.5 font-mono text-[13px] leading-relaxed text-neutral-900 outline-none transition placeholder:text-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                placeholder={"203.0.113.5\n198.51.100.0/24"}
              />
              <p className="m-0 mt-2 text-[11px] text-neutral-400">One per line, or separated by commas. Switch back to the list to check each entry.</p>
            </div>
          ) : (
            <>
              {/* Add */}
              <div className="flex flex-col gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:flex-row sm:px-5">
                <input
                  value={newEntry}
                  onChange={(e) => setNewEntry(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEntry(); } }}
                  placeholder="Add an IP or range, for example 198.51.100.0/24"
                  aria-label="Add an IP address or CIDR range"
                  className="box-border h-10 min-w-0 flex-1 rounded-lg border border-solid border-neutral-200 bg-white px-3 font-mono text-sm text-neutral-900 outline-none transition placeholder:font-sans placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <button type="button" onClick={addEntry} disabled={!newEntry.trim()} className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45">
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>

              {entries.length === 0 ? (
                <div className="border-0 border-t border-solid border-neutral-100 px-6 py-12 text-center">
                  <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No networks listed</p>
                  <p className="m-0 mt-1 text-xs text-neutral-500">Enforcement is off. Add your office or VPN range to turn it on.</p>
                </div>
              ) : (
                <ul className="m-0 list-none p-0">
                  {entries.map((entry, index) => {
                    const ok = isValidIPv4OrCidr(entry);
                    const isRange = entry.includes("/");
                    const isNew = !savedEntries.includes(entry);
                    return (
                      <li key={`${entry}-${index}`} className={`flex items-center gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 sm:px-5 ${ok ? (isNew ? "bg-amber-50/40" : "") : "bg-rose-50/50"}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} aria-hidden />
                        <span className={`min-w-0 flex-1 truncate font-mono text-sm ${ok ? "font-semibold text-neutral-900" : "text-rose-700 line-through decoration-rose-300"}`}>{entry}</span>
                        <span className="hidden text-xs text-neutral-500 sm:inline">
                          {!ok ? "Not a valid IPv4 address or range" : isRange ? `Range, ${compactCount(addressCount(entry))} ${addressCount(entry) === 1 ? "address" : "addresses"}` : "Single IP"}
                        </span>
                        {isNew && ok ? <span className="rounded-full border border-solid border-amber-100 bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-700">New</span> : null}
                        <button type="button" onClick={() => removeEntry(index)} aria-label={`Remove ${entry}`} title="Remove" className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {entries.length > 0 ? (
                <div className="flex justify-end border-0 border-t border-solid border-neutral-100 px-4 py-2.5 sm:px-5">
                  <button type="button" onClick={() => setEntries([])} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-neutral-500 hover:text-rose-700 hover:underline">
                    Remove all and turn enforcement off
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>

        {/* Guidance */}
        <aside className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:px-5">
            <h2 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Before you save</h2>
            <ul className="m-0 mt-3 list-none space-y-3 p-0">
              {[
                ["Include your own network.", "If your current IP is not listed, you lose admin access the moment you save."],
                ["Prefer ranges.", "Use one CIDR range for an office or VPN instead of many single IPs."],
                ["Keep it short.", "Every entry is another way in. Remove networks you no longer use."],
                ["Empty means off.", "Clearing the list turns enforcement off, which helps when troubleshooting."],
              ].map(([title, text]) => (
                <li key={title} className="border-0 border-l-2 border-solid border-emerald-600 pl-3">
                  <p className="m-0 text-xs font-bold text-neutral-900">{title}</p>
                  <p className="m-0 mt-0.5 text-xs leading-5 text-neutral-500">{text}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:px-5">
            <h2 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Format</h2>
            <dl className="m-0 mt-3 border-0 border-y border-solid border-neutral-200">
              {[
                ["203.0.113.5", "One address"],
                ["198.51.100.0/24", "256 addresses"],
                ["10.0.0.0/8", "16.8M addresses"],
              ].map(([example, meaning], index) => (
                <div key={example} className={`flex items-center justify-between gap-3 px-2 py-2 ${index ? "border-0 border-t border-solid border-neutral-100" : ""}`}>
                  <dt className="font-mono text-xs font-semibold text-neutral-800">{example}</dt>
                  <dd className="m-0 text-[11px] text-neutral-500">{meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>

      {/* Save bar while edits are pending */}
      {dirty && !loading ? (
        <div className="sticky bottom-4 z-20">
          <div className="flex flex-col gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 shadow-[0_12px_28px_-16px_rgba(11,36,32,0.45)] sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <b>Unsaved changes.</b>{" "}
                {enabled
                  ? "Saving limits admin access to the listed networks straight away. Make sure your own network is on the list."
                  : "Saving clears the list and turns enforcement off."}
              </span>
            </p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => { setValue(saved); setError(null); }} disabled={saving} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-amber-200 bg-white px-3.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60">
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
              <button type="button" onClick={() => void onSave()} disabled={saving || invalid.length > 0} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                <CheckCircle2 className="h-4 w-4" /> {saving ? "Saving" : "Save allowlist"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
