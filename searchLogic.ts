import { Router, Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { addDiscountFields } from "./utils/addDiscountFields";
import {
  pricedProductWhere,
  hasAtLeastOnePricedProduct,
} from "./utils/pricedProductFilter";

const prisma = new PrismaClient();
const router = Router();

// Helper to expand Serbian variants
function expandSerbianVariants(query: string): string[] {
  const replacements: Record<string, string[]> = {
    c: ["c", "č", "ć"],
    s: ["s", "š"],
    z: ["z", "ž"],
    d: ["d", "đ"],
  };

  const chars = query.toLowerCase().split("");
  let combinations: string[] = [""];

  for (const char of chars) {
    const variants = replacements[char] || [char];
    const newCombinations: string[] = []; 

    for (const prefix of combinations) {
      for (const variant of variants) {
        newCombinations.push(prefix + variant);
      }
    }

    combinations = newCombinations;
  }

  return combinations.slice(0, 10); // Limit for performance
}

router.get("/", async (req: Request, res: Response): Promise<void> => {
  const query = req.query.query as string;

  if (!query || typeof query !== "string" || query.trim() === "") {
    res.status(400).json({ error: "Missing or invalid query" });
    return;
  }

  try {
    const terms = query.toLowerCase().split(/\s+/); // Split by space
    const andConditions: Prisma.StandardizedProductWhereInput[] = [];

    for (const term of terms) {
      const expanded = expandSerbianVariants(term);

      const orSubConditions: Prisma.StandardizedProductWhereInput[] = 
        expanded.flatMap((variant) => [
          {
            name: {
              contains: variant,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            brand: {
              contains: variant,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        ]);

      andConditions.push({ OR: orSubConditions });
    }

const matchingStandardizedProducts = await prisma.standardizedProduct.findMany({
  where: {
    AND: [...andConditions, hasAtLeastOnePricedProduct],
  },
  include: {
    products: {
      where: pricedProductWhere,
      orderBy: { price: "asc" },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        price: true,               // ✅ needed
        priceBeforeDiscount: true, // ✅ needed
        store: true,               // ✅ needed (your UI uses it)
        category: true,
        image: true,
        standardizedProductId: true,
      },
    },
  },
});

    const result = addDiscountFields(matchingStandardizedProducts);
    res.status(200).json(result);
  } catch (err: any) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

export default router;
