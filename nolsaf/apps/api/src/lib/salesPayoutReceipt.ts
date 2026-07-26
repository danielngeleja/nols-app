import PDFDocument from "pdfkit";

function money(value: unknown, currency: string) {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function generateSalesPayoutReceiptPdf(input: {
  referenceNumber: string;
  agentCode: string;
  partnerName: string;
  requestedAmount: unknown;
  approvedAmount: unknown;
  deductionAmount: unknown;
  netPaidAmount: unknown;
  currency: string;
  payoutMethod: string;
  payoutAccountMasked: string;
  paymentReference: string;
  paidAt: Date;
  itemCount: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fillColor("#02665e").font("Helvetica-Bold").fontSize(22).text("NoLSAF");
    doc.fillColor("#111827").fontSize(17).text("Sales partner payout receipt", { align: "right" });
    doc.moveDown(1.5);
    doc.strokeColor("#d1d5db").moveTo(54, doc.y).lineTo(541, doc.y).stroke();
    doc.moveDown();

    const rows: Array<[string, string]> = [
      ["Receipt reference", input.referenceNumber],
      ["Payment reference", input.paymentReference],
      ["Paid at", input.paidAt.toISOString()],
      ["Partner", `${input.partnerName} (${input.agentCode})`],
      ["Destination", `${input.payoutMethod} ending ${input.payoutAccountMasked}`],
      ["Ledger items", String(input.itemCount)],
      ["Requested", money(input.requestedAmount, input.currency)],
      ["Approved", money(input.approvedAmount, input.currency)],
      ["Deductions", money(input.deductionAmount, input.currency)],
      ["Net paid", money(input.netPaidAmount, input.currency)],
    ];
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor("#6b7280").text(label, 54, y, { width: 170 });
      doc.font("Helvetica-Bold").fillColor("#111827").text(value, 230, y, { width: 311, align: "right" });
      doc.moveDown(0.9);
    }
    doc.moveDown();
    doc.roundedRect(54, doc.y, 487, 68, 8).fill("#ecfdf5");
    doc.fillColor("#065f46").font("Helvetica-Bold").fontSize(11).text(
      "This receipt confirms a payout from immutable NoLSAF sales commission ledger entries.",
      72,
      doc.y - 49,
      { width: 451, align: "center" },
    );
    doc.end();
  });
}
