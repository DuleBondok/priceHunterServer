/**
 * Spot-check Elakolije API prices for products damaged by /1000 fix.
 */
import axios from "axios";
import {
  parseElakolijePrice,
  parseElakolijeDisplayPrice,
} from "../scrapers/univerexportPriceUtils";

const API_URL = "https://elakolije.rs/api/api.php?action=artikli";
const API_KEY =
  "Vi3NmguyYAnZKTgBdFPOgIEls0gNYrMF97w4l9L5YvYiBaeEh3SgkBFSX8RKmCMhJzDqulrklCXtppjSpt6he0x7iOYU7hUxvxAlnr54dUUhgcHziMdiopaPR8gSLIji";

async function search(term: string) {
  const { data } = await axios.post(
    API_URL,
    {
      sifkla: "",
      si_kat: "",
      datum: "",
      sort: "",
      si_art: "",
      ulogovan_kor: "",
      p_nadji: term,
      offset: 0,
      limit: 10,
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY,
      },
      timeout: 30000,
    },
  );

  const rows = data.response ?? [];
  for (const a of rows) {
    const price = parseElakolijePrice(a.cena, a.cena_ceo);
    console.log({
      naziv: a.naziv,
      cena: a.cena,
      cena_ceo: a.cena_ceo,
      stara_cena: a.stara_cena,
      parsed: price,
      stara_parsed: parseElakolijeDisplayPrice(a.stara_cena),
    });
  }
}

async function main() {
  console.log("--- PAMPERS PANTS MSB ---");
  await search("PAMPERS PANTS MSB 4");
  console.log("\n--- DASKA PEGLANJE ---");
  await search("DASKA ZA PEGLANJE");
  console.log("\n--- BAS BAS 10G ---");
  await search("LIMUNTUS BAŠ BAŠ 10G");
}

main().catch(console.error);
