import prisma from "../prismaClient";

async function main() {
  const inflated = await prisma.$queryRaw<
    Array<{ id: number; name: string; price: string }>
  >`
    SELECT id, name, price FROM "Product"
    WHERE store = 'Univerexport' AND price IS NOT NULL
      AND CAST(REGEXP_REPLACE(price, '[^0-9.]', '', 'g') AS numeric) > 5000
    LIMIT 15
  `;

  const low = await prisma.$queryRaw<
    Array<{ id: number; name: string; price: string }>
  >`
    SELECT id, name, price FROM "Product"
    WHERE store = 'Univerexport' AND price IS NOT NULL
      AND CAST(REGEXP_REPLACE(price, '[^0-9.]', '', 'g') AS numeric) BETWEEN 0.01 AND 20
    ORDER BY CAST(REGEXP_REPLACE(price, '[^0-9.]', '', 'g') AS numeric) ASC
    LIMIT 20
  `;

  const sample = await prisma.product.findMany({
    where: {
      store: "Univerexport",
      OR: [
        { name: { contains: "Pampers", mode: "insensitive" } },
        { name: { contains: "Jazak", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, price: true, priceBeforeDiscount: true },
    take: 10,
  });

  console.log(`Still inflated (>5000): ${inflated.length}`);
  for (const p of inflated) console.log(`  [${p.id}] ${p.price} | ${p.name}`);

  console.log(`\nSuspiciously low (<20 RSD): ${low.length}`);
  for (const p of low) console.log(`  [${p.id}] ${p.price} | ${p.name}`);

  console.log("\nSample Pampers/Jazak:");
  for (const p of sample) {
    console.log(
      `  [${p.id}] ${p.price}${p.priceBeforeDiscount != null ? ` (was ${p.priceBeforeDiscount})` : ""} | ${p.name}`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
