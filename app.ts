import {Request, Response} from "express";
import { Prisma, PrismaClient} from "@prisma/client";
const prisma = new PrismaClient();
import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import { createHash } from "node:crypto";
import { scrapeMultipleCategories } from "./scrapers/ideaScraper";
import scrapeMaxi from './scrapers/maxiScraper';
import { saveProducts } from './productService';
import scrapeDisProducts from "./scrapers/disScraper";
import { clearDatabase } from './clearDb';
import searchRoute from './searchLogic';
import {
  getProductMatches,
  getMatchCategoryMeta,
} from "./testMatching";
import { addDiscountFields } from "./utils/addDiscountFields";
import {
  pricedProductWhere,
  hasAtLeastOnePricedProduct,
} from "./utils/pricedProductFilter";
import {
  getScrapeRuns,
  getScrapeStatus,
  initScrapeSchedule,
  runAllCompleteScrapers,
} from "./scrapeOrchestrator";
import { normalizeReceiptScannedUrl } from "./utils/receiptQrUrl";

const app = express();
app.use(cors());
app.use(express.json());
initScrapeSchedule();



app.get("/", (req: Request, res: Response) => {
  res.send("Backend is running!");
});

app.post("/api/receipt-scans", async (req: Request, res: Response) => {
  try {
    const scannedUrlRaw =
      typeof req.body?.scannedUrl === "string" ? req.body.scannedUrl.trim() : "";
    const userEmailRaw =
      typeof req.body?.userEmail === "string" ? req.body.userEmail.trim() : "";
    const cartItemsSnapshot =
      req.body?.cartItemsSnapshot !== undefined ? req.body.cartItemsSnapshot : null;
    const cartTotalRaw = req.body?.cartTotalSnapshot;
    const purchaseGroupIdRaw =
      typeof req.body?.purchaseGroupId === "string" ? req.body.purchaseGroupId.trim() : "";
    const purchaseGroupId =
      purchaseGroupIdRaw.length > 0 && purchaseGroupIdRaw.length <= 160
        ? purchaseGroupIdRaw
        : null;
    const checkoutStoreLabelRaw =
      typeof req.body?.checkoutStoreLabel === "string"
        ? req.body.checkoutStoreLabel.trim()
        : "";
    const checkoutStoreLabel =
      checkoutStoreLabelRaw.length > 0 && checkoutStoreLabelRaw.length <= 200
        ? checkoutStoreLabelRaw
        : null;

    if (!scannedUrlRaw) {
      res.status(400).json({ message: "scannedUrl is required" });
      return;
    }

    const normalizedUrl = normalizeReceiptScannedUrl(scannedUrlRaw);
    if (!normalizedUrl) {
      res.status(400).json({ message: "scannedUrl must be a valid http(s) URL" });
      return;
    }

    const scannedUrlHash = createHash("sha256")
      .update(normalizedUrl)
      .digest("hex");
    const userEmail = userEmailRaw !== "" ? userEmailRaw.toLowerCase() : null;
    const cartTotalSnapshot =
      Number.isFinite(Number(cartTotalRaw)) && Number(cartTotalRaw) >= 0
        ? Number(cartTotalRaw)
        : null;

    const duplicateMessage =
      "Ovaj račun je već evidentiran. Svaki račun može biti skeniran samo jednom.";

    const existingByHash = await prisma.receiptScan.findUnique({
      where: { scannedUrlHash },
      select: { id: true },
    });
    if (existingByHash) {
      res.status(409).json({
        message: duplicateMessage,
        code: "DUPLICATE_RECEIPT_SCAN",
      });
      return;
    }

    const saved = await prisma.receiptScan.create({
      data: {
        scannedUrl: normalizedUrl,
        scannedUrlHash,
        userEmail,
        cartItemsSnapshot,
        cartTotalSnapshot,
        status: "pending",
        purchaseGroupId,
        checkoutStoreLabel,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
    res.status(201).json(saved);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.status(409).json({
        message:
          "Ovaj račun je već evidentiran. Svaki račun može biti skeniran samo jednom.",
        code: "DUPLICATE_RECEIPT_SCAN",
      });
      return;
    }
    console.error("Error saving receipt scan:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/receipt-scans/latest", async (req: Request, res: Response) => {
  try {
    const userEmailRaw =
      typeof req.query.userEmail === "string"
        ? req.query.userEmail.trim().toLowerCase()
        : "";
    if (!userEmailRaw) {
      res.status(400).json({ message: "userEmail query is required" });
      return;
    }
    const latest = await prisma.receiptScan.findFirst({
      where: { userEmail: userEmailRaw },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        confirmedAt: true,
      },
    });
    res.json(latest);
  } catch (error) {
    console.error("Error loading latest receipt status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/receipt-scans/history", async (req: Request, res: Response) => {
  try {
    const userEmailRaw =
      typeof req.query.userEmail === "string"
        ? req.query.userEmail.trim().toLowerCase()
        : "";
    if (!userEmailRaw) {
      res.status(400).json({ message: "userEmail query is required" });
      return;
    }
    const rows = await prisma.receiptScan.findMany({
      where: { userEmail: userEmailRaw },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        status: true,
        confirmedAt: true,
        cartTotalSnapshot: true,
        cartItemsSnapshot: true,
        itemConfirmations: true,
        purchaseGroupId: true,
        checkoutStoreLabel: true,
      },
    });
    const payload = rows.map((row) => {
      const raw = row.cartItemsSnapshot;
      const itemCount = Array.isArray(raw) ? raw.length : 0;
      const cartItems = Array.isArray(raw)
        ? raw.map((it: unknown) => {
            const r = it as Record<string, unknown>;
            return {
              name: typeof r?.name === "string" ? r.name : "Proizvod",
              quantity: Math.max(1, Math.floor(Number(r?.quantity ?? 1))),
              productId: String(r?.productId ?? ""),
            };
          })
        : [];

      const icRaw = row.itemConfirmations;
      let itemConfirmations: Array<{
        id: string;
        productId: string;
        name: string;
        expectedQuantity: number;
        confirmed: boolean;
      }> | null = null;
      if (Array.isArray(icRaw) && icRaw.length > 0) {
        itemConfirmations = icRaw
          .filter(
            (x): boolean =>
              typeof x === "object" && x !== null && !Array.isArray(x),
          )
          .map((e) => {
            const rec = e as Record<string, unknown>;
            return {
              id: String(rec.id ?? ""),
              productId: String(rec.productId ?? ""),
              name: String(rec.name ?? ""),
              expectedQuantity: Math.max(
                1,
                Math.floor(Number(rec.expectedQuantity ?? 1)),
              ),
              confirmed: Boolean(rec.confirmed),
            };
          })
          .filter((e) => e.name.trim() !== "");
        if (itemConfirmations.length === 0) itemConfirmations = null;
      }

      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
        cartTotalSnapshot:
          row.cartTotalSnapshot != null ? Number(row.cartTotalSnapshot) : null,
        itemCount,
        cartItems,
        itemConfirmations,
        purchaseGroupId: row.purchaseGroupId ?? null,
        checkoutStoreLabel: row.checkoutStoreLabel ?? null,
      };
    });
    res.json(payload);
  } catch (error) {
    console.error("Error loading receipt purchase history:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/admin/receipt-scans", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.receiptScan.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        scannedUrl: true,
        userEmail: true,
        status: true,
        cartItemsSnapshot: true,
        cartTotalSnapshot: true,
        itemConfirmations: true,
        confirmedBy: true,
        confirmedAt: true,
        createdAt: true,
        purchaseGroupId: true,
        checkoutStoreLabel: true,
      },
    });
    res.json(rows);
  } catch (error) {
    console.error("Error loading admin receipt scans:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.patch("/api/admin/receipt-scans/:id/confirm", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ message: "Invalid receipt scan id" });
      return;
    }
    const confirmedByRaw =
      typeof req.body?.confirmedBy === "string" ? req.body.confirmedBy.trim() : "";
    const confirmedBy = confirmedByRaw || "admin";
    const itemConfirmationsRaw = req.body?.itemConfirmations;
    if (!Array.isArray(itemConfirmationsRaw)) {
      res.status(400).json({ message: "itemConfirmations must be an array" });
      return;
    }
    const itemConfirmations = itemConfirmationsRaw
      .filter((entry) => typeof entry === "object" && entry !== null)
      .map((entry) => {
        const e = entry as Record<string, unknown>;
        return {
          id: String(e.id ?? ""),
          productId: String(e.productId ?? ""),
          name: String(e.name ?? ""),
          expectedQuantity: Math.max(1, Math.floor(Number(e.expectedQuantity ?? 1))),
          confirmed: Boolean(e.confirmed),
        };
      })
      .filter((entry) => entry.id !== "" && entry.productId !== "" && entry.name !== "");

    if (itemConfirmations.length === 0) {
      res.status(400).json({ message: "itemConfirmations must include at least one item" });
      return;
    }
    if (!itemConfirmations.some((entry) => entry.confirmed)) {
      res.status(400).json({
        message: "At least one item must be confirmed before confirming the receipt",
      });
      return;
    }

    const updated = await prisma.receiptScan.update({
      where: { id },
      data: {
        status: "confirmed",
        itemConfirmations,
        confirmedBy,
        confirmedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        confirmedAt: true,
      },
    });
    res.json(updated);
  } catch (error) {
    console.error("Error confirming receipt scan:", error);
    res.status(500).json({ message: "Internal server error" });
  }
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

      const { created, updated, priceCleared, totalInDb } =
        await saveProducts(scrapedProducts);

      res.json({
          success: true,
          message: "Scraping and DB sync complete.",
          totalScraped: scrapedProducts.length,
          addedNew: created,
          updatedExisting: updated,
          priceCleared,
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

app.get("/api/scraping/status", async (_req: Request, res: Response) => {
  res.json(getScrapeStatus());
});

app.get("/api/scraping/runs", async (_req: Request, res: Response) => {
  try {
    const runs = await getScrapeRuns();
    res.json({ runs });
  } catch (error) {
    console.error("Failed to load scraping runs:", error);
    res.status(500).json({ error: "Failed to load scraping runs" });
  }
});

app.post("/api/scraping/run-now", async (_req: Request, res: Response) => {
  try {
    const result = await runAllCompleteScrapers("manual");
    if (!result.ok) {
      res.status(409).json({ success: false, message: result.reason });
      return;
    }
    res.json({ success: true, run: result.run });
  } catch (error) {
    console.error("Manual scrape run failed:", error);
    res.status(500).json({ success: false, message: "Manual run failed" });
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

function parseOptionalCategoryQuery(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t === "" ? undefined : t;
}

app.get("/matches/meta", async (_req, res) => {
  try {
    const meta = await getMatchCategoryMeta();
    res.json(meta);
  } catch (error) {
    console.error("Error getting match category meta:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/matches", async (req, res) => {
  try {
    const standardizedMainCategory = parseOptionalCategoryQuery(
      req.query.standardizedMainCategory,
    );
    const productCategory = parseOptionalCategoryQuery(
      req.query.productCategory,
    );

    const matches = await getProductMatches({
      standardizedMainCategory,
      productCategory,
    });
    res.json(matches);
  } catch (error) {
    console.error("Error getting matches:", error);
    res.status(500).json({ error: "Internal Server Error" });
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
        AND: [
          {
            mainCategory: {
              equals: category,
              mode: "insensitive",
            },
          },
          hasAtLeastOnePricedProduct,
        ],
      },
      include: {
        products: {
          where: pricedProductWhere,
          orderBy: { price: "asc" },
        },
      },
    });

    if (products.length === 0) {
      res.status(404).json({ message: "No products found for this category" });
      return;
    }

    const result = addDiscountFields(products);

    // ✅ DEBUG LOG
    console.log(
      "DEBUG PRODUCT:",
      result?.[0]?.products?.[0]
    );

    res.json(result);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2️⃣ Route for midCategory within main category
app.get("/api/products/:category/:midCategory", async (req: Request, res: Response): Promise<void> => {
  const { category, midCategory } = req.params;

  try {
    const products = await prisma.standardizedProduct.findMany({
      where: {
        AND: [
          {
            mainCategory: {
              equals: category,
              mode: "insensitive",
            },
            midCategory: {
              equals: midCategory,
              mode: "insensitive",
            },
          },
          hasAtLeastOnePricedProduct,
        ],
      },
      include: {
        products: {
          where: pricedProductWhere,
          orderBy: { price: "asc" },
        },
      },
    });

    if (products.length === 0) {
      res.status(404).json({ message: "No products found for this subcategory" });
      return;
    }

    res.json(addDiscountFields(products));
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get(
  "/api/products/:category/:midCategory/:subCategory",
  async (req: Request, res: Response): Promise<void> => {
    const { category, midCategory, subCategory } = req.params;

    try {
      const products = await prisma.standardizedProduct.findMany({
        where: {
          AND: [
            {
              mainCategory: {
                equals: category,
                mode: "insensitive",
              },
              midCategory: {
                equals: midCategory,
                mode: "insensitive",
              },
              subCategory: {
                equals: subCategory,
                mode: "insensitive",
              },
            },
            hasAtLeastOnePricedProduct,
          ],
        },
        include: {
          products: {
            where: pricedProductWhere,
            orderBy: { price: "asc" },
          },
        },
      });

      if (products.length === 0) {
        res
          .status(404)
          .json({ message: "No products found for this subcategory" });
        return;
      }

      res.json(addDiscountFields(products));
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);


app.use('/api/search', searchRoute);


const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on Port ${PORT}`));
