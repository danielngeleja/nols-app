// ISO/IEC 15417 Code 128 (code set B), shared by the PDFKit documents
// (pdfDocuments.ts) and the HTML documents that render as inline SVG.

// Each digit is the width, in modules, of alternating bars and spaces.
// Index 106 is the stop symbol.
export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

export const CODE128_QUIET_ZONE_MODULES = 10;

/** Start code B, data, mod-103 checksum and stop, as symbol indexes. */
export function code128BValues(value: string): number[] {
  const normalized = value.toUpperCase();
  if (!/^[\x20-\x7e]+$/.test(normalized)) {
    throw new Error("Code 128 receipt references must contain printable ASCII characters only");
  }

  const startCodeB = 104;
  const data = Array.from(normalized, (char) => char.charCodeAt(0) - 32);
  const checksum = (startCodeB + data.reduce((sum, code, index) => sum + code * (index + 1), 0)) % 103;
  return [startCodeB, ...data, checksum, 106];
}

/**
 * Code 128 as a standalone SVG. Bars are drawn in whole modules on a
 * viewBox, so the symbol stays scannable at any printed width.
 */
export function code128Svg(value: string, options: { height?: number; color?: string; title?: string } = {}): string {
  const values = code128BValues(value);
  const height = options.height ?? 40;
  const color = options.color ?? "#0f2e2b";
  const bars: string[] = [];
  let cursor = CODE128_QUIET_ZONE_MODULES;
  for (const code of values) {
    const pattern = CODE128_PATTERNS[code];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) bars.push(`<rect x="${cursor}" y="0" width="${width}" height="${height}"/>`);
      cursor += width;
    }
  }
  const total = cursor + CODE128_QUIET_ZONE_MODULES;
  const title = (options.title ?? value).replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" role="img" aria-label="Code 128 barcode ${title}" shape-rendering="crispEdges"><title>${title}</title><g fill="${color}">${bars.join("")}</g></svg>`;
}
