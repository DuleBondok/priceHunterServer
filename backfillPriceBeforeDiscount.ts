    import prisma from "./prismaClient";
import scrapeMaxi from "./scrapers/maxiScraper";

// normalize must match your DB logic
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`"´¿]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

async function main() {
  console.log("🔎 Scraping Maxi again (to get priceBeforeDiscount)...");
  const scraped = await scrapeMaxi(); // must return priceBeforeDiscount

  const withOld = scraped.filter((p: any) => p.priceBeforeDiscount != null);
  console.log("DEBUG scraped:", scraped.length);
  console.log("DEBUG with old price:", withOld.length);

  const map = new Map<string, number>();
  for (const p of scraped as any[]) {
    const key = `${normalizeName(p.name)}__${p.store}`;
    if (isFiniteNumber(p.priceBeforeDiscount)) {
      map.set(key, p.priceBeforeDiscount);
    }
  }

  console.log(`🧠 Scraped old prices for ${map.size} Maxi products.`);

  const dbProducts = await prisma.product.findMany({
    where: { store: "Maxi", priceBeforeDiscount: null },
    select: { id: true, normalizedName: true, store: true },
  });

  console.log(`🧾 DB Maxi rows needing backfill: ${dbProducts.length}`);

  let skipped = 0;
  const updates = [];

  for (const db of dbProducts) {
    const key = `${db.normalizedName}__${db.store}`;
    const oldPrice = map.get(key);

    if (!isFiniteNumber(oldPrice)) {
      skipped++;
      continue;
    }

    updates.push(
      prisma.product.update({
        where: { id: db.id },
        data: { priceBeforeDiscount: oldPrice },
      })
    );
  }

  if (updates.length === 0) {
    console.log("⚠️ No rows matched scraped data. Nothing updated.");
    console.log(`Skipped: ${skipped}`);
    return;
  }

  console.log(`✍️ Updating ${updates.length} rows...`);
  await prisma.$transaction(updates);

  console.log("✅ Maxi backfill completed.");
  console.log(`Updated: ${updates.length}`);
  console.log(`Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error("❌ Maxi backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });