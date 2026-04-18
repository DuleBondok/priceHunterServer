    /*"https://online.idea.rs/#!/categories/60016184/cokoladno-mleko/products",
    "https://online.idea.rs/#!/categories/60016182/sveze-mleko/products",
    "https://online.idea.rs/#!/categories/60016183/dugotrajno-mleko/products",
    "https://online.idea.rs/#!/categories/60007827/jaja/products",
    "https://online.idea.rs/#!/categories/60007828/jogurt/products",
    "https://online.idea.rs/#!/categories/60014764/kisela-pavlaka/products",
    "https://online.idea.rs/#!/categories/60025727/kiselo-mleko/products",
    "https://online.idea.rs/#!/categories/60014766/slatka-pavlaka/products",
    "https://online.idea.rs/#!/categories/60014765/pavlaka-za-kuvanje-i-kafu/products",
    "https://online.idea.rs/#!/categories/60014675/biljni-napici/products",
    "https://online.idea.rs/#!/categories/60014577/gauda/products",
    "https://online.idea.rs/#!/categories/60014578/parmezan/products",
    "https://online.idea.rs/#!/categories/60014579/trapist/products",
    "https://online.idea.rs/#!/categories/60014593/ostalo/products",
    "https://online.idea.rs/#!/categories/60014580/biljni-sir/products",
    "https://online.idea.rs/#!/categories/60014581/mozzarella/products",
    "https://online.idea.rs/#!/categories/60014582/plesnjivi-sir/products",
    "https://online.idea.rs/#!/categories/60014583/feta/products",
    "https://online.idea.rs/#!/categories/60014584/mladi-sir/products",
    "https://online.idea.rs/#!/categories/60014585/sitan/products",
    "https://online.idea.rs/#!/categories/60014586/svezi/products",
    "https://online.idea.rs/#!/categories/60014587/kajmak/products",
    "https://online.idea.rs/#!/categories/60014588/mlecni-namazi/products",
    "https://online.idea.rs/#!/categories/60014590/sirni-namazi/products",
    "https://online.idea.rs/#!/categories/60014589/paprika-u-pavlaci/products",
    "https://online.idea.rs/#!/categories/60014591/listici/products",
    "https://online.idea.rs/#!/categories/60014592/trouglasti/products",
    "https://online.idea.rs/#!/categories/60007830/margarin-i-maslac/products",
    "https://online.idea.rs/#!/categories/60007829/majonez-i-prelivi/products",
    "https://online.idea.rs/#!/categories/60007831/mlecni-dezerti/products",
    "https://online.idea.rs/#!/categories/60013823/negazirana-voda/products",
    "https://online.idea.rs/#!/categories/60013822/gazirana-voda/products",
    "https://online.idea.rs/#!/categories/60013824/voda-sa-ukusom/products",
    "https://online.idea.rs/#!/categories/60013846/tradicionalna-kafa/products",
    "https://online.idea.rs/#!/categories/60013847/kapsule-i-espresso/products",
    "https://online.idea.rs/#!/categories/60013848/instant-kafa/products",
    "https://online.idea.rs/#!/categories/60013849/filter-kafa-i-dodaci-za-kafu/products",
    "https://online.idea.rs/#!/categories/60022082/gotove-kafe/products?",
    "https://online.idea.rs/#!/categories/60013860/biljni-caj/products",
    "https://online.idea.rs/#!/categories/60013861/vocni-caj/products",
    "https://online.idea.rs/#!/categories/60025734/mesavine/products",
    "https://online.idea.rs/#!/categories/60025735/ostalo/products",
    "https://online.idea.rs/#!/categories/60013825/gazirani-sokovi/products",
    "https://online.idea.rs/#!/categories/60013821/energetski-i-izotonicni-napici/products",
    "https://online.idea.rs/#!/categories/60013826/negazirani-sokovi/products"
    https://online.idea.rs/#!/categories/60013827/instant-sokovi/products?page=1
    svetlo pivo, sva piva, viski, dzin, vodka, likeri, brendi i konjak, tekila, rum, rakija, belo vino, crveno vino, roze vino, vocno vino
    penusavo vino */


import puppeteer from "puppeteer";

interface Product {
  name: string;
  priceBeforeDiscount?: number | null;
  price: string;
  image: string;
  store: string;
  category: string;
}

export async function scrapeIdeaProducts(urls: string[]): Promise<Product[]> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  let allProducts: Product[] = [];

  for (const currentUrl of urls) {
    console.log(`Scraping page: ${currentUrl}`);

    try {
      await page.goto(currentUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await page.waitForSelector(".inner-proizvod", { visible: true });

      const products: Product[] = await page.evaluate(() => {
        const data: Product[] = [];

        const productElements = document.querySelectorAll(".proizvod");

        productElements.forEach((el) => {
          const titleElement = el.querySelector(".ime-proizvoda a");

          const priceBeforeDiscountElement = el.querySelector(
            ".akcija-wrapper .stara-cijena"
          );

          const priceElement = el.querySelector(".cijena");
          const imageElement = el.querySelector(".image img");

          const title = titleElement?.textContent?.trim() ?? "";
          let price =
            priceElement?.textContent?.trim().replace(/\s+/g, " ") ?? "N/A";

          const oldText =
            priceBeforeDiscountElement?.textContent
              ?.trim()
              .replace(/\s+/g, " ") ?? null;

          const image = imageElement?.getAttribute("ng-src") ?? "";

          if (price !== "N/A") {
            price = price.replace(" din/kom", "");
            const numericPrice = parseFloat(price.replace(/\D/g, "")) / 100;
            price = `${numericPrice.toFixed(2)} RSD`;
          }

          let numericOldPrice: number | null = null;

          if (oldText) {
            const cleaned = oldText
              .replace("din/kom", "")
              .replace("din", "")
              .trim();

            const normalized = cleaned.replace(/\s+/g, "").replace(",", ".");
            const match = normalized.match(/(\d+(\.\d+)?)/);

            numericOldPrice = match ? Number(match[1]) : null;
          }

          if (title && price && image) {
            data.push({
              name: title,
              price,
              priceBeforeDiscount: numericOldPrice,
              image,
              store: "Idea",
              category: "Alcohol",
            });
          }
        });

        return data;
      });

      if (products.length === 0) {
        console.log(`No products found on page. Skipping...`);
        continue;
      }

      allProducts.push(...products);
    } catch (error) {
      console.error(`Error scraping page ${currentUrl}:`, error);
    }
  }

  await browser.close();
  return allProducts;
}

export async function scrapeMultipleCategories(): Promise<Product[]> {
  const urls: string[][] = [
    [
      "https://online.idea.rs/#!/categories/60023665/penusavo-vino/products?page=1"
    ]
  ];

  const allProducts: Product[] = [];
  const seenProducts = new Set<string>();

  for (const pageUrls of urls) {
    try {
      const products = await scrapeIdeaProducts(pageUrls);

      const uniqueProducts = products.filter((product) => {
        const key = `${product.name}-${product.price}`;
        if (!seenProducts.has(key)) {
          seenProducts.add(key);
          return true;
        }
        return false;
      });

      allProducts.push(...uniqueProducts);
      console.log(`Scraped ${uniqueProducts.length} unique products`);
    } catch (error) {
      console.error(`Error scraping category:`, error);
    }
  }

  console.log(`Total unique products from all categories: ${allProducts.length}`);
  return allProducts;
}

export default { scrapeIdeaProducts, scrapeMultipleCategories };