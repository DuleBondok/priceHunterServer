    "use strict";
    var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
        function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
            function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
            function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    const express = require("express");
    const cors = require("cors");
    const puppeteer = require("puppeteer");
    const { scrapeMultipleCategories } = require("./scrapers/ideaScraper");
    const scrapeMaxi = require('./scrapers/maxiScraper');
    const { saveProducts } = require('./productService');
    const scrapeDisProducts = require('./scrapers/disScraper');
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.get("/", (req, res) => {
        res.send("Backend is running!");
    });
    let isScraping = false;
    app.get('/api/scrape-idea', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        if (isScraping) {
            console.log('Scraping is already in progress. Please wait...');
            return res.status(400).json({ success: false, message: 'Scraping is already in progress' });
        }
        isScraping = true; // Set to true when scraping starts
        try {
            console.log('🔍 Starting the IDEA scrape...');
            const scrapedProducts = yield scrapeMultipleCategories();
            if (!scrapedProducts || scrapedProducts.length === 0) {
                console.warn("⚠️ No products scraped. Aborting.");
                return res.status(400).json({ success: false, message: "No products scraped" });
            }
            const { created, updated, totalInDb } = yield saveProducts(scrapedProducts);
            res.json({
                success: true,
                message: "Scraping and DB sync complete.",
                totalScraped: scrapedProducts.length,
                addedNew: created,
                updatedExisting: updated,
                totalInDatabase: totalInDb
            });
        }
        catch (error) {
            console.error('❌ Scraping error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
        finally {
            isScraping = false; // Set back to false when done
            yield prisma.$disconnect();
        }
    }));
    app.get("/api/scrape-maxi", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const products = yield scrapeMaxi();
            res.json(products);
        }
        catch (error) {
            res.status(500).send("Failed to scrape Maxi data");
        }
    }));
    app.get("/api/scrape-dis", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const products = yield scrapeDisProducts();
            res.json(products); // Send products as JSON response
        }
        catch (error) {
            console.error("Error during scraping:", error);
            res.status(500).json({ error: "Scraping failed" });
        }
    }));
    const PORT = 5000;
    app.listen(PORT, () => console.log(`Server running on Port ${PORT}`));
