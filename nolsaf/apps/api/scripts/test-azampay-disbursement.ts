/**
 * Safe AzamPay disbursement test CLI.
 *
 * This script intentionally exposes only read-only/non-money operations:
 * token authentication, Name Lookup, and Transaction Status. It must never
 * grow a `disburse` command; real payouts belong behind the application's
 * approval, batching, and two-person release controls.
 */

import "../src/env.js";
import {
  getAzamPayDisburseToken,
  invalidateAzamPayDisburseToken,
} from "../src/services/azampay/disbursement/auth.js";
import { getRedis } from "../src/lib/redis.js";
import {
  azamPayNameLookup,
  azamPayTransactionStatus,
} from "../src/services/azampay/disbursement/client.js";
import { AzamPayDisburseError } from "../src/services/azampay/disbursement/errors.js";

const providers = new Set(["airtel", "tigo", "azampesa"]);
let providerOperationStarted = false;

async function useFreshProviderToken(): Promise<void> {
  providerOperationStarted = true;
  await invalidateAzamPayDisburseToken();
}

function option(name: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing required option --${name}=...`);
  return value;
}

function providerOption(): "airtel" | "tigo" | "azampesa" {
  const value = requiredOption("provider").toLowerCase();
  if (!providers.has(value)) {
    throw new Error("--provider must be airtel, tigo, or azampesa");
  }
  return value as "airtel" | "tigo" | "azampesa";
}

function mask(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${"*".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

function usage(): void {
  console.log(`Safe AzamPay test commands:
  npm run azp:disbursement:test -- auth
  npm run azp:disbursement:test -- lookup --provider=azampesa --account=1710446004
  npm run azp:disbursement:test -- status --provider=azampesa --pg-reference=PG_REFERENCE

These commands never submit a disbursement or print credentials/access tokens.`);
}

async function main(): Promise<void> {
  const command = String(process.argv[2] || "help").toLowerCase();

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "auth") {
    await useFreshProviderToken();
    const token = await getAzamPayDisburseToken();
    console.log(JSON.stringify({ ok: Boolean(token), operation: "AUTH", tokenReceived: Boolean(token) }, null, 2));
    return;
  }

  if (command === "lookup") {
    await useFreshProviderToken();
    const provider = providerOption();
    const accountNumber = requiredOption("account");
    const result = await azamPayNameLookup({ bankName: provider, accountNumber });
    console.log(
      JSON.stringify(
        {
          ok: result.status === true,
          operation: "NAME_LOOKUP",
          statusCode: result.statusCode,
          provider: result.bankName || provider,
          account: mask(result.accountNumber || accountNumber),
          accountName: result.name || null,
          message: result.message || null,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "status") {
    await useFreshProviderToken();
    const provider = providerOption();
    const pgReferenceId = requiredOption("pg-reference");
    const result = await azamPayTransactionStatus({ pgReferenceId, bankName: provider });
    console.log(
      JSON.stringify(
        {
          ok: result.success === true,
          operation: "TRANSACTION_STATUS",
          statusCode: result.statusCode,
          pgReferenceId: result.pgReferenceId,
          transactionStatus: result.status || null,
          message: result.message || null,
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown command ${JSON.stringify(command)}`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof AzamPayDisburseError) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            error: error.providerMessage || error.message,
            httpStatus: error.httpStatus,
            retryClass: error.retryClass,
          },
          null,
          2
        )
      );
    } else {
      console.error(error instanceof Error ? error.message : "AzamPay test failed");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!providerOperationStarted) return;
    const redis = getRedis();
    if (!redis) return;
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  });
