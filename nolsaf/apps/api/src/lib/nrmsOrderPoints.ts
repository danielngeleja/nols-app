import crypto from "node:crypto";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";

const ORDER_POINT_TYPES = ["ROOM", "TABLE"] as const;
export type OrderPointType = (typeof ORDER_POINT_TYPES)[number];

export function isValidOrderPointType(value: string): value is OrderPointType {
  return ORDER_POINT_TYPES.includes(value as OrderPointType);
}

export function generateOrderPointToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function buildMenuUrl(token: string): string {
  const configuredBase = [
    process.env.WEB_ORIGIN,
    process.env.APP_ORIGIN,
    process.env.APP_URL,
    process.env.BASE_URL,
    process.env.NEXT_PUBLIC_URL,
  ].find((value) => value?.trim());
  const base = (configuredBase || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000"))
    .trim()
    .replace(/\/+$/, "");

  if (!base) {
    throw new Error("WEB_ORIGIN must be configured to generate QR guest-menu URLs in production");
  }

  return `${base}/menu/${token}`;
}

export async function makeOrderPointQR(token: string): Promise<Buffer> {
  return QRCode.toBuffer(buildMenuUrl(token), { type: "png", margin: 1, scale: 8 });
}

export type OrderPointForSheet = {
  label: string;
  type: OrderPointType;
  token: string;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const COL_W = PAGE_W - MARGIN * 2;
const TEAL = "#02665e";
const DARK = "#014d47";
const TEXT_MUTED = "#6b7280";
const CARD_GAP = 16;
const QR_SIZE = 120;
const CARD_H = QR_SIZE + 48;
const CARDS_PER_ROW = 3;
const CARD_W = (COL_W - CARD_GAP * (CARDS_PER_ROW - 1)) / CARDS_PER_ROW;

export async function generateQrSheetPdf(
  propertyName: string,
  points: OrderPointForSheet[],
): Promise<Buffer> {
  const qrImages = await Promise.all(
    points.map(async (p) => ({
      ...p,
      png: await QRCode.toBuffer(buildMenuUrl(p.token), { type: "png", margin: 1, scale: 6 }),
    })),
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: "A4", compress: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      doc.fontSize(16).fillColor(DARK).text(propertyName, MARGIN, MARGIN, { width: COL_W });
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor(TEXT_MUTED).text("QR Order Points", MARGIN, doc.y, { width: COL_W });
      doc.moveDown(0.3);
      doc.fontSize(7).fillColor(TEXT_MUTED).text(
        `Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
        MARGIN, doc.y, { width: COL_W },
      );
      doc.moveDown(1);

      let y = doc.y;
      let col = 0;

      for (const item of qrImages) {
        if (y + CARD_H > PAGE_H - MARGIN) {
          doc.addPage();
          y = MARGIN;
          col = 0;
        }

        const x = MARGIN + col * (CARD_W + CARD_GAP);

        doc.save();
        doc.roundedRect(x, y, CARD_W, CARD_H, 6).lineWidth(0.5).strokeColor("#e5e7eb").stroke();
        doc.restore();

        const qrX = x + (CARD_W - QR_SIZE) / 2;
        doc.image(item.png, qrX, y + 6, { width: QR_SIZE, height: QR_SIZE });

        const typeLabel = item.type === "ROOM" ? "Room" : "Table";
        doc.fontSize(8).fillColor(TEAL).text(
          `${typeLabel}: ${item.label}`,
          x + 4, y + QR_SIZE + 10,
          { width: CARD_W - 8, align: "center" },
        );

        doc.fontSize(5).fillColor(TEXT_MUTED).text(
          "Scan to order",
          x + 4, y + QR_SIZE + 24,
          { width: CARD_W - 8, align: "center" },
        );

        col++;
        if (col >= CARDS_PER_ROW) {
          col = 0;
          y += CARD_H + CARD_GAP;
        }
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
