/**
 * AzamPay Disbursement — live sandbox smoke test.
 *
 *   Name Lookup (safe, no money, no callback):
 *     npx tsx scripts/azampay-disbursement-smoke.mts namelookup <bankName> <accountNumber>
 *     npx tsx scripts/azampay-disbursement-smoke.mts namelookup            # uses AzamPay's sample
 *
 *   Disburse (MOVES TEST MONEY, needs callback registered to finalise):
 *     npx tsx scripts/azampay-disbursement-smoke.mts disburse <destAccount> <amount>
 *
 * Loads apps/api/.env, then calls the real client against the configured
 * AZAMPAY_DISBURSE_API_URL. Prints the provider response, or the classified
 * AzamPayDisburseError (statusCode + providerMessage) so a failure is legible.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { azamPayNameLookup, azamPayDisburse, azamPayTransactionStatus, toAzamPayWireBankName } from "../src/services/azampay/disbursement/client.ts";
import { loadAzamPayDisbursementRequestConfig } from "../src/services/azampay/disbursement/config.ts";

const [mode, argA, argB] = process.argv.slice(2);

/**
 * Describe a thrown error WITHOUT relying on instanceof: under tsx the script
 * and the client can load errors.ts/errors.js as separate module instances,
 * so instanceof fails. We detect by `name` and read the known fields, which
 * preserves AzamPay's raw error body (the part worth sharing with them).
 */
function describeError(err: any): unknown {
  const name = err?.name;
  if (name === "AzamPayDisburseError") {
    return { type: "AzamPayDisburseError", httpStatus: err.httpStatus ?? null, providerMessage: err.providerMessage ?? null, retryClass: err.retryClass, rawBody: err.rawBody };
  }
  if (name === "AzamPayDisburseConfigurationError") {
    return { type: "ConfigurationError", operation: err.operation, missingKeys: err.missingKeys, message: err.message };
  }
  return { type: "Error", message: err?.message ?? String(err) };
}

/** Runs one call, capturing the response OR the classified error, never throwing. */
async function capture(
  name: string,
  request: unknown,
  call: () => Promise<unknown>
): Promise<{ name: string; request: unknown; ok: boolean; result: unknown }> {
  process.stdout.write(`- ${name} ... `);
  try {
    const result = await call();
    console.log("OK");
    return { name, request, ok: true, result };
  } catch (err) {
    console.log("ERROR");
    return { name, request, ok: false, result: describeError(err) };
  }
}

async function harvest() {
  const cfg = loadAzamPayDisbursementRequestConfig("azampesa");
  const host = process.env.AZAMPAY_DISBURSE_API_URL || "(default sandbox)";
  const rows: Array<{ name: string; request: unknown; ok: boolean; result: unknown }> = [];

  // --- Name Lookup matrix ---
  const nameLookups: Array<[string, string, string]> = [
    ["namelookup: Azampesa known", "Azampesa", "1710446004"],
    ["namelookup: Azampesa other", "Azampesa", "1780120104"],
    ["namelookup: Azampesa source acct", "Azampesa", "1000000164"],
    ["namelookup: Tigo", "Tigo", "0714000001"],
    ["namelookup: Airtel", "Airtel", "0784000001"],
    ["namelookup: empty account", "Azampesa", ""],
    ["namelookup: nonexistent", "Azampesa", "9999999999"],
  ];
  for (const [name, bankName, accountNumber] of nameLookups) {
    rows.push(await capture(name, { bankName, accountNumber }, () => azamPayNameLookup({ bankName: bankName as any, accountNumber })));
  }

  // --- Disburse, then poll its status ---
  const disburseReq = {
    // Record the same wire casing the client sends (toAzamPayWireBankName is
    // idempotent), so the report matches the real payload, not the internal
    // lowercase form.
    source: { countryCode: "TZ", fullName: cfg.sourceName, bankName: toAzamPayWireBankName(cfg.sourceProvider), accountNumber: cfg.sourceAccount, currency: "TZS" },
    destination: { countryCode: "TZ", fullName: "SMOKE TEST PAYEE", bankName: toAzamPayWireBankName(cfg.destinationProvider), accountNumber: "1710446004", currency: "TZS" },
    transferDetails: { type: cfg.transferType, amount: 1000, dateInEpoch: Math.floor(Date.now() / 1000) },
    externalReferenceId: `harvest-${Date.now()}`,
    remarks: "disbursement harvest",
  };
  const disbRow = await capture("disburse: Azampesa 1000 TZS", disburseReq, () => azamPayDisburse(disburseReq));
  rows.push(disbRow);

  const pgRef = disbRow.ok ? (disbRow.result as any)?.pgReferenceId : null;
  if (pgRef) {
    rows.push(await capture("status: poll disburse pgReferenceId", { pgReferenceId: pgRef, bankName: "Azampesa" }, () => azamPayTransactionStatus({ pgReferenceId: pgRef, bankName: "Azampesa" })));
  }
  rows.push(await capture("status: unknown pgReferenceId", { pgReferenceId: "does-not-exist-000", bankName: "Azampesa" }, () => azamPayTransactionStatus({ pgReferenceId: "does-not-exist-000", bankName: "Azampesa" })));

  // --- Write shareable report ---
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = ".local-reports/azampay-disbursement";
  mkdirSync(dir, { recursive: true });
  const jsonPath = `${dir}/harvest-${stamp}.json`;
  const mdPath = `${dir}/harvest-${stamp}.md`;

  writeFileSync(jsonPath, JSON.stringify({ host, generatedAt: new Date().toISOString(), rows }, null, 2));

  const md: string[] = [
    `# AzamPay Disbursement — test environment response harvest`,
    ``,
    `- Host: \`${host}\``,
    `- Generated: ${new Date().toISOString()}`,
    `- Checksum composition (Name Lookup): \`${process.env.AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP}\``,
    `- Checksum composition (Disburse): \`${process.env.AZAMPAY_CHECKSUM_FIELDS_DISBURSE}\``,
    `- transferDetails.type: \`${process.env.AZAMPAY_DISBURSE_TRANSFER_TYPE}\``,
    ``,
    `Each case below shows exactly what we sent and the raw response your test environment returned.`,
    ``,
  ];
  for (const r of rows) {
    md.push(`## ${r.name} — ${r.ok ? "OK" : "ERROR"}`);
    md.push(``, `**Request**`, "```json", JSON.stringify(r.request, null, 2), "```", ``);
    md.push(`**Response**`, "```json", JSON.stringify(r.result, null, 2), "```", ``);
  }
  writeFileSync(mdPath, md.join("\n"));

  console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}`);
}

async function run() {
  console.log(`host = ${process.env.AZAMPAY_DISBURSE_API_URL || "(default sandbox)"}`);

  if (mode === "harvest") {
    await harvest();
    return;
  }

  if (mode === "disburse") {
    const destAccount = argA;
    const amount = Number(argB);
    if (!destAccount || !Number.isFinite(amount)) {
      throw new Error("usage: disburse <destAccount> <amount>");
    }
    const cfg = loadAzamPayDisbursementRequestConfig("azampesa");
    const res = await azamPayDisburse({
      source: { countryCode: "TZ", fullName: cfg.sourceName, bankName: cfg.sourceProvider, accountNumber: cfg.sourceAccount, currency: "TZS" },
      destination: { countryCode: "TZ", fullName: "SMOKE TEST PAYEE", bankName: cfg.destinationProvider, accountNumber: destAccount, currency: "TZS" },
      transferDetails: { type: cfg.transferType, amount, dateInEpoch: Math.floor(Date.now() / 1000) },
      externalReferenceId: `smoke-${Date.now()}`,
      remarks: "disbursement smoke test",
    });
    console.log("DISBURSE OK:", JSON.stringify(res, null, 2));
    return;
  }

  if (mode === "status") {
    const pgReferenceId = argA;
    const bankName = argB || "Azampesa";
    if (!pgReferenceId) throw new Error("usage: status <pgReferenceId> [bankName]");
    const res = await azamPayTransactionStatus({ pgReferenceId, bankName });
    console.log("STATUS OK:", JSON.stringify(res, null, 2));
    return;
  }

  // default: namelookup
  const bankName = argA || "Azampesa";
  const accountNumber = argB || "1710446004";
  console.log(`namelookup -> bankName=${bankName} accountNumber=${accountNumber}`);
  const res = await azamPayNameLookup({ bankName: bankName as any, accountNumber });
  console.log("NAMELOOKUP OK:", JSON.stringify(res, null, 2));
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(JSON.stringify(describeError(err), null, 2));
  process.exit(1);
});
