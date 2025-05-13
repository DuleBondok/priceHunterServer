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
import { clearDatabase } from './clearDb';



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

app.delete('/api/clear-db', async (req, res) => {
  try {
    await clearDatabase();
    console.log('✅ Database cleared successfully');
    res.status(200).json({ success: true, message: 'Database cleared' });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('❌ Error clearing database:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/api/search', async (req: Request, res: Response): Promise<void> => {
  const query = req.query.query as string;

  console.log("Received search query:", query);  // Log the incoming query parameter

  if (!query || typeof query !== 'string' || query.trim() === '') {
    console.error("Invalid query:", query);  // Log when query is invalid
    res.status(400).json({ error: 'Missing or invalid query' });
    return;
  }

  try {
    console.log("Searching for products with normalizedName containing:", query);  // Log before DB query

    const distinctNames = await prisma.product.findMany({
      where: {
        normalizedName: {
          contains: query.toLowerCase(),
          mode: 'insensitive',
        },
      },
      select: {
        normalizedName: true,
      },
      distinct: ['normalizedName'],
    });

    console.log("Found distinct names:", distinctNames);  // Log the distinct names found

    const results = await Promise.all(
      distinctNames.map(({ normalizedName }) =>
        prisma.product.findFirst({
          where: { normalizedName },
          orderBy: { price: 'asc' },
        })
      )
    );

    console.log("Final search results:", results);  // Log the final results

    res.status(200).json(results.filter(Boolean));
  } catch (err: any) {
    console.error("Error during search:", err);  // Log any error that occurs
    res.status(500).json({ error: 'Something went wrong' });
  }
});



const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on Port ${PORT}`));
