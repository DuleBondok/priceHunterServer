const prisma = require('./prismaClient'); // Import Prisma Client

async function clearDatabase() {
  try {
    // Clear all products
    await prisma.product.deleteMany();
    await prisma.$executeRaw`ALTER SEQUENCE "Product_id_seq" RESTART WITH 1;`;

    console.log('Database cleared successfully');
  } catch (error) {
    console.error('Error clearing database:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

clearDatabase();