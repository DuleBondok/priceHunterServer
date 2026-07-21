import { Page } from "puppeteer";
import { launchBrowser } from "./puppeteerBrowser";
import { saveProducts, ProductData } from "../productService";
import { parseIdeaStaraCijenaRsd } from "./ideaStaraCijenaParse";

// 🔹 Add all category base URLs here (WITHOUT pageNumber value)
const CATEGORY_URLS = [
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Vino/c/0108?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Alcohol",
  },
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Pivo/c/0106?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Alcohol",
  },
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Zhestoka-picja/c/0109?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Alcohol",
  },
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Kvas/c/0105?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Drinks",
  },
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Energetski-napici/c/0103?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Drinks",
  },
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Chaj/c/0111?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Drinks",
  },
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Kafa/c/0110?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Drinks",
  },
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Sokovi-i-osvezhavajucja-bezalkoholna-picja/c/0102?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Drinks",
  },
  {
    url: `https://www.maxi.rs/Picje-kafa-i-chaj/Mineralna-voda/c/0101?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Drinks",
  },
  {
    url: `https://www.maxi.rs/Mlechni-proizvodi-i-jaja/c/02?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Milk and egg products",
  },
  {
    url: `https://www.maxi.rs/Pekara-torte-i-kolachi/c/05?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Bakery",
  },
    {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Shecjer/c/0801?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
    {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Brashno/c/0802?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
    {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Ulje-i-sircje/c/0803?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
    {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Pirinach-testenina-i-mahunarke/Pirinach/c/080401?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
    {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Pirinach-testenina-i-mahunarke/Testenine/c/080402?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
      {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/So-i-zachini/c/0805?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
      {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Supe-nudle-i-instant-krompir-pire/c/0806?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
      {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Sosevi-kechap-i-majonez/c/0809?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
      {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Med-vocjni-namazi-i-kompot/Med/c/081201?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
        {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Puding-shlag-i-sladoled-u-prahu/c/0813?q=%3Arelevance&sort=relevances&pageNumber=`,
    category: "Groceries",
  },
        {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Priprema-kolacha-i-torti/c/0814?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
        {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Kuhinje-sveta-sosevi-i-dodaci-jelima/c/0811?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
        {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Pirinach-testenina-i-mahunarke/Mahunarke/c/080403?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Fruits & Vegetables",
  },
        {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Zimnica-i-konzervirano-povrcje/c/0807?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Fruits & Vegetables",
  },
          {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Med-vocjni-namazi-i-kompot/Dzhem-marmelada-i-pekmez/c/081202?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Fruits & Vegetables",
  },
          {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Med-vocjni-namazi-i-kompot/Kompoti/c/081203?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Fruits & Vegetables",
  },
          {
    url: `https://www.maxi.rs/Pakovana-hrana-i-osnovne-namirnice/Med-vocjni-namazi-i-kompot/Slatko/c/081204?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Fruits & Vegetables",
  },
            {
    url: `https://www.maxi.rs/Vocje-i-povrcje/c/03?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Fruits & Vegetables",
  },
  {
    url: `https://www.maxi.rs/Smrznuti-proizvodi/c/06?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Frozen products",
  },
    {
    url: `https://www.maxi.rs/Meso-mesne-i-riblje-preradjevine/c/04?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Meat & Fish",
  },

      {
    url: `https://www.maxi.rs/Zdravija-hrana/c/09?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Healthy Food",
  },
        {
    url: `https://www.maxi.rs/Lichna-higijena-i-kozmetika/c/14?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Personal Care",
  },
  {
    url: `https://www.maxi.rs/Kucjna-hemija-i-papirna-galanterija/c/13?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Home Care",
  },
   {
    url: `https://www.maxi.rs/Bebi-svet/c/15?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Baby Care",
  },
     {
    url: `https://www.maxi.rs/Gotova-i-polugotova-jela/c/10?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Groceries",
  },
     {
    url: `https://www.maxi.rs/Kucjni-ljubimci/c/11?q=%3Arelevance&sort=relevance&pageNumber=`,
    category: "Pet Care",
  },
  
  
];

const PRODUCT_TILE_SELECTOR = '[data-testid="product-tile-footer"]';

/** Shorter buffer after DOM ready; tiles use data-testid and hydrate quickly on PLP. */
const POST_GOTO_SETTLE_MS = 200;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Skip heavy assets — we only read DOM (names, prices, img src). Saves a lot per navigation.
 */
async function enableFastAssetBlocking(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (
      type === "image" ||
      type === "stylesheet" ||
      type === "font" ||
      type === "media"
    ) {
      void req.abort();
      return;
    }
    void req.continue();
  });
}

type ScrapedMaxiRow = Omit<ProductData, "priceBeforeDiscount"> & {
  oldPriceRaw: string | null;
};

async function extractProducts(page: Page): Promise<ProductData[]> {
  const rows = await page.evaluate(() => {
    const products: ScrapedMaxiRow[] = [];

    document
      .querySelectorAll('[data-testid="product-tile-footer"]')
      .forEach((footer) => {
        const tile = footer.closest(
          '[data-testid="product-block"]',
        )?.parentElement;

        const nameLink = tile?.querySelector(
          '[data-testid="product-block-name-link"]',
        );

        const brand =
          nameLink
            ?.querySelector('[data-testid="product-brand"]')
            ?.textContent?.trim() || "";

        const name =
          nameLink
            ?.querySelector('[data-testid="product-name"]')
            ?.textContent?.trim() || "";

        const fullName = `${brand} ${name}`.trim();

        const priceContainer = tile?.querySelector(
          '[data-testid="product-block-price"]',
        );

        let whole =
          priceContainer
            ?.querySelector(".sc-dqia0p-8")
            ?.textContent?.trim() || "";

        let decimal =
          priceContainer
            ?.querySelector(".sc-dqia0p-9")
            ?.textContent?.trim() || "";

        const currency =
          priceContainer
            ?.querySelector(".sc-dqia0p-7")
            ?.textContent?.trim() || "";

        whole = whole.replace(/\D/g, "");
        decimal = decimal.replace(/\D/g, "");

        let price = "N/A";

        if (whole) {
          const numericPrice = parseFloat(`${whole}.${decimal || "00"}`);
          price = `${numericPrice.toFixed(2)} ${currency}`;
        }

        const oldPriceContainer = tile?.querySelector(
          '[data-testid="product-block-old-price"]',
        );

        const oldPriceRaw =
          oldPriceContainer?.querySelector("span")?.textContent?.trim() || null;

        const imageEl = tile?.querySelector(
          'img[data-testid="product-block-image"]',
        );

        let imageUrl = "";
        if (imageEl) {
          imageUrl =
            imageEl.getAttribute("src") ||
            imageEl.getAttribute("srcset")?.split(" ")[0] ||
            "";
        }

        if (imageUrl && !imageUrl.startsWith("http")) {
          imageUrl = `https://www.maxi.rs${imageUrl}`;
        }

        if (fullName) {
          products.push({
            name: fullName,
            price: price === "N/A" ? null : price,
            oldPriceRaw,
            store: "Maxi",
            category: "",
            image: imageUrl,
          });
        }
      });

    return products;
  });

  return rows.map(({ oldPriceRaw, ...rest }) => ({
    ...rest,
    priceBeforeDiscount: parseIdeaStaraCijenaRsd(oldPriceRaw),
  }));
}

/** Load PLP and read tiles; retries page 1 when the grid hydrates late (common under parallel tabs). */
async function loadListingPage(
  page: Page,
  url: string,
  category: string,
  listingPageIndex: number,
): Promise<ProductData[]> {
  const maxAttempts = listingPageIndex === 1 ? 4 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    await page.waitForSelector(PRODUCT_TILE_SELECTOR, { timeout: 25_000 }).catch(
      () => {
        /* empty PLP or still loading — extractProducts will tell */
      },
    );

    await sleep(POST_GOTO_SETTLE_MS);

    const items = await extractProducts(page);

    if (items.length > 0) {
      return items;
    }

    if (listingPageIndex > 1) {
      return items;
    }

    if (attempt < maxAttempts) {
      console.warn(
        `${category}: page ${listingPageIndex} returned 0 tiles (attempt ${attempt}/${maxAttempts}), retrying after delay…`,
      );
      await sleep(700 * attempt);
    }
  }

  return [];
}

// 🔹 Scrape ONE category using an existing page (no new tab per category).
async function scrapeCategory(
  page: Page,
  baseUrl: string,
  category: string,
): Promise<ProductData[]> {
  let currentPage = 1;
  const uniqueItemsMap = new Map<string, ProductData>();

  while (true) {
    const url = `${baseUrl}${currentPage}`;
    console.log(`Scraping ${category} - page ${currentPage}`);

    const items = await loadListingPage(page, url, category, currentPage);

    if (items.length === 0) {
      break;
    }

    items.forEach((item) => {
      item.category = category;

      const key = `${item.name}-${item.price}`;
      if (!uniqueItemsMap.has(key)) {
        uniqueItemsMap.set(key, item);
      }
    });

    console.log(
      `${category}: collected ${uniqueItemsMap.size} unique products`,
    );

    currentPage++;
  }

  return Array.from(uniqueItemsMap.values());
}

// 🔹 Main function (runs ALL categories)
async function scrapeMaxi(): Promise<ProductData[]> {
  const browser = await launchBrowser();

  const allResults: ProductData[] = [];

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90_000);
    await enableFastAssetBlocking(page);

    for (const cat of CATEGORY_URLS) {
      const rows = await scrapeCategory(page, cat.url, cat.category);
      rows.forEach((item) => allResults.push(item));
    }

    await page.close().catch(() => {});

    console.log(`Total products collected: ${allResults.length}`);

    await saveProducts(allResults, {
      clearMissingForStore: true,
      clearMissingOnlyForCategories: [
        ...new Set(CATEGORY_URLS.map((c) => c.category)),
      ],
    });

    await browser.close();
    return allResults;
  } catch (error: any) {
    console.error("Scraping error:", error.message);
    await browser.close();
    throw new Error("Failed to scrape data");
  }
}

export default scrapeMaxi;

scrapeMaxi()
  .then(() => {
    console.log("Scraping finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
