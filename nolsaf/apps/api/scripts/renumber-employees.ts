import { prisma } from "@nolsaf/prisma";

/**
 * One-off: move staff registered before the NSE scheme (EMP-0001) to
 * NSE-<year joined>-<sequence>, continuing after any NSE numbers already used.
 * Payslips on runs that are not paid yet (draft, approved, cancelled) follow
 * the new number. Paid payslips are issued documents and keep what they say.
 *
 * Dry run by default; prints the plan. Add --apply to write.
 *   npx tsx scripts/renumber-employees.ts
 *   npx tsx scripts/renumber-employees.ts --apply
 */

const apply = process.argv.includes("--apply");
const joinYear = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric" }).format(d);

async function main() {
  const legacy = await prisma.employee.findMany({
    where: { employeeNo: { startsWith: "EMP-" } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, employeeNo: true, fullName: true, startDate: true },
  });
  if (!legacy.length) {
    console.log("No EMP- employees left. Nothing to do.");
    return;
  }

  // Next free sequence per year, after the NSE numbers already issued.
  const next = new Map<string, number>();
  const nextFor = async (year: string) => {
    if (!next.has(year)) {
      const prefix = `NSE-${year}-`;
      const last = await prisma.employee.findFirst({ where: { employeeNo: { startsWith: prefix } }, orderBy: { employeeNo: "desc" }, select: { employeeNo: true } });
      next.set(year, (Number(last?.employeeNo.slice(prefix.length)) || 0) + 1);
    }
    const seq = next.get(year)!;
    next.set(year, seq + 1);
    return `NSE-${year}-${String(seq).padStart(4, "0")}`;
  };

  const plan: Array<{ id: number; from: string; to: string; name: string }> = [];
  for (const e of legacy) plan.push({ id: e.id, from: e.employeeNo, to: await nextFor(joinYear(e.startDate)), name: e.fullName });

  console.table(plan.map(({ from, to, name }) => ({ from, to, name })));
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write these numbers.");
    return;
  }

  for (const p of plan) {
    await prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: p.id }, data: { employeeNo: p.to } });
      const slips = await tx.payslip.findMany({
        where: { employeeId: p.id, run: { status: { not: "PAID" } } },
        select: { id: true, payslipNumber: true, employeeSnapshot: true, run: { select: { runNumber: true } } },
      });
      for (const s of slips) {
        const snapshot = s.employeeSnapshot && typeof s.employeeSnapshot === "object" ? { ...(s.employeeSnapshot as Record<string, unknown>), employeeNo: p.to } : s.employeeSnapshot;
        await tx.payslip.update({
          where: { id: s.id },
          data: { payslipNumber: `${s.run.runNumber.replace(/^PR-/, "PS-")}-${p.to}`, employeeSnapshot: snapshot as any },
        });
      }
      await tx.auditLog.create({
        data: { action: "EMPLOYEE_RENUMBERED", entity: `EMPLOYEE:${p.id}`, entityId: p.id, beforeJson: { employeeNo: p.from } as any, afterJson: { employeeNo: p.to, payslipsUpdated: slips.length } as any },
      });
      console.log(`${p.from} -> ${p.to} (${p.name}), ${slips.length} payslip(s) updated`);
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
