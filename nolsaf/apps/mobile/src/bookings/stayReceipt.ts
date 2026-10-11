import { apiBaseUrl } from "../lib/apiClient";

/**
 * The official stay receipt: the same PDF the website offers on
 * /account/bookings/:reference/receipt, from GET /api/customer/bookings/:key/pdf.
 * Only paid bookings with a check-in code have one.
 */
export type StayReceiptFile = { uri: string; fileName: string; sizeLabel: string };

/**
 * Loaded lazily so a build made before expo-file-system, expo-sharing and
 * expo-print were added says "update the app" instead of crashing.
 */
function nativeModules() {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require("expo-file-system") as typeof import("expo-file-system");
    const sharing = require("expo-sharing") as typeof import("expo-sharing");
    let print: typeof import("expo-print") | null = null;
    try {
      print = require("expo-print") as typeof import("expo-print");
    } catch {
      print = null;
    }
    /* eslint-enable @typescript-eslint/no-require-imports */
    void fs.Paths.cache;
    return { fs, sharing, print };
  } catch {
    return null;
  }
}

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whether this build can save and open receipts. */
export function canSaveReceipts() {
  return Boolean(nativeModules());
}

/** Whether this build can print (system print preview, which also offers Save as PDF). */
export function canPrintReceipts() {
  return Boolean(nativeModules()?.print);
}

/**
 * Downloads the receipt into the app cache.
 * @param bookingKey the opaque bk_ reference, or the booking number where only that is known.
 */
export async function downloadStayReceipt(token: string, bookingKey: string | number, bookingCode?: string | null): Promise<StayReceiptFile> {
  const native = nativeModules();
  if (!native) throw new Error("Update the app to download receipts.");
  const safeCode = String(bookingCode || bookingKey).replace(/[^a-zA-Z0-9-]+/g, "-");
  const fileName = `NoLSAF-receipt-${safeCode}.pdf`;
  const target = new native.fs.File(native.fs.Paths.cache, fileName);
  if (target.exists) target.delete();
  let file: InstanceType<typeof native.fs.File>;
  try {
    file = await native.fs.File.downloadFileAsync(`${apiBaseUrl()}/api/customer/bookings/${encodeURIComponent(String(bookingKey))}/pdf`, target, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf", "X-NoLSAF-Client": "TRAVELLER_APP" },
      idempotent: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/404/.test(message)) throw new Error("This receipt is not available yet. It appears once your payment is confirmed.");
    if (/400/.test(message)) throw new Error("Your booking code is still being prepared. Try again in a minute.");
    throw new Error("We could not download your receipt. Check your connection and try again.");
  }
  return { uri: file.uri, fileName, sizeLabel: sizeLabel(file.size ?? 0) };
}

/** Opens the phone's share sheet so the PDF can be opened in a viewer, saved or sent. */
export async function openStayReceipt(receipt: StayReceiptFile) {
  const native = nativeModules();
  if (!native || !(await native.sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  await native.sharing.shareAsync(receipt.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Open or save your receipt" });
}

/** System print preview for the receipt. */
export async function printStayReceipt(receipt: StayReceiptFile) {
  const native = nativeModules();
  if (!native?.print) throw new Error("Update the app to print receipts.");
  await native.print.printAsync({ uri: receipt.uri });
}

export function discardStayReceipt(receipt: StayReceiptFile | null) {
  if (!receipt) return;
  try {
    const native = nativeModules();
    if (!native) return;
    const file = new native.fs.File(receipt.uri);
    if (file.exists) file.delete();
  } catch {
    // The system clears the cache anyway.
  }
}
