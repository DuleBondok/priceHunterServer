/**
 * Revert Univerexport prices wrongly divided by 1000 (e.g. Pampers 5624.99 -> 5.62).
 * Run only if refreshUniverexportPrices.ts is not used.
 */
import prisma from "../prismaClient";

function parseStoredPriceRsd(price: string | null): number | null {
  if (!price) return null;
  const n = Number(String(price).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatPriceRsd(value: number): string {
  return `${value.toFixed(2)} RSD`;
}

/** Legitimate cheap grocery packs (10G, 20G, …) — not /1000 false positives. */
function isLegitimateSmallPack(name: string, value: number): boolean {
  if (value >= 25) return false;
  return /\b(\d{1,2})G\b|\b(\d{2,3})ML\b/i.test(name);
}

function falsePositiveRestore(
  name: string,
  value: number,
): number | null {
  if (value >= 100) return null;
  const restored = value * 1000;
  if (restored < 2000 || restored > 9000) return null;
  if (isLegitimateSmallPack(name, value)) return null;
  return restored;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const products = await prisma.product.findMany({
    where: { store: "Univerexport", price: { not: null } },
    select: { id: true, name: true, price: true },
  });

  let reverted = 0;
  for (const p of products) {
    const current = parseStoredPriceRsd(p.price);
    if (current == null) continue;

    const restored = falsePositiveRestore(p.name, current);
    if (restored == null) continue;

    console.log(`[${p.id}] ${p.name}: ${p.price} -> ${formatPriceRsd(restored)}`);

    if (!dryRun) {
      await prisma.product.update({
        where: { id: p.id },
        data: { price: formatPriceRsd(restored) },
      });
    }
    reverted++;
  }

  console.log(`\n${dryRun ? "Would revert" : "Reverted"} ${reverted} products.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
