import {Request, Response} from "express";
import { PrismaClient} from "@prisma/client";
const prisma = new PrismaClient();
import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import { scrapeMultipleCategories } from "./scrapers/ideaScraper";
import scrapeMaxi from './scrapers/maxiScraper';
import saveProducts from './productService';
import scrapeDisProducts from "./scrapers/disScraper";
import { clearDatabase } from './clearDb';
import searchRoute from './searchLogic';
import { getProductMatches } from "./testMatching";



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

app.get('/matches', async (req, res) => {
  try {
    const matches = await getProductMatches();
    res.json(matches);
  } catch (error) {
    console.error('Error getting matches:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/confirm-match', async (req, res) => {
  const { productId, standardizedProductId } = req.body;
  if (!productId || !standardizedProductId) {
    res.status(400).json({ error: 'Missing productId or standardizedProductId' });
    return;
  }

  try {
    await prisma.product.update({ where:{id:productId}, data:{standardizedProductId} });
    // no return of res.json here:
    res.json({ message: 'Match confirmed.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get("/api/products/:category", async (req: Request, res: Response): Promise<void> => {
  const { category } = req.params;

  try {
    const products = await prisma.standardizedProduct.findMany({
  where: {
    mainCategory: {
      equals: category,
      mode: "insensitive",
    },
  },
  include: {
    products: {
      orderBy: {
        price: 'asc',
      },
    },
  },
});

    if (products.length === 0) {
      res.status(404).json({ message: "No products found for this category" });
      return;
    }

    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.use('/api/search', searchRoute);


const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on Port ${PORT}`));
