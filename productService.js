const prisma = require('./prismaClient');  // Import the Prisma instance

// Function to create a new product
async function createProduct(productData) {
    try {
        await prisma.product.upsert({
            where: {
                name_store: {
                    name: productData.name,
                    store: productData.store,
                }
            },
            update: {
                price: productData.price,
                image: productData.image,
                category: productData.category
            },
            create: {
                name: productData.name,
                price: productData.price,
                image: productData.image,
                store: productData.store,
                category: productData.category
            }
        });
        console.log(`Product processed successfully: ${productData.name}`);
    } catch (error) {
        console.error(`❌ Error processing product: ${error.message}`);
    }
}

// Main function to save all products
async function saveProducts(products) {
    let createdCount = 0;
    let updatedCount = 0;

    for (const product of products) {
        try {
            const existingProduct = await prisma.product.findUnique({
                where: {
                    name_store: {
                        name: product.name,
                        store: product.store
                    }
                }
            });

            if (existingProduct) {
                await prisma.product.update({
                    where: {
                        name_store: {
                            name: product.name,
                            store: product.store
                        }
                    },
                    data: {
                        price: product.price,
                        image: product.image,
                        category: product.category
                    }
                });
                updatedCount++;
            } else {
                await prisma.product.create({
                    data: {
                        name: product.name,
                        price: product.price,
                        image: product.image,
                        store: product.store,
                        category: product.category
                    }
                });
                createdCount++;
            }
        } catch (err) {
            console.error(`❌ Error saving product ${product.name}:`, err.message);
        }
    }

    const totalInDb = await prisma.product.count();

    return {
        created: createdCount,
        updated: updatedCount,
        totalInDb
    };
}

module.exports = { saveProducts };