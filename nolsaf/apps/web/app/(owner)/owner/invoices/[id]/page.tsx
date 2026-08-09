"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, Send, CheckCircle2, Download, Clock, Loader2, User, Building2, Phone, Mail, MapPin } from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function InvoiceView() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const [inv, setInv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeDisbursement, setAgreeDisbursement] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (!idParam) {
      setInv(null);
      setErr("Missing invoice id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr(null);
    setInv(null);

    api
      .get(`/api/owner/invoices/${idParam}`)
      .then((r) => {
        if (!mounted) return;
        setInv(r.data);
      })
      .catch((e: any) => {
        if (!mounted) return;
        const status = Number(e?.response?.status ?? 0);
        if (status === 404) {
          setErr("Invoice not found (or you don’t have access to it).");
        } else {
          setErr(String(e?.response?.data?.error || e?.message || "Failed to load invoice"));
        }
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [idParam]);

  const submit = async () => {
    if (!idParam) {
      setErr("Missing invoice id.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    setSuccessMsg(null);
    try {
      const r = await api.post(`/api/owner/invoices/${idParam}/submit`);
      const alreadySubmitted = Boolean((r as any)?.data?.alreadySubmitted);
      const nextStatus = String((r as any)?.data?.status ?? "REQUESTED");
      const msg = alreadySubmitted
        ? "This invoice was already submitted. No further action is required — you can track updates in My Revenues."
        : "Invoice submitted successfully. Payout processing typically takes 30 minutes to 3 business days. You can track updates (Requested → Verified → Approved → Processing → Paid/Rejected) in My Revenues. If any additional details are needed, NoLSAF will notify you.";
      setSuccessMsg(msg);

      // Ensure UI hides the submit panel immediately after submit (no refresh needed)
      setInv((prev: any) => ({ ...(prev ?? {}), status: nextStatus }));
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Could not submit invoice";
      setErr(String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="relative mb-6">
          <span className="absolute inset-0 rounded-full bg-slate-400/20 animate-ping" />
          <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Invoice</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">Loading invoice details…</p>
      </div>
    );
  }

  if (err && !inv) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-red-50 border border-red-200 mx-auto">
          <FileText className="h-6 w-6 text-red-400" aria-hidden />
        </div>
        <h1 className="text-2xl font-black text-slate-900">Unable to open invoice</h1>
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{err}</p>
        <p className="text-xs text-slate-500">If you believe this is incorrect, confirm you are logged in as the correct Owner account.</p>
        <Link href="/owner/revenue/requested" className="no-underline inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Revenue
        </Link>
      </div>
    );
  }

  if (!inv) return null;

  const invNumber = String(inv?.invoiceNumber ?? "");
  const hasReceipt = Boolean(inv?.receiptNumber) || String(inv?.status ?? "").toUpperCase() === "PAID";
  const subtotal = (() => {
    const s = Number(inv?.subtotal);
    if (Number.isFinite(s) && s > 0) return s;
    const t = Number(inv?.total);
    return Number.isFinite(t) ? t : 0;
  })();
  const taxAmount = (() => {
    const t = Number(inv?.taxAmount);
    return Number.isFinite(t) ? t : 0;
  })();
  const taxPercent = (() => {
    const p = Number(inv?.taxPercent);
    return Number.isFinite(p) ? p : 0;
  })();

  const downloadInvoicePDF = async () => {
    const container = document.getElementById("owner-invoice-pdf");
    if (!container) throw new Error("Missing invoice container");

    const html2pdfModule: any = await import("html2pdf.js");
    const h2p = html2pdfModule?.default || html2pdfModule;
    if (!h2p) throw new Error("html2pdf load failed");

    const filename = `${String(invNumber || `invoice-${String(inv?.id ?? "")}`).replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;
    await h2p()
      .from(container)
      .set({
        filename,
        margin: 10,
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        html2canvas: { scale: Math.max(1, window.devicePixelRatio || 1) },
      })
      .save();
  };

  const downloadReceiptPDF = async () => {
    const html2pdfModule: any = await import("html2pdf.js");
    const h2p = html2pdfModule?.default || html2pdfModule;
    if (!h2p) throw new Error("html2pdf load failed");

    const receiptUrl = `${window.location.origin}/owner/revenue/receipts/${inv.id}`;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.src = receiptUrl;

    const waitForLoad = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Receipt preview timed out")), 20000);
      iframe.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      iframe.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Failed to load receipt preview"));
      };
    });

    document.body.appendChild(iframe);
    try {
      await waitForLoad;

      const start = Date.now();
      while (Date.now() - start < 20000) {
        const doc = iframe.contentDocument;
        const root = doc?.getElementById("receipt-root");
        if (root?.getAttribute("data-receipt-ready") === "true") break;
        await new Promise((r) => setTimeout(r, 150));
      }

      // Give images/fonts a moment to finish painting.
      await new Promise((r) => setTimeout(r, 500));

      // Wait for QR code to render (generated async via useEffect)
      const receiptDoc = iframe.contentDocument;
      const qrStart = Date.now();
      while (Date.now() - qrStart < 8000) {
        const qrImg = receiptDoc?.querySelector('.qr-box img, [alt="Receipt QR"]') as HTMLImageElement | null;
        if (qrImg?.src && qrImg.complete && qrImg.naturalWidth > 0) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      // Extra settle time after QR loads
      await new Promise((r) => setTimeout(r, 300));

      const receiptCard = receiptDoc?.getElementById("receipt-card") || receiptDoc?.body;
      if (!receiptCard) throw new Error("Receipt content not available");

      const receiptNumber = String(inv?.receiptNumber ?? "");
      const safeBase = receiptNumber || invNumber || `receipt-${String(inv?.id ?? "")}`;
      const filename = `${safeBase.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;

      await h2p()
        .from(receiptCard)
        .set({
          filename,
          margin: 0,
          image: { type: "jpeg", quality: 0.98 },
          jsPDF: { unit: "mm", format: [148, 210], orientation: "portrait" },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          pagebreak: { mode: ["avoid-all", "css", "legacy"] },
        })
        .save();
    } finally {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }
  };

  const downloadPDF = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      if (hasReceipt) {
        await downloadReceiptPDF();
      } else {
        await downloadInvoicePDF();
      }
    } catch (e: any) {
      console.error("PDF generation failed", e);
      window.alert("Unable to generate PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  const statusColors: Record<string, string> = {
    PAID: "bg-emerald-50 border-emerald-200 text-emerald-700",
    REQUESTED: "bg-amber-50 border-amber-200 text-amber-700",
    REJECTED: "bg-red-50 border-red-200 text-red-700",
    DRAFT: "bg-slate-100 border-slate-200 text-slate-600",
    PENDING: "bg-blue-50 border-blue-200 text-blue-700",
    VERIFIED: "bg-sky-50 border-sky-200 text-sky-700",
    APPROVED: "bg-violet-50 border-violet-200 text-violet-700",
    PROCESSING: "bg-orange-50 border-orange-200 text-orange-700",
  };
  const statusStyle = statusColors[String(inv.status ?? "").toUpperCase()] ?? "bg-slate-50 border-slate-200 text-slate-600";

  return (
    <div className="space-y-5 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">

      {/* ── Hero ── */}
      <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
        {/* Teal header band */}
        <div className="relative bg-gradient-to-r from-[#02665e] to-[#034e47] px-5 sm:px-6 lg:px-8 py-4 sm:py-5">
          {/* Dot pattern */}
          <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle, #fff 1.5px, transparent 1.5px)', backgroundSize: '18px 18px' }} />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <FileText className="h-4.5 w-4.5 text-white" aria-hidden />
              </div>
              <div>
                <div className="text-white/60 text-[10px] font-bold uppercase tracking-widest">Invoice</div>
                <div className="text-white text-sm font-bold">{inv.invoiceNumber}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={downloadPDF} disabled={pdfBusy} className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 hover:text-white active:scale-[0.97] transition-all disabled:opacity-60" aria-label={hasReceipt ? "Download receipt PDF" : "Download PDF"} title={hasReceipt ? "Download receipt PDF" : "Download PDF"}>
                <Download className="h-4 w-4" aria-hidden />
              </button>
              <Link href="/owner/revenue/requested" className="no-underline inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 hover:text-white active:scale-[0.97] transition-all" aria-label="Back" title="Back">
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>

        {/* White body */}
        <div className="bg-white px-5 sm:px-6 lg:px-8 py-5 sm:py-6">
          {/* Title + status */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">{inv.invoiceNumber}</h1>
              <p className="mt-0.5 text-sm text-slate-500 truncate">{inv.title}</p>
            </div>
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest flex-shrink-0 ${statusStyle}`}>{inv.status}</span>
          </div>

          {/* Stats grid */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {inv.total != null && (
              <div className="rounded-xl bg-[#02665e]/5 border border-[#02665e]/10 px-3.5 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Amount</div>
                <div className="mt-1 text-lg font-extrabold text-[#02665e]">{(() => { const n = Number(inv.total); return Number.isFinite(n) ? new Intl.NumberFormat("en-TZ", { style: "currency", currency: "TZS", maximumFractionDigits: 0 }).format(n) : "—"; })()}</div>
              </div>
            )}
            {inv.createdAt && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Issued</div>
                <div className="mt-1 text-sm font-bold text-slate-800">{new Date(inv.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
              </div>
            )}
            {inv.booking?.property?.title && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-3 col-span-2 sm:col-span-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Property</div>
                <div className="mt-1 text-sm font-bold text-slate-800 truncate">{inv.booking.property.title}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Invoice Details (PDF target) ── */}
      <div className="relative rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="owner-invoice-pdf">
        {/* Cross-hatch background for the entire card */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />

        {/* ── Sender / Receiver ── */}
        <div className="relative grid grid-cols-1 sm:grid-cols-2 bg-white/80">
          <div className="p-5 sm:p-6 sm:border-r border-b sm:border-b-0 border-slate-100/80">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#02665e]/60">From</span>
            </div>
            <div className="font-bold text-slate-900 text-base leading-snug">{inv.senderName}</div>
            {inv.senderPhone ? <div className="text-[13px] text-slate-500 mt-1.5 flex items-center gap-1.5"><Phone className="h-3 w-3 text-slate-400 flex-shrink-0" aria-hidden />{inv.senderPhone}</div> : null}
            {inv.senderAddress ? <div className="text-[13px] text-slate-500 mt-1 flex items-center gap-1.5"><MapPin className="h-3 w-3 text-slate-400 flex-shrink-0" aria-hidden />{inv.senderAddress}</div> : null}
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                <Building2 className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#02665e]/60">To</span>
            </div>
            <div className="font-bold text-slate-900 text-base leading-snug">{inv.receiverName || "NoLS Africa Co LTD"}</div>
            <a href={`mailto:${inv.receiverEmail || "payments@nolsaf.com"}`} className="no-underline text-[13px] text-slate-500 hover:text-[#02665e] mt-1.5 flex items-center gap-1.5">
              <Mail className="h-3 w-3 text-slate-400 flex-shrink-0" aria-hidden />
              {inv.receiverEmail || "payments@nolsaf.com"}
            </a>
            <div className="text-[13px] text-slate-500 mt-1 flex items-center gap-1.5"><MapPin className="h-3 w-3 text-slate-400 flex-shrink-0" aria-hidden />{inv.receiverAddress || "Dar es Salaam, Tanzania"}</div>
          </div>
        </div>

        {/* ── Perforated tear line ── */}
        <div className="relative h-5 bg-white/40 flex items-center">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 h-5 w-5 rounded-full bg-slate-100 border border-slate-200" />
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-5 w-5 rounded-full bg-slate-100 border border-slate-200" />
          <div className="w-full border-t-2 border-dashed border-slate-200/80" />
        </div>

        {/* ── Line items ── */}
        <div className="relative bg-white/60 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-[#02665e]/70 bg-[#02665e]/[0.04]">Description</th>
                <th className="px-5 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-[#02665e]/70 bg-[#02665e]/[0.04]">Qty</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-[#02665e]/70 bg-[#02665e]/[0.04]">Unit Price</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-[#02665e]/70 bg-[#02665e]/[0.04]">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it: any, idx: number) => (
                <tr key={it.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50'} border-b border-slate-100/60`}>
                  <td className="px-5 py-4">
                    <div className="font-semibold text-slate-800">{it.description}</div>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex items-center justify-center h-6 min-w-[1.75rem] px-2 rounded-full bg-[#02665e]/10 text-[11px] font-bold text-[#02665e]">{it.quantity}</span>
                  </td>
                  <td className="px-5 py-4 text-right text-slate-500 font-medium">TZS {Number(it.unitPrice).toLocaleString()}</td>
                  <td className="px-5 py-4 text-right font-bold text-slate-900">TZS {Number(it.amount).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Totals ── */}
        <div className="relative bg-white/70">
          <div className="px-5 sm:px-6 py-3 flex items-center justify-between gap-4 border-b border-slate-100/60">
            <span className="text-xs font-semibold text-slate-400">Subtotal</span>
            <span className="text-sm font-bold text-slate-600">TZS {Number(subtotal).toLocaleString()}</span>
          </div>
          {taxAmount > 0 ? (
            <div className="px-5 sm:px-6 py-3 flex items-center justify-between gap-4 border-b border-slate-100/60">
              <span className="text-xs font-semibold text-slate-400">Tax ({taxPercent}%)</span>
              <span className="text-sm font-bold text-slate-600">TZS {Number(taxAmount).toLocaleString()}</span>
            </div>
          ) : null}
        </div>

        {/* ── Total payout footer ── */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#02665e] via-[#034e47] to-[#023a35]" />
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)', backgroundSize: '16px 16px' }} />
          <div className="relative px-5 sm:px-6 py-5 sm:py-6 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Total Payout</div>
              <div className="text-[11px] text-white/40 mt-0.5">Amount to be released</div>
            </div>
            <div className="text-right">
              <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">TZS {Number(inv.total).toLocaleString()}</div>
              <span className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${inv.status === 'PAID' ? 'bg-emerald-400/20 text-emerald-200' : 'bg-white/15 text-white/70'}`}>{inv.status}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Error / Success ── */}
      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      ) : null}
      {successMsg ? (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 p-px shadow-lg shadow-emerald-200">
          <div className="rounded-[15px] bg-white px-6 py-5 space-y-4">
            {/* Top row */}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-200 flex-shrink-0">
                <CheckCircle2 className="h-5 w-5 text-white" aria-hidden />
              </div>
              <div>
                <div className="text-base font-bold text-gray-900">Payout request submitted</div>
                <div className="text-xs text-gray-400 mt-0.5">NoLSAF has been notified and will process your payout</div>
              </div>
            </div>
            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-emerald-100 via-teal-100 to-transparent" />
            {/* Timeline steps */}
            <div className="flex items-center gap-0 overflow-x-auto pb-1">
              {["Draft", "Requested", "Verified", "Approved", "Processing", "Paid"].map((step, i, arr) => (
                <div key={step} className="flex items-center gap-0 flex-shrink-0">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`h-2 w-2 rounded-full ${i === 0 ? "bg-gray-400" : i === 1 ? "bg-emerald-500 ring-4 ring-emerald-100" : "bg-gray-200"}`} />
                    <span className={`text-[10px] font-semibold whitespace-nowrap ${i === 0 ? "text-gray-400 line-through" : i === 1 ? "text-emerald-700" : "text-gray-400"}`}>{step}</span>
                  </div>
                  {i < arr.length - 1 && <div className={`w-8 sm:w-12 h-px mb-3 flex-shrink-0 mx-1 ${i === 0 ? "bg-gray-300" : "bg-gray-200"}`} />}
                </div>
              ))}
            </div>
            {/* Footer */}
            <div className="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-100 px-4 py-2.5">
              <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" aria-hidden />
              <span className="text-xs text-gray-500">Expected in <span className="font-semibold text-gray-700">30 minutes – 3 business days</span>. NoLSAF will notify you if anything is needed.</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Receipt (paid) ── */}
      {hasReceipt ? (
        <div className="relative rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Cross-hatch background */}
          <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />

          {/* Perforated top edge */}
          <div className="relative w-full" style={{ height: '5px', backgroundImage: 'radial-gradient(circle, #02665e 1.5px, transparent 1.5px)', backgroundSize: '10px 5px', backgroundRepeat: 'repeat-x', backgroundPosition: 'center' }} />

          {/* Header */}
          <div className="relative px-5 sm:px-6 pt-5 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-[#02665e]" aria-hidden />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[#02665e]/50">Payment Receipt</div>
                  <div className="text-sm font-extrabold text-slate-900">{inv.receiptNumber || '—'}</div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Paid</span>
              </span>
            </div>
          </div>

          {/* Tear line */}
          <div className="relative h-5 bg-white/40 flex items-center">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 h-5 w-5 rounded-full bg-slate-100 border border-slate-200" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-5 w-5 rounded-full bg-slate-100 border border-slate-200" />
            <div className="w-full border-t-2 border-dashed border-slate-200/80" />
          </div>

          {/* Body: details + QR */}
          <div className="relative px-5 sm:px-6 py-5 grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-5 items-center">
            {/* Left: detail rows */}
            <div className="space-y-3.5">
              {inv.receiptNumber ? (
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Receipt #</div>
                    <div className="text-sm font-bold font-mono tracking-wide text-slate-900 truncate">{inv.receiptNumber}</div>
                  </div>
                </div>
              ) : null}
              {inv.paymentRef ? (
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0">
                    <ArrowLeft className="h-3.5 w-3.5 text-slate-400 rotate-180" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Payment Ref</div>
                    <div className="text-sm font-bold font-mono text-slate-900 break-all">{inv.paymentRef}</div>
                  </div>
                </div>
              ) : null}
              {inv.paidAt ? (
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0">
                    <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Paid On</div>
                    <div className="text-sm font-bold text-slate-900">{new Date(inv.paidAt).toLocaleString("en-GB", { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right: QR code */}
            <div className="flex flex-col items-center gap-2.5 sm:pl-5 sm:border-l sm:border-dashed sm:border-slate-200">
              <div className="p-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/owner/revenue/invoices/${inv.id}/receipt/qr.png`} alt="Receipt QR" className="w-28 h-28 sm:w-32 sm:h-32 rounded-lg" />
              </div>
              <p className="text-[10px] font-semibold text-slate-400 tracking-wide">Scan to verify receipt</p>
            </div>
          </div>

          {/* Perforated bottom edge */}
          <div className="relative w-full" style={{ height: '5px', backgroundImage: 'radial-gradient(circle, #02665e 1.5px, transparent 1.5px)', backgroundSize: '10px 5px', backgroundRepeat: 'repeat-x', backgroundPosition: 'center' }} />
        </div>
      ) : null}

      {/* ── Process Timeline ── */}
      {(() => {
        const steps = [
          { key: 'issued', label: 'Issued', date: inv.issuedAt, color: '#0284c7', bg: 'rgba(2,132,199,0.08)' },
          { key: 'verified', label: 'Verified', date: inv.verifiedAt, color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
          { key: 'approved', label: 'Approved', date: inv.approvedAt, color: '#059669', bg: 'rgba(5,150,105,0.08)' },
          { key: 'paid', label: 'Paid', date: inv.paidAt, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
        ];
        const lastDoneIdx = steps.reduce((acc, s, i) => (s.date ? i : acc), -1);
        return (
          <div className="relative rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Cross-hatch bg */}
            <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%), repeating-linear-gradient(-45deg, #02665e 0, #02665e 1px, transparent 0, transparent 50%)', backgroundSize: '20px 20px' }} />

            <div className="relative bg-white/80 px-5 sm:px-6 py-5 sm:py-6">
              {/* Title row */}
              <div className="flex items-center gap-2 mb-5">
                <div className="h-7 w-7 rounded-lg bg-[#02665e]/10 flex items-center justify-center">
                  <Clock className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#02665e]/60">Process Timeline</span>
                <div className="flex-1" />
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${statusStyle}`}>{inv.status}</span>
              </div>

              {/* Connected stepper */}
              <div className="relative">
                {/* Connector line */}
                <div className="absolute top-4 left-4 right-4 h-0.5 bg-slate-100 hidden sm:block" />
                {lastDoneIdx >= 0 && (
                  <div className="absolute top-4 left-4 h-0.5 hidden sm:block" style={{ width: `${(lastDoneIdx / (steps.length - 1)) * 100}%`, maxWidth: 'calc(100% - 2rem)', background: 'linear-gradient(90deg, #0284c7, #d97706, #059669, #7c3aed)' }} />
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-0">
                  {steps.map((s, i) => {
                    const done = !!s.date;
                    const isCurrent = i === lastDoneIdx;
                    return (
                      <div key={s.key} className="relative flex flex-col items-center text-center">
                        {/* Node */}
                        <div className={`relative z-10 h-8 w-8 rounded-full flex items-center justify-center transition-all duration-300 ${done ? 'shadow-sm' : ''}`}
                          style={done ? { background: s.bg, border: `2px solid ${s.color}` } : { background: '#f8fafc', border: '2px solid #e2e8f0' }}>
                          {done ? (
                            <CheckCircle2 className="h-4 w-4" style={{ color: s.color }} />
                          ) : (
                            <div className="h-2 w-2 rounded-full bg-slate-300" />
                          )}
                          {isCurrent && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full animate-ping" style={{ background: s.color, opacity: 0.4 }} />}
                        </div>
                        {/* Label */}
                        <div className={`mt-2.5 text-[10px] font-bold uppercase tracking-widest ${done ? '' : 'text-slate-400'}`} style={done ? { color: s.color } : undefined}>{s.label}</div>
                        {/* Date */}
                        <div className={`mt-1 text-[11px] leading-snug font-semibold ${done ? 'text-slate-700' : 'text-slate-300'}`}>
                          {done ? new Date(s.date).toLocaleDateString("en-GB", { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </div>
                        {done && s.date && (
                          <div className="text-[10px] text-slate-400 font-medium">{new Date(s.date).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' })}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Submit / Status ── */}
      {inv.status === "DRAFT" ? (
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6">
          <div className="pointer-events-none select-none absolute right-4 bottom-0 text-[72px] font-black text-slate-800/60 leading-none tracking-tighter" aria-hidden>SUBMIT</div>
          <div className="relative">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Ready to submit?</div>
            <div className="text-sm text-slate-400 mb-4 max-w-sm">Send this invoice to NoLSAF for processing and payout. Typically takes 30 min to 3 business days.</div>
            <button
              type="button"
              onClick={() => { setConsentOpen(true); setAgreeTerms(false); setAgreeDisbursement(false); }}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" aria-hidden />
              {submitting ? "Submitting…" : "Send to NoLSAF"}
            </button>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-emerald-950 border border-emerald-900 p-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70 mb-1">Invoice Status</div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
            <div className="text-sm font-bold text-emerald-300">{inv.status}</div>
          </div>
        </div>
      )}

      {/* ── Consent modal ── */}
      {consentOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConsentOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 z-10 space-y-4 border border-slate-200">
            <div className="text-lg font-black text-slate-900">Before you submit</div>
            <p className="text-sm text-slate-600">Please confirm you agree to the Terms &amp; Conditions and the Disbursement Policy.</p>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/20" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                <span className="text-sm text-slate-700">I agree to the{" "}<a className="text-emerald-700 font-semibold underline underline-offset-2" href={process.env.NEXT_PUBLIC_TERMS_URL ?? "#"} target="_blank" rel="noreferrer">Terms &amp; Conditions</a>.</span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500/20" checked={agreeDisbursement} onChange={(e) => setAgreeDisbursement(e.target.checked)} />
                <span className="text-sm text-slate-700">I agree to the{" "}<a className="text-emerald-700 font-semibold underline underline-offset-2" href={(process.env.NEXT_PUBLIC_DISBURSEMENT_POLICY_URL ?? process.env.NEXT_PUBLIC_PAYOUT_POLICY_URL ?? "#")} target="_blank" rel="noreferrer">Disbursement Policy</a>.</span>
              </label>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setConsentOpen(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50 transition-all active:scale-[0.98]">Cancel</button>
              <button
                type="button"
                onClick={async () => { setConsentOpen(false); await submit(); }}
                disabled={!(agreeTerms && agreeDisbursement) || submitting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
              >
                {submitting ? "Submitting…" : "Agree & Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}


