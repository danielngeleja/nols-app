import { describe, expect, it } from "vitest";
import { describeQuantity, orderLineQuantity, publicOrderView, renderPurchaseOrderPdf } from "./nrmsPurchaseOrderDocument.js";

const order = {
  id: 1,
  orderNumber: "PO-260925-ABC123",
  status: "SENT",
  createdAt: new Date("2026-09-25T08:00:00Z"),
  approvedAt: new Date("2026-09-25T09:00:00Z"),
  expectedDate: new Date("2026-09-30T00:00:00Z"),
  totalCost: "468000.00",
  note: "Deliver before 10:00",
  supplierToken: "a".repeat(43),
  supplierConfirmedAt: null,
  supplierDeliveryDate: null,
  supplierNote: null,
  createdById: 7,
  approvedById: 7,
  property: { title: "Sea View Lodge", currency: "TZS", city: "Dar es Salaam", country: "Tanzania" },
  location: { name: "Main store" },
  supplier: { name: "Mlimani Beverages", contactName: "Juma", phone: "+255712345678", email: null, tin: "123-456-789", location: "Mwenge", paymentTerms: "CREDIT_14" },
  lines: [
    { stockItem: { name: "Kilimanjaro Lager 500ml", baseUnit: "BOTTLE" }, packUnitName: "Crate", packCount: "3", quantity: "72", unitCost: "1700", lineTotal: "122400" },
    { stockItem: { name: "Beef fillet", baseUnit: "G" }, packUnitName: null, packCount: null, quantity: "12000", unitCost: "28.8", lineTotal: "345600" },
  ],
};

describe("purchase order document", () => {
  it("describes quantities the way a supplier reads them", () => {
    expect(describeQuantity(72, "BOTTLE")).toBe("72 bottles");
    expect(describeQuantity(1, "CAN")).toBe("1 can");
    expect(describeQuantity(12000, "G")).toBe("12 kg");
    expect(describeQuantity(750, "ML")).toBe("750 ml");
    expect(orderLineQuantity(order.lines[0])).toEqual({ label: "3 Crate", detail: "= 72 bottles" });
  });

  it("shows the supplier the order but not who raised or approved it", () => {
    const view = publicOrderView(order);
    expect(view.confirmable).toBe(true);
    expect(view.lines).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain("approvedById");
    expect(JSON.stringify(view)).not.toContain("createdById");
  });

  it("renders a PDF", async () => {
    const pdf = await renderPurchaseOrderPdf(order, { issuedBy: "Asha Manager" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
