import prisma from "../prismaClient";

const store = process.argv[2]?.trim();
if (!store) {
  console.error("Usage: npx ts-node scripts/deleteNewProductsForStore.ts <StoreName>");
  process.exit(1);
}

async function main() {
  const result = await prisma.newProducts.deleteMany({
    where: { store },
  });
  console.log(`[${store}] Deleted ${result.count} row(s) from NewProducts.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
