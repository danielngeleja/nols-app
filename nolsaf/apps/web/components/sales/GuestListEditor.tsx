"use client";

// Guest list for a group stay: one row per person, name and phone in their own
// fields. Enter in a phone field moves to the next guest. A pasted list (one
// person per line) is split into rows so nobody retypes a WhatsApp list.
import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Phone, Plus, Trash2, UserRound, X } from "lucide-react";

export type Guest = { id: string; name: string; phone: string };

let seq = 0;
export const newGuest = (name = "", phone = ""): Guest => ({ id: `g${Date.now().toString(36)}${(seq++).toString(36)}`, name, phone });

const PHONE_AT_END = /[,;\t ]+(\+?\d[\d\s-]{7,18}\d)\s*$/;

/** "Asha Mushi, 0712 345 678" or "Asha Mushi 0712345678" per line. */
export function parseGuestLines(text: string): Guest[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      const m = PHONE_AT_END.exec(line);
      const phone = m ? m[1].replace(/[\s-]/g, "") : "";
      const name = (m ? line.slice(0, m.index) : line).replace(/[,;]+$/, "").trim();
      return newGuest(name, phone);
    })
    .filter((g) => g.name);
}

/** Problem with a phone, or null. Empty is fine: the phone is optional. */
export function guestPhoneProblem(phone: string): string | null {
  const v = phone.replace(/[\s-]/g, "");
  if (!v) return null;
  if (!/^\+?\d+$/.test(v)) return "Digits only";
  const digits = v.replace(/^\+/, "");
  if (digits.length < 9 || digits.length > 15) return "Check the number";
  return null;
}

/** The request roster: first name, last name, phone. */
export function guestsToRoster(guests: Guest[]) {
  return guests
    .filter((g) => g.name.trim())
    .map((g) => {
      const [firstname, ...rest] = g.name.trim().split(/\s+/);
      const phone = g.phone.replace(/[\s-]/g, "");
      return { firstname: firstname.slice(0, 100), lastname: (rest.join(" ") || "-").slice(0, 100), ...(phone ? { phone: phone.slice(0, 20) } : {}) };
    });
}

const cell = "block h-10 w-full min-w-0 rounded-md border border-solid bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
const MAX_GUESTS = 1000;

export default function GuestListEditor({ guests, onChange, headcount }: { guests: Guest[]; onChange: (next: Guest[]) => void; headcount: number }) {
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const focusId = useRef<string | null>(null);
  const nameRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (focusId.current && nameRefs.current[focusId.current]) {
      nameRefs.current[focusId.current]?.focus();
      focusId.current = null;
    }
  });

  const filled = guests.filter((g) => g.name.trim()).length;
  const phones = guests.map((g) => g.phone.replace(/[\s-]/g, "")).filter(Boolean);
  const dupes = new Set(phones.filter((p, i) => phones.indexOf(p) !== i));
  const pasted = pasting ? parseGuestLines(pasteText) : [];

  const update = (id: string, patch: Partial<Guest>) => onChange(guests.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const add = () => {
    if (guests.length >= MAX_GUESTS) return;
    const g = newGuest();
    focusId.current = g.id;
    onChange([...guests, g]);
  };
  const remove = (id: string) => onChange(guests.filter((g) => g.id !== id));
  const addPasted = () => {
    const keep = guests.filter((g) => g.name.trim() || g.phone.trim());
    onChange([...keep, ...pasted].slice(0, MAX_GUESTS));
    setPasteText("");
    setPasting(false);
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-xs font-medium text-slate-600">
          Guest list (optional)
          <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${headcount && filled > headcount ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
            {filled}{headcount ? ` of ${headcount}` : ""} added
          </span>
        </p>
        <button type="button" onClick={() => setPasting((v) => !v)} aria-expanded={pasting}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-[#02665e]/50 hover:bg-slate-50">
          {pasting ? <X className="h-3.5 w-3.5" aria-hidden /> : <ClipboardPaste className="h-3.5 w-3.5" aria-hidden />}{pasting ? "Close" : "Paste a list"}
        </button>
      </div>

      {pasting ? (
        <div className="mt-2 rounded-md border border-solid border-slate-300 bg-slate-50 p-3">
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5} aria-label="Paste guest list"
            placeholder={"One person per line, for example:\nAsha Mushi, 0712 345 678\nJuma Ali 0754123456"}
            className="block w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={addPasted} disabled={!pasted.length}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-xs font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
              <Plus className="h-3.5 w-3.5" aria-hidden />Add {pasted.length || ""} guest{pasted.length === 1 ? "" : "s"}
            </button>
            <span className="text-xs text-slate-500">Numbering like &quot;1.&quot; is removed. Each line becomes a row you can still edit.</span>
          </div>
        </div>
      ) : null}

      {guests.length ? (
        <ol className="m-0 mt-2 list-none space-y-2 p-0">
          {guests.map((g, i) => {
            const problem = guestPhoneProblem(g.phone) || (dupes.has(g.phone.replace(/[\s-]/g, "")) ? "Already in the list" : null);
            const nameMissing = !g.name.trim() && !!g.phone.trim();
            return (
              <li key={g.id} className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_2.25rem] items-start gap-2 sm:grid-cols-[1.75rem_minmax(0,1.3fr)_minmax(0,1fr)_2.25rem]">
                <span className="mt-2.5 grid h-5 w-7 place-items-center rounded bg-slate-100 text-[11px] font-semibold tabular-nums text-slate-500">{i + 1}</span>
                <span className="block min-w-0">
                  <span className="relative block">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input ref={(el) => { nameRefs.current[g.id] = el; }} value={g.name} maxLength={200} aria-label={`Guest ${i + 1} full name`} placeholder="Full name"
                      aria-invalid={nameMissing} onChange={(e) => update(g.id, { name: e.target.value })} className={`${cell} ${nameMissing ? "border-rose-400" : "border-slate-300"}`} />
                  </span>
                  {nameMissing ? <span className="mt-0.5 block text-[11px] font-medium text-rose-700">Add the name</span> : null}
                </span>
                <span className="col-start-2 block min-w-0 sm:col-start-auto">
                  <span className="relative block">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input value={g.phone} inputMode="tel" maxLength={20} aria-label={`Guest ${i + 1} phone`} aria-invalid={!!problem} placeholder="Phone (optional)"
                      onChange={(e) => update(g.id, { phone: e.target.value.replace(/[^\d+\s-]/g, "") })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (i === guests.length - 1) add(); else nameRefs.current[guests[i + 1].id]?.focus(); } }}
                      className={`${cell} ${problem ? "border-rose-400" : "border-slate-300"}`} />
                  </span>
                  {problem ? <span className="mt-0.5 block text-[11px] font-medium text-rose-700">{problem}</span> : null}
                </span>
                <button type="button" onClick={() => remove(g.id)} aria-label={`Remove guest ${i + 1}`}
                  className="col-start-3 row-start-1 grid h-10 w-9 place-items-center rounded-md border border-solid border-transparent bg-transparent text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 sm:col-start-auto sm:row-start-auto">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="m-0 mt-2 rounded-md border border-dashed border-slate-300 px-3 py-3 text-center text-xs text-slate-500">
          No guests added. You can leave this for later.
        </p>
      )}

      <button type="button" onClick={add} disabled={guests.length >= MAX_GUESTS}
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-[#02665e] hover:text-[#02665e] disabled:opacity-50">
        <Plus className="h-3.5 w-3.5" aria-hidden />Add guest
      </button>
    </div>
  );
}
