import prisma from './prismaClient';

async function clearDatabase() {
  try {
    // Clear all products
    await prisma.product.deleteMany();
    await prisma.$executeRaw`ALTER SEQUENCE "Product_id_seq" RESTART WITH 1;`;

    console.log('Database cleared successfully');
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Error clearing database:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

clearDatabase();