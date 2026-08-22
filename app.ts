import "dotenv/config";
import {Request, Response} from "express";
import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";
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
  getNewProductMatches,
  getNewProductMatchCategoryMeta,
} from "./testMatching";
import { confirmNewProductMatch } from "./productService";
import {
  addCatalogBrand,
  confirmBrandPromote,
  deleteCatalogBrand,
  getBrandPromoteMeta,
  previewBrandPromote,
} from "./brandPromote";
import {
  blockListings,
  listBlockedProducts,
  searchProductsByName,
  unblockListing,
} from "./blockedProduct";
import {
  deleteProductById,
  getDuplicateStoreLinks,
  unlinkProductFromStandardized,
} from "./duplicateStoreLinks";
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
import {
  assertAdminAuthConfigured,
  requireAdmin,
} from "./adminAuth";
import { normalizeReceiptScannedUrl } from "./utils/receiptQrUrl";
import {
  confirmReceiptScan,
  ensureReceiptRewardsCatalog,
  rejectReceiptScan,
} from "./receiptRewards";
import multer from "multer";
import slugify from "slugify";
import axios from "axios";
import FormData from "form-data";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

assertAdminAuthConfigured();

function parseCorsOrigins(): boolean | string[] {
  const raw = (process.env.CORS_ORIGINS || "").trim();
  if (!raw) {
    // Dev: allow any. Prod default: admin + public site.
    if (process.env.NODE_ENV !== "production") return true;
    return [
      "https://admin.pricely.rs",
      "https://pricely.rs",
      "https://www.pricely.rs",
      "http://localhost:3000",
    ];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type ImageLogEntry = {
  productId: number;
  productName: string;
  brand: string | null;
  mainCategory: string | null;
  replacedAt: string;
  source: "manual" | "checked" | "brand";
};

type ImageReplacementLog = Record<string, ImageLogEntry>;

const IMAGE_LOG_PATH = resolve(__dirname, "scripts/imageReplacementLog.json");

function ensureImageLogFile(): void {
  const dir = dirname(IMAGE_LOG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(IMAGE_LOG_PATH)) {
    writeFileSync(IMAGE_LOG_PATH, "{}", "utf8");
  }
}

function readImageLog(): ImageReplacementLog {
  ensureImageLogFile();
  try {
    const raw = readFileSync(IMAGE_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ImageReplacementLog)
      : {};
  } catch {
    return {};
  }
}

function writeImageLog(log: ImageReplacementLog): void {
  ensureImageLogFile();
  writeFileSync(IMAGE_LOG_PATH, JSON.stringify(log, null, 2), "utf8");
}

function upsertImageLogEntry(entry: ImageLogEntry): void {
  const log = readImageLog();
  log[String(entry.productId)] = entry;
  writeImageLog(log);
}

function removeImageLogEntry(productId: number): void {
  const log = readImageLog();
  delete log[String(productId)];
  writeImageLog(log);
}

function buildImageLogEntry(
  product: {
    id: number;
    name: string;
    brand: string | null;
    mainCategory: string | null;
  },
  source: ImageLogEntry["source"],
): ImageLogEntry {
  return {
    productId: product.id,
    productName: product.name,
    brand: product.brand,
    mainCategory: product.mainCategory,
    replacedAt: new Date().toISOString(),
    source,
  };
}

function extractCfImageIdFromDeliveryUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const match = url.match(/imagedelivery\.net\/[^/]+\/([^/]+)\//i);
  return match?.[1] ?? null;
}

async function deleteCfImageIfExists(
  accountId: string,
  imagesToken: string,
  imageId: string,
): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${encodeURIComponent(imageId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${imagesToken}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    const json = (await res.json().catch(() => ({}))) as {
      errors?: { message?: string }[];
    };
    const detail =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `status ${res.status}`;
    console.warn(`Cloudflare delete skipped/failed for ${imageId}: ${detail}`);
  }
}

ensureImageLogFile();

const app = express();
app.use(
  cors({
    origin: parseCorsOrigins(),
  }),
);
app.use(express.json());
initScrapeSchedule();

// Admin / scrape / match — require ADMIN_API_TOKEN when configured
app.use("/api/admin", requireAdmin);
app.use("/api/scraping", requireAdmin);
app.use("/api/scrape-idea", requireAdmin);
app.use("/api/scrape-maxi", requireAdmin);
app.use("/api/scrape-dis", requireAdmin);
app.use("/api/clear-db", requireAdmin);
app.use("/matches", requireAdmin);
app.use("/confirm-match", requireAdmin);
app.use("/new-product-matches", requireAdmin);
app.use("/confirm-new-product-match", requireAdmin);

app.get("/", (req: Request, res: Response) => {
  res.send("Backend is running!");
});

app.post("/api/receipt-scans", async (req: Request, res: Response) => {
  try {
    const scannedUrlRaw =
      typeof req.body?.scannedUrl === "string" ? req.body.scannedUrl.trim() : "";
    const userEmailRaw =
      typeof req.body?.userEmail === "string" ? req.body.userEmail.trim() : "";
    const userIdRaw =
      typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const userId =
      userIdRaw.length > 0 && userIdRaw.length <= 80 ? userIdRaw : null;
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
        userId,
        cartItemsSnapshot,
        cartTotalSnapshot,
        status: "pending",
        purchaseGroupId,
        checkoutStoreLabel,
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
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
        userId: true,
        status: true,
        cartItemsSnapshot: true,
        cartTotalSnapshot: true,
        itemConfirmations: true,
        confirmedBy: true,
        confirmedAt: true,
        rejectedBy: true,
        rejectedAt: true,
        rejectionReason: true,
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

const imageManagerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.get("/api/admin/image-manager/log", async (_req: Request, res: Response) => {
  try {
    res.json({ log: readImageLog() });
  } catch (error) {
    console.error("Error reading image replacement log:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/admin/image-manager/categories", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.standardizedProduct.findMany({
      where: { mainCategory: { not: null } },
      select: { mainCategory: true },
      distinct: ["mainCategory"],
      orderBy: { mainCategory: "asc" },
    });
    const categories = rows
      .map((r) => r.mainCategory)
      .filter((c): c is string => Boolean(c && c.trim()));
    res.json({ categories });
  } catch (error) {
    console.error("Error loading image manager categories:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/admin/image-manager/brands", async (req: Request, res: Response) => {
  try {
    const category =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    if (!category) {
      res.status(400).json({ message: "category query param is required" });
      return;
    }

    const products = await prisma.standardizedProduct.findMany({
      where: {
        mainCategory: category,
        brand: { not: null },
      },
      select: { id: true, brand: true },
      orderBy: { brand: "asc" },
    });

    const log = readImageLog();
    const brandStats: Record<
      string,
      { total: number; logged: number; allBrandSource: boolean }
    > = {};

    for (const product of products) {
      if (!product.brand?.trim()) continue;
      const brand = product.brand;
      if (!brandStats[brand]) {
        brandStats[brand] = { total: 0, logged: 0, allBrandSource: true };
      }
      brandStats[brand].total += 1;
      const entry = log[String(product.id)];
      if (entry) {
        brandStats[brand].logged += 1;
        if (entry.source !== "brand") {
          brandStats[brand].allBrandSource = false;
        }
      } else {
        brandStats[brand].allBrandSource = false;
      }
    }

    for (const stats of Object.values(brandStats)) {
      if (stats.total === 0 || stats.logged !== stats.total) {
        stats.allBrandSource = false;
      }
    }

    const brands = Object.keys(brandStats).sort((a, b) => a.localeCompare(b));
    res.json({ brands, brandStats });
  } catch (error) {
    console.error("Error loading image manager brands:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/admin/image-manager/search", async (req: Request, res: Response) => {
  try {
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const category =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    const brand =
      typeof req.query.brand === "string" ? req.query.brand.trim() : "";

    const and: Prisma.StandardizedProductWhereInput[] = [];

    if (category) {
      and.push({ mainCategory: category });
    }
    if (brand) {
      and.push({ brand });
    }
    if (qRaw) {
      if (/^\d+$/.test(qRaw)) {
        and.push({ id: Number(qRaw) });
      } else {
        and.push({
          OR: [
            { name: { contains: qRaw, mode: "insensitive" } },
            { brand: { contains: qRaw, mode: "insensitive" } },
          ],
        });
      }
    }

    if (and.length === 0) {
      res.json({ products: [] });
      return;
    }

    const products = await prisma.standardizedProduct.findMany({
      where: { AND: and },
      take: 50,
      select: {
        id: true,
        name: true,
        brand: true,
        image: true,
        mainCategory: true,
      },
      orderBy: { id: "asc" },
    });

    res.json({ products });
  } catch (error) {
    console.error("Error searching image manager products:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/api/admin/image-manager/mark/:productId", async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId) || productId <= 0) {
      res.status(400).json({ success: false, message: "Invalid product id" });
      return;
    }

    const checked = Boolean(req.body?.checked);

    const product = await prisma.standardizedProduct.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        brand: true,
        mainCategory: true,
        image: true,
      },
    });

    if (!product) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }

    if (checked) {
      upsertImageLogEntry(buildImageLogEntry(product, "checked"));
    } else {
      removeImageLogEntry(productId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error marking image manager product:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/admin/image-manager/mark-brand", async (req: Request, res: Response) => {
  try {
    const brand = typeof req.body?.brand === "string" ? req.body.brand.trim() : "";
    const category =
      typeof req.body?.category === "string" ? req.body.category.trim() : "";
    const checked = Boolean(req.body?.checked);

    if (!brand || !category) {
      res.status(400).json({
        success: false,
        message: "brand and category are required",
      });
      return;
    }

    const products = await prisma.standardizedProduct.findMany({
      where: { brand, mainCategory: category },
      select: {
        id: true,
        name: true,
        brand: true,
        mainCategory: true,
      },
    });

    const log = readImageLog();

    for (const product of products) {
      const key = String(product.id);
      if (checked) {
        log[key] = buildImageLogEntry(product, "brand");
      } else {
        delete log[key];
      }
    }

    writeImageLog(log);

    res.json({ success: true, count: products.length });
  } catch (error) {
    console.error("Error marking image manager brand:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post(
  "/api/admin/image-manager/upload/:productId",
  imageManagerUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const productId = Number(req.params.productId);
      if (!Number.isFinite(productId) || productId <= 0) {
        res.status(400).json({ success: false, message: "Invalid product id" });
        return;
      }

      const file = req.file;
      if (!file?.buffer?.length) {
        res.status(400).json({ success: false, message: 'Missing "file" upload' });
        return;
      }

      // Render (render.yaml) uses CF_*; local scripts often use CLOUDFLARE_*.
      const accountId =
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
        process.env.CF_ACCOUNT_ID?.trim() ||
        "";
      const imagesToken =
        process.env.CLOUDFLARE_IMAGES_TOKEN?.trim() ||
        process.env.CF_IMAGES_TOKEN?.trim() ||
        "";
      const deliveryHash = process.env.CF_IMAGES_HASH?.trim() || "";
      const deliveryBase =
        process.env.CLOUDFLARE_IMAGE_DELIVERY_URL?.trim() ||
        (deliveryHash ? `https://imagedelivery.net/${deliveryHash}` : "");

      if (!accountId || !imagesToken || !deliveryBase) {
        const missing = [
          !accountId ? "CLOUDFLARE_ACCOUNT_ID|CF_ACCOUNT_ID" : null,
          !imagesToken ? "CLOUDFLARE_IMAGES_TOKEN|CF_IMAGES_TOKEN" : null,
          !deliveryBase
            ? "CLOUDFLARE_IMAGE_DELIVERY_URL|CF_IMAGES_HASH"
            : null,
        ].filter(Boolean);
        res.status(500).json({
          success: false,
          message: `Missing Cloudflare Images env on this host: ${missing.join(", ")}`,
        });
        return;
      }

      const product = await prisma.standardizedProduct.findUnique({
        where: { id: productId },
        select: {
          id: true,
          name: true,
          brand: true,
          mainCategory: true,
          image: true,
        },
      });

      if (!product) {
        res.status(404).json({ success: false, message: "Product not found" });
        return;
      }

      const nameSlug = slugify(product.name, {
        lower: true,
        strict: true,
        trim: true,
      });
      const cfImageId = `product-${product.id}-${nameSlug || "image"}`;
      const existingCfImageId = extractCfImageIdFromDeliveryUrl(product.image);

      for (const imageId of new Set(
        [existingCfImageId, cfImageId].filter((id): id is string => Boolean(id)),
      )) {
        await deleteCfImageIfExists(accountId, imagesToken, imageId);
      }

      const cfForm = new FormData();
      cfForm.append("file", file.buffer, {
        filename: file.originalname || "upload.png",
        contentType: file.mimetype || "application/octet-stream",
      });
      cfForm.append("id", cfImageId);
      cfForm.append(
        "metadata",
        JSON.stringify({
          standardizedProductId: product.id,
          previousImage: product.image,
        }),
      );

      const cfUpload = await axios.post<{
        success?: boolean;
        errors?: { message?: string }[];
      }>(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
        cfForm,
        {
          headers: {
            Authorization: `Bearer ${imagesToken}`,
            ...cfForm.getHeaders(),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus: () => true,
        },
      );

      const cfJson = cfUpload.data;

      if (cfUpload.status < 200 || cfUpload.status >= 300 || !cfJson.success) {
        const detail =
          cfJson.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
          `Cloudflare upload failed (${cfUpload.status})`;
        res.status(502).json({ success: false, message: detail });
        return;
      }

      const deliveryBaseClean = deliveryBase.replace(/\/$/, "");
      const newImageUrl = `${deliveryBaseClean}/${cfImageId}/public`;

      await prisma.standardizedProduct.update({
        where: { id: productId },
        data: { image: newImageUrl },
      });

      upsertImageLogEntry(buildImageLogEntry(product, "manual"));

      res.json({ success: true, newImageUrl });
    } catch (error) {
      console.error("Error uploading image manager file:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },
);

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

    const result = await confirmReceiptScan(prisma, {
      receiptId: id,
      confirmedBy,
      itemConfirmations,
    });

    if (!result.ok) {
      const status =
        result.code === "NOT_FOUND"
          ? 404
          : result.code === "NO_CONFIRMED_ITEMS"
            ? 400
            : 409;
      res.status(status).json({ message: result.message, code: result.code });
      return;
    }

    res.json({
      id: result.receiptId,
      status: result.status,
      pointsAwarded: result.pointsAwarded,
      balance: result.balance,
      confirmedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error confirming receipt scan:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.patch("/api/admin/receipt-scans/:id/reject", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ message: "Invalid receipt scan id" });
      return;
    }
    const rejectedByRaw =
      typeof req.body?.rejectedBy === "string" ? req.body.rejectedBy.trim() : "";
    const reasonRaw = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const result = await rejectReceiptScan(prisma, {
      receiptId: id,
      rejectedBy: rejectedByRaw || "admin",
      reason: reasonRaw,
    });
    if (!result.ok) {
      const status =
        result.code === "NOT_FOUND" ? 404 : result.code === "REASON_REQUIRED" ? 400 : 409;
      res.status(status).json({ message: result.message, code: result.code });
      return;
    }
    res.json({ id: result.receiptId, status: result.status });
  } catch (error) {
    console.error("Error rejecting receipt scan:", error);
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
    if (getScrapeStatus().isRunning) {
      res.status(409).json({
        success: false,
        message: "A scrape run is already in progress",
      });
      return;
    }

    // Reply first, then start work — otherwise Chrome OOM can kill the
    // process before the browser gets a response ("Failed to fetch").
    res.status(202).json({ success: true, started: true });

    const start = () => {
      void runAllCompleteScrapers("manual")
        .then((result) => {
          if (!result.ok) {
            console.error("Manual scrape finished with failure:", result.reason);
          }
        })
        .catch((error) => {
          console.error("Manual scrape run failed:", error);
        });
    };

    if (res.writableEnded) {
      setTimeout(start, 300);
    } else {
      res.on("finish", () => setTimeout(start, 300));
    }
  } catch (error) {
    console.error("Manual scrape run failed:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Manual run failed" });
    }
  }
});

app.delete('/api/clear-db', async (req, res) => {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_CLEAR_DB !== "true"
  ) {
    res.status(403).json({
      success: false,
      error: "clear-db is disabled in production (set ALLOW_CLEAR_DB=true to override)",
    });
    return;
  }
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

function parseIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => Number(item))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
}

app.get("/matches/meta", async (_req, res) => {
  try {
    console.log("[matches/meta] start");
    const meta = await getMatchCategoryMeta();
    console.log(
      `[matches/meta] ok sp=${meta.standardizedMainCategories.length} cat=${meta.productCategories.length} store=${meta.stores.length}`,
    );
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
    const store = parseOptionalCategoryQuery(req.query.store);

    const result = await getProductMatches({
      standardizedMainCategory,
      productCategory,
      store,
    });
    res.json(result);
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

app.get("/new-product-matches/meta", async (_req, res) => {
  try {
    const meta = await getNewProductMatchCategoryMeta();
    res.json(meta);
  } catch (error) {
    console.error("Error getting new product match category meta:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/new-product-matches", async (req, res) => {
  try {
    const standardizedMainCategory = parseOptionalCategoryQuery(
      req.query.standardizedMainCategory,
    );
    const productCategory = parseOptionalCategoryQuery(
      req.query.productCategory,
    );
    const store = parseOptionalCategoryQuery(req.query.store);

    const result = await getNewProductMatches({
      standardizedMainCategory,
      productCategory,
      store,
    });
    res.json(result);
  } catch (error) {
    console.error("Error getting new product matches:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/api/admin/brand-promote/meta", async (_req, res) => {
  try {
    const meta = await getBrandPromoteMeta();
    res.json(meta);
  } catch (error) {
    console.error("brand-promote/meta:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/admin/brand-promote/brands", async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const matchName =
      typeof req.body?.matchName === "string" ? req.body.matchName : name;
    const brand = await addCatalogBrand(matchName, name);
    res.json(brand);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    const status = message.includes("required") || message.includes("exists") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

app.delete("/api/admin/brand-promote/brands/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid brand id" });
      return;
    }
    await deleteCatalogBrand(id);
    res.json({ ok: true });
  } catch (error) {
    console.error("brand-promote delete brand:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/api/admin/brand-promote/preview", async (req, res) => {
  try {
    const category =
      typeof req.query.category === "string" ? req.query.category : "";
    const preview = await previewBrandPromote(category);
    res.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    const status = message.includes("required") ? 400 : 500;
    if (status === 500) console.error("brand-promote/preview:", error);
    res.status(status).json({ error: message });
  }
});

app.post("/api/admin/brand-promote/confirm", async (req, res) => {
  try {
    const result = await confirmBrandPromote({
      productId: Number(req.body?.productId),
      brand: String(req.body?.brand ?? ""),
      name: String(req.body?.name ?? ""),
      volume: String(req.body?.volume ?? ""),
      mainCategory: String(req.body?.mainCategory ?? ""),
      midCategory: String(req.body?.midCategory ?? ""),
      subCategory: String(req.body?.subCategory ?? ""),
      image: String(req.body?.image ?? ""),
    });
    res.json({
      message: "StandardizedProduct created and linked.",
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    console.error("brand-promote/confirm:", error);
    const status =
      message.includes("not found")
        ? 404
        : message.includes("required") ||
            message.includes("already") ||
            message.includes("not available")
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
});

app.get("/api/admin/blocked-products/search", async (req, res) => {
  try {
    const takeRaw = Number(req.query.take);
    const result = await searchProductsByName({
      q: parseOptionalCategoryQuery(req.query.q) ?? "",
      take: Number.isFinite(takeRaw) ? takeRaw : undefined,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    console.error("blocked-products/search:", error);
    const status = message.includes("at least") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

app.get("/api/admin/blocked-products", async (req, res) => {
  try {
    const takeRaw = Number(req.query.take);
    const skipRaw = Number(req.query.skip);
    const result = await listBlockedProducts({
      store: parseOptionalCategoryQuery(req.query.store),
      q: parseOptionalCategoryQuery(req.query.q),
      take: Number.isFinite(takeRaw) ? takeRaw : undefined,
      skip: Number.isFinite(skipRaw) ? skipRaw : undefined,
    });
    res.json(result);
  } catch (error) {
    console.error("blocked-products list:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/admin/blocked-products", async (req, res) => {
  try {
    const productIds = parseIdList(req.body?.productIds);
    const newProductIds = parseIdList(req.body?.newProductIds);
    if (!productIds.length && !newProductIds.length) {
      res.status(400).json({ error: "Provide productIds and/or newProductIds" });
      return;
    }
    const result = await blockListings({
      productIds,
      newProductIds,
      reason:
        typeof req.body?.reason === "string" ? req.body.reason : undefined,
    });
    res.json({
      message: "Listings blocked and removed from Product and NewProducts.",
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    console.error("blocked-products block:", error);
    const status = message.includes("Too many") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

app.delete("/api/admin/blocked-products/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid blocked product id" });
      return;
    }
    await unblockListing(id);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    console.error("blocked-products unblock:", error);
    const status = message.includes("Record to delete does not exist") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

app.post("/confirm-new-product-match", async (req, res) => {
  const newProductId = Number(req.body?.newProductId);
  const standardizedProductId = Number(req.body?.standardizedProductId);

  if (
    !Number.isFinite(newProductId) ||
    newProductId <= 0 ||
    !Number.isFinite(standardizedProductId) ||
    standardizedProductId <= 0
  ) {
    res.status(400).json({
      error: "Missing or invalid newProductId or standardizedProductId",
    });
    return;
  }

  try {
    const result = await confirmNewProductMatch(
      newProductId,
      standardizedProductId,
    );
    res.json({
      message: "New product promoted and linked.",
      productId: result.product.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("confirm-new-product-match:", err);
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

app.get("/api/admin/duplicate-store-links", async (req: Request, res: Response) => {
  try {
    const store = parseOptionalCategoryQuery(req.query.store);
    const result = await getDuplicateStoreLinks({ store });
    res.json(result);
  } catch (error) {
    console.error("Error loading duplicate store links:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/admin/duplicate-store-links/unlink", async (req: Request, res: Response) => {
  const productId = Number(req.body?.productId);
  if (!Number.isFinite(productId) || productId <= 0) {
    res.status(400).json({ error: "Missing or invalid productId" });
    return;
  }

  try {
    const result = await unlinkProductFromStandardized(productId);
    res.json({
      message: result.alreadyUnlinked
        ? "Product was already unlinked."
        : "Product unlinked from StandardizedProduct.",
      productId: result.product.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("unlink duplicate store link:", err);
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

app.delete(
  "/api/admin/duplicate-store-links/product/:productId",
  async (req: Request, res: Response) => {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId) || productId <= 0) {
      res.status(400).json({ error: "Missing or invalid productId" });
      return;
    }

    try {
      const result = await deleteProductById(productId);
      res.json({
        message: "Product deleted.",
        deleted: result.deleted,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      console.error("delete duplicate store link product:", err);
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  },
);

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


const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`Server running on Port ${PORT}`);
  void ensureReceiptRewardsCatalog(prisma).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[receipt-rewards] catalog seed skipped: ${msg}`);
  });
});
