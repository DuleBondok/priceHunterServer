import { compareTwoStrings } from "string-similarity";

/** Product.category (English scraper labels) → StandardizedProduct.mainCategory (Cenoteka). */
export const SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN: Record<string, string[]> = {
  Groceries: ["Namirnice", "Namirnice "],
  Drinks: ["Bezalkoholna pića"],
  Alcohol: ["Alkoholna pića"],
  "Milk and egg products": ["Mlečni proizvodi i jaja"],
  Bakery: ["Pekara, torte i kolači"],
  "Frozen products": ["Smrznuti proizvodi"],
  "Fruits & Vegetables": ["Voće i povrće"],
  "Healthy Food": ["Zdrava hrana"],
  "Sweets and Snacks": ["Slatkiši i grickalice"],
  "Meat & Fish": ["Meso i riba"],
  "Personal Care": ["Licna higijena"],
  "Home Care": ["Kućna hemija"],
  "Baby Care": ["Kutak za bebe"],
  "Pet Care": ["Kućni ljubimci"],
};

const STOP_TOKENS = new Set([
  "i",
  "sa",
  "od",
  "za",
  "u",
  "na",
  "po",
  "do",
  "bez",
  "plus",
  "extra",
  "new",
  "novo",
  "pak",
  "kom",
  "the",
  "and",
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "dj")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

export function significantTokens(text: string): string[] {
  return tokenize(text).filter(
    (t) => t.length >= 3 && !STOP_TOKENS.has(t) && !/^\d+$/.test(t),
  );
}

export function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (!tokensA.size || !tokensB.size) return 0;
  const intersection = [...tokensA].filter((x) => tokensB.has(x)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

export function extractVolumesNormalized(text: string): number[] {
  const regex = /(\d+[.,]?\d*)\s*(l|ml|kg|g|lit|cl)\b/gi;
  const matches = [...text.matchAll(regex)];
  const results: number[] = [];

  for (const m of matches) {
    let amount = parseFloat(m[1].replace(",", "."));
    const unit = m[2].toLowerCase();
    if (Number.isNaN(amount)) continue;
    if (unit === "ml" || unit === "cl") results.push(amount / 1000);
    else if (unit === "l" || unit === "lit") results.push(amount);
    else if (unit === "g") results.push(amount / 1000);
    else if (unit === "kg") results.push(amount);
  }

  return results;
}

export function getBestVolumeScore(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0.5;
  let bestDiff = Infinity;
  for (const v1 of a) {
    for (const v2 of b) {
      const diff = Math.abs(v1 - v2);
      if (diff < bestDiff) bestDiff = diff;
    }
  }
  return Math.exp(-bestDiff * 3);
}

export function categoryAlignmentScore(
  productCategory: string | null | undefined,
  standardizedMainCategory: string | null | undefined,
): number {
  const scraped = String(productCategory ?? "").trim();
  const main = String(standardizedMainCategory ?? "").trim();
  if (!scraped || !main || scraped === ">") return 0.5;
  const allowed = SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN[scraped];
  if (!allowed) return 0.5;
  const normMain = normalizeText(main);
  return allowed.some((a) => normalizeText(a) === normMain) ? 1 : 0;
}

/** Max distinct store listings linked to one standardized product. */
export const MAX_STORE_LINKS_PER_STANDARD = 4;

export function linkedStoreCount(products: Array<{ store: string }>): number {
  return new Set(products.map((p) => p.store)).size;
}

/** Minimum score to count as a confident suggestion. */
export const MIN_MATCH_SCORE = 0.48;

/** Minimum score for a weak / best-effort suggestion when nothing passes MIN_MATCH_SCORE. */
export const MIN_WEAK_MATCH_SCORE = 0.32;

export function brandMatchScore(
  scrapedName: string,
  brand: string | null | undefined,
): number {
  const normalizedScraped = normalizeText(scrapedName);
  const normalizedBrand = brand ? normalizeText(brand) : "";
  if (normalizedBrand.length < 3) return 0;
  if (normalizedScraped.includes(normalizedBrand)) return 1;

  const brandTokens = significantTokens(brand ?? "");
  if (!brandTokens.length) return 0;
  return brandTokens.every((token) => normalizedScraped.includes(token)) ? 1 : 0;
}

export type MatchScoreInput = {
  scrapedName: string;
  scrapedCategory?: string | null;
  standardizedBrand?: string | null;
  standardizedName: string;
  standardizedVolume?: string | null;
  standardizedMainCategory?: string | null;
};

export type MatchScoreResult = {
  similarity: number;
  fuzzyScore: number;
  volumeScore: number;
  brandMatch: number;
  categoryScore: number;
  finalScore: number;
};

export type MatchScoreOptions = {
  /** Skip token-overlap pre-filters (for best-effort fallback). */
  relaxed?: boolean;
  /** Return null when finalScore is below this (default MIN_MATCH_SCORE). */
  minScore?: number;
};

export function computeMatchScore(
  input: MatchScoreInput,
  options: MatchScoreOptions = {},
): MatchScoreResult | null {
  const minScore = options.minScore ?? MIN_MATCH_SCORE;
  const relaxed = options.relaxed ?? false;

  const normalizedScraped = normalizeText(input.scrapedName);
  const normalizedSpName = normalizeText(input.standardizedName);
  const normalizedCombined = normalizeText(
    `${input.standardizedBrand ?? ""} ${input.standardizedName}`,
  );

  if (!relaxed) {
    const sigScraped = significantTokens(input.scrapedName);
    const sigCombined = significantTokens(normalizedCombined);
    const sigOverlap = sigScraped.filter((t) => sigCombined.includes(t));

    if (!sigOverlap.length) {
      const fuzzyOnly = compareTwoStrings(normalizedScraped, normalizedCombined);
      if (fuzzyOnly < 0.72) return null;
    } else if (sigScraped.length >= 2 && sigOverlap.length < 2) {
      const fuzzyCheck = compareTwoStrings(normalizedScraped, normalizedCombined);
      if (fuzzyCheck < 0.6) return null;
    }
  }

  const tokenSimCombined = tokenSimilarity(normalizedScraped, normalizedCombined);
  const tokenSimNameOnly = tokenSimilarity(normalizedScraped, normalizedSpName);
  const similarity = Math.max(tokenSimCombined, tokenSimNameOnly);

  const fuzzyCombined = compareTwoStrings(normalizedScraped, normalizedCombined);
  const fuzzyNameOnly = compareTwoStrings(normalizedScraped, normalizedSpName);
  const fuzzyScore = Math.max(fuzzyCombined, fuzzyNameOnly);

  const scrapedVolumes = extractVolumesNormalized(input.scrapedName);
  const spVolumes = extractVolumesNormalized(input.standardizedVolume ?? "");
  const volumeScore = getBestVolumeScore(scrapedVolumes, spVolumes);

  const brandMatch = brandMatchScore(input.scrapedName, input.standardizedBrand);

  const categoryScore = categoryAlignmentScore(
    input.scrapedCategory,
    input.standardizedMainCategory,
  );

  if (categoryScore === 0) {
    return null;
  }

  const finalScore =
    Math.max(similarity, fuzzyScore * 0.95) * 0.5 +
    fuzzyScore * 0.15 +
    volumeScore * 0.15 +
    brandMatch * 0.1 +
    categoryScore * 0.1;

  if (finalScore < minScore) return null;

  return {
    similarity,
    fuzzyScore,
    volumeScore,
    brandMatch,
    categoryScore,
    finalScore,
  };
}

export function scoreProductMatch(input: MatchScoreInput): MatchScoreResult | null {
  return computeMatchScore(input);
}

export function buildStandardizedTokenIndex(
  standards: Array<{ id: number; brand: string | null; name: string }>,
): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const sp of standards) {
    const tokens = significantTokens(`${sp.brand ?? ""} ${sp.name}`);
    const seen = new Set<string>();
    for (const token of tokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      const list = index.get(token);
      if (list) list.push(sp.id);
      else index.set(token, [sp.id]);
    }
  }
  return index;
}

export function candidateStandardizedIds(
  scrapedName: string,
  tokenIndex: Map<string, number[]>,
  allIds: number[],
): number[] {
  const tokens = significantTokens(scrapedName);
  if (!tokens.length) return allIds;

  const counts = new Map<number, number>();
  for (const token of tokens) {
    const ids = tokenIndex.get(token);
    if (!ids) continue;
    for (const id of ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  if (!counts.size) return allIds;

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}
