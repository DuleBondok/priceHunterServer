const puppeteer = require('puppeteer');
const prisma = require('../prismaClient');  // Import Prisma instance directly

// Function to save the products to the database (specifically for Maxi scraper)
async function saveProduct(productData) {
    try {
      // Check if the product already exists
      const existingProduct = await prisma.product.findUnique({
        where: {
          name_store: {
            name: productData.name,
            store: productData.store,
          }
        }
      });
  
      if (existingProduct) {
        // If the product exists, you can update it if needed
        console.log('Product already exists, updating...');
        await prisma.product.update({
            where: {
              name_store: {
                name: productData.name,
                store: productData.store
              }
            },
          data: {
            price: productData.price, // Example field to update
            // Update other fields as needed
          }
        });
      } else {
        // If the product doesn't exist, create it
        console.log('Creating new product...');
        await prisma.product.create({
          data: productData
        });
      }
    } catch (error) {
      console.error('Error creating or updating product:', error);
    }
  }

async function scrapeMaxi() {
  try {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    let currentPage = 1;
    const uniqueItemsMap = new Map();

    while (true) {
      const url = `https://www.maxi.rs/Mlechni-proizvodi-i-jaja/c/02?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;
      console.log(`Scraping page ${currentPage}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const items = await page.evaluate(() => {
        const products = [];

        document.querySelectorAll('[data-testid="product-tile-footer"]').forEach((footer) => {
          const tile = footer.closest('[data-testid="product-tile-footer"]')?.parentElement;
          const nameLink = tile?.querySelector('[data-testid="product-block-name-link"]');
          const brand = nameLink?.querySelector('[data-testid="product-brand"]')?.innerText.trim() || '';
          const name = nameLink?.querySelector('[data-testid="product-name"]')?.innerText.trim() || '';
          const fullName = `${brand} ${name}`.trim();

          const priceContainer = tile?.querySelector('[data-testid="product-block-price"]');
          const whole = priceContainer?.querySelector('.sc-dqia0p-9')?.innerText.trim() || '';
          const decimal = priceContainer?.querySelector('.sc-dqia0p-10')?.innerText.trim() || '';
          const currency = priceContainer?.querySelector('.sc-dqia0p-8')?.innerText.trim() || '';

          const price = whole ? `${whole}.${decimal} ${currency}` : 'N/A';

          const imageEl = tile?.querySelector('img[data-testid="product-block-image"]');
          let imageUrl = imageEl ? imageEl.getAttribute("src") : '';

          if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = `https://www.maxi.rs${imageUrl}`;
          }

          if (fullName) {
            products.push({
              name: fullName,
              price,
              store: "Maxi",
              category: "Milk and egg products", // Align category
              image: imageUrl
            });
          }
        });

        return products;
      });

      if (items.length === 0) break;

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
    const totalProducts = allItems.length;

    console.log(`Total unique products: ${totalProducts}`);

    // Save the products to the database (using the new saveProduct function)
    for (const product of allItems) {
      await saveProduct({
        name: product.name,
        price: product.price,
        store: "Maxi",
        category: "Milk and egg products",  // Align category
        image: product.image,
      });
    }

    await browser.close();
    return allItems;
  } catch (error) {
    console.error('Scraping error:', error.message);
    throw new Error('Failed to scrape data');
  }
}

module.exports = scrapeMaxi;