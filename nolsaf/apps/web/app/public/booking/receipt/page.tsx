"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  CheckCircle2,
  Download,
  MapPin,
} from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";

type ReceiptData = {
  invoiceId: number;
  invoiceNumber: string;
  receiptNumber: string | null;
  paymentRef: string;
  status: string;
  paidAt: string | null;
  totalAmount: number;
  currency: string;
  paymentMethod: string | null;
  booking: {
    id: number;
    bookingCode: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    guestName: string | null;
    guestPhone: string | null;
  };
  property: {
    id: number;
    slug: string;
    title: string;
    type: string;
    regionName: string | null;
    district: string | null;
    city: string | null;
    primaryImage: string | null;
  };
  receiptQrPng: string | null;
};

export default function ReceiptPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  useEffect(() => {
    const invoiceId = searchParams?.get("invoiceId");
    const accessToken = searchParams?.get("accessToken");

    if (!invoiceId) {
      setError("Missing invoice ID");
      setLoading(false);
      return;
    }

    if (!accessToken) {
      setError("Missing invoice access token");
      setLoading(false);
      return;
    }

    fetchReceipt(Number(invoiceId), accessToken);
  }, [searchParams]);

  async function fetchReceipt(invoiceId: number, accessToken: string) {
    try {
      const accessQuery = `accessToken=${encodeURIComponent(accessToken)}`;
      const candidates = [
        // Use same-origin proxy (works with Next rewrites and avoids CORS issues)
        `/api/public/invoices/${invoiceId}?${accessQuery}`,
      ];

      let lastErr: any = null;
      let data: any = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          const contentType = response.headers.get("content-type") || "";
          let bodyText: string | null = null;
          let bodyJson: any = null;

          try {
            if (contentType.includes("application/json")) {
              bodyJson = await response.json();
            } else {
              bodyText = await response.text();
              try {
                bodyJson = JSON.parse(bodyText);
              } catch {
                // Non-JSON response; keep as text for error/debug messages.
              }
            }
          } catch {
            // Ignore parse errors; handled below.
          }

          if (!response.ok) {
            const msg =
              bodyJson?.error ||
              bodyJson?.message ||
              (bodyText ? bodyText.slice(0, 500) : null) ||
              `Failed to fetch receipt (${response.status})`;
            lastErr = new Error(String(msg));
            continue;
          }

          data = bodyJson ?? null;
          if (!data) {
            lastErr = new Error(
              bodyText ? `Invalid receipt response: ${bodyText.slice(0, 500)}` : "Invalid receipt response"
            );
            continue;
          }
          break;
        } catch (e: any) {
          lastErr = e;
          continue;
        }
      }

      if (!data) {
        throw lastErr || new Error("Failed to fetch receipt");
      }
      
      // Transform to receipt format
      setReceipt({
        invoiceId: data.id,
        invoiceNumber: data.invoiceNumber,
        receiptNumber: data.receiptNumber || null,
        paymentRef: data.paymentRef,
        status: data.status,
        paidAt: data.paidAt || null,
        totalAmount: data.totalAmount,
        currency: data.currency,
        paymentMethod: data.paymentMethod || null,
        booking: data.booking,
        property: data.property,
        receiptQrPng: data.receiptQrPng || null,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to load receipt");
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <LogoSpinner size="md" className="mx-auto mb-4" ariaLabel="Loading receipt" />
          <p className="text-slate-600">Loading receipt...</p>
        </div>
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-6 text-center">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Error</h2>
          <p className="text-slate-600 mb-6">{error || "Receipt not found"}</p>
          <Link
            href="/public/properties"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#02665e] text-white hover:bg-[#014e47] transition-colors"
          >
            Browse Properties
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 print:hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link
              href={`/public/properties/${receipt.property.slug}`}
              className="inline-flex items-center text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              Back to property
            </Link>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <Download className="w-4 h-4" />
              Print / Save
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Receipt Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 print:shadow-none print:border-none">
          {/* Header */}
          <div className="text-center mb-8 pb-8 border-b border-slate-200">
            <div className="flex items-center justify-center gap-3 mb-4">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <h1 className="text-3xl font-bold text-slate-900">Payment Receipt</h1>
            </div>
            {receipt.receiptNumber && (
              <p className="text-slate-600">
                Receipt Number: <span className="font-mono font-semibold text-slate-900">{receipt.receiptNumber}</span>
              </p>
            )}
            <p className="text-slate-600 mt-1">
              Invoice: <span className="font-mono font-semibold text-slate-900">{receipt.invoiceNumber}</span>
            </p>
          </div>

          {/* Payment Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Payment Details</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-slate-600">Amount Paid</span>
                  <span className="font-semibold text-slate-900">
                    {receipt.totalAmount.toLocaleString()} {receipt.currency}
                  </span>
                </div>
                {receipt.paymentMethod && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Payment Method</span>
                    <span className="font-semibold text-slate-900">{receipt.paymentMethod}</span>
                  </div>
                )}
                {receipt.paidAt && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Payment Date</span>
                    <span className="font-semibold text-slate-900">
                      {new Date(receipt.paidAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-600">Transaction Reference</span>
                  <span className="font-mono text-sm text-slate-900">{receipt.paymentRef}</span>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Booking Details</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-slate-600">Booking Code</span>
                  <span className="font-mono font-semibold text-[#02665e]">{receipt.booking.bookingCode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Check-in</span>
                  <span className="font-semibold text-slate-900">
                    {new Date(receipt.booking.checkIn).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Check-out</span>
                  <span className="font-semibold text-slate-900">
                    {new Date(receipt.booking.checkOut).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Duration</span>
                  <span className="font-semibold text-slate-900">
                    {receipt.booking.nights} night{receipt.booking.nights !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Property Details */}
          <div className="mb-8 pb-8 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Property Information</h2>
            <div className="flex gap-4">
              {receipt.property.primaryImage && (
                <div className="relative w-24 h-24 rounded-lg overflow-hidden flex-shrink-0">
                  <Image
                    src={receipt.property.primaryImage}
                    alt={receipt.property.title}
                    fill
                    className="object-cover"
                  />
                </div>
              )}
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                  {receipt.property.title}
                </h3>
                <div className="flex items-center text-slate-600 mb-1">
                  <MapPin className="w-4 h-4 mr-1" />
                  <span>
                    {[
                      receipt.property.city,
                      receipt.property.district,
                      receipt.property.regionName,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
                <div className="text-sm text-slate-500 mt-2">
                  {receipt.property.type}
                </div>
              </div>
            </div>
          </div>

          {/* Guest Information */}
          {receipt.booking.guestName && (
            <div className="mb-8 pb-8 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Guest Information</h2>
              <div className="space-y-2">
                <div>
                  <span className="text-slate-600">Name: </span>
                  <span className="font-semibold text-slate-900">{receipt.booking.guestName}</span>
                </div>
                {receipt.booking.guestPhone && (
                  <div>
                    <span className="text-slate-600">Phone: </span>
                    <span className="font-semibold text-slate-900">{receipt.booking.guestPhone}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* QR Code */}
          {receipt.receiptQrPng && (
            <div className="text-center mb-8 pb-8 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Receipt QR Code</h2>
              <div className="inline-block p-4 bg-white rounded-lg border-2 border-slate-200">
                <Image
                  src={`data:image/png;base64,${receipt.receiptQrPng}`}
                  alt="Receipt QR Code"
                  width={200}
                  height={200}
                  className="mx-auto"
                />
              </div>
              <p className="text-sm text-slate-600 mt-4">
                Show this QR code at check-in for verification
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-sm text-slate-600">
            <p className="mb-2">
              Thank you for choosing NoLSAF!
            </p>
            <p>
              For any questions, please contact support or refer to your booking confirmation email.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-4 justify-center print:hidden">
          <Link
            href={`/public/properties/${receipt.property.slug}`}
            className="px-6 py-3 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
          >
            View Property
          </Link>
          <button
            onClick={handlePrint}
            className="px-6 py-3 rounded-lg bg-[#02665e] text-white hover:bg-[#014e47] transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download Receipt
          </button>
        </div>
      </div>
    </div>
  );
}

