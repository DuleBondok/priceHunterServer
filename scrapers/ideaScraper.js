    const puppeteer = require('puppeteer');

    async function scrapeIdeaProducts(url) {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
    
        let allProducts = [];
        let pageNum = 1;
        const MAX_PAGES = 10;
        const lastPageProductNames = new Set();
    
        while (pageNum <= MAX_PAGES) {
            const currentUrl = `${url}?page=${pageNum}`;
            console.log(`Scraping page: ${currentUrl}`);
    
            try {
                await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForSelector('.inner-proizvod', { visible: true });
    
                const products = await page.evaluate(() => {
                    const data = [];
                    const productElements = document.querySelectorAll('.inner-proizvod');
    
                    productElements.forEach(el => {
                        const titleElement = el.querySelector('.ime-proizvoda a');
                        const priceElement = el.querySelector('.cijena');
                        const imageElement = el.querySelector('.image img');
    
                        const title = titleElement ? titleElement.innerText.trim() : null;
                        let price = priceElement ? priceElement.innerText.trim().replace(/\s+/g, ' ') : null;
                        const image = imageElement ? imageElement.getAttribute('ng-src') : null;
    
                        if (!price) {
                            price = "N/A";
                        } else {
                            price = price.replace(' din/kom', '');
                            price = parseFloat(price.replace(/\D/g, '')) / 100;
                            price = price.toFixed(2);
                            price = `${price} RSD`;
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
                    break; // No products found, stop scraping this category
                }
    
                // Check if the products are unique compared to the last page
                const currentPageProductNames = new Set(products.map(p => p.name));
                if ([...currentPageProductNames].every(name => lastPageProductNames.has(name))) {
                    console.log(`Same products detected on page ${pageNum}. Stopping scrape...`);
                    break; // Same products as the previous page
                }
    
                // Add the products from the current page to the results
                allProducts.push(...products);
                currentPageProductNames.forEach(name => lastPageProductNames.add(name)); // Add current page products to the set
    
                pageNum++; // Move to the next page
    
            } catch (error) {
                console.error(`Error scraping page ${currentUrl}:`, error);
                break; // Stop if there's an error
            }
        }
    
        await browser.close();
        return allProducts;
    }
    async function scrapeMultipleCategories() {
    const urls = [
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
        
    ];

    const allProducts = [];

    for (const url of urls) {
        const products = await scrapeIdeaProducts(url);
        allProducts.push(...products);
    }

    console.log(`Total products from all categories: ${allProducts.length}`);
    return allProducts;
    }

    module.exports = { scrapeIdeaProducts, scrapeMultipleCategories };