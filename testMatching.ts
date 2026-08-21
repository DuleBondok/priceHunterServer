import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";
import {
  buildStandardizedTokenIndex,
  candidateStandardizedIds,
  computeMatchScore,
  linkedStoreCount,
  MAX_STORE_LINKS_PER_STANDARD,
  MIN_WEAK_MATCH_SCORE,
  scoreProductMatch,
} from "./matchingUtils";

/** Max rows returned per request (one row per eligible unmatched product when under cap). */
export const MATCHES_PAGE_LIMIT = 15000;

export type ProductMatchesFilters = {
  standardizedMainCategory?: string;
  productCategory?: string;
  store?: string;
  limit?: number;
};

export type ProductMatchRow = {
  product: {
    id: number;
    name: string;
    category: string;
    store: string;
    image: string;
    price: string | null;
  };
  standardizedProduct: {
    id: number;
    name: string;
    brand: string | null;
    volume: string | null;
    image: string;
    mainCategory: string | null;
  } | null;
  similarity: number;
  fuzzyScore: number;
  volumeScore: number;
  brandMatch: number;
  categoryScore: number;
  finalScore: number;
  lowConfidence: boolean;
  /** Best-effort match below normal confidence threshold. */
  weakSuggestion?: boolean;
  /** No standardized product candidate met even the weak threshold. */
  noSuggestion?: boolean;
};

export type ProductMatchesResult = {
  matches: ProductMatchRow[];
  /** Unmatched products considered (same as product filter). */
  eligible: number;
  /** Rows with a normal suggestion (finalScore >= MIN_MATCH_SCORE). */
  withSuggestion: number;
  /** Rows with only a weak best-effort suggestion. */
  weakSuggestion: number;
  /** Rows with no suggestion at all. */
  withoutSuggestion: number;
  total: number;
  limit: number;
  truncated: boolean;
};

export type MatchCategoryMeta = {
  standardizedMainCategories: string[];
  productCategories: string[];
  stores: string[];
  maxStoreLinksPerStandard: number;
};

type ScrapedMatchRow = ProductMatchRow["product"];

type StandardForMatch = {
  id: number;
  name: string;
  brand: string | null;
  volume: string | null;
  image: string | null;
  mainCategory: string | null;
  products: { id: number; store: string }[];
};

function distinctSorted(values: string[]): string[] {
  return [...new Set(values.filter((v) => v && String(v).trim() !== ""))].sort(
    (a, b) => a.localeCompare(b),
  );
}

async function loadStandardsForMatching(
  standardizedMainCategory?: string,
): Promise<{
  standards: StandardForMatch[];
  standardsById: Map<number, StandardForMatch>;
  allStandardIds: number[];
  tokenIndex: ReturnType<typeof buildStandardizedTokenIndex>;
}> {
  const spWhere: Prisma.StandardizedProductWhereInput = {};
  if (standardizedMainCategory?.trim()) {
    spWhere.mainCategory = {
      equals: standardizedMainCategory.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const allStandards = await prisma.standardizedProduct.findMany({
    where: spWhere,
    select: {
      id: true,
      name: true,
      brand: true,
      volume: true,
      image: true,
      mainCategory: true,
      products: { select: { id: true, store: true } },
    },
  });

  const standards = allStandards.filter(
    (sp) => linkedStoreCount(sp.products) < MAX_STORE_LINKS_PER_STANDARD,
  );

  return {
    standards,
    standardsById: new Map(standards.map((sp) => [sp.id, sp])),
    allStandardIds: standards.map((sp) => sp.id),
    tokenIndex: buildStandardizedTokenIndex(standards),
  };
}

function buildMatchesForScrapedRows(
  unmatchedProducts: ScrapedMatchRow[],
  standards: StandardForMatch[],
  standardsById: Map<number, StandardForMatch>,
  allStandardIds: number[],
  tokenIndex: ReturnType<typeof buildStandardizedTokenIndex>,
  limit: number,
): ProductMatchesResult {
  const matches: ProductMatchRow[] = [];
  let withSuggestion = 0;
  let weakSuggestionCount = 0;
  let withoutSuggestion = 0;

  for (const scraped of unmatchedProducts) {
    const candidateIds = candidateStandardizedIds(
      scraped.name,
      tokenIndex,
      allStandardIds,
    );

    let bestSp: StandardForMatch | null = null;
    let bestScored: NonNullable<ReturnType<typeof scoreProductMatch>> | null =
      null;
    let weakSp: StandardForMatch | null = null;
    let weakScored: NonNullable<ReturnType<typeof scoreProductMatch>> | null =
      null;

    for (const spId of candidateIds) {
      const sp = standardsById.get(spId);
      if (!sp) continue;
      if (sp.products.some((p) => p.store === scraped.store)) continue;

      const scored = scoreProductMatch({
        scrapedName: scraped.name,
        scrapedCategory: scraped.category,
        standardizedBrand: sp.brand,
        standardizedName: sp.name,
        standardizedVolume: sp.volume,
        standardizedMainCategory: sp.mainCategory,
      });

      if (
        scored &&
        (!bestScored || scored.finalScore > bestScored.finalScore)
      ) {
        bestSp = sp;
        bestScored = scored;
      }

      const weak = computeMatchScore(
        {
          scrapedName: scraped.name,
          scrapedCategory: scraped.category,
          standardizedBrand: sp.brand,
          standardizedName: sp.name,
          standardizedVolume: sp.volume,
          standardizedMainCategory: sp.mainCategory,
        },
        { relaxed: true, minScore: MIN_WEAK_MATCH_SCORE },
      );

      if (weak && (!weakScored || weak.finalScore > weakScored.finalScore)) {
        weakSp = sp;
        weakScored = weak;
      }
    }

    if (bestSp && bestScored) {
      matches.push({
        product: scraped,
        standardizedProduct: {
          id: bestSp.id,
          name: bestSp.name,
          brand: bestSp.brand,
          volume: bestSp.volume,
          image: bestSp.image ?? "",
          mainCategory: bestSp.mainCategory,
        },
        similarity: bestScored.similarity,
        fuzzyScore: bestScored.fuzzyScore,
        volumeScore: bestScored.volumeScore,
        brandMatch: bestScored.brandMatch,
        categoryScore: bestScored.categoryScore,
        finalScore: bestScored.finalScore,
        lowConfidence: bestScored.finalScore < 0.62,
      });
      withSuggestion++;
    } else if (weakSp && weakScored) {
      matches.push({
        product: scraped,
        standardizedProduct: {
          id: weakSp.id,
          name: weakSp.name,
          brand: weakSp.brand,
          volume: weakSp.volume,
          image: weakSp.image ?? "",
          mainCategory: weakSp.mainCategory,
        },
        similarity: weakScored.similarity,
        fuzzyScore: weakScored.fuzzyScore,
        volumeScore: weakScored.volumeScore,
        brandMatch: weakScored.brandMatch,
        categoryScore: weakScored.categoryScore,
        finalScore: weakScored.finalScore,
        lowConfidence: true,
        weakSuggestion: true,
      });
      weakSuggestionCount++;
    } else {
      matches.push({
        product: scraped,
        standardizedProduct: null,
        similarity: 0,
        fuzzyScore: 0,
        volumeScore: 0,
        brandMatch: 0,
        categoryScore: 0,
        finalScore: 0,
        lowConfidence: true,
        noSuggestion: true,
      });
      withoutSuggestion++;
    }
  }

  matches.sort((a, b) => {
    if (a.noSuggestion !== b.noSuggestion) return a.noSuggestion ? 1 : -1;
    if (a.weakSuggestion !== b.weakSuggestion) return a.weakSuggestion ? 1 : -1;
    return b.finalScore - a.finalScore;
  });

  const eligible = unmatchedProducts.length;
  const total = matches.length;
  const truncated = total > limit;

  return {
    matches: truncated ? matches.slice(0, limit) : matches,
    eligible,
    withSuggestion,
    weakSuggestion: weakSuggestionCount,
    withoutSuggestion,
    total,
    limit,
    truncated,
  };
}

type MetaKindRow = { kind: string; value: string | null };

function metaFromRows(rows: MetaKindRow[]): Omit<MatchCategoryMeta, "maxStoreLinksPerStandard"> {
  const standardizedMainCategories: string[] = [];
  const productCategories: string[] = [];
  const stores: string[] = [];

  for (const row of rows) {
    const value = row.value?.trim();
    if (!value) continue;
    if (row.kind === "sp_main") standardizedMainCategories.push(value);
    else if (row.kind === "cat" && value !== ">") productCategories.push(value);
    else if (row.kind === "store") stores.push(value);
  }

  return {
    standardizedMainCategories: distinctSorted(standardizedMainCategories),
    productCategories: distinctSorted(productCategories),
    stores: distinctSorted(stores),
  };
}

export async function getMatchCategoryMeta(): Promise<MatchCategoryMeta> {
  // SELECT DISTINCT — without it we materialize every Product row in Node (~OOM on Render 512MB).
  const rows = await prisma.$queryRaw<MetaKindRow[]>`
    SELECT DISTINCT 'sp_main'::text AS kind, "mainCategory"::text AS value
    FROM "StandardizedProduct"
    WHERE "mainCategory" IS NOT NULL AND TRIM("mainCategory") <> ''
    UNION ALL
    SELECT DISTINCT 'cat'::text, category::text
    FROM "Product"
    WHERE category IS NOT NULL AND TRIM(category) <> '' AND category <> '>'
    UNION ALL
    SELECT DISTINCT 'store'::text, store::text
    FROM "Product"
    WHERE store IS NOT NULL AND TRIM(store) <> ''
  `;

  return {
    ...metaFromRows(rows),
    maxStoreLinksPerStandard: MAX_STORE_LINKS_PER_STANDARD,
  };
}

export async function getNewProductMatchCategoryMeta(): Promise<MatchCategoryMeta> {
  const rows = await prisma.$queryRaw<MetaKindRow[]>`
    SELECT DISTINCT 'sp_main'::text AS kind, "mainCategory"::text AS value
    FROM "StandardizedProduct"
    WHERE "mainCategory" IS NOT NULL AND TRIM("mainCategory") <> ''
    UNION ALL
    SELECT DISTINCT 'cat'::text, category::text
    FROM "NewProducts"
    WHERE "processedAt" IS NULL AND category IS NOT NULL AND TRIM(category) <> '' AND category <> '>'
    UNION ALL
    SELECT DISTINCT 'store'::text, store::text
    FROM "NewProducts"
    WHERE "processedAt" IS NULL AND store IS NOT NULL AND TRIM(store) <> ''
  `;

  return {
    ...metaFromRows(rows),
    maxStoreLinksPerStandard: MAX_STORE_LINKS_PER_STANDARD,
  };
}

export async function getProductMatches(
  filters: ProductMatchesFilters = {},
): Promise<ProductMatchesResult> {
  const limit = Math.max(
    1,
    Math.min(filters.limit ?? MATCHES_PAGE_LIMIT, MATCHES_PAGE_LIMIT),
  );

  const { standards, standardsById, allStandardIds, tokenIndex } =
    await loadStandardsForMatching(filters.standardizedMainCategory);

  const productWhere: Prisma.ProductWhereInput = {
    standardizedProductId: null,
    category: { not: ">" },
  };
  if (filters.productCategory?.trim()) {
    productWhere.category = {
      equals: filters.productCategory.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }
  if (filters.store?.trim()) {
    productWhere.store = {
      equals: filters.store.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const unmatchedProducts = await prisma.product.findMany({
    where: productWhere,
    select: {
      id: true,
      name: true,
      category: true,
      store: true,
      image: true,
      price: true,
    },
  });

  return buildMatchesForScrapedRows(
    unmatchedProducts,
    standards,
    standardsById,
    allStandardIds,
    tokenIndex,
    limit,
  );
}

export async function getNewProductMatches(
  filters: ProductMatchesFilters = {},
): Promise<ProductMatchesResult> {
  const limit = Math.max(
    1,
    Math.min(filters.limit ?? MATCHES_PAGE_LIMIT, MATCHES_PAGE_LIMIT),
  );

  const { standards, standardsById, allStandardIds, tokenIndex } =
    await loadStandardsForMatching(filters.standardizedMainCategory);

  const newProductWhere: Prisma.NewProductsWhereInput = {
    processedAt: null,
    category: { not: ">" },
  };
  if (filters.productCategory?.trim()) {
    newProductWhere.category = {
      equals: filters.productCategory.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }
  if (filters.store?.trim()) {
    newProductWhere.store = {
      equals: filters.store.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const pendingNewProducts = await prisma.newProducts.findMany({
    where: newProductWhere,
    select: {
      id: true,
      name: true,
      category: true,
      store: true,
      image: true,
      price: true,
    },
  });

  return buildMatchesForScrapedRows(
    pendingNewProducts,
    standards,
    standardsById,
    allStandardIds,
    tokenIndex,
    limit,
  );
}
