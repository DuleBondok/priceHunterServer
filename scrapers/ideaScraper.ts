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
    penusavo vino, brasno */


import { launchBrowser } from "./puppeteerBrowser";
import { parseIdeaStaraCijenaRsd } from "./ideaStaraCijenaParse";

interface Product {
  name: string;
  priceBeforeDiscount?: number | null;
  price: string | null;
  image: string;
  store: string;
  category: string;
  requiresLoyaltyCard?: boolean;
  offerEndsOn?: string | null;
}

export async function scrapeIdeaProducts(urls: string[]): Promise<Product[]> {
  const browser = await launchBrowser();
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

      type IdeaRow = {
        name: string;
        price: string | null;
        oldPriceRaw: string | null;
        image: string;
        store: string;
        category: string;
        requiresLoyaltyCard: boolean;
        offerEndsOn: string | null;
      };

      const rows: IdeaRow[] = await page.evaluate(() => {
        function isIdeaMpcOffer(el: Element): boolean {
          const akcija = el.querySelector(".akcija.text-center");
          const bg = el.querySelector(".akcija-background");
          return !!(
            akcija?.classList.contains("mpc") ||
            akcija?.classList.contains("mpc2") ||
            bg?.classList.contains("mpc-background") ||
            bg?.classList.contains("mpc2-background")
          );
        }

        function getIdeaOfferEndDate(el: Element): string | null {
          const span = el.querySelector(
            ".trajanje-akcije span[ng-switch-when='true']",
          );
          if (!span) return null;
          const text = span.textContent?.trim() ?? "";
          const match = text.match(/(\d{2}\.\d{2}\.\d{4})/);
          return match ? match[1] : null;
        }

        const data: IdeaRow[] = [];

        const productElements = document.querySelectorAll(".proizvod");

        productElements.forEach((el) => {
          const titleElement = el.querySelector(".ime-proizvoda a");

          const priceBeforeDiscountElement = el.querySelector(
            ".akcija-wrapper .stara-cijena"
          );

          const priceElement = el.querySelector(".cijena");
          const imageElement = el.querySelector(".image img");

          const title = titleElement?.textContent?.trim() ?? "";

          const raw =
            priceElement?.textContent?.trim().replace(/\s+/g, " ") ?? "";

          let price: string | null = null;
          if (raw) {
            const cleaned = raw.replace(" din/kom", "");
            const numericPrice = parseFloat(cleaned.replace(/\D/g, "")) / 100;
            if (Number.isFinite(numericPrice)) {
              price = `${numericPrice.toFixed(2)} RSD`;
            }
          }

          const oldPriceRaw =
            priceBeforeDiscountElement?.textContent?.trim() || null;

          const image = imageElement?.getAttribute("ng-src") ?? "";
          const mpcOffer = isIdeaMpcOffer(el);
          const offerEndsOn = getIdeaOfferEndDate(el);

          if (title && image) {
            data.push({
              name: title,
              price,
              oldPriceRaw,
              image,
              store: "Idea",
              category: "Frozen products",
              requiresLoyaltyCard: mpcOffer,
              offerEndsOn,
            });
          }
        });

        return data;
      });

      const products: Product[] = rows.map(({ oldPriceRaw, ...rest }) => ({
        ...rest,
        priceBeforeDiscount: parseIdeaStaraCijenaRsd(oldPriceRaw),
      }));

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
      "https://online.idea.rs/#!/categories/60007908/smrznuta-pizza-i-gotova-jela/products?page=1"
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