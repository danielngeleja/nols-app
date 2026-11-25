"use client";

import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Lock, NotebookPen } from "lucide-react";
import api from "@/lib/apiClient";
import TablePagination from "@/components/TablePagination";

type Note = {
  id: number;
  text: string;
  createdAt: string;
  admin: { id: number; name: string | null; fullName: string | null } | null;
};
type NotesPage = { items: Note[]; page: number; pageSize: number; total: number };
const maxLength = 2000;
const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam",
});

export default function OwnerNotes({ ownerId, onTotal, draft, onDraftChange }: {
  ownerId: number; onTotal: (total: number) => void; draft: string; onDraftChange: Dispatch<SetStateAction<string>>;
}) {
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<NotesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const endpoint = `/api/admin/owners/${ownerId}/notes`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    void api.get<NotesPage>(endpoint, { params: { page }, signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setResult(data);
      onTotal(data.total);
    }).catch((error) => {
      if (!controller.signal.aborted) setListError(error?.response?.data?.error || "Could not load notes.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [endpoint, page, reload, onTotal]);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      await api.post(endpoint, { text });
      onDraftChange((current) => current === draft ? "" : current);
      setSaved(true);
      setPage(1);
      setReload((value) => value + 1);
    } catch (error: any) {
      setSaveError(error?.response?.data?.error || "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="owner-notes-title" className="min-w-0 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-3">
        <h3 id="owner-notes-title" className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-950"><NotebookPen className="size-4 text-[#02665e]" aria-hidden />Owner notes</h3>
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600"><Lock className="size-3" aria-hidden />Admins only</span>
      </header>
      <form onSubmit={addNote} className="border-0 border-b border-solid border-slate-100 bg-slate-50/60 p-4">
        <label htmlFor="owner-note" className="block text-[13px] font-semibold text-slate-800">New note</label>
        <textarea id="owner-note" value={draft} onChange={(event) => { onDraftChange(event.target.value); setSaved(false); setSaveError(""); }}
          rows={3} maxLength={maxLength} disabled={saving} required aria-describedby="owner-note-length"
          placeholder="Record an update or follow-up…"
          className="mt-1.5 block w-full resize-y rounded-md border border-solid border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15 [font-family:inherit]" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span id="owner-note-length" className="text-xs tabular-nums text-slate-600">{draft.length} / {maxLength.toLocaleString("en-US")} characters</span>
          <button type="submit" disabled={saving || !draft.trim()}
            className="inline-flex h-9 cursor-pointer items-center rounded-md border-0 bg-[#02665e] px-3.5 text-xs font-semibold text-white hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-55">
            {saving ? "Saving…" : "Save note"}
          </button>
        </div>
        {saveError ? <p role="alert" className="m-0 mt-2 text-xs text-red-700">{saveError}</p> : null}
        {saved ? <p role="status" className="m-0 mt-2 text-xs font-medium text-emerald-800">Note saved.</p> : null}
      </form>
      <div aria-busy={loading}>
        <h4 className="m-0 px-4 pt-3 text-[13px] font-semibold text-slate-950">Note history</h4>
        {result?.items.length ? (
          <ul className="m-0 list-none divide-y divide-slate-100 px-4">
            {result.items.map((note) => (
              <li key={note.id} className="min-w-0 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-semibold text-slate-800">{note.admin?.fullName || note.admin?.name || (note.admin ? `Admin #${note.admin.id}` : "Admin")}</span>
                  <time dateTime={note.createdAt} className="text-slate-600">{dateTime.format(new Date(note.createdAt))} EAT</time>
                </div>
                <p className="m-0 mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{note.text}</p>
              </li>
            ))}
          </ul>
        ) : !loading && !listError ? <p className="m-0 px-4 pb-4 pt-2 text-sm text-slate-600">No notes yet.</p> : null}
        {loading ? <p role="status" className="m-0 px-4 py-3 text-xs text-slate-600">Loading notes…</p> : null}
        {listError ? <p role="alert" className="m-0 px-4 py-3 text-xs text-red-700">{listError} <button type="button" onClick={() => setReload((value) => value + 1)} className="cursor-pointer border-0 bg-transparent p-0 font-semibold underline">Try again</button></p> : null}
        {result && result.total > result.pageSize ? (
          <nav aria-label="Owner notes pagination">
            <TablePagination page={result.page} pageSize={result.pageSize} total={result.total} disabled={loading || !!listError} onPageChange={setPage} />
          </nav>
        ) : null}
      </div>
    </section>
  );
}
