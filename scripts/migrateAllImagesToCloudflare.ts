/**
 * Migrate Cenoteka product images to Cloudflare Images.
 * Usage (from backend folder): npx ts-node scripts/migrateAllImagesToCloudflare.ts
 */
import axios from "axios";
import FormData from "form-data";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { resolve } from "node:path";
import slugify from "slugify";
import prisma from "../prismaClient";

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 500;
const FAILED_PATH = resolve(__dirname, "migration_failed.json");

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function decodeCenotekaImageUrl(imageValue: string | null | undefined): string {
  const raw = String(imageValue ?? "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    const encoded = parsed.searchParams.get("url");
    if (encoded) return decodeURIComponent(encoded);
  } catch {
    /* ignore */
  }

  return raw;
}

function toLargeImageUrl(url: string): string {
  return url
    .replace(/product_small/g, "product_large")
    .replace(/product_medium/g, "product_large");
}

function filenameFromUrl(url: string, fallbackBase: string): string {
  try {
    const base = basename(new URL(url).pathname);
    if (base && base !== "/") return base;
  } catch {
    /* ignore */
  }
  return `${fallbackBase}.jpg`;
}

function cloudflareImageId(product: { id: number; name: string }): string {
  return `product-${product.id}-${slugify(product.name, {
    lower: true,
    strict: true,
    trim: true,
  }) || "image"}`;
}

async function downloadImage(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Image download failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Downloaded image is empty");
  return { buffer, contentType };
}

async function deleteCfImageIfExists(
  accountId: string,
  token: string,
  imageId: string,
): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${encodeURIComponent(imageId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    console.warn(`CF delete warning for ${imageId}: HTTP ${res.status}`);
  }
}

async function uploadToCloudflareImages(args: {
  accountId: string;
  token: string;
  buffer: Buffer;
  contentType: string;
  filename: string;
  imageId: string;
  metadata: Record<string, unknown>;
}): Promise<string> {
  const { accountId, token, buffer, contentType, filename, imageId, metadata } =
    args;

  await deleteCfImageIfExists(accountId, token, imageId);

  const form = new FormData();
  form.append("file", buffer, { filename, contentType });
  form.append("id", imageId);
  form.append("metadata", JSON.stringify(metadata));

  const upload = await axios.post<{
    success?: boolean;
    result?: { id?: string };
    errors?: { message?: string }[];
  }>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
    form,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    },
  );

  if (upload.status < 200 || upload.status >= 300 || !upload.data.success) {
    const msg =
      upload.data.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${upload.status}`;
    throw new Error(msg);
  }

  return upload.data.result?.id || imageId;
}

async function processProduct(
  product: { id: number; name: string; image: string | null },
  ctx: { accountId: string; token: string; deliveryUrl: string },
): Promise<string> {
  const decodedUrl = decodeCenotekaImageUrl(product.image);
  if (!decodedUrl) throw new Error("Could not decode cenoteka image URL");

  const largeUrl = toLargeImageUrl(decodedUrl);
  const filename = filenameFromUrl(largeUrl, `product-${product.id}`);
  const { buffer, contentType } = await downloadImage(largeUrl);

  const imageId = cloudflareImageId(product);
  const cfImageId = await uploadToCloudflareImages({
    accountId: ctx.accountId,
    token: ctx.token,
    buffer,
    contentType,
    filename,
    imageId,
    metadata: { productId: product.id, productName: product.name },
  });

  const newUrl = `${ctx.deliveryUrl}/${cfImageId}/public`;
  await prisma.standardizedProduct.update({
    where: { id: product.id },
    data: { image: newUrl },
  });

  return newUrl;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requireEnv("CLOUDFLARE_IMAGES_TOKEN");
  const deliveryUrl = requireEnv("CLOUDFLARE_IMAGE_DELIVERY_URL").replace(
    /\/$/,
    "",
  );

  const products = await prisma.standardizedProduct.findMany({
    where: {
      AND: [
        { image: { contains: "cenoteka.rs" } },
        { image: { not: { contains: "imagedelivery.net" } } },
      ],
    },
    orderBy: { id: "asc" },
    select: { id: true, name: true, image: true },
  });

  const total = products.length;
  if (!total) {
    console.log("No products to migrate.");
    writeFileSync(FAILED_PATH, "[]\n", "utf8");
    console.log("Total: 0, Success: 0, Failed: 0");
    return;
  }

  console.log(
    `Migrating ${total} product image(s) in batches of ${BATCH_SIZE}...\n`,
  );

  let current = 0;
  let successCount = 0;
  const failed: { id: number; name: string; error: string }[] = [];
  const batches = chunkArray(products, BATCH_SIZE);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    for (const product of batch) {
      current += 1;
      try {
        await processProduct(product, { accountId, token, deliveryUrl });
        successCount += 1;
        console.log(`${current}/${total} — ${product.name} — ✓`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ id: product.id, name: product.name, error: message });
        console.log(`${current}/${total} — ${product.name} — ✗ ${message}`);
      }
    }

    if (batchIndex < batches.length - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  writeFileSync(FAILED_PATH, `${JSON.stringify(failed, null, 2)}\n`, "utf8");

  const failedCount = failed.length;
  console.log(`\nTotal: ${total}, Success: ${successCount}, Failed: ${failedCount}`);
  if (failedCount) {
    console.log(`Failed IDs saved to ${FAILED_PATH}`);
  }
}

main()
  .catch((err) => {
    console.error("[migrate] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
