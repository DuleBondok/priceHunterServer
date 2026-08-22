import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";
import { SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN } from "./matchingUtils";

export const BRAND_PROMOTE_LIMIT = 80;

export type BrandPromoteDraft = {
  brand: string;
  name: string;
  volume: string;
  mainCategory: string;
  midCategory: string;
  subCategory: string;
  image: string;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatAmount(amount: number): string {
  const rounded = Math.round(amount * 1000) / 1000;
  return String(rounded);
}

export function extractVolumeLabel(text: string): string {
  const regex =
    /(\d+[.,]?\d*)\s*(l|litara|litar|lit|ml|mililitara|mililitar|cl|kg|kilograma|g|grama)\b/gi;
  const matches = [...text.matchAll(regex)];
  if (!matches.length) return "";

  const last = matches[matches.length - 1];
  const amount = parseFloat(last[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return "";

  const unit = last[2].toLowerCase();
  if (unit === "g" || unit.startsWith("gram")) {
    return `${formatAmount(amount / 1000)}KG`;
  }
  if (unit === "kg" || unit.startsWith("kilo")) {
    return `${formatAmount(amount)}KG`;
  }
  if (unit === "ml" || unit.startsWith("mili") || unit === "cl") {
    const liters = unit === "cl" ? amount / 100 : amount / 1000;
    return `${formatAmount(liters)}L`;
  }
  return `${formatAmount(amount)}L`;
}

export function mappedMainCategory(productCategory: string): string {
  const mapped = SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN[productCategory.trim()];
  return mapped?.[0] ?? "";
}

export function matchBrandPrefix(
  productName: string,
  brands: string[],
): { brand: string; remainder: string } | null {
  const name = productName.trim();
  if (!name) return null;

  const sorted = [...brands]
    .map((b) => b.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const brand of sorted) {
    const pattern = new RegExp(`^${escapeRegex(brand)}(?:\\s+|$)`, "i");
    if (!pattern.test(name)) continue;
    const remainder = name.replace(pattern, " ").replace(/\s+/g, " ").trim();
    if (!remainder) continue;
    return { brand, remainder };
  }

  return null;
}

export function buildDraft(
  product: { name: string; category: string; image: string },
  brands: string[],
): BrandPromoteDraft | null {
  const matched = matchBrandPrefix(product.name, brands);
  if (!matched) return null;

  return {
    brand: matched.brand,
    name: matched.remainder,
    volume: extractVolumeLabel(product.name),
    mainCategory: mappedMainCategory(product.category),
    midCategory: "",
    subCategory: "",
    image: product.image || "",
  };
}

export async function listCatalogBrands() {
  return prisma.catalogBrand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, createdAt: true },
  });
}

export async function addCatalogBrand(rawName: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) {
    throw new Error("Brand name is required");
  }
  try {
    return await prisma.catalogBrand.create({
      data: { name },
      select: { id: true, name: true, createdAt: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("Brand already exists");
    }
    throw error;
  }
}

export async function deleteCatalogBrand(id: number) {
  await prisma.catalogBrand.delete({ where: { id } });
}

export async function getBrandPromoteMeta() {
  const [brands, grouped] = await Promise.all([
    listCatalogBrands(),
    prisma.product.groupBy({
      by: ["category"],
      where: {
        standardizedProductId: null,
        isAvailable: true,
        category: { not: ">" },
      },
      _count: { _all: true },
      orderBy: { category: "asc" },
    }),
  ]);

  return {
    brands,
    categories: grouped.map((row) => ({
      category: row.category,
      count: row._count._all,
      mainCategory: mappedMainCategory(row.category),
    })),
  };
}

export async function previewBrandPromote(category: string) {
  const trimmed = category.trim();
  if (!trimmed) {
    throw new Error("category is required");
  }

  const brands = await listCatalogBrands();
  const brandNames = brands.map((b) => b.name);

  const totalUnmatchedAvailable = await prisma.product.count({
    where: {
      category: trimmed,
      standardizedProductId: null,
      isAvailable: true,
    },
  });

  const products = await prisma.product.findMany({
    where: {
      category: trimmed,
      standardizedProductId: null,
      isAvailable: true,
    },
    select: {
      id: true,
      name: true,
      store: true,
      category: true,
      image: true,
      price: true,
    },
    orderBy: { name: "asc" },
    take: 400,
  });

  const suggestions: {
    product: (typeof products)[number];
    draft: BrandPromoteDraft;
  }[] = [];
  const unmatchedNames: string[] = [];
  let withBrand = 0;

  for (const product of products) {
    const draft = buildDraft(product, brandNames);
    if (draft) {
      withBrand += 1;
      if (suggestions.length < BRAND_PROMOTE_LIMIT) {
        suggestions.push({ product, draft });
      }
    } else if (unmatchedNames.length < 40) {
      unmatchedNames.push(product.name);
    }
  }

  const mainCategory = mappedMainCategory(trimmed);
  const existingBrands = mainCategory
    ? (
        await prisma.standardizedProduct.findMany({
          where: {
            mainCategory,
            brand: { not: null },
          },
          distinct: ["brand"],
          select: { brand: true },
          orderBy: { brand: "asc" },
          take: 80,
        })
      )
        .map((row) => row.brand?.trim())
        .filter((name): name is string => Boolean(name))
    : [];

  return {
    category: trimmed,
    mainCategory,
    totalUnmatchedAvailable,
    scanned: products.length,
    truncatedScan: totalUnmatchedAvailable > products.length,
    withBrand,
    withoutBrand: Math.max(0, totalUnmatchedAvailable - withBrand),
    limit: BRAND_PROMOTE_LIMIT,
    truncated: withBrand > suggestions.length,
    brands,
    existingBrands,
    unmatchedNames,
    suggestions,
  };
}

export async function confirmBrandPromote(input: {
  productId: number;
  brand: string;
  name: string;
  volume: string;
  mainCategory: string;
  midCategory: string;
  subCategory: string;
  image: string;
}) {
  const productId = input.productId;
  const brand = input.brand.trim();
  const name = input.name.trim();
  const volume = input.volume.trim();
  const mainCategory = input.mainCategory.trim();
  const midCategory = input.midCategory.trim() || null;
  const subCategory = input.subCategory.trim() || null;
  const image = input.image.trim();

  if (!Number.isFinite(productId) || productId <= 0) {
    throw new Error("productId is required");
  }
  if (!brand) throw new Error("brand is required");
  if (!name) throw new Error("name is required");
  if (!mainCategory) throw new Error("mainCategory is required");

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        standardizedProductId: true,
        isAvailable: true,
        image: true,
      },
    });

    if (!product) {
      throw new Error("Product not found");
    }
    if (product.standardizedProductId) {
      throw new Error("Product is already linked to a StandardizedProduct");
    }
    if (!product.isAvailable) {
      throw new Error("Product is not available");
    }

    const standardized = await tx.standardizedProduct.create({
      data: {
        name,
        brand,
        volume: volume || null,
        mainCategory,
        midCategory,
        subCategory,
        image: image || product.image || null,
      },
    });

    await tx.product.update({
      where: { id: productId },
      data: { standardizedProductId: standardized.id },
    });

    return { productId, standardizedProductId: standardized.id };
  });
}
