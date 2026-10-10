import { Share } from "react-native";

import { AccountExport, buildDataReportHtml, dataReportReference } from "./dataReport";

export type DataFormat = "pdf" | "json";

/** A prepared copy on the device, ready to save or share. */
export type PreparedCopy = {
  format: DataFormat;
  fileName: string;
  /** file:// URI, or null when the installed build lacks the file modules (text fallback). */
  uri: string | null;
  /** Kept only for the text fallback. */
  text: string | null;
  sizeLabel: string;
};

// Android's share intent cannot carry much more than this as plain text.
const TEXT_SHARE_LIMIT = 400_000;

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Loaded lazily so a build made before expo-file-system, expo-sharing and
 * expo-print were added keeps working (JSON falls back to text sharing).
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
    // Touching the class confirms the native side exists, not just the JS package.
    void fs.Paths.cache;
    return { fs, sharing, print };
  } catch {
    return null;
  }
}

/** Whether this build can make the readable PDF on the device. */
export function canMakePdf() {
  return Boolean(nativeModules()?.print);
}

/** Writes the copy to the app cache as a named file (or keeps it as text when the build cannot). */
export async function prepareCopy(data: AccountExport, format: DataFormat): Promise<PreparedCopy> {
  const date = (data.exportedAt || new Date().toISOString()).slice(0, 10);
  const fileName = `nolsaf-my-data-${date}.${format}`;
  const native = nativeModules();

  if (format === "pdf") {
    if (!native?.print) throw new Error("This version of the app cannot make a PDF yet. Choose the JSON copy, or update the app.");
    const html = buildDataReportHtml(data, dataReportReference(new Date(data.exportedAt || Date.now())));
    const printed = await native.print.printToFileAsync({ html });
    const source = new native.fs.File(printed.uri);
    const target = new native.fs.File(native.fs.Paths.cache, fileName);
    if (target.exists) target.delete();
    source.move(target);
    return { format, fileName, uri: target.uri, text: null, sizeLabel: sizeLabel(target.size ?? 0) };
  }

  const text = JSON.stringify(data, null, 2);
  if (!native) return { format, fileName, uri: null, text, sizeLabel: sizeLabel(text.length) };
  const file = new native.fs.File(native.fs.Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  return { format, fileName, uri: file.uri, text: null, sizeLabel: sizeLabel(file.size ?? text.length) };
}

/** Opens the phone's share sheet with the file, so it can be saved to Files or sent. */
export async function shareCopy(copy: PreparedCopy) {
  const native = nativeModules();
  if (copy.uri && native && (await native.sharing.isAvailableAsync())) {
    await native.sharing.shareAsync(copy.uri, {
      mimeType: copy.format === "pdf" ? "application/pdf" : "application/json",
      UTI: copy.format === "pdf" ? "com.adobe.pdf" : "public.json",
      dialogTitle: "Save or share your NoLSAF data"
    });
    return;
  }
  const text = copy.text ?? "";
  if (text.length > TEXT_SHARE_LIMIT) {
    throw new Error("Your copy is too large to share from this version of the app. Update the app to save it as a file.");
  }
  await Share.share({ title: copy.fileName, message: text });
}

/** Removes the cached copy once the person is done with it. */
export function discardCopy(copy: PreparedCopy | null) {
  if (!copy?.uri) return;
  try {
    const native = nativeModules();
    if (!native) return;
    const file = new native.fs.File(copy.uri);
    if (file.exists) file.delete();
  } catch {
    // Cache files are cleared by the system anyway.
  }
}
