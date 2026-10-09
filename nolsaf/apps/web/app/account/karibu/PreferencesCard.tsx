"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import api from "@/lib/apiClient";

export type KaribuPreferences = {
  celebrateOptIn: boolean;
  birthday: { day: number; month: number } | null;
  drinkLikes: string[];
  dietaryTags: string[];
  dietaryNote: string | null;
  shareWithProperty: boolean;
  updatedAt: string | null;
};

const DRINKS: Array<[string, string]> = [["TEA_COFFEE", "Tea or coffee"], ["FRESH_JUICE", "Fresh juice"], ["SOFT_DRINK", "Soft drink"], ["WATER", "Water"], ["MOCKTAIL", "Mocktail"]];
const DIETARY: Array<[string, string]> = [["NO_SUGAR", "No sugar"], ["LACTOSE_FREE", "Lactose-free"], ["NUT_ALLERGY", "Nut allergy"], ["VEGETARIAN", "Vegetarian"]];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const selectClass = "h-10 min-w-0 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-solid px-3.5 text-[13px] font-medium transition ${on ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"}`}>
      {on && <Check className="h-3.5 w-3.5" />}{children}
    </button>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border-0 transition-colors ${on ? "bg-emerald-600" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Group({ title, hint, children, first }: { title: string; hint: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={`px-5 py-5 sm:px-6 ${first ? "" : "border-0 border-t border-solid border-slate-200 md:border-l md:border-t-0"}`}>
      <p className="m-0 text-sm font-semibold text-slate-900">{title}</p>
      <p className="m-0 mt-0.5 text-xs text-slate-500">{hint}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/** Optional guest preferences for Karibu (docs/KARIBU_BY_NOLSAF.md section 14.2). Everything starts off. */
export default function PreferencesCard({ initial, onChange }: { initial: KaribuPreferences; onChange: (next: KaribuPreferences) => void }) {
  const [draft, setDraft] = useState<KaribuPreferences>(initial);
  const [birthdayIsMine, setBirthdayIsMine] = useState(!!initial.birthday);
  const [saving, setSaving] = useState<"" | "save" | "clear">("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => { setDraft(initial); setBirthdayIsMine(!!initial.birthday); }, [initial]);

  const dirty = useMemo(() => {
    const pick = (p: KaribuPreferences) => JSON.stringify({ ...p, updatedAt: null, drinkLikes: [...p.drinkLikes].sort(), dietaryTags: [...p.dietaryTags].sort(), dietaryNote: p.dietaryNote?.trim() || null });
    return pick(draft) !== pick(initial);
  }, [draft, initial]);
  const hasAnything = initial.celebrateOptIn || initial.shareWithProperty || initial.drinkLikes.length > 0 || initial.dietaryTags.length > 0 || !!initial.dietaryNote;
  const set = (patch: Partial<KaribuPreferences>) => { setDraft((d) => ({ ...d, ...patch })); setStatus(null); };
  const birthdayIncomplete = draft.celebrateOptIn && (!draft.birthday || !birthdayIsMine);
  const days = draft.birthday ? DAYS_IN[draft.birthday.month - 1] : 31;

  async function save() {
    if (birthdayIncomplete) return setStatus({ tone: "error", text: "Add your birthday and confirm it is yours, or switch celebrating off." });
    setSaving("save");
    try {
      const { data } = await api.put("/api/customer/karibu/preferences", {
        celebrateOptIn: draft.celebrateOptIn,
        birthday: draft.celebrateOptIn ? draft.birthday : null,
        birthdayIsMine,
        drinkLikes: draft.drinkLikes,
        dietaryTags: draft.dietaryTags,
        dietaryNote: draft.dietaryNote?.trim() || null,
        shareWithProperty: draft.shareWithProperty,
      });
      onChange(data.preferences);
      setStatus({ tone: "ok", text: "Saved" });
    } catch (cause: any) {
      setStatus({ tone: "error", text: cause?.response?.data?.error || "Your preferences could not be saved. Try again." });
    } finally {
      setSaving("");
    }
  }

  async function clearAll() {
    setSaving("clear");
    try {
      const { data } = await api.delete("/api/customer/karibu/preferences");
      onChange(data.preferences);
      setConfirmClear(false);
      setStatus({ tone: "ok", text: "All preferences cleared" });
    } catch (cause: any) {
      setStatus({ tone: "error", text: cause?.response?.data?.error || "Your preferences could not be cleared. Try again." });
    } finally {
      setSaving("");
    }
  }

  return (
    <section id="preferences" className="scroll-mt-24 rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      {/* Header: what this is, and the one action */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><SlidersHorizontal className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-bold text-slate-900">Your preferences</h2>
          <p className="m-0 mt-0.5 text-xs text-slate-500">Optional. Tell us what you enjoy so a welcome suits you.</p>
        </div>
        <div className="flex items-center gap-3">
          {status && <span role={status.tone === "error" ? "alert" : "status"} className={`text-xs font-semibold ${status.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>{status.text}</span>}
          <button type="button" onClick={() => void save()} disabled={!dirty || !!saving || birthdayIncomplete} className="inline-flex h-10 items-center gap-1.5 rounded-xl border-0 bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400">
            {saving === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
          </button>
        </div>
      </div>

      {/* Three groups side by side on wide screens, stacked on phones */}
      <div className="grid border-0 border-t border-solid border-slate-200 md:grid-cols-3">
        <Group first title="Drinks I enjoy" hint="Pick any you like.">
          <div className="flex flex-wrap gap-2">
            {DRINKS.map(([key, label]) => <Chip key={key} on={draft.drinkLikes.includes(key)} onClick={() => set({ drinkLikes: toggle(draft.drinkLikes, key) })}>{label}</Chip>)}
          </div>
        </Group>

        <Group title="Dietary needs or allergies" hint="We never choose a drink that clashes with these.">
          <div className="flex flex-wrap gap-2">
            {DIETARY.map(([key, label]) => <Chip key={key} on={draft.dietaryTags.includes(key)} onClick={() => set({ dietaryTags: toggle(draft.dietaryTags, key) })}>{label}</Chip>)}
          </div>
          <input value={draft.dietaryNote ?? ""} onChange={(e) => set({ dietaryNote: e.target.value })} maxLength={200} placeholder="Anything else, for example no ice" aria-label="Dietary note" className="mt-3 h-10 w-full min-w-0 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500" />
        </Group>

        <div className="border-0 border-t border-solid border-slate-200 md:border-l md:border-t-0">
          <div className="px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="m-0 text-sm font-semibold text-slate-900">Celebrate special days</p>
                <p className="m-0 mt-0.5 text-xs text-slate-500">If a stay falls on your birthday, we may mark it with you.</p>
              </div>
              <Switch on={draft.celebrateOptIn} onChange={(on) => set({ celebrateOptIn: on })} label="Celebrate special days" />
            </div>
            {draft.celebrateOptIn && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
                  <select aria-label="Birthday day" className={selectClass} value={draft.birthday?.day ?? ""} onChange={(e) => set({ birthday: { day: Number(e.target.value), month: draft.birthday?.month ?? 1 } })}>
                    <option value="" disabled>Day</option>
                    {Array.from({ length: days }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select aria-label="Birthday month" className={selectClass} value={draft.birthday?.month ?? ""} onChange={(e) => {
                    const month = Number(e.target.value);
                    set({ birthday: { month, day: Math.min(draft.birthday?.day ?? 1, DAYS_IN[month - 1]) } });
                  }}>
                    <option value="" disabled>Month</option>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <p className="m-0 text-[11px] text-slate-400">Day and month only. We never ask for the year.</p>
                <button type="button" role="checkbox" aria-checked={birthdayIsMine} onClick={() => { setBirthdayIsMine(!birthdayIsMine); setStatus(null); }} className="flex items-center gap-2 border-0 bg-transparent p-0 text-left text-xs text-slate-700">
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border border-solid ${birthdayIsMine ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"}`}>{birthdayIsMine && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                  This is my own birthday
                </button>
              </div>
            )}
          </div>
          <div className="border-0 border-t border-solid border-slate-200 px-5 py-5 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="m-0 text-sm font-semibold text-slate-900">Share with the property</p>
                <p className="m-0 mt-0.5 text-xs text-slate-500">Staff see your drinks and dietary needs during your stay only.</p>
              </div>
              <Switch on={draft.shareWithProperty} onChange={(on) => set({ shareWithProperty: on })} label="Share with the property I stay at" />
            </div>
          </div>
        </div>
      </div>

      {/* Footer: who sees this, and the way out */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-0 border-t border-solid border-slate-200 bg-slate-50/70 px-5 py-3 sm:px-6">
        <p className="m-0 text-xs text-slate-500">Only you and NoLSAF see these{draft.shareWithProperty ? ", plus the property while you stay there" : ""}. Never used for marketing.</p>
        {confirmClear ? (
          <span className="flex items-center gap-3 text-xs text-slate-600">
            Clear everything?
            <button type="button" onClick={() => void clearAll()} disabled={!!saving} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">{saving === "clear" ? "Clearing" : "Yes, clear"}</button>
            <button type="button" onClick={() => setConfirmClear(false)} className="border-0 bg-transparent p-0 text-xs font-semibold text-slate-500 hover:underline">Keep</button>
          </span>
        ) : hasAnything ? (
          <button type="button" onClick={() => setConfirmClear(true)} className="border-0 bg-transparent p-0 text-xs font-semibold text-slate-500 hover:text-rose-700 hover:underline">Clear my preferences</button>
        ) : null}
      </div>
    </section>
  );
}
