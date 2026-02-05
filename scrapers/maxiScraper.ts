import puppeteer from "puppeteer";
import { saveProducts, ProductData } from "../productService";

async function scrapeMaxi(): Promise<ProductData[]> {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    let currentPage = 1;
    const uniqueItemsMap = new Map<string, ProductData>();

    while (true) {
       //const url = `https://www.maxi.rs/Mlechni-proizvodi-i-jaja/c/02?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;
       // const url = `https://www.maxi.rs/Picje-kafa-i-chaj/Mineralna-voda/c/0101?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;
      // const url = `https://www.maxi.rs/Picje-kafa-i-chaj/Energetski-napici/c/0103?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;
      // const url = `https://www.maxi.rs/Picje-kafa-i-chaj/Kafa/c/0110?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;
      // const url = `https://www.maxi.rs/Picje-kafa-i-chaj/Chaj/c/0111?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;
      const url = `https://www.maxi.rs/Picje-kafa-i-chaj/Sokovi-i-osvezhavajucja-bezalkoholna-picja/Gazirani-napici/c/010202?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;

      console.log(`Scraping page ${currentPage}: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });

      await new Promise((resolve) => setTimeout(resolve, 1500));

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

            let numericOldPrice: number | null = null;

            const oldText =
              oldPriceContainer?.querySelector("span")?.textContent?.trim() ||
              "";

            if (oldText) {
              const cleaned = oldText
                .replace("RSD", "")
                .replace(/\s+/g, "")
                .replace(",", ".");
              const match = cleaned.match(/(\d+(\.\d+)?)/);
              numericOldPrice = match ? Number(match[1]) : null;
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

            if (fullName && price !== "N/A") {
              products.push({
                name: fullName,
                price,
                priceBeforeDiscount: numericOldPrice,
                store: "Maxi",
                category: "Drinks",
                image: imageUrl,
              });
            }
          });

        return products;
      });

      if (items.length === 0) break;

      // Store only unique items in map
      items.forEach((item) => {
        const key = `${item.name}-${item.price}`;
        if (!uniqueItemsMap.has(key)) {
          uniqueItemsMap.set(key, item);
        }
      });

      console.log(`Collected so far: ${uniqueItemsMap.size} unique products`);
      currentPage++;
    }

    const allItems = Array.from(uniqueItemsMap.values());
    console.log(`Total unique products: ${allItems.length}`);

    // Use your existing service function
    await saveProducts(allItems);

    await browser.close();
    return allItems;
  } catch (error: any) {
    console.error("Scraping error:", error.message);
    throw new Error("Failed to scrape data");
  }
}

export default scrapeMaxi;
