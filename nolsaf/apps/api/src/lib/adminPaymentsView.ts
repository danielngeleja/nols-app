type PaymentSource = {
  payerPhone?: string | null;
};

type PaymentEventSource = {
  payload?: unknown;
  phone?: string | null;
};

const ACCOUNT_FIELDS = ["phoneNumber", "phone", "accountNumber", "account", "msisdn", "sourcePhone", "destinationPhone"] as const;

export function formatPaymentExportTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} EAT (UTC+3)`;
}

/** Only expose named payment metadata, never the raw provider payload. */
export function extractPaymentMetadata(payload: unknown, checkoutSessionId?: string | null) {
  const fields = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const read = (keys: string[]) => {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  return {
    bankName: read(["bankName", "bank_name"]),
    providerReference: read(["transactionId", "transactionID", "transaction_id", "providerRef", "providerReference"]) || checkoutSessionId || null,
  };
}

/** Return the payer identifier recorded by the payment flow, never profile fallback data. */
export function extractRecordedPayerAccount(invoice: PaymentSource, paymentEvent: PaymentEventSource | null): string | null {
  const eventPhone = String(paymentEvent?.phone ?? "").trim();
  if (eventPhone) return eventPhone;
  const payload = paymentEvent?.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const values = payload as Record<string, unknown>;
    for (const field of ACCOUNT_FIELDS) {
      const value = values[field];
      if (typeof value === "string" || typeof value === "number") {
        const text = String(value).trim();
        if (text) return text;
      }
    }
  }
  const payerPhone = String(invoice.payerPhone ?? "").trim();
  return payerPhone || null;
}

/** Mask a payer account before it leaves the API. */
export function maskPaymentAccount(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "").trim().replace(/[\s\-()]/g, "");
  if (!cleaned) return null;
  const digits = cleaned.replace(/\D/g, "");
  const looksLikePhone = /^(0|255|\+255|254|\+254)/.test(cleaned) || /^\d{9,10}$/.test(cleaned);
  if (looksLikePhone) {
    let local = digits;
    if (digits.startsWith("255") || digits.startsWith("254")) local = `0${digits.slice(3)}`;
    if (!local.startsWith("0") && local.length >= 9) local = `0${local}`;
    if (local.length >= 9) return `${local.slice(0, 3)}*****${local.slice(-2)}`;
  }
  if (cleaned.length <= 5) return "•".repeat(cleaned.length);
  return `${cleaned.slice(0, 3)}*****${cleaned.slice(-2)}`;
}
