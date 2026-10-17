import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";

export type SimilarityBrandAliasRow = {
  id: number;
  name: string;
  matchName: string;
  createdAt: Date;
};

export async function listSimilarityBrandAliases(): Promise<
  SimilarityBrandAliasRow[]
> {
  return prisma.similarityBrandAlias.findMany({
    orderBy: [{ name: "asc" }, { matchName: "asc" }],
    select: { id: true, name: true, matchName: true, createdAt: true },
  });
}

export async function addSimilarityBrandAlias(
  rawMatchName: string,
  rawName?: string,
) {
  const matchName = rawMatchName.trim().replace(/\s+/g, " ");
  const name = (rawName ?? "").trim().replace(/\s+/g, " ") || matchName;
  if (!matchName) {
    throw new Error("Product-name token is required");
  }
  if (!name) {
    throw new Error("StandardizedProduct brand is required");
  }
  try {
    return await prisma.similarityBrandAlias.create({
      data: { name, matchName },
      select: { id: true, name: true, matchName: true, createdAt: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("That Product-name token already exists");
    }
    throw error;
  }
}

export async function deleteSimilarityBrandAlias(id: number) {
  await prisma.similarityBrandAlias.delete({ where: { id } });
}
