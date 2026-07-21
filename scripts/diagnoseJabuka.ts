import prisma from "../prismaClient";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "dj")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const scraped = "JABUKA AJDARED";
  const norm = normalizeText(scraped);
  console.log("Looking for SP matching:", norm);

  const candidates = await prisma.standardizedProduct.findMany({
    where: {
      OR: [
        { name: { contains: "ajdared", mode: "insensitive" } },
        { name: { contains: "jabuka", mode: "insensitive" } },
      ],
    },
    include: { products: { select: { id: true, store: true } } },
    take: 15,
  });
  console.log(
    "SP candidates:",
    candidates.map((c) => ({
      id: c.id,
      brand: c.brand,
      name: c.name,
      volume: c.volume,
      mainCategory: c.mainCategory,
      linked: c.products.length,
    })),
  );

  const badCat = await prisma.product.count({
    where: { store: "Univerexport", category: ">" },
  });
  const total = await prisma.product.count({
    where: { store: "Univerexport", standardizedProductId: null },
  });
  console.log(`Univerexport unmatched: ${total}, category='>': ${badCat}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
