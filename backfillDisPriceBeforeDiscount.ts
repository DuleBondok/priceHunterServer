import puppeteer, { Browser, Page } from "puppeteer";
import prisma from "./prismaClient";

type DisCategory = {
  code: string;
  label: string;
};

type ScrapedOldPrice = {
  name: string;
  priceBeforeDiscount: number;
};

const DIS_SEARCH_URL = "https://www.dis.rs/pretraga?type=artikli&query=";

// User-provided categories for first backfill pass.
const DIS_BACKFILL_CATEGORIES: DisCategory[] = [
  { code: "C1", label: "MLEKO, MLECNI PROIZVODI I JAJA" },
  { code: "O1", label: "BEZALKOHOLNA PICA" },
  { code: "P1", label: "ALKOHOLNA PICA" },
];

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

function compactKey(name: string): string {
  return normalizeName(name).replace(/\s+/g, "");
}

function parsePriceNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^\d.,]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

async function waitForProductsGrid(page: Page): Promise<void> {
  await page.waitForSelector('a[href^="/artikli/"]', { timeout: 30000 });
}

async function applyCategoryFilter(page: Page, categoryCode: string): Promise<void> {
  await page.waitForSelector("select", { timeout: 20000 });
  await page.select("select", categoryCode);
  await page.waitForFunction(
    () => {
      const loading = document.querySelector(
        '.loading-spinner, [class*="loading"], [class*="spinner"]',
      ) as HTMLElement | null;
      return !loading || loading.style.display === "none";
    },
    { timeout: 15000 },
  );
  await waitForProductsGrid(page);
}

async function scrapeCurrentPageOldPrices(page: Page): Promise<ScrapedOldPrice[]> {
  return page.evaluate(() => {
    const rows: ScrapedOldPrice[] = [];

    const cards = document.querySelectorAll('a[href^="/artikli/"]');
    cards.forEach((card) => {
      const name =
        card.querySelector("p.font-bold.text-black")?.textContent?.trim() ?? "";
      const oldPriceRaw =
        card.querySelector("p.line-through")?.textContent?.trim() ?? "";

      const cleanedOldPrice = oldPriceRaw
        .replace(/[^\d.,]/g, "")
        .replace(/\.(?=\d{3}\b)/g, "")
        .replace(",", ".");

      if (!cleanedOldPrice) return;

      const numeric = Number(cleanedOldPrice);

      if (name && Number.isFinite(numeric) && numeric > 0) {
        rows.push({ name, priceBeforeDiscount: numeric });
      }
    });

    return rows;
  });
}

async function goToNextPageIfPossible(page: Page): Promise<boolean> {
  const nextButtons = await page.$$("button.flex.flex-row.items-center");
  if (nextButtons.length < 2) return false;

  const nextButton = nextButtons[nextButtons.length - 1];
  const isDisabled = await page.evaluate((button) => {
    const p = button.querySelector("p");
    return (
      button.hasAttribute("disabled") ||
      button.classList.contains("cursor-default") ||
      p?.classList.contains("opacity-50") === true
    );
  }, nextButton);

  if (isDisabled) return false;

  const beforeFirstName = await page.evaluate(() => {
    return (
      document.querySelector('a[href^="/artikli/"] p.font-bold.text-black')
        ?.textContent ?? ""
    ).trim();
  });

  try {
    await Promise.all([
      nextButton.click(),
      page.waitForFunction(
        (prevName: string) => {
          const current =
            document.querySelector('a[href^="/artikli/"] p.font-bold.text-black')
              ?.textContent ?? "";
          return current.trim() !== prevName.trim();
        },
        { timeout: 15000 },
        beforeFirstName,
      ),
    ]);
  } catch {
    return false;
  }

  await waitForProductsGrid(page);
  return true;
}

async function scrapeDisOldPrices(browser: Browser): Promise<Map<string, number>> {
  const page = await browser.newPage();
  const oldPricesByName = new Map<string, number>();

  try {
    await page.goto(DIS_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForProductsGrid(page);

    for (const category of DIS_BACKFILL_CATEGORIES) {
      console.log(`\n[DIS] Category ${category.code} (${category.label})`);
      await applyCategoryFilter(page, category.code);

      let pageNum = 1;
      const maxPages = 80;

      while (pageNum <= maxPages) {
        const rows = await scrapeCurrentPageOldPrices(page);
        console.log(`[DIS] ${category.code} page ${pageNum}: old prices ${rows.length}`);

        rows.forEach((row) => {
          oldPricesByName.set(normalizeName(row.name), row.priceBeforeDiscount);
        });

        const hasNext = await goToNextPageIfPossible(page);
        if (!hasNext) {
          break;
        }
        pageNum++;
      }

      if (pageNum > maxPages) {
        console.log(`[DIS] ${category.code}: reached max pages (${maxPages}), stopping.`);
      }
    }
  } finally {
    await page.close();
  }

  return oldPricesByName;
}

function findOldPriceForDbProduct(
  dbName: string,
  scrapedByNormalizedName: Map<string, number>,
): number | null {
  const normalized = normalizeName(dbName);
  const exact = scrapedByNormalizedName.get(normalized);
  if (exact != null) return exact;

  const compact = compactKey(dbName);
  if (!compact) return null;

  // Conservative fallback: allow compact contains/includes match only when unique.
  let found: number | null = null;
  let matches = 0;

  for (const [scrapedName, oldPrice] of scrapedByNormalizedName.entries()) {
    const scrapedCompact = scrapedName.replace(/\s+/g, "");
    if (!scrapedCompact) continue;

    if (
      scrapedCompact === compact ||
      scrapedCompact.includes(compact) ||
      compact.includes(scrapedCompact)
    ) {
      matches++;
      if (matches > 1) {
        // Ambiguous fallback match; skip to avoid wrong backfill.
        return null;
      }
      found = oldPrice;
    }
  }

  return found;
}

async function backfillDisPriceBeforeDiscount(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    console.log("[DIS] Starting one-time priceBeforeDiscount backfill...");
    const scrapedOldPrices = await scrapeDisOldPrices(browser);
    console.log(`[DIS] Scraped old prices for ${scrapedOldPrices.size} unique product names.`);

    const dbRows = await prisma.product.findMany({
      where: { store: "DIS", priceBeforeDiscount: null },
      select: { id: true, normalizedName: true, name: true },
    });

    console.log(`[DIS] DB rows needing backfill: ${dbRows.length}`);

    const updates: { id: number; priceBeforeDiscount: number }[] = [];
    let skippedNoMatch = 0;
    let skippedNoOldPrice = 0;

    for (const row of dbRows) {
      const oldPrice = findOldPriceForDbProduct(
        row.normalizedName || row.name,
        scrapedOldPrices,
      );

      if (oldPrice == null) {
        skippedNoMatch++;
        continue;
      }

      const parsed = parsePriceNumber(String(oldPrice));
      if (parsed == null) {
        skippedNoOldPrice++;
        continue;
      }

      updates.push({ id: row.id, priceBeforeDiscount: parsed });
    }

    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      await prisma.$transaction(
        batch.map((u) =>
          prisma.product.update({
            where: { id: u.id },
            data: { priceBeforeDiscount: u.priceBeforeDiscount },
          }),
        ),
      );
    }

    console.log("[DIS] Backfill finished.");
    console.log(`[DIS] Updated: ${updates.length}`);
    console.log(`[DIS] Skipped (no name match): ${skippedNoMatch}`);
    console.log(`[DIS] Skipped (invalid old price): ${skippedNoOldPrice}`);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

backfillDisPriceBeforeDiscount().catch((err) => {
  console.error("[DIS] Backfill failed:", err);
  process.exit(1);
});
