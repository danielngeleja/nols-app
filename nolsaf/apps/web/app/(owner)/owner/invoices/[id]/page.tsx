"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Loader2, Mail, MapPin, Phone, Send, Check } from "lucide-react";
import { ClaimSteps, claimStepOf } from "@/components/owner-payouts/ClaimSteps";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function InvoiceView() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const router = useRouter();
  const [inv, setInv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
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
        if (/^\d+$/.test(String(idParam)) && r.data?.invoiceReference) {
          router.replace(`/owner/invoices/${encodeURIComponent(r.data.invoiceReference)}`);
        }
      })
      .catch((e: any) => {
        if (!mounted) return;
        const status = Number(e?.response?.status ?? 0);
        if (status === 404) {
          setErr("Invoice not found, or you do not have access to it.");
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
  }, [idParam, router]);

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
        ? "This invoice was already sent. Nothing more to do; follow it here or under Older claims."
        : "NoLSAF will verify and approve it, then send the money. This usually takes 30 minutes to 3 business days, and you will be notified at each step.";
      setSuccessMsg(msg);

      // Ensure UI hides the submit panel immediately after submit (no refresh needed)
      setInv((prev: any) => ({ ...(prev ?? {}), status: nextStatus }));
    } catch (e: any) {
      // Stays under the payout date lock are claimed with Withdraw on My Payouts.
      if (e?.response?.data?.code === "USE_WITHDRAW") {
        router.push("/owner/payouts");
        return;
      }
      const msg = e?.response?.data?.error || e?.message || "Could not submit invoice";
      setErr(String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  const shell = "w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6";
  const styles = `
    #owner-invoice, #owner-invoice * { box-sizing: border-box; }
    @keyframes ov-shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
    #owner-invoice .ov-sk { background: linear-gradient(90deg, #eef2f1 0%, #f8faf9 40%, #eef2f1 80%); background-size: 800px 100%; animation: ov-shimmer 1.3s linear infinite; }
    #owner-invoice .ov-sk-dark { background: linear-gradient(90deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,.14) 40%, rgba(255,255,255,.06) 80%); background-size: 800px 100%; animation: ov-shimmer 1.3s linear infinite; }
  `;

  if (loading) {
    return (
      <div id="owner-invoice" className={shell} aria-busy="true" aria-label="Loading invoice">
        <style>{styles}</style>
        <div className="rounded-3xl bg-[#012a26] px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="space-y-2.5">
            <div className="ov-sk-dark h-3 w-24 rounded-full" />
            <div className="ov-sk-dark h-8 w-64 rounded-lg" />
          </div>
          <div className="mt-6 grid grid-cols-5 gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="ov-sk-dark h-6 rounded-full" />)}</div>
        </div>
        <div className="ov-sk h-[360px] rounded-3xl" />
      </div>
    );
  }

  if (err && !inv) {
    return (
      <div id="owner-invoice" className={shell}>
        <style>{styles}</style>
        <div className="rounded-2xl border border-solid border-slate-300/80 bg-white p-7">
          <p className="m-0 text-lg font-bold text-slate-900">This invoice could not be opened</p>
          <p className="m-0 mt-1 text-sm text-slate-500">{err}</p>
          <Link href="/owner/payouts/older-claims" className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Older claims
          </Link>
        </div>
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

  // Both documents come from the server in the owner document family
  // (pdfDocuments.ts), so the download matches what NoLSAF issues everywhere:
  // the accommodation invoice while the claim is open, the payout receipt once paid.
  const downloadPDF = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const path = hasReceipt
        ? `/api/owner/revenue/invoices/${inv.id}/receipt.pdf`
        : `/api/owner/invoices/${encodeURIComponent(String(inv.invoiceReference ?? idParam))}/invoice.pdf`;
      const response = await api.get(path, { responseType: "blob" });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const base = hasReceipt ? String(inv?.receiptNumber || invNumber || "receipt") : String(invNumber || "invoice");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${base.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      console.error("PDF download failed", e);
      window.alert("The PDF could not be downloaded. Try again in a moment.");
    } finally {
      setPdfBusy(false);
    }
  };

  const status = String(inv.status ?? "").toUpperCase();
  const rejected = status === "REJECTED";
  const step = rejected ? 2 : claimStepOf(status);
  const fmtTzs = (n: any) => `TZS ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
  const fmtEat = (v?: string | null) =>
    v ? `${new Date(v).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} EAT` : "";

  // One sentence on where the claim is, and who acts next.
  const where: Record<string, { title: string; body: string }> = {
    DRAFT: { title: "Ready to send", body: "The invoice is created. Send it to NoLSAF to start the payout." },
    REQUESTED: { title: "Sent to NoLSAF", body: "NoLSAF is checking the stay against the check-in record. You will be notified when it moves." },
    VERIFIED: { title: "Verified", body: "The stay is confirmed. The payout is waiting for approval." },
    APPROVED: { title: "Approved", body: "The payout is approved and is being prepared for your payout account." },
    PROCESSING: { title: "Payment on its way", body: "The money is being sent to your payout account." },
    PAID: { title: "Paid", body: "The money has been sent. Your receipt is below." },
    REJECTED: { title: "Not approved", body: "NoLSAF did not approve this claim. Contact the NoLSAF team if you need the reason." },
  };
  const now = where[status] ?? { title: status, body: "" };

  return (
    <div id="owner-invoice" className={shell}>
      <style>{styles}</style>

      {/* ── Header band: invoice, status, and the five claim steps ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Invoice {inv.invoiceNumber}</p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">{now.title}</h1>
              <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">{now.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start">
              <button
                type="button"
                onClick={downloadPDF}
                disabled={pdfBusy}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                {hasReceipt ? "Receipt PDF" : "PDF"}
              </button>
              <Link
                href="/owner/payouts/older-claims"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white no-underline transition hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden /> Claims
              </Link>
            </div>
          </div>
          <ClaimSteps
            current={step}
            rejected={rejected}
            dates={[inv.issuedAt ?? inv.createdAt, null, inv.verifiedAt, inv.approvedAt, inv.paidAt]}
            className="mt-6"
          />
        </div>
      </header>

      {err ? <div className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</div> : null}

      {/* ── Step 2: send it, same agreement pattern as the check-in pass ── */}
      {status === "DRAFT" ? (
        <section className="rounded-2xl border border-solid border-[#02665e]/25 bg-white p-5 shadow-[0_12px_32px_-24px_rgba(1,42,38,0.5)] sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="m-0 text-base font-bold text-slate-900">Send this invoice to NoLSAF</p>
            <p className="m-0 text-sm font-bold tabular-nums text-[#02665e]">{fmtTzs(inv.total)}</p>
          </div>
          <p className="m-0 mt-1 text-sm text-slate-500">Payouts usually arrive between 30 minutes and 3 business days after you send it.</p>
          <label
            className={`mt-4 flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-inset transition ${
              agreeDisbursement ? "bg-[#02665e]/[0.06] ring-2 ring-[#02665e]" : "bg-white ring-1 ring-slate-300 hover:ring-[#02665e]/60"
            }`}
          >
            <input type="checkbox" checked={agreeDisbursement} onChange={(e) => setAgreeDisbursement(e.target.checked)} className="peer sr-only" />
            <span
              aria-hidden
              className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border-2 border-solid transition peer-focus-visible:ring-2 peer-focus-visible:ring-[#02665e]/40 peer-focus-visible:ring-offset-2 ${
                agreeDisbursement ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-400 bg-white text-transparent"
              }`}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
            </span>
            <span className="text-sm text-slate-700">
              I agree to the NoLSAF{" "}
              <a
                href={process.env.NEXT_PUBLIC_DISBURSEMENT_POLICY_URL ?? "/owner/property-owner-disbursement-policy"}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-semibold text-[#02665e] underline underline-offset-2"
              >
                Disbursement Policy
              </a>
            </span>
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={!agreeDisbursement || submitting}
            className="group mt-3 inline-flex h-12 w-full items-center justify-between gap-2 rounded-xl border border-solid border-[#012a26] bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white shadow-[0_14px_30px_-18px_rgba(1,42,38,0.9)] transition hover:bg-[#02665e] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
          >
            {submitting ? "Sending..." : "Send to NoLSAF"}
            <span className={`grid h-8 w-8 place-items-center rounded-lg transition group-hover:translate-x-0.5 ${agreeDisbursement ? "bg-[#5eead4] text-[#012a26]" : "bg-slate-200 text-slate-400"}`}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            </span>
          </button>
        </section>
      ) : null}

      {successMsg ? (
        <div className="flex items-start gap-3 rounded-2xl border border-solid border-emerald-200 bg-white p-4 sm:p-5" role="status">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-sm font-bold text-slate-900">Sent to NoLSAF</p>
            <p className="m-0 mt-0.5 text-xs leading-relaxed text-slate-600">{successMsg}</p>
          </div>
        </div>
      ) : null}

      {/* ── The invoice document (also the PDF source) ── */}
      <article id="owner-invoice-pdf" className="overflow-hidden rounded-3xl bg-white shadow-[0_30px_70px_-42px_rgba(1,42,38,0.6)] ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4 border-0 border-b border-solid border-slate-200 px-6 py-5">
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Accommodation invoice</p>
            <p className="m-0 mt-1 font-mono text-lg font-bold text-slate-900">{inv.invoiceNumber}</p>
            <p className="m-0 mt-0.5 truncate text-sm text-slate-500">{inv.title}</p>
          </div>
          <div className="text-right">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Issued</p>
            <p className="m-0 mt-0.5 text-sm font-semibold text-slate-800">
              {inv.issuedAt || inv.createdAt ? new Date(inv.issuedAt ?? inv.createdAt).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", year: "numeric" }) : ""}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 border-0 border-b border-solid border-slate-200 sm:grid-cols-2">
          <div className="px-6 py-4">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">From</p>
            <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{inv.senderName}</p>
            {inv.senderPhone ? <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-slate-500"><Phone className="h-3 w-3" aria-hidden />{inv.senderPhone}</p> : null}
            {inv.senderAddress ? <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="h-3 w-3" aria-hidden />{inv.senderAddress}</p> : null}
          </div>
          <div className="border-0 border-t border-solid border-slate-200 px-6 py-4 sm:border-l sm:border-t-0">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">To</p>
            <p className="m-0 mt-1 text-sm font-semibold text-slate-900">{inv.receiverName || "NoLS Africa Co LTD"}</p>
            <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-slate-500"><Mail className="h-3 w-3" aria-hidden />{inv.receiverEmail || "payments@nolsaf.com"}</p>
            <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="h-3 w-3" aria-hidden />{inv.receiverAddress || "Dar es Salaam, Tanzania"}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-0 border-b border-solid border-slate-200 bg-slate-50 text-left">
                <th className="px-6 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Description</th>
                <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Qty</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Unit price</th>
                <th className="px-6 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(inv.items ?? []).map((it: any) => (
                <tr key={it.id} className="border-0 border-b border-solid border-slate-100">
                  <td className="px-6 py-3.5 font-semibold text-slate-800">{it.description}</td>
                  <td className="px-4 py-3.5 text-center tabular-nums text-slate-600">{it.quantity}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-slate-500">{fmtTzs(it.unitPrice)}</td>
                  <td className="px-6 py-3.5 text-right font-bold tabular-nums text-slate-900">{fmtTzs(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-1.5 px-6 py-4">
          <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span className="tabular-nums">{fmtTzs(subtotal)}</span></div>
          {taxAmount > 0 ? <div className="flex justify-between text-sm text-slate-500"><span>Tax ({taxPercent}%)</span><span className="tabular-nums">{fmtTzs(taxAmount)}</span></div> : null}
        </div>

        <div className="flex items-center justify-between gap-4 bg-[#012a26] px-6 py-5 text-white">
          <div>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9fd8cc]">Total payout</p>
            <p className="m-0 mt-0.5 text-xs text-white/50">Amount to be released to you</p>
          </div>
          <p className="m-0 text-2xl font-bold tabular-nums sm:text-3xl">{fmtTzs(inv.total)}</p>
        </div>
      </article>

      {/* ── Receipt, once paid ── */}
      {hasReceipt ? (
        <article className="grid overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-3 p-6">
            <p className="m-0 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Payment receipt
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { k: "Receipt number", v: inv.receiptNumber, mono: true },
                { k: "Payment reference", v: inv.paymentRef, mono: true },
                { k: "Paid on", v: fmtEat(inv.paidAt) },
              ].filter((r) => r.v).map((r) => (
                <div key={r.k} className="rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-inset ring-slate-200">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{r.k}</p>
                  <p className={`m-0 mt-0.5 break-all text-sm font-semibold text-slate-900 ${r.mono ? "font-mono text-xs" : ""}`}>{r.v}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-center justify-center gap-2 border-0 border-t border-dashed border-slate-200 p-6 sm:border-l sm:border-t-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/owner/revenue/invoices/${inv.id}/receipt/qr.png`} alt="Receipt QR" className="h-28 w-28 rounded-lg ring-1 ring-slate-200" />
            <p className="m-0 text-[10px] font-semibold text-slate-400">Scan to verify the receipt</p>
          </div>
        </article>
      ) : null}
    </div>
  );
}