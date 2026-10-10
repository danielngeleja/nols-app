// Brings open NRMS usage statements back in line with each account's balance.
//
// Why: before nrmsStatements.ts, an admin credit lowered the account balance
// but only reduced the newest open statement (or none at all). Owners could be
// left with a statement asking for usage that was already forgiven, for example
// a TZS 129,000 statement on an account whose balance is TZS 1,500.
//
// What it does, per account: if the open statements together ask for more than
// unpaidBalance, it reduces them oldest first until they match, recording each
// reduction as an ADMIN reversal row on that statement, and reissues the payment
// link for the corrected amount. The balance itself is never changed; it is the
// figure already right. Accounts with a payment in flight are skipped.
//
// SAFE BY DEFAULT: runs as a dry run and only prints what it would do.
//   npx tsx scripts/reconcile-nrms-statements.ts                (dry run)
//   npx tsx scripts/reconcile-nrms-statements.ts --apply        (writes)
// Optional: --property=<id> to limit to one property.

import dotenv from "dotenv";
import { prisma } from "@nolsaf/prisma";
import { refreshNrmsStatementToken } from "../src/lib/nrmsStatements.js";

dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const propertyArg = process.argv.find((arg) => arg.startsWith("--property="));
const PROPERTY_ID = propertyArg ? Number(propertyArg.split("=")[1]) : null;
const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;

async function main() {
  const db = prisma as any;
  const accounts = await db.ownerPaygAccount.findMany({
    where: PROPERTY_ID ? { propertyId: PROPERTY_ID } : {},
    include: { policy: true, property: { select: { title: true } } },
    orderBy: { id: "asc" },
  });

  let overBilled = 0;
  let fixed = 0;
  for (const account of accounts) {
    const open = await db.nrmsBillingStatement.findMany({ where: { accountId: account.id, status: "PAYABLE" }, orderBy: { id: "asc" } });
    const asked = money(open.reduce((sum: number, row: any) => sum + Number(row.amount), 0));
    const owed = Math.max(0, money(account.unpaidBalance));
    const excess = money(asked - owed);
    if (excess <= 0) {
      if (asked < owed) console.log(`  note  property ${account.propertyId} (${account.property.title}): balance ${owed}, open statements ${asked}. Unbilled usage is picked up by the next statement; nothing to correct.`);
      continue;
    }
    overBilled += 1;
    const inFlight = await db.nrmsServicePaymentToken.findFirst({ where: { statement: { accountId: account.id, status: "PAYABLE" }, status: "PROCESSING" }, select: { id: true } });
    const plan: Array<{ statementId: number; from: number; to: number }> = [];
    let remaining = excess;
    for (const statement of open) {
      if (remaining <= 0) break;
      const current = money(statement.amount);
      const take = Math.min(remaining, current);
      plan.push({ statementId: statement.id, from: current, to: money(current - take) });
      remaining = money(remaining - take);
    }
    console.log(`${inFlight ? "SKIP " : "FIX  "} property ${account.propertyId} (${account.property.title}): statements ask ${asked} ${account.policy.currency}, balance is ${owed}. Excess ${excess}.`);
    for (const step of plan) console.log(`        statement #${step.statementId}: ${step.from} -> ${step.to}${step.to === 0 ? " (void)" : ""}`);
    if (inFlight) { console.log("        a payment is with the provider; run again once it settles."); continue; }
    if (!APPLY) continue;

    await db.$transaction(async (tx: any) => {
      const now = new Date();
      for (const step of plan) {
        const take = money(step.from - step.to);
        const event = await tx.nrmsUsageEvent.create({
          data: {
            accountId: account.id, propertyId: account.propertyId, reservationId: null, allocationId: null, policyId: account.policyId,
            serviceDate: now, classification: "REVERSAL", source: "ADMIN", currency: account.policy.currency, amount: -take,
          },
        });
        await tx.nrmsBillingStatementItem.create({ data: { statementId: step.statementId, usageEventId: event.id, amount: -take } });
        await tx.nrmsBillingStatement.update({ where: { id: step.statementId }, data: { amount: step.to, status: step.to > 0 ? "PAYABLE" : "VOID" } });
        await refreshNrmsStatementToken(tx, { id: step.statementId, currency: account.policy.currency }, step.to, now);
      }
      await tx.adminAudit.create({
        data: { adminId: null, targetUserId: account.ownerId, action: "NRMS_STATEMENT_RECONCILE", details: { propertyId: account.propertyId, asked, owed, excess, plan } },
      });
    }, { maxWait: 10_000, timeout: 30_000 });
    fixed += 1;
  }

  console.log("");
  console.log(`${accounts.length} account(s) checked, ${overBilled} asking for more than their balance.`);
  console.log(APPLY ? `${fixed} corrected.` : "Dry run: nothing was changed. Re-run with --apply to correct them.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
