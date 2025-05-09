import puppeteer from "puppeteer";
import prisma from '../prismaClient';

interface Product {
  name:string;
  price:string;
  store:string;
  category:string;
  image:string;
}


async function saveProduct(productData: Product):Promise<void> {
    try {
      
      const existingProduct = await prisma.product.findUnique({
        where: {
          name_store: {
            name: productData.name,
            store: productData.store,
          }
        }
      });
  
      if (existingProduct) {
        
        console.log('Product already exists, updating...');
        await prisma.product.update({
            where: {
              name_store: {
                name: productData.name,
                store: productData.store
              }
            },
          data: {
            price: productData.price,
            
          }
        });
      } else {
        
        console.log('Creating new product...');
        await prisma.product.create({
          data: productData
        });
      }
    } catch (error) {
      console.error('Error creating or updating product:', error);
    }
  }

async function scrapeMaxi():Promise<Product[]> {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    let currentPage = 1;
    const uniqueItemsMap = new Map<string, Product>();

    while (true) {
      const url = `https://www.maxi.rs/Mlechni-proizvodi-i-jaja/c/02?q=%3Arelevance&sort=relevance&pageNumber=${currentPage}`;
      console.log(`Scraping page ${currentPage}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const items: Product[] = await page.evaluate(() => {
        const products:Product[] = [];

        document.querySelectorAll('[data-testid="product-tile-footer"]').forEach((footer) => {
          const tile = footer.closest('[data-testid="product-tile-footer"]')?.parentElement as HTMLElement | null;
          const nameLink = tile?.querySelector('[data-testid="product-block-name-link"]') as HTMLElement | null;
          const brand = nameLink?.querySelector('[data-testid="product-brand"]')?.textContent?.trim() || '';
          const name = nameLink?.querySelector('[data-testid="product-name"]')?.textContent?.trim() || '';
          const fullName = `${brand} ${name}`.trim();

          const priceContainer = tile?.querySelector('[data-testid="product-block-price"]');
          const whole = priceContainer?.querySelector('.sc-dqia0p-9')?.textContent?.trim() || '';
          const decimal = priceContainer?.querySelector('.sc-dqia0p-10')?.textContent?.trim() || '';
          const currency = priceContainer?.querySelector('.sc-dqia0p-8')?.textContent?.trim() || '';

          const price = whole ? `${whole}.${decimal} ${currency}` : 'N/A';

          const imageEl = tile?.querySelector('img[data-testid="product-block-image"]') as HTMLElement | null;
          let imageUrl = imageEl ? imageEl.getAttribute("src") || '' : '';

          if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = `https://www.maxi.rs${imageUrl}`;
          }

          if (fullName) {
            products.push({
              name: fullName,
              price,
              store: "Maxi",
              category: "Milk and egg products",
              image: imageUrl
            });
          }
        });

        return products;
      });

      if (items.length === 0) break;

      items.forEach((item) => {
        const key = `${item.name}-${item.price}`;
        if (!uniqueItemsMap.has(key)) {
          uniqueItemsMap.set(key, item);
        }
      });

      console.log(`Collected so far: ${uniqueItemsMap.size} unique products`);
      currentPage++;
    }

    const allItems = Array.from(uniqueItemsMap.values());
    console.log(`Total unique products: ${allItems.length}`);

    for (const product of allItems) {
      await saveProduct(product);
    }

    await browser.close();
    return allItems;
  } catch (error:any) {
    console.error('Scraping error:', error.message);
    throw new Error('Failed to scrape data');
  }
}

export default scrapeMaxi;