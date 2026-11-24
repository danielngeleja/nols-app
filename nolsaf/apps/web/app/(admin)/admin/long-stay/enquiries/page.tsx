"use client";

/**
 * Ask NoLSAF (docs/LONG_STAY_RENTALS.md section 13). Tenants' questions about
 * long-stay homes, and requests to visit one with a Sales Partner. NoLSAF is
 * the bridge: staff may call the landlord for an answer, but the tenant only
 * ever hears from NoLSAF until the booking is paid.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarClock, CheckCircle2, Inbox, Loader2, Lock, MessageCircleQuestion, Phone, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";
import TablePagination from "@/components/TablePagination";

type View = "open" | "answered" | "closed";
type Item = {
  ref: string;
  kind: "QUESTION" | "VISIT";
  text: string;
  slots: string[];
  status: "OPEN" | "ANSWERED" | "CLOSED";
  answer: string | null;
  answeredAt: string | null;
  visitAt: string | null;
  partnerCode: string | null;
  home: { title: string | null; area: string };
  landlord: { name: string | null; phone: string | null };
  tenant: { name: string | null; phone: string | null };
  createdAt: string;
};
type EnquiryPage = { items: Item[]; openCount: number; pagination: { page: number; pageSize: number; total: number } };
const STATUS = {
  OPEN: { label: "Waiting", tone: "bg-amber-50 text-amber-900" },
  ANSWERED: { label: "Answered", tone: "bg-emerald-50 text-emerald-800" },
  CLOSED: { label: "Closed", tone: "bg-slate-100 text-slate-700" },
};
const fieldClass = "mt-1 block min-h-9 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";

function eat(iso: string | null) {
  return iso ? `${new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "";
}

export default function LongStayEnquiriesPage() {
  const [view, setView] = useState<View>("open");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<EnquiryPage | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function refresh() {
    setLoading(true);
    setError("");
    setVersion((current) => current + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    void apiClient.get<EnquiryPage>("/api/admin/long-stay/enquiries", { params: { view, page }, signal: controller.signal })
      .then(({ data: result }) => { if (!controller.signal.aborted) setData(result); })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError?.response?.data?.error || "Could not load enquiries.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, page, version]);
  const openCount = data?.openCount;

  return (
    <div id="ls-enquiries" className="w-full">
      <style>{`#ls-enquiries, #ls-enquiries * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<View>
        kicker="Long stays"
        title="Ask NoLSAF"
        description="Answer questions about long-stay homes and coordinate visits with Sales Partners."
        metrics={[{ label: "Waiting for an answer", value: openCount ?? "-", tone: openCount ? "warn" : "default" }]}
        onRefresh={refresh}
        loading={loading}
        tabs={[
          { key: "open", label: "Waiting", Icon: Inbox, count: openCount ?? undefined },
          { key: "answered", label: "Answered", Icon: CheckCircle2 },
          { key: "closed", label: "Closed", Icon: MessageCircleQuestion },
        ]}
        activeTab={view}
        onTab={(next) => { if (next !== view) { setPage(1); setView(next); setLoading(true); setError(""); setNotice(""); } }}
      />
      {notice && <p role="status" className="m-0 mt-3 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"><CheckCircle2 className="size-4" aria-hidden />{notice}</p>}
      <section aria-label="Enquiry queue" aria-busy={loading} className="mt-3 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        {loading ? <p role="status" className="m-0 flex min-h-32 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Loading enquiries</p>
          : error ? <p role="alert" className="m-0 px-4 py-6 text-sm text-red-700">{error}</p>
          : data?.items.length ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] table-fixed border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th scope="col" className="w-[45%] px-3 py-2.5 font-semibold sm:px-4">Property and enquiry</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Tenant</th>
                      <th scope="col" className="w-28 px-3 py-2.5 font-semibold">Status</th>
                      <th scope="col" className="hidden w-40 px-3 py-2.5 font-semibold md:table-cell">Received</th>
                      <th scope="col" className="sticky right-0 w-24 bg-slate-50 px-3 py-2.5 text-right font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => {
                      const Icon = item.kind === "VISIT" ? CalendarClock : MessageCircleQuestion;
                      const title = item.home.title || "Long-stay home";
                      return (
                        <tr key={item.ref} className="group border-0 border-t border-solid border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2.5 sm:px-4">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#edf6f2] text-[#02665e]"><Icon className="size-4" aria-hidden /></span>
                              <div className="min-w-0">
                                <p className="m-0 truncate font-semibold text-slate-900">{title}</p>
                                <p className="m-0 truncate text-xs text-slate-600">{item.kind === "VISIT" ? "Visit request" : "Question"} · {item.text}</p>
                              </div>
                            </div>
                          </td>
                          <td className="truncate px-3 py-2.5 text-slate-700">{item.tenant.name || "Tenant"}</td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={item.status} />
                            {item.status === "ANSWERED" && item.visitAt && <span className="mt-1 block text-xs text-slate-600">Visit scheduled</span>}
                          </td>
                          <td className="hidden px-3 py-2.5 text-xs text-slate-600 md:table-cell"><time dateTime={item.createdAt}>{eat(item.createdAt)}</time></td>
                          <td className="sticky right-0 bg-white px-3 py-2.5 text-right group-hover:bg-slate-50">
                            <button type="button" onClick={() => { setNotice(""); setSelected(item); }} aria-label={`Open ${item.kind === "VISIT" ? "visit request" : "question"} for ${title} from ${item.tenant.name || "tenant"}`} aria-haspopup="dialog"
                              className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md border border-solid border-[#c5ded6] bg-white px-2.5 text-xs font-semibold text-[#02665e] hover:bg-[#edf6f2]">Open <ArrowUpRight className="size-3.5" aria-hidden /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination {...data.pagination} onPageChange={(next) => { setPage(next); setLoading(true); setError(""); }} />
            </>
          ) : <p className="m-0 px-5 py-10 text-center text-sm text-slate-600">{view === "open" ? "No enquiries waiting for an answer." : "No enquiries in this view."}</p>}
      </section>
      {selected && <EnquiryCard key={selected.ref} item={selected} onDismiss={() => setSelected(null)} onChanged={(message) => { setNotice(message); refresh(); }} />}
    </div>
  );
}

function StatusBadge({ status }: { status: Item["status"] }) {
  return <span className={`inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${STATUS[status].tone}`}>{STATUS[status].label}</span>;
}

function EnquiryCard({ item, onDismiss, onChanged }: { item: Item; onDismiss: () => void; onChanged: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  const [answer, setAnswer] = useState(item.answer ?? "");
  const [visitSlot, setVisitSlot] = useState(item.visitAt ?? "");
  const [partnerCode, setPartnerCode] = useState(item.partnerCode ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const post = async (path: "answer" | "close", body: unknown) => {
    setBusy(path);
    setError("");
    try {
      await apiClient.post(`/api/admin/long-stay/enquiries/${encodeURIComponent(item.ref)}/${path}`, body);
      dialog.current?.close();
      onChanged(path === "close" ? "Enquiry closed." : item.status === "ANSWERED" ? "Answer updated." : "Answer sent.");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]";
  const Icon = item.kind === "VISIT" ? CalendarClock : MessageCircleQuestion;

  return (
    <dialog ref={dialog} onClose={onDismiss} onCancel={(event) => { if (busy) event.preventDefault(); }} aria-labelledby="enquiry-title"
      className="fixed inset-0 m-auto max-h-[88dvh] w-[calc(100%_-_1.5rem)] max-w-[46rem] overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/45">
      <div className="flex max-h-[inherit] min-w-0 flex-col">
        <header className="flex shrink-0 items-start gap-3 border-0 border-b border-solid border-[#dce8e3] bg-[#f2f7f5] p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><Icon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 id="enquiry-title" className="m-0 break-words text-base font-bold text-slate-950">{item.home.title || "Long-stay home"}</h2>
              <StatusBadge status={item.status} />
            </div>
            <p className="m-0 mt-1 text-xs text-slate-600">{item.home.area || (item.kind === "VISIT" ? "Visit request" : "Question")}</p>
          </div>
          <button type="button" aria-label="Dismiss enquiry details" onClick={() => dialog.current?.close()} disabled={busy !== null}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"><X className="size-4" aria-hidden /></button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-y-contain">
          <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.55fr)]">
            <section className="min-w-0 rounded-md bg-slate-50 p-3">
              <h3 className="m-0 text-sm font-semibold text-slate-900">{item.kind === "VISIT" ? "Visit request" : "Tenant question"}</h3>
              <p className="m-0 mt-1 text-xs text-slate-600">Received <time dateTime={item.createdAt}>{eat(item.createdAt)}</time></p>
              <p className="m-0 mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{item.text}</p>
              {item.slots.length > 0 && <ul aria-label="Suggested visit times" className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">{item.slots.map((slot) => <li key={slot} className="rounded border border-solid border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"><time dateTime={slot}>{eat(slot)}</time></li>)}</ul>}
            </section>
            <dl aria-label="Contact details" className="m-0 min-w-0 divide-y divide-slate-100 rounded-md border border-solid border-slate-200">
              <Contact label="Tenant" person={item.tenant} />
              <Contact label="Landlord" person={item.landlord} privateContact />
            </dl>
          </div>
          {item.status !== "CLOSED" ? (
            <div className="space-y-2 border-0 border-t border-solid border-slate-100 px-4 py-3">
              <label htmlFor={`a-${item.ref}`} className="block text-sm font-semibold text-slate-900">Reply to tenant</label>
              <p id="enquiry-reply-help" className="m-0 text-xs text-slate-600">The tenant sees this reply. Keep the landlord&apos;s contact details private.</p>
              {item.answeredAt && <p className="m-0 text-xs text-slate-500">Last answered <time dateTime={item.answeredAt}>{eat(item.answeredAt)}</time></p>}
              <textarea id={`a-${item.ref}`} aria-describedby="enquiry-reply-help" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1000} disabled={busy !== null}
                className={`${fieldClass} box-border min-h-24 resize-y py-2 [font-family:inherit]`} />
              {item.kind === "VISIT" ? (
                <div className="grid items-end gap-2 sm:grid-cols-2">
                  <label className="block min-w-0 text-xs font-semibold text-slate-700">Agreed time
                    <select value={visitSlot} disabled={busy !== null} onChange={(e) => setVisitSlot(e.target.value)} className={`${fieldClass} font-normal`}>
                      <option value="">Choose one the tenant suggested</option>
                      {item.visitAt && !item.slots.includes(item.visitAt) && <option value={item.visitAt}>{eat(item.visitAt)}</option>}
                      {item.slots.map((s) => <option key={s} value={s}>{eat(s)}</option>)}
                    </select>
                  </label>
                  <label className="block min-w-0 text-xs font-semibold text-slate-700">Sales Partner code
                    <input value={partnerCode} disabled={busy !== null} onChange={(e) => setPartnerCode(e.target.value.toUpperCase())} placeholder="NSA-DAR-0042" maxLength={30}
                      className={`${fieldClass} font-mono font-normal`} />
                  </label>
                </div>
              ) : null}
              {error ? <p role="alert" className="m-0 rounded-md bg-rose-50 px-2.5 py-2 text-xs text-rose-800">{error}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5">
                <button type="button" disabled={busy !== null} onClick={() => post("close", {})} className={`${btn} border border-solid border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>{busy === "close" ? "Closing…" : "Close enquiry"}</button>
                <button type="button" disabled={answer.trim().length < 5 || busy !== null || (item.kind === "VISIT" && Boolean(visitSlot) !== Boolean(partnerCode.trim()))}
                  onClick={() => post("answer", { answer: answer.trim(), visitAt: item.kind === "VISIT" && visitSlot ? visitSlot : null, partnerCode: item.kind === "VISIT" && partnerCode.trim() ? partnerCode.trim() : null })}
                  className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
                  {busy === "answer" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{item.status === "ANSWERED" ? "Update answer" : "Send answer"}
                </button>
              </div>
            </div>
          ) : item.answer || item.visitAt ? (
            <div className="space-y-1 border-0 border-t border-solid border-slate-100 px-4 py-3 text-sm text-slate-700">
              {item.answer && <p className="m-0 whitespace-pre-wrap break-words"><strong>Reply to tenant</strong><br />{item.answer}</p>}
              {item.visitAt && <p className="m-0"><strong>Agreed visit</strong> <time dateTime={item.visitAt}>{eat(item.visitAt)}</time>{item.partnerCode && ` · ${item.partnerCode}`}</p>}
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

function Contact({ label, person, privateContact }: { label: string; person: Item["tenant"]; privateContact?: boolean }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-600">
        {label}{privateContact && <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 text-amber-900"><Lock className="size-3" aria-hidden />NoLSAF only</span>}
      </dt>
      <dd className="m-0 mt-1 break-words text-sm font-semibold text-slate-900">{person.name || "Name unavailable"}</dd>
      {person.phone && <dd className="m-0 mt-0.5"><a href={`tel:${person.phone}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline"><Phone className="size-3.5 shrink-0" aria-hidden />{person.phone}</a></dd>}
    </div>
  );
}
