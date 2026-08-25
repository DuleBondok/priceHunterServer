import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";
import {
  buildStandardizedTokenIndex,
  candidateStandardizedIds,
  computeMatchScore,
  linkedStoreCount,
  MAX_STORE_LINKS_PER_STANDARD,
  MIN_WEAK_MATCH_SCORE,
  rankStandardIdsByNameSimilarity,
  scoreProductMatch,
} from "./matchingUtils";

/** Hard cap for scripts. Admin HTTP uses MATCHES_ADMIN_DEFAULT_LIMIT. */
export const MATCHES_PAGE_LIMIT = 15000;
/** Rows returned to admin after ranking the larger scored pool. */
export const MATCHES_ADMIN_DEFAULT_LIMIT = 80;
/** Score this many unmatched rows, then keep the highest-scoring page. */
const MATCHES_ADMIN_SCORE_POOL = 250;
const MAX_MATCH_CANDIDATES = 120;

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
  products: { store: string }[];
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
  } else {
    return {
      standards: [],
      standardsById: new Map(),
      allStandardIds: [],
      tokenIndex: buildStandardizedTokenIndex([]),
    };
  }

  const allStandards = await prisma.standardizedProduct.findMany({
    where: spWhere,
    select: {
      id: true,
      name: true,
      brand: true,
      volume: true,
      mainCategory: true,
    },
  });

  // Occupancy is filled later for the unmatched page's stores only.
  // Loading every Product linked to the whole category OOMs Render (512MB).
  const standards: StandardForMatch[] = allStandards.map((sp) => ({
    ...sp,
    image: null,
    products: [],
  }));

  return {
    standards,
    standardsById: new Map(standards.map((sp) => [sp.id, sp])),
    allStandardIds: standards.map((sp) => sp.id),
    tokenIndex: buildStandardizedTokenIndex(standards),
  };
}

async function fillStoreOccupancyForPage(
  standardsById: Map<number, StandardForMatch>,
  unmatchedProducts: ScrapedMatchRow[],
): Promise<void> {
  const stores = [
    ...new Set(unmatchedProducts.map((p) => p.store).filter(Boolean)),
  ];
  if (!stores.length || standardsById.size === 0) return;

  const rows = await prisma.product.findMany({
    where: {
      store: { in: stores },
      standardizedProductId: { not: null },
    },
    select: { standardizedProductId: true, store: true },
  });

  for (const row of rows) {
    if (row.standardizedProductId == null) continue;
    const sp = standardsById.get(row.standardizedProductId);
    if (!sp) continue;
    if (!sp.products.some((p) => p.store === row.store)) {
      sp.products.push({ store: row.store });
    }
  }

  for (const [id, sp] of [...standardsById.entries()]) {
    if (linkedStoreCount(sp.products) >= MAX_STORE_LINKS_PER_STANDARD) {
      standardsById.delete(id);
    }
  }
}

function combinedStandardName(sp: StandardForMatch): string {
  return `${sp.brand ?? ""} ${sp.name} ${sp.volume ?? ""}`;
}

function pickCandidateIds(
  scrapedName: string,
  tokenIndex: ReturnType<typeof buildStandardizedTokenIndex>,
  allStandardIds: number[],
  standardsById: Map<number, StandardForMatch>,
): number[] {
  let ids = candidateStandardizedIds(scrapedName, tokenIndex, allStandardIds);
  const combinedNameById = (id: number) => {
    const sp = standardsById.get(id);
    return sp ? combinedStandardName(sp) : "";
  };

  if (ids.length > MAX_MATCH_CANDIDATES) {
    return rankStandardIdsByNameSimilarity(
      scrapedName,
      ids,
      combinedNameById,
    ).slice(0, MAX_MATCH_CANDIDATES);
  }

  if (ids.length < 12 && allStandardIds.length) {
    const extra = rankStandardIdsByNameSimilarity(
      scrapedName,
      allStandardIds,
      combinedNameById,
    ).slice(0, 40);
    ids = [...new Set([...ids, ...extra])];
  }

  if (ids.length > MAX_MATCH_CANDIDATES) {
    ids = rankStandardIdsByNameSimilarity(
      scrapedName,
      ids,
      combinedNameById,
    ).slice(0, MAX_MATCH_CANDIDATES);
  }
  return ids;
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

  for (const scraped of unmatchedProducts) {
    const candidateIds = pickCandidateIds(
      scraped.name,
      tokenIndex,
      allStandardIds,
      standardsById,
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
    }

    if (!bestSp) {
      for (const spId of candidateIds) {
        const sp = standardsById.get(spId);
        if (!sp) continue;
        if (sp.products.some((p) => p.store === scraped.store)) continue;

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
    }
  }

  matches.sort((a, b) => {
    if (a.noSuggestion !== b.noSuggestion) return a.noSuggestion ? 1 : -1;
    if (a.weakSuggestion !== b.weakSuggestion) return a.weakSuggestion ? 1 : -1;
    return b.finalScore - a.finalScore;
  });

  const strong = matches.filter((m) => !m.noSuggestion && !m.weakSuggestion);
  const weak = matches.filter((m) => m.weakSuggestion);
  const none = matches.filter((m) => m.noSuggestion);
  const ranked = [...strong, ...weak, ...none];
  const page = ranked.slice(0, limit);

  return {
    matches: page,
    eligible: unmatchedProducts.length,
    withSuggestion: page.filter((m) => !m.noSuggestion && !m.weakSuggestion).length,
    weakSuggestion: page.filter((m) => m.weakSuggestion).length,
    withoutSuggestion: page.filter((m) => m.noSuggestion).length,
    total: ranked.length,
    limit,
    truncated: ranked.length > page.length,
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

let matchCategoryMetaCache: { at: number; value: MatchCategoryMeta } | null = null;
const MATCH_CATEGORY_META_TTL_MS = 5 * 60_000;

export async function getMatchCategoryMeta(): Promise<MatchCategoryMeta> {
  if (
    matchCategoryMetaCache &&
    Date.now() - matchCategoryMetaCache.at < MATCH_CATEGORY_META_TTL_MS
  ) {
    return matchCategoryMetaCache.value;
  }

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

  const value = {
    ...metaFromRows(rows),
    maxStoreLinksPerStandard: MAX_STORE_LINKS_PER_STANDARD,
  };
  matchCategoryMetaCache = { at: Date.now(), value };
  return value;
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

async function matchScrapedRows(
  unmatchedProducts: ScrapedMatchRow[],
  filters: ProductMatchesFilters,
  limit: number,
  eligible: number,
  logLabel: string,
): Promise<ProductMatchesResult> {
  if (!unmatchedProducts.length) {
    return {
      matches: [],
      eligible,
      withSuggestion: 0,
      weakSuggestion: 0,
      withoutSuggestion: 0,
      total: eligible,
      limit,
      truncated: false,
    };
  }

  const { standardsById, tokenIndex } = await loadStandardsForMatching(
    filters.standardizedMainCategory,
  );
  const remainingIds = [...standardsById.keys()];

  console.log(
    `[${logLabel}] sp=${filters.standardizedMainCategory ?? ""} cat=${filters.productCategory ?? ""} store=${filters.store ?? ""} unmatched=${unmatchedProducts.length}/${eligible} standards=${remainingIds.length} rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
  );

  const result = buildMatchesForScrapedRows(
    unmatchedProducts,
    [...standardsById.values()],
    standardsById,
    remainingIds,
    tokenIndex,
    limit,
  );
  result.eligible = eligible;
  result.total = eligible;
  result.truncated = eligible > result.matches.length;
  await attachStandardImages(result.matches);
  return result;
}

function poolSizeForLimit(limit: number): number {
  return Math.min(
    Math.max(limit * 3, MATCHES_ADMIN_SCORE_POOL),
    400,
    MATCHES_PAGE_LIMIT,
  );
}

export async function getProductMatches(
  filters: ProductMatchesFilters = {},
): Promise<ProductMatchesResult> {
  const limit = Math.max(
    1,
    Math.min(
      filters.limit ?? MATCHES_ADMIN_DEFAULT_LIMIT,
      MATCHES_PAGE_LIMIT,
    ),
  );

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

  const eligible = await prisma.product.count({ where: productWhere });
  const unmatchedProducts = await prisma.product.findMany({
    where: productWhere,
    orderBy: { id: "asc" },
    take: poolSizeForLimit(limit),
    select: {
      id: true,
      name: true,
      category: true,
      store: true,
      image: true,
      price: true,
    },
  });

  return matchScrapedRows(
    unmatchedProducts,
    filters,
    limit,
    eligible,
    "matches",
  );
}

async function attachStandardImages(matches: ProductMatchRow[]): Promise<void> {
  const ids = [
    ...new Set(
      matches
        .map((m) => m.standardizedProduct?.id)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  if (!ids.length) return;
  const rows = await prisma.standardizedProduct.findMany({
    where: { id: { in: ids } },
    select: { id: true, image: true },
  });
  const imageById = new Map(rows.map((row) => [row.id, row.image ?? ""]));
  for (const match of matches) {
    if (match.standardizedProduct) {
      match.standardizedProduct.image =
        imageById.get(match.standardizedProduct.id) ?? "";
    }
  }
}

export async function getNewProductMatches(
  filters: ProductMatchesFilters = {},
): Promise<ProductMatchesResult> {
  const limit = Math.max(
    1,
    Math.min(
      filters.limit ?? MATCHES_ADMIN_DEFAULT_LIMIT,
      MATCHES_PAGE_LIMIT,
    ),
  );

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

  const eligible = await prisma.newProducts.count({ where: newProductWhere });
  const pendingNewProducts = await prisma.newProducts.findMany({
    where: newProductWhere,
    orderBy: { id: "asc" },
    take: poolSizeForLimit(limit),
    select: {
      id: true,
      name: true,
      category: true,
      store: true,
      image: true,
      price: true,
    },
  });

  return matchScrapedRows(
    pendingNewProducts,
    filters,
    limit,
    eligible,
    "new-product-matches",
  );
}
