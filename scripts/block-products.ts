import "dotenv/config";
import { blockListings, searchProductsByName } from "../blockedProduct";
import prisma from "../prismaClient";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function parseIdArg(flag: string): number[] {
  const raw = argValue(flag);
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
}

function printUsage(): void {
  console.log(`Usage:
  npx ts-node scripts/block-products.ts --product-ids 12,34 --reason "no image"
  npx ts-node scripts/block-products.ts --search "gauda" --dry-run
  npx ts-node scripts/block-products.ts --search "gauda" --apply --reason "blocked"
`);
}

async function main() {
  const productIds = parseIdArg("--product-ids");
  const newProductIds = parseIdArg("--new-product-ids");
  const search = argValue("--search");
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || (Boolean(search) && !apply);
  const reason = argValue("--reason") || "blocked";

  if (!search && !productIds.length && !newProductIds.length) {
    printUsage();
    process.exit(1);
  }

  if (search) {
    const result = await searchProductsByName({ q: search, take: 100 });
    console.log(`Product matches: ${result.total} (showing ${result.products.length})`);
    for (const row of result.products) {
      console.log(`  [#${row.id}] ${row.store} · ${row.name}`);
    }
    if (dryRun) {
      console.log("Dry run only. Re-run with --apply to block these results.");
      return;
    }
    const blocked = await blockListings({
      productIds: result.products.map((row) => row.id),
      reason,
    });
    console.log(blocked);
    if (result.total > result.products.length) {
      console.log("More matches remain. Narrow --search or run again.");
    }
    return;
  }

  console.log(await blockListings({ productIds, newProductIds, reason }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
