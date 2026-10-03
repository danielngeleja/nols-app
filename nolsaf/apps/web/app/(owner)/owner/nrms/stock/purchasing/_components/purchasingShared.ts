// Labels and shapes shared by the Purchasing page, the order sheet and its
// modals (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 4).

type Tone = "ok" | "low" | "out" | "muted" | "info";

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "muted" },
  PENDING_APPROVAL: { label: "Waiting owner", tone: "low" },
  APPROVED: { label: "Approved, not sent", tone: "info" },
  SENT: { label: "Sent", tone: "info" },
  PARTIALLY_RECEIVED: { label: "Partly delivered", tone: "low" },
  RECEIVED: { label: "Delivered", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
  CLOSED_SHORT: { label: "Closed short", tone: "out" },
};

export const REQUISITION_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: "Open", tone: "info" },
  PARTLY_ORDERED: { label: "Partly ordered", tone: "low" },
  ORDERED: { label: "Ordered", tone: "ok" },
  CLOSED: { label: "Closed", tone: "muted" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export const SEND_CHANNEL_LABELS: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email", PDF: "PDF by hand" };

export type PurchasingSummary = {
  role: string;
  canManage: boolean;
  canRequest: boolean;
  canReceive: boolean;
  canApproveOrders: boolean;
  purchaseOrderLimit: number;
  overDeliveryPercent: number;
  counts: { openRequisitions: number; drafts: number; pendingApproval: number; awaitingDelivery: number; reorder: number };
};

export type ReorderRow = {
  locationId: number;
  locationName: string;
  stockItemId: number;
  name: string;
  category: string;
  baseUnit: string;
  countStyle: string;
  onHand: number;
  parLevel: number | null;
  reorderPoint: number | null;
  onOrder: number;
  requested: number;
  suggestedQuantity: number;
  suggestedPackUnitId: number | null;
  suggestedPackName: string | null;
  suggestedPackCount: number | null;
  supplierId: number | null;
  supplierName: string | null;
  unitCost: number | null;
};

export type RequisitionLine = {
  id: number;
  stockItemId: number;
  stockItemName: string | null;
  baseUnit: string | null;
  category: string | null;
  quantity: number;
  packUnitName: string | null;
  packCount: number | null;
  purchaseOrderId: number | null;
  orderNumber: string | null;
  orderStatus: string | null;
};

export type Requisition = {
  id: number;
  requisitionNumber: string;
  status: string;
  locationId: number;
  locationName: string | null;
  neededBy: string | null;
  note: string | null;
  requestedAt: string;
  requestedById: number | null;
  requestedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closeNote: string | null;
  lines: RequisitionLine[];
};

export type OrderSummary = {
  id: number;
  orderNumber: string;
  status: string;
  supplierId: number;
  supplierName: string | null;
  locationId: number;
  locationName: string | null;
  expectedDate: string | null;
  totalCost: number;
  lineCount: number;
  receivedShare: number;
  createdAt: string;
  sentAt: string | null;
  sentVia: string | null;
  supplierConfirmedAt: string | null;
  supplierDeliveryDate: string | null;
};

/** A line handed to the order editor, from the reorder list, a request or an existing draft. */
export type OrderDraftLine = {
  stockItemId: number;
  packUnitId: number | null;
  /** Packs when packUnitId is set, else base units. */
  amount: number;
  /** Expected price per base unit, when known. */
  unitCost: number | null;
};

export type OrderDraft = {
  orderId?: number;
  supplierId: number | null;
  locationId: number | null;
  expectedDate: string;
  note: string;
  lines: OrderDraftLine[];
  requisitionLineIds: number[];
};

/** Dates from the API are UTC midnight for date-only fields. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
