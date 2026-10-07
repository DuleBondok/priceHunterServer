/**
 * Idea renamed listings on its site, so scrape staged existing products as NewProducts.
 * Re-attach those NewProducts rows to the existing Idea Product (same id, same
 * standardizedProductId) by renaming the Product, then delete the NewProducts row.
 *
 * Match order:
 *   1. Idea product id from image path (images/products/<n>/<id>_1.jpg)
 *   2. Identical word set + identical price (fallback when image id is missing)
 *
 * Usage (from backend):
 *   npx ts-node --transpile-only scripts/relinkIdeaRenamedProducts.ts            (dry-run)
 *   npx ts-node --transpile-only scripts/relinkIdeaRenamedProducts.ts --apply
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../prismaClient";
import { ideaProductIdFromImage } from "../utils/ideaProductId";
import { normalizeDiscountPair } from "../utils/normalizeDiscountPrice";

const apply = process.argv.includes("--apply");
const REPORT_PATH = resolve(__dirname, "relinkIdeaRenamedProducts.report.json");

function wordSetKey(normalized: string): string {
  return [...new Set(normalized.split(/\s+/).filter(Boolean))].sort().join(" ");
}

type Pair = {
  newProductId: number;
  productId: number;
  via: "idea_id" | "word_set";
  oldName: string;
  newName: string;
  oldPrice: string | null;
  newPrice: string | null;
  standardizedProductId: number | null;
};

async function main() {
  const pending = await prisma.newProducts.findMany({
    where: { store: "Idea", processedAt: null },
    // Freshest name wins when several staged rows point at the same Product.
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
  });
  const products = await prisma.product.findMany({
    where: { store: "Idea" },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      image: true,
      price: true,
      flaggedForReview: true,
      standardizedProductId: true,
    },
  });

  const productsByIdeaId = new Map<string, typeof products>();
  const productsByWordSet = new Map<string, typeof products>();
  const takenNormalized = new Set(products.map((p) => p.normalizedName ?? ""));
  for (const p of products) {
    const ideaId = ideaProductIdFromImage(p.image);
    if (ideaId) productsByIdeaId.set(ideaId, [...(productsByIdeaId.get(ideaId) ?? []), p]);
    const ws = wordSetKey(p.normalizedName ?? "");
    productsByWordSet.set(ws, [...(productsByWordSet.get(ws) ?? []), p]);
  }

  const usedProductIds = new Set<number>();
  const pairs: Pair[] = [];
  const skipped: { newProductId: number; name: string; reason: string }[] = [];
  const staleDuplicates: { newProductId: number; name: string; productId: number }[] = [];

  for (const row of pending) {
    let target: (typeof products)[number] | undefined;
    let via: Pair["via"] = "idea_id";

    const ideaId = ideaProductIdFromImage(row.image);
    const byId = ideaId ? productsByIdeaId.get(ideaId) : undefined;
    if (byId && byId.length > 1) {
      skipped.push({ newProductId: row.id, name: row.name, reason: "idea id shared by several Products" });
      continue;
    }
    if (byId?.length === 1) {
      target = byId[0];
    } else {
      const byWords = (productsByWordSet.get(wordSetKey(row.normalizedName)) ?? []).filter(
        (p) => p.price === row.price,
      );
      if (byWords.length === 1) {
        target = byWords[0];
        via = "word_set";
      } else if (byWords.length > 1) {
        skipped.push({ newProductId: row.id, name: row.name, reason: "several Products with same words and price" });
        continue;
      }
    }

    if (!target) continue;
    if (usedProductIds.has(target.id)) {
      staleDuplicates.push({ newProductId: row.id, name: row.name, productId: target.id });
      continue;
    }
    if (target.normalizedName !== row.normalizedName && takenNormalized.has(row.normalizedName)) {
      skipped.push({ newProductId: row.id, name: row.name, reason: "new name already used by another Idea Product" });
      continue;
    }

    usedProductIds.add(target.id);
    pairs.push({
      newProductId: row.id,
      productId: target.id,
      via,
      oldName: target.name,
      newName: row.name,
      oldPrice: target.price,
      newPrice: row.price,
      standardizedProductId: target.standardizedProductId,
    });
  }

  const byVia = pairs.reduce<Record<string, number>>((acc, p) => {
    acc[p.via] = (acc[p.via] ?? 0) + 1;
    return acc;
  }, {});
  const linked = pairs.filter((p) => p.standardizedProductId != null).length;

  console.log(`Idea NewProducts pending: ${pending.length}`);
  console.log(`Paired with existing Product: ${pairs.length} (${JSON.stringify(byVia)})`);
  console.log(`  …of which linked to StandardizedProduct: ${linked}`);
  console.log(`  …price changed: ${pairs.filter((p) => p.oldPrice !== p.newPrice).length}`);
  console.log(`Older staged duplicates of a paired Product (deleted): ${staleDuplicates.length}`);
  console.log(`Skipped (ambiguous): ${skipped.length}`);
  console.log(
    `Left in NewProducts (no match): ${pending.length - pairs.length - staleDuplicates.length - skipped.length}`,
  );
  console.log("\nSamples:");
  for (const p of pairs.slice(0, 8)) {
    console.log(`  #${p.productId} [${p.via}] "${p.oldName}" → "${p.newName}"`);
  }

  writeFileSync(
    REPORT_PATH,
    `${JSON.stringify({ pairs, staleDuplicates, skipped }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nReport: ${REPORT_PATH}`);

  if (!apply) {
    console.log("Dry run — pass --apply to rename Products and delete paired NewProducts.");
    return;
  }

  const pendingById = new Map(pending.map((r) => [r.id, r]));
  const flaggedIds = new Set(products.filter((p) => p.flaggedForReview).map((p) => p.id));
  let done = 0;

  for (const pair of pairs) {
    const row = pendingById.get(pair.newProductId)!;
    const prices = normalizeDiscountPair({
      price: row.price,
      priceBeforeDiscount: row.priceBeforeDiscount != null ? Number(row.priceBeforeDiscount) : null,
    });

    await withRetry(() => prisma.$transaction([
      prisma.product.update({
        where: { id: pair.productId },
        data: flaggedIds.has(pair.productId)
          ? { name: row.name, normalizedName: row.normalizedName }
          : {
              name: row.name,
              normalizedName: row.normalizedName,
              price: prices.price,
              priceBeforeDiscount: prices.priceBeforeDiscount,
              image: row.image,
              lastSeenAt: row.lastSeenAt,
              isAvailable: true,
              consecutiveMissingDays: 0,
            },
      }),
      prisma.newProducts.delete({ where: { id: row.id } }),
    ]));

    done++;
    if (done % 500 === 0) console.log(`  applied ${done}/${pairs.length}`);
  }

  const removed = await prisma.newProducts.deleteMany({
    where: { id: { in: staleDuplicates.map((d) => d.newProductId) } },
  });

  console.log(`Applied: ${done}, stale duplicates deleted: ${removed.count}`);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (i >= attempts || !["P1017", "P1001", "P2024"].includes(code ?? "")) throw err;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
