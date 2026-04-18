import puppeteer, { Browser, Page } from "puppeteer";
import { saveProducts, ProductData } from "../productService";

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
];

// 🔹 Scrape ONE category (your existing logic, wrapped)
async function scrapeCategory(
  browser: Browser,
  baseUrl: string,
  category: string,
): Promise<ProductData[]> {
  const page = await browser.newPage();
  let currentPage = 1;
  const uniqueItemsMap = new Map<string, ProductData>();

  while (true) {
    const url = `${baseUrl}${currentPage}`;
    console.log(`Scraping ${category} - page ${currentPage}`);

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 1500));

    const items: ProductData[] = await page.evaluate(() => {
      const products: ProductData[] = [];

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

          const oldText =
            oldPriceContainer?.querySelector("span")?.textContent?.trim() || "";

          let numericOldPrice: number | null = null;

          if (oldText) {
            const match = oldText.match(/[\d.,]+/); // extract only number part

            if (match) {
              const cleaned = match[0]
                .replace(/\./g, "") // remove thousand separators
                .replace(",", "."); // convert decimal

              const parsed = Number(cleaned);
              numericOldPrice = isNaN(parsed) ? null : parsed;
            }
          }

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
              priceBeforeDiscount: numericOldPrice,
              store: "Maxi",
              category: "", // will override outside
              image: imageUrl,
            });
          }
        });

      return products;
    });

    if (items.length === 0) break;

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

  await page.close();
  return Array.from(uniqueItemsMap.values());
}

// 🔹 Main function (runs ALL categories)
async function scrapeMaxi(): Promise<ProductData[]> {
  const browser = await puppeteer.launch({ headless: true });

  const CONCURRENCY = 3; // 🔥 keep this low (2–5)
  const allResults: ProductData[] = [];

  try {
    for (let i = 0; i < CATEGORY_URLS.length; i += CONCURRENCY) {
      const batch = CATEGORY_URLS.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        batch.map((cat) => scrapeCategory(browser, cat.url, cat.category)),
      );

      results.flat().forEach((item) => {
        allResults.push(item);
      });
    }

    console.log(`Total products collected: ${allResults.length}`);

    await saveProducts(allResults);

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
