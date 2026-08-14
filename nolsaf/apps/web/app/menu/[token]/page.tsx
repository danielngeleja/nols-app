"use client";

/**
 * Public QR guest ordering page (NRMS_QR_ORDERING.md milestone 4).
 * No login: the order-point token in the URL is the capability.
 * Mobile-first; a guest scans the room/table QR and lands here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChefHat,
  ChevronLeft,
  Clock3,
  Heart,
  History,
  Loader2,
  MapPin,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Star,
  UtensilsCrossed,
  Wine,
  X,
  XCircle,
} from "lucide-react";

type MenuItem = {
  id: number;
  name: string;
  category: string | null;
  price: number;
  description: string | null;
  imageUrl: string | null;
  inStock: boolean;
  sortOrder: number;
};

type Outlet = {
  id: number;
  name: string;
  type: string;
  currency: string;
  categoryOrder: string[] | null;
  menuItems: MenuItem[];
};

type MenuData = {
  property: { title: string };
  point: { type: "ROOM" | "TABLE"; label: string };
  // False only for the read-only preview linked from a public property page,
  // browsed before ever booking. Absent (older cached response shape) is
  // treated as enabled, same as every real QR scan.
  orderingEnabled?: boolean;
  roomChargeAvailable?: boolean;
  outlets: Outlet[];
};

type PayInstruction = { label: string; value: string; name: string | null };

type PublicOrder = {
  orderNumber: string;
  status: string;
  settlementMode?: string;
  settlementMethod?: string | null;
  guestPaymentMethod?: string | null;
  total: number;
  currency: string;
  note: string | null;
  outlet: { name: string; type: string } | null;
  point: { type: string; label: string } | null;
  items: Array<{ name: string; quantity: number; lineTotal: number }>;
  placedAt: string | null;
  confirmedAt: string | null;
  preparingAt: string | null;
  servingAt: string | null;
  servedAt: string | null;
  postedAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  guestRating: number | null;
  guestFeedback: string | null;
  tipIntent: string | null;
  tipSuggestedAmount: number | null;
  feedbackAt: string | null;
};

type RecentOrder = { code: string; order: PublicOrder };

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function orderTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function elapsedBetween(previous: string | null, current: string | null): string | null {
  if (!previous || !current) return null;
  const elapsedMs = new Date(current).getTime() - new Date(previous).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  if (elapsedMs < 60_000) return "<1 min";
  const elapsedMinutes = Math.round(elapsedMs / 60_000);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function storageKey(token: string): string {
  return `nolsaf:qr-order:${token}`;
}

function historyStorageKey(token: string): string {
  return `nolsaf:qr-order-history:${token}`;
}

function readOrderHistory(token: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(historyStorageKey(token)) || "[]");
    return Array.isArray(stored) ? stored.filter((code): code is string => typeof code === "string" && code.length > 0).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function writeOrderHistory(token: string, codes: string[]): void {
  try { localStorage.setItem(historyStorageKey(token), JSON.stringify([...new Set(codes)].slice(0, 5))); } catch {}
}

function rememberOrderCode(token: string, code: string): void {
  writeOrderHistory(token, [code, ...readOrderHistory(token).filter((storedCode) => storedCode !== code)]);
}

function forgetOrderCode(token: string, code: string): void {
  writeOrderHistory(token, readOrderHistory(token).filter((storedCode) => storedCode !== code));
}

function guestStatusLabel(status: string): string {
  if (status === "PLACED") return "Received";
  if (status === "CONFIRMED") return "Accepted";
  if (status === "PREPARING") return "Preparing";
  if (status === "SERVING") return "On the way";
  if (status === "SETTLED") return "Served · paid";
  if (status === "POSTED_TO_FOLIO") return "Served · room bill";
  if (["CANCELLED", "VOIDED"].includes(status)) return "Cancelled";
  return status.replaceAll("_", " ").toLowerCase();
}

function paymentMethodLabel(method?: string | null): string {
  if (!method) return "Payment method not selected";
  if (method === "MOBILE_MONEY") return "Mobile money";
  if (method === "BANK") return "Bank transfer";
  return method.charAt(0) + method.slice(1).toLowerCase();
}

function instructionMatchesPayment(method: string | null | undefined, instruction: PayInstruction): boolean {
  const text = `${instruction.label} ${instruction.value} ${instruction.name ?? ""}`.toLowerCase();
  if (method === "MOBILE_MONEY") return /mobile|m[ -]?pesa|lipa|tigo|airtel|halopesa|mixx|momo/.test(text);
  if (method === "BANK") return /bank|account|iban|swift/.test(text);
  if (method === "CARD") return /card|pos|visa|mastercard/.test(text);
  if (method === "OTHER") return true;
  return false;
}

function shortOrderDate(value: string | null): string {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent";
  return date.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_STEPS = [
  { key: "PLACED", label: "Order received", icon: Clock3 },
  { key: "CONFIRMED", label: "Accepted", icon: CheckCircle2 },
  { key: "PREPARING", label: "Preparing your order", icon: ChefHat },
  { key: "SERVING", label: "On the way to you", icon: UtensilsCrossed },
  { key: "DONE", label: "Served", icon: UtensilsCrossed },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
] as const;

const GUEST_FONT_STYLE = { fontFamily: '"Trebuchet MS", Tahoma, Arial, sans-serif' } as const;

function statusStepIndex(status: string): number {
  if (status === "PLACED") return 0;
  if (status === "CONFIRMED") return 1;
  if (status === "PREPARING") return 2;
  if (status === "SERVING") return 3;
  if (["SETTLED", "POSTED_TO_FOLIO"].includes(status)) return 4;
  return -1;
}

export default function GuestMenuPage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeOutletId, setActiveOutletId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<Map<number, number>>(new Map());
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [chargeToRoom, setChargeToRoom] = useState(false);
  const [guestPaymentMethod, setGuestPaymentMethod] = useState("");
  const [payInstructions, setPayInstructions] = useState<PayInstruction[]>([]);

  const [trackedCode, setTrackedCode] = useState<string | null>(null);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackTipPercent, setFeedbackTipPercent] = useState<number | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load menu ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/nrms/menu/${encodeURIComponent(token)}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data?.error || "This QR code is not valid.");
        } else {
          setMenu(data);
          setActiveOutletId(data?.outlets?.[0]?.id ?? null);
        }
      } catch {
        if (!cancelled) setLoadError("Could not load the menu. Please check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Restore the active order and recent receipts saved on this device.
  useEffect(() => {
    let cancelled = false;
    const activeCode = (() => {
      try { return localStorage.getItem(storageKey(token)); } catch { return null; }
    })();
    if (activeCode) {
      setTrackedCode(activeCode);
      rememberOrderCode(token, activeCode);
    }

    const codes = readOrderHistory(token);
    if (codes.length === 0) return () => { cancelled = true; };
    void Promise.all(codes.map(async (code) => {
      try {
        const res = await fetch(`/api/public/nrms/orders/${encodeURIComponent(code)}`, { cache: "no-store" });
        if (res.status === 404) {
          forgetOrderCode(token, code);
          return null;
        }
        const data = await res.json().catch(() => ({}));
        return res.ok && data?.order ? { code, order: data.order as PublicOrder } : null;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!cancelled) setRecentOrders(entries.filter((entry): entry is RecentOrder => entry != null));
    });
    return () => { cancelled = true; };
  }, [token]);

  // ── Poll order status ──────────────────────────────────────
  const fetchOrder = useCallback(async (code: string) => {
    try {
      const res = await fetch(`/api/public/nrms/orders/${encodeURIComponent(code)}`, { cache: "no-store" });
      if (res.status === 404) {
        setTrackedCode(null);
        setOrder(null);
        try { localStorage.removeItem(storageKey(token)); } catch {}
        forgetOrderCode(token, code);
        setRecentOrders((current) => current.filter((entry) => entry.code !== code));
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.order) {
        setOrder(data.order);
        setPayInstructions(Array.isArray(data?.payInstructions) ? data.payInstructions : []);
        rememberOrderCode(token, code);
        setRecentOrders((current) => [{ code, order: data.order }, ...current.filter((entry) => entry.code !== code)].slice(0, 5));
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!trackedCode) return;
    void fetchOrder(trackedCode);
    pollRef.current = setInterval(() => void fetchOrder(trackedCode), 7000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [trackedCode, fetchOrder]);

  // Stop polling once the order is finished.
  useEffect(() => {
    if (!order) return;
    if (["SETTLED", "POSTED_TO_FOLIO", "CANCELLED", "VOIDED"].includes(order.status) && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [order]);

  const activeOutlet = useMemo(
    () => menu?.outlets.find((o) => o.id === activeOutletId) ?? null,
    [menu, activeOutletId],
  );
  const isBarOutlet = activeOutlet?.type === "BAR";

  // Cart holds items from one outlet at a time (orders are per outlet).
  const cartLines = useMemo(() => {
    if (!activeOutlet) return [];
    return [...cart.entries()]
      .map(([id, quantity]) => {
        const item = activeOutlet.menuItems.find((m) => m.id === id);
        return item ? { item, quantity } : null;
      })
      .filter(Boolean) as Array<{ item: MenuItem; quantity: number }>;
  }, [cart, activeOutlet]);

  const cartTotal = cartLines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  const categories = useMemo(() => {
    if (!activeOutlet) return [];
    const grouped = new Map<string, MenuItem[]>();
    for (const item of activeOutlet.menuItems) {
      const category = item.category?.trim() || "Menu";
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category)!.push(item);
    }
    const preferred = Array.isArray(activeOutlet.categoryOrder) ? activeOutlet.categoryOrder : [];
    const ordered: Array<{ name: string; items: MenuItem[] }> = [];
    for (const name of preferred) {
      if (grouped.has(name)) {
        ordered.push({ name, items: grouped.get(name)! });
        grouped.delete(name);
      }
    }
    for (const [name, items] of grouped) ordered.push({ name, items });
    return ordered;
  }, [activeOutlet]);

  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return categories;
    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) =>
          [item.name, item.description, item.category]
            .filter(Boolean)
            .some((value) => String(value).toLocaleLowerCase().includes(query)),
        ),
      }))
      .filter((category) => category.items.length > 0);
  }, [categories, searchQuery]);

  const menuSections = useMemo(() => {
    if (!isBarOutlet) return filteredCategories;
    const shelfItems = filteredCategories.flatMap((category) => category.items);
    return shelfItems.length > 0 ? [{ name: "On the shelf", items: shelfItems }] : [];
  }, [filteredCategories, isBarOutlet]);

  const orderingEnabled = menu?.orderingEnabled !== false;

  const changeQty = (itemId: number, delta: number) => {
    // Preview menus (linked from a public property page) never accept
    // orders: refusing here keeps every basket surface honestly empty
    // instead of a button that adds an item nothing downstream can send.
    if (!orderingEnabled) return;
    setCart((current) => {
      const next = new Map(current);
      const qty = (next.get(itemId) ?? 0) + delta;
      if (qty <= 0) next.delete(itemId);
      else next.set(itemId, Math.min(qty, 20));
      return next;
    });
  };

  const switchOutlet = (outletId: number) => {
    if (outletId === activeOutletId) return;
    setActiveOutletId(outletId);
    setSearchQuery("");
    setSelectedCategory(null);
    setCart(new Map());
    setCartOpen(false);
  };

  const jumpToCategory = (name: string, index: number) => {
    setSelectedCategory(name);
    document.getElementById(`menu-category-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const placeOrder = async () => {
    if (!activeOutlet || cartLines.length === 0 || placing) return;
    if (!chargeToRoom && !guestPaymentMethod) {
      setPlaceError("Choose how you intend to pay before sending the order.");
      return;
    }
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch(`/api/public/nrms/menu/${encodeURIComponent(token)}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: activeOutlet.id,
          note: note.trim() || null,
          chargeToRoom: chargeToRoom || undefined,
          paymentMethod: chargeToRoom ? null : guestPaymentMethod,
          items: cartLines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPlaceError(data?.error || "Could not place the order. Please try again.");
        return;
      }
      const code = data?.publicCode as string;
      setCart(new Map());
      setNote("");
      setCartOpen(false);
      setChargeToRoom(false);
      setGuestPaymentMethod("");
      setOrder(data.order);
      setTrackedCode(code);
      try { localStorage.setItem(storageKey(token), code); } catch {}
      rememberOrderCode(token, code);
      setRecentOrders((current) => [{ code, order: data.order }, ...current.filter((entry) => entry.code !== code)].slice(0, 5));
    } catch {
      setPlaceError("Could not place the order. Please check your connection and try again.");
    } finally {
      setPlacing(false);
    }
  };

  const dismissOrder = () => {
    if (trackedCode && order) {
      rememberOrderCode(token, trackedCode);
      setRecentOrders((current) => [{ code: trackedCode, order }, ...current.filter((entry) => entry.code !== trackedCode)].slice(0, 5));
    }
    setTrackedCode(null);
    setOrder(null);
    try { localStorage.removeItem(storageKey(token)); } catch {}
  };

  const openRecentOrder = (entry: RecentOrder) => {
    setOrder(entry.order);
    setTrackedCode(entry.code);
    try { localStorage.setItem(storageKey(token), entry.code); } catch {}
    rememberOrderCode(token, entry.code);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitFeedback = async () => {
    if (!trackedCode || !order || feedbackRating < 1 || feedbackSubmitting) return;
    const tipAmount = feedbackTipPercent && feedbackTipPercent > 0
      ? Math.round(order.total * (feedbackTipPercent / 100))
      : null;
    setFeedbackSubmitting(true);
    setFeedbackError(null);
    try {
      const res = await fetch(`/api/public/nrms/orders/${encodeURIComponent(trackedCode)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: feedbackRating,
          comment: feedbackComment.trim() || null,
          tipIntent: feedbackTipPercent == null ? null : feedbackTipPercent === 0 ? "NONE" : "INTERESTED",
          tipAmount,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedbackError(data?.error || "Could not save your feedback. Please try again.");
        return;
      }
      if (data?.order) {
        setOrder(data.order);
        setRecentOrders((current) => [{ code: trackedCode, order: data.order }, ...current.filter((entry) => entry.code !== trackedCode)].slice(0, 5));
      }
    } catch {
      setFeedbackError("Could not save your feedback. Please check your connection and try again.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-neutral-400" style={GUEST_FONT_STYLE}>
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }

  if (loadError || !menu) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6" style={GUEST_FONT_STYLE}>
        <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" />
          <p className="m-0 text-sm font-bold text-neutral-900">{loadError || "This QR code is not valid."}</p>
          <p className="mb-0 mt-2 text-xs text-neutral-400">Please ask a staff member for help.</p>
        </div>
      </div>
    );
  }

  const pointLabel = `${menu.point.type === "ROOM" ? "Room" : "Table"} ${menu.point.label}`;

  // Live order tracking view (replaces the menu while an order is open).
  if (order && trackedCode) {
    const cancelled = ["CANCELLED", "VOIDED"].includes(order.status);
    const paymentConfirmed = order.status === "SETTLED";
    const postedToRoom = order.status === "POSTED_TO_FOLIO";
    const done = paymentConfirmed || postedToRoom;
    const stepIndex = done ? 5 : statusStepIndex(order.status);
    const isTrackedBar = order.outlet?.type === "BAR";
    const paymentStep = {
      key: "PAYMENT",
      label: paymentConfirmed ? "Payment confirmed" : postedToRoom ? "Added to room bill" : order.settlementMode === "ROOM_FOLIO" ? "Room bill pending" : `${paymentMethodLabel(order.guestPaymentMethod)} selected · payment pending`,
      icon: done ? ShieldCheck : ReceiptText,
    };
    const trackingSteps = isTrackedBar
      ? [
          { key: "PLACED", label: "Order received", icon: Clock3 },
          { key: "CONFIRMED", label: "Accepted by the bar team", icon: CheckCircle2 },
          { key: "PREPARING", label: "Preparing your drinks", icon: Wine },
          { key: "SERVING", label: "On the way to you", icon: Wine },
          { key: "DONE", label: "Served", icon: CheckCircle2 },
          paymentStep,
        ]
      : [...STATUS_STEPS, paymentStep];
    const settlementTime = postedToRoom ? order.postedAt : order.settledAt;
    const trackingTimes = [order.placedAt, order.confirmedAt, order.preparingAt, order.servingAt, order.servedAt ?? settlementTime, settlementTime];
    const activeStep = trackingSteps[Math.max(stepIndex, 0)];
    const statusMessage = done
      ? paymentConfirmed
        ? `Payment has been confirmed by the attendant${order.settlementMethod ? ` via ${order.settlementMethod.replaceAll("_", " ").toLowerCase()}` : ""}. Thank you.`
        : "Service is complete and the amount has been added to your room bill."
      : stepIndex === 2
        ? isTrackedBar
          ? "Your drinks are being prepared now."
          : "The kitchen is preparing your order now."
        : stepIndex === 3
          ? "Your prepared order is on the way to you. Payment has not been confirmed yet."
        : stepIndex === 1
          ? isTrackedBar
            ? "Your order is confirmed and queued for drink preparation."
            : "Your order is confirmed and queued for the kitchen."
          : `${order.outlet?.name ?? "The property team"} has your order and will confirm it shortly.`;
    const selectedTipAmount = feedbackTipPercent && feedbackTipPercent > 0
      ? Math.round(order.total * (feedbackTipPercent / 100))
      : null;
    const selectedPayInstructions = payInstructions.filter((instruction) => instructionMatchesPayment(order.guestPaymentMethod, instruction));
    return (
      <div className="min-h-screen overflow-x-hidden bg-[#f6f4ef] pb-10 text-neutral-950" style={GUEST_FONT_STYLE}>
        <header className="relative mx-2 mt-2 overflow-hidden rounded-[14px] bg-[#073f35] text-white shadow-[0_14px_38px_rgba(7,63,53,0.14)] sm:mx-4 sm:mt-4 sm:rounded-[18px]">
          <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute right-0 top-0 h-44 w-64 bg-emerald-400/10 blur-3xl" />
          <div className="relative mx-auto max-w-5xl px-5 pb-10 pt-5 sm:px-8 sm:pb-12 sm:pt-7">
            <div className="flex items-center justify-between gap-4">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200/80">{menu.property.title}</p>
              {!cancelled && (
                <span className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[10px] font-bold text-emerald-50 ring-1 ring-white/10">
                  <span className={`h-2 w-2 rounded-full ${done ? "bg-emerald-200" : "animate-pulse bg-emerald-300"}`} />
                  {done ? "Order complete" : "Live updates"}
                </span>
              )}
            </div>
            <div className="mt-5 flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10 text-emerald-100 ring-1 ring-white/10">
                {isTrackedBar ? <Wine className="h-5 w-5" /> : <UtensilsCrossed className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200/75">Guest order tracking</p>
                <h1 className="mb-0 mt-1 text-[28px] font-bold leading-tight tracking-[-0.025em] sm:text-[34px]">{cancelled ? "Order cancelled" : done ? "Your order is complete" : "We’re on it"}</h1>
                <p className="mb-0 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-emerald-100/70 sm:text-sm">
                  <span>{order.orderNumber}</span><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {pointLabel}</span>
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="relative mx-auto -mt-5 max-w-5xl px-4 sm:-mt-6 sm:px-6">
          <div className="grid min-w-0 gap-4 lg:grid-cols-[1.12fr_0.88fr] lg:items-start">
          <section className="min-w-0 overflow-hidden rounded-[16px] border border-stone-200 bg-white shadow-[0_12px_30px_rgba(28,25,23,0.07)]" aria-label="Order progress">
            {cancelled ? (
              <div className="px-6 py-12 text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-red-500 ring-1 ring-red-100"><XCircle className="h-7 w-7" /></span>
                <p className="m-0 mt-4 text-lg font-bold text-neutral-900">This order was cancelled</p>
                <p className="mx-auto mb-0 mt-2 max-w-sm text-sm leading-6 text-neutral-500">Please speak with a staff member if this was unexpected.</p>
              </div>
            ) : (
              <>
                <div className="border-b border-stone-100 bg-[linear-gradient(135deg,#ecfdf5_0%,#ffffff_72%)] px-5 py-5 sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Live progress</p>
                      <h2 className="mb-0 mt-1 text-xl font-bold tracking-[-0.02em] text-neutral-950 sm:text-2xl">{activeStep?.label}</h2>
                      <p className="mb-0 mt-1.5 text-sm leading-6 text-neutral-500">{statusMessage}</p>
                    </div>
                    <span className="inline-flex shrink-0 rounded-lg bg-emerald-100 px-2.5 py-1.5 text-[10px] font-bold text-emerald-800">Step {Math.max(stepIndex + 1, 1)} of 6</span>
                  </div>
                </div>
                <ol className="m-0 list-none p-5 sm:p-6">
                {trackingSteps.map((step, index) => {
                  const reached = stepIndex >= index;
                  const current = stepIndex === index && !done;
                  const Icon = step.icon;
                  const timestamp = reached ? orderTime(trackingTimes[index]) : null;
                  const elapsed = reached && index > 0 ? elapsedBetween(trackingTimes[index - 1], trackingTimes[index]) : null;
                  return (
                    <li key={step.key} aria-current={current ? "step" : undefined} className="flex min-w-0 items-start gap-3.5 pb-5 last:pb-0">
                      <div className="flex shrink-0 flex-col items-center">
                        <span className={`flex h-10 w-10 items-center justify-center rounded-lg border ${current ? "border-emerald-600 bg-emerald-700 text-white shadow-[0_6px_16px_rgba(4,120,87,0.2)]" : reached ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-stone-50 text-stone-300"}`}>
                          {current ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                        </span>
                        {index < trackingSteps.length - 1 && <span className={`mt-1 h-7 w-px ${stepIndex > index ? "bg-emerald-400" : "bg-stone-200"}`} />}
                      </div>
                      <div className="min-w-0 flex-1 pt-2">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className={`m-0 text-sm font-bold sm:text-base ${reached ? "text-neutral-900" : "text-neutral-400"}`}>{step.label}</p>
                            {current && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-emerald-700">Now</span>}
                          </div>
                          {timestamp && (
                            <div className="flex shrink-0 items-center gap-1.5 text-right">
                              {elapsed && <span className="rounded-md bg-emerald-50 px-1.5 py-1 text-[9px] font-bold text-emerald-700">+{elapsed}</span>}
                              <time dateTime={trackingTimes[index] ?? undefined} className="text-[11px] font-bold tabular-nums text-neutral-500">{timestamp}</time>
                            </div>
                          )}
                        </div>
                        {current && <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">{statusMessage}</p>}
                        {index === 5 && !reached && (
                          <p className={`mb-0 mt-1 text-xs font-semibold leading-5 ${order.settlementMode === "ROOM_FOLIO" ? "text-blue-600" : "text-amber-700"}`}>
                            {order.settlementMode === "ROOM_FOLIO" ? `Pending room-bill posting · ${money(order.total, order.currency)}` : `${paymentMethodLabel(order.guestPaymentMethod)} selected · Not paid · Balance ${money(order.total, order.currency)}`}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
                </ol>
                <p className="mb-0 border-t border-stone-100 px-5 py-3 text-[10px] text-neutral-400 sm:px-6">Stage times and elapsed service intervals are recorded automatically.</p>
              </>
            )}
          </section>

          <div className="min-w-0 space-y-4">
          <section className="min-w-0 rounded-[16px] border border-stone-200 bg-white p-5 shadow-[0_12px_30px_rgba(28,25,23,0.06)] sm:p-6" aria-label="Order summary">
            <div className="flex items-center gap-3 border-b border-stone-100 pb-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100">{isTrackedBar ? <Wine className="h-[18px] w-[18px]" /> : <ReceiptText className="h-[18px] w-[18px]" />}</span>
              <div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">Order summary</p><h2 className="mb-0 mt-0.5 truncate text-lg font-bold text-neutral-950">{order.outlet?.name}</h2></div>
            </div>
            <ul className="m-0 list-none space-y-0 p-0 pt-2">
              {order.items.map((item, index) => (
                <li key={index} className="flex min-w-0 items-center justify-between gap-3 border-b border-stone-100 py-3 last:border-b-0">
                  <span className="min-w-0 text-sm font-semibold text-neutral-700"><span className="mr-2 inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-stone-100 px-1.5 text-xs font-bold text-neutral-600">{item.quantity}</span>{item.name}</span>
                  <span className="shrink-0 text-sm font-bold text-neutral-900">{money(item.lineTotal, order.currency)}</span>
                </li>
              ))}
            </ul>
            {order.note && <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-stone-50 px-3 py-2.5 text-xs leading-5 text-neutral-500"><ReceiptText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" /><span><strong className="text-neutral-700">Serving note:</strong> {order.note}</span></div>}
            <div className="mt-4 flex items-baseline justify-between border-t border-stone-200 pt-4">
              <span className="text-base font-bold text-neutral-900">Total</span>
              <span className="text-xl font-bold text-emerald-800">{money(order.total, order.currency)}</span>
            </div>
            {!cancelled && paymentConfirmed && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs leading-5 text-emerald-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Paid and confirmed by the attendant.</strong>{order.settlementMethod ? ` Payment method: ${order.settlementMethod.replaceAll("_", " ").toLowerCase()}.` : ""}</span></div>
            )}
            {!cancelled && postedToRoom && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-xs leading-5 text-blue-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Added to your room bill.</strong> The amount will appear on your folio at checkout.</span></div>
            )}
            {!cancelled && !done && order.settlementMode === "ROOM_FOLIO" && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-xs leading-5 text-blue-800"><ReceiptText className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Room bill pending.</strong> This amount will be posted to your folio after service.</span></div>
            )}
            {!cancelled && !done && order.settlementMode !== "ROOM_FOLIO" && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800"><ReceiptText className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>{paymentMethodLabel(order.guestPaymentMethod)} selected · Not paid yet · {money(order.total, order.currency)} due.</strong> The attendant will confirm the method actually received when settling your order.</span></div>
            )}
          </section>

          {/* Hotel-direct payment details (their Lipa Namba, bank, card at counter) */}
          {!cancelled && !done && order.settlementMode !== "ROOM_FOLIO" && selectedPayInstructions.length > 0 && (
            <section className="relative min-w-0 overflow-hidden rounded-[16px] border border-[#0e5a4d] bg-[linear-gradient(145deg,#0b4b40_0%,#073f35_58%,#052f29_100%)] p-5 text-white shadow-[0_16px_34px_rgba(7,63,53,0.2)] sm:p-6" aria-label="Payment instructions">
              <div className="pointer-events-none absolute -right-12 -top-14 h-40 w-40 rounded-full border border-white/10" />
              <div className="pointer-events-none absolute -bottom-16 right-10 h-32 w-32 rounded-full bg-emerald-300/5 blur-2xl" />
              <div className="relative flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-emerald-100 ring-1 ring-white/15"><ShieldCheck className="h-[18px] w-[18px]" /></span><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-200/80">Secure property payment</p><h2 className="mb-0 mt-0.5 text-lg font-bold text-white">Pay by {paymentMethodLabel(order.guestPaymentMethod).toLowerCase()}</h2></div></div>
              <ul className="relative m-0 mt-4 list-none space-y-2.5 p-0">
                {selectedPayInstructions.map((row, index) => (
                  <li key={index} className="rounded-lg border border-white/10 bg-white/10 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-sm">
                    <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-100/70">{row.label}</p>
                    <p className="mb-0 mt-1 text-base font-bold tracking-wide text-white">{row.value}</p>
                    {row.name && <p className="mb-0 mt-1 text-xs text-emerald-50/70">{row.name}</p>}
                  </li>
                ))}
              </ul>
              <p className="relative mb-0 mt-3 text-xs leading-5 text-emerald-50/70">
                After paying, show the confirmation message to your {order.outlet?.type === "BAR" ? "bar attendant" : "waiter"} so the payment is recorded with your order.
              </p>
            </section>
          )}
          </div>
          </div>

          {done && !cancelled && (
            <section className="relative mt-4 min-w-0 overflow-hidden rounded-[16px] border border-amber-200/80 bg-[linear-gradient(135deg,#fffbeb_0%,#ffffff_50%,#ecfdf5_100%)] p-5 shadow-[0_12px_30px_rgba(120,83,25,0.07)] sm:p-6" aria-label="Service feedback">
              <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full border border-amber-300/20" />
              {order.feedbackAt ? (
                <div className="relative flex flex-col items-center py-3 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"><Heart className="h-5 w-5 fill-current" /></span>
                  <h2 className="mb-0 mt-3 text-xl font-bold text-neutral-950">Thank you for helping us improve</h2>
                  <div className="mt-2 flex items-center gap-1" aria-label={`${order.guestRating ?? 0} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((value) => <Star key={value} className={`h-5 w-5 ${value <= (order.guestRating ?? 0) ? "fill-amber-400 text-amber-400" : "text-stone-200"}`} />)}
                  </div>
                  <p className="mx-auto mb-0 mt-2 max-w-lg text-sm leading-6 text-neutral-500">Your rating has been shared with the property team.</p>
                  {order.tipIntent === "INTERESTED" && order.tipSuggestedAmount != null && (
                    <p className="mb-0 mt-2 rounded-lg bg-white/80 px-3 py-2 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-100">Tip preference noted: {money(order.tipSuggestedAmount, order.currency)}. This was not charged automatically.</p>
                  )}
                </div>
              ) : (
                <div className="relative grid min-w-0 gap-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
                  <div className="min-w-0">
                    <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 ring-1 ring-amber-200"><Heart className="h-5 w-5" /></span><div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">A quick thank-you</p><h2 className="mb-0 mt-1 text-xl font-bold tracking-[-0.02em] text-neutral-950">How was your service?</h2><p className="mb-0 mt-1 text-sm leading-6 text-neutral-500">Your feedback helps the team make the next order even better.</p></div></div>

                    <div className="mt-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Service rating">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button key={value} type="button" role="radio" aria-checked={feedbackRating === value} aria-label={`${value} star${value === 1 ? "" : "s"}`} onClick={() => setFeedbackRating(value)} className={`flex h-11 w-11 items-center justify-center rounded-lg border transition ${value <= feedbackRating ? "border-amber-300 bg-amber-100 text-amber-500" : "border-stone-200 bg-white text-stone-300 hover:border-amber-200 hover:text-amber-400"}`}>
                          <Star className={`h-5 w-5 ${value <= feedbackRating ? "fill-current" : ""}`} />
                        </button>
                      ))}
                      {feedbackRating > 0 && <span className="ml-1 text-xs font-bold text-neutral-600">{["", "Needs attention", "Fair", "Good", "Very good", "Excellent"][feedbackRating]}</span>}
                    </div>

                    <label className="mt-4 block min-w-0"><span className="mb-1.5 block text-xs font-bold text-neutral-600">Anything you would like the team to know? <span className="font-normal text-neutral-400">(optional)</span></span><textarea value={feedbackComment} onChange={(event) => setFeedbackComment(event.target.value.slice(0, 500))} rows={2} placeholder="A short note about your experience" className="box-border w-full max-w-full resize-none rounded-lg border border-stone-200 bg-white/80 px-3 py-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10" style={{ fontFamily: "inherit" }} /></label>
                  </div>

                  <div className="min-w-0 rounded-xl border border-white bg-white/75 p-4 shadow-sm backdrop-blur-sm">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Entirely optional</p>
                    <h3 className="mb-0 mt-1 text-base font-bold text-neutral-950">Would you like to thank the team with a tip?</h3>
                    <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">Choose only if you wish. A tip is never required.</p>
                    <div className="mt-3 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Tip preference">
                      {[0, 5, 10, 15].map((percent) => (
                        <button key={percent} type="button" role="radio" aria-checked={feedbackTipPercent === percent} onClick={() => setFeedbackTipPercent(percent)} className={`min-h-10 rounded-lg border px-2 text-xs font-bold transition ${feedbackTipPercent === percent ? "border-emerald-600 bg-emerald-700 text-white" : "border-stone-200 bg-white text-neutral-600 hover:border-emerald-200"}`}>{percent === 0 ? "No tip" : `${percent}%`}</button>
                      ))}
                    </div>
                    {selectedTipAmount != null && (
                      <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2.5 text-xs"><span className="font-semibold text-emerald-700">Suggested tip</span><strong className="text-sm text-emerald-900">{money(selectedTipAmount, order.currency)}</strong></div>
                    )}
                    <p className="mb-0 mt-3 text-[10px] leading-4 text-neutral-400">Selecting a tip records your preference only. It does not charge your room or payment method automatically; please give it directly to the property team.</p>

                    {feedbackError && <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{feedbackError}</div>}
                    <button type="button" onClick={() => void submitFeedback()} disabled={feedbackRating < 1 || feedbackSubmitting} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073f35] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(7,63,53,0.18)] transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none">{feedbackSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}{feedbackSubmitting ? "Sending…" : "Send thanks & feedback"}</button>
                  </div>
                </div>
              )}
            </section>
          )}

          <button
            type="button"
            onClick={dismissOrder}
            className="mx-auto mt-5 flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-900"
          >
            <ChevronLeft className="h-4 w-4" /> Back to menu
          </button>

          <p className="mb-0 mt-7 text-center text-[10px] text-neutral-400">
            Guest ordering powered by <span className="font-bold text-emerald-800">NoLSAF</span>
          </p>
        </main>
      </div>
    );
  }

  // ── Menu browsing view ─────────────────────────────────────
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f4ef] pb-28 text-neutral-950 lg:pb-14" style={GUEST_FONT_STYLE}>
      <header className="relative mx-2 mt-2 overflow-hidden rounded-[14px] bg-[#073f35] text-white shadow-[0_14px_38px_rgba(7,63,53,0.14)] sm:mx-4 sm:mt-4 sm:rounded-[18px]">
        <div className="pointer-events-none absolute -right-20 -top-32 h-72 w-72 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute right-0 top-0 h-40 w-56 bg-emerald-400/10 blur-3xl" />
        <div className="mx-auto max-w-6xl px-5 pb-6 pt-5 sm:px-8 sm:pb-7 sm:pt-6">
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200/80"><Sparkles className="h-3.5 w-3.5" /> Guest dining</div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-semibold text-emerald-50 backdrop-blur"><MapPin className="h-3 w-3" /> {pointLabel}</span>
          </div>
          <div className="mt-5 grid items-center gap-5 sm:mt-6 lg:grid-cols-[minmax(0,1fr)_32rem] lg:gap-10">
            <div className="max-w-2xl">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-200/70">{menu.property.title}</p>
              <h1 className="mb-0 mt-1.5 text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">A menu made for your stay</h1>
              <p className="mb-0 mt-2 max-w-xl text-xs leading-5 text-emerald-50/70 sm:text-sm">Choose from today&apos;s live selection and send your order directly to the property team.</p>
              <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[9px] font-semibold text-emerald-100/65"><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Live availability</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Direct to the team</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Live tracking</span></div>
            </div>

            <aside className="rounded-xl border border-white/10 bg-white/[0.065] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm" aria-label="How ordering works">
              <div className="mb-2.5 flex items-center justify-between gap-3"><div><p className="m-0 text-[8px] font-bold uppercase tracking-[0.16em] text-emerald-200/65">From menu to service</p><h2 className="mb-0 mt-0.5 text-xs font-bold text-white">Four simple steps</h2></div><span className="text-[8px] font-bold uppercase tracking-[0.12em] text-emerald-100/55">How it works</span></div>
              <ol className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
                <li className="min-w-0 rounded-lg border border-white/10 bg-black/10 p-2"><div className="flex items-center justify-between gap-1"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-100"><Search className="h-3 w-3" /></span><span className="text-[8px] font-bold text-emerald-200/40">01</span></div><p className="mb-0 mt-1.5 truncate text-[9px] font-bold text-white">Browse</p></li>
                <li className="min-w-0 rounded-lg border border-white/10 bg-black/10 p-2"><div className="flex items-center justify-between gap-1"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-100"><ShoppingBasket className="h-3 w-3" /></span><span className="text-[8px] font-bold text-emerald-200/40">02</span></div><p className="mb-0 mt-1.5 truncate text-[9px] font-bold text-white">Choose</p></li>
                <li className="min-w-0 rounded-lg border border-white/10 bg-black/10 p-2"><div className="flex items-center justify-between gap-1"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-100"><ChefHat className="h-3 w-3" /></span><span className="text-[8px] font-bold text-emerald-200/40">03</span></div><p className="mb-0 mt-1.5 truncate text-[9px] font-bold text-white">Send</p></li>
                <li className="min-w-0 rounded-lg border border-white/10 bg-black/10 p-2"><div className="flex items-center justify-between gap-1"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-100"><CheckCircle2 className="h-3 w-3" /></span><span className="text-[8px] font-bold text-emerald-200/40">04</span></div><p className="mb-0 mt-1.5 truncate text-[9px] font-bold text-white">Track</p></li>
              </ol>
            </aside>
          </div>
        </div>
      </header>

      <div className="sticky top-2 z-30 mx-2 mt-2 sm:mx-4 sm:mt-3">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 rounded-xl border border-stone-200/90 bg-white/95 p-2.5 shadow-[0_8px_24px_rgba(38,35,28,0.07)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 gap-1 overflow-x-auto rounded-lg bg-stone-100 p-1" aria-label="Choose an outlet">
            {menu.outlets.map((outlet) => {
              const Icon = outlet.type === "BAR" ? Wine : UtensilsCrossed;
              const active = outlet.id === activeOutletId;
              return (
                <button key={outlet.id} type="button" onClick={() => switchOutlet(outlet.id)} className={`inline-flex h-9 min-w-0 flex-1 shrink-0 items-center justify-center gap-2 rounded-md border-0 px-3 text-[11px] font-bold transition sm:flex-none ${active ? "bg-[#073f35] text-white shadow-sm" : "bg-transparent text-neutral-500 hover:bg-white hover:text-emerald-800"}`}>
                  <Icon className="h-3.5 w-3.5" /> {outlet.name}
                </button>
              );
            })}
          </div>
          <label className="relative block w-full md:w-64"><span className="sr-only">{isBarOutlet ? "Search the bar shelf" : "Search this menu"}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" /><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={isBarOutlet ? "Search the shelf" : "Search this menu"} className="h-9 w-full rounded-lg border border-stone-200 bg-stone-50 pl-9 pr-9 text-[11px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />{searchQuery && <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear menu search" className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><X className="h-3 w-3" /></button>}</label>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        {!activeOutlet || activeOutlet.menuItems.length === 0 ? (
          <div className="rounded-[28px] border border-stone-200 bg-white px-6 py-16 text-center shadow-sm"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400"><UtensilsCrossed className="h-5 w-5" /></span><p className="mb-0 mt-4 text-base font-bold text-neutral-800">The menu is being prepared</p><p className="mb-0 mt-1.5 text-sm text-neutral-400">Please check back shortly or ask a staff member.</p></div>
        ) : (
          <>
            <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">{isBarOutlet ? "Live bar shelf" : "Now serving"}</p><h2 className="mb-0 mt-1 text-2xl font-bold tracking-[-0.025em] text-neutral-950">{activeOutlet.name}</h2><p className="mb-0 mt-1 text-xs text-neutral-500">{isBarOutlet ? `${activeOutlet.menuItems.filter((item) => item.inStock).length} drinks available on the shelf now` : `${activeOutlet.menuItems.filter((item) => item.inStock).length} selections available today`}</p></div>
              <span className="inline-flex w-fit items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {isBarOutlet ? "Shelf availability is live" : "Live menu"} · {activeOutlet.currency}</span>
            </div>

            {!isBarOutlet && categories.length > 1 && !searchQuery && (
              <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 py-4 sm:mx-0 sm:px-0" aria-label="Menu categories">
                {categories.map((category, index) => <button key={category.name} type="button" onClick={() => jumpToCategory(category.name, index)} className={`shrink-0 rounded-full border px-3.5 py-2 text-[11px] font-bold transition ${selectedCategory === category.name ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 bg-white text-neutral-600 hover:border-emerald-200 hover:text-emerald-800"}`}>{category.name}<span className="ml-1.5 text-[9px] opacity-60">{category.items.length}</span></button>)}
              </nav>
            )}

            <div className="mt-2 grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_19rem]">
              <div className="min-w-0 space-y-9">
                {menuSections.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-stone-300 bg-white px-6 py-14 text-center"><Search className="mx-auto h-7 w-7 text-stone-300" /><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">Nothing matched “{searchQuery}”</p><button type="button" onClick={() => setSearchQuery("")} className="mt-3 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50">Clear search</button></div>
                ) : isBarOutlet ? (
                  <BarShelfTable items={menuSections[0].items} currency={activeOutlet.currency} cart={cart} onChangeQty={changeQty} />
                ) : menuSections.map((category, categoryIndex) => (
                  <section key={category.name} id={`menu-category-${categoryIndex}`} className="scroll-mt-36">
                    <div className="mb-3 flex items-baseline justify-between gap-3"><h3 className="m-0 text-xl font-bold tracking-[-0.02em] text-neutral-900">{category.name}</h3><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{category.items.length} {category.items.length === 1 ? "item" : "items"}</span></div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {category.items.map((item) => {
                        const qty = cart.get(item.id) ?? 0;
                        const unavailable = !item.inStock;
                        return (
                          <article key={item.id} className={`group relative flex min-h-36 overflow-hidden rounded-[20px] border bg-white shadow-[0_8px_28px_rgba(38,35,28,0.05)] transition ${unavailable ? "border-stone-200 bg-stone-50/80" : "border-stone-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_14px_35px_rgba(6,78,59,0.09)]"}`}>
                            <div className="min-w-0 flex-1 p-4">
                              <p className={`m-0 pr-1 text-sm font-bold leading-snug ${unavailable ? "text-neutral-500" : "text-neutral-950"}`}>{item.name}</p>
                              {item.description && <p className="mb-0 mt-1.5 line-clamp-2 text-[11px] leading-[1.55] text-neutral-500">{item.description}</p>}
                              <div className="mt-3 flex items-end justify-between gap-2">
                                <p className={`m-0 text-sm font-bold ${unavailable ? "text-neutral-400" : "text-emerald-800"}`}>{money(item.price, activeOutlet.currency)}</p>
                                {unavailable ? <span className="rounded-full bg-stone-200/70 px-2.5 py-1 text-[9px] font-bold text-stone-500">Unavailable</span> : qty === 0 ? <button type="button" disabled={!orderingEnabled} onClick={() => changeQty(item.id, 1)} aria-label={orderingEnabled ? `Add ${item.name}` : `${item.name}, order by scanning your table or room QR code`} className="inline-flex h-8 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-800 transition hover:bg-emerald-100 active:scale-95 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400 disabled:hover:bg-stone-100"><Plus className="h-3.5 w-3.5" /> Add</button> : <span className="inline-flex h-8 items-center rounded-full bg-[#073f35] text-white shadow-sm"><button type="button" onClick={() => changeQty(item.id, -1)} aria-label={`Remove one ${item.name}`} className="flex h-8 w-8 items-center justify-center rounded-full border-0 bg-transparent text-white"><Minus className="h-3 w-3" /></button><span className="min-w-5 text-center text-[11px] font-bold">{qty}</span><button type="button" onClick={() => changeQty(item.id, 1)} aria-label={`Add one ${item.name}`} className="flex h-8 w-8 items-center justify-center rounded-full border-0 bg-transparent text-white"><Plus className="h-3 w-3" /></button></span>}
                              </div>
                            </div>
                            <div className="relative m-2.5 ml-0 w-28 shrink-0 overflow-hidden rounded-[15px] bg-gradient-to-br from-emerald-50 to-stone-100 sm:w-32">
                              {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill unoptimized className={`object-cover transition duration-500 group-hover:scale-[1.03] ${unavailable ? "grayscale opacity-60" : ""}`} /> : <div className="flex h-full items-center justify-center text-emerald-800/25"><UtensilsCrossed className="h-7 w-7" /></div>}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <aside className="sticky top-24 hidden overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-[0_16px_45px_rgba(38,35,28,0.08)] xl:block">
                <div className="border-b border-stone-100 px-5 py-4"><div className="flex items-center gap-2"><ReceiptText className="h-4 w-4 text-emerald-700" /><h3 className="m-0 text-sm font-bold text-neutral-900">Your order</h3></div><p className="mb-0 mt-1 text-[10px] text-neutral-400">{pointLabel} · {activeOutlet.name}</p></div>
                {cartCount === 0 ? <div className="px-5 py-6 text-center"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-stone-100 text-stone-400"><ShoppingBasket className="h-5 w-5" /></span><p className="mb-0 mt-3 text-xs font-bold text-neutral-600">Your basket is ready</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-400">Add a selection to begin your order.</p></div> : <div className="p-5"><div className="max-h-64 space-y-3 overflow-y-auto pr-1">{cartLines.map(({ item, quantity }) => <div key={item.id} className="flex items-center gap-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-800">{quantity}</span><p className="m-0 min-w-0 flex-1 truncate text-xs font-semibold text-neutral-700">{item.name}</p><span className="shrink-0 text-[10px] font-bold text-neutral-600">{money(item.price * quantity, activeOutlet.currency)}</span></div>)}</div><div className="mt-4 flex items-baseline justify-between border-t border-stone-100 pt-4"><span className="text-xs font-bold text-neutral-600">Total</span><span className="text-base font-bold text-emerald-800">{money(cartTotal, activeOutlet.currency)}</span></div><button type="button" onClick={() => setCartOpen(true)} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#073f35] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-900">Review order <ArrowRight className="h-3.5 w-3.5" /></button></div>}
                {recentOrders.length > 0 && (
                  <div className="border-t border-stone-100 px-5 py-4">
                    <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><History className="h-3.5 w-3.5 text-emerald-700" /><p className="m-0 text-xs font-bold text-neutral-800">Recent orders</p></div><span className="text-[9px] font-semibold text-neutral-400">This device</span></div>
                    <div className="space-y-2">
                      {recentOrders.slice(0, 3).map((entry) => (
                        <button key={entry.code} type="button" onClick={() => openRecentOrder(entry)} className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2.5 text-left transition hover:border-emerald-200 hover:bg-emerald-50">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm"><ReceiptText className="h-3.5 w-3.5" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold text-neutral-800">{entry.order.orderNumber}</span><span className="mt-0.5 block truncate text-[9px] text-neutral-500">{guestStatusLabel(entry.order.status)} · {shortOrderDate(entry.order.placedAt)}</span></span>
                          <span className="shrink-0 text-[10px] font-bold text-emerald-800">{money(entry.order.total, entry.order.currency)}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                        </button>
                      ))}
                    </div>
                    <p className="mb-0 mt-2 text-[9px] leading-4 text-neutral-400">Receipts remain available on this device after service is complete.</p>
                  </div>
                )}
                <div className="flex items-start gap-2 border-t border-stone-100 bg-stone-50/70 px-5 py-3 text-[9px] leading-4 text-stone-500"><ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-700" /> Your order goes directly to the property team.</div>
              </aside>

              {recentOrders.length > 0 && (
                <section className="overflow-hidden rounded-[18px] border border-stone-200 bg-white shadow-[0_10px_30px_rgba(38,35,28,0.06)] xl:hidden" aria-label="Recent orders from this device">
                  <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3.5"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><History className="h-4 w-4" /></span><div><h3 className="m-0 text-sm font-bold text-neutral-900">Your recent orders</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Saved on this device</p></div></div></div>
                  <div className="divide-y divide-stone-100">
                    {recentOrders.slice(0, 3).map((entry) => (
                      <button key={entry.code} type="button" onClick={() => openRecentOrder(entry)} className="flex w-full min-w-0 items-center gap-3 border-0 bg-white px-4 py-3.5 text-left transition hover:bg-emerald-50">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-emerald-700"><ReceiptText className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-neutral-800">{entry.order.orderNumber}</span><span className="mt-0.5 block truncate text-[11px] text-neutral-500">{guestStatusLabel(entry.order.status)} · {shortOrderDate(entry.order.placedAt)}</span></span>
                        <span className="shrink-0 text-xs font-bold text-emerald-800">{money(entry.order.total, entry.order.currency)}</span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-neutral-400" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}

        <p className="mb-0 mt-14 text-center text-[10px] text-stone-400">Guest ordering powered by <span className="font-bold text-emerald-800">NoLSAF</span></p>
      </main>

      {cartCount > 0 && !cartOpen && (
        <>
          <div className="fixed right-3 z-[60] sm:hidden" style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}>
            <button type="button" onClick={() => setCartOpen(true)} aria-label={`View order with ${cartCount} item${cartCount === 1 ? "" : "s"}`} className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-white/15 bg-[#073f35] text-white shadow-[0_14px_32px_rgba(7,63,53,0.4)] transition active:scale-95">
              <ShoppingBasket className="h-5 w-5" /><span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[#f6f4ef] bg-emerald-400 px-1 text-[10px] font-bold text-emerald-950">{cartCount}</span>
            </button>
          </div>
          <div className="fixed bottom-5 right-4 z-[60] hidden sm:block xl:hidden">
            <button type="button" onClick={() => setCartOpen(true)} aria-label={`View order with ${cartCount} item${cartCount === 1 ? "" : "s"}`} className="flex h-14 items-center gap-3 rounded-xl border border-white/10 bg-[#073f35] px-3.5 text-white shadow-[0_14px_36px_rgba(7,63,53,0.36)] transition active:scale-[0.98]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/12"><ShoppingBasket className="h-4 w-4" /></span><span className="min-w-0 text-left"><span className="block text-[11px] font-bold">View order</span><span className="mt-0.5 block whitespace-nowrap text-[9px] font-semibold text-emerald-100/70">{money(cartTotal, activeOutlet?.currency ?? "TZS")} · {cartCount} item{cartCount === 1 ? "" : "s"}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-emerald-200" />
            </button>
          </div>
        </>
      )}

      {/* Cart sheet */}
      {cartOpen && activeOutlet && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center overflow-x-hidden p-2 sm:p-4 lg:p-6">
          <button type="button" aria-label="Close order summary" className="absolute inset-0 border-0 bg-[#041f1a]/65 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div role="dialog" aria-modal="true" aria-labelledby="guest-order-title" className="relative box-border max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-lg min-w-0 overscroll-contain overflow-x-hidden overflow-y-auto rounded-[14px] border border-stone-300 bg-white p-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))] shadow-[0_28px_80px_rgba(4,31,26,0.34)] sm:max-h-[calc(100dvh-2.5rem)] lg:max-h-[90dvh] lg:p-6">
            <button type="button" onClick={() => setCartOpen(false)} aria-label="Close your order" className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-500 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800"><X className="h-3.5 w-3.5" /></button>
            <div className="-mx-5 -mt-5 border-b border-stone-100 bg-gradient-to-r from-emerald-50/70 via-white to-white px-5 pb-4 pt-5 lg:-mx-6 lg:-mt-6 lg:px-6 lg:pt-6">
              <div className="flex min-w-0 items-start gap-3 pr-10"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-800 shadow-sm ring-1 ring-emerald-100">{isBarOutlet ? <Wine className="h-5 w-5" /> : <UtensilsCrossed className="h-5 w-5" />}</span><div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">{isBarOutlet ? "Review bar order" : "Review restaurant order"}</p><h2 id="guest-order-title" className="mb-0 mt-1 text-[28px] font-bold leading-tight tracking-[-0.025em] text-neutral-950">Your order</h2><p className="mb-0 mt-1 truncate text-sm text-neutral-400">{activeOutlet.name} · {pointLabel}</p></div></div>
            </div>

            <div className="mt-4 min-w-0 divide-y divide-stone-100 overflow-hidden rounded-[10px] border border-stone-200 bg-white shadow-sm">
              {cartLines.map(({ item, quantity }) => (
                <div key={item.id} className="flex min-w-0 items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-base font-bold text-neutral-800">{item.name}</p>
                    <p className="mb-0 mt-0.5 text-xs font-bold text-emerald-800">{money(item.price * quantity, activeOutlet.currency)}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-stone-200 bg-stone-50">
                    <button type="button" onClick={() => changeQty(item.id, -1)} aria-label={`Remove one ${item.name}`} className="flex h-9 w-9 items-center justify-center border-0 bg-transparent text-neutral-600"><Minus className="h-4 w-4" /></button>
                    <span className="min-w-5 text-center text-sm font-bold text-neutral-900">{quantity}</span>
                    <button type="button" onClick={() => changeQty(item.id, 1)} aria-label={`Add one ${item.name}`} className="flex h-9 w-9 items-center justify-center border-0 bg-transparent text-neutral-600"><Plus className="h-4 w-4" /></button>
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[10px] border border-stone-200 bg-stone-50/60 p-4">
              <p className="m-0 mb-2 text-sm font-bold text-neutral-700">How would you like to pay? <span className="text-red-500">*</span></p>
              {menu.roomChargeAvailable && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setChargeToRoom(false)}
                    className={`min-w-0 rounded-md border px-3 py-3 text-sm font-bold transition ${!chargeToRoom ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/10" : "border-neutral-200 bg-white text-neutral-500"}`}
                  >
                    Pay Now
                  </button>
                  <button
                    type="button"
                    onClick={() => { setChargeToRoom(true); setGuestPaymentMethod(""); }}
                    className={`min-w-0 rounded-md border px-3 py-3 text-sm font-bold transition ${chargeToRoom ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/10" : "border-neutral-200 bg-white text-neutral-500"}`}
                  >
                    Add to my bill
                  </button>
                </div>
              )}

              {!chargeToRoom && (
                <div className={menu.roomChargeAvailable ? "mt-3" : "mt-0"}>
                  <p className="mb-2 mt-0 text-xs font-semibold text-neutral-500">Select the method you intend to use. The attendant will confirm it after receiving payment.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Intended payment method">
                    {PAYMENT_METHOD_OPTIONS.map((method) => (
                      <button
                        key={method.value}
                        type="button"
                        role="radio"
                        aria-checked={guestPaymentMethod === method.value}
                        onClick={() => { setGuestPaymentMethod(method.value); setPlaceError(null); }}
                        className={`min-h-11 rounded-md border px-2.5 py-2 text-xs font-bold transition ${guestPaymentMethod === method.value ? "border-emerald-600 bg-emerald-700 text-white shadow-sm" : "border-stone-200 bg-white text-neutral-600 hover:border-emerald-300 hover:bg-emerald-50"}`}
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chargeToRoom && (
                <p className="mb-0 mt-2.5 text-xs leading-relaxed text-neutral-400">
                  The order is added to your room bill and appears on the folio at checkout.
                </p>
              )}
            </div>

            <label className="mt-4 block min-w-0 max-w-full">
              <span className="mb-1.5 block text-sm font-bold text-neutral-600">Note for the {isBarOutlet ? "bar" : "kitchen"} (optional)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 200))}
                rows={2}
                placeholder={isBarOutlet ? "e.g. no ice, glass on the side" : "e.g. no onions, extra spicy"}
                className="box-border w-full max-w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-base leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                style={{ fontFamily: "inherit" }}
              />
            </label>

            {placeError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {placeError}
              </div>
            )}

            <div className="mt-4 flex items-baseline justify-between border-t border-neutral-100 pt-3.5">
              <span className="text-base font-bold text-neutral-900">Total</span>
              <span className="text-xl font-bold text-emerald-800">{money(cartTotal, activeOutlet.currency)}</span>
            </div>
            <p className="mb-0 mt-1.5 text-xs leading-5 text-neutral-400">
              {chargeToRoom ? "This order will be charged to your room bill." : guestPaymentMethod ? `${paymentMethodLabel(guestPaymentMethod)} selected. Payment remains unconfirmed until the attendant records receipt.` : "Select a payment method before sending the order."}
            </p>

            <button
              type="button"
              onClick={placeOrder}
              disabled={placing || cartLines.length === 0 || (!chargeToRoom && !guestPaymentMethod)}
              className="mt-4 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073f35] px-5 py-4 text-base font-bold text-white shadow-[0_10px_24px_rgba(7,63,53,0.2)] transition hover:bg-emerald-900 active:scale-[0.99] disabled:opacity-50"
            >
              {placing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {placing ? "Placing order…" : isBarOutlet ? "Send bar order" : "Place order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BarShelfTable({
  items,
  currency,
  cart,
  onChangeQty,
}: {
  items: MenuItem[];
  currency: string;
  cart: Map<number, number>;
  onChangeQty: (itemId: number, delta: number) => void;
}) {
  const availableCount = items.filter((item) => item.inStock).length;
  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 border-t-2 border-t-emerald-700 bg-white shadow-[0_12px_34px_rgba(38,35,28,0.07)]" aria-labelledby="bar-shelf-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-white px-5 py-4">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"><Wine className="h-[18px] w-[18px]" /></span><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">Shelf register</p><h3 id="bar-shelf-title" className="m-0 mt-0.5 text-base font-bold tracking-[-0.01em] text-neutral-900">Available drinks</h3></div></div>
        <div className="flex items-center gap-1.5 text-[10px] font-bold"><span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-emerald-800"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{availableCount} available</span>{items.length - availableCount > 0 && <span className="rounded-md bg-stone-200/70 px-2.5 py-1.5 text-stone-600">{items.length - availableCount} unavailable</span>}</div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <caption className="sr-only">Live bar shelf with drink availability, prices and order controls</caption>
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/80 text-[9px] font-bold uppercase tracking-[0.14em] text-stone-500">
              <th scope="col" className="w-[38%] px-5 py-3">Drink</th>
              <th scope="col" className="px-4 py-3">Shelf type</th>
              <th scope="col" className="px-4 py-3">Availability</th>
              <th scope="col" className="px-4 py-3 text-right">Price</th>
              <th scope="col" className="px-5 py-3 text-right">Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((item) => {
              const qty = cart.get(item.id) ?? 0;
              return (
                <tr key={item.id} className={`transition ${item.inStock ? "odd:bg-white even:bg-stone-50/35 hover:bg-emerald-50/35" : "bg-stone-50/80 text-stone-400"}`}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 shadow-sm">
                        {item.imageUrl ? <Image src={item.imageUrl} alt="" fill unoptimized className={`object-cover ${item.inStock ? "" : "grayscale opacity-60"}`} /> : <span className="flex h-full items-center justify-center text-emerald-800/35"><Wine className="h-[18px] w-[18px]" /></span>}
                      </span>
                      <div className="min-w-0"><p className={`m-0 truncate text-sm font-bold ${item.inStock ? "text-neutral-900" : "text-stone-500"}`}>{item.name}</p>{item.description && <p className="mb-0 mt-1 max-w-sm truncate text-[10px] leading-4 text-stone-500">{item.description}</p>}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><span className="inline-flex rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-stone-700 shadow-sm">{item.category?.trim() || "General"}</span></td>
                  <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-2 text-[10px] font-bold ${item.inStock ? "text-emerald-700" : "text-stone-400"}`}><span className={`h-2 w-2 rounded-full ${item.inStock ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.10)]" : "bg-stone-300"}`} />{item.inStock ? "On shelf" : "Unavailable"}</span></td>
                  <td className={`whitespace-nowrap px-4 py-3.5 text-right text-sm font-bold ${item.inStock ? "text-emerald-800" : "text-stone-400"}`}>{money(item.price, currency)}</td>
                  <td className="px-5 py-3.5 text-right">
                    {!item.inStock ? <span className="text-xs text-stone-300">—</span> : qty === 0 ? <button type="button" onClick={() => onChangeQty(item.id, 1)} className="inline-flex h-9 min-w-[78px] items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-100"><Plus className="h-3.5 w-3.5" /> Add</button> : <span className="inline-flex h-9 min-w-[78px] items-center justify-between rounded-md bg-[#073f35] text-white shadow-sm"><button type="button" onClick={() => onChangeQty(item.id, -1)} aria-label={`Remove one ${item.name}`} className="flex h-9 w-8 items-center justify-center border-0 bg-transparent text-white"><Minus className="h-3.5 w-3.5" /></button><span className="min-w-4 text-center text-[11px] font-bold">{qty}</span><button type="button" onClick={() => onChangeQty(item.id, 1)} aria-label={`Add one ${item.name}`} className="flex h-9 w-8 items-center justify-center border-0 bg-transparent text-white"><Plus className="h-3.5 w-3.5" /></button></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 border-t border-stone-100 bg-stone-50/60 px-4 py-2.5 text-xs font-semibold leading-5 text-stone-500 sm:hidden">Swipe sideways to view the full shelf register.</p>
    </section>
  );
}
