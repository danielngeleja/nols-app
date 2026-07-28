"use client";

import React, { useState, useRef, useEffect } from "react";
import PaymentMethodModal, { type SelectedPaymentMethod } from "./PaymentMethodModal";

interface AzamPayButtonProps {
  invoiceId: number;
  amount: number;
  currency?: string;
  /** Pre-fill phone for MNO if bypassing the modal */
  phoneNumber?: string;
  /** Pre-fill provider for MNO if bypassing the modal */
  provider?: string;
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
  className?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  showPaymentMethodModal?: boolean;
}

type PaymentChannel = "MNO" | "BANK" | "CARD";

/**
 * AzamPay Payment Button — supports MNO, Bank, and Card channels.
 *
 * MNO / Bank: initiates payment on our API → polls for status confirmation.
 * Card:       initiates checkout → redirects browser to the hosted card page.
 *             On return, detects ?cardReturn=success|pending in the URL.
 */
export default function AzamPayButton({
  invoiceId,
  amount,
  currency = "TZS",
  phoneNumber: initialPhoneNumber,
  provider: initialProvider,
  onSuccess,
  onError,
  className = "",
  disabled: externalDisabled = false,
  children,
  showPaymentMethodModal = true,
}: AzamPayButtonProps) {
  const [isProcessing, setIsProcessing]   = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "initiating" | "pending" | "success" | "failed">("idle");
  const [showModal, setShowModal]         = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<string | undefined>(initialPhoneNumber);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastClickTimeRef   = useRef<number>(0);
  const isSubmittingRef    = useRef(false);

  // Cleanup polling on unmount
  useEffect(() => () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  }, []);

  // Stop polling when terminal status reached
  useEffect(() => {
    if (paymentStatus === "success" || paymentStatus === "failed") {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      isSubmittingRef.current = false;
      setIsProcessing(false);
    }
  }, [paymentStatus]);

  // ── Card return detection ────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params    = new URLSearchParams(window.location.search);
    const cardReturn = params.get("cardReturn");
    const ref        = params.get("ref");
    if (!cardReturn || !ref) return;

    if (cardReturn === "success") {
      setPaymentStatus("success");
      if (onSuccess) onSuccess({ cardReturn: "success", ref });
    } else {
      // "pending" — resume polling
      setPaymentStatus("pending");
      setIsProcessing(true);
      startPolling(ref);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Status polling ───────────
  const pollPaymentStatus = async (ref: string): Promise<boolean> => {
    try {
      const API_URL  = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const response = await fetch(`${API_URL}/api/payments/azampay/status/${encodeURIComponent(ref)}`, {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Status check failed");
      const data = await response.json();
      if (data.invoiceStatus === "PAID" || data.paymentStatus === "SUCCESS") {
        setPaymentStatus("success");
        if (onSuccess) onSuccess(data);
        return true;
      }
      if (data.paymentStatus === "FAILED") {
        setPaymentStatus("failed");
        if (onError) onError("Payment failed");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const startPolling = (ref: string) => {
    pollPaymentStatus(ref); // immediate first check
    let pollCount = 0;
    const maxPolls = 40; // 40 × 3s = 2 minutes
    pollingIntervalRef.current = setInterval(async () => {
      pollCount++;
      const done = await pollPaymentStatus(ref);
      if (done || pollCount >= maxPolls) {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    }, 3000);
  };

  // ── Core payment initiator ──
  const initiatePayment = async (
    channel: PaymentChannel,
    params: { phone?: string; provider?: string; bankCode?: string; accountNumber?: string; merchantMobileNumber?: string; otp?: string }
  ) => {
    // Double-click guard
    const now = Date.now();
    if (now - lastClickTimeRef.current < 500) return;
    lastClickTimeRef.current = now;
    if (isSubmittingRef.current || isProcessing) return;

    isSubmittingRef.current = true;
    setIsProcessing(true);
    setPaymentStatus("initiating");

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const key     = `azampay-${channel.toLowerCase()}-${invoiceId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      let endpoint: string;
      let body: Record<string, any>;

      if (channel === "MNO") {
        endpoint = `${API_URL}/api/payments/azampay/initiate`;
        body     = { invoiceId, idempotencyKey: key, phoneNumber: params.phone, provider: params.provider };
      } else if (channel === "BANK") {
        endpoint = `${API_URL}/api/payments/azampay/bank/initiate`;
        body     = { invoiceId, idempotencyKey: key, bankCode: params.bankCode, accountNumber: params.accountNumber, merchantMobileNumber: params.merchantMobileNumber, otp: params.otp };
      } else {
        endpoint = `${API_URL}/api/payments/coralcommerce/card/initiate`;
        body     = { invoiceId, idempotencyKey: key };
      }

      const response = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body:    JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment initiation failed");

      if (data.ok) {
        if (channel === "CARD" && data.checkoutUrl) {
          // Card: redirect to hosted card page — page is leaving, keep processing state
          setPaymentStatus("pending");
          window.location.href = data.checkoutUrl;
          return; // Don't reset isSubmittingRef — browser is navigating away
        }
        setPaymentStatus("pending");
        startPolling(data.paymentRef || data.transactionId);
      } else {
        throw new Error(data.error || "Payment initiation failed");
      }
    } catch (err: any) {
      setPaymentStatus("failed");
      if (onError) onError(err.message || "Failed to initiate payment");
    }
  };

  // ── Button click ─────────────────────────────────────────────────────────────
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (showPaymentMethodModal) {
      setShowModal(true);
    } else if (initialPhoneNumber) {
      initiatePayment("MNO", { phone: initialPhoneNumber, provider: initialProvider || "Airtel" });
    } else {
      if (onError) onError("Phone number is required for mobile payment");
    }
  };

  // ── Modal callback ───────────────────────────────────────────────────────────
  const handlePaymentMethodSelect = (method: SelectedPaymentMethod) => {
    setShowModal(false);
    if (method.method === "MNO") {
      setSelectedPhone(method.phoneNumber);
      initiatePayment("MNO", { phone: method.phoneNumber, provider: method.provider });
    } else if (method.method === "BANK") {
      initiatePayment("BANK", { bankCode: method.bankCode, accountNumber: method.accountNumber, merchantMobileNumber: method.merchantMobileNumber, otp: method.otp });
    } else {
      initiatePayment("CARD", {});
    }
  };

  const isDisabled = externalDisabled || isProcessing || paymentStatus === "pending" || paymentStatus === "success";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        className={`${className} ${isDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} transition-all duration-200`}
        aria-busy={isProcessing}
        aria-label={
          isProcessing         ? "Processing payment..."     :
          paymentStatus === "pending"  ? "Payment in progress..."  :
          "Pay securely"
        }
      >
        {isProcessing ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin">⏳</span>
            {paymentStatus === "initiating" && "Initiating payment..."}
            {paymentStatus === "pending"    && "Waiting for payment confirmation..."}
          </span>
        ) : paymentStatus === "success" ? (
          <span className="flex items-center gap-2"><span>✓</span>Payment Successful!</span>
        ) : paymentStatus === "failed" ? (
          <span className="flex items-center gap-2"><span>✗</span>Payment Failed — Click to Retry</span>
        ) : (
          children || `Pay ${amount.toLocaleString()} ${currency}`
        )}
      </button>

      {showPaymentMethodModal && (
        <PaymentMethodModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSelect={handlePaymentMethodSelect}
          invoiceId={invoiceId}
          amount={amount}
          currency={currency}
          defaultPhone={selectedPhone || initialPhoneNumber}
        />
      )}
    </>
  );
}
