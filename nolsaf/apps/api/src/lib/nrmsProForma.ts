import crypto from "node:crypto";
import QRCode from "qrcode";
import { decrypt, encrypt } from "./crypto.js";
import { generateNrmsProFormaPdf, type NrmsProFormaPdfData } from "./pdfDocuments.js";
import { sendMail } from "./mailer.js";

export type ProFormaItemSnapshot = {
  kind: "ROOM" | "EXTRA";
  description: string;
  detail: string | null;
  quantity: number;
  nights: number | null;
  unitRate: number;
  amount: number;
};

export type ProFormaPaymentSnapshot = {
  date: string;
  method: string;
  reference: string | null;
  receiptNumber: string;
  amount: number;
};

export const NRMS_MANUAL_BANK_POLICY_VERSION = "2026-08-11-v1";

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function day(value: Date | string): Date {
  const parsed = new Date(value);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function location(property: any): string | null {
  const value = [property.street, property.ward, property.city, property.district, property.regionName, property.country]
    .filter(Boolean)
    .join(", ");
  return value || null;
}

function profileBranch(payout: unknown): string | null {
  if (!payout || typeof payout !== "object" || Array.isArray(payout)) return null;
  const value = String((payout as Record<string, unknown>).bankBranch ?? "").trim();
  return value ? value.slice(0, 120) : null;
}

export function proFormaVerificationUrl(token: string): string {
  const origin = String(process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${origin}/nrms/agency/pro-forma/${encodeURIComponent(token)}`;
}

export function defaultProFormaDates(checkIn: Date | string, now = new Date()) {
  const arrival = day(checkIn);
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  const beforeArrival = day(new Date(arrival.getTime() - 86_400_000));
  const dueAt = beforeArrival.getTime() > tomorrow.getTime() ? beforeArrival : tomorrow;
  return { dueAt, validUntil: dueAt };
}

export function buildProFormaSnapshot(block: any) {
  const start = day(block.checkIn).getTime();
  const end = day(block.checkOut).getTime();
  const nights = Math.max(1, Math.round((end - start) / 86_400_000));
  const items: ProFormaItemSnapshot[] = (block.rooms ?? []).map((room: any) => {
    const quantity = Number(room.quantity || 0);
    const unitRate = money(room.nightlyRate);
    return {
      kind: "ROOM" as const,
      description: room.roomType?.name || "Accommodation",
      detail: [room.ratePlan?.name, `${nights} night${nights === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
      quantity,
      nights,
      unitRate,
      // Agent quotes are already authoritative commercial snapshots. Their
      // per-night display rate may round, so an explicit source amount avoids
      // introducing a few cents of invoice drift.
      amount: room.amount == null ? money(quantity * nights * unitRate) : money(room.amount),
    };
  });
  for (const item of block.masterFolio?.items ?? []) {
    if (item.voidedAt || item.kind === "ROOM") continue;
    const amount = money(item.amount);
    items.push({
      kind: "EXTRA",
      description: String(item.description || "Group incidental").slice(0, 300),
      detail: "Agency-billed incidental",
      quantity: 1,
      nights: null,
      unitRate: amount,
      amount,
    });
  }
  const payments: ProFormaPaymentSnapshot[] = (block.masterFolio?.payments ?? [])
    .filter((payment: any) => !payment.voidedAt)
    .map((payment: any) => ({
      date: new Date(payment.createdAt).toISOString(),
      method: String(payment.method || "OTHER"),
      reference: payment.reference ? String(payment.reference) : null,
      receiptNumber: String(payment.receiptNumber),
      amount: money(payment.amount),
    }));
  for (const refund of block.masterFolio?.refunds ?? []) {
    if (refund.voidedAt) continue;
    payments.push({
      date: new Date(refund.createdAt).toISOString(),
      method: `REFUND · ${String(refund.method || "OTHER")}`,
      reference: refund.reference ? String(refund.reference) : null,
      receiptNumber: String(refund.refundNumber),
      amount: -money(refund.amount),
    });
  }
  payments.sort((a, b) => a.date.localeCompare(b.date));
  const quotedTotal = money(items.reduce((sum, item) => sum + item.amount, 0));
  const paidAtIssue = money(payments.reduce((sum, payment) => sum + payment.amount, 0));
  return { items, payments, quotedTotal, paidAtIssue, balanceDue: money(Math.max(0, quotedTotal - paidAtIssue)) };
}

export async function createMasterProForma(tx: any, block: any, input: {
  createdById: number;
  dueAt?: Date | string | null;
  validUntil?: Date | string | null;
  notes?: string | null;
}) {
  if (!block.masterFolio) throw new Error("NRMS_PRO_FORMA_MASTER_FOLIO_REQUIRED");
  const contactName = String(block.contactName || "").trim();
  const contactEmail = String(block.contactEmail || "").trim().toLowerCase();
  if (!contactName || !contactEmail) throw new Error("NRMS_PRO_FORMA_CONTACT_REQUIRED");
  const [manualBank, verifiedBank] = await Promise.all([
    tx.nrmsProFormaBankAccount.findFirst({ where: { propertyId: block.propertyId, ownerId: block.ownerId, active: true } }),
    tx.payoutAccount.findFirst({
      where: { userId: block.ownerId, type: "BANK", isVerified: true, isActive: true },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    }),
  ]);
  if (!manualBank && !verifiedBank) throw new Error("NRMS_PRO_FORMA_BANK_REQUIRED");
  const owner = await tx.user.findUnique({ where: { id: block.ownerId }, select: { payout: true, tin: true, email: true, phone: true } });
  const property = block.property;
  if (!property) throw new Error("NRMS_PRO_FORMA_PROPERTY_REQUIRED");
  const previous = await tx.nrmsMasterFolioProForma.findFirst({
    where: { masterFolioId: block.masterFolio.id },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  const revision = Number(previous?.revision ?? 0) + 1;
  const issuedAt = new Date();
  const defaults = defaultProFormaDates(block.checkIn, issuedAt);
  const dueAt = input.dueAt ? day(input.dueAt) : defaults.dueAt;
  const validUntil = input.validUntil ? day(input.validUntil) : dueAt;
  if (validUntil.getTime() < issuedAt.getTime() - 86_400_000) throw new Error("NRMS_PRO_FORMA_INVALID_VALIDITY");
  const snapshot = buildProFormaSnapshot(block);
  if (snapshot.quotedTotal <= 0) throw new Error("NRMS_PRO_FORMA_EMPTY");
  if (snapshot.balanceDue <= 0.005) throw new Error("NRMS_PRO_FORMA_ALREADY_PAID");
  const year = issuedAt.getUTCFullYear();
  const number = `PF-${year}-${String(block.masterFolio.id).padStart(6, "0")}-R${revision}`.slice(0, 48);
  const publicToken = crypto.randomBytes(32).toString("base64url");
  await tx.nrmsMasterFolioProForma.updateMany({
    where: { masterFolioId: block.masterFolio.id, status: { in: ["DRAFT", "SENT"] } },
    data: { status: "SUPERSEDED", supersededAt: issuedAt },
  });
  return tx.nrmsMasterFolioProForma.create({
    data: {
      masterFolioId: block.masterFolio.id,
      number,
      revision,
      status: "DRAFT",
      currency: block.currency,
      issuedAt,
      dueAt,
      validUntil,
      billToName: String(block.agencyName || block.masterFolio.billToName || block.name).slice(0, 160),
      contactName: contactName.slice(0, 160),
      contactEmail: contactEmail.slice(0, 160),
      contactPhone: block.contactPhone ? String(block.contactPhone).slice(0, 40) : null,
      propertyName: String(property.title).slice(0, 200),
      propertyLocation: location(property),
      propertyTin: owner?.tin || null,
      propertyEmail: owner?.email || null,
      propertyPhone: owner?.phone || null,
      bankName: String(manualBank?.bankName || verifiedBank?.provider).toUpperCase().slice(0, 80),
      bankAccountName: String(manualBank?.accountName || verifiedBank?.accountName).slice(0, 160),
      bankAccountNumberEnc: encrypt(manualBank ? decrypt(manualBank.accountNumberEnc, { log: false }) : String(verifiedBank.accountNumber)),
      bankBranch: manualBank?.branchName || profileBranch(owner?.payout),
      bankSource: manualBank ? "MANUAL_UNVERIFIED" : "VERIFIED_PAYOUT",
      bankCurrency: manualBank?.accountCurrency || block.currency,
      bankAddress: manualBank?.bankAddress || null,
      bankSwiftCode: manualBank?.swiftCode || null,
      bankIban: manualBank?.iban || null,
      bankRoutingCode: manualBank?.routingCode || null,
      bankInstructions: manualBank?.instructions || null,
      itemsSnapshot: snapshot.items,
      paymentsSnapshot: snapshot.payments,
      quotedTotal: snapshot.quotedTotal,
      paidAtIssue: snapshot.paidAtIssue,
      balanceDue: snapshot.balanceDue,
      notes: input.notes ? String(input.notes).slice(0, 1000) : null,
      publicToken,
      createdById: input.createdById,
    },
  });
}

export function serializeProForma(record: any) {
  const paymentsReceived = money((record.masterFolio?.payments ?? []).filter((payment: any) => !payment.voidedAt).reduce((sum: number, payment: any) => sum + money(payment.amount), 0));
  const refunded = money((record.masterFolio?.refunds ?? []).filter((refund: any) => !refund.voidedAt).reduce((sum: number, refund: any) => sum + money(refund.amount), 0));
  const paidNow = money(paymentsReceived - refunded);
  const total = money(record.quotedTotal);
  const liveBalance = money(Math.max(0, total - paidNow));
  const paymentStatus = liveBalance <= 0.005 ? "PAID" : paidNow > 0.005 ? "PARTIALLY_PAID" : "UNPAID";
  return {
    id: record.id,
    number: record.number,
    revision: record.revision,
    status: record.status,
    paymentStatus,
    currency: record.currency,
    issuedAt: record.issuedAt,
    dueAt: record.dueAt,
    validUntil: record.validUntil,
    billToName: record.billToName,
    contactName: record.contactName,
    contactEmail: record.contactEmail,
    contactPhone: record.contactPhone,
    quotedTotal: total,
    paidAtIssue: money(record.paidAtIssue),
    balanceDueAtIssue: money(record.balanceDue),
    paidNow,
    liveBalance,
    bankName: record.bankName,
    bankAccountName: record.bankAccountName,
    bankAccountLast4: decrypt(record.bankAccountNumberEnc, { log: false }).slice(-4),
    bankSource: record.bankSource,
    bankCurrency: record.bankCurrency,
    publicUrl: proFormaVerificationUrl(record.publicToken),
    sentAt: record.sentAt,
    sentToEmail: record.sentToEmail,
    deliveryProvider: record.deliveryProvider,
    viewCount: record.viewCount,
    lastViewedAt: record.lastViewedAt,
    supersededAt: record.supersededAt,
    payerMarkedPaidAt: record.payerMarkedPaidAt ?? null,
    payerPaymentReference: record.payerPaymentReference ?? null,
    payerPaymentMethod: record.payerPaymentMethod ?? null,
    payerPaymentAccountName: record.payerPaymentAccountName ?? null,
    createdAt: record.createdAt,
  };
}

function proFormaStay(record: any) {
  const block = record.masterFolio?.block;
  if (block) return { name: block.name, reference: block.reference, checkIn: block.checkIn, checkOut: block.checkOut };
  const agent = record.masterFolio?.agentBookingRequest;
  if (agent) {
    const agency = agent.link?.agentAccount;
    return {
      name: agency?.tradingName || agency?.legalName || record.billToName,
      reference: `AGB-${String(agent.id).padStart(6, "0")}`,
      checkIn: agent.checkIn,
      checkOut: agent.checkOut,
    };
  }
  throw new Error("NRMS_PRO_FORMA_SOURCE_MISSING");
}

export async function renderMasterProFormaPdf(record: any): Promise<Buffer> {
  const stay = proFormaStay(record);
  const accountNumber = decrypt(record.bankAccountNumberEnc, { log: false });
  const verificationUrl = proFormaVerificationUrl(record.publicToken);
  const qrPng = await QRCode.toBuffer(verificationUrl, { type: "png", margin: 1, width: 256, errorCorrectionLevel: "M" });
  const data: NrmsProFormaPdfData = {
    number: record.number,
    revision: record.revision,
    issuedAt: record.issuedAt,
    dueAt: record.dueAt,
    validUntil: record.validUntil,
    propertyName: record.propertyName,
    propertyLocation: record.propertyLocation,
    propertyTin: record.propertyTin,
    propertyEmail: record.propertyEmail,
    propertyPhone: record.propertyPhone,
    billToName: record.billToName,
    contactName: record.contactName,
    contactEmail: record.contactEmail,
    contactPhone: record.contactPhone,
    groupName: stay.name,
    groupReference: stay.reference,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    currency: record.currency,
    items: record.itemsSnapshot as ProFormaItemSnapshot[],
    payments: record.paymentsSnapshot as ProFormaPaymentSnapshot[],
    quotedTotal: money(record.quotedTotal),
    paidAtIssue: money(record.paidAtIssue),
    balanceDue: money(record.balanceDue),
    bankName: record.bankName,
    bankAccountName: record.bankAccountName,
    bankAccountNumber: accountNumber,
    bankBranch: record.bankBranch,
    bankSource: record.bankSource,
    bankCurrency: record.bankCurrency,
    bankAddress: record.bankAddress,
    bankSwiftCode: record.bankSwiftCode,
    bankIban: record.bankIban,
    bankRoutingCode: record.bankRoutingCode,
    bankInstructions: record.bankInstructions,
    paymentReference: record.number,
    notes: record.notes,
    verificationUrl,
    qrPng,
  };
  return generateNrmsProFormaPdf(data);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

export async function emailMasterProForma(record: any, recipient: string) {
  const pdf = await renderMasterProFormaPdf(record);
  const url = proFormaVerificationUrl(record.publicToken);
  const amount = `${record.currency} ${money(record.balanceDue).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#16312f;max-width:640px;margin:auto">
      <h2 style="color:#02665e">Pro Forma Invoice ${escapeHtml(record.number)}</h2>
      <p>Dear ${escapeHtml(record.contactName)},</p>
      <p>${escapeHtml(record.propertyName)} has issued a Pro Forma Invoice for <strong>${escapeHtml(record.billToName)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;background:#f2f8f7;margin:20px 0">
        <tr><td style="padding:10px">Amount requested</td><td style="padding:10px;text-align:right"><strong>${escapeHtml(amount)}</strong></td></tr>
        <tr><td style="padding:10px">Due date</td><td style="padding:10px;text-align:right">${escapeHtml(new Date(record.dueAt).toLocaleDateString("en-GB"))}</td></tr>
        <tr><td style="padding:10px">Payment reference</td><td style="padding:10px;text-align:right"><strong>${escapeHtml(record.number)}</strong></td></tr>
      </table>
      <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#02665e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">View and verify Pro Forma</a></p>
      ${record.bankSource === "MANUAL_UNVERIFIED" ? `<p style="padding:12px;background:#fff7ed;border:1px solid #fcd34d;border-radius:8px;font-size:12px;color:#92400e"><strong>Manual bank instructions — not verified:</strong> The property owner entered this account directly. NoLSAF and AzamPay have not verified it. Confirm the details independently with the property before payment.</p>` : ""}
      <p style="font-size:12px;color:#667">Payment is made directly to ${escapeHtml(record.propertyName)} using the bank instructions in the attached document. NoLSAF does not receive or hold these funds.</p>
    </div>`;
  const delivery = await sendMail(
    recipient,
    `Pro Forma Invoice ${record.number} from ${record.propertyName}`,
    html,
    [{ filename: `${record.number}.pdf`, content: pdf }],
    { replyTo: record.propertyEmail || undefined, sensitiveContent: true },
  );
  return { delivery, pdf };
}

export function publicProFormaView(record: any) {
  const serialized = serializeProForma(record);
  const stay = proFormaStay(record);
  return {
    ...serialized,
    property: {
      name: record.propertyName,
      location: record.propertyLocation,
      tin: record.propertyTin,
      email: record.propertyEmail,
      phone: record.propertyPhone,
    },
    group: {
      name: stay.name,
      reference: stay.reference,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
    },
    items: record.itemsSnapshot,
    paymentsAtIssue: record.paymentsSnapshot,
    currentPayments: (record.masterFolio.payments ?? []).filter((payment: any) => !payment.voidedAt).map((payment: any) => ({
      paidAt: payment.createdAt,
      method: payment.method,
      reference: payment.reference,
      receiptNumber: payment.receiptNumber,
      amount: money(payment.amount),
    })).concat((record.masterFolio.refunds ?? []).filter((refund: any) => !refund.voidedAt).map((refund: any) => ({
      paidAt: refund.createdAt,
      method: `REFUND · ${refund.method}`,
      reference: refund.reference,
      receiptNumber: refund.refundNumber,
      amount: -money(refund.amount),
    }))).sort((a: any, b: any) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()),
    paymentAccount: {
      bankName: record.bankName,
      accountName: record.bankAccountName,
      accountNumber: decrypt(record.bankAccountNumberEnc, { log: false }),
      branch: record.bankBranch,
      source: record.bankSource,
      currency: record.bankCurrency,
      bankAddress: record.bankAddress,
      swiftCode: record.bankSwiftCode,
      iban: record.bankIban,
      routingCode: record.bankRoutingCode,
      instructions: record.bankInstructions,
      paymentReference: record.number,
    },
    bankVerificationNotice: record.bankSource === "MANUAL_UNVERIFIED"
      ? "These bank instructions were entered manually by the property owner and are not verified by NoLSAF or AzamPay. Independently confirm them with the property before transferring funds."
      : null,
    notice: "Payment is made directly to the property. NoLSAF does not receive or hold these funds.",
  };
}
