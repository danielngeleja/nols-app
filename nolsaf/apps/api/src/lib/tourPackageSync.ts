import { prisma } from "@nolsaf/prisma";

const asNumber = (value: unknown): number => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const asInt = (value: unknown): number | null => {
  const parsed = Math.trunc(asNumber(value));
  return parsed > 0 ? parsed : null;
};

/** Keeps the normalized catalogue in sync while the existing profile editor remains compatible. */
export async function syncOperatorTourPackages(operatorAgentId: number, packageItems: unknown, status: "DRAFT" | "PUBLISHED" = "DRAFT") {
  const items = Array.isArray(packageItems) ? packageItems : [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] && typeof items[index] === "object" ? items[index] as Record<string, any> : {};
    const legacyPackageId = String(item.id || index).slice(0, 120);
    const latest = await prisma.tourPackage.findFirst({ where: { operatorAgentId, legacyPackageId }, orderBy: { version: "desc" } });
    const content = item as any;
    const data = {
      status,
      name: String(item.name || item.title || "Tour package").slice(0, 200),
      destination: String(item.destination || "").slice(0, 200) || null,
      category: String(item.category || "").slice(0, 100) || null,
      currency: String(item.currency || "TZS").toUpperCase().slice(0, 3),
      pricePerPerson: asNumber(item.pricePerPerson),
      minPax: asInt(item.minPax),
      maxPax: asInt(item.maxPax),
      content,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    };
    if (!latest) {
      await prisma.tourPackage.create({ data: { operatorAgentId, legacyPackageId, version: 1, ...data } });
    } else if (status === "PUBLISHED" && JSON.stringify(latest.content) !== JSON.stringify(content)) {
      await prisma.$transaction([
        prisma.tourPackage.update({ where: { id: latest.id }, data: { status: "ARCHIVED", archivedAt: new Date() } }),
        prisma.tourPackage.create({ data: { operatorAgentId, legacyPackageId, version: latest.version + 1, ...data } }),
      ]);
    } else {
      await prisma.tourPackage.update({ where: { id: latest.id }, data });
    }
  }
}
