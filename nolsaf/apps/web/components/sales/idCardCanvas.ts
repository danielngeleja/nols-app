/**
 * Draws the NoLSAF sales representative ID card onto a canvas. The same
 * drawing is used for the on-screen card and for the PNG the representative
 * downloads or shares, so what an owner receives is exactly what was shown.
 *
 * Design: one continuous deep teal card (no split panels) with a fine
 * security line pattern, the NoLSAF mark on a white tile (the mark keeps its
 * own colour and shape), the photo seated beside the name, and the typed code
 * with a compact QR along the bottom. Public wording says "Authorised sales
 * representative": "partner" is the legal term inside the portal only.
 */
import QRCode from "qrcode";

export type IdCardData = {
  name: string;
  agentCode: string;
  cardNumber: string;
  code: string;
  region: string | null;
  territory: string | null;
  photoUrl: string;
  expiresAt: string;
  verifyUrl: string;
  /** Leads an active NoLSAF team: a gold pill beside the role, nothing else moves. */
  teamLead?: boolean;
};

export const CARD_WIDTH = 1012;
export const CARD_HEIGHT = 638;

const TEAL = "#02665e";
const WHITE = "#ffffff";
const SOFT = "#bfe6de";
const LABEL = "#a9d8cf";
const QR_INK = "#0b2a26";
/** Team lead gold: one colour for the lead role on the card, the portal and the verify page. */
const LEAD_GOLD = "#f5c451";
const LEAD_INK = "#4a3205";
const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

const PAD_X = 50;
const PAD_Y = 30;
const RIGHT = CARD_WIDTH - PAD_X;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function font(weight: number, size: number, family = FONT) {
  return `${weight} ${size}px ${family}`;
}

/** Shrink the font until the text fits the width. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: number, family = FONT) {
  let s = size;
  ctx.font = font(weight, s, family);
  while (s > 14 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = font(weight, s, family);
  }
}

function eatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

/** Fine wavy security lines across the whole card. */
function securityLines(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 18; k += 1) {
    ctx.beginPath();
    for (let x = 0; x <= CARD_WIDTH; x += 6) {
      const y = 10 + k * 36 + Math.sin(x / 40 + k * 0.6) * 14 + Math.cos(x / 14 + k) * 3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export async function drawIdCard(canvas: HTMLCanvasElement, data: IdCardData): Promise<void> {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const [photo, logo, qr] = await Promise.all([
    loadImage(data.photoUrl),
    loadImage("/assets/NoLS2025-04.png"),
    QRCode.toDataURL(data.verifyUrl, { margin: 0, width: 300, errorCorrectionLevel: "M", color: { dark: QR_INK, light: "#ffffff" } }).then(loadImage),
  ]);

  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  roundRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 28);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = TEAL;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  securityLines(ctx);
  ctx.textBaseline = "alphabetic";

  // Top row: mark on a white tile, brand and title, live status chip.
  const tile = 66;
  ctx.fillStyle = WHITE;
  roundRect(ctx, PAD_X, PAD_Y, tile, tile, 15);
  ctx.fill();
  if (logo) {
    const inner = 50;
    const scale = Math.min(inner / logo.width, inner / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    ctx.drawImage(logo, PAD_X + (tile - w) / 2, PAD_Y + (tile - h) / 2, w, h);
  }
  ctx.fillStyle = WHITE;
  ctx.font = font(700, 27);
  ctx.fillText("NoLSAF", PAD_X + tile + 16, PAD_Y + 30);
  ctx.fillStyle = SOFT;
  ctx.font = font(500, 18);
  ctx.fillText("Authorised sales representative", PAD_X + tile + 16, PAD_Y + 57);

  const chipText = "Active";
  ctx.font = font(600, 18);
  const chipW = ctx.measureText(chipText).width + 48;
  const chipH = 36;
  const chipX = RIGHT - chipW;
  const chipY = PAD_Y + (tile - chipH) / 2;
  ctx.fillStyle = "#e3f7ef";
  roundRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
  ctx.fill();
  ctx.fillStyle = "#12a26f";
  ctx.beginPath();
  ctx.arc(chipX + 20, chipY + chipH / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#075e44";
  ctx.fillText(chipText, chipX + 32, chipY + 25);

  // Middle: photo seated beside the name.
  const pw = 246;
  const ph = 296;
  const px = PAD_X;
  const py = 128;
  const radius = 26;
  roundRect(ctx, px - 4, py - 4, pw + 8, ph + 8, radius + 4);
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.save();
  roundRect(ctx, px, py, pw, ph, radius);
  ctx.clip();
  ctx.fillStyle = "#cfe7e2";
  ctx.fillRect(px, py, pw, ph);
  if (photo) {
    const scale = Math.max(pw / photo.width, ph / photo.height);
    const w = photo.width * scale;
    const h = photo.height * scale;
    ctx.drawImage(photo, px + (pw - w) / 2, py + (ph - h) / 2, w, h);
  } else {
    ctx.fillStyle = TEAL;
    ctx.font = font(700, 76);
    ctx.textAlign = "center";
    ctx.fillText(data.name.split(/\s+/).map((part) => part[0] || "").slice(0, 2).join("").toUpperCase(), px + pw / 2, py + ph / 2 + 26);
    ctx.textAlign = "left";
  }
  ctx.restore();

  const tx = px + pw + 46;
  const textWidth = RIGHT - tx;
  ctx.fillStyle = WHITE;
  fitFont(ctx, data.name, textWidth, 42, 700);
  ctx.fillText(data.name, tx, 196);
  ctx.fillStyle = SOFT;
  ctx.font = font(500, 20);
  ctx.fillText("Sales representative", tx, 230);
  if (data.teamLead) {
    // Same line as the role, so the name, ID, validity and area keep their places.
    const roleWidth = ctx.measureText("Sales representative").width;
    const label = "★ Team lead";
    ctx.font = font(700, 17);
    const pillW = ctx.measureText(label).width + 28;
    const pillX = tx + roleWidth + 16;
    if (pillX + pillW <= RIGHT) {
      ctx.fillStyle = LEAD_GOLD;
      roundRect(ctx, pillX, 207, pillW, 30, 15);
      ctx.fill();
      ctx.fillStyle = LEAD_INK;
      ctx.fillText(label, pillX + 14, 228);
    }
  }

  const colW = textWidth / 2;
  const field = (label: string, value: string, x: number, y: number, width: number, mono = false) => {
    ctx.fillStyle = LABEL;
    ctx.font = font(500, 17);
    ctx.fillText(label, x, y);
    ctx.fillStyle = WHITE;
    fitFont(ctx, value, width - 12, 23, 600, mono ? MONO : FONT);
    ctx.fillText(value, x, y + 31);
  };
  field("ID number", data.agentCode, tx, 290, colW, true);
  field("Valid until", eatDate(data.expiresAt), tx + colW, 290, colW);
  field("Area", [data.territory, data.region].filter(Boolean).join(", ") || "Tanzania", tx, 362, textWidth);

  // Bottom: hairline, typed code, compact QR.
  const lineY = 452;
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(PAD_X, lineY, RIGHT - PAD_X, 1);

  const qrBox = 136;
  const qrX = RIGHT - qrBox;
  const qrY = CARD_HEIGHT - PAD_Y - qrBox;
  ctx.fillStyle = WHITE;
  roundRect(ctx, qrX, qrY, qrBox, qrBox, 12);
  ctx.fill();
  if (qr) ctx.drawImage(qr, qrX + 9, qrY + 9, qrBox - 18, qrBox - 18);

  const codeWidth = qrX - PAD_X - 24;
  ctx.fillStyle = LABEL;
  ctx.font = font(500, 17);
  ctx.fillText("Scan the code or verify at nolsaf.com/verify/sales", PAD_X, CARD_HEIGHT - PAD_Y - 44);
  ctx.fillStyle = WHITE;
  fitFont(ctx, data.code, codeWidth, 24, 700, MONO);
  ctx.fillText(data.code, PAD_X, CARD_HEIGHT - PAD_Y - 10);

  ctx.restore();
}
