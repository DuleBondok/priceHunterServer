import { Browser, Page } from "puppeteer";
import { launchBrowser } from "./puppeteerBrowser";
import { ProductData, saveProducts } from "../productService";

type DisCategoryEntry = {
  code: string;
  category: string;
  label: string;
};

const DIS_SEARCH_URL = "https://www.dis.rs/pretraga?type=artikli&query=";

/**
 * Categories to scrape (same listing approach as backfill / DIS search UI).
 */
export const DIS_COMPLETE_CATEGORIES: DisCategoryEntry[] = [
  { code: "C1", category: "Milk and egg products", label: "MLEKO, MLECNI PROIZVODI I JAJA" },
  { code: "O1", category: "Drinks", label: "BEZALKOHOLNA PICA" },
  { code: "P1", category: "Alcohol", label: "ALKOHOLNA PICA" },
  { code: "H1", category: "Groceries", label: "NAMIRNICE" },
  { code: "E1", category: "Frozen products", label: "SMRZNUTI PROZIVODI" },
  { code: "L1", category: "Groceries", label: "ZACINI I PRASKASTI PROIZVODI" },
  { code: "M1", category: "Sweets and Snacks", label: "SLATKISI I GRICKALICE" },
  { code: "I1", category: "Bakery", label: "PEKARA" },
  { code: "B1", category: "Meat & Fish", label: "MESNE I RIBLJE PRERADJEVINE" },
  { code: "D1", category: "Meat & Fish", label: "MESNE I RIBLJE KONZERVE" },
  { code: "MA", category: "Healthy Food", label: "ZDRAVA HRANA" },
  { code: "F1", category: "Groceries", label: "PRERADA OD VOCA I POVRCA I MED" },
  { code: "G1", category: "Fruits & Vegetables", label: "SVEZE VOCE I POVRCE" },
  { code: "J1", category: "Groceries", label: "NAMAZI I PRILOZI" },
  { code: "N1", category: "Drinks", label: "KAFA I OSTALI NAPICI" },
  { code: "Q1", category: "Personal Care", label: "LICNA HIGIJENA" },
  { code: "QB", category: "Personal Care", label: "PAPIRNA GALANTERIJA" },
  { code: "R1", category: "Home Care", label: "KUCNA HEMIJA" },
  { code: "S1", category: "Baby Care", label: "DECIJI I BABY PROGRAM" },
  { code: "A1", category: "Meat & Fish", label: "SVEZE MESO I RIBA" },
  { code: "K1", category: "Bakery", label: "GOTOVA JELA" },
  { code: "T1", category: "Pet Care", label: "HRANA ZA ZIVOTINJE" },
];

function parsePriceNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^\d.,]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrentPriceRsd(raw: string | null | undefined): string | null {
  const parsed = parsePriceNumber(raw);
  if (parsed == null) return null;
  return `${parsed.toFixed(2)} RSD`;
}

function normalizeForDedupe(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`"´¿]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function gotoWithRetry(
  page: Page,
  url: string,
  options: Parameters<Page["goto"]>[1] = {},
  maxAttempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, options);
      return;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|Navigation timeout/i.test(
          message,
        );
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = attempt * 3000;
      console.warn(
        `[DIS] goto failed (attempt ${attempt}/${maxAttempts}): ${message} — retry in ${delayMs}ms`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

async function waitForProducts(page: Page): Promise<void> {
  await page.waitForSelector('a[href^="/artikli/"]', { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const cards = Array.from(document.querySelectorAll('a[href^="/artikli/"]'));
      if (cards.length === 0) return false;
      const readyCount = cards.filter((card) => {
        const name =
          card
            .querySelector("p.font-bold.text-black, p[class*='line-clamp']")
            ?.textContent?.trim() ?? "";
        const hasOutOfStockSignal = /obavesti me|notify me|nema na stanju|rasprodato|nije dostupno/i.test(
          card.textContent?.replace(/\s+/g, " ").trim() ?? "",
        );

        const hasPriceSignal = Array.from(card.querySelectorAll("p"))
          .map((p) => p.textContent?.trim() ?? "")
          .some((txt) => /^\d[\d.,]*$/.test(txt) || /(\d[\d.,]*)\s*(RSD|DIN)\b/i.test(txt));

        return !!name && (hasOutOfStockSignal || hasPriceSignal);
      }).length;

      return readyCount >= Math.max(1, Math.floor(cards.length * 0.65));
    },
    { timeout: 20000 },
  );
}

async function waitForProductsStable(page: Page): Promise<void> {
  await waitForProducts(page);
  await page.waitForFunction(
    () => {
      const cards = document.querySelectorAll('a[href^="/artikli/"]').length;
      const key = "__disCardsStableCount";
      const sameKey = "__disCardsStableSameCount";
      const w = window as unknown as Record<string, number>;
      if (w[key] === cards) {
        w[sameKey] = (w[sameKey] ?? 0) + 1;
      } else {
        w[key] = cards;
        w[sameKey] = 0;
      }
      return (w[sameKey] ?? 0) >= 2;
    },
    { timeout: 7000 },
  );
}

async function applyCategory(page: Page, code: string): Promise<void> {
  await page.waitForSelector("select", { timeout: 20000 });
  await page.select("select", code);
  await page.waitForFunction(
    () => {
      const loading = document.querySelector(
        '.loading-spinner, [class*="loading"], [class*="spinner"]',
      ) as HTMLElement | null;
      return !loading || loading.style.display === "none";
    },
    { timeout: 15000 },
  );
  await waitForProducts(page);
}

async function scrapeCurrentPage(
  page: Page,
  category: string,
): Promise<ProductData[]> {
  const rows: Array<{
    name: string;
    currentPriceRaw: string;
    oldPriceRaw: string;
    imageRaw: string;
    availability: "in_stock" | "out_of_stock" | "unknown";
    category: string;
  }> = await page.evaluate((categoryName) => {
    const priceRegex = /(\d[\d.,]*)\s*(RSD|DIN)\b/i;
    const numericRegex = /^\d[\d.,]*$/;
    const outOfStockRegex = /obavesti me|notify me|nema na stanju|rasprodato|nije dostupno/i;
    const addToCartRegex = /dodaj|u korpu|add to cart/i;

    return Array.from(document.querySelectorAll('a[href^="/artikli/"]'))
      .map((item) => {
        const name =
          item
            .querySelector("p.font-bold.text-black, p[class*='line-clamp']")
            ?.textContent?.trim() ?? "";
        let currentPriceRaw = "";
        const priceCandidates = Array.from(
          item.querySelectorAll(
            "p.font-roboto-slab.font-bold, p[class*='text-[28px]'], p[class*='text-[40px]'], p.text-end.font-bold",
          ),
        )
          .map((el) => el.textContent?.trim() ?? "")
          .filter((txt) => !!txt && !/^\s*$/.test(txt));

        for (const candidate of priceCandidates) {
          if (numericRegex.test(candidate) || priceRegex.test(candidate)) {
            currentPriceRaw = candidate;
            break;
          }
        }
        const oldPriceRaw =
          item.querySelector("p.line-through")?.textContent?.trim() ?? "";

        // DIS occasionally changes font-size utility classes. Fallback to card text.
        if (!currentPriceRaw) {
          const text = item.textContent?.replace(/\s+/g, " ").trim() ?? "";
          const oldPriceMatch = oldPriceRaw.match(priceRegex)?.[0] ?? "";
          const match = text.match(priceRegex)?.[0] ?? "";

          if (match) {
            currentPriceRaw =
              oldPriceMatch && match === oldPriceMatch
                ? ""
                : match;
          }
        }

        const buttonText = Array.from(item.querySelectorAll("button, [role='button']"))
          .map((btn) => btn.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean)
          .join(" ");

        const textBlob = `${buttonText} ${item.textContent?.replace(/\s+/g, " ").trim() ?? ""}`;
        const explicitlyOutOfStock = outOfStockRegex.test(textBlob);
        const explicitAddToCart = addToCartRegex.test(buttonText);

        const imageEl = item.querySelector("img");
        const imageRaw = imageEl?.getAttribute("src") ?? "";

        const availability: "in_stock" | "out_of_stock" | "unknown" =
          explicitlyOutOfStock
            ? "out_of_stock"
            : explicitAddToCart
              ? "in_stock"
              : "unknown";

        return {
          name,
          currentPriceRaw,
          oldPriceRaw,
          imageRaw,
          availability,
          category: categoryName,
        };
      })
      .filter((p) => !!p.name);
  }, category);

  return rows.map((row) => {
    let image = row.imageRaw;
    if (image) {
      try {
        const parsed = new URL(image, DIS_SEARCH_URL);
        image = parsed.searchParams.get("url") || image;
      } catch {
        // Keep original value if URL constructor fails.
      }
    }

    return {
      name: row.name,
      price: formatCurrentPriceRsd(row.currentPriceRaw),
      priceBeforeDiscount: parsePriceNumber(row.oldPriceRaw),
      image: image || "",
      availability: row.availability,
      store: "DIS",
      category: row.category,
    };
  });
}

function inStockNullCount(products: ProductData[]): number {
  return products.filter(
    (p) => p.availability === "in_stock" && p.price === null,
  ).length;
}

async function scrapeCurrentPageWithRetry(
  page: Page,
  category: string,
): Promise<ProductData[]> {
  let best = await scrapeCurrentPage(page, category);
  let bestNulls = inStockNullCount(best);

  if (best.length === 0) return best;

  for (let attempt = 1; attempt <= 2 && bestNulls > 0; attempt++) {
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {
      /* trackers can keep network busy; continue */
    });
    await new Promise((resolve) => setTimeout(resolve, 350 * attempt));

    const retry = await scrapeCurrentPage(page, category);
    const retryNulls = inStockNullCount(retry);
    if (
      retry.length >= best.length &&
      (retryNulls < bestNulls || (retryNulls === bestNulls && retry.length > best.length))
    ) {
      best = retry;
      bestNulls = retryNulls;
    }
  }

  if (bestNulls > 0) {
    console.warn(
      `[DIS] In-stock products with missing price on page: ${bestNulls}/${best.length}`,
    );
  }

  return best;
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

  const firstNameBefore = await page.evaluate(() => {
    return (
      document.querySelector('a[href^="/artikli/"] p.font-bold.text-black')
        ?.textContent ?? ""
    ).trim();
  });

  try {
    await Promise.all([
      nextButton.click(),
      page.waitForFunction(
        (prevFirstName: string) => {
          const firstNameCurrent =
            document.querySelector('a[href^="/artikli/"] p.font-bold.text-black')
              ?.textContent ?? "";
          return firstNameCurrent.trim() !== prevFirstName.trim();
        },
        { timeout: 15000 },
        firstNameBefore,
      ),
    ]);
  } catch {
    return false;
  }

  await waitForProductsStable(page);
  return true;
}

async function scrapeDisCategory(
  browser: Browser,
  categoryEntry: DisCategoryEntry,
): Promise<ProductData[]> {
  const page = await browser.newPage();
  const unique = new Map<string, ProductData>();
  const maxPages = 80;

  try {
    page.setDefaultTimeout(30000);

    await gotoWithRetry(page, DIS_SEARCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await applyCategory(page, categoryEntry.code);

    let pageNum = 1;
    while (pageNum <= maxPages) {
      console.log(`[DIS] ${categoryEntry.code} (${categoryEntry.label}) page ${pageNum}`);
      await waitForProductsStable(page);
      const products = await scrapeCurrentPageWithRetry(page, categoryEntry.category);

      if (products.length === 0) {
        break;
      }

      for (const product of products) {
        const dedupeKey = `${normalizeForDedupe(product.name)}__${categoryEntry.code}`;
        if (!unique.has(dedupeKey)) {
          unique.set(dedupeKey, product);
          continue;
        }

        const existing = unique.get(dedupeKey);
        // Prefer entries with a price so transient null reads do not win.
        if (existing && existing.price === null && product.price !== null) {
          unique.set(dedupeKey, product);
        }
      }

      const hasNext = await goToNextPageIfPossible(page);
      if (!hasNext) break;
      pageNum++;
    }

    if (pageNum > maxPages) {
      console.log(`[DIS] ${categoryEntry.code}: reached max pages (${maxPages}).`);
    }
  } finally {
    await page.close();
  }

  return Array.from(unique.values());
}

export async function scrapeDisCompleteProducts(): Promise<ProductData[]> {
  const browser = await launchBrowser();
  const allProducts: ProductData[] = [];

  try {
    for (const category of DIS_COMPLETE_CATEGORIES) {
      const categoryProducts = await scrapeDisCategory(browser, category);
      allProducts.push(...categoryProducts);
      console.log(
        `[DIS] ${category.code}: collected ${categoryProducts.length} unique products`,
      );
    }

    console.log(`[DIS] Total collected: ${allProducts.length}`);
    await saveProducts(allProducts, {
      clearMissingForStore: true,
      clearMissingOnlyForCategories: [
        ...new Set(DIS_COMPLETE_CATEGORIES.map((c) => c.category)),
      ],
    });
    return allProducts;
  } finally {
    await browser.close();
  }
}

export default { scrapeDisCompleteProducts, DIS_COMPLETE_CATEGORIES };

function runIfExecutedDirectly(): void {
  const entryBase = (process.argv[1] ?? "").split(/[/\\]/).pop() ?? "";
  if (!entryBase.includes("disCompleteScraper")) {
    return;
  }

  console.log("DIS complete scraper starting...");

  scrapeDisCompleteProducts()
    .then(() => {
      console.log("DIS complete scraping finished.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("DIS complete scraping failed:", err);
      process.exit(1);
    });
}

runIfExecutedDirectly();
