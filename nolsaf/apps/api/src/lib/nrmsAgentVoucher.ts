/**
 * NRMS Agent B2B — booking voucher.
 *
 * The voucher is released only after the property records the agency's money
 * on the shared NRMS master folio. A payer declaration never unlocks it.
 */
import crypto from "node:crypto";
import QRCode from "qrcode";
import { generateNrmsAgentVoucherPdf, type AgentVoucherData } from "./pdfDocuments.js";
import { sendMail } from "./mailer.js";
import { proEmail, proDivider, BRAND_TEAL, TEXT_MAIN, TEXT_MUTED } from "./emailBase.js";

const agentRef = (id: number) => `AGT-${String(id).padStart(6, "0")}`;

/**
 * Voucher numbering: AGV-01001-7K3Q.
 *
 * The middle group is the request id shifted by an offset, so the document
 * stays sortable and readable over the phone without announcing how many agent
 * bookings the platform has ever issued. The trailing group is an HMAC check
 * over the same id: it costs nothing here, but it means a voucher number cannot
 * be walked from a neighbouring one, and a future public verification page can
 * reject a made-up number before it touches the database.
 */
const VOUCHER_SERIAL_OFFSET = 1000;
const VOUCHER_CHECK_LENGTH = 4;
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function voucherSecret(): string {
  const secret =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");
  if (!secret) throw new Error("nrms_agent_voucher_secret_missing");
  return secret;
}

function voucherCheck(requestId: number): string {
  const digest = crypto.createHmac("sha256", voucherSecret()).update(`NRMS_AGENT_VOUCHER:${requestId}`).digest();
  let out = "";
  for (let i = 0; i < VOUCHER_CHECK_LENGTH; i += 1) out += CROCKFORD_BASE32[digest[i] & 31];
  return out;
}

/** The platform's own voucher number for a booking request. */
export function buildAgentVoucherNumber(requestId: number): string {
  return `AGV-${String(VOUCHER_SERIAL_OFFSET + requestId).padStart(5, "0")}-${voucherCheck(requestId)}`;
}

/** Resolve a voucher number back to its request id, or null if it is not one of ours. */
export function verifyAgentVoucherNumber(input: unknown): number | null {
  const match = /^AGV-(\d{5,})-([0-9A-Z]{4})$/.exec(String(input ?? "").trim().toUpperCase());
  if (!match) return null;
  const requestId = Number(match[1]) - VOUCHER_SERIAL_OFFSET;
  if (!Number.isInteger(requestId) || requestId <= 0) return null;
  const expected = Buffer.from(voucherCheck(requestId));
  const supplied = Buffer.from(match[2]);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  return requestId;
}

const voucherNo = (requestId: number, receipt?: string | null) => receipt || buildAgentVoucherNumber(requestId);
const escapeHtml = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type Db = { nrmsAgentBookingRequest: { findFirst: (a: any) => Promise<any | null> }; property: { findUnique: (a: any) => Promise<any | null> } };

export type VoucherContext = { data: AgentVoucherData; recipientEmail: string | null; voucherNumber: string };

/** Load everything the voucher needs for a CONFIRMED request, or null. */
export async function loadAgentVoucherContext(db: Db, requestId: number, opts?: { agentAccountId?: number; propertyId?: number }): Promise<VoucherContext | null> {
  const request = await db.nrmsAgentBookingRequest.findFirst({
    where: {
      id: requestId, status: "CONFIRMED",
      ...(opts?.agentAccountId ? { link: { agentAccountId: opts.agentAccountId } } : {}),
      ...(opts?.propertyId ? { propertyId: opts.propertyId } : {}),
    },
    select: {
      id: true, propertyId: true, roomTypeId: true, checkIn: true, checkOut: true, roomsRequested: true, currency: true, quotedTotal: true,
      link: { select: { bookingMode: true, agentAccount: { select: { id: true, legalName: true, primaryUser: { select: { email: true } } } } } },
      reservation: {
        select: {
          receiptNumber: true, confirmedAt: true, totalAmount: true,
          allocations: { take: 1, select: { mealPlan: true, ratePlan: { select: { name: true } } } },
        },
      },
      masterFolio: { select: { status: true } },
    },
  });
  if (!request) return null;
  if (!["SETTLED", "CREDIT"].includes(String(request.masterFolio?.status || ""))) return null;

  const [property] = await Promise.all([
    db.property.findUnique({ where: { id: request.propertyId }, select: { title: true, regionName: true, district: true } }),
  ]);
  const roomType = request.roomTypeId
    ? await (db as any).roomType.findUnique?.({ where: { id: request.roomTypeId }, select: { name: true } }).catch(() => null)
    : null;

  const account = request.link?.agentAccount;
  const alloc = request.reservation?.allocations?.[0] ?? null;
  const voucherNumber = voucherNo(request.id, request.reservation?.receiptNumber);

  return {
    voucherNumber,
    recipientEmail: account?.primaryUser?.email ?? null,
    data: {
      voucherNumber,
      agencyName: account?.legalName ?? "Travel agent",
      agentReference: account ? agentRef(account.id) : "",
      propertyName: property?.title ?? "Hotel",
      propertyLocation: property?.regionName || property?.district || null,
      roomType: roomType?.name ?? null,
      ratePlan: alloc?.ratePlan?.name ?? null,
      mealPlan: alloc?.mealPlan ?? null,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      rooms: request.roomsRequested,
      totalAmount: Number(request.reservation?.totalAmount ?? request.quotedTotal),
      currency: request.currency,
      bookingMode: request.link?.bookingMode ?? null,
      paymentStatus: request.masterFolio?.status ?? null,
      confirmedAt: request.reservation?.confirmedAt ?? null,
    },
  };
}

/**
 * The voucher QR carries the voucher number itself rather than a URL: there is
 * no public voucher-verification page, and a QR pointing at a 404 is worse than
 * one the front desk can scan straight into its own system.
 */
async function voucherQr(voucherNumber: string): Promise<Buffer | null> {
  try {
    return await QRCode.toBuffer(voucherNumber, { type: "png", margin: 1, width: 256, errorCorrectionLevel: "M" });
  } catch (err: any) {
    console.warn("[nrmsAgentVoucher] QR generation failed:", err?.message || String(err));
    return null;
  }
}

/** Generate the voucher PDF for a CONFIRMED request (scoped), or null. */
export async function generateAgentVoucher(db: Db, requestId: number, opts?: { agentAccountId?: number; propertyId?: number }): Promise<{ pdf: Buffer; voucherNumber: string } | null> {
  const ctx = await loadAgentVoucherContext(db, requestId, opts);
  if (!ctx) return null;
  const pdf = await generateNrmsAgentVoucherPdf({ ...ctx.data, qrPng: await voucherQr(ctx.voucherNumber) });
  return { pdf, voucherNumber: ctx.voucherNumber };
}

/** Build and email the voucher to the agency. Best-effort; never throws to the caller. */
export async function emailAgentVoucher(db: Db, requestId: number): Promise<void> {
  try {
    const ctx = await loadAgentVoucherContext(db, requestId);
    if (!ctx || !ctx.recipientEmail) return;
    const pdf = await generateNrmsAgentVoucherPdf({ ...ctx.data, qrPng: await voucherQr(ctx.voucherNumber) });
    const body = `
      <p style="margin:0 0 14px;color:${TEXT_MAIN};font-size:15px;">Hello ${escapeHtml(ctx.data.agencyName)},</p>
      <p style="margin:0 0 14px;color:${TEXT_MAIN};font-size:15px;">Your paid booking at <strong>${escapeHtml(ctx.data.propertyName)}</strong> is confirmed. The voucher (${escapeHtml(ctx.voucherNumber)}) is attached, and it is also available in your agent portal.</p>
      ${proDivider()}
      <p style="margin:0;color:${TEXT_MUTED};font-size:14px;">Present the voucher to hotel staff on arrival. Need help? Contact <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
      <p style="margin:18px 0 0;color:${TEXT_MAIN};">Warm regards,<br><strong>The NoLSAF Team</strong></p>
    `;
    await sendMail(ctx.recipientEmail, `Your booking voucher ${ctx.voucherNumber}`, proEmail("Booking confirmed", body), [
      { filename: `voucher-${ctx.voucherNumber}.pdf`, content: pdf },
    ]);
  } catch (err: any) {
    console.warn("[nrmsAgentVoucher] email failed:", err?.message || String(err));
  }
}
