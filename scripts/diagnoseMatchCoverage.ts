import prisma from "../prismaClient";
import {
  buildStandardizedTokenIndex,
  candidateStandardizedIds,
  linkedStoreCount,
  MAX_STORE_LINKS_PER_STANDARD,
  scoreProductMatch,
} from "../matchingUtils";
import { getProductMatches, MATCHES_PAGE_LIMIT } from "../testMatching";

async function main() {
  const storeFilter = process.argv[2] ?? "Univerexport";

  const [totalProducts, alreadyMatched, badCategory, unmatchedAll] =
    await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { standardizedProductId: { not: null } } }),
      prisma.product.count({ where: { category: ">" } }),
      prisma.product.count({
        where: { standardizedProductId: null, category: { not: ">" } },
      }),
    ]);

  const unmatchedStore = await prisma.product.count({
    where: {
      standardizedProductId: null,
      category: { not: ">" },
      store: storeFilter,
    },
  });

  console.log("=== Product table coverage ===");
  console.log(`Total products:              ${totalProducts}`);
  console.log(`Already matched (linked):    ${alreadyMatched}`);
  console.log(`Bad category '>':            ${badCategory}`);
  console.log(`Unmatched (eligible):        ${unmatchedAll}`);
  console.log(`Unmatched [${storeFilter}]:       ${unmatchedStore}`);

  const allStandards = await prisma.standardizedProduct.findMany({
    select: {
      id: true,
      name: true,
      brand: true,
      volume: true,
      mainCategory: true,
      products: { select: { id: true, store: true } },
    },
  });
  const standards = allStandards.filter(
    (sp) => linkedStoreCount(sp.products) < MAX_STORE_LINKS_PER_STANDARD,
  );
  const standardsById = new Map(standards.map((sp) => [sp.id, sp]));
  const allStandardIds = standards.map((sp) => sp.id);
  const tokenIndex = buildStandardizedTokenIndex(standards);

  const products = await prisma.product.findMany({
    where: {
      standardizedProductId: null,
      category: { not: ">" },
      store: storeFilter,
    },
    select: { id: true, name: true, category: true, store: true },
  });

  let withMatch = 0;
  let noMatch = 0;
  const noMatchReasons = {
    noCandidatesPassScore: 0,
    allCandidatesStoreBlocked: 0,
    categoryMismatchOnly: 0,
    belowThresholdOnly: 0,
  };
  const noMatchSamples: string[] = [];

  for (const scraped of products) {
    const candidateIds = candidateStandardizedIds(
      scraped.name,
      tokenIndex,
      allStandardIds,
    );

    let bestScore: number | null = null;
    let bestCategoryFail = false;
    let bestBelowThreshold = false;
    let anyScored = false;
    let allBlockedByStore = candidateIds.length > 0;

    for (const spId of candidateIds) {
      const sp = standardsById.get(spId);
      if (!sp) continue;
      if (sp.products.some((p) => p.store === scraped.store)) continue;
      allBlockedByStore = false;

      const scored = scoreProductMatch({
        scrapedName: scraped.name,
        scrapedCategory: scraped.category,
        standardizedBrand: sp.brand,
        standardizedName: sp.name,
        standardizedVolume: sp.volume,
        standardizedMainCategory: sp.mainCategory,
      });

      if (!scored) {
        const catOnly = scoreProductMatch({
          scrapedName: scraped.name,
          scrapedCategory: scraped.category,
          standardizedBrand: sp.brand,
          standardizedName: sp.name,
          standardizedVolume: sp.volume,
          standardizedMainCategory: sp.mainCategory,
        });
        void catOnly;
        continue;
      }

      anyScored = true;
      if (bestScore === null || scored.finalScore > bestScore) {
        bestScore = scored.finalScore;
      }
    }

    // Re-check why no match with relaxed scoring
    if (bestScore === null) {
      noMatch++;
      let hadCategoryIssue = false;
      let hadLowScore = false;

      for (const spId of candidateIds.slice(0, 200)) {
        const sp = standardsById.get(spId);
        if (!sp || sp.products.some((p) => p.store === scraped.store)) continue;

        const normalizedScraped = scraped.name.toLowerCase();
        const combined = `${sp.brand ?? ""} ${sp.name}`.toLowerCase();
        if (combined.length < 2) continue;

        // inline check category
        const { categoryAlignmentScore } = await import("../matchingUtils");
        const cat = categoryAlignmentScore(scraped.category, sp.mainCategory);
        if (cat === 0) hadCategoryIssue = true;

        const scored = scoreProductMatch({
          scrapedName: scraped.name,
          scrapedCategory: scraped.category,
          standardizedBrand: sp.brand,
          standardizedName: sp.name,
          standardizedVolume: sp.volume,
          standardizedMainCategory: sp.mainCategory,
        });
        if (!scored && cat > 0) hadLowScore = true;
      }

      if (allBlockedByStore && candidateIds.length > 0) {
        noMatchReasons.allCandidatesStoreBlocked++;
      } else if (hadCategoryIssue && !hadLowScore) {
        noMatchReasons.categoryMismatchOnly++;
      } else if (hadLowScore) {
        noMatchReasons.belowThresholdOnly++;
      } else {
        noMatchReasons.noCandidatesPassScore++;
      }

      if (noMatchSamples.length < 15) {
        noMatchSamples.push(`${scraped.name} (${scraped.category})`);
      }
    } else {
      withMatch++;
    }
  }

  console.log(`\n=== Per-product match results [${storeFilter}] ===`);
  console.log(`Products processed:          ${products.length}`);
  console.log(`Got a recommendation:      ${withMatch}`);
  console.log(`No recommendation:           ${noMatch}`);
  console.log(`Coverage:                    ${((withMatch / products.length) * 100).toFixed(1)}%`);

  console.log("\nNo-match reason breakdown (approx):");
  console.log(`  Score below threshold:     ${noMatchReasons.belowThresholdOnly}`);
  console.log(`  Category mismatch:       ${noMatchReasons.categoryMismatchOnly}`);
  console.log(`  All candidates blocked:  ${noMatchReasons.allCandidatesStoreBlocked}`);
  console.log(`  Other / no tokens:       ${noMatchReasons.noCandidatesPassScore}`);

  console.log("\nSample products with NO recommendation:");
  for (const s of noMatchSamples) console.log(`  - ${s}`);

  const result = await getProductMatches({ store: storeFilter });
  console.log(`\n=== API response [${storeFilter}] ===`);
  console.log(`Eligible (all unmatched):  ${result.eligible}`);
  console.log(`Confident suggestions:     ${result.withSuggestion}`);
  console.log(`Weak suggestions:          ${result.weakSuggestion}`);
  console.log(`No suggestion:             ${result.withoutSuggestion}`);
  console.log(`Total rows:                ${result.total}`);
  console.log(`Returned (limit ${result.limit}):   ${result.matches.length}`);
  console.log(`Truncated:                   ${result.truncated}`);
  console.log(
    `Coverage (rows/eligible):    ${((result.total / result.eligible) * 100).toFixed(1)}%`,
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
