import puppeteer from 'puppeteer';

interface Product {
    name: string;
    price: string;
    image: string;
    store: string;
    category: string;
}


export async function scrapeIdeaProducts(url: string): Promise<Product[]> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    let allProducts: Product[] = [];
    let pageNum = 1;
    const MAX_PAGES = 3;


    while (pageNum <= MAX_PAGES) {
        const currentUrl = `${url}?page=${pageNum}`;
        console.log(`Scraping page: ${currentUrl}`);

        try {
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('.inner-proizvod', { visible: true });

            // Pass the normalize function to browser context
            const products: Product[] = await page.evaluate(() => {
                
                const data: Product[] = [];
                const productElements = document.querySelectorAll('.inner-proizvod');

                productElements.forEach(el => {
                    const titleElement = el.querySelector('.ime-proizvoda a');
                    const priceElement = el.querySelector('.cijena');
                    const imageElement = el.querySelector('.image img');

                    const title = titleElement?.textContent?.trim() ?? '';
                    let price = priceElement?.textContent?.trim().replace(/\s+/g, ' ') ?? 'N/A';
                    const image = imageElement?.getAttribute('ng-src') ?? '';

                    if (price !== 'N/A') {
                        price = price.replace(' din/kom', '');
                        const numericPrice = parseFloat(price.replace(/\D/g, '')) / 100;
                        price = `${numericPrice.toFixed(2)} RSD`;
                    }

                    if (title && price && image) {
                        data.push({
                            name: title,
                            price,
                            image,
                            store: "Idea",
                            category: "Milk and egg products"
                        });
                    }
                });

                return data;
            });

            if (products.length === 0) {
                console.log(`No products found on page ${pageNum}. Stopping scrape...`);
                break;
            }

            allProducts.push(...products);
            pageNum++;

        } catch (error) {
            console.error(`Error scraping page ${currentUrl}:`, error);
            break;
        }
    }

    await browser.close();
    return allProducts;
}

export async function scrapeMultipleCategories(): Promise<Product[]> {
    const urls: string[] = [
        /*
        'https://online.idea.rs/#!/categories/60016184/cokoladno-mleko/products',
        'https://online.idea.rs/#!/categories/60016182/sveze-mleko/products',
        'https://online.idea.rs/#!/categories/60016183/dugotrajno-mleko/products',
        'https://online.idea.rs/#!/categories/60007827/jaja/products',
        'https://online.idea.rs/#!/categories/60007828/jogurt/products',
        'https://online.idea.rs/#!/categories/60014764/kisela-pavlaka/products',
        'https://online.idea.rs/#!/categories/60025727/kiselo-mleko/products',
        'https://online.idea.rs/#!/categories/60014766/slatka-pavlaka/products',
        'https://online.idea.rs/#!/categories/60014765/pavlaka-za-kuvanje-i-kafu/products',
        'https://online.idea.rs/#!/categories/60014675/biljni-napici/products',
        'https://online.idea.rs/#!/categories/60014577/gauda/products',
        'https://online.idea.rs/#!/categories/60014578/parmezan/products',
        'https://online.idea.rs/#!/categories/60014579/trapist/products',
        'https://online.idea.rs/#!/categories/60014593/ostalo/products',
        'https://online.idea.rs/#!/categories/60014580/biljni-sir/products',
        'https://online.idea.rs/#!/categories/60014581/mozzarella/products',
        'https://online.idea.rs/#!/categories/60014582/plesnjivi-sir/products',
        'https://online.idea.rs/#!/categories/60014583/feta/products',
        'https://online.idea.rs/#!/categories/60014584/mladi-sir/products',
        'https://online.idea.rs/#!/categories/60014585/sitan/products',
        'https://online.idea.rs/#!/categories/60014586/svezi/products',
        'https://online.idea.rs/#!/categories/60014587/kajmak/products',
        'https://online.idea.rs/#!/categories/60014588/mlecni-namazi/products',
        'https://online.idea.rs/#!/categories/60014590/sirni-namazi/products',
        'https://online.idea.rs/#!/categories/60014589/paprika-u-pavlaci/products',
        'https://online.idea.rs/#!/categories/60014591/listici/products',
        'https://online.idea.rs/#!/categories/60014592/trouglasti/products',
        'https://online.idea.rs/#!/categories/60007830/margarin-i-maslac/products',
        'https://online.idea.rs/#!/categories/60007829/majonez-i-prelivi/products',
        'https://online.idea.rs/#!/categories/60007831/mlecni-dezerti/products',
        */
       'https://online.idea.rs/#!/categories/60013823/negazirana-voda/products',
       'https://online.idea.rs/#!/categories/60013822/gazirana-voda/products',
       'https://online.idea.rs/#!/categories/60013824/voda-sa-ukusom/products',


    ];

    const allProducts: Product[] = [];
    const seenProducts = new Set<string>(); // Track unique products

    for (const url of urls) {
        try {
            const products = await scrapeIdeaProducts(url);
            
            // Filter out duplicates before adding
            const uniqueProducts = products.filter(product => {
                const key = `${product.name}-${product.price}`;
                if (!seenProducts.has(key)) {
                    seenProducts.add(key);
                    return true;
                }
                return false;
            });

            allProducts.push(...uniqueProducts);
            console.log(`Scraped ${uniqueProducts.length} unique products from ${url}`);
            
        } catch (error) {
            console.error(`Error scraping ${url}:`, error);
        }
    }

    console.log(`Total unique products from all categories: ${allProducts.length}`);
    return allProducts;
}

export default { scrapeIdeaProducts, scrapeMultipleCategories };