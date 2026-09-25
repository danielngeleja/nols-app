// The purchase order as the supplier sees it: the PDF, the no-login link and
// the public view behind that link (docs/NRMS_STOCK_AND_PURCHASING.md 5.2).
// The link is a bearer capability like the Pro Forma link: it shows this one
// order and lets the supplier confirm it and give a delivery date. It never
// shows who in the property raised or approved the order.

import crypto from "crypto";
import QRCode from "qrcode";
import { generateNrmsPurchaseOrderPdf } from "./pdfDocuments.js";

export const PAYMENT_TERM_LABELS: Record<string, string> = {
  CASH_ON_DELIVERY: "Cash on delivery",
  CREDIT_7: "Credit, 7 days",
  CREDIT_14: "Credit, 14 days",
  CREDIT_30: "Credit, 30 days",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  SENT: "Sent to supplier",
  PARTIALLY_RECEIVED: "Partly delivered",
  RECEIVED: "Delivered",
  CANCELLED: "Cancelled",
  CLOSED_SHORT: "Closed short",
};

/** Statuses in which the supplier may still confirm. */
export const SUPPLIER_CONFIRMABLE = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];

export function newSupplierToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function supplierOrderUrl(token: string): string {
  const origin = String(process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${origin}/nrms/supplier-order/${encodeURIComponent(token)}`;
}

export function isSupplierToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,96}$/.test(token);
}

/** Everything a PDF or the public page needs, in one query. */
export const ORDER_DOCUMENT_INCLUDE = {
  supplier: true,
  location: { select: { name: true } },
  property: { select: { title: true, currency: true, street: true, ward: true, city: true, district: true, regionName: true, country: true } },
  lines: { include: { stockItem: { select: { name: true, baseUnit: true } } }, orderBy: { id: "asc" as const } },
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function propertyLocation(property: any): string | null {
  const value = [property?.street, property?.ward, property?.city, property?.district, property?.regionName, property?.country].filter(Boolean).join(", ");
  return value || null;
}

const UNIT_WORDS: Record<string, [string, string]> = {
  BOTTLE: ["bottle", "bottles"],
  CAN: ["can", "cans"],
  PIECE: ["piece", "pieces"],
};

/** "24 bottles", "5 kg", "750 ml". */
export function describeQuantity(quantity: number, baseUnit: string): string {
  const q = Math.round(quantity * 1000) / 1000;
  if (baseUnit === "G") return q >= 1000 ? `${Math.round((q / 1000) * 1000) / 1000} kg` : `${q} g`;
  if (baseUnit === "ML") return q >= 1000 ? `${Math.round((q / 1000) * 1000) / 1000} L` : `${q} ml`;
  const words = UNIT_WORDS[baseUnit];
  return words ? `${q} ${q === 1 ? words[0] : words[1]}` : `${q}`;
}

/** "3 Crate" with "= 72 bottles" underneath, or just the base quantity. */
export function orderLineQuantity(line: { packUnitName?: string | null; packCount?: unknown; quantity: unknown; stockItem?: { baseUnit: string } | null }) {
  const baseUnit = line.stockItem?.baseUnit ?? "PIECE";
  const base = describeQuantity(num(line.quantity), baseUnit);
  if (line.packUnitName && line.packCount != null) {
    const count = Math.round(num(line.packCount) * 1000) / 1000;
    return { label: `${count} ${line.packUnitName}`, detail: `= ${base}` };
  }
  return { label: base, detail: null };
}

export async function renderPurchaseOrderPdf(order: any, options: { issuedBy?: string | null } = {}): Promise<Buffer> {
  const url = order.supplierToken ? supplierOrderUrl(order.supplierToken) : null;
  const qrPng = url ? await QRCode.toBuffer(url, { type: "png", margin: 1, width: 256, errorCorrectionLevel: "M" }) : null;
  return generateNrmsPurchaseOrderPdf({
    orderNumber: order.orderNumber,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    issuedAt: order.approvedAt ?? order.createdAt,
    expectedDate: order.expectedDate,
    currency: order.property?.currency || "TZS",
    propertyName: order.property?.title ?? "Property",
    propertyLocation: propertyLocation(order.property),
    deliverTo: order.location?.name ?? "",
    paymentTerms: PAYMENT_TERM_LABELS[order.supplier?.paymentTerms] ?? "As agreed",
    issuedBy: options.issuedBy ?? null,
    supplier: {
      name: order.supplier?.name ?? "Supplier",
      contactName: order.supplier?.contactName,
      phone: order.supplier?.phone,
      email: order.supplier?.email,
      tin: order.supplier?.tin,
      location: order.supplier?.location,
    },
    lines: order.lines.map((line: any) => {
      const quantity = orderLineQuantity(line);
      const baseUnit = line.stockItem?.baseUnit;
      const perPack = Boolean(line.packUnitName && num(line.packCount) > 0);
      // Weighed goods are priced per kg or litre, the way a butcher quotes, not per gram.
      const perThousand = !perPack && (baseUnit === "G" || baseUnit === "ML");
      const unitPrice = perPack ? num(line.lineTotal) / num(line.packCount) : num(line.unitCost) * (perThousand ? 1000 : 1);
      const priceBasis = perPack ? `price per ${line.packUnitName}` : perThousand ? (baseUnit === "G" ? "price per kg" : "price per litre") : null;
      const detail = [quantity.detail, priceBasis].filter(Boolean).join(", ") || null;
      return { description: line.stockItem?.name ?? "Item", detail, quantity: quantity.label, unitPrice: Math.round(unitPrice * 100) / 100, amount: num(line.lineTotal) };
    }),
    total: num(order.totalCost),
    note: order.note,
    supplierUrl: url,
    qrPng,
  });
}

/** What the supplier's no-login page shows. */
export function publicOrderView(order: any) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    currency: order.property?.currency || "TZS",
    issuedAt: order.approvedAt ?? order.createdAt,
    expectedDate: order.expectedDate,
    deliverTo: order.location?.name ?? null,
    paymentTerms: PAYMENT_TERM_LABELS[order.supplier?.paymentTerms] ?? "As agreed",
    note: order.note,
    total: num(order.totalCost),
    property: { name: order.property?.title ?? "Property", location: propertyLocation(order.property) },
    supplier: { name: order.supplier?.name ?? "Supplier" },
    lines: order.lines.map((line: any) => {
      const quantity = orderLineQuantity(line);
      return { name: line.stockItem?.name ?? "Item", quantity: quantity.label, detail: quantity.detail, amount: num(line.lineTotal) };
    }),
    confirmable: SUPPLIER_CONFIRMABLE.includes(order.status),
    confirmedAt: order.supplierConfirmedAt,
    deliveryDate: order.supplierDeliveryDate,
    supplierNote: order.supplierNote,
  };
}
