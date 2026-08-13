/**
 * Guest-facing NRMS types (NRMS_QR_ORDERING.md milestone 4).
 *
 * Two surfaces share one mechanism: an order-point token. A PREVIEW point is
 * read-only browsing linked from a public listing; a ROOM or TABLE point is a
 * real ordering surface. The server decides which one a token is, via
 * `orderingEnabled`, so the app never has to infer it.
 */

export type NrmsMenuItem = {
  id: number;
  name: string;
  category: string | null;
  price: number;
  description: string | null;
  imageUrl: string | null;
  inStock: boolean;
  sortOrder: number;
};
export type NrmsOutlet = {
  id: number;
  name: string;
  type: string;
  currency: string;
  categoryOrder: string[] | null;
  menuItems: NrmsMenuItem[];
};

export type NrmsMenuData = {
  property: { title: string };
  point: { type: "ROOM" | "TABLE" | "PREVIEW"; label: string };
  /**
   * False for the read-only preview point. Absent on older cached responses,
   * which the web page treats as enabled; the app is deliberately stricter and
   * treats absent as disabled so a stale shape can never expose a cart.
   */
  orderingEnabled?: boolean;
  roomChargeAvailable?: boolean;
  outlets: NrmsOutlet[];
};

export const NRMS_PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"] as const;
export type NrmsPaymentMethod = (typeof NRMS_PAYMENT_METHODS)[number];

export type NrmsOrderLineInput = { menuItemId: number; quantity: number };

export type NrmsPlaceOrderInput = {
  outletId: number;
  items: NrmsOrderLineInput[];
  note?: string | null;
  chargeToRoom?: boolean;
  paymentMethod?: NrmsPaymentMethod | null;
};

export type NrmsPublicOrder = {
  orderNumber: string;
  status: string;
  settlementMode?: string;
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
  cancelledAt: string | null;
};

export type NrmsPlaceOrderResponse = {
  publicCode: string;
  order: NrmsPublicOrder;
};

/**
 * The signed-in guest's own ordering entitlement, resolved server-side from
 * their marketplace booking. Present only while the reservation is CHECKED_IN,
 * so the cart disappears at checkout without the app storing or expiring
 * anything. Null for everyone else, including walk-in and OTA guests who have
 * no NoLSAF account.
 */
export type NrmsActiveRoomOrdering = {
  token: string;
  roomLabel: string;
  propertyId: number;
  propertyTitle: string;
};
