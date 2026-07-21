import {
  parseElakolijeDisplayPrice,
  parseElakolijePrice,
} from "../scrapers/univerexportPriceUtils";

const cases: Array<[string, string | null, number | null, number | null]> = [
  ["36.322 decimal bug", "36.322", 36, 36.322],
  ["comma decimal", "36,32", null, 36.32],
  ["whole + cents", "259.99", 259, 259.99],
  ["concatenated int fallback", "36322", 36, 36],
  ["stara cena", null, null, null],
];

for (const [label, cena, cenaCeo, expected] of cases) {
  const got = parseElakolijePrice(cena, cenaCeo);
  const ok = got === expected || (got != null && expected != null && Math.abs(got - expected) < 0.001);
  console.log(`${ok ? "OK" : "FAIL"} ${label}: ${got} (expected ${expected})`);
}

const displayCases: Array<[string, number | null]> = [
  ["54,99", 54.99],
  ["943.99", 943.99],
  ["5624,99", 5624.99],
];

for (const [raw, expected] of displayCases) {
  const got = parseElakolijeDisplayPrice(raw);
  console.log(
    `${got === expected ? "OK" : "FAIL"} display ${raw}: ${got} (expected ${expected})`,
  );
}
