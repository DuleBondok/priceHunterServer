import { promotePendingNewProductsForStore } from "../productService";

const store = process.argv[2]?.trim();
if (!store) {
  console.error("Usage: npx ts-node scripts/promoteNewProductsForStore.ts <StoreName>");
  process.exit(1);
}

promotePendingNewProductsForStore(store)
  .then((result) => {
    const totalInDb = result.promoted + result.skippedExisting;
    console.log(
      `[${store}] Pending: ${result.pending}, promoted to Product: ${result.promoted}, skipped (already in Product): ${result.skippedExisting}`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error(`[${store}] Promotion failed:`, err);
    process.exit(1);
  });
