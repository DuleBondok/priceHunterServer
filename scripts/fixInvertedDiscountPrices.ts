/**
 * Fix inverted price / priceBeforeDiscount pairs in Product.
 * Idea MPC loyalty: swap so price = club (lower), before = regular (higher).
 * Others: clear bogus priceBeforeDiscount when before <= price.
 *
 * Usage: npx ts-node --transpile-only scripts/fixInvertedDiscountPrices.ts
 *        npx ts-node --transpile-only scripts/fixInvertedDiscountPrices.ts --dry-run
 */
import prisma from "../prismaClient";
import {
  normalizeDiscountPair,
  parseDisplayPrice,
} from "../utils/normalizeDiscountPrice";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const rows = await prisma.product.findMany({
    where: {
      price: { not: null },
      priceBeforeDiscount: { not: null },
    },
    select: {
      id: true,
      name: true,
      store: true,
      price: true,
      priceBeforeDiscount: true,
      requiresLoyaltyCard: true,
    },
  });

  let swapped = 0;
  let cleared = 0;
  let untouched = 0;

  for (const row of rows) {
    const sale = parseDisplayPrice(row.price);
    const before =
      row.priceBeforeDiscount != null
        ? Number(row.priceBeforeDiscount)
        : null;
    if (sale == null || before == null || before > sale) {
      untouched++;
      continue;
    }

    const next = normalizeDiscountPair({
      price: row.price,
      priceBeforeDiscount: before,
      requiresLoyaltyCard: row.requiresLoyaltyCard,
    });

    const willSwap =
      before < sale &&
      next.priceBeforeDiscount != null &&
      next.price != null;
    const willClear =
      before === sale ||
      (next.priceBeforeDiscount == null && before !== sale);

    if (willSwap) swapped++;
    else if (willClear) cleared++;
    else {
      untouched++;
      continue;
    }

    console.log(
      `${willSwap ? "SWAP" : "CLEAR"} #${row.id} [${row.store}] ${row.name}\n` +
        `  was price=${row.price} before=${row.priceBeforeDiscount}\n` +
        `  now price=${next.price} before=${next.priceBeforeDiscount}`,
    );

    if (!dryRun) {
      await prisma.product.update({
        where: { id: row.id },
        data: {
          price: next.price,
          priceBeforeDiscount: next.priceBeforeDiscount,
        },
      });
    }
  }

  console.log(
    `\nDone. swapped=${swapped} cleared=${cleared} ok=${untouched}${dryRun ? " (dry-run)" : ""}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
