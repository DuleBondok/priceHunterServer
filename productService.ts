  import prisma from "./prismaClient";

  export type ProductData = {
    name: string;
    price: string | null;
    priceBeforeDiscount?: number | null;
    image: string;
    store: string;
    category: string;
  };

  // 🧼 Normalize name (remove accents, special characters, normalize spaces)
  function normalizeName(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accent marks
      .replace(/[’'`"´¿]/g, "") // remove quote-like chars
      .replace(/[^a-zA-Z0-9\s]/g, "") // remove non-alphanumeric except spaces
      .toLowerCase()
      .replace(/\s+/g, " ") // collapse multiple spaces
      .trim();
  }

export async function saveProducts(products: ProductData[]) {
  if (products.length === 0) {
    console.log("⚠️ No products to save.");
    return {
      created: 0,
      updated: 0,
      totalInDb: await prisma.product.count(),
    };
  }

  console.log(`🛠️ Processing ${products.length} products...`);

  // 1. LOAD ALL EXISTING PRODUCTS ONCE
  const existingProducts = await prisma.product.findMany({
    select: {
      id: true,
      normalizedName: true,
      store: true,
    },
  });

  // 2. CREATE FAST LOOKUP MAP
  const productMap = new Map(
    existingProducts.map((p) => [
      `${p.normalizedName}-${p.store}`,
      p.id,
    ]),
  );

  let createdCount = 0;
  let updatedCount = 0;

  // 3. PROCESS SCRAPED DATA
  const createOps: any[] = [];
  const updateOps: any[] = [];

  for (const p of products) {
    const normalizedName = normalizeName(p.name);
    const key = `${normalizedName}-${p.store}`;

    const existingId = productMap.get(key);

    // EXISTING PRODUCT → UPDATE
    if (existingId) {
      updateOps.push(
        prisma.product.update({
          where: { id: existingId },
          data: {
            price: p.price,
            priceBeforeDiscount: p.priceBeforeDiscount ?? null,
            image: p.image,
            updatedAt: new Date(),
          },
        }),
      );

      updatedCount++;
      continue;
    }

    // NEW PRODUCT → ONLY IF HAS PRICE
    if (p.price !== null) {
      createOps.push(
        prisma.product.create({
          data: {
            name: p.name,
            normalizedName,
            price: p.price,
            priceBeforeDiscount: p.priceBeforeDiscount ?? null,
            image: p.image,
            store: p.store,
            category: p.category,
          },
        }),
      );

      createdCount++;
    }
  }

  // 4. EXECUTE IN PARALLEL (FAST)
  await Promise.all([...updateOps, ...createOps]);

  const totalInDb = await prisma.product.count();

  console.log(
    `⚡ Created: ${createdCount}, Updated: ${updatedCount}, Total: ${totalInDb}`,
  );

  return { created: createdCount, updated: updatedCount, totalInDb };
}