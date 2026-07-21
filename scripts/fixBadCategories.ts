import prisma from "../prismaClient";

async function main() {
  const bad = await prisma.product.findMany({
    where: { store: "Univerexport", category: ">" },
    select: { id: true, name: true },
  });
  console.log(`Found ${bad.length} products with category '>'`);

  if (!bad.length) return;

  const updated = await prisma.product.updateMany({
    where: { store: "Univerexport", category: ">" },
    data: { category: "Fruits & Vegetables" },
  });
  console.log(`Updated ${updated.count} to Fruits & Vegetables`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
