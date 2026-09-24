"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BedDouble,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  FileText,
  Download,
  FlaskConical,
  Gauge,
  History,
  Landmark,
  Loader2,
  Lock,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  Smartphone,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { downloadNrmsReceipt } from "@/lib/nrmsReceiptDownload";
import PaymentMethodModal, { type SelectedPaymentMethod } from "@/components/PaymentMethodModal";
import { useNrms } from "../_components/NrmsProvider";

const titleCase = (value: unknown) => String(value ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

function ownerSettlementReference(statementId: unknown, secureToken: unknown): string {
  const suffix = String(secureToken ?? "").replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase().padStart(4, "0");
  return `NRMS-${statementId}-${suffix}`;
}

function statusBadge(status: unknown): string {
  const value = String(status ?? "").toUpperCase();
  if (["PAID", "ACTIVE", "COMPLETED"].includes(value)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["PENDING", "PROCESSING", "TRIAL", "OPEN", "PAYABLE"].includes(value)) return "border-amber-200 bg-amber-50 text-amber-700";
  if (["OVERDUE", "SUSPENDED", "FAILED", "PAYMENT_REQUIRED"].includes(value)) return "border-red-200 bg-red-50 text-red-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function isCompletedStatement(statement: any): boolean {
  if (String(statement?.status ?? "").toUpperCase() === "PAID") return true;
  return Boolean(statement?.tokens?.some((token: any) => String(token?.status ?? "").toUpperCase() === "PAID"));
}

// Ledger entry taxonomy: every classification renders with its own badge and
// amount treatment so exemptions stay visible instead of being omitted.
function ledgerMeta(classification: unknown, amount: number): {
  badge: string;
  badgeCls: string;
  amountNode: "billable" | "zero" | "trial" | "negative";
  note: string;
} {
  const value = String(classification ?? "").toUpperCase();
  if (value.includes("TRIAL")) {
    return { badge: "Trial free", badgeCls: "bg-neutral-100 text-neutral-500", amountNode: "trial", note: "Shadow usage during your free trial" };
  }
  if (value.includes("COMMISSION") || value.includes("MARKETPLACE")) {
    return { badge: "Commission only", badgeCls: "bg-blue-50 text-blue-700", amountNode: "zero", note: "NoLSAF booking, marketplace commission applies instead" };
  }
  if (value.includes("REVERS")) {
    return { badge: "Reversal", badgeCls: "bg-blue-50 text-blue-700", amountNode: "negative", note: "Reversed usage" };
  }
  if (amount <= 0) {
    return { badge: "No charge", badgeCls: "bg-neutral-100 text-neutral-500", amountNode: "zero", note: "Never billable" };
  }
  return { badge: "Billable", badgeCls: "bg-amber-50 text-amber-700", amountNode: "billable", note: "External occupied room-night" };
}

const SOURCE_LABELS: Record<string, string> = {
  WALK_IN: "walk-in",
  PHONE: "phone",
  DIRECT: "direct link",
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  EXPEDIA: "Expedia",
  NOLSAF: "NoLSAF",
  OTHER: "other",
};

function ledgerDateParts(value: unknown): { day: string; month: string } {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return { day: "—", month: "Date" };
  return {
    day: date.toLocaleDateString(undefined, { day: "2-digit" }),
    month: date.toLocaleDateString(undefined, { month: "short" }),
  };
}

function isChargeableExternalLedgerEvent(event: any): boolean {
  const source = String(event?.reservation?.source ?? "").toUpperCase();
  const classification = String(event?.classification ?? "").toUpperCase();
  const amount = Number(event?.amount ?? 0);
  if (source === "NOLSAF" || classification.includes("COMMISSION") || classification.includes("MARKETPLACE")) return false;
  if (classification.includes("TRIAL") || classification.includes("FREE") || classification.includes("EXEMPT")) return false;
  return amount > 0 || classification.includes("REVERS");
}

const SMOKE_SCENARIOS = ["empty", "reminder", "warning", "limit", "statement"] as const;
type SmokeScenario = (typeof SMOKE_SCENARIOS)[number];

type PaymentTarget = {
  token: string;
  amount: number;
  currency: string;
  initialMethod: "MNO" | "BANK" | "CARD";
};

const CHANNEL_LABELS: Record<PaymentTarget["initialMethod"], string> = { MNO: "Mobile Money", CARD: "Card", BANK: "Bank" };

function statementIssuedLabel(value: unknown): string | null {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function smokeDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

function buildSmokeAccount(scenario: SmokeScenario) {
  const balances: Record<SmokeScenario, number> = {
    empty: 0,
    reminder: 27_500,
    warning: 42_000,
    limit: 50_000,
    statement: 36_000,
  };
  const balance = balances[scenario];
  const hasUsage = scenario !== "empty";
  const hasStatement = scenario === "statement";
  const completedStatements = Array.from({ length: 50 }, (_, index) => {
    const id = 7288 - index;
    const amount = 25_000 + (index % 6) * 5_000;
    const method = ["CARD", "MOBILE_MONEY", "BANK"][index % 3];
    return {
      id,
      status: "PAID",
      amount,
      closedAt: smokeDate(index + 5),
      paidAt: smokeDate(index + 3),
      _count: { items: amount / 500 },
      tokens: [{ id: 8174 - index, token: `NRMS-SMOKE-PAID-${id}`, status: "PAID", method, amount }],
    };
  });
  return {
    status: scenario === "limit" ? "PAYMENT_REQUIRED" : "TRIAL",
    unpaidLimit: 50_000,
    unpaidBalance: balance,
    policy: { currency: "TZS", reminderAmount: 25_000, warningAmount: 40_000, roomNightPrice: 500 },
    events: hasUsage
      ? [
          { id: 9106, reservationId: 184, serviceDate: smokeDate(1), classification: "BILLABLE", amount: 500, reservation: { source: "WALK_IN", guestProfile: { fullName: "Neema Joseph" } }, allocation: { roomUnit: { code: "Family-12" }, roomType: { name: "Family" } } },
          { id: 9105, reservationId: 176, serviceDate: smokeDate(2), classification: "BILLABLE", amount: 500, reservation: { source: "PHONE", guestProfile: { fullName: "Daniel Mushi" } }, allocation: { roomUnit: { code: "Suite-4" }, roomType: { name: "Suite" } } },
          { id: 9104, reservationId: 172, serviceDate: smokeDate(2), classification: "COMMISSION_ONLY", amount: 0, reservation: { source: "NOLSAF", guestProfile: { fullName: "Grace Mrema" } }, allocation: { roomUnit: { code: "Double-2" }, roomType: { name: "Double" } } },
          { id: 9103, reservationId: 169, serviceDate: smokeDate(3), classification: "TRIAL_EXEMPT", amount: 0, reservation: { source: "WALK_IN", guestProfile: { fullName: "Amina Salum" } }, allocation: { roomUnit: { code: "Double-7" }, roomType: { name: "Double" } } },
          { id: 9102, reservationId: 166, serviceDate: smokeDate(4), classification: "BILLABLE", amount: 500, reservation: { source: "AIRBNB", guestProfile: { fullName: "Baraka Mwakyusa" } }, allocation: { roomUnit: { code: "Suite-1" }, roomType: { name: "Suite" } } },
          { id: 9101, reservationId: 163, serviceDate: smokeDate(5), classification: "BILLABLE", amount: 500, reservation: { source: "DIRECT", guestProfile: { fullName: "John Peter" } }, allocation: { roomUnit: { code: "Single-8" }, roomType: { name: "Single" } } },
        ]
      : [],
    statements: hasStatement
      ? [
          { id: 7301, status: "PAYABLE", amount: 30_000, closedAt: smokeDate(0), _count: { items: 60 }, tokens: [{ id: 8201, token: "NRMS-7A4F19C2D8E640B39F51A72C6D0E8B1439AC", status: "PENDING", amount: 30_000 }] },
          ...completedStatements,
        ]
      : [],
  };
}

const LEDGER_PAGE_SIZE = 6;
const COMPLETED_PREVIEW_COUNT = 2;
const COMPLETED_PAGE_SIZE = 8;
// If a provider never sends a completion webhook at all (abandoned USSD prompt, dropped
// network), a token would otherwise sit at PROCESSING forever with no way back for the
// owner. Matches the 4-minute wait used on the tour payment flow before offering retry.
const PROCESSING_WAIT_MS = 4 * 60 * 1000;

export default function NrmsBillingPage() {
  const { selectedPropertyId } = useNrms();
  const [account, setAccount] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [smokeScenario, setSmokeScenario] = useState<SmokeScenario | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerClassification, setLedgerClassification] = useState("");
  const [ledgerFrom, setLedgerFrom] = useState("");
  const [ledgerTo, setLedgerTo] = useState("");
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const downloadReceipt = async (token: string, statementId: number) => {
    if (receiptBusy) return;
    setReceiptBusy(token);setReceiptError(null);
    try {
      const response = await apiClient.get(`/api/owner/nrms/billing/tokens/${encodeURIComponent(token)}/receipt`);
      if (response.data?.receipt?.statementId !== statementId) throw new Error('Receipt does not match the statement');
      await downloadNrmsReceipt(response.data.receipt);
    } catch (cause: any) {
      setReceiptError(cause?.response?.data?.error || 'The receipt could not be downloaded. Please try again.');
    }
    finally {setReceiptBusy(null);}
  };
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [completedPage, setCompletedPage] = useState(1);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [channelChoice, setChannelChoice] = useState<Record<string, PaymentTarget["initialMethod"]>>({});
  const [processingSince, setProcessingSince] = useState<Record<string, number>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  const automaticPaymentState = useRef<"idle" | "creating" | "done">("idle");

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    try {
      const response = await apiClient.get(`/api/owner/nrms/billing/${selectedPropertyId}`);
      setAccount(response.data?.account);
      setError(null);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Failed to load NRMS billing");
    }
  }, [selectedPropertyId]);

  useEffect(() => {
    const requestedSmokeScenario = new URLSearchParams(window.location.search).get("smoke");
    if (process.env.NODE_ENV !== "production" && requestedSmokeScenario != null) {
      const scenario = SMOKE_SCENARIOS.includes(requestedSmokeScenario as SmokeScenario)
        ? (requestedSmokeScenario as SmokeScenario)
        : "statement";
      setSmokeScenario(scenario);
      setAccount(buildSmokeAccount(scenario));
      setError(null);
      return;
    }
    setSmokeScenario(null);
    void load();
  }, [load]);

  const copyReference = (tokenKey: string, reference: string) => {
    void navigator.clipboard?.writeText(reference);
    setCopiedToken(tokenKey);
    window.setTimeout(() => setCopiedToken((current) => (current === tokenKey ? null : current)), 1500);
  };

  const statements = account?.statements ?? [];
  const activeStatements = statements.filter((statement: any) => !isCompletedStatement(statement));
  const completedStatements = statements.filter(isCompletedStatement);
  const completedPageCount = Math.max(1, Math.ceil(completedStatements.length / COMPLETED_PAGE_SIZE));
  const currentCompletedPage = Math.min(completedPage, completedPageCount);
  const completedPageStart = (currentCompletedPage - 1) * COMPLETED_PAGE_SIZE;
  const visibleCompletedStatements = showAllCompleted
    ? completedStatements.slice(completedPageStart, completedPageStart + COMPLETED_PAGE_SIZE)
    : completedStatements.slice(0, COMPLETED_PREVIEW_COUNT);
  const allTokens = statements.flatMap((statement: any) => statement.tokens ?? []);
  const unfinishedTokenCount = allTokens.filter((token: any) => ["PENDING", "PROCESSING"].includes(String(token.status).toUpperCase())).length;

  const hasProcessingToken = Boolean(account?.statements?.some((statement: any) =>
    statement.tokens?.some((token: any) => String(token.status).toUpperCase() === "PROCESSING"),
  ));

  useEffect(() => {
    setShowAllCompleted(false);
    setCompletedPage(1);
  }, [selectedPropertyId, smokeScenario]);

  // Ticks the countdown clock every second, same cadence as the tour payment flow's
  // own wait timer - the 5s poll below only refreshes account data, it wouldn't move
  // the displayed "3:59, 3:58..." smoothly on its own.
  useEffect(() => {
    if (!hasProcessingToken) return;
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasProcessingToken]);

  useEffect(() => {
    if (smokeScenario || !hasProcessingToken) return;
    let stopped = false;
    let delay = 5_000;
    let timer: number | null = null;
    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await load();
      delay = Math.min(delay * 2, 20_000);
      if (!stopped) timer = window.setTimeout(() => void poll(), delay);
    };
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      delay = 5_000;
      if (timer) window.clearTimeout(timer);
      void poll();
    };
    timer = window.setTimeout(() => void poll(), delay);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [hasProcessingToken, load, smokeScenario]);

  // Anchor the wait clock to when a token actually started processing, not to whenever
  // this component happens to mount - a page refresh must not reset how long we've waited.
  useEffect(() => {
    for (const token of allTokens) {
      if (String(token.status).toUpperCase() !== "PROCESSING") continue;
      if (processingSince[token.token]) continue;
      setProcessingSince((current) => (current[token.token] ? current : {
        ...current,
        [token.token]: token.createdAt ? new Date(token.createdAt).getTime() : Date.now(),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTokens]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cardReturn = params.get("cardReturn");
    if (!cardReturn) return;
    setPaymentNotice(cardReturn === "success"
      ? "Card payment received. NRMS billing is refreshing your account."
      : "Card checkout was not completed. You can choose a payment channel and try again.");
  }, []);

  // A blocked reservation links here with ?pay=1. Resolve the owner's current
  // payable token (or create one for unbilled usage) and open the normal secure
  // payment-method dialog. The URL flag is consumed once so refresh/back cannot
  // repeatedly open payment or create duplicate settlement attempts.
  useEffect(() => {
    if (!account || !selectedPropertyId || paymentTarget || automaticPaymentState.current !== "idle") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("pay") !== "1") return;

    const consumePaymentFlag = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("pay");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    };
    const openToken = (token: any, statement?: any) => {
      automaticPaymentState.current = "done";
      setPaymentTarget({
        token: String(token.token),
        amount: Number(token.amount ?? statement?.amount ?? account.unpaidBalance ?? 0),
        currency: String(token.currency || statement?.currency || account.policy?.currency || "TZS"),
        initialMethod: "MNO",
      });
      consumePaymentFlag();
    };

    const payableStatements = (account.statements ?? []).filter((statement: any) => !isCompletedStatement(statement));
    for (const statement of payableStatements) {
      const token = (statement.tokens ?? []).find((entry: any) => ["PENDING", "FAILED"].includes(String(entry.status).toUpperCase()));
      if (token) {
        openToken(token, statement);
        return;
      }
    }

    const processing = payableStatements.flatMap((statement: any) => statement.tokens ?? []).find((token: any) => String(token.status).toUpperCase() === "PROCESSING");
    if (processing) {
      automaticPaymentState.current = "done";
      setPaymentNotice("A payment is already being processed. Its live status is shown below.");
      consumePaymentFlag();
      return;
    }

    if (Number(account.unpaidBalance ?? 0) <= 0) {
      automaticPaymentState.current = "done";
      setPaymentNotice("There is no outstanding NRMS balance to pay.");
      consumePaymentFlag();
      return;
    }

    if (smokeScenario) {
      openToken({
        token: "NRMS-SMOKE-DEEP-LINK",
        amount: Number(account.unpaidBalance),
        currency: account.policy?.currency || "TZS",
      });
      return;
    }

    automaticPaymentState.current = "creating";
    void apiClient.post(`/api/owner/nrms/billing/${selectedPropertyId}/token`, {}).then((response) => {
      const token = response.data?.token;
      if (!token?.token) throw new Error("PAYMENT_TOKEN_MISSING");
      openToken(token);
      void load();
    }).catch((requestError: any) => {
      automaticPaymentState.current = "done";
      consumePaymentFlag();
      setError(requestError?.response?.data?.error || "The payment option could not be prepared. Please try again.");
    });
  }, [account, load, paymentTarget, selectedPropertyId, smokeScenario]);

  if (!selectedPropertyId) return <p className="py-10 text-center text-sm text-neutral-500">Select a property to view billing.</p>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  if (!account) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm font-medium text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-700" /> Loading billing
      </div>
    );
  }

  const limit = Number(account.unpaidLimit);
  const balance = Number(account.unpaidBalance);
  const availableCredit = Math.max(0, limit - balance);
  const reminder = Number(account.policy?.reminderAmount);
  const warning = Number(account.policy?.warningAmount);
  const roomNightPrice = Number(account.policy?.roomNightPrice);
  const billingCurrency = String(account.policy?.currency || "");
  const money = (value: unknown) => `${billingCurrency ? `${billingCurrency} ` : ""}${Number(value ?? 0).toLocaleString()}`;
  const percentage = Math.min(100, Math.round((balance / limit) * 100));
  const reminderPercentage = Math.min(100, (reminder / limit) * 100);
  const warningPercentage = Math.min(100, (warning / limit) * 100);
  const usageColor = balance >= limit ? "bg-red-500" : balance >= warning ? "bg-amber-500" : balance >= reminder ? "bg-yellow-400" : "bg-emerald-600";
  const ledgerEvents = (account.events ?? []).filter(isChargeableExternalLedgerEvent);
  const ledgerClassifications: string[] = Array.from(new Set<string>(ledgerEvents.map((event: any) => String(event.classification ?? "")).filter(Boolean))).sort();
  const ledgerDateError = Boolean(ledgerFrom && ledgerTo && ledgerFrom > ledgerTo);
  const filteredLedgerEvents = ledgerEvents.filter((event: any) => {
    const query = ledgerQuery.trim().toLowerCase().replace(/^#/, "");
    const searchText = [event.id, event.reservationId, event.reservation?.guestProfile?.fullName,
      event.allocation?.roomUnit?.code, event.allocation?.roomType?.name, event.reservation?.source,
      event.classification].filter((value) => value != null).join(" ").toLowerCase();
    const date = String(event.serviceDate ?? "").slice(0, 10);
    return !ledgerDateError && (!query || searchText.includes(query))
      && (!ledgerClassification || event.classification === ledgerClassification)
      && (!ledgerFrom || date >= ledgerFrom) && (!ledgerTo || date <= ledgerTo);
  });
  const ledgerPageCount = Math.max(1, Math.ceil(filteredLedgerEvents.length / LEDGER_PAGE_SIZE));
  const currentLedgerPage = Math.min(ledgerPage, ledgerPageCount);
  const ledgerStart = (currentLedgerPage - 1) * LEDGER_PAGE_SIZE;
  const pagedLedgerEvents = filteredLedgerEvents.slice(ledgerStart, ledgerStart + LEDGER_PAGE_SIZE);
  const unpaidStatementTotal = (account.statements ?? []).reduce(
    (sum: number, statement: any) => (String(statement.status).toUpperCase() === "PAID" ? sum : sum + Number(statement.amount ?? 0)),
    0,
  );
  const liveUsage = Math.max(0, balance - unpaidStatementTotal);
  const livePercentage = Math.min(100, Math.round((liveUsage / limit) * 100));

  const requestToken = async () => {
    if (!selectedPropertyId) return;
    setBusy(true);
    if (smokeScenario) {
      setAccount((current: any) => ({
        ...current,
        statements: [{ id: 7399, status: "OPEN", amount: Number(current.unpaidBalance || 0), tokens: [{ id: 8299, token: "NRMS-1B7D46F920AC83E5714D6C20A98B5F7639AC", status: "PENDING" }] }, ...(current.statements ?? [])],
      }));
      setBusy(false);
      return;
    }
    try {
      await apiClient.post(`/api/owner/nrms/billing/${selectedPropertyId}/token`, {});
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Failed to create payment token");
    } finally {
      setBusy(false);
    }
  };

  const initiatePayment = async (method: SelectedPaymentMethod) => {
    if (!paymentTarget) return;
    const target = paymentTarget;
    setPaymentTarget(null);
    setBusyToken(target.token);
    setPaymentNotice(null);
    if (smokeScenario) {
      setAccount((current: any) => ({
        ...current,
        statements: (current.statements ?? []).map((statement: any) => ({
          ...statement,
          tokens: (statement.tokens ?? []).map((item: any) => item.token === target.token ? { ...item, status: "PROCESSING", method: method.method } : item),
        })),
      }));
      setPaymentNotice(method.method === "CARD"
        ? "Smoke preview: secure card checkout would open now."
        : method.method === "MNO"
          ? "Smoke preview: a Mobile Money approval prompt would be sent now."
          : "Smoke preview: the bank payment request would be submitted now.");
      setProcessingSince((current) => ({ ...current, [target.token]: Date.now() }));
      setBusyToken(null);
      return;
    }
    try {
      const idempotencyKey = `nrms-${method.method.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const payload = method.method === "MNO"
        ? { channel: "MNO", phoneNumber: method.phoneNumber, provider: method.provider, idempotencyKey }
        : method.method === "BANK"
          ? {
              channel: "BANK",
              bankCode: method.bankCode,
              accountNumber: method.accountNumber,
              merchantMobileNumber: method.merchantMobileNumber,
              otp: method.otp,
              idempotencyKey,
            }
          : { channel: "CARD", idempotencyKey };
      const response = await apiClient.post(
        `/api/owner/nrms/billing/tokens/${encodeURIComponent(target.token)}/initiate`,
        payload,
      );
      if (method.method === "CARD" && response.data?.checkoutUrl) {
        window.location.assign(response.data.checkoutUrl);
        return;
      }
      setPaymentNotice(response.data?.message || "Payment initiated. Complete the provider prompt to confirm it.");
      setProcessingSince((current) => ({ ...current, [target.token]: Date.now() }));
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Failed to initiate payment");
    } finally {
      setBusyToken(null);
    }
  };

  const alert = balance >= limit
    ? { className: "border-red-200 bg-red-50 text-red-800", text: "Payment is required before new external NRMS reservations can be recorded." }
    : balance >= warning
      ? { className: "border-amber-300 bg-amber-50 text-amber-900", text: `Your balance has passed the ${money(warning)} warning level.` }
      : balance >= reminder
        ? { className: "border-yellow-200 bg-yellow-50 text-yellow-900", text: `Payment reminder: your NRMS usage has reached ${money(reminder)}.` }
        : null;

  const changeSmokeScenario = (scenario: SmokeScenario) => {
    setSmokeScenario(scenario);
    setAccount(buildSmokeAccount(scenario));
    const url = new URL(window.location.href);
    url.searchParams.set("smoke", scenario);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };

  return (
    <div id="owner-billing-workspace" className="min-w-0 space-y-4 pb-10">
      <style>{`
        #owner-billing-workspace, #owner-billing-workspace * {box-sizing:border-box;}
        #owner-billing-workspace [class~="border"] {border-style:solid;}
        #owner-billing-workspace [class~="border-b"] {border-bottom-style:solid;}
        #owner-billing-workspace [class~="border-t"] {border-top-style:solid;}
        #owner-billing-workspace p, #owner-billing-workspace h1, #owner-billing-workspace h2 {margin-bottom:0;margin-top:0;}
        #owner-billing-workspace p + p, #owner-billing-workspace h1 + p, #owner-billing-workspace h2 + p {margin-top:4px;}
        #owner-billing-workspace .grid > * {min-width:0;}
        #owner-billing-workspace .text-neutral-400 {color:#64748b;}
        #owner-billing-workspace > section, #owner-billing-workspace > .grid > section {border-color:#d5dfe5;}
        #owner-billing-workspace .completed-payments-table {border-collapse:collapse;border-spacing:0;}
        #owner-billing-workspace .completed-payments-table th {padding:10px 12px;}
        #owner-billing-workspace .completed-payments-table td {padding:9px 12px;vertical-align:middle;border:0;border-bottom:1px solid #e3ebe7;}
        #owner-billing-workspace .completed-payments-table tbody tr:last-child td {border-bottom:0;}
      `}</style>
      {smokeScenario && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-3.5 sm:p-4" aria-label="Billing UI smoke test controls">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><FlaskConical className="h-4 w-4" /></span>
              <div>
                <p className="text-xs font-bold text-violet-900">Billing UI smoke mode</p>
                <p className="mt-0.5 text-[11px] text-violet-700/70">Preview data only — no billing records or payments are written.</p>
              </div>
            </div>
            <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1 lg:pb-0">
              {SMOKE_SCENARIOS.map((scenario) => (
                <button
                  key={scenario}
                  type="button"
                  onClick={() => changeSmokeScenario(scenario)}
                  aria-pressed={smokeScenario === scenario}
                  className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold capitalize transition ${
                    smokeScenario === scenario
                      ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                      : "border-violet-200 bg-white text-violet-700 hover:border-violet-300 hover:bg-violet-100"
                  }`}
                >
                  {scenario === "limit" ? "Payment required" : scenario === "statement" ? "Pending token" : scenario}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="relative isolate overflow-hidden rounded-2xl border border-[#d8dfd6] bg-[#edf2e9] p-5">
        <div className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-1/3 opacity-40" aria-hidden="true" style={{backgroundImage:'radial-gradient(circle, #9aa98f 1px, transparent 1px)',backgroundSize:'16px 16px',maskImage:'linear-gradient(to right,transparent,black)'}} />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white">
              <ReceiptText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS billing</p>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge(account.status)}`}>{titleCase(account.status)}</span>
              </div>
              <h1 className="pt-2 text-xl font-semibold tracking-tight text-neutral-950 sm:text-2xl">Usage and payments</h1>
              <p className="mt-1 text-xs leading-5 text-neutral-500 sm:text-sm">Track external room-night charges, statements and payment tokens.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-100 bg-white/85 px-3.5 py-2.5 shadow-sm">
            <CircleDollarSign className="h-4 w-4 text-emerald-700" />
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">PAYG rate</p>
              <p className="text-sm font-bold text-neutral-900">{money(roomNightPrice)} <span className="font-medium text-neutral-400">/ room-night</span></p>
            </div>
          </div>
        </div>
      </section>

      {alert && (
        <div className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-sm font-medium ${alert.className}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{alert.text}</span>
        </div>
      )}

      {paymentNotice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-sm font-medium text-blue-800" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{paymentNotice}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={ShieldCheck} label="Account status" value={titleCase(account.status)} detail="Billing access" tone="emerald" />
        <SummaryCard icon={WalletCards} label="Unpaid usage" value={money(balance)} detail={`${percentage}% of your limit`} tone={balance >= warning ? "amber" : "slate"} />
        <SummaryCard icon={CreditCard} label="Available credit" value={money(availableCredit)} detail={`Limit ${money(limit)}`} tone="blue" />
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-[#f8fafb] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <Gauge className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-neutral-900">PAYG usage meter</h2>
              <p className="mt-0.5 text-xs text-neutral-500">Your running external-stay charges</p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xl font-semibold tracking-tight text-neutral-950">{money(balance)}</p>
            <p className="text-[11px] font-medium text-neutral-400">{percentage}% of {money(limit)}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="relative h-3 overflow-hidden rounded-full border border-[#d4dde3] bg-[#e9eff2]" role="progressbar" aria-label="Unpaid usage as percentage of account limit" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full transition-[width] duration-500 ${usageColor}`} style={{ width: `${percentage}%` }} />
            <span className="absolute inset-y-0 w-px bg-yellow-500/70" style={{ left: `${reminderPercentage}%` }} aria-hidden="true" />
            <span className="absolute inset-y-0 w-px bg-amber-600/80" style={{ left: `${warningPercentage}%` }} aria-hidden="true" />
          </div>
          <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
            <Threshold label="Reminder" value={money(reminder)} color="bg-yellow-400" />
            <Threshold label="Warning" value={money(warning)} color="bg-amber-500" />
            <Threshold label="Payment required" value={money(limit)} color="bg-red-500" />
          </div>
        </div>
      </section>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <SectionHeader icon={History} title="Usage ledger" subtitle="Charged external room-nights only" count={ledgerEvents.length} />
          <div className="space-y-3 border-b border-[#d5e1dc] bg-white p-3 sm:p-4">
            <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Search usage ledger" value={ledgerQuery} onChange={(event) => {setLedgerQuery(event.target.value);setLedgerPage(1);}} placeholder="Search guest, room, reservation or source" className="h-10 w-full min-w-0 rounded-lg border border-[#cedcd5] bg-[#f9fcfa] pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></div>
            <details><summary className="cursor-pointer text-xs font-medium text-emerald-800">Advanced filters{ledgerClassification || ledgerFrom || ledgerTo ? ' · Active' : ''}</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="min-w-0 text-[11px] text-slate-600">Classification<select value={ledgerClassification} onChange={(event) => {setLedgerClassification(event.target.value);setLedgerPage(1);}} className="mt-1 h-10 w-full rounded-lg border border-[#cedcd5] bg-white px-2 text-xs"><option value="">All classifications</option>{ledgerClassifications.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
                <div className="min-w-0"><p className="text-[11px] text-slate-600">Service date from</p><div className="mt-1"><DatePickerField label="Ledger service date from" value={ledgerFrom} max={ledgerTo || undefined} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => {setLedgerFrom(next.slice(0, 10));setLedgerPage(1);}} /></div></div>
                <div className="min-w-0"><p className="text-[11px] text-slate-600">Service date to</p><div className="mt-1"><DatePickerField label="Ledger service date to" value={ledgerTo} min={ledgerFrom || undefined} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => {setLedgerTo(next.slice(0, 10));setLedgerPage(1);}} /></div></div>
              </div>
            </details>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-slate-500">{filteredLedgerEvents.length} matching of {ledgerEvents.length} loaded entries</p>{Boolean(ledgerQuery || ledgerClassification || ledgerFrom || ledgerTo) && <button type="button" onClick={() => {setLedgerQuery('');setLedgerClassification('');setLedgerFrom('');setLedgerTo('');setLedgerPage(1);}} className="border-0 bg-transparent p-0 text-[11px] font-medium text-emerald-800">Clear filters</button>}</div>
            {ledgerDateError && <p role="alert" className="text-xs text-red-700">The end date must be on or after the start date.</p>}
          </div>
          <div className="bg-neutral-50/70 p-3 sm:p-4">
            {filteredLedgerEvents.length ? (
              <>
                <div className="space-y-2.5">
                  {pagedLedgerEvents.map((event: any) => {
                    const amount = Number(event.amount ?? 0);
                    const meta = ledgerMeta(event.classification, amount);
                    const source = SOURCE_LABELS[String(event.reservation?.source ?? "").toUpperCase()] ?? null;
                    const room = event.allocation?.roomUnit?.code || event.allocation?.roomType?.name || "Room";
                    const guest = event.reservation?.guestProfile?.fullName || "Guest stay";
                    const date = ledgerDateParts(event.serviceDate);
                    const accent = meta.amountNode === "billable"
                      ? "bg-amber-400"
                      : meta.amountNode === "negative"
                        ? "bg-blue-500"
                        : meta.amountNode === "trial"
                          ? "bg-neutral-300"
                          : "bg-emerald-500";
                    return (
                      <article key={event.id} className="group relative overflow-hidden rounded-xl border border-[#d6e0e5] bg-white transition hover:border-[#a9c6b8] hover:bg-[#f9fcfa]">
                        <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden="true" />
                        <div className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] gap-3 p-3 pl-4 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:p-3.5 sm:pl-5">
                          <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-center">
                            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">{date.month}</span>
                            <span className="mt-0.5 text-base font-black leading-none tabular-nums text-neutral-800">{date.day}</span>
                          </div>

                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <p className="truncate text-sm font-semibold text-slate-800">{guest}</p>
                            </div>
                            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[10px] font-semibold text-neutral-600">
                                <BedDouble className="h-3 w-3 shrink-0" />
                                <span className="truncate">{room}</span>
                              </span>
                              {source && (
                                <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${source === "NoLSAF" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>
                                  {source}
                                </span>
                              )}
                              <span className="hidden truncate text-[10px] text-neutral-400 md:inline">{meta.note}</span>
                            </div>
                          </div>

                          <div className="col-span-2 flex items-center justify-between gap-3 border-t border-neutral-100 pt-2.5 sm:col-span-1 sm:flex-col sm:items-end sm:border-0 sm:pt-0 sm:text-right">
                            <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.06em] ${meta.badgeCls}`}>{meta.badge}</span>
                            <span
                              className={`text-sm font-semibold tabular-nums ${
                                meta.amountNode === "zero"
                                  ? "text-emerald-700"
                                  : meta.amountNode === "trial"
                                    ? "font-semibold text-neutral-400 line-through"
                                    : meta.amountNode === "negative"
                                      ? "text-blue-700"
                                      : "text-neutral-950"
                              }`}
                            >
                              {meta.amountNode === "negative" && amount > 0 ? `-${money(amount)}` : money(amount)}
                            </span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <nav aria-label="Usage ledger pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d5e1dc] bg-[#eef4f1] px-3 py-3">
                  <p className="text-[11px] text-slate-600">Showing {ledgerStart + 1}–{Math.min(ledgerStart + LEDGER_PAGE_SIZE, filteredLedgerEvents.length)} of {filteredLedgerEvents.length} entries</p>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Previous ledger page" disabled={currentLedgerPage === 1} onClick={() => setLedgerPage(currentLedgerPage - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#cbd9d2] bg-white text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                    <label className="flex items-center gap-2 text-[11px] text-slate-600">Page<select aria-label="Go to ledger page" value={currentLedgerPage} onChange={(event) => setLedgerPage(Number(event.target.value))} className="h-8 rounded-lg border border-[#cbd9d2] bg-white px-2 text-xs font-medium text-slate-800">{Array.from({length: ledgerPageCount}, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select>of {ledgerPageCount}</label>
                    <button type="button" aria-label="Next ledger page" disabled={currentLedgerPage === ledgerPageCount} onClick={() => setLedgerPage(currentLedgerPage + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#cbd9d2] bg-white text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </nav>
              </>
            ) : (
              ledgerEvents.length ? <div role="status" className="rounded-xl border border-[#d5e1dc] bg-white p-5 text-xs text-slate-600">No entries match these filters. Adjust the search or clear filters to view the ledger.</div> : <EmptyState icon={History} title="No usage recorded yet" text="External room-night charges will appear here after eligible stays are checked out." />
            )}
          </div>
        </section>

        <section id="statements" className="min-w-0 scroll-mt-24 overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <div className="relative overflow-hidden border-b border-[#cad9e9] bg-[#edf3fa] px-4 py-4 sm:px-5">
            <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-white text-blue-700 shadow-sm"><FileText className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold tracking-tight text-slate-900">Statements to pay</h2>
                {activeStatements.length > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                      {activeStatements.length} {activeStatements.length === 1 ? "statement" : "statements"} outstanding
                    </span>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[11px] text-neutral-400">Unpaid statements and payment channels</p>
                )}
              </div>
            </div>
            {balance > 0 && unfinishedTokenCount === 0 && (
              <button type="button" disabled={busy} onClick={requestToken} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {busy ? "Creating…" : "Generate token"}
              </button>
            )}
            </div>
          </div>

          <div className="space-y-3 bg-neutral-50/70 p-3 sm:p-4">
            <article className="overflow-hidden rounded-xl border border-[#c3ddcf] bg-[#f3faf6]">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Gauge className="h-[18px] w-[18px]" /></span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-neutral-900">Live usage</p>
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                        Collecting
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-neutral-400">Room-nights recorded after the last statement</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">Running total</p>
                  <strong className="mt-0.5 block text-lg font-semibold tracking-tight text-slate-900">{money(liveUsage)}</strong>
                  <p className="mt-0.5 text-[10px] text-neutral-400">of {money(limit)}</p>
                </div>
              </div>
              <div className="px-4 pb-3.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${livePercentage}%` }} />
                </div>
                <p className="mt-2 text-[10px] leading-4 text-neutral-500">When it reaches {money(limit)} a statement is completed and you generate a token to pay it. Usage then keeps collecting here toward the next {money(limit)}.</p>
              </div>
            </article>
            {activeStatements.length ? (
              activeStatements.map((statement: any) => (
                <article key={statement.id} className="overflow-hidden rounded-xl border border-[#cbd9e8] bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8e2ed] bg-[#f0f5fb] px-4 py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-white text-blue-700 shadow-sm"><ReceiptText className="h-[18px] w-[18px]" /></span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold text-neutral-900">Statement #{statement.id}</p>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusBadge(statement.status)}`}>{titleCase(statement.status)}</span>
                        </div>
                        <p className="mt-1 text-[10px] text-neutral-400">
                          NRMS room-night settlement
                          {statementIssuedLabel(statement.closedAt) ? ` · issued ${statementIssuedLabel(statement.closedAt)}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">Amount due</p>
                      <strong className="mt-0.5 block text-lg font-semibold tracking-tight text-slate-900">{money(statement.amount)}</strong>
                      {Number(statement._count?.items ?? 0) > 0 && roomNightPrice > 0 && (
                        <p className="mt-0.5 text-[10px] text-neutral-400">
                          {statement._count.items} {statement._count.items === 1 ? "room-night" : "room-nights"} × {money(roomNightPrice)}
                        </p>
                      )}
                    </div>
                  </div>
                  {statement.tokens?.map((token: any) => {
                    const reference = ownerSettlementReference(statement.id, token.token);
                    const selectedMethod = channelChoice[token.token] ?? "MNO";
                    const isBusy = busyToken === token.token;
                    const tokenStatus = String(token.status).toUpperCase();
                    const startedAt = processingSince[token.token] ?? (token.createdAt ? new Date(token.createdAt).getTime() : null);
                    const elapsedMs = startedAt != null ? nowTick - startedAt : 0;
                    const stalled = tokenStatus === "PROCESSING" && startedAt != null && elapsedMs > PROCESSING_WAIT_MS;
                    const waiting = tokenStatus === "PROCESSING" && !stalled;
                    const remainingSeconds = Math.max(0, Math.ceil((PROCESSING_WAIT_MS - elapsedMs) / 1000));
                    return (
                    <div key={token.id} className="space-y-3 p-3 sm:p-4">
                      <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm ring-1 ring-blue-100"><ShieldCheck className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-blue-700">Settlement reference</p>
                              <p className="mt-0.5 break-all font-mono text-[11px] font-medium tracking-wide text-neutral-700">{reference}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusBadge(token.status)}`}>{titleCase(token.status)}</span>
                            <button
                              type="button"
                              aria-label="Copy settlement reference"
                              onClick={() => copyReference(token.token, reference)}
                              className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-white px-2 py-0.5 text-[9px] font-bold text-blue-700 shadow-sm transition hover:bg-blue-50"
                            >
                              {copiedToken === token.token ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              {copiedToken === token.token ? "Copied" : "Copy"}
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 border-t border-blue-100 pt-2 text-[10px] leading-4 text-neutral-500">Use this reference for support and payment tracking.</p>
                      </div>
                      {waiting && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-center">
                          <div className="mb-1 flex items-center justify-center gap-1.5">
                            {token.method === "CARD" ? <CreditCard className="h-3.5 w-3.5 text-amber-600" />
                              : token.method === "BANK" ? <Landmark className="h-3.5 w-3.5 text-amber-600" />
                              : <Smartphone className="h-3.5 w-3.5 animate-pulse text-amber-600" />}
                            <p className="text-[11px] font-bold text-amber-800">
                              {token.method === "CARD" ? "Verifying your card payment..."
                                : token.method === "BANK" ? "Confirming bank checkout"
                                : "Check your phone for a payment prompt"}
                            </p>
                          </div>
                          <div className="flex items-center justify-center gap-1.5 text-amber-700">
                            <Clock3 className="h-3.5 w-3.5" />
                            <span className="font-mono text-sm font-bold">{formatCountdown(remainingSeconds)}</span>
                            <span className="text-[10px]">remaining</span>
                          </div>
                        </div>
                      )}
                      {stalled && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-4 text-amber-800">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>This payment is taking longer than expected. It may still complete, but you can try again below or choose a different channel.</span>
                        </div>
                      )}
                      {(["PENDING", "FAILED"].includes(tokenStatus) || stalled) && (
                        <div className="rounded-lg border border-neutral-100 bg-neutral-50/70 p-2.5">
                          <div className="mb-2 flex items-center gap-2">
                            <WalletCards className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                            <p className="text-[10px] font-semibold text-neutral-600">
                              {tokenStatus === "FAILED" || stalled ? "Try another payment channel" : "Choose a payment channel"}
                            </p>
                          </div>
                          <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr] gap-1.5 sm:gap-2">
                          {([
                            ['MNO', 'Mobile Money', Smartphone, 'text-emerald-600'],
                            ['CARD', 'Card', CreditCard, 'text-blue-600'],
                            ['BANK', 'Bank', Landmark, 'text-amber-600'],
                          ] as const).map(([method, label, Icon, iconColor]) => (
                            <button
                              key={method}
                              type="button"
                              disabled={isBusy}
                              aria-pressed={selectedMethod === method}
                              aria-label={`Pay statement using ${label}`}
                              onClick={() => setChannelChoice((current) => ({ ...current, [token.token]: method }))}
                              className={`group inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border px-1.5 text-[10px] font-bold shadow-[0_5px_16px_-14px_rgba(15,23,42,0.7)] transition focus:outline-none focus-visible:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-100 disabled:cursor-wait disabled:opacity-60 sm:gap-2 sm:px-3 sm:text-[11px] ${
                                selectedMethod === method
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                  : "border-neutral-200 bg-white text-neutral-600 hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-800"
                              }`}
                            >
                              <Icon className={`h-3.5 w-3.5 shrink-0 transition-transform group-hover:-translate-y-px ${iconColor}`} />
                              <span className="min-w-0 break-words text-center leading-[1.15]">{label}</span>
                            </button>
                          ))}
                          </div>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setPaymentTarget({
                              token: token.token,
                              amount: Number(token.amount ?? statement.amount),
                              currency: token.currency || statement.currency || billingCurrency,
                              initialMethod: selectedMethod,
                            })}
                            className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
                          >
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                            {isBusy ? "Opening…" : `Pay ${money(token.amount ?? statement.amount)} with ${CHANNEL_LABELS[selectedMethod]}`}
                          </button>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </article>
              ))
            ) : (
              <EmptyState icon={FileText} title="No outstanding statements" text="A statement will appear here when usage reaches payment or you request a token." compact />
            )}
          </div>
        </section>
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader
          icon={CheckCircle2}
          title="Completed payments"
          subtitle="Paid NRMS statements and settlement references"
          count={completedStatements.length}
        />
        <div className="bg-emerald-50/35 p-3 sm:p-4">
          {completedStatements.length ? (
            <>
              {receiptError && <p role="alert" className="mb-3 text-xs text-red-700">{receiptError}</p>}
              <div className="overflow-x-auto rounded-xl border border-[#cddfd5] bg-white">
              <table className="completed-payments-table w-full min-w-[1050px] table-fixed text-left text-xs"><colgroup>{[9,19,12,12,17,19,12].map((width, index) => <col key={index} style={{width:`${width}%`}} />)}</colgroup><thead className="bg-[#eef4f1]"><tr>{['Statement ID','Settlement reference','Amount paid','Payment method','Paid at (EAT)','Verification / reconciliation','Receipt'].map((label) => <th key={label} className="px-3 py-3 text-[10px] font-medium text-slate-600">{label}</th>)}</tr></thead><tbody>
              {visibleCompletedStatements.map((statement: any) => {
                const paidToken = statement.tokens?.find((token: any) => String(token.status).toUpperCase() === "PAID" && token.payment) ?? statement.tokens?.find((token: any) => String(token.status).toUpperCase() === "PAID");
                const reference = paidToken ? ownerSettlementReference(statement.id, paidToken.token) : null;
                const payment = paidToken?.payment;
                const manual = payment?.status === 'MANUALLY_VERIFIED' || payment?.provider === 'ADMIN_MANUAL';
                const timestamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString('en-GB', {timeZone:'Africa/Dar_es_Salaam',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Not recorded';
                return (
                  <tr key={statement.id} className="hover:bg-[#f7faf8]">
                    <td className="border-b border-solid border-slate-100 px-3 py-4 text-slate-700">#{statement.id}</td>
                    <td className="border-b border-solid border-slate-100 px-3 py-4"><span className="break-all font-mono text-[11px] text-slate-700">{reference ?? 'Not recorded'}</span>{reference && <button type="button" aria-label={`Copy reference for statement ${statement.id}`} onClick={() => copyReference(paidToken.token, reference)} className="ml-2 border-0 bg-transparent p-1 text-emerald-700">{copiedToken === paidToken.token ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</button>}</td>
                    <td className="border-b border-solid border-slate-100 px-3 py-4 font-medium tabular-nums text-slate-900">{money(payment?.amount ?? statement.amount)}</td>
                    <td className="border-b border-solid border-slate-100 px-3 py-4 text-slate-600">{paidToken?.method ? titleCase(paidToken.method) : 'Not recorded'}</td>
                    <td className="border-b border-solid border-slate-100 px-3 py-4 text-slate-600">{manual ? 'Not recorded independently' : timestamp(statement.paidAt)}</td>
                    <td className="border-b border-solid border-slate-100 px-3 py-4"><span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] text-emerald-800">{manual ? 'Manually reconciled' : payment ? 'Provider verified' : 'Not recorded'}</span><p className="pt-2 text-[10px] text-slate-500">{timestamp(payment?.verifiedAt)}</p></td>
                    <td className="border-b border-solid border-slate-100 px-3 py-4"><button type="button" aria-label={`Download receipt for statement ${statement.id}`} title={payment ? 'Download receipt' : 'Receipt not available'} disabled={!payment || receiptBusy !== null} onClick={() => void downloadReceipt(paidToken.token, statement.id)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#c3d7cc] bg-emerald-50 text-emerald-800 disabled:opacity-40">{receiptBusy === paidToken?.token ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</button></td>
                  </tr>
                );
              })}
              </tbody></table>
              </div>

              {!showAllCompleted && completedStatements.length > COMPLETED_PREVIEW_COUNT && (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-100 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                  <p className="text-[11px] font-medium text-neutral-500">
                    Showing the <strong className="text-neutral-800">2 most recent</strong> of <strong className="text-neutral-800">{completedStatements.length}</strong> completed payments
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCompletedPage(1);
                      setShowAllCompleted(true);
                    }}
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-emerald-700 px-4 text-[10px] font-bold text-white shadow-sm transition hover:bg-emerald-800"
                  >
                    View more ({completedStatements.length - COMPLETED_PREVIEW_COUNT}) <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {showAllCompleted && (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-100 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                  <p className="text-[11px] font-medium text-neutral-500">
                    Showing <strong className="text-neutral-800">{completedPageStart + 1}–{Math.min(completedPageStart + COMPLETED_PAGE_SIZE, completedStatements.length)}</strong> of <strong className="text-neutral-800">{completedStatements.length}</strong> completed payments
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAllCompleted(false);
                        setCompletedPage(1);
                      }}
                      className="inline-flex min-h-9 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Show less
                    </button>
                    {completedStatements.length > COMPLETED_PAGE_SIZE && (
                      <>
                        <button
                          type="button"
                          disabled={currentCompletedPage === 1}
                          onClick={() => setCompletedPage(currentCompletedPage - 1)}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" /> Previous
                        </button>
                        <span className="min-w-20 text-center text-[10px] font-bold text-neutral-500">Page {currentCompletedPage} of {completedPageCount}</span>
                        <button
                          type="button"
                          disabled={currentCompletedPage === completedPageCount}
                          onClick={() => setCompletedPage(currentCompletedPage + 1)}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Next <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <EmptyState icon={CheckCircle2} title="No completed payments yet" text="Paid statements will move here automatically after payment confirmation." compact />
          )}
        </div>
      </section>

      {paymentTarget && (
        <PaymentMethodModal
          isOpen
          onClose={() => setPaymentTarget(null)}
          onSelect={(method) => void initiatePayment(method)}
          amount={paymentTarget.amount}
          currency={paymentTarget.currency}
          initialMethod={paymentTarget.initialMethod}
        />
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: "emerald" | "slate" | "amber" | "blue" }) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    slate: "border-neutral-200 bg-neutral-100 text-neutral-600",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-blue-100 bg-blue-50 text-blue-700",
  } as const;
  const surfaces = {
    emerald: "border-[#b9daca] bg-[#eaf5ee]",
    slate: "border-[#d1dbe2] bg-[#f0f4f7]",
    amber: "border-[#e6d5ae] bg-[#faf2df]",
    blue: "border-[#bfd4eb] bg-[#eaf2fb]",
  } as const;
  return (
    <div className={`flex min-w-0 items-center gap-3.5 rounded-xl border p-4 ${surfaces[tone]}`}>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
        <p className="mt-1 break-words text-lg font-semibold tracking-tight text-neutral-950">{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-neutral-400">{detail}</p>
      </div>
    </div>
  );
}

function Threshold({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#dce3e8] bg-white px-3 py-2 text-neutral-500">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      <span className="min-w-0 truncate"><strong className="font-semibold text-neutral-700">{label}</strong> · {value}</span>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, count }: { icon: LucideIcon; title: string; subtitle: string; count: number }) {
  return (
    <div className="relative overflow-hidden border-b border-[#d5e1dc] bg-[#eef4f1] px-4 py-4 sm:px-5">
      <div className="relative flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-neutral-900">{title}</h2>
          <p className="mt-0.5 truncate text-[11px] text-neutral-400">{subtitle}</p>
        </div>
      </div>
      <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm">{count} {count === 1 ? "entry" : "entries"}</span>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text, compact = false }: { icon: LucideIcon; title: string; text: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center px-5 text-center ${compact ? "min-h-44 py-7" : "min-h-52 py-9"}`}>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 text-neutral-300"><Icon className="h-5 w-5" /></span>
      <p className="mt-3 text-sm font-bold text-neutral-700">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-5 text-neutral-400">{text}</p>
      <div className="mt-3 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700/60">
        <CheckCircle2 className="h-3 w-3" /> Nothing requires action
      </div>
    </div>
  );
}
