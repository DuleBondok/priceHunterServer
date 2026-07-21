import { getProductMatches } from "../testMatching";
import prisma from "../prismaClient";

async function main() {
  const samples = await prisma.product.findMany({
    where: { store: "Univerexport", standardizedProductId: null },
    take: 8,
    select: { id: true, name: true, category: true },
  });
  console.log("Sample Univerexport unmatched:", samples);

  const result = await getProductMatches({ store: "Univerexport", limit: 30 });
  console.log(`Best match per product: ${result.total}, showing ${result.matches.length}`);

  for (const m of result.matches.slice(0, 10)) {
    console.log("---");
    console.log(`SCRAPED [${m.product.id}]: ${m.product.name} (${m.product.category})`);
    console.log(
      `SP [${m.standardizedProduct.id}]: ${m.standardizedProduct.brand ?? ""} ${m.standardizedProduct.name} vol=${m.standardizedProduct.volume ?? ""}`,
    );
    console.log(
      `sim=${m.similarity.toFixed(3)} fuzzy=${m.fuzzyScore.toFixed(3)} vol=${m.volumeScore.toFixed(3)} brand=${m.brandMatch} cat=${m.categoryScore} final=${m.finalScore.toFixed(3)}${m.lowConfidence ? " LOW" : ""}`,
    );
  }

  // Show if first row for each sample product is sensible
  for (const s of samples) {
    const best = result.matches.find((m) => m.product.id === s.id);
    console.log("\n== Product:", s.name, `(${s.category})`);
    if (!best) {
      console.log("  NO MATCH");
      continue;
    }
    console.log(
      `  Best: ${best.standardizedProduct.brand ?? ""} ${best.standardizedProduct.name} (final=${best.finalScore.toFixed(3)}${best.lowConfidence ? ", low confidence" : ""})`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
