// Starter catalogue: goods Tanzanian hotels, lodges, restaurants and bars
// commonly stock, with the packs they are usually delivered in. A starting
// point only: every name and pack stays editable after it is added, pack
// sizes differ between distributors, and nothing is added unless ticked.
//
// `category` is the stock category stored on the item; `group` is only the
// sub-heading used to browse this list.

export type CatalogueGood = {
  name: string;
  category: string;
  group: string;
  baseUnit: "BOTTLE" | "CAN" | "PIECE" | "ML" | "G";
  countStyle?: "WHOLE" | "PARTIAL";
  perishable?: boolean;
  shelfLifeDays?: number;
  packUnits: Array<{ name: string; baseQuantity: number }>;
};

type Pack = Array<{ name: string; baseQuantity: number }>;

const crate = (n: number): Pack => [{ name: "Crate", baseQuantity: n }];
const carton = (n: number): Pack => [{ name: "Carton", baseQuantity: n }];
const kilo: Pack = [{ name: "Kilo", baseQuantity: 1000 }];

/** Bottled beer, cider or ready-to-drink, counted per bottle. */
function beer(name: string, group: string, pack: Pack): CatalogueGood {
  return { name, category: "BEER", group, baseUnit: "BOTTLE", packUnits: pack };
}
function beerCan(name: string, group: string, perCarton = 24): CatalogueGood {
  return { name, category: "BEER", group, baseUnit: "CAN", packUnits: carton(perCarton) };
}
/** Spirits in ml, so a tot takes its share of the bottle. */
function spirit(name: string, group: string, ml: number): CatalogueGood {
  const packs: Pack = [{ name: "Bottle", baseQuantity: ml }];
  if (ml >= 700) packs.push({ name: "Case of 12", baseQuantity: ml * 12 });
  else if (ml >= 350) packs.push({ name: "Case of 24", baseQuantity: ml * 24 });
  else packs.push({ name: "Carton of 48", baseQuantity: ml * 48 });
  return { name, category: "SPIRITS", group, baseUnit: "ML", packUnits: packs };
}
/** Wine in ml, so a glass and a bottle draw on the same stock. */
function wine(name: string, group: string, ml: number): CatalogueGood {
  const packs: Pack = ml >= 3000
    ? [{ name: "Box", baseQuantity: ml }, { name: "Case of 4", baseQuantity: ml * 4 }]
    : [{ name: "Bottle", baseQuantity: ml }, { name: ml >= 1500 ? "Case of 6" : "Case of 12", baseQuantity: ml * (ml >= 1500 ? 6 : 12) }];
  return { name, category: "WINE", group, baseUnit: "ML", packUnits: packs };
}
function soft(name: string, group: string, unit: "BOTTLE" | "CAN", pack: Pack): CatalogueGood {
  return { name, category: "SOFT_DRINKS", group, baseUnit: unit, packUnits: pack };
}
function water(name: string, perCarton: number, group = "Still water"): CatalogueGood {
  return { name, category: "WATER", group, baseUnit: "BOTTLE", packUnits: carton(perCarton) };
}
/** Weighed fresh goods, received by the kilo. */
function weighed(name: string, category: string, group: string, shelfLifeDays: number, extra: Pack = []): CatalogueGood {
  return { name, category, group, baseUnit: "G", perishable: true, shelfLifeDays, packUnits: [...kilo, ...extra] };
}
function pieces(name: string, category: string, group: string, pack: Pack, shelfLifeDays?: number): CatalogueGood {
  return { name, category, group, baseUnit: "PIECE", perishable: shelfLifeDays != null, shelfLifeDays, packUnits: pack };
}
function dry(name: string, group: string, unit: "G" | "ML" | "PIECE", pack: Pack): CatalogueGood {
  return { name, category: "DRY_GOODS", group, baseUnit: unit, packUnits: pack };
}

export const STARTER_CATALOGUE: CatalogueGood[] = [
  // ------------------------------------------------------------ Beer
  beer("Kilimanjaro Premium Lager 500 ml", "Tanzanian lager", crate(25)),
  beer("Kilimanjaro Premium Lager 330 ml", "Tanzanian lager", carton(24)),
  beer("Safari Lager 500 ml", "Tanzanian lager", crate(25)),
  beer("Castle Lager 500 ml", "Tanzanian lager", crate(25)),
  beer("Castle Lite 375 ml", "Tanzanian lager", crate(24)),
  beer("Castle Milk Stout 375 ml", "Tanzanian lager", crate(24)),
  beer("Eagle Lager 500 ml", "Tanzanian lager", crate(25)),
  beer("Ndovu Special Malt 500 ml", "Tanzanian lager", crate(25)),
  beer("Balimi Extra Lager 500 ml", "Tanzanian lager", crate(25)),
  beer("Serengeti Premium Lager 500 ml", "Tanzanian lager", crate(25)),
  beer("Serengeti Lite 500 ml", "Tanzanian lager", crate(25)),
  beer("Pilsner Lager 500 ml", "Tanzanian lager", crate(25)),
  beer("Tusker Lager 500 ml", "Tanzanian lager", crate(25)),
  beer("Tusker Lite 330 ml", "Tanzanian lager", carton(24)),
  beer("Tusker Malt 500 ml", "Tanzanian lager", crate(25)),
  beer("Guinness Foreign Extra Stout 500 ml", "Stout", crate(25)),
  beer("Guinness 330 ml", "Stout", carton(24)),
  beer("Guinness Smooth 500 ml", "Stout", crate(25)),
  beer("Heineken 330 ml", "Imported beer", carton(24)),
  beerCan("Heineken 500 ml can", "Imported beer"),
  beer("Windhoek Lager 330 ml", "Imported beer", carton(24)),
  beer("Corona Extra 355 ml", "Imported beer", carton(24)),
  beer("Stella Artois 330 ml", "Imported beer", carton(24)),
  beer("Budweiser 330 ml", "Imported beer", carton(24)),
  beer("Amstel Lager 330 ml", "Imported beer", carton(24)),
  beer("Desperados 330 ml", "Imported beer", carton(24)),
  beer("Savanna Dry Cider 330 ml", "Cider and ready-to-drink", carton(24)),
  beer("Savanna Light Cider 330 ml", "Cider and ready-to-drink", carton(24)),
  beer("Hunter's Gold Cider 330 ml", "Cider and ready-to-drink", carton(24)),
  beer("Hunter's Dry Cider 330 ml", "Cider and ready-to-drink", carton(24)),
  beer("Redd's Original 330 ml", "Cider and ready-to-drink", carton(24)),
  beer("Smirnoff Ice 300 ml", "Cider and ready-to-drink", carton(24)),
  beer("Smirnoff Guarana 300 ml", "Cider and ready-to-drink", carton(24)),
  beer("Snapp 330 ml", "Cider and ready-to-drink", carton(24)),
  beer("Flying Fish 330 ml", "Cider and ready-to-drink", carton(24)),

  // ------------------------------------------------------------ Spirits
  spirit("Konyagi 750 ml", "Tanzanian spirits", 750),
  spirit("Konyagi 500 ml", "Tanzanian spirits", 500),
  spirit("Konyagi 250 ml", "Tanzanian spirits", 250),
  spirit("K-Vant Gin 750 ml", "Tanzanian spirits", 750),
  spirit("Valeur Brandy 750 ml", "Tanzanian spirits", 750),
  spirit("Zed Vodka 750 ml", "Tanzanian spirits", 750),

  spirit("Jack Daniel's Old No. 7 1 L", "Whisky", 1000),
  spirit("Jack Daniel's Old No. 7 750 ml", "Whisky", 750),
  spirit("Jack Daniel's Old No. 7 375 ml", "Whisky", 375),
  spirit("Jack Daniel's Tennessee Honey 750 ml", "Whisky", 750),
  spirit("Jack Daniel's Tennessee Fire 750 ml", "Whisky", 750),
  spirit("Gentleman Jack 750 ml", "Whisky", 750),
  spirit("Johnnie Walker Red Label 1 L", "Whisky", 1000),
  spirit("Johnnie Walker Red Label 750 ml", "Whisky", 750),
  spirit("Johnnie Walker Red Label 375 ml", "Whisky", 375),
  spirit("Johnnie Walker Red Label 200 ml", "Whisky", 200),
  spirit("Johnnie Walker Black Label 1 L", "Whisky", 1000),
  spirit("Johnnie Walker Black Label 750 ml", "Whisky", 750),
  spirit("Johnnie Walker Double Black 750 ml", "Whisky", 750),
  spirit("Johnnie Walker Gold Label Reserve 750 ml", "Whisky", 750),
  spirit("Johnnie Walker Blue Label 750 ml", "Whisky", 750),
  spirit("Jameson Irish Whiskey 1 L", "Whisky", 1000),
  spirit("Jameson Irish Whiskey 750 ml", "Whisky", 750),
  spirit("Jameson Irish Whiskey 375 ml", "Whisky", 375),
  spirit("Chivas Regal 12 Year 750 ml", "Whisky", 750),
  spirit("Chivas Regal 18 Year 750 ml", "Whisky", 750),
  spirit("Glenfiddich 12 Year 750 ml", "Whisky", 750),
  spirit("Glenlivet 12 Year 750 ml", "Whisky", 750),
  spirit("Singleton 12 Year 750 ml", "Whisky", 750),
  spirit("Monkey Shoulder 750 ml", "Whisky", 750),
  spirit("Grant's Triple Wood 750 ml", "Whisky", 750),
  spirit("Famous Grouse 750 ml", "Whisky", 750),
  spirit("J&B Rare 750 ml", "Whisky", 750),
  spirit("Ballantine's Finest 750 ml", "Whisky", 750),
  spirit("Black & White 750 ml", "Whisky", 750),
  spirit("VAT 69 750 ml", "Whisky", 750),
  spirit("Bond 7 750 ml", "Whisky", 750),
  spirit("Jim Beam White 750 ml", "Whisky", 750),
  spirit("Jim Beam Honey 750 ml", "Whisky", 750),
  spirit("Southern Comfort 750 ml", "Whisky", 750),

  spirit("Smirnoff Vodka 1 L", "Vodka", 1000),
  spirit("Smirnoff Vodka 750 ml", "Vodka", 750),
  spirit("Smirnoff Vodka 375 ml", "Vodka", 375),
  spirit("Smirnoff Vodka 200 ml", "Vodka", 200),
  spirit("Absolut Vodka 750 ml", "Vodka", 750),
  spirit("Absolut Citron 750 ml", "Vodka", 750),
  spirit("Grey Goose 750 ml", "Vodka", 750),
  spirit("Ciroc 750 ml", "Vodka", 750),
  spirit("Belvedere 750 ml", "Vodka", 750),
  spirit("Skyy Vodka 750 ml", "Vodka", 750),
  spirit("Ketel One 750 ml", "Vodka", 750),

  spirit("Gordon's Gin 750 ml", "Gin", 750),
  spirit("Gordon's Pink Gin 750 ml", "Gin", 750),
  spirit("Gilbey's Gin 750 ml", "Gin", 750),
  spirit("Tanqueray London Dry 750 ml", "Gin", 750),
  spirit("Bombay Sapphire 750 ml", "Gin", 750),
  spirit("Beefeater London Dry 750 ml", "Gin", 750),
  spirit("Hendrick's Gin 750 ml", "Gin", 750),

  spirit("Captain Morgan Spiced Gold 750 ml", "Rum", 750),
  spirit("Captain Morgan Dark 750 ml", "Rum", 750),
  spirit("Bacardi Carta Blanca 750 ml", "Rum", 750),
  spirit("Bacardi Carta Oro 750 ml", "Rum", 750),
  spirit("Malibu Coconut 750 ml", "Rum", 750),
  spirit("Kenya Cane 750 ml", "Rum", 750),
  spirit("Old Monk 750 ml", "Rum", 750),
  spirit("Havana Club 3 Year 750 ml", "Rum", 750),

  spirit("Jose Cuervo Especial Gold 750 ml", "Tequila", 750),
  spirit("Jose Cuervo Especial Silver 750 ml", "Tequila", 750),
  spirit("Olmeca Blanco 750 ml", "Tequila", 750),
  spirit("Patron Silver 750 ml", "Tequila", 750),
  spirit("Don Julio Blanco 750 ml", "Tequila", 750),

  spirit("Hennessy VS 700 ml", "Brandy and cognac", 700),
  spirit("Hennessy VSOP 700 ml", "Brandy and cognac", 700),
  spirit("Martell VS 700 ml", "Brandy and cognac", 700),
  spirit("Remy Martin VSOP 700 ml", "Brandy and cognac", 700),
  spirit("Richot Brandy 750 ml", "Brandy and cognac", 750),
  spirit("Viceroy Brandy 750 ml", "Brandy and cognac", 750),
  spirit("Klipdrift Brandy 750 ml", "Brandy and cognac", 750),
  spirit("Three Barrels Brandy 750 ml", "Brandy and cognac", 750),
  spirit("KWV 5 Year Brandy 750 ml", "Brandy and cognac", 750),

  spirit("Amarula Cream 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Amarula Cream 375 ml", "Liqueurs and aperitifs", 375),
  spirit("Baileys Original 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Kahlua 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Jagermeister 700 ml", "Liqueurs and aperitifs", 700),
  spirit("Cointreau 700 ml", "Liqueurs and aperitifs", 700),
  spirit("Triple Sec 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Peach Schnapps 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Blue Curacao 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Sambuca 700 ml", "Liqueurs and aperitifs", 700),
  spirit("Campari 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Aperol 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Martini Rosso 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Martini Bianco 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Martini Extra Dry 750 ml", "Liqueurs and aperitifs", 750),
  spirit("Angostura Bitters 200 ml", "Liqueurs and aperitifs", 200),

  // ------------------------------------------------------------ Wine
  wine("House red wine 750 ml", "House wine", 750),
  wine("House white wine 750 ml", "House wine", 750),
  wine("House rose wine 750 ml", "House wine", 750),
  wine("House red wine box 5 L", "House wine", 5000),
  wine("House white wine box 5 L", "House wine", 5000),
  wine("Dodoma red wine 750 ml", "Tanzanian wine", 750),
  wine("Dodoma white wine 750 ml", "Tanzanian wine", 750),
  wine("Four Cousins Sweet Red 750 ml", "Sweet wine", 750),
  wine("Four Cousins Sweet Red 1.5 L", "Sweet wine", 1500),
  wine("Four Cousins Sweet White 750 ml", "Sweet wine", 750),
  wine("Four Cousins Sweet Rose 750 ml", "Sweet wine", 750),
  wine("Robertson Sweet Red 750 ml", "Sweet wine", 750),
  wine("Namaqua Sweet Red box 5 L", "Sweet wine", 5000),
  wine("Cellar Cask Red 750 ml", "Sweet wine", 750),
  wine("Cellar Cask White 750 ml", "Sweet wine", 750),
  wine("Drostdy-Hof Red 750 ml", "Red wine", 750),
  wine("Nederburg Cabernet Sauvignon 750 ml", "Red wine", 750),
  wine("Nederburg Merlot 750 ml", "Red wine", 750),
  wine("Casillero del Diablo Cabernet Sauvignon 750 ml", "Red wine", 750),
  wine("Casillero del Diablo Merlot 750 ml", "Red wine", 750),
  wine("Frontera Cabernet Sauvignon 750 ml", "Red wine", 750),
  wine("Jacob's Creek Shiraz 750 ml", "Red wine", 750),
  wine("Drostdy-Hof White 750 ml", "White wine", 750),
  wine("Nederburg Sauvignon Blanc 750 ml", "White wine", 750),
  wine("Casillero del Diablo Sauvignon Blanc 750 ml", "White wine", 750),
  wine("Jacob's Creek Chardonnay 750 ml", "White wine", 750),
  wine("J.C. Le Roux Le Domaine 750 ml", "Sparkling wine and champagne", 750),
  wine("Martini Asti 750 ml", "Sparkling wine and champagne", 750),
  wine("Prosecco 750 ml", "Sparkling wine and champagne", 750),
  wine("Moet & Chandon Brut 750 ml", "Sparkling wine and champagne", 750),
  wine("Veuve Clicquot Brut 750 ml", "Sparkling wine and champagne", 750),

  // ------------------------------------------------------------ Soft drinks
  soft("Coca-Cola 350 ml glass", "Sodas", "BOTTLE", crate(24)),
  soft("Coca-Cola 500 ml", "Sodas", "BOTTLE", carton(12)),
  soft("Coca-Cola 1.25 L", "Sodas", "BOTTLE", carton(12)),
  soft("Coca-Cola 330 ml can", "Sodas", "CAN", carton(24)),
  soft("Coca-Cola Zero 330 ml can", "Sodas", "CAN", carton(24)),
  soft("Fanta Orange 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Fanta Passion 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Fanta Pineapple 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Sprite 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Krest Bitter Lemon 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Stoney Tangawizi 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Pepsi 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Pepsi 500 ml", "Sodas", "BOTTLE", carton(12)),
  soft("Mirinda Orange 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Mirinda Fruity 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("7Up 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Mountain Dew 350 ml", "Sodas", "BOTTLE", crate(24)),
  soft("Schweppes Tonic Water 300 ml", "Mixers", "BOTTLE", crate(24)),
  soft("Schweppes Soda Water 300 ml", "Mixers", "BOTTLE", crate(24)),
  soft("Schweppes Ginger Ale 300 ml", "Mixers", "BOTTLE", crate(24)),
  soft("Tonic water 330 ml can", "Mixers", "CAN", carton(24)),
  soft("Red Bull 250 ml", "Energy drinks", "CAN", carton(24)),
  soft("Monster Energy 500 ml", "Energy drinks", "CAN", carton(24)),
  soft("Power Horse 250 ml", "Energy drinks", "CAN", carton(24)),
  soft("Azam Mango Juice 300 ml", "Juice", "BOTTLE", carton(12)),
  soft("Azam Orange Juice 300 ml", "Juice", "BOTTLE", carton(12)),
  soft("Azam Tropical Juice 300 ml", "Juice", "BOTTLE", carton(12)),
  soft("Ceres Orange Juice 1 L", "Juice", "BOTTLE", carton(12)),
  soft("Ceres Mango Juice 1 L", "Juice", "BOTTLE", carton(12)),
  soft("Ceres Apple Juice 1 L", "Juice", "BOTTLE", carton(12)),
  soft("Ceres Medley of Fruits 1 L", "Juice", "BOTTLE", carton(12)),
  { name: "Grenadine syrup 750 ml", category: "SOFT_DRINKS", group: "Cocktail syrups", baseUnit: "ML", packUnits: [{ name: "Bottle", baseQuantity: 750 }] },
  { name: "Lime cordial 750 ml", category: "SOFT_DRINKS", group: "Cocktail syrups", baseUnit: "ML", packUnits: [{ name: "Bottle", baseQuantity: 750 }] },
  { name: "Sugar syrup 1 L", category: "SOFT_DRINKS", group: "Cocktail syrups", baseUnit: "ML", packUnits: [{ name: "Bottle", baseQuantity: 1000 }] },

  // ------------------------------------------------------------ Water
  water("Kilimanjaro Water 500 ml", 24),
  water("Kilimanjaro Water 1 L", 12),
  water("Kilimanjaro Water 1.5 L", 12),
  water("Kilimanjaro Water 5 L", 4),
  water("Uhai Water 500 ml", 24),
  water("Uhai Water 1.5 L", 12),
  water("Dasani Water 500 ml", 24),
  water("Dasani Water 1 L", 12),
  water("Hill Water 500 ml", 24),
  water("Hill Water 1.5 L", 12),
  water("Afya Water 500 ml", 24),
  water("Sparkling water 500 ml", 24, "Sparkling water"),
  water("San Pellegrino 750 ml", 12, "Sparkling water"),
  water("Perrier 330 ml", 24, "Sparkling water"),

  // ------------------------------------------------------------ Meat
  weighed("Beef fillet", "MEAT", "Beef", 3),
  weighed("Beef sirloin", "MEAT", "Beef", 3),
  weighed("Beef T-bone", "MEAT", "Beef", 3),
  weighed("Beef rump", "MEAT", "Beef", 3),
  weighed("Beef, stewing", "MEAT", "Beef", 3),
  weighed("Beef mince", "MEAT", "Beef", 2),
  weighed("Beef ribs", "MEAT", "Beef", 3),
  weighed("Beef liver (maini)", "MEAT", "Beef", 2),
  weighed("Goat meat (mbuzi)", "MEAT", "Goat and lamb", 3),
  weighed("Goat ribs (mbavu)", "MEAT", "Goat and lamb", 3),
  weighed("Lamb chops", "MEAT", "Goat and lamb", 3),
  weighed("Pork chops", "MEAT", "Pork", 3),
  weighed("Pork ribs", "MEAT", "Pork", 3),
  weighed("Bacon", "MEAT", "Pork", 14),
  weighed("Ham", "MEAT", "Pork", 10),
  pieces("Beef sausages", "MEAT", "Sausages", [{ name: "Pack of 12", baseQuantity: 12 }], 14),
  pieces("Pork sausages", "MEAT", "Sausages", [{ name: "Pack of 12", baseQuantity: 12 }], 14),
  pieces("Chicken sausages", "MEAT", "Sausages", [{ name: "Pack of 12", baseQuantity: 12 }], 14),

  // ------------------------------------------------------------ Poultry
  pieces("Whole chicken, broiler", "POULTRY", "Chicken", [], 3),
  pieces("Whole chicken, kienyeji", "POULTRY", "Chicken", [], 3),
  weighed("Chicken breast", "POULTRY", "Chicken", 3),
  weighed("Chicken thighs", "POULTRY", "Chicken", 3),
  weighed("Chicken wings", "POULTRY", "Chicken", 3),
  weighed("Chicken drumsticks", "POULTRY", "Chicken", 3),
  weighed("Chicken gizzards", "POULTRY", "Chicken", 2),
  pieces("Whole duck", "POULTRY", "Other poultry", [], 3),

  // ------------------------------------------------------------ Fish and seafood
  pieces("Tilapia (sato), whole", "FISH_SEAFOOD", "Freshwater fish", [], 2),
  weighed("Nile perch (sangara) fillet", "FISH_SEAFOOD", "Freshwater fish", 2),
  pieces("Catfish (kambale), whole", "FISH_SEAFOOD", "Freshwater fish", [], 2),
  pieces("Red snapper, whole", "FISH_SEAFOOD", "Sea fish", [], 2),
  weighed("Kingfish (nguru) steak", "FISH_SEAFOOD", "Sea fish", 2),
  weighed("Tuna steak", "FISH_SEAFOOD", "Sea fish", 2),
  weighed("Prawns", "FISH_SEAFOOD", "Shellfish and seafood", 2),
  weighed("Tiger prawns", "FISH_SEAFOOD", "Shellfish and seafood", 2),
  weighed("Calamari (ngisi)", "FISH_SEAFOOD", "Shellfish and seafood", 2),
  weighed("Octopus (pweza)", "FISH_SEAFOOD", "Shellfish and seafood", 2),
  pieces("Lobster", "FISH_SEAFOOD", "Shellfish and seafood", [], 2),
  weighed("Crab", "FISH_SEAFOOD", "Shellfish and seafood", 2),
  weighed("Dagaa (dried sardines)", "FISH_SEAFOOD", "Dried fish", 90),

  // ------------------------------------------------------------ Fruit and vegetables
  weighed("Potatoes (viazi)", "PRODUCE", "Vegetables", 14, [{ name: "Sack", baseQuantity: 50000 }]),
  weighed("Sweet potatoes", "PRODUCE", "Vegetables", 14),
  weighed("Cassava (muhogo)", "PRODUCE", "Vegetables", 5),
  pieces("Green bananas (ndizi mbichi)", "PRODUCE", "Vegetables", [{ name: "Bunch", baseQuantity: 40 }], 7),
  pieces("Plantain", "PRODUCE", "Vegetables", [{ name: "Bunch", baseQuantity: 20 }], 7),
  weighed("Onions (vitunguu)", "PRODUCE", "Vegetables", 21, [{ name: "Net bag", baseQuantity: 10000 }]),
  weighed("Garlic (kitunguu saumu)", "PRODUCE", "Vegetables", 30),
  weighed("Ginger (tangawizi)", "PRODUCE", "Vegetables", 21),
  weighed("Tomatoes (nyanya)", "PRODUCE", "Vegetables", 5, [{ name: "Crate", baseQuantity: 20000 }]),
  weighed("Carrots", "PRODUCE", "Vegetables", 14),
  pieces("Cabbage", "PRODUCE", "Vegetables", [], 10),
  weighed("Sukuma wiki (kale)", "PRODUCE", "Vegetables", 3),
  weighed("Spinach (mchicha)", "PRODUCE", "Vegetables", 3),
  weighed("Green peppers (pilipili hoho)", "PRODUCE", "Vegetables", 7),
  pieces("Cucumber", "PRODUCE", "Vegetables", [], 7),
  pieces("Lettuce", "PRODUCE", "Vegetables", [], 5),
  weighed("Green beans", "PRODUCE", "Vegetables", 5),
  weighed("Fresh peas", "PRODUCE", "Vegetables", 5),
  weighed("Mushrooms", "PRODUCE", "Vegetables", 4),
  weighed("Coriander (dhania)", "PRODUCE", "Herbs", 4),
  weighed("Chillies (pilipili)", "PRODUCE", "Herbs", 7),
  weighed("Mint", "PRODUCE", "Herbs", 5),
  pieces("Avocado (parachichi)", "PRODUCE", "Fruit", [], 5),
  pieces("Lemons", "PRODUCE", "Fruit", [], 14),
  pieces("Limes", "PRODUCE", "Fruit", [], 14),
  pieces("Oranges (machungwa)", "PRODUCE", "Fruit", [], 14),
  pieces("Mangoes (embe)", "PRODUCE", "Fruit", [], 7),
  pieces("Pineapple (nanasi)", "PRODUCE", "Fruit", [], 7),
  pieces("Watermelon (tikiti)", "PRODUCE", "Fruit", [], 10),
  weighed("Passion fruit", "PRODUCE", "Fruit", 10),
  pieces("Pawpaw (papai)", "PRODUCE", "Fruit", [], 5),
  pieces("Ripe bananas (ndizi mbivu)", "PRODUCE", "Fruit", [{ name: "Bunch", baseQuantity: 40 }], 5),
  pieces("Coconuts (nazi)", "PRODUCE", "Fruit", [], 30),

  // ------------------------------------------------------------ Dairy and eggs
  pieces("Eggs", "DAIRY_EGGS", "Eggs", [{ name: "Tray", baseQuantity: 30 }], 21),
  { name: "Fresh milk", category: "DAIRY_EGGS", group: "Milk and cream", baseUnit: "ML", perishable: true, shelfLifeDays: 5, packUnits: [{ name: "Packet 500 ml", baseQuantity: 500 }, { name: "Litre", baseQuantity: 1000 }] },
  { name: "Long life milk", category: "DAIRY_EGGS", group: "Milk and cream", baseUnit: "ML", packUnits: [{ name: "Litre", baseQuantity: 1000 }, { name: "Carton of 12", baseQuantity: 12000 }] },
  { name: "Cooking cream", category: "DAIRY_EGGS", group: "Milk and cream", baseUnit: "ML", perishable: true, shelfLifeDays: 14, packUnits: [{ name: "Litre", baseQuantity: 1000 }] },
  { name: "Yoghurt", category: "DAIRY_EGGS", group: "Milk and cream", baseUnit: "ML", perishable: true, shelfLifeDays: 14, packUnits: [{ name: "Tub 500 ml", baseQuantity: 500 }] },
  { name: "Butter", category: "DAIRY_EGGS", group: "Butter and cheese", baseUnit: "G", perishable: true, shelfLifeDays: 30, packUnits: [{ name: "Block 500 g", baseQuantity: 500 }] },
  { name: "Margarine (Blue Band)", category: "DAIRY_EGGS", group: "Butter and cheese", baseUnit: "G", packUnits: [{ name: "Tub 500 g", baseQuantity: 500 }] },
  weighed("Cheddar cheese", "DAIRY_EGGS", "Butter and cheese", 30),
  weighed("Mozzarella cheese", "DAIRY_EGGS", "Butter and cheese", 21),
  { name: "Ice cream", category: "DAIRY_EGGS", group: "Frozen", baseUnit: "ML", perishable: true, shelfLifeDays: 60, packUnits: [{ name: "Tub 2 L", baseQuantity: 2000 }] },

  // ------------------------------------------------------------ Dry goods and pantry
  dry("Rice, Kyela", "Grains and flour", "G", [...kilo, { name: "Sack 25 kg", baseQuantity: 25000 }]),
  dry("Rice, basmati", "Grains and flour", "G", [...kilo, { name: "Bag 5 kg", baseQuantity: 5000 }]),
  dry("Maize flour (sembe)", "Grains and flour", "G", [...kilo, { name: "Bag 25 kg", baseQuantity: 25000 }]),
  dry("Wheat flour", "Grains and flour", "G", [...kilo, { name: "Bag 25 kg", baseQuantity: 25000 }]),
  dry("Pasta, spaghetti", "Grains and flour", "G", [{ name: "Pack 500 g", baseQuantity: 500 }]),
  dry("Pasta, penne", "Grains and flour", "G", [{ name: "Pack 500 g", baseQuantity: 500 }]),
  dry("Instant noodles", "Grains and flour", "PIECE", [{ name: "Carton of 40", baseQuantity: 40 }]),
  dry("Beans (maharage)", "Pulses", "G", [...kilo, { name: "Sack 50 kg", baseQuantity: 50000 }]),
  dry("Green grams (choroko)", "Pulses", "G", kilo),
  dry("Lentils (dengu)", "Pulses", "G", kilo),
  dry("Sugar", "Sugar and salt", "G", [...kilo, { name: "Bag 50 kg", baseQuantity: 50000 }]),
  dry("Sugar sachets", "Sugar and salt", "PIECE", [{ name: "Box of 1000", baseQuantity: 1000 }]),
  dry("Salt", "Sugar and salt", "G", kilo),
  dry("Sunflower cooking oil", "Oils and sauces", "ML", [{ name: "Litre", baseQuantity: 1000 }, { name: "Jerrycan 20 L", baseQuantity: 20000 }]),
  dry("Olive oil", "Oils and sauces", "ML", [{ name: "Bottle 1 L", baseQuantity: 1000 }]),
  dry("Tomato paste", "Oils and sauces", "G", [{ name: "Tin 400 g", baseQuantity: 400 }]),
  dry("Tomato ketchup", "Oils and sauces", "ML", [{ name: "Bottle 750 ml", baseQuantity: 750 }]),
  dry("Chilli sauce", "Oils and sauces", "ML", [{ name: "Bottle 750 ml", baseQuantity: 750 }]),
  dry("Mayonnaise", "Oils and sauces", "ML", [{ name: "Jar 750 ml", baseQuantity: 750 }]),
  dry("Soy sauce", "Oils and sauces", "ML", [{ name: "Bottle 500 ml", baseQuantity: 500 }]),
  dry("Vinegar", "Oils and sauces", "ML", [{ name: "Bottle 750 ml", baseQuantity: 750 }]),
  dry("Coconut milk", "Oils and sauces", "ML", [{ name: "Tin 400 ml", baseQuantity: 400 }]),
  dry("Pilau masala", "Spices", "G", [{ name: "Pack 100 g", baseQuantity: 100 }]),
  dry("Curry powder", "Spices", "G", [{ name: "Pack 100 g", baseQuantity: 100 }]),
  dry("Black pepper", "Spices", "G", [{ name: "Pack 100 g", baseQuantity: 100 }]),
  dry("Royco / beef cubes", "Spices", "PIECE", [{ name: "Box of 50", baseQuantity: 50 }]),
  dry("Baking powder", "Baking", "G", [{ name: "Tin 100 g", baseQuantity: 100 }]),
  dry("Dry yeast", "Baking", "G", [{ name: "Pack 500 g", baseQuantity: 500 }]),
  pieces("Bread loaf", "DRY_GOODS", "Bakery", [], 4),
  pieces("Burger buns", "DRY_GOODS", "Bakery", [{ name: "Pack of 6", baseQuantity: 6 }], 4),
  pieces("Hot dog rolls", "DRY_GOODS", "Bakery", [{ name: "Pack of 6", baseQuantity: 6 }], 4),
  dry("Roasted peanuts", "Bar snacks", "G", [{ name: "Pack 1 kg", baseQuantity: 1000 }]),
  dry("Cashew nuts", "Bar snacks", "G", [{ name: "Pack 1 kg", baseQuantity: 1000 }]),
  dry("Potato crisps", "Bar snacks", "PIECE", [{ name: "Carton of 24", baseQuantity: 24 }]),
  dry("Popcorn kernels", "Bar snacks", "G", kilo),

  // ------------------------------------------------------------ Coffee and tea
  dry("Africafe instant coffee", "Coffee and tea", "G", [{ name: "Tin 100 g", baseQuantity: 100 }]),
  dry("Nescafe Classic", "Coffee and tea", "G", [{ name: "Tin 200 g", baseQuantity: 200 }]),
  dry("Ground coffee, Tanzanian arabica", "Coffee and tea", "G", [{ name: "Pack 500 g", baseQuantity: 500 }, { name: "Pack 1 kg", baseQuantity: 1000 }]),
  dry("Coffee beans", "Coffee and tea", "G", [{ name: "Pack 1 kg", baseQuantity: 1000 }]),
  dry("Chai Bora tea bags", "Coffee and tea", "PIECE", [{ name: "Box of 100", baseQuantity: 100 }]),
  dry("Green tea bags", "Coffee and tea", "PIECE", [{ name: "Box of 100", baseQuantity: 100 }]),
  dry("Loose black tea", "Coffee and tea", "G", [{ name: "Pack 500 g", baseQuantity: 500 }]),
  dry("Hot chocolate powder", "Coffee and tea", "G", [{ name: "Tin 500 g", baseQuantity: 500 }]),
];

/** Browse order for the picker. Categories not listed fall to the end. */
export const CATALOGUE_CATEGORY_ORDER = [
  "BEER", "SPIRITS", "WINE", "SOFT_DRINKS", "WATER",
  "MEAT", "POULTRY", "FISH_SEAFOOD", "PRODUCE", "DAIRY_EGGS", "DRY_GOODS", "OTHER",
];
