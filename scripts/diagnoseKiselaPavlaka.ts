import { getProductMatches } from "../testMatching";
import prisma from "../prismaClient";
import { MAX_STORE_LINKS_PER_STANDARD, scoreProductMatch } from "../matchingUtils";

async function main() {
  const scraped = await prisma.product.findFirst({
    where: {
      store: "Univerexport",
      name: { contains: "KISELA PAVLAKA MOJA KRAVICA 20", mode: "insensitive" },
    },
  });

  const target = await prisma.standardizedProduct.findFirst({
    where: { id: 451 },
    include: { products: { select: { store: true } } },
  });

  console.log("Scraped:", scraped?.name);
  console.log(
    "Target SP 451:",
    target ? `${target.brand} ${target.name} (${target.products.length} links, max ${MAX_STORE_LINKS_PER_STANDARD})` : "missing",
  );
  console.log(
    "In pool:",
    target ? target.products.length < MAX_STORE_LINKS_PER_STANDARD : false,
  );

  if (scraped && target) {
    console.log("Score:", scoreProductMatch({
      scrapedName: scraped.name,
      scrapedCategory: scraped.category,
      standardizedBrand: target.brand,
      standardizedName: target.name,
      standardizedVolume: target.volume,
      standardizedMainCategory: target.mainCategory,
    }));
  }

  const result = await getProductMatches({ store: "Univerexport", limit: 5000 });
  const match = result.matches.find((m) => m.product.id === scraped?.id);
  console.log(
    "Best match:",
    match
      ? `${match.standardizedProduct.brand} ${match.standardizedProduct.name} (${(match.finalScore * 100).toFixed(1)}%)`
      : "none",
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
