const puppeteer = require("puppeteer");

async function scrapeDisProducts(
  url = "https://www.dis.rs/pretraga?type=artikli&query="
) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(15000);
    
    // 1. NAVIGATE TO PAGE
    await page.goto(url, { waitUntil: "networkidle2" });

    // 2. IMMEDIATELY SELECT CATEGORY WITH PROPER WAITING
    console.log("Selecting category...");
    await page.waitForSelector("select");
    
    // Clear any existing selection first if needed
    await page.evaluate(() => {
      const select = document.querySelector("select");
      select.selectedIndex = -1;
    });
    
    await page.select('select', 'C1');
    
    // Wait for both network idle and content reload
    console.log("Waiting for category filter to apply...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
      page.waitForFunction(() => {
        const loading = document.querySelector('.loading-spinner, [class*="loading"], [class*="spinner"]');
        return !loading || loading.style.display === 'none';
      }, { timeout: 10000 }),
      page.waitForSelector('div.px-4.md\\:px-8.xl\\:px-16.py-10', { timeout: 10000 })
    ]);
    
    // Additional safety wait
    await new Promise(resolve => setTimeout(resolve, 1000));

    let allProducts = [];
    let pageNum = 1;
    let previousPageProducts = null;
    const maxPages = 50;

    // 3. SCRAPE PAGES
    while (pageNum <= maxPages) {
      try {
        console.log(`Scraping page ${pageNum}...`);
        
        await page.waitForSelector('a[href ^="/artikli/"]', { timeout: 5000 });
        
        const currentProducts = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href ^="/artikli/"]')).map(item => {
            return {
              name: item.querySelector("p.font-bold.text-black")?.innerText.trim(),
              price: item.querySelector("p[class*='text-']")?.innerText.trim() || "N/A",
              image: item.querySelector("img")?.getAttribute("srcset")
            };
          }).filter(product => product.name);
        });

        // Verify we're getting filtered products
        if (pageNum === 1 && currentProducts.length === 0) {
          console.log("Warning: No products found after filtering - check category selection");
        }

        // DUPLICATE DETECTION
        if (previousPageProducts && JSON.stringify(currentProducts) === JSON.stringify(previousPageProducts)) {
          console.log("Duplicate products detected - reached end of pagination");
          break;
        }

        allProducts = [...allProducts, ...currentProducts];
        console.log(`Found ${currentProducts.length} filtered products on page ${pageNum}`);
        previousPageProducts = currentProducts;

        // PAGINATION HANDLING
        const nextButtons = await page.$$('button.flex.flex-row.items-center');
        if (nextButtons.length < 2) {
          console.log("No more pagination buttons found - stopping");
          break;
        }

        const lastButton = nextButtons[nextButtons.length - 1];
        const isDisabled = await page.evaluate(button => {
          return button.disabled || 
                 button.classList.contains('cursor-default') || 
                 button.querySelector('p')?.classList.contains('opacity-50');
        }, lastButton);

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

module.exports = scrapeDisProducts;