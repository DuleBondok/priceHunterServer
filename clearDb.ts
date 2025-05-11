import prisma from './prismaClient';

export async function clearDatabase(): Promise<void> {
  await prisma.product.deleteMany();
  await prisma.$executeRaw`ALTER SEQUENCE "Product_id_seq" RESTART WITH 1;`;
}