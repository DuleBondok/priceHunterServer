import "dotenv/config";
import { blockListings, listEmptyImageCandidates } from "../blockedProduct";
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
  npx ts-node scripts/block-products.ts --new-product-ids 56,78
  npx ts-node scripts/block-products.ts --empty-image --dry-run
  npx ts-node scripts/block-products.ts --empty-image --store Idea --apply --reason "empty image"

--empty-image lists Product + NewProducts with no usable image.
--dry-run (default for --empty-image) only prints candidates.
--apply actually blocks and deletes them.
`);
}

async function main() {
  const productIds = parseIdArg("--product-ids");
  const newProductIds = parseIdArg("--new-product-ids");
  const emptyImage = process.argv.includes("--empty-image");
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || (emptyImage && !apply);
  const reason = argValue("--reason") || (emptyImage ? "empty image" : "blocked");
  const store = argValue("--store");
  const category = argValue("--category");

  if (!emptyImage && !productIds.length && !newProductIds.length) {
    printUsage();
    process.exit(1);
  }

  if (emptyImage) {
    const candidates = await listEmptyImageCandidates({
      store,
      category,
      take: 200,
    });
    console.log(
      `Empty-image Product: ${candidates.productTotal} (showing ${candidates.products.length})`,
    );
    console.log(
      `Empty-image NewProducts: ${candidates.newProductTotal} (showing ${candidates.newProducts.length})`,
    );
    for (const row of [...candidates.products, ...candidates.newProducts]) {
      console.log(
        `  [${row.source} #${row.id}] ${row.store} · ${row.category} · ${row.name}`,
      );
    }

    if (dryRun) {
      console.log("Dry run only. Re-run with --apply to block and delete.");
      return;
    }

    const result = await blockListings({
      productIds: candidates.products.map((row) => row.id),
      newProductIds: candidates.newProducts.map((row) => row.id),
      reason,
    });
    console.log(result);
    if (
      candidates.productTotal > candidates.products.length ||
      candidates.newProductTotal > candidates.newProducts.length
    ) {
      console.log("More candidates remain. Run again to continue.");
    }
    return;
  }

  const result = await blockListings({ productIds, newProductIds, reason });
  console.log(result);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
