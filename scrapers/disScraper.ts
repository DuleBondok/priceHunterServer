import puppeteer, { Browser, Page } from "puppeteer";
import saveProducts, { createProduct } from '../productService';

interface Product {
  name: string;
  normalizedName: string;
  price: string;
  image: string | null;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD') // Decompose accented characters like č → c
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s,\.l%]/g, '') 
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}

async function scrapeDisProducts(
  url: string = "https://www.dis.rs/pretraga?type=artikli&query="
): Promise<Product[]> {
  const browser: Browser = await puppeteer.launch({ headless: true });
  const page: Page = await browser.newPage();

  try {
    page.setDefaultTimeout(15000);
    
    await page.goto(url, { waitUntil: "networkidle2" });

    console.log("Selecting category...");
    await page.waitForSelector("select");
    
    await page.evaluate(() => {
      const select = document.querySelector("select") as HTMLSelectElement;
      if(select) {
        select.selectedIndex = -1;
      }
    });
    
    await page.select('select', 'C1');
    
    console.log("Waiting for category filter to apply...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
      page.waitForFunction(() => {
        const loading = document.querySelector('.loading-spinner, [class*="loading"], [class*="spinner"]') as HTMLSelectElement;
        return !loading || loading.style.display === 'none';
      }, { timeout: 10000 }),
      page.waitForSelector('div.px-4.md\\:px-8.xl\\:px-16.py-10', { timeout: 10000 })
    ]);
    
    await new Promise(resolve => setTimeout(resolve, 1000));

    let allProducts: Product[] = [];
    let pageNum = 1;
    let previousPageProducts: Product[] | null = null;
    const maxPages = 50;

    while (pageNum <= maxPages) {
      try {
        console.log(`Scraping page ${pageNum}...`);
        
        await page.waitForSelector('a[href ^="/artikli/"]', { timeout: 5000 });
        
        const currentProducts: Product[] = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href ^="/artikli/"]')).map(item => {
            const name = item.querySelector("p.font-bold.text-black")?.textContent?.trim() || '';
            const price = item.querySelector("p[class*='text-']")?.textContent?.trim() || 'N/A';
            const image = item.querySelector("img")?.getAttribute("srcset") || null;

            return { 
              name, 
              normalizedName: '', // Placeholder, will be filled below
              price, 
              image 
            };
          }).filter(product => product.name);
        });

        // Add normalized names to products
        currentProducts.forEach(product => {
          product.normalizedName = normalizeName(product.name);
        });

        if (pageNum === 1 && currentProducts.length === 0) {
          console.log("Warning: No products found after filtering - check category selection");
        }

        if (previousPageProducts && JSON.stringify(currentProducts) === JSON.stringify(previousPageProducts)) {
          console.log("Duplicate products detected - reached end of pagination");
          break;
        }

        allProducts = [...allProducts, ...currentProducts];
        console.log(`Found ${currentProducts.length} filtered products on page ${pageNum}`);
        previousPageProducts = currentProducts;

        // Log the product data before passing it to saveProducts
        console.log("Saving the following product data:", currentProducts);

        const productData = currentProducts.map((product) => ({
          name: product.name,
          normalizedName: product.normalizedName,
          price: product.price,
          image: product.image || '',
          store: 'DIS',
          category: 'Milk and egg products',
        }));

        // Check if productData has data
        console.log(`Data prepared for saving:`, productData);

        const saveResult = await saveProducts(productData);
        console.log(`Saved products on page ${pageNum}:`, saveResult);

        const nextButtons = await page.$$('button.flex.flex-row.items-center');
        if (nextButtons.length < 2) {
          console.log("No more pagination buttons found - stopping");
          break;
        }

        const lastButton = nextButtons[nextButtons.length - 1];
        const isDisabled = await page.evaluate((button: HTMLButtonElement) => {
          return button.disabled || 
                 button.classList.contains('cursor-default') || 
                 button.querySelector('p')?.classList.contains('opacity-50');
        }, lastButton as unknown as HTMLButtonElement);

        if (isDisabled) {
          console.log("Next button is disabled - reached last page");
          break;
        }

        console.log("Moving to next page...");
        await Promise.all([
          lastButton.click(),
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {}),
          page.waitForSelector('div.px-4.md\\:px-8.xl\\:px-16.py-10', { timeout: 10000 })
        ]);
        
        pageNum++;
      } catch (error) {
        console.error(`Error on page ${pageNum}:`, error);
        break;
      }
    }

    await browser.close();
    console.log(`Scraping complete. Total pages: ${pageNum}, Total products: ${allProducts.length}`);
    return allProducts;
  } catch (err) {
    console.error("Scraping failed:", err);
    await browser.close();
    return [];
  }
}

export default scrapeDisProducts;