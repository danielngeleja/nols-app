"use client";

/**
 * Long-stay home inspections (docs/LONG_STAY_RENTALS.md section 13).
 * No long-stay home goes live without a NoLSAF Sales Partner's on-site check.
 * Assign a partner (not the owner, not the partner who brought the home in),
 * then review the report: PASS for a year, FAIL, or REDO with no fee.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ClipboardCheck, Clock3, Eye, Loader2, MapPin, Phone, UserRoundCheck, X, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";
import TablePagination from "@/components/TablePagination";
import InspectionReportReview, { type InspectionCheck, type InspectionPoint, type InspectionReport } from "@/components/admin/properties/InspectionReportReview";

type View = "todo" | "review" | "passed" | "failed";
type SortKey = "property" | "landlord" | "partner" | "status" | "date";
type Sort = { key: SortKey; direction: "asc" | "desc" };
type QueueRow = {
  ref: string;
  status: "REQUESTED" | "ASSIGNED" | "SUBMITTED" | "PASSED" | "FAILED" | "CANCELLED";
  reason: string;
  home: { title: string | null; area: string; hasPin: boolean };
  landlord: { name: string | null };
  partner: { code: string; name: string | null } | null;
  assignedAt: string | null;
  dueBy: string | null;
  overdue: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  validUntil: string | null;
  current: boolean;
  createdAt: string;
};
type Item = QueueRow & {
  landlord: { name: string | null; phone: string | null };
  pin: InspectionPoint | null;
  report: InspectionReport | null;
  reviewNote: string | null;
  feeAmount: number | null;
};
type Data = { counts: Record<View, number>; items: QueueRow[]; pagination: { page: number; pageSize: number; total: number }; inspectionRequiredForApproval?: boolean };
type Detail = { item: Item; checklist: InspectionCheck[] };
const dateColumns = {
  todo: { label: "Requested", field: "createdAt" },
  review: { label: "Submitted", field: "submittedAt" },
  passed: { label: "Valid until", field: "validUntil" },
  failed: { label: "Reviewed", field: "reviewedAt" },
} as const;

const TABS: Array<{ key: View; label: string; Icon: typeof Clock3 }> = [
  { key: "todo", label: "To assign or visit", Icon: Clock3 },
  { key: "review", label: "To review", Icon: ClipboardCheck },
  { key: "passed", label: "Passed", Icon: CheckCircle2 },
  { key: "failed", label: "Failed", Icon: XCircle },
];

function eat(iso: string | null) {
  return iso ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "";
}
function day(iso: string | null) {
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}

function statusOf(item: QueueRow) {
  switch (item.status) {
    case "REQUESTED": return { label: "Unassigned", tone: "bg-amber-50 text-amber-800", date: item.createdAt, dateLabel: "Requested" };
    case "ASSIGNED": return item.overdue
      ? { label: "Visit overdue", tone: "bg-red-50 text-red-700", date: item.dueBy, dateLabel: "Was due" }
      : { label: "Visit pending", tone: "bg-sky-50 text-sky-800", date: item.dueBy, dateLabel: "Due" };
    case "SUBMITTED": return { label: "Ready for review", tone: "bg-sky-50 text-sky-800", date: item.submittedAt, dateLabel: "Submitted" };
    case "PASSED": return item.current
      ? { label: "Passed", tone: "bg-emerald-50 text-emerald-800", date: item.validUntil, dateLabel: "Valid to" }
      : { label: "Expired", tone: "bg-slate-100 text-slate-600", date: item.validUntil, dateLabel: "Expired" };
    case "FAILED": return { label: "Failed", tone: "bg-red-50 text-red-700", date: item.reviewedAt, dateLabel: "Reviewed" };
    case "CANCELLED": return { label: "Cancelled", tone: "bg-slate-100 text-slate-600", date: null, dateLabel: "" };
  }
}

export default function LongStayInspectionsPage() {
  const [view, setView] = useState<View>("todo");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const sortKey = sort?.key ?? "date";
  const sortDirection = sort?.direction ?? (view === "todo" ? "asc" : "desc");
  const dateColumn = dateColumns[view];
  const columns: Array<{ key: SortKey; label: string }> = [
    { key: "property", label: "Property" }, { key: "landlord", label: "Landlord" }, { key: "partner", label: "Sales Partner" },
    { key: "status", label: "Status" }, { key: "date", label: dateColumn.label },
  ];

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<Data>("/api/admin/long-stay/inspections", { params: { view, page, sort: sortKey, direction: sortDirection }, signal: controller.signal });
      if (!controller.signal.aborted) setData(response.data);
    } catch (requestError: any) {
      if (!controller.signal.aborted) setError(requestError?.response?.data?.error || "Could not load inspections.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [view, page, sortKey, sortDirection]);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);

  const counts = data?.counts;
  function changeSort(key: SortKey) {
    setPage(1);
    setLoading(true);
    setSort({ key, direction: key === sortKey && sortDirection === "asc" ? "desc" : "asc" });
  }

  return (
    <div id="ls-inspections" className="w-full">
      <style>{`#ls-inspections, #ls-inspections * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<View>
        kicker="Long stays"
        title="Inspections"
        description={data?.inspectionRequiredForApproval === true
          ? "This server requires a current inspection for listing approval and reservations."
          : data?.inspectionRequiredForApproval === false
            ? "Listings can be approved while the visit is pending. A current pass is required for reservations."
            : "Assign Sales Partners and review their on-site reports."}
        metrics={[
          { label: "Waiting", value: counts?.todo ?? "-", tone: counts?.todo ? "warn" : "default" },
          { label: "To review", value: counts?.review ?? "-", tone: counts?.review ? "warn" : "default" },
          { label: "Passed", value: counts?.passed ?? "-", tone: "good" },
          { label: "Failed", value: counts?.failed ?? "-", tone: "muted" },
        ]}
        onRefresh={load}
        loading={loading}
        tabs={TABS.map((t) => ({ ...t, count: counts?.[t.key] }))}
        activeTab={view}
        onTab={(next) => {
          if (next === view) return;
          setPage(1);
          setData((current) => current ? { ...current, items: [], pagination: { ...current.pagination, page: 1, total: 0 } } : null);
          setLoading(true);
          setView(next);
        }}
      />
      {error ? <p className="m-0 mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {loading && !data?.items.length ? (
          <div role="status" className="grid min-h-32 place-items-center text-slate-500"><span className="flex items-center gap-2 text-sm"><Loader2 className="h-5 w-5 animate-spin" aria-hidden />Loading inspections</span></div>
        ) : data && data.items.length === 0 && !error ? (
          <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center">
            <ClipboardCheck className="mx-auto h-7 w-7 text-slate-300" />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{view === "todo" ? "No homes waiting" : view === "review" ? "No reports to review" : "Nothing here yet"}</p>
            <p className="m-0 mt-0.5 text-[13px] text-slate-500">A visit request opens when a landlord submits a long-stay home.</p>
          </div>
        ) : data?.items.length ? (
          <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white" aria-label="Inspection queue" aria-busy={loading}>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Inspection queue table">
              <table className="w-full min-w-[690px] border-collapse text-left text-[13px]">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    {columns.map(({ key, label }) => {
                      const active = key === sortKey;
                      const Indicator = !active ? ArrowUpDown : sortDirection === "asc" ? ArrowUp : ArrowDown;
                      return (
                        <th key={key} scope="col" aria-sort={active ? sortDirection === "asc" ? "ascending" : "descending" : undefined}
                          className="px-3 py-1.5 sm:px-4">
                          <button type="button" onClick={() => changeSort(key)}
                            className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm border-0 bg-transparent px-1 text-xs font-semibold hover:text-[#02665e] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#02665e] ${active ? "text-[#02665e]" : "text-slate-600"}`}>
                            {label}<Indicator className={`size-3.5 shrink-0 ${active ? "" : "text-slate-400"}`} aria-hidden />
                          </button>
                        </th>
                      );
                    })}
                    <th scope="col" className="sticky right-0 bg-slate-50 px-3 py-2.5 text-right font-semibold sm:px-4">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => {
                    const status = statusOf(item);
                    const title = item.home.title || "Long-stay home";
                    const rowDate = item[dateColumn.field];
                    return (
                      <tr key={item.ref} className="group border-0 border-t border-solid border-slate-100 hover:bg-slate-50/70">
                        <th scope="row" className="px-3 py-2.5 sm:px-4">
                          <span className="block font-semibold text-slate-950">{title}</span>
                          {item.home.area ? <span className="block text-xs font-normal text-slate-600">{item.home.area}</span> : null}
                        </th>
                        <td className="px-3 py-2.5 text-slate-700 sm:px-4">{item.landlord.name || "—"}</td>
                        <td className="px-3 py-2.5 text-slate-700 sm:px-4">
                          {item.partner ? <><span className="block font-medium">{item.partner.name || "Assigned partner"}</span><span className="block text-xs text-slate-600">{item.partner.code}</span></> : "—"}
                        </td>
                        <td className="px-3 py-2.5 sm:px-4">
                          <span className={`inline-flex whitespace-nowrap rounded-sm px-2 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                          {item.status === "ASSIGNED" && item.dueBy ? <time dateTime={item.dueBy} className="mt-0.5 block whitespace-nowrap text-xs text-slate-600">Due {eat(item.dueBy)}</time> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-700 sm:px-4">
                          {rowDate ? <time dateTime={rowDate}>{rowDate.length === 10 ? day(rowDate) : eat(rowDate)}</time> : "—"}
                        </td>
                        <td className="sticky right-0 bg-white px-3 py-2.5 text-right group-hover:bg-slate-50 sm:px-4">
                          <button type="button" aria-label={`View inspection for ${title}`} onClick={() => setSelected(item)}
                            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-[#c5ded6] bg-white px-2.5 text-xs font-semibold text-[#02665e] hover:bg-[#eef7f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e]">
                            <Eye className="size-3.5" aria-hidden />View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination {...data.pagination} disabled={loading} onPageChange={setPage} />
          </section>
        ) : null}
      </div>
      {selected ? <InspectionDialog key={selected.ref} row={selected} onClose={() => setSelected(null)} onChanged={load} /> : null}
    </div>
  );
}

function InspectionDialog({ row, onClose, onChanged }: { row: QueueRow; onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const reload = () => { setDetail(null); setError(""); setVersion((value) => value + 1); };
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void apiClient.get<Detail>(`/api/admin/long-stay/inspections/${encodeURIComponent(row.ref)}`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setDetail(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure?.response?.data?.error || "Could not load inspection details."); });
    return () => controller.abort();
  }, [row.ref, version]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="inspection-dialog-title"
      className="fixed inset-0 m-auto max-h-[88dvh] w-[calc(100%_-_1.5rem)] max-w-[72rem] overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/45">
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 bg-white px-4 py-2.5">
          <h2 id="inspection-dialog-title" className="m-0 text-base font-semibold">Inspection details</h2>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close inspection details"
            className="grid size-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><X className="size-4" aria-hidden /></button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-color:#86a89f_#edf3f1] [scrollbar-gutter:stable]">
          {detail ? <InspectionCard item={detail.item} checklist={detail.checklist} onChanged={() => { reload(); onChanged(); }} /> : error ? (
            <div className="p-4"><p role="alert" className="m-0 text-sm text-red-700">{error}</p><button type="button" onClick={reload} className="mt-2 min-h-8 cursor-pointer rounded-md border border-solid border-slate-200 bg-white px-2.5 text-sm font-semibold text-[#02665e] hover:bg-slate-50">Try again</button></div>
          ) : <p role="status" className="m-0 p-4 text-sm text-slate-600">Loading inspection details</p>}
        </div>
      </div>
    </dialog>
  );
}

function InspectionCard({ item, checklist, onChanged }: { item: Item; checklist: InspectionCheck[]; onChanged: () => void }) {
  const [partnerCode, setPartnerCode] = useState(item.partner?.code ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const post = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    setError("");
    try {
      await apiClient.post(`/api/admin/long-stay/inspections/${encodeURIComponent(item.ref)}/${path}`, body);
      onChanged();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const r = item.report;
  const status = statusOf(item);
  const canReview = item.status === "SUBMITTED" && Boolean(r);
  const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]";

  return (
    <article className="bg-white">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><MapPin className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] font-bold text-slate-900">{item.home.title || "Long-stay home"}</p>
          <p className="m-0 mt-0.5 text-[13px] text-slate-500">
            {item.home.area}{!item.home.hasPin ? " · no map pin" : ""} · {item.reason === "AFTER_DISPUTE" ? "after an upheld complaint" : item.reason === "YEARLY" ? "yearly check" : "first inspection"}
          </p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-slate-600">
            <span>Landlord: {item.landlord.name || "-"}</span>
            {item.landlord.phone ? <a href={`tel:${item.landlord.phone}`} className="inline-flex items-center gap-1 text-[#02665e] no-underline"><Phone className="h-3.5 w-3.5" />{item.landlord.phone}</a> : null}
            {item.partner ? <span className="inline-flex items-center gap-1"><UserRoundCheck className="h-3.5 w-3.5 text-slate-400" />{item.partner.name || "Partner"} ({item.partner.code})</span> : null}
          </p>
        </div>
        <div className="text-right text-[12px]">
          <span className={`inline-flex rounded-sm px-2 py-1 font-semibold ${status.tone}`}>{status.label}</span>
          {status.date ? <p className="m-0 mt-1 text-slate-600">{status.dateLabel} {status.date.length === 10 ? day(status.date) : eat(status.date)}</p> : null}
          {item.feeAmount ? <p className="m-0 mt-1 text-slate-500">Partner fee TZS {item.feeAmount.toLocaleString("en-US")}</p> : null}
        </div>
      </div>

      {(item.status === "REQUESTED" || item.status === "ASSIGNED") ? (
        <div className="flex flex-wrap items-end gap-2 border-0 border-t border-solid border-slate-100 px-4 py-3">
          <label className="block text-xs font-semibold text-slate-700">{item.partner ? "Give it to another partner" : "Sales Partner code"}
            <input value={partnerCode} onChange={(e) => setPartnerCode(e.target.value.toUpperCase())} placeholder="NSA-DAR-0042" maxLength={30}
              className="mt-1 block h-9 w-48 rounded-md border border-solid border-slate-300 px-2.5 font-mono text-sm outline-none focus:border-[#02665e]" />
          </label>
          <button type="button" disabled={partnerCode.trim().length < 3 || partnerCode.trim() === item.partner?.code || busy === "assign"} onClick={() => post("assign", "assign", { partnerCode: partnerCode.trim() })} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
            {busy === "assign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}{item.partner ? "Reassign and notify" : "Invite partner"}
          </button>
          <p className="m-0 w-full text-[12px] text-slate-500">The invitation appears in Sales Notifications. The partner has 5 days to visit and submit a report.</p>
        </div>
      ) : null}

      {r && (
        <InspectionReportReview key={r.submittedAt ?? item.ref} inspectionRef={item.ref} report={r} checklist={checklist} pin={item.pin ?? null}
          busy={busy !== null} error={error} onDecision={canReview ? (decision, note) => post(decision, "review", { decision, note }) : undefined} />
      )}

      {!canReview && item.reviewNote ? (
        <p className="m-0 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-600">NoLSAF: {item.reviewNote} · {eat(item.reviewedAt)}</p>
      ) : null}
      {error && !canReview ? <p role="alert" className="m-0 px-4 pb-3 text-xs text-red-700">{error}</p> : null}
    </article>
  );
}
