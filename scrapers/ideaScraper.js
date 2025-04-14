const puppeteer = require('puppeteer');

// Function to scrape products from a specific URL
async function scrapeProducts(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  let allProducts = [];
  let pageNum = 1;
  let hasProducts = true;
  let previousProductsCount = 0;  // Track the number of products from the previous page
  const MAX_PAGES = 10;  // Set a max number of pages to scrape to prevent infinite loop

  while (hasProducts && pageNum <= MAX_PAGES) {
    const currentUrl = `${url}?page=${pageNum}`;
    console.log(`Scraping page: ${currentUrl}`);

    try {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for the products to appear on the page
      await page.waitForSelector('.inner-proizvod', { visible: true });

      // Extract product details (title, price, and image URL)
      const products = await page.evaluate(() => {
        const data = [];
        const productElements = document.querySelectorAll('.inner-proizvod');

        productElements.forEach(el => {
          const titleElement = el.querySelector('.ime-proizvoda a');
          const priceElement = el.querySelector('.cijena');
          const imageElement = el.querySelector('.image img');

          const title = titleElement ? titleElement.innerText.trim() : null;
          const price = priceElement ? priceElement.innerText.trim().replace(/\s+/g, ' ') : null;
          const imageUrl = imageElement ? imageElement.getAttribute('ng-src') : null;

          if (title && price && imageUrl) {
            data.push({ title, price, imageUrl });
          }
        });

        return data;
      });



      if (products.length === 0) {
        console.log(`No products found on page ${pageNum}. Stopping...`);
        hasProducts = false;
      } else {

        if (products.length === previousProductsCount) {
          console.log(`No new products found on page ${pageNum}. Stopping...`);
          hasProducts = false;
        } else {
          allProducts.push(...products);
          previousProductsCount = products.length;
          pageNum++;
        }
      }

    } catch (error) {
      console.error(`Error scraping page ${currentUrl}:`, error);
      hasProducts = false;  // Stop if any error occurs
    }
  }

  await browser.close();
  return allProducts;
}

// Function to scrape multiple categories
async function scrapeMultipleCategories() {
  const urls = [
    'https://online.idea.rs/#!/categories/60016184/cokoladno-mleko/products',
    'https://online.idea.rs/#!/categories/60016182/sveze-mleko/products',
    'https://online.idea.rs/#!/categories/60016183/dugotrajno-mleko/products',
    'https://online.idea.rs/#!/categories/60007827/jaja/products',
    'https://online.idea.rs/#!/categories/60007828/jogurt/products',
    'https://online.idea.rs/#!/categories/60014764/kisela-pavlaka/products',
    'https://online.idea.rs/#!/categories/60025727/kiselo-mleko/products',
    'https://online.idea.rs/#!/categories/60014766/slatka-pavlaka/products',
    'https://online.idea.rs/#!/categories/60014765/pavlaka-za-kuvanje-i-kafu/products',
  ];

  const allProducts = [];

  for (const url of urls) {
    const products = await scrapeProducts(url);
    allProducts.push(...products);
  }

  console.log(`Total products from all categories: ${allProducts.length}`);
  return allProducts;
}

module.exports = { scrapeProducts, scrapeMultipleCategories };