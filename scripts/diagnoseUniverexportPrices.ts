import prisma from "../prismaClient";

async function main() {
  const bad = await prisma.product.findMany({
    where: {
      store: "Univerexport",
      price: { contains: ".00 RSD" },
    },
    select: { id: true, name: true, price: true, priceBeforeDiscount: true },
    take: 20,
  });

  const inflated = bad.filter((p) => {
    const num = Number(String(p.price).replace(/[^\d.]/g, ""));
    return num > 5000;
  });

  console.log(`Sample inflated (${inflated.length} of ${bad.length} checked):`);
  for (const p of inflated.slice(0, 15)) {
    console.log(`  [${p.id}] ${p.price} | ${p.name}`);
  }

  const count = await prisma.product.count({
    where: { store: "Univerexport" },
  });
  const all = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*)::bigint AS cnt FROM "Product"
    WHERE store = 'Univerexport'
      AND price IS NOT NULL
      AND CAST(REGEXP_REPLACE(price, '[^0-9.]', '', 'g') AS numeric) > 5000
  `;
  console.log(`\nTotal Univerexport: ${count}`);
  console.log(`Prices > 5000 RSD: ${all[0]?.cnt ?? 0}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
