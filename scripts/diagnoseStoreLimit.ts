import prisma from "../prismaClient";
import {
  MAX_STORE_LINKS_PER_STANDARD,
  linkedStoreCount,
  scoreProductMatch,
} from "../matchingUtils";
import { getProductMatches } from "../testMatching";

async function main() {
  console.log("MAX_STORE_LINKS_PER_STANDARD:", MAX_STORE_LINKS_PER_STANDARD);
  console.log("Include SP when unique stores <", MAX_STORE_LINKS_PER_STANDARD);

  const allStandards = await prisma.standardizedProduct.findMany({
    select: {
      id: true,
      brand: true,
      name: true,
      products: { select: { id: true, store: true, name: true } },
    },
  });

  const byCount = new Map<number, number>();
  const byStoreCount = new Map<number, number>();
  for (const sp of allStandards) {
    byCount.set(sp.products.length, (byCount.get(sp.products.length) ?? 0) + 1);
    const stores = linkedStoreCount(sp.products);
    byStoreCount.set(stores, (byStoreCount.get(stores) ?? 0) + 1);
  }
  console.log("\nSPs by linked product row count:");
  [...byCount.entries()].sort((a, b) => a[0] - b[0]).forEach(([n, c]) => {
    console.log(`  ${n} rows: ${c} SPs`);
  });
  console.log("\nSPs by unique store count (used for pool filter):");
  [...byStoreCount.entries()].sort((a, b) => a[0] - b[0]).forEach(([n, c]) => {
    const inPool = n < MAX_STORE_LINKS_PER_STANDARD;
    console.log(`  ${n} stores: ${c} SPs ${inPool ? "(in pool)" : "(EXCLUDED)"}`);
  });

  const sp451 = allStandards.find((s) => s.id === 451);
  if (sp451) {
    const stores = [...new Set(sp451.products.map((p) => p.store))];
    console.log("\nSP 451:", sp451.brand, sp451.name);
    console.log("  product rows:", sp451.products.length);
    console.log("  unique stores:", stores.join(", "));
    console.log("  in pool:", linkedStoreCount(sp451.products) < MAX_STORE_LINKS_PER_STANDARD);
    console.log("  linked:", sp451.products);
  }

  const excludedWith4Stores = allStandards.filter(
    (sp) => linkedStoreCount(sp.products) >= MAX_STORE_LINKS_PER_STANDARD,
  );
  console.log(`\nSPs with 4 stores (excluded): ${excludedWith4Stores.length}`);
  for (const sp of excludedWith4Stores.slice(0, 10)) {
    console.log(
      `  [${sp.id}] ${sp.brand} ${sp.name.slice(0, 50)} | rows=${sp.products.length} stores=${[...new Set(sp.products.map((p) => p.store))].join(", ")}`,
    );
  }

  const wronglyExcluded = allStandards.filter(
    (sp) =>
      sp.products.length >= MAX_STORE_LINKS_PER_STANDARD &&
      linkedStoreCount(sp.products) < MAX_STORE_LINKS_PER_STANDARD,
  );
  console.log(`\nSPs wrongly excluded by row count (fixed by store count): ${wronglyExcluded.length}`);

  const scraped = await prisma.product.findFirst({
    where: {
      store: "Univerexport",
      name: { contains: "KISELA PAVLAKA MOJA KRAVICA 20", mode: "insensitive" },
      standardizedProductId: null,
    },
  });

  if (scraped) {
    const result = await getProductMatches({ store: "Univerexport", limit: 5000 });
    const match = result.matches.find((m) => m.product.id === scraped.id);
    console.log("\nKisela pavlaka Univerexport best match:");
    console.log(
      match
        ? `  ${match.standardizedProduct.brand} ${match.standardizedProduct.name} (${(match.finalScore * 100).toFixed(1)}%)`
        : "  NO MATCH",
    );

    // Top 5 candidates for this product manually
    const pool = allStandards.filter(
      (sp) => linkedStoreCount(sp.products) < MAX_STORE_LINKS_PER_STANDARD,
    );
    const scored = pool
      .map((sp) => ({
        sp,
        score: scoreProductMatch({
          scrapedName: scraped.name,
          scrapedCategory: scraped.category,
          standardizedBrand: sp.brand,
          standardizedName: sp.name,
          standardizedVolume: null,
          standardizedMainCategory: null,
        }),
      }))
      .filter((x) => x.score)
      .sort((a, b) => b.score!.finalScore - a.score!.finalScore)
      .slice(0, 8);

    console.log("\nTop 8 manual scores (category not filtered):");
    for (const { sp, score } of scored) {
      console.log(
        `  [${sp.id}] ${sp.brand} ${sp.name} | ${score!.finalScore.toFixed(3)} | links=${sp.products.length}`,
      );
    }
  } else {
    console.log("\nKisela pavlaka Univerexport: not found or already matched");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
