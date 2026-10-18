/**
 * Backfill ProductBarcode rows for Idea products from online.idea.rs v2 API.
 *
 * Match priority:
 *  1) Idea listing `code` embedded in Product.image path (images/products/…/{code}_…)
 *  2) normalizedName fallback
 *
 *   npx ts-node --transpile-only scripts/backfill-idea-barcodes.ts
 *   npx ts-node --transpile-only scripts/backfill-idea-barcodes.ts --dry-run
 */
import "dotenv/config";
import axios from "axios";

import prisma from "../prismaClient";
import { IDEA_COMPLETE_LISTINGS } from "../scrapers/ideaCompleteScraper";
import { normalizeName } from "../productService";
import { ideaProductIdFromImage } from "../utils/ideaProductId";

const dryRun = process.argv.includes("--dry-run");
const IDEA_API = "https://online.idea.rs/v2";
const PER_PAGE = 48;
const DELAY_MS = 80;

type IdeaApiProduct = {
  id?: number;
  code?: string | number | null;
  name?: string | null;
  barcodes?: unknown;
  product_uoms?: Array<{ barcode?: string | null }>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function categoryIdsFromListings(): number[] {
  const ids = new Set<number>();
  for (const row of IDEA_COMPLETE_LISTINGS) {
    const m = row.url.match(/categories\/(\d+)\//);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids];
}

function normalizeBarcode(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}

/** Idea returns barcodes as string[] and/or nested objects; also product_uoms[].barcode. */
function extractBarcodes(row: IdeaApiProduct): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => {
    const b = normalizeBarcode(v);
    if (b) out.add(b);
  };

  if (Array.isArray(row.barcodes)) {
    for (const item of row.barcodes) {
      if (item == null) continue;
      if (typeof item === "string" || typeof item === "number") {
        push(item);
      } else if (typeof item === "object") {
        const obj = item as Record<string, unknown>;
        push(obj.barcode ?? obj.ean ?? obj.code ?? obj.value);
      }
    }
  }

  if (Array.isArray(row.product_uoms)) {
    for (const uom of row.product_uoms) {
      push(uom?.barcode);
    }
  }

  return [...out];
}

async function fetchCategoryPage(
  categoryId: number,
  page: number,
): Promise<{ products: IdeaApiProduct[]; pageCount: number }> {
  const { data } = await axios.get(
    `${IDEA_API}/categories/${categoryId}/products`,
    {
      params: { per_page: PER_PAGE, page },
      timeout: 45000,
      headers: {
        Accept: "application/json",
        "User-Agent": "PricelyIdeaBarcodeBackfill/1.0",
      },
    },
  );
  const products = Array.isArray(data?.products) ? data.products : [];
  const pageCount = Number(data?._page?.page_count) || 1;
  return { products, pageCount };
}

async function main() {
  const ideaProducts = await prisma.product.findMany({
    where: { store: "Idea" },
    select: { id: true, name: true, normalizedName: true, image: true },
  });
  console.log(`[idea-barcodes] Product Idea rows=${ideaProducts.length}`);

  const byCode = new Map<string, number[]>();
  const byNorm = new Map<string, number[]>();
  for (const p of ideaProducts) {
    const code = ideaProductIdFromImage(p.image);
    if (code) {
      const list = byCode.get(code) ?? [];
      list.push(p.id);
      byCode.set(code, list);
    }
    const norm = p.normalizedName || normalizeName(p.name);
    if (norm) {
      const list = byNorm.get(norm) ?? [];
      list.push(p.id);
      byNorm.set(norm, list);
    }
  }
  console.log(
    `[idea-barcodes] index byCode=${byCode.size} byNorm=${byNorm.size} dryRun=${dryRun}`,
  );

  const categoryIds = categoryIdsFromListings();
  console.log(`[idea-barcodes] categories=${categoryIds.length}`);

  let apiProducts = 0;
  let matched = 0;
  let unmatched = 0;
  let barcodeRows = 0;
  let multiBarcodeProducts = 0;
  const seenProductIds = new Set<number>();
  const pairs: Array<{ productId: number; barcode: string }> = [];

  for (let ci = 0; ci < categoryIds.length; ci++) {
    const categoryId = categoryIds[ci];
    let page = 1;
    let pageCount = 1;
    do {
      try {
        const res = await fetchCategoryPage(categoryId, page);
        pageCount = Math.max(1, res.pageCount);
        for (const row of res.products) {
          apiProducts++;
          const barcodes = extractBarcodes(row);
          if (!barcodes.length) continue;

          const code = row.code != null ? String(row.code).trim() : "";
          let productIds: number[] | undefined = code
            ? byCode.get(code)
            : undefined;
          if (!productIds?.length) {
            const norm = normalizeName(String(row.name || ""));
            productIds = norm ? byNorm.get(norm) : undefined;
          }
          if (!productIds?.length) {
            unmatched++;
            continue;
          }

          matched++;
          if (barcodes.length > 1) multiBarcodeProducts++;

          for (const productId of productIds) {
            if (seenProductIds.has(productId) && barcodes.length) {
              // still add any new barcodes for this product
            }
            seenProductIds.add(productId);
            for (const barcode of barcodes) {
              pairs.push({ productId, barcode });
            }
          }
        }
        console.log(
          `[idea-barcodes] cat ${categoryId} (${ci + 1}/${categoryIds.length}) page ${page}/${pageCount} products=${res.products.length}`,
        );
      } catch (err) {
        console.warn(
          `[idea-barcodes] cat ${categoryId} page ${page} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
      page++;
      await sleep(DELAY_MS);
    } while (page <= pageCount);
  }

  // Dedupe pairs
  const uniquePairs = new Map<string, { productId: number; barcode: string }>();
  for (const p of pairs) {
    uniquePairs.set(`${p.productId}::${p.barcode}`, p);
  }
  const toInsert = [...uniquePairs.values()];
  barcodeRows = toInsert.length;

  console.log(
    `[idea-barcodes] apiProducts=${apiProducts} matchedHits=${matched} unmatchedApi=${unmatched} uniqueProducts=${seenProductIds.size} uniquePairs=${barcodeRows} multiBarcodeApiHits=${multiBarcodeProducts}`,
  );

  if (dryRun) {
    console.log("[idea-barcodes] dry-run — no DB writes");
    console.log("sample pairs:", toInsert.slice(0, 15));
    return;
  }

  let inserted = 0;
  const batchSize = 200;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);
    const result = await prisma.productBarcode.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  const productsWithBarcodes = await prisma.productBarcode.groupBy({
    by: ["productId"],
    _count: { _all: true },
  });
  const multi = productsWithBarcodes.filter((r) => r._count._all > 1).length;
  const totalBc = await prisma.productBarcode.count();

  console.log(
    `[idea-barcodes] inserted=${inserted} totalBarcodeRows=${totalBc} productsWithAnyBarcode=${productsWithBarcodes.length} productsWithMultiple=${multi}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
