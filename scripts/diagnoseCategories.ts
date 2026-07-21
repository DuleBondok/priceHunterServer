import prisma from "../prismaClient";

async function main() {
  const spCats = await prisma.standardizedProduct.findMany({
    select: { mainCategory: true },
    distinct: ["mainCategory"],
  });
  const prodCats = await prisma.product.findMany({
    where: { store: "Univerexport" },
    select: { category: true },
    distinct: ["category"],
  });
  console.log("SP mainCategories:", spCats.map((c) => c.mainCategory).sort());
  console.log("Product categories:", prodCats.map((c) => c.category).sort());
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
