"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Pencil, Printer, ReceiptText } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import { buildPdfDocument } from "@/lib/pdfReportTemplate";
import { escapeHtml } from "@/utils/html";

type Statement = {
  month: string;
  period: { from: string; to: string };
  partner: { agentCode: string; name: string | null; email: string | null; region: string | null; taxIdNumber: string | null };
  currency: string;
  summary: {
    earned: number; earnedCount: number; reversed: number; reversedCount: number; netEarned: number;
    payoutsCount: number; grossPaid: number; deductions: number; withholdingTax: number; netReceived: number;
  };
  earnings: Array<{ id: number; earnedAt: string | null; property: string; stream: string; eligibleRevenue: number; rate: number; amount: number; status: string }>;
  reversals: Array<{ id: number; reversedAt: string | null; property: string; stream: string; amount: number }>;
  payouts: Array<{ id: number; reference: string; paidAt: string | null; approved: number; deduction: number; withholdingTaxRate: number | null; withholdingTax: number; net: number; destination: string }>;
};

const money = (value: number, currency = "TZS") =>
  `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};
const day = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-";

export default function SalesStatementsPage() {
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [whtRate, setWhtRate] = useState(0);
  const [tin, setTin] = useState<string | null>(null);
  const [tinDraft, setTinDraft] = useState("");
  const [editingTin, setEditingTin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get("/api/sales/statements");
        const list: string[] = res.data?.months || [];
        setMonths(list);
        setMonth(list[0] || "");
        setWhtRate(Number(res.data?.withholdingTaxRate || 0));
        setTin(res.data?.taxIdNumber || null);
      } catch (cause: any) {
        setError(cause?.response?.data?.error || "Could not load your statements.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadMonth = useCallback(async (value: string) => {
    if (!value) return;
    setLoadingMonth(true);
    setError("");
    try {
      const res = await apiClient.get(`/api/sales/statements/${value}`);
      setStatement(res.data?.statement || null);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load this statement.");
      setStatement(null);
    } finally {
      setLoadingMonth(false);
    }
  }, []);

  useEffect(() => { void loadMonth(month); }, [month, loadMonth]);

  const saveTin = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await apiClient.put("/api/sales/statements/tax-id", { taxIdNumber: tinDraft });
      setTin(res.data?.taxIdNumber || tinDraft);
      setEditingTin(false);
      setNotice("TIN saved. It will appear on your statements.");
      void loadMonth(month);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save your TIN.");
    } finally {
      setBusy(false);
    }
  };

  // Same flow every NoLSAF statement uses: seal the headline figures (which
  // records the print and fails closed), encode the public verify link as a
  // QR, then render on the shared A4 report template and print.
  const printStatement = async () => {
    if (!statement) return;
    setPrinting(true);
    setError("");
    const w = window.open("", "_blank");
    if (!w) {
      setPrinting(false);
      setError("Allow pop-ups for this site to print your statement.");
      return;
    }
    w.document.write("<p style=\"font-family:Arial;padding:24px;color:#073c35\">Preparing your statement…</p>");
    try {
      const s = statement;
      const cur = s.currency;
      let reportId = `SST-${s.partner.agentCode}-${s.month.replace("-", "")}`;
      let qrUrl = "";
      const sealRes = await fetch("/api/reports/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "SALES_STATEMENT",
          title: "Sales Partner Monthly Statement",
          ref: reportId,
          from: s.period.from.slice(0, 10),
          to: s.period.to.slice(0, 10),
          figures: [
            { label: "Partner", value: s.partner.agentCode },
            { label: "Month", value: monthLabel(s.month) },
            { label: `Earned (${cur})`, value: money(s.summary.earned, cur) },
            { label: `Reversed (${cur})`, value: money(s.summary.reversed, cur) },
            { label: `Gross paid out (${cur})`, value: money(s.summary.grossPaid, cur) },
            { label: `Withholding tax (${cur})`, value: money(s.summary.withholdingTax, cur) },
            { label: `Net received (${cur})`, value: money(s.summary.netReceived, cur) },
          ],
        }),
      });
      const sealJson: any = await sealRes.json().catch(() => ({}));
      if (!sealRes.ok || !sealJson?.token) {
        throw new Error(sealJson?.error || "The statement could not be sealed, so it was not printed.");
      }
      reportId = String(sealJson.ref || reportId);
      const verifyUrl = `${window.location.origin}/verify?t=${encodeURIComponent(String(sealJson.token))}`;
      try {
        const QR: any = await import("qrcode");
        const toDataURL: any = QR?.toDataURL ?? QR?.default?.toDataURL;
        if (typeof toDataURL === "function") qrUrl = await toDataURL(verifyUrl, { margin: 1, width: 200, errorCorrectionLevel: "M" });
      } catch { qrUrl = ""; }
      let barcodeUrl = "";
      try {
        const JsBarcode: any = await import("jsbarcode");
        const render: any = JsBarcode?.default ?? JsBarcode;
        if (typeof render === "function") {
          const canvas = document.createElement("canvas");
          render(canvas, reportId, { format: "CODE128", width: 1.5, height: 36, displayValue: false, margin: 0 });
          barcodeUrl = canvas.toDataURL("image/png");
        }
      } catch { barcodeUrl = ""; }

      const generated = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const period = monthLabel(s.month);
      const e = escapeHtml;
      const earningRows = s.earnings.map((r) => `<tr><td>${e(day(r.earnedAt))}</td><td>${e(r.property)}</td><td>${e(r.stream)}</td><td class="num">${e(money(r.eligibleRevenue, cur))}</td><td class="num">${e(`${r.rate}%`)}</td><td class="num">${e(money(r.amount, cur))}</td></tr>`).join("");
      const reversalRows = s.reversals.map((r) => `<tr><td>${e(day(r.reversedAt))}</td><td>${e(r.property)}</td><td>${e(r.stream)}</td><td class="num">-${e(money(r.amount, cur))}</td></tr>`).join("");
      const payoutRows = s.payouts.map((r) => `<tr><td>${e(day(r.paidAt))}</td><td>${e(r.reference)}</td><td>${e(r.destination)}</td><td class="num">${e(money(r.approved, cur))}</td><td class="num">${e(money(r.deduction, cur))}</td><td class="num">${e(money(r.withholdingTax, cur))}${r.withholdingTaxRate ? ` <span class="muted">(${e(String(r.withholdingTaxRate))}%)</span>` : ""}</td><td class="num">${e(money(r.net, cur))}</td></tr>`).join("");

      const body = `
        <header class="pdf-cover">
          <div class="pdf-cover-top">
            <div class="pdf-mark">
              <span class="pdf-logo">N</span>
              <div class="pdf-mark-copy">
                <p class="pdf-kicker">NoLSAF sales partner</p>
                <h1>Monthly statement</h1>
                <p class="pdf-property">${e(s.partner.name || s.partner.agentCode)}</p>
                ${barcodeUrl ? `<div class="pdf-header-barcode"><div class="pdf-barcode-heading"><span class="pdf-barcode-label">Statement reference</span><span class="pdf-report-number">${e(reportId)}</span></div><img class="pdf-barcode" src="${e(barcodeUrl)}" alt="Statement reference barcode" /></div>` : ""}
              </div>
            </div>
            <div class="pdf-report-meta">
              <div><span>Statement period</span><strong>${e(period)}</strong></div>
              <div><span>Generated</span><strong>${e(generated)}</strong></div>
              <div><span>Agent code</span><strong>${e(s.partner.agentCode)}</strong></div>
              <div><span>TIN</span><strong>${e(s.partner.taxIdNumber || "Not provided")}</strong></div>
              <div><span>Currency</span><strong>${e(cur)}</strong></div>
              <div><span>Classification</span><strong>Partner use</strong></div>
            </div>
          </div>
          <div class="pdf-scope">
            <div><span>Partner</span><strong>${e([s.partner.name, s.partner.email].filter(Boolean).join(" · ") || s.partner.agentCode)}</strong></div>
            <div><span>Region</span><strong>${e(s.partner.region || "Not recorded")}</strong></div>
            <div><span>Issued by</span><strong>NoLS Africa Co Ltd</strong></div>
          </div>
        </header>

        <div class="pdf-summary">
          <div class="pdf-metric pdf-metric-green"><p>Earned this month</p><strong>${e(money(s.summary.earned, cur))}</strong><small>${s.summary.earnedCount} commission ${s.summary.earnedCount === 1 ? "entry" : "entries"}</small></div>
          <div class="pdf-metric pdf-metric-amber"><p>Reversed</p><strong>${e(money(s.summary.reversed, cur))}</strong><small>${s.summary.reversedCount} reversal${s.summary.reversedCount === 1 ? "" : "s"} in the month</small></div>
          <div class="pdf-metric"><p>Withholding tax</p><strong>${e(money(s.summary.withholdingTax, cur))}</strong><small>Withheld from payouts, remitted to TRA</small></div>
          <div class="pdf-metric pdf-metric-green"><p>Net received</p><strong>${e(money(s.summary.netReceived, cur))}</strong><small>${s.summary.payoutsCount} payout${s.summary.payoutsCount === 1 ? "" : "s"} paid in the month</small></div>
        </div>

        <section class="pdf-section">
          <div class="pdf-section-title"><span>01</span><div><h2>Earnings</h2><p>Commission recorded in ${e(period)}, by property and stream.</p></div></div>
          <div class="pdf-table-wrap"><table class="pdf-table">
            <colgroup><col style="width:14%" /><col style="width:26%" /><col style="width:18%" /><col style="width:16%" /><col style="width:10%" /><col style="width:16%" /></colgroup>
            <thead><tr><th>Date</th><th>Property</th><th>Stream</th><th>Eligible revenue</th><th>Rate</th><th>Commission</th></tr></thead>
            <tbody>${earningRows || '<tr><td class="pdf-empty" colspan="6">No commission recorded in this month.</td></tr>'}</tbody>
          </table></div>
          ${reversalRows ? `<div class="pdf-table-wrap" style="margin-top:8px"><table class="pdf-table"><thead><tr><th>Reversed on</th><th>Property</th><th>Stream</th><th>Amount</th></tr></thead><tbody>${reversalRows}</tbody></table></div>` : ""}
        </section>

        <section class="pdf-section">
          <div class="pdf-section-title"><span>02</span><div><h2>Payouts and withholding tax</h2><p>Payouts paid in ${e(period)}: gross, recoveries, tax withheld and what reached you.</p></div></div>
          <div class="pdf-table-wrap"><table class="pdf-table">
            <colgroup><col style="width:12%" /><col style="width:18%" /><col style="width:18%" /><col style="width:13%" /><col style="width:12%" /><col style="width:14%" /><col style="width:13%" /></colgroup>
            <thead><tr><th>Paid</th><th>Reference</th><th>Destination</th><th>Gross</th><th>Deductions</th><th>Withholding tax</th><th>Net paid</th></tr></thead>
            <tbody>${payoutRows || '<tr><td class="pdf-empty" colspan="7">No payouts paid in this month.</td></tr>'}</tbody>
          </table></div>
          <p class="pdf-note">Withholding tax is deducted at payout approval and remitted to the Tanzania Revenue Authority under your TIN${s.partner.taxIdNumber ? ` ${e(s.partner.taxIdNumber)}` : ""}. Keep this statement as evidence of tax withheld on your commission income.</p>
        </section>

        <section class="pdf-certification">
          <div class="pdf-certification-head"><p>Verification</p><h2>Statement certification</h2></div>
          <div class="pdf-certification-body">
            <div class="pdf-disclaimer-row">
              <div class="pdf-disclaimer"><h3>About this document</h3>This is a system-generated monthly statement produced by NoLSAF. It is sealed when generated and can be verified independently by scanning the code alongside, which resolves to a NoLSAF page showing the figures as issued. A copy whose figures differ from that page has been altered and should not be relied upon.</div>
              ${qrUrl ? `<div class="pdf-verification-card"><img class="pdf-qr" src="${e(qrUrl)}" alt="Scan to verify this statement" /><strong>Scan to verify</strong><p>Confirms this statement against NoLSAF records.</p><p class="pdf-verification-ref">${e(reportId)}</p></div>` : ""}
            </div>
            <div class="pdf-cert-grid">
              <div class="pdf-cert-card"><span>Statement reference</span><strong>${e(reportId)}</strong></div>
              <div class="pdf-cert-card"><span>Period</span><strong>${e(period)}</strong></div>
              <div class="pdf-cert-card"><span>Generated</span><strong>${e(generated)}</strong></div>
              <div class="pdf-cert-card"><span>Agent code</span><strong>${e(s.partner.agentCode)}</strong></div>
            </div>
            <div class="pdf-footer"><span>${e(reportId)}</span><span>NoLSAF sales partner statement</span><span>Generated ${e(generated)}</span></div>
          </div>
        </section>`;

      const html = buildPdfDocument({ title: `Sales statement ${reportId}`, rootId: "sales-statement-root", rootClass: "sales-statement-pdf", bodyHtml: body });
      w.document.open();
      w.document.write(html);
      w.document.close();
      setTimeout(() => { w.focus(); w.print(); }, 300);
    } catch (cause: any) {
      w.close();
      setError(cause?.message || "Could not prepare the statement.");
    } finally {
      setPrinting(false);
    }
  };

  const s = statement;
  const card = "rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)]";

  return (
    <SalesShell>
      <div className="space-y-4">
        <SalesPageHeader
          icon={FileText}
          title="Statements"
          description="Your monthly record of commission earned, payouts received and tax withheld. Print a sealed copy for your records or for TRA."
        />

        {error ? <p className="m-0 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null}
        {notice ? <p className="m-0 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden />{notice}</p> : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
          <article className={`${card} p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                Statement for
                <select
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  disabled={loading || !months.length}
                  className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void printStatement()}
                disabled={!s || printing || loadingMonth}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#087f68] px-4 text-sm font-semibold text-white transition hover:bg-[#066b59] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {printing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
                {printing ? "Sealing" : "Print statement"}
              </button>
            </div>

            {loading || loadingMonth ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
              </div>
            ) : s ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Earned", value: money(s.summary.earned, s.currency), note: `${s.summary.earnedCount} ${s.summary.earnedCount === 1 ? "entry" : "entries"}` },
                  { label: "Reversed", value: money(s.summary.reversed, s.currency), note: `${s.summary.reversedCount} reversal${s.summary.reversedCount === 1 ? "" : "s"}` },
                  { label: "Tax withheld", value: money(s.summary.withholdingTax, s.currency), note: "From payouts" },
                  { label: "Net received", value: money(s.summary.netReceived, s.currency), note: `${s.summary.payoutsCount} payout${s.summary.payoutsCount === 1 ? "" : "s"}` },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-xl bg-slate-50 p-3.5">
                    <p className="m-0 text-xs font-medium text-slate-500">{tile.label}</p>
                    <p className="m-0 mt-1 truncate text-lg font-bold tabular-nums text-slate-900">{tile.value}</p>
                    <p className="m-0 mt-0.5 text-xs text-slate-400">{tile.note}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </article>

          <article className={`${card} p-5`}>
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ReceiptText className="h-4 w-4 text-emerald-700" aria-hidden />
              Tax details
            </p>
            {editingTin || !tin ? (
              <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void saveTin(); }}>
                <label className="block text-xs font-medium text-slate-600">
                  TRA Taxpayer Identification Number (TIN)
                  <input
                    value={tinDraft}
                    onChange={(event) => setTinDraft(event.target.value)}
                    inputMode="numeric"
                    placeholder="123-456-789"
                    className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button type="submit" disabled={busy || !tinDraft.trim()} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#087f68] px-3.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}Save TIN
                  </button>
                  {tin ? <button type="button" onClick={() => setEditingTin(false)} className="min-h-9 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button> : null}
                </div>
              </form>
            ) : (
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-xs text-slate-500">TIN</p>
                  <p className="m-0 font-mono text-sm font-semibold text-slate-900">{tin}</p>
                </div>
                <button type="button" onClick={() => { setTinDraft(tin); setEditingTin(true); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-emerald-300">
                  <Pencil className="h-3.5 w-3.5" aria-hidden />Change
                </button>
              </div>
            )}
            <p className="m-0 mt-4 border-0 border-t border-solid border-slate-100 pt-3 text-xs leading-5 text-slate-500">
              {whtRate > 0
                ? `Withholding tax of ${whtRate}% is deducted from each payout at approval and remitted to TRA. Your statements show every amount withheld.`
                : "Withholding tax is not currently deducted from payouts. If NoLSAF starts withholding, it will show on each payout and on your statements."}
            </p>
          </article>
        </section>

        {s && !loadingMonth ? (
          <section className={`${card} overflow-hidden`}>
            <div className="px-5 pt-5"><h2 className="m-0 text-base font-semibold text-slate-900">Payouts in {monthLabel(s.month)}</h2></div>
            {s.payouts.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr><th className="px-5 py-2.5 font-medium">Paid</th><th className="px-3 py-2.5 font-medium">Reference</th><th className="px-3 py-2.5 text-right font-medium">Gross</th><th className="px-3 py-2.5 text-right font-medium">Deductions</th><th className="px-3 py-2.5 text-right font-medium">Tax withheld</th><th className="px-5 py-2.5 text-right font-medium">Net paid</th></tr>
                  </thead>
                  <tbody>
                    {s.payouts.map((p) => (
                      <tr key={p.id} className="border-0 border-t border-solid border-slate-100">
                        <td className="px-5 py-3 text-slate-700">{day(p.paidAt)}</td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-600">{p.reference}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">{money(p.approved, s.currency)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">{money(p.deduction, s.currency)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">{money(p.withholdingTax, s.currency)}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900">{money(p.net, s.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="m-0 px-5 pb-5 pt-2 text-sm text-slate-500">No payouts were paid in this month.</p>
            )}
          </section>
        ) : null}
      </div>
    </SalesShell>
  );
}
