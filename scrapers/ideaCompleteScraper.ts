import { Page } from "puppeteer";
import { launchBrowser } from "./puppeteerBrowser";
import { parseIdeaStaraCijenaRsd } from "./ideaStaraCijenaParse";

interface Product {
  name: string;
  priceBeforeDiscount?: number | null;
  price: string | null;
  image: string;
  store: string;
  category: string;
  requiresLoyaltyCard?: boolean;
  offerEndsOn?: string | null;
}

export type IdeaListingEntry = {
  /** Full Idea listing URL (usually `?page=1`) */
  url: string;
  /** Stored on each product from this listing (your DB `category` / app label) */
  category: string;
};

export type ScrapeIdeaCompleteOptions = {
  /**
   * If set, overrides every listing’s `category` (for quick tests).
   * Normally omit this and set `category` per row in {@link IDEA_COMPLETE_LISTINGS}.
   */
  categoryOverride?: string;
};

/**
 * URLs to scrape (all pages each), with the category label applied to products from that listing.
 * Edit `category` per row to match how you want products grouped in the DB.
 */
export const IDEA_COMPLETE_LISTINGS: IdeaListingEntry[] = [
  { url: "https://online.idea.rs/#!/categories/60007878/pakovani-hleb/products?page=1", category: "Bakery" },
  { url: "https://online.idea.rs/#!/categories/60007882/tost-dvopek-i-prezle/products?page=1", category: "Bakery" },
  { url: "https://online.idea.rs/#!/categories/60007881/kore-kvasac-podloge-za-pizzu/products?page=1", category: "Bakery" },
  { url: "https://online.idea.rs/#!/categories/60014052/gotovi-kolaci/products?page=1", category: "Bakery" },
  { url: "https://online.idea.rs/#!/categories/60014053/gotove-torte/products?page=1", category: "Bakery" },
  { url: "https://online.idea.rs/#!/categories/60014664/galete/products?page=1", category: "Bakery" },
  { url: "https://online.idea.rs/#!/categories/60007800/ajvar-i-proizvodi-od-paprike/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016148/cvekla/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016149/grasak/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016150/krastavci/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016151/kukuruz/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016152/masline/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016154/pasulj/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016155/pecurke/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016153/mesano-i-ostalo-povrce/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016142/kompot/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60016144/slatko-i-vocni-namazi/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60007925/povrce/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60007928/voce/products?page=1", category: "Fruits & Vegetables" },
  { url: "https://online.idea.rs/#!/categories/60014335/ulje/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014336/brasno/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014337/so/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014338/secer-i-zasladivaci/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014339/sirce-i-dresing/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014345/testenine/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014346/pirinac/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014347/tortilje/products?page=1", category: "Bakery" },
  { url: "https://online.idea.rs/#!/categories/60014369/zacini/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014370/sosevi/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60027119/fiksevi/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014351/kecap/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014352/majonez/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014350/senf/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014342/proizvodi-od-paradajza/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014010/sastojci/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60014011/puding-i-slag/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60007838/internacionalna-kuhinja/products?page=1", category: "" },
  { url: "https://online.idea.rs/#!/categories/60016131/supe-u-kesicama/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60016132/nudle/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60016133/kocke-za-supu/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60016143/med/products?page=1", category: "Groceries" },
  { url: "https://online.idea.rs/#!/categories/60023662/crveno-vino/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023665/penusavo-vino/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023663/belo-vino/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023664/roze-vino/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023666/vocno-vino/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023655/svetlo-pivo/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023656/tamno-pivo/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023657/psenicno-pivo/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023658/kraft-pivo/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023659/bezalkoholno-pivo/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023660/radler-pivo/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023670/viski/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023671/rakije/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023672/vodka/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023673/brendi-i-konjak/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023674/dzin/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023675/tekila/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023677/rum/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023678/likeri/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60023654/cideri-i-kokteli/products?page=1", category: "Alcohol" },
  { url: "https://online.idea.rs/#!/categories/60013823/negazirana-voda/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013822/gazirana-voda/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013824/voda-sa-ukusom/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013825/gazirani-sokovi/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013826/negazirani-sokovi/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013827/instant-sokovi/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013821/energetski-i-izotonicni-napici/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60029827/coca-cola/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013846/tradicionalna-kafa/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013847/kapsule-i-espresso/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013848/instant-kafa/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013849/filter-kafa-i-dodaci-za-kafu/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60022082/gotove-kafe/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013860/biljni-caj/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60013861/vocni-caj/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60025734/mesavine/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60025735/ostalo/products?page=1", category: "Drinks" },
  { url: "https://online.idea.rs/#!/categories/60007827/jaja/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60029775/jogurt-natur/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60029776/grcki-jogurt/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60016182/sveze-mleko/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60016183/dugotrajno-mleko/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60016184/cokoladno-mleko/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014764/kisela-pavlaka/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60025727/kiselo-mleko/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014766/slatka-pavlaka/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014765/pavlaka-za-kuvanje-i-kafu/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014675/biljni-napici/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014577/gauda/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014578/parmezan/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014579/trapist/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014593/ostalo/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014580/biljni-sir/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014583/feta/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014584/mladi-sir/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014585/sitan/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014586/svezi/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014587/kajmak/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014588/mlecni-namazi/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014589/paprika-u-pavlaci/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014590/sirni-namazi/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014591/listici/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014592/trouglasti/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60007830/margarin-i-maslac/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60007829/majonez-i-prelivi/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60029309/mlecni-dezerti/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60029310/hladna-kafa-i-proteinski-napici/products?page=1", category: "Milk and egg products" },
  { url: "https://online.idea.rs/#!/categories/60014163/smrznuto-voce/products?page=1", category: "Frozen products" },
  { url: "https://online.idea.rs/#!/categories/60014164/smrznuto-povrce/products?page=1", category: "Frozen products" },
  { url: "https://online.idea.rs/#!/categories/60028360/sladoledi/products?page=1", category: "Frozen products" },
  { url: "https://online.idea.rs/#!/categories/60028361/torte/products?page=1", category: "Frozen products" },
  { url: "https://online.idea.rs/#!/categories/60007910/smrznuta-riba/products?page=1", category: "Frozen products" },
  { url: "https://online.idea.rs/#!/categories/60007911/smrznuto-testo-i-peciva/products?page=1", category: "Frozen products" },
  { url: "https://online.idea.rs/#!/categories/60007908/smrznuta-pizza-i-gotova-jela/products?page=1", category: "Frozen products" },
  { url: "https://online.idea.rs/#!/categories/60018343/premium-jokic-pakovano-meso/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60013924/piletina/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60013925/junetina/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60013926/svinjetina/products?page=1s", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60013928/mesni-specijaliteti/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60013923/curetina/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60020645/sveza-i-smrznuta-riba/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60020708/pecenice-prsute-i-budjole/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60020709/kobasice-i-mortadele/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60020710/sunke-i-prsa/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60020711/salame-parizeri-i-virsle/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60007781/slanine-cvarci-i-mast/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60007782/pastete-i-mesni-narezak/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60007785/specijaliteti/products?page=1", category: "Meat & Fish" },
  { url: "https://online.idea.rs/#!/categories/60014036/mlecna-cokolada/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60014037/cokolada-za-kuvanje/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60014038/bela-i-crna-cokolada/products?page=1s", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60014027/keks/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60029587/napolitanke/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60014026/bombonjera/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60014056/cokoladice/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60014028/bombone-i-zvake/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60007902/cips/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60007903/flips/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60007904/kikiriki-i-orasasto/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60007905/stapici-perece-i-krekeri/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60014030/kokice/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60014678/snack-i-galete/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60025674/kroasani-i-rolati/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60025675/gotove-torte/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60025676/gotovi-kolaci/products?page=1", category: "Sweets and Snacks" },
  { url: "https://online.idea.rs/#!/categories/60019578/galete-i-plocice/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019579/pahuljice-i-semenke/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019580/napici-i-sokovi/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019581/namirnice-za-pripremu-jela/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60020304/orasasti-plodovi/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019582/zdraviji-namazi/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019583/slatkisi-i-grickalice/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019587/gluten-free/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019588/sugar-free/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019589/veganski-proizvodi/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019590/mahunarke-i-semenke/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019591/dorucak-i-namazi/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019592/priprema-jela/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019593/organski-napici-kafa-i-caj/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019594/slatkisi-i-grickalice/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019596/barovi/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60019597/proteini/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60012085/to-go/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60012084/suvo-voce/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60008386/namazi-i-pastete/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60020848/sportska-hrana/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60020847/sportski-napici/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60020849/sportski-dodaci/products?page=1", category: "Healthy Food" },
  { url: "https://online.idea.rs/#!/categories/60025779/muska-kozmetika-brijaci-i-aparati/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60025780/zenski-brijaci/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60025781/proizvodi-za-depilaciju/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60014497/toalet-papir/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60014498/ubrusi/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60014499/salvete/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60014500/papirne-maramice/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60029187/paloma/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007849/ulosci-i-intimna-nega/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007847/flasteri/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007850/vata-tuferi-stapici-za-usi/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007857/samponi/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007855/regeneratori-i-maske-za-kosu/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007854/boje-za-kosu/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007856/stilizovanje-kose/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007859/kreme-i-maske-za-lice/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007860/mleka-i-losioni-za-lice/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007861/nega-usana/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007864/dezodoransi/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007865/kreme-mleka-losioni/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007866/nega-stopala/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007868/pene-i-gelovi-za-tusiranje/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007869/sapuni/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60025772/standardne-cetkice/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007872/konac-tecnost-ostalo/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007873/paste/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60011601/prirodna-kozmetika/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60011801/zdravoteka/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60007874/parfemi-i-setovi/products?page=1", category: "Personal Care" },
  { url: "https://online.idea.rs/#!/categories/60016209/praskasti-deterdzent/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016210/tecni-deterdzent/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016211/kapsule/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016213/rucno-pranje-eco-sapuni/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60007774/odrzavanje-masine/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60007775/odstranjivanje-fleka/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60025849/omeksivaci/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60025850/oplemenjivaci/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016205/rucno-pranje/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016206/masinsko-pranje/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016218/ciscenje-kuhinje/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016219/ciscenje-kupatila/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016220/ciscenje-namestaja-i-podova/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60025857/ciscenje-stakala/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016221/sredstva-za-dezinfekciju-i-univerzalna-sredstva/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60021712/eco-sredstva-za-ciscenje/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016227/sunderi-krpe-zice-i-rukavice/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60016228/metle-kante-cetke/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60007770/nega-obuce/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60014461/insekticidi/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60014462/osvezivaci-prostora/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60014463/wc-osvezivaci/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60014469/kese/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60014470/folije-papir-za-pecenje-i-cackalice/products?page=1", category: "Home Care" },
  { url: "https://online.idea.rs/#!/categories/60014719/pelene/products?page=1", category: "Baby Care" },
  { url: "https://online.idea.rs/#!/categories/60014720/decije-vlazne-maramice/products?page=1", category: "Baby Care" },
  { url: "https://online.idea.rs/#!/categories/60025843/zamensko-mleko/products?page=1", category: "Baby Care" },
  { url: "https://online.idea.rs/#!/categories/60025844/instant-kase/products?page=1", category: "Baby Care" },
  { url: "https://online.idea.rs/#!/categories/60025846/gotove-kasice-teglice-i-pauch/products?page=1", category: "Baby Care" },
  { url: "https://online.idea.rs/#!/categories/60025847/deciji-sokovi-i-ostala-hrana/products?page=1", category: "Baby Care" },
  { url: "https://online.idea.rs/#!/categories/60007764/decija-nega-i-kozmetika/products?page=1", category: "Baby Care" },
  { url: "https://online.idea.rs/#!/categories/60007765/deterdzenti-i-omeksivaci/products?page=1", category: "Baby Care" },
  { url: "https://online.idea.rs/#!/categories/60012833/suva-hrana-za-pse/products?page=1", category: "Pet Care" },
  { url: "https://online.idea.rs/#!/categories/60012834/vlazna-hrana-za-pse/products?page=1", category: "Pet Care" },
  { url: "https://online.idea.rs/#!/categories/60012838/dentali-i-snackovi/products?page=1", category: "Pet Care" },
  { url: "https://online.idea.rs/#!/categories/60012839/suva-hrana-za-macke/products?page=1", category: "Pet Care" },
  { url: "https://online.idea.rs/#!/categories/60012840/vlazna-hrana-za-macke/products?page=1", category: "Pet Care" },
  { url: "https://online.idea.rs/#!/categories/60012841/poslastice-za-macke/products?page=1", category: "Pet Care" },
  { url: "https://online.idea.rs/#!/categories/60030488/pribor-i-kozmetika/products?page=1", category: "Pet Care" },


];

/** Flat URL list (same order as {@link IDEA_COMPLETE_LISTINGS}) for quick reference. */
export const IDEA_COMPLETE_URLS: string[] = IDEA_COMPLETE_LISTINGS.map((e) => e.url);

/** e.g. `.../categories/60023662/...` → `60023662` */
function ideaCategoryIdFromUrl(url: string): string | null {
  const m = url.match(/\/categories\/(\d+)\//);
  return m?.[1] ?? null;
}

/** Wait until the hash router actually shows this category (avoids scraping the previous listing). */
async function waitForIdeaCategoryInHash(
  page: Page,
  categoryId: string,
): Promise<void> {
  await page.waitForFunction(
    (id: string) => {
      const h = window.location.hash;
      return h.includes(`categories/${id}`) || h.includes(`categories%2F${id}`);
    },
    { timeout: 60000 },
    categoryId,
  );
}

/** Click “next” and wait until the route or active page indicator actually changes. */
async function goToNextListingPage(page: Page): Promise<void> {
  const before = await page.evaluate(() => ({
    hash: window.location.hash,
    activeLabel:
      document.querySelector(".pagination-page.active")?.textContent?.trim() ??
      "",
  }));

  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // UI Bootstrap pagination: <li class="pagination-next" ng-class="{disabled: noNext()}">…<a ng-click="selectPage(page+1)">
    // Wait until Angular has removed `disabled` and the chevron link exists.
    await page.waitForFunction(
      () => {
        const li = document.querySelector(".pagination-next");
        return (
          !!li &&
          !li.classList.contains("disabled") &&
          !!li.querySelector("a")
        );
      },
      { timeout: 30000 },
    );

    const clicked = await page.evaluate(() => {
      const li = document.querySelector(
        ".pagination-next:not(.disabled)",
      ) as HTMLElement | null;
      const a = li?.querySelector("a") as HTMLAnchorElement | null;
      if (!li || !a) {
        return false;
      }
      li.scrollIntoView({ block: "center", inline: "center" });
      a.click();
      return true;
    });

    if (!clicked) {
      throw new Error("Pagination “next” link not found or still disabled.");
    }

    await new Promise((r) => setTimeout(r, 150));

    try {
      await page.waitForFunction(
        (snap: { hash: string; activeLabel: string }) => {
          const hash = window.location.hash;
          const active =
            document
              .querySelector(".pagination-page.active")
              ?.textContent?.trim() ?? "";
          return hash !== snap.hash || active !== snap.activeLabel;
        },
        { timeout: 60000 },
        before,
      );
      break;
    } catch (err) {
      if (attempt === attempts - 1) {
        throw err;
      }
      console.warn(
        "Pagination did not advance in time; retrying next click…",
      );
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  await page.waitForNetworkIdle({ idleTime: 500, timeout: 45000 }).catch(() => {
    /* ignore: trackers can prevent “idle” even after the list rendered */
  });
  await page.waitForSelector(".inner-proizvod", { visible: true, timeout: 25000 });
}

/**
 * Scrapes **only** {@link IDEA_COMPLETE_LISTINGS} (edit that constant — no other URLs are used).
 * Each row sets the product `category` field unless {@link ScrapeIdeaCompleteOptions.categoryOverride} is set.
 */
export async function scrapeIdeaProducts(
  options?: ScrapeIdeaCompleteOptions,
): Promise<Product[]> {
  const listings = [...IDEA_COMPLETE_LISTINGS];

  const browser = await launchBrowser();

  let allProducts: Product[] = [];

  for (const entry of listings) {
    const currentUrl = entry.url;
    const category =
      options?.categoryOverride ?? entry.category;

    console.log(`Scraping [${category}]: ${currentUrl}`);

    const page = await browser.newPage();

    try {
      console.log(`Opening: ${currentUrl}`);
      await page.goto(currentUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      const routeId = ideaCategoryIdFromUrl(currentUrl);
      if (routeId) {
        await waitForIdeaCategoryInHash(page, routeId);
      }

      await page.waitForSelector(".inner-proizvod", { visible: true });
      // Let Angular finish wiring pagination; otherwise the first “next” click may not update the hash.
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 });

      let hasNext = true;
      let pageIndex = 1;
      const seenKeys = new Set<string>();

      while (hasNext) {
        console.log(`Scraping page ${pageIndex}...`);

        type IdeaRow = {
          name: string;
          price: string | null;
          oldPriceRaw: string | null;
          image: string;
          store: string;
          category: string;
          requiresLoyaltyCard: boolean;
          offerEndsOn: string | null;
        };

        const rows: IdeaRow[] = await page.evaluate((categoryName) => {
          function isIdeaMpcOffer(el: Element): boolean {
            const akcija = el.querySelector(".akcija.text-center");
            const bg = el.querySelector(".akcija-background");
            return !!(
              akcija?.classList.contains("mpc") ||
              akcija?.classList.contains("mpc2") ||
              bg?.classList.contains("mpc-background") ||
              bg?.classList.contains("mpc2-background")
            );
          }

          function getIdeaOfferEndDate(el: Element): string | null {
            const span = el.querySelector(
              ".trajanje-akcije span[ng-switch-when='true']",
            );
            if (!span) return null;
            const text = span.textContent?.trim() ?? "";
            const match = text.match(/(\d{2}\.\d{2}\.\d{4})/);
            return match ? match[1] : null;
          }

          const data: IdeaRow[] = [];

          const productElements = document.querySelectorAll(".proizvod");

          productElements.forEach((el) => {
            const titleElement = el.querySelector(".ime-proizvoda a");

            const priceBeforeDiscountElement = el.querySelector(
              ".akcija-wrapper .stara-cijena",
            );

            const priceElement = el.querySelector(".cijena");
            const imageElement = el.querySelector(".image img");

            const title = titleElement?.textContent?.trim() ?? "";

            const raw =
              priceElement?.textContent?.trim().replace(/\s+/g, " ") ?? "";

            let price: string | null = null;
            if (raw) {
              const cleaned = raw.replace(" din/kom", "");
              const numericPrice =
                parseFloat(cleaned.replace(/\D/g, "")) / 100;
              if (Number.isFinite(numericPrice)) {
                price = `${numericPrice.toFixed(2)} RSD`;
              }
            }

            const oldPriceRaw =
              priceBeforeDiscountElement?.textContent?.trim() || null;

            const image = imageElement?.getAttribute("ng-src") ?? "";
            const mpcOffer = isIdeaMpcOffer(el);
            const offerEndsOn = getIdeaOfferEndDate(el);

            if (title && image) {
              data.push({
                name: title,
                price,
                oldPriceRaw,
                image,
                store: "Idea",
                category: categoryName,
                requiresLoyaltyCard: mpcOffer,
                offerEndsOn,
              });
            }
          });

          return data;
        }, category);

        const products: Product[] = rows.map(({ oldPriceRaw, ...rest }) => ({
          ...rest,
          priceBeforeDiscount: parseIdeaStaraCijenaRsd(oldPriceRaw),
        }));

        if (products.length === 0) {
          console.log("No products on this page; stopping this listing.");
          break;
        }

        for (const p of products) {
          const key = `${p.name}-${p.price ?? ""}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allProducts.push(p);
          }
        }

        // Let Angular digest update `noNext()` / `.pagination-next.disabled` before reading pagination.
        await new Promise((r) => setTimeout(r, 400));

        const isDisabled = await page.evaluate(() => {
          const next = document.querySelector(".pagination-next");
          return !next || next.classList.contains("disabled");
        });

        if (isDisabled) {
          console.log("No more pages in this category.");
          hasNext = false;
          break;
        }

        await goToNextListingPage(page);

        if (routeId) {
          await waitForIdeaCategoryInHash(page, routeId);
        }

        pageIndex++;
      }
    } catch (error) {
      console.error(`Error scraping ${currentUrl}:`, error);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return allProducts;
}

export default { scrapeIdeaProducts, IDEA_COMPLETE_LISTINGS, IDEA_COMPLETE_URLS };

/** When this file is run directly (not imported), start the scrape. */
function runIfExecutedDirectly(): void {
  const entryBase = (process.argv[1] ?? "").split(/[/\\]/).pop() ?? "";
  if (!entryBase.includes("ideaCompleteScraper")) {
    return;
  }

  console.log(
    "Idea scraper starting… (first page load can take 30–60s)\n",
  );

  scrapeIdeaProducts()
    .then(async (data) => {
      const { saveIdeaScrapeResults } = await import("../ideaScrapePersist");
      await saveIdeaScrapeResults(data);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

runIfExecutedDirectly();
