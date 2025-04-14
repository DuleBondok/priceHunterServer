const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const { scrapeMultipleCategories } = require("./scrapers/ideaScraper");

const app = express();
app.use(cors());
app.use(express.json());

async function saveProduct(productData) {
  try {
    // Check if product already exists
    const existingProduct = await prisma.product.findUnique({
      where: { name: productData.name }, // or use another unique field
    });

    if (existingProduct) {
      console.log(`Product already exists: ${productData.name}`);
      return;
    }

    // Save the new product
    const savedProduct = await prisma.product.create({
      data: {
        name: productData.name,
        price: productData.price,
        store: productData.store,
        category: productData.category,
        image: productData.image,
      },
    });
    console.log("Product saved:", savedProduct);
  } catch (error) {
    console.error("Error saving product:", error);
  }
}

app.get('/api/scrape-idea', async (req, res) => {
  try {
    console.log('Starting the scrape...');
    const products = await scrapeMultipleCategories();  // Trigger scraping here
    res.status(200).json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/", (req, res) => {
  res.send("Backend is running!");
});


app.get("/api/scrape-maxi", async (req, res) => {
  try {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    let currentPage = 1;
    const uniqueItemsMap = new Map();

    while (true) {
      const url = `https://www.maxi.rs/Mlechni-proizvodi-i-jaja/c/02?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;
      console.log(`Scraping page ${currentPage}: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });

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
          const imageUrl = imageEl ? imageEl.getAttribute("src") : '';
          console.log("Image URL:", imageUrl); // Log the image URL

          // If the image URL is relative, prepend the base URL
          if (imageUrl && !imageUrl.startsWith('http')) {
              imageUrl = `https://www.maxi.rs${imageUrl}`;
          }
      
          if (fullName) {
            products.push({
              name: fullName,
              price,
              store: "Maxi",
              category: "Milk and egg products",
              image: imageUrl
            });
          }
        });
      
        return products;
      });

      if (items.length === 0) break; // no more products = stop

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

    // Now save each unique product
    for (const product of allItems) {
      await saveProduct({
        name: product.name,
        price: product.price,
        store: "Maxi", // You can change this based on the store you're scraping
        category: "Milk and Dairy", // Set the appropriate category
        image: product.image,
      });
    }

    await browser.close();
    res.json(allItems);
  } catch (error) {
    console.error("Scraping error:", error.message);
    res.status(500).send("Failed to scrape data");
  }
});


const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on Port ${PORT}`));
