"use client";

import { Wallet, CreditCard, Eye, Smartphone, Search, X, Clock, CheckCircle, User, Building, Download, CheckSquare, Square, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown, ArrowRight, Landmark, ReceiptText, ShieldAlert } from "lucide-react";
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import apiClient from "@/lib/apiClient";
import Image from "next/image";
import Link from "next/link";
import { escapeAttr, escapeHtml } from "@/utils/html";

interface InvoicePayment {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  receiptNumber?: string | null;
  issuedAt?: string | null;
  bankName?: string | null;
  providerReference?: string | null;
  date: string;
  amount: number;
  currency: string;
  status: string;
  owner: {
    id: number;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  property: {
    id: number;
    title: string;
    type: string;
  } | null;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  accountNumber?: string | null;
  approvedBy?: {
    id: number;
    name: string | null;
  } | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  paymentEvent?: {
    provider: string;
    eventId: string;
    status: string;
    createdAt: string;
  } | null;
}

interface SummaryData {
  waiting: number;
  paid: number;
  booking: { waiting: number; paid: number };
  nrms: { waiting: number; paid: number };
  payouts: { open: number; paid: number };
  exceptions: { unmatched: number; variance: number; total: number };
}

const EMPTY_SUMMARY: SummaryData = {
  waiting: 0,
  paid: 0,
  booking: { waiting: 0, paid: 0 },
  nrms: { waiting: 0, paid: 0 },
  payouts: { open: 0, paid: 0 },
  exceptions: { unmatched: 0, variance: 0, total: 0 },
};

type PaymentSortKey = "date" | "owner" | "property" | "invoice" | "method" | "account" | "amount" | "status";

export default function Page() {
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'waiting' | 'paid'>('waiting');
  const [summary, setSummary] = useState<SummaryData>(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<PaymentSortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const pageSize = 30;

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<InvoicePayment | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [receiptDownloading, setReceiptDownloading] = useState(false);
  const receiptDownloadLock = useRef(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportNeedsVerification, setExportNeedsVerification] = useState(false);

  useEffect(() => {
    const onVerified = () => setExportNeedsVerification(false);
    window.addEventListener('finance-grant-granted', onVerified);
    return () => window.removeEventListener('finance-grant-granted', onVerified);
  }, []);

  const api = apiClient;

  const formatDateOnly = (isoOrDate: string | Date) => {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const formatTimeWithSeconds = (isoOrDate: string | Date) => {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mi}:${ss}`;
  };

  const formatCurrency = (amount: number, currency = 'TZS') => {
    try {
      return new Intl.NumberFormat('en-TZ', { 
        style: 'currency', 
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch (e) {
      return `${currency} ${amount.toLocaleString()}`;
    }
  };

  const formatPaymentTimestamp = (value?: string | null) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return "Not recorded";
    return `${new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Dar_es_Salaam', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(new Date(value))} EAT (UTC+3)`;
  };

  const formatPaymentMethod = (method?: string | null) => {
    if (!method) return 'Not specified';
    // Capitalize and format
    return method.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  };

  const generateReceiptPDF = async (payment: InvoicePayment) => {
    if (receiptDownloadLock.current) return;
    receiptDownloadLock.current = true;
    setReceiptDownloading(true);
    let receiptFrame: HTMLIFrameElement | null = null;
    try {
      const receiptNo = payment.receiptNumber || `RCPT-${payment.invoiceId}`;
      const suggested = `${receiptNo}.pdf`;

      const safeText = (v: unknown) => escapeHtml(v);
      const safeAttr = (v: unknown) => escapeAttr(v);
      
      // Get QR code image as data URL
      const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
      const qrImageUrl = `${origin}/api/admin/invoices/${payment.invoiceId}/receipt.png`;
      
      let qrDataUrl = qrImageUrl;
      try {
        const resp = await fetch(qrImageUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          const reader = new FileReader();
          qrDataUrl = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      } catch (e) {
        console.warn('Failed to convert QR to data URL, using image URL', e);
      }

      const formatDate = (dateStr?: string | null) => {
        if (!dateStr) return 'Not recorded';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      };

      const formatDateTime = (dateStr?: string | null) => {
        return formatPaymentTimestamp(dateStr);
      };

      const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Payment Receipt - ${safeText(receiptNo)}</title>
          <style>
            *, *::before, *::after { box-sizing: border-box; }
            @media print {
              @page {
                size: A5;
                margin: 20mm;
              }
              body { margin: 0; }
            }
            body {
              font-family: "Trebuchet MS", Trebuchet, Arial, sans-serif;
              font-size: 11px;
              line-height: 1.4;
              color: #18332f;
              background: #ffffff;
              margin: 0;
              padding: 0;
              -webkit-font-smoothing: antialiased;
              -moz-osx-font-smoothing: grayscale;
            }
            .sheet {
              position: relative;
              background: #ffffff;
              border: none;
              border-radius: 0;
              padding: 16px;
              max-width: 560px;
              margin: 0 auto;
              overflow: hidden;
            }
            .sheet::before {
              content: "NoLSAF";
              position: absolute;
              inset: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: 800;
              font-size: 84px;
              letter-spacing: 6px;
              color: rgba(2, 102, 94, 0.06);
              transform: rotate(-18deg);
              pointer-events: none;
              z-index: 0;
            }
            .content { position: relative; z-index: 1; }
            .header {
              text-align: left;
              background: #02665e;
              border-radius: 8px;
              padding: 16px;
              border-bottom: none;
              padding-bottom: 14px;
              margin-bottom: 12px;
            }
            .header h1 {
              color: #ffffff;
              margin: 0;
              font-size: 22px;
              letter-spacing: 0.2px;
              font-weight: 700;
            }
            .header .subtitle {
              color: #d1fae5;
              font-size: 10px;
              margin-top: 3px;
              font-weight: 600;
            }
            .code-box {
              position: relative;
              background: #f0f8f6;
              border: 1px solid #c6ded8;
              padding: 12px 14px;
              text-align: left;
              margin: 0 0 12px;
              border-radius: 10px;
            }
            .verified-stamp {
              position: absolute;
              top: 12px;
              right: 12px;
              border: 1px solid #8dc7b7;
              color: #02665e;
              border-radius: 9999px;
              padding: 4px 9px;
              font-size: 9px;
              font-weight: 700;
              letter-spacing: 1.2px;
              text-transform: uppercase;
              background: rgba(255, 255, 255, 0.75);
            }
            .code {
              font-size: 16px;
              font-weight: 700;
              color: #02665e;
              letter-spacing: 0;
              overflow-wrap: anywhere;
              margin: 5px 0 4px;
              padding-right: 50px;
            }
            .section {
              margin: 10px 0;
              page-break-inside: avoid;
            }
            .section-title {
              background: #f0f6f5;
              color: #02665e;
              padding: 7px 10px;
              font-size: 9px;
              letter-spacing: 1px;
              text-transform: uppercase;
              font-weight: 700;
              margin-bottom: 0;
              border-radius: 6px 6px 0 0;
              border: none;
              border-bottom: none;
            }
            .section-content {
              border: none;
              border-top: none;
              padding: 3px 10px;
              border-radius: 0;
              background: #ffffff;
            }
            .detail-row {
              display: flex;
              justify-content: space-between;
              padding: 6px 0;
              border-bottom: none;
              gap: 10px;
            }
            .detail-row:last-child {
              border-bottom: none;
            }
            .detail-label {
              font-weight: 400;
              color: #5a6e69;
              width: 34%;
              flex-shrink: 0;
            }
            .detail-value {
              overflow-wrap: anywhere;
              color: #18332f;
              width: 66%;
              text-align: right;
              font-weight: 500;
            }
            .detail-value strong {
              color: #02665e;
              font-size: 19px;
              font-weight: 700;
            }
            .footer {
              margin-top: 12px;
              padding-top: 10px;
              border-top: 1px solid rgba(148, 163, 184, 0.45);
              color: #475569;
              font-size: 9px;
            }
            .footer-grid {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 14px;
            }
            .footer-left { flex: 1; min-width: 0; }
            .footer-title {
              font-size: 10px;
              font-weight: 700;
              color: #000000;
              margin: 0;
            }
            .footer-meta {
              margin-top: 6px;
              font-size: 9px;
              color: #334155;
              line-height: 1.35;
              font-weight: 400;
            }
            .qr-code {
              width: 100px;
              height: 100px;
              margin: 0 auto;
              display: block;
            }
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="content">
              <div class="header">
                <h1>NoLSAF</h1>
                <div class="subtitle">Payment receipt</div>
                <div class="subtitle">Booking settlement</div>
              </div>

              <div class="code-box">
                <div class="verified-stamp">PAID</div>
                <div style="font-size: 9px; color: #5a6e69; letter-spacing: 1px; text-transform: uppercase;">Receipt number</div>
                <div class="code">${safeText(receiptNo)}</div>
                <div style="font-size: 9px; color: #5a6e69; margin-top: 2px; font-weight: 400;">
                  ${safeText(formatDate(payment.paidAt))}
                </div>
              </div>

              <div class="section">
                <div class="section-title">Payment Information</div>
                <div class="section-content">
                  <div class="detail-row">
                    <span class="detail-label">Amount:</span>
                    <span class="detail-value"><strong>${safeText(formatCurrency(payment.amount, payment.currency))}</strong></span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Payment Method:</span>
                    <span class="detail-value">${safeText(formatPaymentMethod(payment.paymentMethod) || 'Not specified')}</span>
                  </div>
                  ${payment.accountNumber ? `
                  <div class="detail-row">
                    <span class="detail-label">Account:</span>
                    <span class="detail-value">${safeText(payment.accountNumber)}</span>
                  </div>
                  ` : ''}
                  ${payment.paymentRef ? `
                  <div class="detail-row">
                    <span class="detail-label">Merchant Reference:</span>
                    <span class="detail-value">${safeText(payment.paymentRef)}</span>
                  </div>
                  ` : ''}
                  <div class="detail-row">
                    <span class="detail-label">Provider Reference:</span>
                    <span class="detail-value">${safeText(payment.providerReference || 'Not recorded')}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Date Paid:</span>
                    <span class="detail-value">${safeText(formatDateTime(payment.paidAt))}</span>
                  </div>
                </div>
              </div>

              <div class="section">
                <div class="section-title">Invoice Details</div>
                <div class="section-content">
                  <div class="detail-row">
                    <span class="detail-label">Invoice Number:</span>
                    <span class="detail-value">${safeText(payment.invoiceNumber)}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Owner:</span>
                    <span class="detail-value">${safeText(payment.owner.name || `Owner #${payment.owner.id}`)}</span>
                  </div>
                  ${payment.property ? `
                  <div class="detail-row">
                    <span class="detail-label">Property:</span>
                    <span class="detail-value">${safeText(payment.property.title)}</span>
                  </div>
                  ` : ''}
                </div>
              </div>

              <div class="footer">
                <div class="footer-grid">
                  <div class="footer-left">
                    <p class="footer-title">NoLSAF</p>
                    <div class="footer-meta">Quality Stay For Every Wallet</div>
                    <div class="footer-meta">
                      Booking settlement invoice receipt.<br />Generated ${safeText(formatPaymentTimestamp(new Date().toISOString()))}<br /><br />Invoice payment status does not independently confirm owner payout delivery.
                    </div>
                  </div>
                  <div style="text-align: center;">
                    ${qrDataUrl ? `
                    <img src="${safeAttr(qrDataUrl)}" alt="Receipt QR Code" class="qr-code" />
                    <div style="font-size: 10px; margin-top: 6px; color: #334155; font-weight: 800;">Scan to verify</div>
                    ` : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      // Render in a separate document so dashboard styles cannot override the receipt.
      receiptFrame = document.createElement('iframe');
      receiptFrame.title = 'Receipt PDF renderer';
      receiptFrame.setAttribute('aria-hidden', 'true');
      receiptFrame.style.cssText = 'position:fixed;left:-10000px;top:0;width:128mm;height:2000px;border:0;pointer-events:none;';
      const ready = new Promise<void>((resolve, reject) => {
        receiptFrame!.onload = () => resolve();
        receiptFrame!.onerror = () => reject(new Error('Receipt renderer failed to load'));
      });
      receiptFrame.srcdoc = receiptHtml;
      document.body.appendChild(receiptFrame);
      await ready;
      const receiptDocument = receiptFrame.contentDocument;
      const receiptWindow = receiptFrame.contentWindow;
      const sheet = receiptDocument?.querySelector<HTMLElement>('.sheet');
      if (!receiptDocument || !receiptWindow || !sheet) throw new Error('Receipt template unavailable');
      await receiptDocument.fonts.ready;
      await Promise.all(Array.from(receiptDocument.images).map(image => image.decode().catch(() => {
        throw new Error('Receipt QR image could not be loaded. Please try again.');
      })));
      // html2pdf clones into the parent document. Preserve the isolated computed
      // styles inline so that clone remains branded rather than inheriting app CSS.
      for (const element of [sheet, ...Array.from(sheet.querySelectorAll<HTMLElement>('*'))]) {
        const computed = receiptWindow.getComputedStyle(element);
        for (const property of Array.from(computed)) {
          element.style.setProperty(property, computed.getPropertyValue(property), 'important');
        }
      }

      // Dynamic import html2pdf
      const html2pdfModule = await import('html2pdf.js');
      const h2p = html2pdfModule && (html2pdfModule.default || html2pdfModule);
      if (!h2p) throw new Error('html2pdf load failed');

      await h2p().from(sheet).set({
        filename: suggested,
        margin: 10,
        jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' },
        html2canvas: { 
          scale: Math.max(2, window.devicePixelRatio || 2), 
          useCORS: true,
          logging: false,
          letterRendering: true,
          backgroundColor: '#ffffff'
        }
      }).save();

    } catch (err: any) {
      console.error('PDF generation failed', err);
      const errorMessage = err?.message || 'Failed to generate PDF. Please try again.';
      throw new Error(errorMessage);
    } finally {
      receiptFrame?.remove();
      receiptDownloadLock.current = false;
      setReceiptDownloading(false);
    }
  };

  // Bulk selection helpers
  const toggleSelectAll = () => {
    if (selectedIds.size === payments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(payments.map(p => p.id)));
    }
  };

  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Bulk mark as paid
  const handleBulkMarkPaid = async () => {
    if (selectedIds.size === 0) return;
    if (selectedIds.size !== 1) {
      alert('Settle one invoice at a time so each payment keeps its own unique reference and audit trail.');
      return;
    }
    if (activeTab !== 'waiting') {
      alert('Bulk mark as paid is only available for waiting payments.');
      return;
    }

    const paymentRef = prompt('Enter the unique payment reference for this invoice:');
    if (!paymentRef || !paymentRef.trim()) return;

    const confirmMessage = `Mark this invoice as paid with reference "${paymentRef}"?`;
    if (!window.confirm(confirmMessage)) return;

    setBulkActionLoading(true);
    setError(null);
    try {
      const [invoiceId] = Array.from(selectedIds);
      await api.post(`/api/admin/invoices/${invoiceId}/mark-paid`, {
        method: "BANK",
        ref: paymentRef.trim(),
      });
      alert('Invoice marked as paid.');
      
      await loadPayments();
      await loadSummary();
      clearSelection();
    } catch (err: any) {
      console.error('Bulk mark paid failed', err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to mark invoices as paid. Please try again.';
      setError(errorMessage);
      alert(`Error: ${errorMessage}`);
    } finally {
      setBulkActionLoading(false);
    }
  };

  // CSV Export
  const handleExportCSV = async () => {
    setExportLoading(true);
    setError(null);
    setExportNeedsVerification(false);
    try {
      const params = new URLSearchParams();
      params.append('tab', activeTab);
      if (q.trim()) params.append('q', q.trim());
      if (selectedIds.size > 0) {
        params.append('selectedIds', Array.from(selectedIds).join(','));
      }

      const response = await api.get(`/admin/payments/export.csv?${params.toString()}`, {
        responseType: 'blob',
      });

      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `payments-${activeTab}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      if (err?.response?.status === 403 && err?.response?.data?.require2fa) {
        setExportNeedsVerification(true);
        return;
      }
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to export CSV. Please try again.';
      setError(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  const maskAccountNumber = (account?: string | null): string | null => {
    if (!account) return null;
    
    const cleaned = String(account).trim().replace(/[\s\-\(\)]/g, '');
    
    // Extract digits only for phone number detection
    const digits = cleaned.replace(/\D/g, '');
    
    // Determine if it's a phone number (starts with 0, 255, +255, 254, +254, or 9-10 digit number)
    const isPhoneNumber = /^(0|255|\+255|254|\+254)/.test(cleaned) || /^\d{9,10}$/.test(cleaned);
    
    if (isPhoneNumber) {
      // Normalize to local format (0XXX...)
      let localNumber = digits;
      
      // Case 1: Has country code (255 or 254) - convert to local format
      if (digits.startsWith('255')) {
        localNumber = '0' + digits.slice(3); // 255765012370 → 0765012370
      } else if (digits.startsWith('254')) {
        localNumber = '0' + digits.slice(3); // 254765012370 → 0765012370
      }
      // Case 2: Already in local format (starts with 0) - use as is
      // Case 3: No leading 0 or country code - assume it's local format (already correct)
      
      // Ensure it starts with 0 for proper masking (Tanzania/Kenya format)
      if (!localNumber.startsWith('0') && localNumber.length >= 9) {
        localNumber = '0' + localNumber;
      }
      
      if (localNumber.length >= 9 && localNumber.startsWith('0')) {
        // Format: 0765012370 → 076*****70 (first 3, last 2)
        const first3 = localNumber.slice(0, 3);
        const last2 = localNumber.slice(-2);
        return `${first3}*****${last2}`;
      }
    }
    
    // If it looks like a bank account (longer number, might have letters/numbers)
    if (cleaned.length > 8) {
      // Format: Show first 3 and last 2 characters (similar to phone)
      const first3 = cleaned.slice(0, 3);
      const last2 = cleaned.slice(-2);
      return `${first3}*****${last2}`;
    }
    
    // Fallback: mask middle characters
    if (cleaned.length > 5) {
      const first3 = cleaned.slice(0, 3);
      const last2 = cleaned.slice(-2);
      return `${first3}${'*'.repeat(Math.max(5, cleaned.length - 5))}${last2}`;
    }
    
    return cleaned; // Too short to mask meaningfully
  };

  const isMobileMoney = (method?: string | null) => {
    if (!method) return false;
    return /mobile|mpesa|tigopesa|airtel|lipa|m-pesa/i.test(method);
  };

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {
        page,
        pageSize,
        tab: activeTab,
      };
      if (q.trim() !== '') params.q = q.trim();

      const r = await api.get<{ items: InvoicePayment[]; total: number }>('/admin/payments/invoices', { params });
      setPayments(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load payments', err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to load payments. Please try again.';
      setError(errorMessage);
      setPayments([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [api, activeTab, page, q]);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const r = await api.get<SummaryData>('/admin/payments/summary');
      if (r.data) {
        setSummary({
          waiting: r.data.waiting || 0,
          paid: r.data.paid || 0,
          booking: r.data.booking ?? { waiting: r.data.waiting || 0, paid: r.data.paid || 0 },
          nrms: r.data.nrms ?? { waiting: 0, paid: 0 },
          payouts: r.data.payouts ?? { open: 0, paid: 0 },
          exceptions: r.data.exceptions ?? { unmatched: 0, variance: 0, total: 0 },
        });
      }
    } catch (err: any) {
      console.error('Failed to load summary', err);
      setSummaryError(err?.response?.data?.error || 'Payment operations summary is unavailable.');
    } finally {
      setSummaryLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // Note: authify should be imported from your auth utility
    // For now, we'll rely on the API's requireRole middleware
    loadPayments();
    loadSummary();
  }, [loadPayments, loadSummary]);

  const badgeClasses = (status: string) => {
    if (status === 'PAID' || status === 'SUCCESS' || status === 'Completed') {
      return 'bg-green-50 text-green-700 border border-green-200';
    }
    if (status === 'APPROVED') {
      return 'bg-yellow-50 text-yellow-800 border border-yellow-200';
    }
    return 'bg-gray-50 text-gray-700 border border-gray-200';
  };

  const sortedPayments = useMemo(() => {
    const next = [...payments];
    const readValue = (payment: InvoicePayment): string | number => {
      switch (sortBy) {
        case "date":
          return new Date(payment.date || "").getTime() || 0;
        case "owner":
          return String(payment.owner?.name || payment.owner?.email || "").toLowerCase();
        case "property":
          return String(payment.property?.title || "").toLowerCase();
        case "invoice":
          return String(payment.invoiceNumber || "").toLowerCase();
        case "method":
          return String(formatPaymentMethod(payment.paymentMethod) || "").toLowerCase();
        case "account":
          return String(maskAccountNumber(payment.accountNumber) || "").toLowerCase();
        case "amount":
          return Number(payment.amount || 0);
        case "status":
          return String(payment.status || "").toLowerCase();
        default:
          return "";
      }
    };

    next.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return next;
  }, [payments, sortBy, sortDir]);

  const handleSort = (field: PaymentSortKey) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "date" || field === "amount" ? "desc" : "asc");
  };

  const renderSortIcon = (field: PaymentSortKey) => {
    if (sortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-teal-600" />
      : <ChevronDown className="h-3.5 w-3.5 text-teal-600" />;
  };

  return (
    <div className="payments-workspace box-border w-full min-w-0 max-w-none space-y-5 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      {/* Header + Summary */}
      <div
        className="relative overflow-hidden rounded-2xl shadow-lg"
        style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 20px 50px -24px rgba(2,102,94,0.65)" }}
      >
        {/* ── Decorative sparkline viz (revenue-card style) ── */}
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 900 260"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Arcs top-right (revenue card style) */}
          <circle cx="860" cy="55"  r="230" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
          <circle cx="860" cy="55"  r="175" stroke="white" strokeOpacity="0.055" strokeWidth="1" fill="none" />
          <circle cx="820" cy="25"  r="130" stroke="white" strokeOpacity="0.045" strokeWidth="1" fill="none" />
          {/* Arc bottom-left */}
          <circle cx="30"  cy="238" r="150" stroke="white" strokeOpacity="0.045" strokeWidth="1" fill="none" />
          {/* Horizontal grid lines */}
          {[52, 104, 156, 208].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.032)" strokeWidth="1" />
          ))}
          {/* Sparkline 1 — main wave */}
          <polyline
            points="0,218 75,195 150,208 225,175 300,188 375,155 450,168 525,132 600,148 675,112 750,128 825,98 900,115"
            fill="none" stroke="white" strokeOpacity="0.16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
          <polygon
            points="0,218 75,195 150,208 225,175 300,188 375,155 450,168 525,132 600,148 675,112 750,128 825,98 900,115 900,260 0,260"
            fill="white" fillOpacity="0.028"
          />
          {/* Sparkline 2 — secondary offset wave */}
          <polyline
            points="0,235 90,220 180,228 270,205 360,215 450,192 540,200 630,178 720,188 810,165 900,172"
            fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          />
          {/* Glow dots at peaks */}
          {([[675,112],[525,132],[825,98],[225,175]] as [number,number][]).map(([px,py]) => (
            <circle key={`${px}-${py}`} cx={px} cy={py} r="3.5" fill="white" fillOpacity="0.22" />
          ))}
          {/* Radial glow centre */}
          <radialGradient id="payRevGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(10,92,130,0.50)" />
            <stop offset="100%" stopColor="rgba(10,92,130,0)" />
          </radialGradient>
          <ellipse cx="450" cy="130" rx="320" ry="160" fill="url(#payRevGlow)" />
        </svg>

        {/* ── Content ── */}
        <div className="relative z-10 px-4 py-5 sm:px-5 sm:py-5">
          <div className="flex items-center gap-4 text-left">
          {/* Icon orb */}
          <div
            className="inline-flex shrink-0 items-center justify-center rounded-2xl"
            style={{
              width: 52, height: 52,
              background: "rgba(255,255,255,0.10)",
              border: "1.5px solid rgba(255,255,255,0.18)",
              boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)",
            }}
          >
            <Wallet className="h-6 w-6" style={{ color: "rgba(255,255,255,0.92)" }} aria-hidden />
          </div>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200">Finance operations</p>
              <h1 className="m-0 mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Payments</h1>
              <p className="m-0 mt-1 text-xs text-white/60 sm:text-sm">Monitor booking settlements, NRMS billing, owner payouts and reconciliation exceptions.</p>
            </div>
          </div>

          <div className="payments-summary mt-4 grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/15 bg-white/10 p-4 text-left backdrop-blur-sm">
              <div className="flex items-center justify-between"><ReceiptText className="h-5 w-5 text-sky-200" /><span className="text-[9px] font-bold uppercase tracking-wider text-white/45">Booking settlements</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { setActiveTab("waiting"); setPage(1); }} className={`rounded-lg border p-2.5 text-left transition ${activeTab === "waiting" ? "border-amber-300/60 bg-amber-300/15" : "border-white/10 bg-black/10 hover:bg-white/10"}`}><span className="block text-xl font-black text-white">{summaryLoading || summaryError ? "—" : summary.booking.waiting.toLocaleString()}</span><span className="text-[10px] font-bold uppercase tracking-wide text-amber-200">Awaiting</span></button>
                <button type="button" onClick={() => { setActiveTab("paid"); setPage(1); }} className={`rounded-lg border p-2.5 text-left transition ${activeTab === "paid" ? "border-emerald-300/60 bg-emerald-300/15" : "border-white/10 bg-black/10 hover:bg-white/10"}`}><span className="block text-xl font-black text-white">{summaryLoading || summaryError ? "—" : summary.booking.paid.toLocaleString()}</span><span className="text-[10px] font-bold uppercase tracking-wide text-emerald-200">Paid</span></button>
              </div>
            </div>
            <Link href="/admin/nrms/reconciliation" className="group rounded-xl border border-white/15 bg-white/10 p-4 text-left text-white no-underline backdrop-blur-sm transition hover:bg-white/15">
              <div className="flex items-center justify-between"><Wallet className="h-5 w-5 text-emerald-200" /><ArrowRight className="h-4 w-4 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white" /></div>
              <span className="mt-4 block text-2xl font-black">{summaryLoading || summaryError ? "—" : summary.nrms.waiting.toLocaleString()}</span><span className="block text-[10px] font-bold uppercase tracking-wide text-white/60">NRMS payable</span><span className="mt-1 block text-[11px] text-white/45">{summaryError ? "Unavailable" : summaryLoading ? "Loading…" : `${summary.nrms.paid.toLocaleString()} paid statements`}</span>
            </Link>
            <Link href="/admin/disbursements" className="group rounded-xl border border-white/15 bg-white/10 p-4 text-left text-white no-underline backdrop-blur-sm transition hover:bg-white/15">
              <div className="flex items-center justify-between"><Landmark className="h-5 w-5 text-cyan-200" /><ArrowRight className="h-4 w-4 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white" /></div>
              <span className="mt-4 block text-2xl font-black">{summaryLoading || summaryError ? "—" : summary.payouts.open.toLocaleString()}</span><span className="block text-[10px] font-bold uppercase tracking-wide text-white/60">Open payouts</span><span className="mt-1 block text-[11px] text-white/45">{summaryError ? "Unavailable" : summaryLoading ? "Loading…" : `${summary.payouts.paid.toLocaleString()} payouts completed`}</span>
            </Link>
            <Link href="/admin/action-center" className="group rounded-xl border border-white/15 bg-white/10 p-4 text-left text-white no-underline backdrop-blur-sm transition hover:bg-white/15">
              <div className="flex items-center justify-between"><ShieldAlert className={`h-5 w-5 ${summary.exceptions.total > 0 ? "text-amber-200" : "text-emerald-200"}`} /><ArrowRight className="h-4 w-4 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white" /></div>
              <span className="mt-4 block text-2xl font-black">{summaryLoading || summaryError ? "—" : summary.exceptions.total.toLocaleString()}</span><span className="block text-[10px] font-bold uppercase tracking-wide text-white/60">Reconciliation exceptions</span><span className="mt-1 block text-[11px] text-white/45">{summaryError ? "Unavailable" : summaryLoading ? "Loading…" : `${summary.exceptions.unmatched} unmatched · ${summary.exceptions.variance} variance`}</span>
            </Link>
          </div>
          {summaryError ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200/30 bg-amber-100/10 px-3 py-2 text-xs text-amber-100"><span>{summaryError}</span><button type="button" onClick={() => void loadSummary()} className="rounded-md border border-amber-100/25 bg-white/10 px-2.5 py-1 font-bold text-white transition hover:bg-white/20">Retry summary</button></div> : null}
        </div>
      </div>

      {/* Page Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-800">Something went wrong</div>
            <div className="text-sm text-red-700 break-words">{error}</div>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600"
            aria-label="Dismiss error"
            title="Dismiss"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Table */}
      <section className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm" aria-labelledby="booking-settlements-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1 basis-72">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Booking money</p>
            <h2 id="booking-settlements-title" className="m-0 mt-1 text-lg font-extrabold tracking-tight text-neutral-950">Booking settlement invoices</h2>
            <p className="m-0 mt-1 text-xs text-neutral-500">Approved invoices awaiting settlement and completed booking payments.</p>
          </div>
          <div className="grid max-w-full shrink-0 grid-cols-2 rounded-xl bg-neutral-100 p-1" role="tablist" aria-label="Booking settlement status">
            <button type="button" role="tab" aria-selected={activeTab === "waiting"} onClick={() => { setActiveTab("waiting"); setPage(1); clearSelection(); }} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${activeTab === "waiting" ? "bg-white text-amber-700 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}><Clock className="mr-1.5 inline h-3.5 w-3.5" />Awaiting ({summary.booking.waiting})</button>
            <button type="button" role="tab" aria-selected={activeTab === "paid"} onClick={() => { setActiveTab("paid"); setPage(1); clearSelection(); }} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${activeTab === "paid" ? "bg-white text-emerald-700 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}><CheckCircle className="mr-1.5 inline h-3.5 w-3.5" />Paid ({summary.booking.paid})</button>
          </div>
        </div>
        {/* Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <div className="px-4 py-3 bg-teal-50 border-b border-teal-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-teal-900">
              <CheckSquare className="h-5 w-5" />
              <span>{selectedIds.size} payment{selectedIds.size !== 1 ? 's' : ''} selected</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                  {activeTab === 'waiting' && selectedIds.size === 1 && (
                <button
                  onClick={handleBulkMarkPaid}
                  disabled={bulkActionLoading}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  {bulkActionLoading ? 'Processing...' : 'Mark selected paid'}
                </button>
              )}
              {activeTab === 'waiting' && selectedIds.size > 1 ? <span className="text-xs font-semibold text-amber-700">Select one invoice to settle</span> : null}
              <button
                onClick={clearSelection}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}
        {/* Search + Export */}
        <div className="p-3 sm:p-4 border-b border-gray-200">
          {exportNeedsVerification && (
            <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>Verify finance access, then click Export CSV again. No file has been downloaded.</span>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('finance-grant-required'))} className="shrink-0 rounded-md border border-amber-300 px-3 py-1.5 font-semibold hover:bg-amber-100">Verify access</button>
            </div>
          )}
          <div className="grid w-full min-w-0 grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative w-full min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                aria-label="Search booking settlement invoices"
                className="box-border block w-full min-w-0 max-w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm shadow-sm"
                placeholder="Search by invoice number, owner name, property..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(1);
                  }
                }}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    setPage(1);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex min-w-0 justify-end">
              <button
                type="button"
                onClick={handleExportCSV}
                disabled={exportLoading}
                className="w-full justify-center whitespace-nowrap px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm hover:shadow-md hover:bg-gray-50 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 sm:w-auto"
                title="Export CSV"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="text-sm font-medium">{exportLoading ? "Exporting..." : "Export CSV"}</span>
              </button>
            </div>
          </div>
        </div>
        {loading ? (
          <>
            {/* Skeleton Table */}
            <div className="hidden w-full min-w-0 max-w-full md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {[...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-4"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-24"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-32"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-28"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-24"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="h-4 bg-gray-200 rounded w-20 ml-auto"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-6 bg-gray-200 rounded-full w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="h-8 bg-gray-200 rounded w-16 ml-auto"></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : payments.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Wallet className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No {activeTab === 'waiting' ? 'pending' : 'completed'} payments found.</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your search query or switch tabs.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden w-full min-w-0 max-w-full md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button
                        onClick={toggleSelectAll}
                        className="flex items-center justify-center p-1 hover:bg-gray-200 rounded transition-colors"
                        title={selectedIds.size === payments.length ? 'Deselect all' : 'Select all'}
                      >
                        {selectedIds.size === payments.length ? (
                          <CheckSquare className="h-4 w-4 text-teal-600" />
                        ) : (
                          <Square className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("date")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Date {renderSortIcon("date")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("owner")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Owner {renderSortIcon("owner")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("property")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Property {renderSortIcon("property")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("invoice")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Invoice {renderSortIcon("invoice")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("method")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Method {renderSortIcon("method")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("account")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Account {renderSortIcon("account")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("amount")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700 ml-auto">
                        Amount {renderSortIcon("amount")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Status {renderSortIcon("status")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedPayments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <button
                          onClick={() => toggleSelect(payment.id)}
                          className="flex items-center justify-center p-1 hover:bg-gray-100 rounded transition-colors"
                          title={selectedIds.has(payment.id) ? 'Deselect' : 'Select'}
                        >
                          {selectedIds.has(payment.id) ? (
                            <CheckSquare className="h-4 w-4 text-teal-600" />
                          ) : (
                            <Square className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{formatDateOnly(payment.date)}</div>
                        <div className="text-xs text-gray-500">{formatTimeWithSeconds(payment.date)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-900">{payment.owner.name || payment.owner.email || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {payment.property ? (
                          <div className="flex items-center gap-2">
                            <Building className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-500">{payment.property.title}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <code className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded border border-gray-200 font-mono">
                          {payment.invoiceNumber}
                        </code>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {isMobileMoney(payment.paymentMethod) ? (
                            <Smartphone className="h-4 w-4 text-teal-600" />
                          ) : (
                            <CreditCard className="h-4 w-4 text-teal-600" />
                          )}
                          <span className="text-sm text-gray-500">
                            {formatPaymentMethod(payment.paymentMethod)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900 font-mono">
                          {maskAccountNumber(payment.accountNumber) || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">
                        {formatCurrency(payment.amount, payment.currency)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${badgeClasses(payment.status)}`}>
                          {payment.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => {
                            setSelectedPayment(payment);
                            setModalOpen(true);
                          }}
                          className="text-teal-600 hover:text-teal-900 transition-colors inline-flex items-center gap-1"
                        >
                          <Eye className="h-4 w-4" />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-gray-200">
              {sortedPayments.map((payment) => (
                <div key={payment.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900">
                          {payment.owner.name || payment.owner.email || 'N/A'}
                        </span>
                      </div>
                      {payment.property && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Building className="h-3 w-3" />
                          <span>{payment.property.title}</span>
                        </div>
                      )}
                    </div>
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${badgeClasses(payment.status)}`}>
                      {payment.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-gray-500">Invoice:</span>
                      <code className="ml-1 text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded text-xs font-mono">
                        {payment.invoiceNumber}
                      </code>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-500">Amount:</span>
                      <span className="ml-1 font-medium text-gray-900">
                        {formatCurrency(payment.amount, payment.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Date:</span>
                      <span className="ml-1 text-gray-700">{formatDateOnly(payment.date)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-500">Method:</span>
                      <span className="ml-1 text-gray-700">{formatPaymentMethod(payment.paymentMethod)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Account:</span>
                      <span className="ml-1 text-gray-700 font-mono">{maskAccountNumber(payment.accountNumber) || '-'}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedPayment(payment);
                      setModalOpen(true);
                    }}
                    className="w-full mt-2 px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-teal-600 bg-gray-50 border border-teal-600 rounded-lg hover:bg-teal-50 transition-colors flex items-center justify-center gap-1.5 sm:gap-2"
                  >
                    <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    <span>View Details</span>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Pagination */}
        {!loading && payments.length > 0 && (
          <div className="px-4 sm:px-6 py-3 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-500">
              Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, total)} of {total} payments
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * pageSize >= total}
                className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Modal: View Invoice Details */}
      {modalOpen && selectedPayment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-detail-title"
            className="payment-detail-modal relative w-full min-w-0 max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl"
            style={{
              background: "linear-gradient(160deg, #071e1c 0%, #0b2e2a 40%, #0e3832 100%)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {/* ── Modal header ── */}
            <div
              className="sticky top-0 z-10 flex items-start justify-between gap-4 px-6 py-5"
              style={{
                background: "linear-gradient(135deg, #01312e 0%, #02504a 100%)",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.45)" }}>Invoice</p>
                <h3 id="payment-detail-title" className="text-lg sm:text-xl font-bold break-all" style={{ color: "#fff" }}>
                  {selectedPayment.invoiceNumber}
                </h3>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 mt-1">
                {/* Status pill */}
                {(() => {
                  const s = selectedPayment.status;
                  const isPaid = s === 'PAID' || s === 'SUCCESS' || s === 'Completed';
                  const isApproved = s === 'APPROVED';
                  return (
                    <span
                      className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide"
                      style={{
                        background: isPaid ? "rgba(16,185,129,0.25)" : isApproved ? "rgba(245,158,11,0.25)" : "rgba(148,163,184,0.18)",
                        color: isPaid ? "#6ee7b7" : isApproved ? "#fcd34d" : "#94a3b8",
                        border: `1px solid ${isPaid ? "rgba(16,185,129,0.35)" : isApproved ? "rgba(245,158,11,0.35)" : "rgba(148,163,184,0.22)"}`,
                      }}
                    >
                      {s}
                    </span>
                  );
                })()}
                <button
                  onClick={() => { setModalOpen(false); setSelectedPayment(null); }}
                  aria-label="Close"
                  className="rounded-xl transition-all duration-150"
                  style={{
                    width: 34, height: 34,
                    background: "rgba(0,0,0,0.35)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    color: "rgba(148,163,184,0.85)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.55)"; (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.35)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(148,163,184,0.85)"; }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <p className="m-0 text-sm text-emerald-100">This status belongs to the booking settlement invoice. It does not independently confirm delivery of an owner payout.</p>
              {/* Modal Error */}
              {modalError && (
                <div
                  className="rounded-xl p-3 flex items-start gap-2"
                  style={{ background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.28)" }}
                >
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "#fca5a5" }} />
                  <p className="text-sm flex-1" style={{ color: "#fca5a5" }}>{modalError}</p>
                  <button onClick={() => setModalError(null)} style={{ color: "#fca5a5" }}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Amount hero */}
              <div
                className="rounded-xl px-5 py-4 flex items-center justify-between"
                style={{ background: "rgba(2,102,94,0.18)", border: "1px solid rgba(2,102,94,0.30)" }}
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Amount</p>
                  <p className="text-2xl sm:text-3xl font-bold" style={{ color: "#6ee7b7" }}>
                    {formatCurrency(selectedPayment.amount, selectedPayment.currency)}
                  </p>
                </div>
                <div
                  className="rounded-xl flex items-center justify-center"
                  style={{ width: 52, height: 52, background: "rgba(2,102,94,0.30)", border: "1px solid rgba(2,102,94,0.40)" }}
                >
                  <Wallet className="h-6 w-6" style={{ color: "#6ee7b7" }} />
                </div>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  { label: "Invoice issued", value: formatPaymentTimestamp(selectedPayment.issuedAt) },
                  { label: "Invoice approved", value: formatPaymentTimestamp(selectedPayment.approvedAt) },
                  { label: "Payment confirmed", value: formatPaymentTimestamp(selectedPayment.paidAt) },
                  { label: "Payment Method", value: formatPaymentMethod(selectedPayment.paymentMethod) || "Not specified" },
                  { label: "Owner", value: selectedPayment.owner.name || selectedPayment.owner.email || "N/A", sub: selectedPayment.owner.phone || undefined },
                  { label: "Property", value: selectedPayment.property?.title || "N/A" },
                  ...(selectedPayment.paymentMethod?.toUpperCase() === "BANK" ? [{ label: "Bank name", value: selectedPayment.bankName || "Not recorded" }] : []),
                  { label: "Recorded payer account (masked)", value: selectedPayment.accountNumber || "Not recorded", mono: true },
                  { label: "Internal / merchant reference", value: selectedPayment.paymentRef || "Not recorded", mono: true, colSpan: true },
                  { label: "Bank / provider transaction reference", value: selectedPayment.providerReference || "Not recorded", mono: true, colSpan: true },
                  { label: "Reconciliation", value: "Not recorded", sub: "No dedicated invoice reconciliation record is available. Payment status and provider events are shown separately.", colSpan: true },
                  ...(selectedPayment.receiptNumber ? [{ label: "Receipt Number", value: selectedPayment.receiptNumber, mono: true, colSpan: true }] : []),
                ] as Array<{ label: string; value: string; sub?: string; mono?: boolean; colSpan?: boolean }>).map(({ label, value, sub, mono, colSpan }) => (
                  <div
                    key={label}
                    className={`min-w-0 rounded-xl px-4 py-3${colSpan ? " sm:col-span-2" : ""}`}
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</p>
                    <p className={`text-sm font-medium break-all${mono ? " font-mono" : ""}`} style={{ color: "rgba(255,255,255,0.88)" }}>{value}</p>
                    {sub && <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.40)" }}>{sub}</p>}
                    {label === "Receipt Number" && selectedPayment.status === 'PAID' && (
                      <button type="button" disabled={receiptDownloading} aria-busy={receiptDownloading} onClick={() => void generateReceiptPDF(selectedPayment).catch(() => setModalError('Failed to generate receipt. Please try again.'))} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-emerald-300/40 bg-emerald-900/40 px-3 py-2 text-sm font-semibold text-emerald-100 disabled:cursor-wait disabled:opacity-60">
                        <Download className="h-4 w-4" />{receiptDownloading ? 'Preparing receipt…' : 'Download receipt'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Payment Event */}
              {selectedPayment.paymentEvent && (
                <div
                  className="rounded-xl px-4 py-4 space-y-2"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>Payment Event</p>
                  {[
                    { k: "Provider", v: selectedPayment.paymentEvent.provider },
                    { k: "Event ID", v: selectedPayment.paymentEvent.eventId, mono: true },
                    { k: "Event recorded", v: formatPaymentTimestamp(selectedPayment.paymentEvent.createdAt) },
                  ].map(({ k, v, mono }) => (
                    <div key={k} className="flex flex-wrap justify-between items-center gap-2 text-sm" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6 }}>
                      <span style={{ color: "rgba(255,255,255,0.40)" }}>{k}</span>
                      <span className={`min-w-0 break-all ${mono ? "font-mono" : "font-medium"}`} style={{ color: "rgba(255,255,255,0.80)" }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Receipt QR Code */}
              {selectedPayment.status === 'PAID' && selectedPayment.receiptNumber && (
                <div
                  className="rounded-xl px-4 py-5 flex flex-col items-center"
                  style={{ background: "rgba(2,102,94,0.12)", border: "1px solid rgba(2,102,94,0.25)" }}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.35)" }}>Receipt QR Code</p>
                  <div
                    className="rounded-xl p-4"
                    style={{ background: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.40)", border: "2px solid rgba(2,102,94,0.30)" }}
                  >
                    <Image
                      src={`/api/admin/invoices/${selectedPayment.invoiceId}/receipt.png`}
                      alt="Receipt QR Code"
                      width={224} height={224}
                      unoptimized
                      className="w-44 h-44 sm:w-52 sm:h-52 object-contain"
                      onError={(e) => { (e.currentTarget as any).style.display = 'none'; }}
                    />
                  </div>
                  <p className="text-xs mt-4 text-center" style={{ color: "rgba(255,255,255,0.38)" }}>Scan to verify receipt authenticity</p>
                  <span
                    className="mt-2 px-3 py-1 rounded-lg text-xs font-mono"
                    style={{ background: "rgba(2,102,94,0.25)", color: "#6ee7b7", border: "1px solid rgba(2,102,94,0.35)" }}
                  >
                    {selectedPayment.receiptNumber}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div
                className="flex flex-wrap gap-3 pt-2"
                style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
              >
                <button
                  onClick={() => { setModalOpen(false); setSelectedPayment(null); }}
                  className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={{
                    background: "rgba(0,0,0,0.35)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(148,163,184,0.85)",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.55)"; (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.35)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(148,163,184,0.85)"; }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
