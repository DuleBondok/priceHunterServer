/**
 * Fix Univerexport prices wrongly stored as 1000× (e.g. 36322.00 instead of 36.32).
 * Caused by dot-as-decimal API format ("36.322") parsed as thousands separator.
 *
 * Run: npx ts-node scripts/fixUniverexportPrices.ts
 * Dry: npx ts-node scripts/fixUniverexportPrices.ts --dry-run
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

function looksInflated(priceStr: string, value: number): boolean {
  if (value <= 1000) return false;
  // Bug produced round values like "36322.00 RSD" (lost decimal dot in API "36.322")
  if (value > 5000 && /\.00 RSD$/i.test(priceStr.trim())) return true;
  return false;
}

function correctedPrice(priceStr: string, value: number): number | null {
  if (!looksInflated(priceStr, value)) return null;
  const fixed = value / 1000;
  if (fixed >= 0.5 && fixed <= 5000) return fixed;
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const products = await prisma.product.findMany({
    where: { store: "Univerexport", price: { not: null } },
    select: {
      id: true,
      name: true,
      price: true,
      priceBeforeDiscount: true,
    },
  });

  let fixed = 0;
  for (const p of products) {
    const current = parseStoredPriceRsd(p.price);
    if (current == null) continue;

    const next = correctedPrice(p.price!, current);
    if (next == null) continue;

    let nextBefore: number | null = p.priceBeforeDiscount != null
      ? Number(p.priceBeforeDiscount)
      : null;
    if (nextBefore != null && nextBefore > 5000) {
      const fixedBefore = correctedPrice(String(p.priceBeforeDiscount), nextBefore);
      if (fixedBefore != null) nextBefore = fixedBefore;
    }

    console.log(
      `[${p.id}] ${p.name}\n  ${p.price} -> ${formatPriceRsd(next)}${
        nextBefore !== (p.priceBeforeDiscount != null ? Number(p.priceBeforeDiscount) : null)
          ? ` | before: ${p.priceBeforeDiscount} -> ${nextBefore}`
          : ""
      }`,
    );

    if (!dryRun) {
      await prisma.product.update({
        where: { id: p.id },
        data: {
          price: formatPriceRsd(next),
          priceBeforeDiscount: nextBefore,
        },
      });
    }
    fixed++;
  }

  console.log(`\n${dryRun ? "Would fix" : "Fixed"} ${fixed} products.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
