  import prisma from "./prismaClient";

  export type ProductData = {
    name: string;
    price: string;
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
      return { created: 0, updated: 0, totalInDb: await prisma.product.count() };
    }

    console.log(`🛠️ Processing ${products.length} products...`);

    const upserts = products.map((p) => {
      const normalizedName = normalizeName(p.name);

      return prisma.product.upsert({
        where: {
          normalizedName_store: { normalizedName, store: p.store },
        },
        update: {
          price: p.price,
          priceBeforeDiscount: p.priceBeforeDiscount ?? null,
          image: p.image,
          updatedAt: new Date(),
        },
        create: {
          // 🆕 Create a new product if not found
          name: p.name,
          normalizedName,
          price: p.price,
          priceBeforeDiscount: p.priceBeforeDiscount ?? null,
          image: p.image,
          store: p.store,
          category: p.category,
        },
      });
    });

    try {
      const results = await prisma.$transaction(upserts);

      // Count updates vs creations
      let createdCount = 0;
      let updatedCount = 0;

      for (const r of results) {
        // Prisma doesn't return if it was created or updated,
        // so we infer based on timestamps (works since updatedAt auto-changes)
        if (r.createdAt.getTime() === r.updatedAt.getTime()) createdCount++;
        else updatedCount++;
      }

      const totalInDb = await prisma.product.count();

      console.log(
        `✅ Created: ${createdCount}, Updated: ${updatedCount}, Total in DB: ${totalInDb}`,
      );

      return { created: createdCount, updated: updatedCount, totalInDb };
    } catch (error: any) {
      console.error("❌ Transaction failed:", error.message);
      throw error;
    }
  }
