const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const { scrapeMultipleCategories } = require("./scrapers/ideaScraper");
const scrapeMaxi = require('./scrapers/maxiScraper');
const { saveProducts } = require('./productService');
const scrapeDisProducts = require('./scrapers/disScraper');


const app = express();
app.use(cors());
app.use(express.json());



app.get("/", (req, res) => {
  res.send("Backend is running!");
});

let isScraping = false;

app.get('/api/scrape-idea', async (req, res) => {
    if (isScraping) {
        console.log('Scraping is already in progress. Please wait...');
        return res.status(400).json({ success: false, message: 'Scraping is already in progress' });
    }

    isScraping = true;  // Set to true when scraping starts

    try {
        console.log('🔍 Starting the IDEA scrape...');
        const scrapedProducts = await scrapeMultipleCategories();

        if (!scrapedProducts || scrapedProducts.length === 0) {
            console.warn("⚠️ No products scraped. Aborting.");
            return res.status(400).json({ success: false, message: "No products scraped" });
        }

        const { created, updated, totalInDb } = await saveProducts(scrapedProducts);

        res.json({
            success: true,
            message: "Scraping and DB sync complete.",
            totalScraped: scrapedProducts.length,
            addedNew: created,
            updatedExisting: updated,
            totalInDatabase: totalInDb
        });
    } catch (error) {
        console.error('❌ Scraping error:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        isScraping = false;  // Set back to false when done
        await prisma.$disconnect();
    }
});



app.get("/api/scrape-maxi", async (req, res) => {
  try {
    const products = await scrapeMaxi(); 
    res.json(products);
  } catch (error) {
    res.status(500).send("Failed to scrape Maxi data");
  }
});

app.get("/api/scrape-dis", async (req, res) => {
  try {
      const products = await scrapeDisProducts();
      res.json(products); // Send products as JSON response
  } catch (error) {
      console.error("Error during scraping:", error);
      res.status(500).json({ error: "Scraping failed" });
  }
});


const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on Port ${PORT}`));
