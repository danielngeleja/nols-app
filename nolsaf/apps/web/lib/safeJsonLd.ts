/**
 * Serialize JSON for an inline <script> element.
 *
 * JSON.stringify does not escape "<", so an attacker-controlled value such as
 * "</script>" can terminate an application/ld+json block and become executable
 * HTML. Escaping the HTML-significant characters keeps the JSON valid while
 * making it impossible to break out of the script element.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
