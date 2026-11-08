"use client";

/**
 * The admin Sales confirm-with-a-reason dialog. Replaces window.prompt: shows
 * who it is about, a few key figures, what the action actually does, quick
 * reasons, and a reason box checked against the server's 5 to 300 rule.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const MIN = 5;
const MAX = 300;

export default function AdminReasonDialog({
  icon: Icon,
  tone,
  title,
  subject,
  figures,
  effects,
  note,
  chips,
  placeholder,
  confirmLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  icon: LucideIcon;
  /** danger: red confirm (removing or excluding); safe: green (restoring). */
  tone: "danger" | "safe";
  title: string;
  /** One line under the title: who or what this is about. */
  subject: ReactNode;
  figures?: Array<[string, string]>;
  effects: string[];
  note?: ReactNode;
  chips: string[];
  placeholder: string;
  confirmLabel: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const tooShort = reason.trim().length < MIN;
  const danger = tone === "danger";

  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const submit = () => {
    setTried(true);
    if (tooShort || busy) return;
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-neutral-950/45 p-3 sm:p-6" onMouseDown={() => !busy && onCancel()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-reason-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 bg-[#0b2420] px-5 py-4 text-white">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${danger ? "bg-rose-400/15 text-rose-300" : "bg-emerald-400/15 text-emerald-300"}`}>
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="admin-reason-title" className="m-0 text-base font-bold">{title}</h2>
            <p className="m-0 mt-0.5 truncate text-[12px] text-white/60">{subject}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-solid border-white/15 bg-white/[0.04] text-white/80 hover:bg-white/10 disabled:opacity-50">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {figures?.length ? (
          <div className="grid gap-px border-0 border-b border-solid border-neutral-200 bg-neutral-200" style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}>
            {figures.map(([label, value]) => (
              <div key={label} className="min-w-0 bg-white px-4 py-2.5">
                <p className="m-0 text-[11px] text-neutral-500">{label}</p>
                <p className="m-0 truncate text-sm font-semibold tabular-nums text-neutral-900">{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-4 px-5 py-4">
          <ul className="m-0 list-none space-y-1.5 p-0 text-[13px] text-neutral-700">
            {effects.map((line) => (
              <li key={line} className="flex gap-2">
                <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${danger ? "bg-rose-600" : "bg-emerald-600"}`} aria-hidden />
                {line}
              </li>
            ))}
          </ul>

          {note ? <div className="rounded-md bg-neutral-50 px-3 py-2 text-[12px] text-neutral-600">{note}</div> : null}

          <div>
            <p className="m-0 text-[12px] font-semibold text-neutral-700">Reason <span className="font-normal text-neutral-400">(kept in the audit log)</span></p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => { setReason(chip); boxRef.current?.focus(); }}
                  className={`h-7 rounded-md border border-solid px-2.5 text-[12px] font-medium ${reason === chip ? "border-[#02665e] bg-[#02665e]/10 text-[#02665e]" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                >
                  {chip}
                </button>
              ))}
            </div>
            <textarea
              ref={boxRef}
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, MAX))}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit(); }}
              rows={3}
              placeholder={placeholder}
              aria-invalid={tried && tooShort}
              className={`mt-2 block w-full resize-y rounded-md border border-solid bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:ring-2 ${tried && tooShort ? "border-rose-400 focus:ring-rose-100" : "border-neutral-300 focus:border-[#02665e] focus:ring-[#02665e]/15"}`}
            />
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className={tried && tooShort ? "font-medium text-rose-700" : "text-neutral-400"}>{tried && tooShort ? `Write at least ${MIN} characters.` : "Ctrl + Enter to confirm"}</span>
              <span className="tabular-nums text-neutral-400">{reason.length} / {MAX}</span>
            </div>
          </div>

          {error ? <p className="m-0 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-800" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50 px-5 py-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="h-10 rounded-md border border-solid border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border-0 px-4 text-sm font-semibold text-white disabled:opacity-60 ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-[#02665e] hover:bg-[#014d47]"}`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
