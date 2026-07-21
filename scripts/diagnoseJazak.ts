import prisma from "../prismaClient";
import {
  buildStandardizedTokenIndex,
  candidateStandardizedIds,
  computeMatchScore,
  linkedStoreCount,
  MAX_STORE_LINKS_PER_STANDARD,
  scoreProductMatch,
  MIN_WEAK_MATCH_SCORE,
  MIN_MATCH_SCORE,
} from "../matchingUtils";
import { getProductMatches } from "../testMatching";

async function main() {
  const scrapedProducts = await prisma.product.findMany({
    where: {
      OR: [
        { name: { equals: "VODA GAZIRANA JAZAK 0,5L", mode: "insensitive" } },
        {
          AND: [
            { name: { contains: "JAZAK", mode: "insensitive" } },
            { name: { contains: "GAZIRANA", mode: "insensitive" } },
            { name: { contains: "0,5", mode: "insensitive" } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      store: true,
      category: true,
      standardizedProductId: true,
    },
    take: 10,
  });

  console.log("Scraped Jazak gazirana products:");
  for (const p of scrapedProducts) console.log(" ", p);

  const targetSp = await prisma.standardizedProduct.findFirst({
    where: {
      brand: { contains: "Jazak Voda", mode: "insensitive" },
      name: { contains: "Gazirana voda 500", mode: "insensitive" },
    },
    include: { products: { select: { id: true, store: true, name: true } } },
  });

  console.log("\nTarget SP:", targetSp
    ? {
        id: targetSp.id,
        brand: targetSp.brand,
        name: targetSp.name,
        volume: targetSp.volume,
        mainCategory: targetSp.mainCategory,
        stores: targetSp.products.map((p) => p.store),
        linked: targetSp.products.length,
        uniqueStores: linkedStoreCount(targetSp.products),
      }
    : "NOT FOUND");

  const p =
    scrapedProducts.find((x) => x.id === 43231) ??
    scrapedProducts.find((x) => x.name.toUpperCase().includes("GAZIRANA") && x.standardizedProductId == null) ??
    scrapedProducts[0];

  if (!p) {
    console.log("No scraped product found");
    return;
  }

  console.log("\nAnalyzing scraped:", p.name, `[${p.store}]`, p.standardizedProductId ? `ALREADY MATCHED id=${p.standardizedProductId}` : "unmatched");

  if (p.standardizedProductId) return;

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
  const tokenIndex = buildStandardizedTokenIndex(standards);

  if (targetSp) {
    const inPool = standards.some((s) => s.id === targetSp.id);
    const storeBlocked = targetSp.products.some((x) => x.store === p.store);
    console.log("\nTarget in pool:", inPool);
    console.log("Store already linked (blocked):", storeBlocked);

    const strict = scoreProductMatch({
      scrapedName: p.name,
      scrapedCategory: p.category,
      standardizedBrand: targetSp.brand,
      standardizedName: targetSp.name,
      standardizedVolume: targetSp.volume,
      standardizedMainCategory: targetSp.mainCategory,
    });
    const weak = computeMatchScore(
      {
        scrapedName: p.name,
        scrapedCategory: p.category,
        standardizedBrand: targetSp.brand,
        standardizedName: targetSp.name,
        standardizedVolume: targetSp.volume,
        standardizedMainCategory: targetSp.mainCategory,
      },
      { relaxed: true, minScore: MIN_WEAK_MATCH_SCORE },
    );
    const raw = computeMatchScore(
      {
        scrapedName: p.name,
        scrapedCategory: p.category,
        standardizedBrand: targetSp.brand,
        standardizedName: targetSp.name,
        standardizedVolume: targetSp.volume,
        standardizedMainCategory: targetSp.mainCategory,
      },
      { relaxed: true, minScore: 0 },
    );

    console.log("\nDirect scores vs target SP:");
    console.log("  strict (>=", MIN_MATCH_SCORE, "):", strict);
    console.log("  weak (>=", MIN_WEAK_MATCH_SCORE, "):", weak);
    console.log("  raw (no min):", raw);
  }

  const candidateIds = candidateStandardizedIds(
    p.name,
    tokenIndex,
    standards.map((s) => s.id),
  );
  const rank = targetSp ? candidateIds.indexOf(targetSp.id) : -1;
  console.log("\nTarget rank in candidates:", rank === -1 ? "NOT IN LIST" : rank, `/ ${candidateIds.length}`);

  const scored: Array<{ id: number; brand: string | null; name: string; final: number }> = [];
  for (const spId of candidateIds.slice(0, 30)) {
    const sp = standardsById.get(spId);
    if (!sp || sp.products.some((x) => x.store === p.store)) continue;
    const s = scoreProductMatch({
      scrapedName: p.name,
      scrapedCategory: p.category,
      standardizedBrand: sp.brand,
      standardizedName: sp.name,
      standardizedVolume: sp.volume,
      standardizedMainCategory: sp.mainCategory,
    });
    if (s) scored.push({ id: sp.id, brand: sp.brand, name: sp.name, final: s.finalScore });
  }
  scored.sort((a, b) => b.final - a.final);
  console.log("\nTop 10 strict matches from candidates:");
  for (const row of scored.slice(0, 10)) {
    console.log(`  [${row.id}] ${row.brand} ${row.name} = ${row.final.toFixed(3)}`);
  }

  const result = await getProductMatches({ store: p.store, limit: 15000 });
  const apiMatch = result.matches.find((m) => m.product.id === p.id);
  console.log("\nAPI result for this product:");
  console.log(
    apiMatch
      ? apiMatch.noSuggestion
        ? "  NO SUGGESTION"
        : `  ${apiMatch.standardizedProduct?.brand} ${apiMatch.standardizedProduct?.name} (${(apiMatch.finalScore * 100).toFixed(1)}%)${apiMatch.weakSuggestion ? " WEAK" : ""}`
      : "  NOT IN API RESPONSE AT ALL",
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
