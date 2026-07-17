// Flips existing ACTIVE NRMS staff memberships to PENDING and emails each
// staff member a fresh confirmation invite, so legacy assignments go through
// the same confirm flow as new ones.
//
// SAFE BY DEFAULT: runs as a dry run and only prints what it would do.
//   npx tsx scripts/reconfirm-nrms-staff.ts            (dry run, no changes)
//   npx tsx scripts/reconfirm-nrms-staff.ts --apply    (flips + sends emails)
//
// Optional: --property=<id> to limit to one property.

import dotenv from "dotenv";
import { prisma } from "@nolsaf/prisma";

dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const propertyArg = process.argv.find((arg) => arg.startsWith("--property="));
const PROPERTY_ID = propertyArg ? Number(propertyArg.split("=")[1]) : null;

async function main() {
  const { sendMail } = await import("../src/lib/mailer.js");
  const { nrmsStaffInviteEmail } = await import("../src/lib/nrmsStaffEmails.js");
  const { signNrmsStaffInviteToken } = await import("../src/lib/nrmsStaffInviteToken.js");

  const db = prisma as any;
  const memberships = await db.nrmsStaffMembership.findMany({
    where: {
      status: "ACTIVE",
      ...(PROPERTY_ID ? { propertyId: PROPERTY_ID } : {}),
    },
    include: {
      user: { select: { id: true, email: true, fullName: true, name: true } },
      property: { select: { id: true, title: true, owner: { select: { fullName: true, name: true } } } },
      outlet: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });

  if (memberships.length === 0) {
    console.log("No ACTIVE NRMS staff memberships found. Nothing to do.");
    return;
  }

  const origin = (process.env.APP_URL || process.env.WEB_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"}: ${memberships.length} active membership(s)${PROPERTY_ID ? ` for property ${PROPERTY_ID}` : ""}\n`);

  let flipped = 0;
  let emailed = 0;
  for (const membership of memberships) {
    const staffLabel = membership.user.fullName || membership.user.name || `user #${membership.user.id}`;
    const line = `membership #${membership.id}: ${staffLabel} <${membership.user.email ?? "no email"}> as ${membership.role} at "${membership.property.title}"${membership.outlet ? ` (${membership.outlet.name})` : ""}`;

    if (!membership.user.email) {
      console.log(`SKIP  ${line} -> no email address, would be locked out with no way to confirm`);
      continue;
    }
    if (!APPLY) {
      console.log(`WOULD ${line} -> set PENDING + send invite`);
      continue;
    }

    await db.nrmsStaffMembership.update({ where: { id: membership.id }, data: { status: "PENDING" } });
    flipped += 1;

    try {
      const token = signNrmsStaffInviteToken(membership.id, membership.user.id);
      const confirmUrl = `${origin}/nrms/confirm?token=${encodeURIComponent(token)}`;
      const { subject, html } = nrmsStaffInviteEmail({
        staffName: membership.user.fullName || membership.user.name || "there",
        propertyTitle: membership.property.title,
        role: membership.role,
        outletName: membership.outlet?.name ?? null,
        assignedByName: membership.property.owner?.fullName || membership.property.owner?.name || "The property manager",
        confirmUrl,
      });
      await sendMail(membership.user.email, subject, html);
      emailed += 1;
      console.log(`DONE  ${line} -> PENDING, invite sent`);
    } catch (cause) {
      console.error(`ERROR ${line} -> PENDING, but invite email FAILED (assign again from Staff & roles to resend)`, cause);
    }
  }

  if (APPLY) console.log(`\nFlipped ${flipped} membership(s) to PENDING, sent ${emailed} invite email(s).`);
  else console.log("\nDry run only. Re-run with --apply to make changes.");
}

main()
  .catch((cause) => {
    console.error(cause);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
