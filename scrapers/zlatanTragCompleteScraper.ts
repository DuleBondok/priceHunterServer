import axios from "axios";
import prisma from "../prismaClient";
import { ProductData, normalizeName, saveProducts } from "../productService";
import { normalizeDiscountPair } from "../utils/normalizeDiscountPrice";
import { formatPriceRsd } from "./univerexportPriceUtils";
import { zlatanTragCategoryFor } from "./zlatanTragCategories";

const STORE_NAME = "Zlatan Trag";
const BASE_URL = "https://proveracena.zlatantrag.rs/";
/** Site caps perPage at 100. */
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 300;

/** Zlatan Trag objects (`org` query param) whose prices we track. */
export const ZLATAN_TRAG_ORGS = [6, 47, 49, 53, 55, 56];

export type ZlatanTragRow = {
  org: number;
  name: string;
  price: number | null;
  regularPrice: number | null;
  description: string;
  available: boolean;
  promoKind: string | null;
  offerEndsOn: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Site text is CP852 bytes shown as Windows-1252 (e.g. "KeŸap" = Kečap, "Obu†a" = Obuća). */
const CP852_AS_1252: Record<string, string> = {
  "Ÿ": "č",
  "¬": "Č",
  "†": "ć",
  "\u008f": "Ć",
  "ç": "š",
  "æ": "Š",
  "§": "ž",
  "¦": "Ž",
  "Ð": "đ",
  "Ñ": "Đ",
};

function fixEncoding(text: string): string {
  return text.replace(/[Ÿ¬†\u008fçæ§¦ÐÑ]/g, (ch) => CP852_AS_1252[ch] ?? ch);
}

function cellText(html: string): string {
  return fixEncoding(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** "109.9 дин." / "1,234.50 дин." → 109.9 / 1234.5 */
function parseRsd(raw: string | undefined): number | null {
  const m = String(raw ?? "").match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0];
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "07.10.2026 до 19.10.2026" → "19.10.2026" */
function parseOfferEnd(raw: string | undefined): string | null {
  const dates = String(raw ?? "").match(/\d{2}\.\d{2}\.\d{4}/g);
  return dates && dates.length ? dates[dates.length - 1] : null;
}

export function parseListingHtml(html: string, org: number): ZlatanTragRow[] {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const rows: ZlatanTragRow[] = [];
  for (const tr of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    if (cells.length < 6 || !cells[0]) continue;
    const name = cells[0].replace(/[*#]+/g, " ").replace(/\s+/g, " ").trim();
    if (!name) continue;
    rows.push({
      org,
      name,
      price: parseRsd(cells[1]),
      regularPrice: parseRsd(cells[5]),
      description: cells[3] ?? "",
      available: /^da\b/i.test(cells[4] ?? ""),
      promoKind: cells[7] || null,
      offerEndsOn: parseOfferEnd(cells[8]),
    });
  }
  return rows;
}

async function fetchPage(org: number, page: number): Promise<string> {
  const { data } = await axios.get<string>(BASE_URL, {
    params: { org, search: "", perPage: PAGE_SIZE, page },
    responseType: "text",
    timeout: 45_000,
  });
  return data;
}

async function fetchPageWithRetry(org: number, page: number): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchPage(org, page);
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(2000 * attempt);
    }
  }
}

export async function scrapeZlatanTragOrg(org: number): Promise<ZlatanTragRow[]> {
  const rows: ZlatanTragRow[] = [];
  for (let page = 1; ; page++) {
    const pageRows = parseListingHtml(await fetchPageWithRetry(org, page), org);
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return rows;
}

function mostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * One Product per name across all tracked objects. Chain-level price is the price
 * most objects charge (ties → lowest); per-object prices go to ZlatanTragStorePrice.
 */
export function mergeRowsToProducts(rows: ZlatanTragRow[]): {
  products: ProductData[];
  skippedNoCategory: Map<string, number>;
} {
  const byName = new Map<string, ZlatanTragRow[]>();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }

  const products: ProductData[] = [];
  const skippedNoCategory = new Map<string, number>();
  for (const group of byName.values()) {
    const priced = group.filter((r) => r.price != null);
    const inStock = priced.filter((r) => r.available);
    const pool = inStock.length ? inStock : priced;
    const description = mostCommon(group.map((r) => r.description));
    const category = zlatanTragCategoryFor(description);
    if (!category) {
      skippedNoCategory.set(description, (skippedNoCategory.get(description) ?? 0) + 1);
      continue;
    }

    let rep: ZlatanTragRow | undefined;
    if (pool.length) {
      const sorted = [...pool].sort((a, b) => a.price! - b.price!);
      const price = mostCommon(sorted.map((r) => r.price!));
      rep = sorted.find((r) => r.price === price);
    }

    const normalized = normalizeDiscountPair({
      price: rep?.price != null ? formatPriceRsd(rep.price) : null,
      priceBeforeDiscount: rep?.regularPrice ?? null,
    });
    products.push({
      name: (rep ?? group[0]).name,
      price: normalized.price,
      priceBeforeDiscount: normalized.priceBeforeDiscount,
      availability: inStock.length ? "in_stock" : "out_of_stock",
      image: "",
      store: STORE_NAME,
      category,
      offerEndsOn: normalized.priceBeforeDiscount != null ? rep?.offerEndsOn ?? null : null,
    });
  }
  return { products, skippedNoCategory };
}

export async function scrapeZlatanTragCompleteProducts(options?: {
  dryRun?: boolean;
}): Promise<ProductData[]> {
  const allRows: ZlatanTragRow[] = [];
  for (const org of ZLATAN_TRAG_ORGS) {
    const rows = await scrapeZlatanTragOrg(org);
    console.log(`[Zlatan Trag] org ${org}: ${rows.length} rows`);
    allRows.push(...rows);
    await sleep(REQUEST_DELAY_MS);
  }

  const { products, skippedNoCategory } = mergeRowsToProducts(allRows);
  console.log(`[Zlatan Trag] Total collected: ${products.length}`);
  if (skippedNoCategory.size) {
    const top = [...skippedNoCategory.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `[Zlatan Trag] Skipped (unmapped description): ${top.reduce((s, [, n]) => s + n, 0)} — ${top
        .slice(0, options?.dryRun ? top.length : 15)
        .map(([d, n]) => `${d} (${n})`)
        .join(options?.dryRun ? "\n  " : ", ")}`,
    );
  }

  if (options?.dryRun) {
    const pricesByName = new Map<string, Set<number>>();
    for (const r of allRows) {
      if (r.price == null) continue;
      const key = normalizeName(r.name);
      pricesByName.set(key, (pricesByName.get(key) ?? new Set()).add(r.price));
    }
    const differing = [...pricesByName.values()].filter((s) => s.size > 1).length;
    console.log(
      `[Zlatan Trag] Distinct names: ${pricesByName.size}, with different price between objects: ${differing}, unavailable rows: ${allRows.filter((r) => !r.available).length}`,
    );
    return products;
  }

  await saveProducts(products, {
    clearMissingForStore: true,
    clearMissingOnlyForCategories: [...new Set(products.map((p) => p.category))],
  });
  await saveStorePrices(allRows, new Set(products.map((p) => normalizeName(p.name))));
  return products;
}

/** Replace this chain's per-object prices with the current run (names kept in Product/NewProducts only). */
async function saveStorePrices(rows: ZlatanTragRow[], keptNames: Set<string>): Promise<void> {
  const seenAt = new Date();
  const records = rows
    .filter((r) => keptNames.has(normalizeName(r.name)))
    .map((r) => {
      const pair = normalizeDiscountPair({
        price: r.price != null ? formatPriceRsd(r.price) : null,
        priceBeforeDiscount: r.regularPrice,
      });
      return {
        store: STORE_NAME,
        storeCode: String(r.org),
        normalizedName: normalizeName(r.name),
        name: r.name,
        price: pair.price,
        priceBeforeDiscount: pair.priceBeforeDiscount,
        isAvailable: r.available && r.price != null,
        offerEndsOn: pair.priceBeforeDiscount != null ? r.offerEndsOn : null,
        lastSeenAt: seenAt,
      };
    });

  const unique = new Map(records.map((r) => [`${r.normalizedName}|${r.storeCode}`, r]));
  const list = [...unique.values()];
  await prisma.$transaction(
    async (tx) => {
      await tx.storeLocationPrice.deleteMany({ where: { store: STORE_NAME } });
      for (let i = 0; i < list.length; i += 1000) {
        await tx.storeLocationPrice.createMany({ data: list.slice(i, i + 1000) });
      }
    },
    { timeout: 120_000 },
  );
  console.log(`[Zlatan Trag] Store prices saved: ${list.length}`);
}

function runIfExecutedDirectly(): void {
  const entryBase = (process.argv[1] ?? "").split(/[/\\]/).pop() ?? "";
  if (!entryBase.includes("zlatanTragCompleteScraper")) return;

  const dryRun = process.argv.includes("--dry-run");
  console.log(`Zlatan Trag complete scraper starting${dryRun ? " (dry run)" : ""}…`);
  scrapeZlatanTragCompleteProducts({ dryRun })
    .then((products) => {
      console.log(`Zlatan Trag complete scraping finished (${products.length} products).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Zlatan Trag complete scraping failed:", err);
      process.exit(1);
    });
}

runIfExecutedDirectly();
