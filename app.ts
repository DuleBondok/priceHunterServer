import {Request, Response} from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import { scrapeMultipleCategories } from "./scrapers/ideaScraper";
import scrapeMaxi from './scrapers/maxiScraper';
import saveProducts from './productService';
import scrapeDisProducts from "./scrapers/disScraper";



const app = express();
app.use(cors());
app.use(express.json());



app.get("/", (req: Request, res: Response) => {
  res.send("Backend is running!");
});

let isScraping = false;

app.get('/api/scrape-idea', async (req: Request, res: Response): Promise<void> => {
  if (isScraping) {
      console.log('Scraping is already in progress. Please wait...');
      res.status(400).json({ success: false, message: 'Scraping is already in progress' });
      return;
  }

  isScraping = true;

  try {
      console.log('🔍 Starting the IDEA scrape...');
      const scrapedProducts = await scrapeMultipleCategories();

      if (!scrapedProducts || scrapedProducts.length === 0) {
          console.warn("⚠️ No products scraped. Aborting.");
          res.status(400).json({ success: false, message: "No products scraped" });
          return;
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
  } catch (error: unknown) {
      console.error('❌ Scraping error:', error);
      const err = error as Error;
      res.status(500).json({ success: false, error: err.message });
  } finally {
      isScraping = false;
      await prisma.$disconnect();
  }
});



app.get("/api/scrape-maxi", async (req: Request, res: Response) => {
  try {
    const products = await scrapeMaxi(); 
    res.json(products);
  } catch (error) {
    res.status(500).send("Failed to scrape Maxi data");
  }
});

app.get("/api/scrape-dis", async (req: Request, res:Response) => {
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
