// engine.js — pure nutrition / pantry / planning logic (no React, no network).
// Everything quantity-related is done in grams internally (ml treated as g),
// and converted to/from whatever unit a pantry item uses.

/* ───────────────────────────── slots ───────────────────────────── */

export const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
export const SLOT_META = {
  breakfast: { label: "Breakfast", emoji: "🍳", share: 0.25 },
  lunch: { label: "Lunch", emoji: "🍛", share: 0.35 },
  dinner: { label: "Dinner", emoji: "🌙", share: 0.30 },
  snack: { label: "Snack", emoji: "🥜", share: 0.10 },
};

/* ───────────────────────────── dates (local, not UTC) ───────────────────────────── */

const pad2 = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseISO = (iso) => new Date(iso + "T12:00:00");
export const addDaysISO = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
export const daysBetween = (fromISO, toISO) => Math.round((parseISO(toISO) - parseISO(fromISO)) / 86400000);

/* ───────────────────────────── foods (per 100 g, raw/dry as bought) ───────────────────────────── */
// pc = grams per piece, pk = typical pack size in grams, count = shown/bought as pieces,
// al = names it can match in the pantry, x = words that rule a match out.

const F = (key, name, kcal, p, c, f, o = {}) => ({
  key, name, kcal, p, c, f,
  pc: o.pc || 0, pk: o.pk || 500, cat: o.cat || "Produce",
  count: !!o.count, liquid: !!o.liquid, u: o.u || null,
  al: o.al || [name.toLowerCase()], x: o.x || [],
});

const FOOD_LIST = [
  F("rice", "Rice", 360, 7, 79, 0.6, { pk: 1000, cat: "Pantry", al: ["rice", "basmati", "sona masoori", "jasmine"], x: ["flour", "noodle", "bran", "cake", "cracker"] }),
  F("atta", "Atta (wheat flour)", 340, 12, 72, 1.7, { pk: 2000, cat: "Pantry", al: ["atta", "wheat flour", "whole wheat flour", "chapati flour", "roti flour"] }),
  F("oats", "Oats", 380, 13, 67, 7, { pk: 500, cat: "Pantry", al: ["oats", "oatmeal", "rolled oats"] }),
  F("poha", "Poha", 350, 6.6, 77, 1.2, { pk: 500, cat: "Pantry", al: ["poha", "flattened rice", "aval", "beaten rice"] }),
  F("rava", "Rava (semolina)", 360, 12.5, 73, 1.1, { pk: 500, cat: "Pantry", al: ["rava", "suji", "sooji", "semolina", "upma rava"] }),
  F("besan", "Besan (gram flour)", 387, 22, 58, 6.7, { pk: 500, cat: "Pantry", al: ["besan", "gram flour", "chickpea flour"] }),
  F("moong", "Moong dal", 347, 24, 60, 1.2, { pk: 500, cat: "Pantry", al: ["moong", "mung", "green gram"] }),
  F("toor", "Toor dal", 343, 22, 63, 1.5, { pk: 500, cat: "Pantry", al: ["toor", "tur dal", "arhar", "pigeon pea"] }),
  F("chanadal", "Chana dal", 364, 21, 61, 5.6, { pk: 500, cat: "Pantry", al: ["chana dal", "bengal gram"] }),
  F("masoor", "Masoor dal", 353, 25, 60, 1.1, { pk: 500, cat: "Pantry", al: ["masoor", "red lentil"] }),
  F("chickpea", "Chickpeas (chole)", 364, 19, 61, 6, { pk: 500, cat: "Pantry", al: ["chickpea", "chole", "kabuli", "garbanzo", "chana"] }),
  F("rajma", "Rajma", 337, 24, 60, 0.8, { pk: 500, cat: "Pantry", al: ["rajma", "kidney bean"] }),
  F("soya", "Soya chunks", 345, 52, 33, 0.5, { pk: 200, cat: "Pantry", al: ["soya chunk", "soy chunk", "nutrela", "soya", "soy"] }),
  F("peanut", "Peanuts", 567, 26, 16, 49, { pk: 400, cat: "Pantry", al: ["peanut", "groundnut"], x: ["oil", "butter"] }),
  F("pb", "Peanut butter", 588, 25, 20, 50, { pk: 340, cat: "Pantry", al: ["peanut butter"] }),
  F("almond", "Almonds", 579, 21, 22, 50, { pk: 200, cat: "Pantry", al: ["almond", "badam"] }),
  F("paneer", "Paneer", 296, 18, 3.4, 23, { pk: 200, cat: "Dairy", al: ["paneer", "cottage cheese"] }),
  F("curd", "Curd (yogurt)", 61, 3.5, 4.7, 3.3, { pk: 500, cat: "Dairy", al: ["curd", "yogurt", "yoghurt", "dahi"] }),
  F("milk", "Milk", 61, 3.2, 4.8, 3.3, { pk: 1000, cat: "Dairy", liquid: true, al: ["milk"], x: ["coconut", "almond", "soy", "soya", "oat", "powder"] }),
  F("ghee", "Ghee", 900, 0, 0, 100, { pk: 500, cat: "Pantry", al: ["ghee", "clarified butter"] }),
  F("oil", "Cooking oil", 884, 0, 0, 100, { pk: 1000, cat: "Pantry", liquid: true, al: ["oil"] }),
  F("egg", "Eggs", 143, 12.6, 0.7, 9.5, { pc: 50, pk: 600, cat: "Dairy", count: true, u: ["egg", "eggs"], al: ["egg"] }),
  F("bread", "Bread", 250, 9, 45, 3.5, { pc: 30, pk: 400, cat: "Bakery", count: true, u: ["slice", "slices"], al: ["bread", "toast"] }),
  F("potato", "Potato", 77, 2, 17, 0.1, { pc: 150, pk: 1500, al: ["potato", "aloo"] }),
  F("onion", "Onion", 40, 1.1, 9.3, 0.1, { pc: 110, pk: 1000, al: ["onion", "pyaz"] }),
  F("tomato", "Tomato", 18, 0.9, 3.9, 0.2, { pc: 120, pk: 500, al: ["tomato"] }),
  F("okra", "Okra (bhindi)", 33, 1.9, 7.5, 0.2, { pk: 250, al: ["okra", "bhindi", "lady finger", "ladies finger"] }),
  F("eggplant", "Eggplant (brinjal)", 25, 1, 6, 0.2, { pc: 150, pk: 500, al: ["eggplant", "brinjal", "baingan", "aubergine"] }),
  F("cauliflower", "Cauliflower", 25, 1.9, 5, 0.3, { pc: 600, pk: 600, al: ["cauliflower", "gobi", "gobhi"] }),
  F("spinach", "Spinach (palak)", 23, 2.9, 3.6, 0.4, { pk: 250, al: ["spinach", "palak"] }),
  F("cabbage", "Cabbage", 25, 1.3, 5.8, 0.1, { pk: 600, al: ["cabbage"] }),
  F("carrot", "Carrot", 41, 0.9, 10, 0.2, { pc: 60, pk: 500, al: ["carrot", "gajar"] }),
  F("peas", "Green peas", 81, 5, 14, 0.4, { pk: 400, al: ["pea", "matar", "green pea"] }),
  F("capsicum", "Capsicum", 20, 0.9, 4.6, 0.2, { pc: 120, pk: 300, al: ["capsicum", "bell pepper", "green pepper", "shimla mirch"] }),
  F("cucumber", "Cucumber", 15, 0.7, 3.6, 0.1, { pc: 200, pk: 400, al: ["cucumber", "kheera"] }),
  F("bottlegourd", "Bottle gourd (lauki)", 14, 0.6, 3.4, 0, { pk: 600, al: ["bottle gourd", "lauki", "dudhi", "doodhi"] }),
  F("banana", "Banana", 89, 1.1, 23, 0.3, { pc: 120, pk: 700, count: true, u: ["banana", "bananas"], al: ["banana"] }),
  F("apple", "Apple", 52, 0.3, 14, 0.2, { pc: 180, pk: 900, count: true, u: ["apple", "apples"], al: ["apple"] }),
];

export const FOODS = Object.fromEntries(FOOD_LIST.map((f) => [f.key, f]));

/* ───────────────────────────── matching pantry names → foods ───────────────────────────── */

const stem = (w) => (w.length <= 3 ? w : w.replace(/oes$/, "o").replace(/ies$/, "y").replace(/([^s])s$/, "$1"));
const toks = (s) => String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).map(stem);
for (const f of FOOD_LIST) { f._al = f.al.map(toks); f._x = f.x.map(stem); }

const matchCache = new Map();
export function matchFood(name) {
  const keyName = String(name || "");
  if (matchCache.has(keyName)) return matchCache.get(keyName);
  const t = toks(keyName);
  let best = null, bestScore = 0;
  for (const food of FOOD_LIST) {
    if (food._x.some((w) => t.includes(w))) continue;
    for (const a of food._al) {
      if (!a.length) continue;
      for (let i = 0; i + a.length <= t.length; i++) {
        let ok = true;
        for (let j = 0; j < a.length; j++) if (t[i + j] !== a[j]) { ok = false; break; }
        if (ok) {
          const sc = a.length * 100 + a.join("").length;
          if (sc > bestScore) { bestScore = sc; best = food.key; }
        }
      }
    }
  }
  matchCache.set(keyName, best);
  return best;
}

/* ───────────────────────────── units ───────────────────────────── */

const U_G = { g: 1, gm: 1, gms: 1, gram: 1, grams: 1, kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592, oz: 28.3495, ounce: 28.3495, ounces: 28.3495 };
const U_ML = { ml: 1, l: 1000, lt: 1000, ltr: 1000, liter: 1000, litre: 1000, liters: 1000, litres: 1000, cup: 240, cups: 240, tbsp: 15, tsp: 5, floz: 29.57, gal: 3785, gallon: 3785 };
const U_COUNT = new Set(["", "pcs", "pc", "piece", "pieces", "each", "unit", "units", "ct", "count", "no", "nos", "slice", "slices"]);
const normUnit = (u) => String(u || "").toLowerCase().replace(/[.\s]/g, "");

export function qtyToGrams(qty, unit, key) {
  const f = FOODS[key];
  const q = Number(qty) || 0;
  const u = normUnit(unit);
  if (U_G[u]) return q * U_G[u];
  if (U_ML[u]) return q * U_ML[u];
  if (u === "dozen") return q * 12 * ((f && (f.pc || f.pk)) || 100);
  if (U_COUNT.has(u)) return q * ((f && (f.pc || f.pk)) || 100);
  return q * ((f && f.pk) || 100); // pack / bag / bunch / can …
}
export function gramsToQty(grams, unit, key) {
  const per = qtyToGrams(1, unit, key) || 1;
  return grams / per;
}
const round2 = (x) => Math.round(x * 100) / 100;

// Friendly amount text for UI
export function fmtAmount(key, g) {
  const f = FOODS[key];
  if (f && f.count && f.pc && f.u) {
    const n = Math.max(1, Math.round(g / f.pc));
    return `${n} ${n === 1 ? f.u[0] : f.u[1]}`;
  }
  const unit = f && f.liquid ? "ml" : "g";
  if (g >= 1000) return `${round2(g / 1000)} ${unit === "ml" ? "L" : "kg"}`;
  const r = g < 100 ? Math.round(g / 5) * 5 : Math.round(g / 10) * 10;
  return `${Math.max(5, r)} ${unit}`;
}

/* ───────────────────────────── recipes ───────────────────────────── */

const R = (id, name, slots, desc, ing, steps) => ({
  id, name, slots, desc, ing: ing.map(([k, g]) => ({ k, g })), steps, src: "lib",
});

export const LIBRARY = [
  R("besan-chilla", "Besan chilla with curd", ["breakfast", "snack"], "Savoury gram-flour pancakes with curd",
    [["besan", 60], ["onion", 40], ["tomato", 40], ["oil", 8], ["curd", 150]],
    ["Whisk besan with water, salt, turmeric and chili into a pourable batter; fold in chopped onion and tomato.", "Spread a ladle of batter thin on a hot oiled pan.", "Cook both sides until golden; serve with curd."]),
  R("egg-bhurji-toast", "Egg bhurji with toast", ["breakfast"], "Spiced scrambled eggs, 3 slices of toast",
    [["egg", 150], ["onion", 50], ["tomato", 50], ["oil", 10], ["bread", 90]],
    ["Sauté chopped onion and tomato with spices in oil.", "Add beaten eggs and stir until just set.", "Toast the bread and serve alongside."]),
  R("poha-peanuts", "Poha with peanuts", ["breakfast"], "Light flattened rice with peanuts and potato",
    [["poha", 80], ["peanut", 25], ["onion", 40], ["potato", 50], ["oil", 10]],
    ["Rinse poha and drain; fry peanuts in oil until crisp.", "Add mustard, onion and diced potato; cook until soft.", "Fold in poha with turmeric and salt, steam 2 minutes."]),
  R("moong-chilla-paneer", "Moong chilla with paneer", ["breakfast", "lunch"], "High-protein lentil crepes stuffed with paneer",
    [["moong", 70], ["paneer", 50], ["onion", 30], ["oil", 8]],
    ["Soak and grind moong dal with chili and ginger into a batter.", "Spread on a hot oiled pan into thin crepes.", "Fill with crumbled paneer and onion, fold and serve."]),
  R("oats-pb-banana", "Peanut-butter banana oats", ["breakfast", "snack"], "Creamy oats cooked in milk with banana",
    [["oats", 80], ["milk", 300], ["banana", 120], ["pb", 30]],
    ["Simmer oats in milk for 5 minutes, stirring.", "Stir in peanut butter until melted.", "Top with sliced banana."]),
  R("paneer-paratha", "Paneer paratha with curd", ["breakfast", "lunch"], "Stuffed wheat flatbread with curd",
    [["atta", 90], ["paneer", 70], ["oil", 10], ["curd", 150]],
    ["Knead atta dough; mix crumbled paneer with spices.", "Stuff dough balls, roll out gently.", "Cook on a hot pan with oil until golden; serve with curd."]),
  R("veg-upma", "Vegetable upma", ["breakfast"], "Savoury semolina with peas and peanuts",
    [["rava", 80], ["peas", 40], ["onion", 40], ["peanut", 15], ["oil", 10]],
    ["Dry-roast rava until fragrant and set aside.", "Temper mustard in oil, add onion, peas and peanuts.", "Add hot water and salt, stir in rava and cover for 3 minutes."]),
  R("dal-tadka-rice", "Dal tadka with rice", ["lunch", "dinner"], "Toor dal tempered with ghee, steamed rice",
    [["toor", 70], ["rice", 90], ["ghee", 8], ["onion", 30], ["tomato", 40]],
    ["Pressure-cook toor dal with turmeric until soft; cook rice separately.", "Fry cumin, onion and tomato in ghee for the tadka.", "Pour tadka over the dal and serve with rice."]),
  R("rajma-chawal", "Rajma chawal", ["lunch", "dinner"], "Kidney bean curry with rice",
    [["rajma", 70], ["rice", 90], ["onion", 50], ["tomato", 80], ["oil", 10]],
    ["Soak rajma overnight and pressure-cook until very soft.", "Cook onion-tomato masala in oil, add rajma and simmer 15 minutes.", "Serve over steamed rice."]),
  R("chole-roti", "Chole with roti", ["lunch", "dinner"], "Spiced chickpea curry with 3 rotis",
    [["chickpea", 80], ["atta", 80], ["onion", 50], ["tomato", 80], ["oil", 12]],
    ["Soak chickpeas overnight and pressure-cook until soft.", "Simmer in onion-tomato masala for 15 minutes.", "Make rotis and serve hot."]),
  R("palak-paneer-roti", "Palak paneer with roti", ["lunch", "dinner"], "Paneer in spinach gravy, 3 rotis",
    [["paneer", 100], ["spinach", 200], ["atta", 80], ["oil", 12], ["onion", 40]],
    ["Blanch spinach and blend to a purée.", "Sauté onion and spices in oil, add purée and simmer.", "Add paneer cubes for 3 minutes; serve with rotis."]),
  R("paneer-bhurji-roti", "Paneer bhurji with roti", ["lunch", "dinner"], "Spiced scrambled paneer, 3 rotis",
    [["paneer", 120], ["onion", 60], ["tomato", 80], ["atta", 80], ["oil", 10]],
    ["Sauté onion and tomato with spices in oil.", "Crumble in paneer and cook 4 minutes.", "Serve with fresh rotis."]),
  R("soya-curry-rice", "Soya chunk curry with rice", ["lunch", "dinner"], "Protein-rich soya in onion-tomato gravy",
    [["soya", 50], ["rice", 90], ["onion", 50], ["tomato", 80], ["oil", 10]],
    ["Soak soya chunks in hot water, squeeze dry.", "Cook onion-tomato masala in oil, add soya and a little water.", "Simmer 10 minutes; serve with rice."]),
  R("egg-curry-rice", "Egg curry with rice", ["lunch", "dinner"], "4 boiled eggs in masala gravy",
    [["egg", 200], ["rice", 90], ["onion", 60], ["tomato", 80], ["oil", 12]],
    ["Hard-boil the eggs, peel and slit lightly.", "Cook onion-tomato masala in oil until oily at the edges.", "Add eggs and simmer 5 minutes; serve with rice."]),
  R("bhindi-dal-roti", "Bhindi masala, moong dal and roti", ["lunch", "dinner"], "Dry okra with a light dal and 3 rotis",
    [["okra", 200], ["moong", 50], ["atta", 80], ["oil", 12], ["onion", 40]],
    ["Cook moong dal with turmeric until soft and temper it.", "Stir-fry sliced okra with onion and spices until dry.", "Serve both with rotis."]),
  R("aloo-gobi-roti", "Aloo gobi with roti and curd", ["lunch", "dinner"], "Potato-cauliflower sabzi, 3 rotis, curd",
    [["potato", 150], ["cauliflower", 150], ["atta", 80], ["oil", 12], ["curd", 150]],
    ["Fry cumin in oil, add potato and cauliflower with turmeric.", "Cover and cook on low heat until tender.", "Serve with rotis and curd."]),
  R("veg-pulao-curd", "Paneer vegetable pulao with curd", ["lunch", "dinner"], "One-pot rice with peas, carrot and paneer",
    [["rice", 90], ["peas", 50], ["carrot", 50], ["onion", 40], ["paneer", 50], ["oil", 12], ["curd", 150]],
    ["Fry whole spices and onion in oil, add vegetables and paneer.", "Add washed rice and water (1:1.5), salt and cover.", "Cook until fluffy; serve with curd."]),
  R("baingan-bharta-roti", "Baingan bharta with roti and curd", ["lunch", "dinner"], "Smoky mashed eggplant, 3 rotis, curd",
    [["eggplant", 250], ["onion", 60], ["tomato", 80], ["atta", 90], ["oil", 14], ["curd", 150]],
    ["Roast the eggplant over flame or in the oven; peel and mash.", "Cook onion and tomato with spices in oil, add the mash.", "Serve with rotis and curd."]),
  R("lauki-chana-dal-roti", "Lauki chana dal with roti", ["lunch", "dinner"], "Bottle gourd cooked with chana dal, 3 rotis",
    [["bottlegourd", 200], ["chanadal", 60], ["atta", 80], ["oil", 10]],
    ["Soak chana dal 30 minutes.", "Pressure-cook with cubed lauki, turmeric and salt.", "Temper with cumin and chili; serve with rotis."]),
  R("khichdi-curd", "Moong dal khichdi with curd", ["lunch", "dinner"], "Comfort rice-and-lentil khichdi with ghee",
    [["rice", 60], ["moong", 60], ["ghee", 12], ["curd", 150], ["peas", 30]],
    ["Rinse rice and moong together.", "Pressure-cook with peas, turmeric and salt until mushy.", "Top with ghee and serve with curd."]),
  R("egg-fried-rice", "Egg vegetable fried rice", ["lunch", "dinner"], "Wok-tossed rice with eggs and vegetables",
    [["rice", 90], ["egg", 100], ["carrot", 40], ["cabbage", 60], ["capsicum", 40], ["oil", 12]],
    ["Cook rice ahead and cool it.", "Scramble eggs in hot oil, push aside, stir-fry the vegetables.", "Add rice and soy-free seasoning, toss on high heat."]),
  R("masoor-dal-rice", "Masoor dal, rice and cucumber salad", ["lunch", "dinner"], "Quick red lentil dal with rice",
    [["masoor", 70], ["rice", 90], ["onion", 30], ["tomato", 40], ["oil", 10], ["cucumber", 100]],
    ["Boil masoor with turmeric until soft (15 minutes).", "Temper with cumin, onion and tomato in oil.", "Serve with rice and sliced cucumber."]),
  R("paneer-capsicum-wrap", "Paneer capsicum roti wrap", ["lunch", "dinner"], "Spiced paneer and capsicum rolled in rotis",
    [["paneer", 100], ["capsicum", 80], ["onion", 40], ["atta", 90], ["oil", 10], ["curd", 100]],
    ["Stir-fry paneer, capsicum and onion with spices.", "Roll out rotis and cook lightly.", "Fill, roll up and serve with curd."]),
  R("chole-rice", "Chana masala with rice", ["lunch", "dinner"], "Chickpeas in tomato masala over rice",
    [["chickpea", 80], ["rice", 90], ["onion", 50], ["tomato", 80], ["oil", 10]],
    ["Pressure-cook soaked chickpeas until soft.", "Simmer in onion-tomato masala for 15 minutes.", "Serve over rice."]),
  R("sprouts-chaat", "Moong sprouts chaat", ["snack"], "Fresh sprouts with onion, tomato, cucumber",
    [["moong", 50], ["onion", 30], ["tomato", 40], ["cucumber", 50]],
    ["Soak moong overnight, drain and sprout 12–24 hours (or boil lightly).", "Toss with chopped onion, tomato and cucumber.", "Season with lemon, chaat masala and salt."]),
  R("peanut-banana", "Roasted peanuts and banana", ["snack"], "Quick energy-dense snack",
    [["peanut", 40], ["banana", 120]],
    ["Dry-roast peanuts until fragrant.", "Eat with a ripe banana."]),
  R("curd-almonds", "Curd with almonds", ["snack"], "Thick curd topped with crushed almonds",
    [["curd", 250], ["almond", 20]],
    ["Whisk curd until smooth.", "Top with crushed almonds."]),
  R("pb-toast-milk", "Peanut-butter toast with milk", ["snack", "breakfast"], "Two slices of toast and a glass of milk",
    [["bread", 60], ["pb", 30], ["milk", 250]],
    ["Toast the bread.", "Spread peanut butter generously.", "Serve with cold or warm milk."]),
  R("boiled-eggs-apple", "Boiled eggs and apple", ["snack"], "2 eggs with a crisp apple",
    [["egg", 100], ["apple", 180]],
    ["Boil eggs for 9 minutes, cool and peel.", "Season with salt and pepper; eat with the apple."]),
  R("paneer-cucumber", "Paneer cubes with cucumber", ["snack"], "Chaat-masala paneer with cucumber",
    [["paneer", 80], ["cucumber", 100]],
    ["Cube paneer and pan-sear lightly.", "Toss with cucumber, chaat masala and lemon."]),
  // ── more breakfasts ──
  R("aloo-paratha-curd", "Aloo paratha with curd", ["breakfast", "lunch"], "Potato-stuffed flatbreads with a bowl of curd",
    [["atta", 90], ["potato", 150], ["oil", 10], ["curd", 150]],
    ["Boil and mash the potato with salt, chili and cumin.", "Stuff into rolled dough, seal and roll out gently.", "Cook on a hot tawa with oil until golden; serve with curd."]),
  R("masala-omelette-toast", "Masala omelette with toast", ["breakfast"], "3-egg omelette with onion and tomato, 3 slices of toast",
    [["egg", 150], ["onion", 40], ["tomato", 40], ["oil", 8], ["bread", 90]],
    ["Beat eggs with chopped onion, tomato, chili and salt.", "Cook in a hot oiled pan until set, fold over.", "Serve with toast."]),
  R("bread-upma", "Bread upma", ["breakfast"], "Toasted bread cubes tossed with onion, tomato and peanuts",
    [["bread", 120], ["onion", 50], ["tomato", 60], ["peanut", 20], ["oil", 10]],
    ["Cube the bread. Fry peanuts in oil with mustard seeds.", "Add onion and tomato, cook until soft with turmeric and salt.", "Toss in the bread until coated and lightly crisp."]),
  R("oats-apple-almond", "Apple almond oats", ["breakfast", "snack"], "Milk-cooked oats with apple and almonds",
    [["oats", 70], ["milk", 300], ["apple", 180], ["almond", 20]],
    ["Simmer oats in milk for 4–5 minutes.", "Stir in chopped apple and a pinch of cinnamon.", "Top with chopped almonds."]),
  R("besan-toast", "Besan bread toast", ["breakfast", "snack"], "Bread dipped in spiced gram-flour batter and pan-fried",
    [["bread", 90], ["besan", 50], ["onion", 30], ["capsicum", 30], ["oil", 10]],
    ["Whisk besan with water, salt, turmeric, onion and capsicum into a thick batter.", "Coat one side of each slice.", "Pan-fry batter-side down in oil, flip and crisp."]),
  R("rava-uttapam", "Rava uttapam", ["breakfast"], "Thick semolina-curd pancakes topped with vegetables",
    [["rava", 80], ["curd", 100], ["onion", 40], ["tomato", 40], ["capsicum", 30], ["oil", 10]],
    ["Mix rava, curd, salt and water; rest 15 minutes.", "Pour thick rounds on an oiled pan and scatter the vegetables on top.", "Cook covered, flip once and brown."]),
  R("paneer-sandwich", "Grilled paneer sandwich", ["breakfast", "lunch"], "Four slices filled with spiced paneer and capsicum",
    [["bread", 120], ["paneer", 80], ["capsicum", 40], ["onion", 30], ["ghee", 8]],
    ["Crumble paneer with chopped capsicum, onion, salt and chaat masala.", "Fill between bread slices.", "Toast in ghee on a pan until crisp on both sides."]),
  R("egg-paratha", "Egg paratha roll", ["breakfast", "lunch"], "Flatbread cooked onto an omelette and rolled with onion",
    [["atta", 90], ["egg", 100], ["onion", 40], ["oil", 10]],
    ["Roll and half-cook two parathas.", "Pour beaten egg in the pan, press a paratha on top and flip when set.", "Fill with sliced onion and lemon, roll up."]),
  R("poha-peas-curd", "Kanda poha with peas and curd", ["breakfast"], "Onion poha with green peas, curd on the side",
    [["poha", 80], ["peas", 40], ["onion", 50], ["oil", 10], ["curd", 150]],
    ["Rinse poha and drain.", "Temper mustard seeds and curry leaves, cook onion and peas with turmeric.", "Fold in poha, steam 2 minutes; serve with curd."]),
  R("french-toast", "Masala French toast", ["breakfast"], "Savoury egg-soaked bread, pan-fried",
    [["bread", 120], ["egg", 100], ["milk", 60], ["oil", 10]],
    ["Beat eggs with milk, salt, pepper and chili.", "Soak each slice briefly.", "Fry in oil until golden on both sides."]),
  R("banana-almond-shake", "Banana almond shake", ["breakfast", "snack"], "Thick milkshake with peanut butter",
    [["milk", 350], ["banana", 120], ["almond", 20], ["pb", 15]],
    ["Blend everything until smooth.", "Drink straight away."]),
  // ── more mains ──
  R("kadhi-rice", "Kadhi chawal", ["lunch", "dinner"], "Tangy curd-and-besan kadhi over rice",
    [["besan", 30], ["curd", 250], ["rice", 90], ["oil", 8], ["onion", 30]],
    ["Whisk curd, besan, turmeric and water until smooth.", "Simmer 15–20 minutes, stirring, until it thickens.", "Temper with cumin, onion and chili; serve over rice."]),
  R("aloo-matar-roti", "Aloo matar with roti", ["lunch", "dinner"], "Potato and peas in tomato gravy, 3 rotis",
    [["potato", 150], ["peas", 80], ["tomato", 80], ["onion", 40], ["atta", 80], ["oil", 12]],
    ["Cook onion and tomato with spices into a masala.", "Add cubed potato, peas and water; simmer until tender.", "Serve with fresh rotis."]),
  R("matar-paneer-rice", "Matar paneer with rice", ["lunch", "dinner"], "Paneer and peas in tomato gravy over rice",
    [["paneer", 100], ["peas", 80], ["tomato", 100], ["onion", 50], ["rice", 90], ["oil", 10]],
    ["Cook rice.", "Blend and cook onion and tomato with spices until the oil separates.", "Add peas and paneer cubes, simmer 5 minutes."]),
  R("cabbage-masoor-roti", "Cabbage peas sabzi, masoor dal and roti", ["lunch", "dinner"], "Dry cabbage stir-fry with a quick red lentil dal",
    [["cabbage", 200], ["peas", 50], ["masoor", 50], ["atta", 80], ["oil", 12]],
    ["Boil masoor with turmeric until soft; temper with cumin.", "Stir-fry shredded cabbage and peas with mustard seeds until just tender.", "Serve both with rotis."]),
  R("chana-dal-rice", "Chana dal fry with rice", ["lunch", "dinner"], "Nutty chana dal tempered in ghee",
    [["chanadal", 70], ["rice", 90], ["onion", 40], ["tomato", 50], ["ghee", 8]],
    ["Pressure-cook soaked chana dal until soft but whole.", "Fry onion and tomato in ghee with cumin and garam masala.", "Combine, simmer 5 minutes; serve with rice."]),
  R("dal-palak-rice", "Dal palak with rice", ["lunch", "dinner"], "Toor dal cooked with spinach",
    [["toor", 60], ["spinach", 150], ["rice", 90], ["ghee", 8], ["tomato", 40]],
    ["Cook toor dal with turmeric and tomato until soft.", "Stir in chopped spinach and simmer 5 minutes.", "Temper with ghee, cumin and garlic; serve with rice."]),
  R("egg-bhurji-roti", "Egg bhurji with roti", ["lunch", "dinner"], "Spiced scrambled eggs with 3 rotis",
    [["egg", 150], ["onion", 50], ["tomato", 60], ["atta", 80], ["oil", 10]],
    ["Make rotis.", "Cook onion, tomato and chili in oil until soft.", "Add beaten eggs and scramble until just set."]),
  R("soya-pulao-curd", "Soya pulao with curd", ["lunch", "dinner"], "One-pot rice with soya chunks and vegetables",
    [["soya", 40], ["rice", 90], ["peas", 40], ["carrot", 40], ["onion", 40], ["oil", 10], ["curd", 150]],
    ["Soak soya chunks in hot water, squeeze dry.", "Fry onion with whole spices, add vegetables, soya and rice.", "Add water, cook covered until fluffy; serve with curd."]),
  R("paneer-tomato-roti", "Paneer tomato masala with roti", ["lunch", "dinner"], "Paneer in a rich tomato gravy, 3 rotis",
    [["paneer", 120], ["tomato", 150], ["onion", 50], ["ghee", 10], ["atta", 80]],
    ["Cook onion and tomato in ghee until soft; blend smooth.", "Simmer with kasuri methi and garam masala.", "Add paneer cubes for 3 minutes; serve with rotis."]),
  R("aloo-palak-roti", "Aloo palak with roti and curd", ["lunch", "dinner"], "Potato and spinach sabzi, 3 rotis, curd",
    [["potato", 150], ["spinach", 200], ["atta", 80], ["oil", 12], ["curd", 150]],
    ["Fry cubed potato in oil with cumin until nearly done.", "Add chopped spinach and garlic; cook until wilted and dry.", "Serve with rotis and curd."]),
  R("gobi-matar-dal-rice", "Gobi matar with toor dal and rice", ["lunch", "dinner"], "Cauliflower-peas sabzi with dal and rice",
    [["cauliflower", 200], ["peas", 60], ["toor", 50], ["rice", 80], ["oil", 12]],
    ["Cook toor dal and rice.", "Stir-fry cauliflower and peas with turmeric and cumin, covered, until tender.", "Temper the dal and serve together."]),
  R("aloo-baingan-roti", "Aloo baingan with roti", ["lunch", "dinner"], "Eggplant and potato sabzi, 3 rotis",
    [["eggplant", 200], ["potato", 120], ["tomato", 60], ["atta", 80], ["oil", 14]],
    ["Fry cubed potato in oil for 5 minutes.", "Add eggplant, tomato and spices; cook covered until soft.", "Serve with rotis."]),
  R("masoor-veg-khichdi", "Masoor vegetable khichdi", ["lunch", "dinner"], "Red lentil and rice khichdi with carrot and peas",
    [["rice", 70], ["masoor", 60], ["carrot", 50], ["peas", 40], ["ghee", 10], ["curd", 100]],
    ["Rinse rice and masoor together.", "Pressure-cook with vegetables, turmeric and plenty of water until soft.", "Finish with ghee and cumin; serve with curd."]),
  R("chana-palak-rice", "Chickpea spinach curry with rice", ["lunch", "dinner"], "Chickpeas simmered with spinach",
    [["chickpea", 70], ["spinach", 150], ["onion", 40], ["tomato", 60], ["rice", 80], ["oil", 10]],
    ["Pressure-cook soaked chickpeas until soft.", "Cook onion and tomato masala, add chickpeas and chopped spinach.", "Simmer 10 minutes; serve over rice."]),
  R("besan-capsicum-roti", "Besan capsicum sabzi with roti and curd", ["lunch", "dinner"], "Capsicum coated in roasted gram flour",
    [["capsicum", 200], ["besan", 40], ["atta", 80], ["oil", 12], ["curd", 150]],
    ["Dry-roast besan until fragrant.", "Stir-fry capsicum in oil with spices until just soft, then toss with the besan.", "Serve with rotis and curd."]),
  R("lauki-moong-rice", "Lauki moong dal with rice", ["lunch", "dinner"], "Light bottle-gourd dal with ghee",
    [["bottlegourd", 200], ["moong", 60], ["rice", 80], ["ghee", 8], ["tomato", 40]],
    ["Cook moong dal with cubed lauki, tomato and turmeric until soft.", "Temper with ghee, cumin and ginger.", "Serve with rice."]),
  R("egg-pulao-curd", "Egg pulao with curd", ["lunch", "dinner"], "Spiced rice with 3 boiled eggs",
    [["egg", 150], ["rice", 90], ["onion", 60], ["peas", 30], ["oil", 12], ["curd", 100]],
    ["Boil and peel the eggs; fry lightly with chili powder.", "Brown onion with whole spices, add rice, peas and water.", "Cook covered, fold in the eggs; serve with curd."]),
  R("paneer-fried-rice", "Paneer fried rice", ["lunch", "dinner"], "Wok-tossed rice with paneer and vegetables",
    [["rice", 90], ["paneer", 80], ["carrot", 40], ["cabbage", 60], ["capsicum", 40], ["oil", 12]],
    ["Cook rice and cool it.", "Sear paneer cubes; stir-fry vegetables on high heat.", "Add rice, paneer, salt and pepper; toss well."]),
  R("curd-rice-peanut", "Curd rice with peanuts and cucumber", ["lunch", "dinner"], "Cooling curd rice with a crunchy tempering",
    [["rice", 80], ["curd", 250], ["peanut", 20], ["cucumber", 100], ["oil", 6]],
    ["Cook rice soft and mash lightly; cool.", "Mix with curd, salt and chopped cucumber.", "Temper mustard seeds, curry leaves and peanuts in oil; pour over."]),
  R("soya-bhurji-roti", "Soya bhurji with roti", ["lunch", "dinner"], "Minced soya scramble with capsicum, 3 rotis",
    [["soya", 50], ["onion", 50], ["tomato", 60], ["capsicum", 40], ["atta", 80], ["oil", 10]],
    ["Soak soya chunks, squeeze and pulse to a coarse mince.", "Cook onion, tomato and capsicum with spices.", "Add soya, fry 5 minutes; serve with rotis."]),
  R("bhindi-toor-rice", "Bhindi fry with toor dal and rice", ["lunch", "dinner"], "Crisp okra with dal and rice",
    [["okra", 150], ["toor", 60], ["rice", 80], ["oil", 12], ["onion", 30]],
    ["Cook toor dal and rice.", "Fry sliced okra in oil, uncovered, until crisp; add onion and spices.", "Temper the dal and serve together."]),
  R("tomato-rice-eggs", "Tomato rice with boiled eggs", ["lunch", "dinner"], "Tangy tomato rice with peanuts and 2 eggs",
    [["rice", 90], ["tomato", 150], ["onion", 40], ["egg", 100], ["oil", 10], ["peanut", 15]],
    ["Cook rice; boil the eggs.", "Fry peanuts, onion and tomato with spices into a thick masala.", "Mix in the rice; serve with halved eggs."]),
  R("aloo-anda-roti", "Aloo anda curry with roti", ["lunch", "dinner"], "Egg and potato curry, 3 rotis",
    [["egg", 100], ["potato", 120], ["onion", 50], ["tomato", 80], ["atta", 80], ["oil", 12]],
    ["Boil eggs and potato; peel and halve.", "Cook onion-tomato masala, add water and simmer.", "Add eggs and potato for 5 minutes; serve with rotis."]),
  // ── more snacks ──
  R("chana-chaat", "Chickpea chaat", ["snack"], "Boiled chickpeas with potato, onion, tomato and cucumber",
    [["chickpea", 50], ["potato", 60], ["onion", 30], ["tomato", 40], ["cucumber", 60]],
    ["Boil soaked chickpeas and the potato until tender.", "Toss everything with chaat masala, salt and lemon."]),
  R("peanut-cucumber-salad", "Peanut cucumber salad", ["snack"], "Roasted peanuts with cucumber, tomato and onion",
    [["peanut", 40], ["cucumber", 150], ["tomato", 60], ["onion", 20]],
    ["Roast the peanuts.", "Toss with chopped vegetables, salt, chili and lemon."]),
  R("banana-pb-toast", "Banana peanut-butter toast", ["snack", "breakfast"], "Two slices with peanut butter and banana",
    [["bread", 60], ["pb", 25], ["banana", 120]],
    ["Toast the bread and spread with peanut butter.", "Top with sliced banana."]),
  R("paneer-tikka-pan", "Pan paneer tikka", ["snack"], "Curd-marinated paneer seared with capsicum and onion",
    [["paneer", 100], ["capsicum", 60], ["onion", 40], ["curd", 50], ["oil", 5]],
    ["Coat paneer, capsicum and onion in curd with chili, turmeric and salt.", "Sear in a hot oiled pan until charred at the edges."]),
  R("apple-pb", "Apple with peanut butter", ["snack"], "Apple slices with a peanut-butter dip",
    [["apple", 180], ["pb", 30]],
    ["Slice the apple.", "Serve with peanut butter."]),
  R("egg-chaat", "Boiled egg chaat", ["snack"], "3 boiled eggs with onion, tomato and cucumber",
    [["egg", 150], ["onion", 30], ["tomato", 40], ["cucumber", 60]],
    ["Boil eggs 9 minutes, peel and quarter.", "Top with chopped vegetables, chaat masala and lemon."]),
  R("banana-lassi", "Banana lassi", ["snack"], "Thick curd smoothie with banana and almonds",
    [["curd", 250], ["banana", 120], ["almond", 10]],
    ["Blend curd and banana until smooth.", "Top with chopped almonds."]),
  R("aloo-chaat-curd", "Aloo chaat with curd", ["snack"], "Crisp potato cubes with curd and onion",
    [["potato", 200], ["curd", 100], ["onion", 20], ["oil", 8]],
    ["Boil, cube and pan-fry the potato in oil until crisp.", "Top with curd, onion, chaat masala and chili."]),
];

// Ingredient amounts for `s` servings. Things you can't split (eggs, bread slices, whole fruit)
// round to whole pieces, so the card, the macros and the pantry deduction all agree.
export const scaledIng = (ing, s = 1) => ing.map(({ k, g }) => {
  const f = FOODS[k];
  const x = g * s;
  return { k, g: f && f.count && f.pc ? Math.max(1, Math.round(x / f.pc)) * f.pc : x };
});

export const macrosOf = (ing, s = 1) => {
  let kcal = 0, p = 0, c = 0, f = 0;
  for (const { k, g } of scaledIng(ing, s)) {
    const food = FOODS[k];
    if (!food) continue;
    const x = g / 100;
    kcal += food.kcal * x; p += food.p * x; c += food.c * x; f += food.f * x;
  }
  return { kcal: Math.round(kcal), p: Math.round(p * 10) / 10, c: Math.round(c * 10) / 10, f: Math.round(f * 10) / 10 };
};

// Attach per-serving macros to a recipe (library or AI-made).
export const withMacros = (r) => ({ ...r, m: macrosOf(r.ing, 1) });
export const ALL_LIBRARY = LIBRARY.map(withMacros);

export const recipeNeeds = (recipe, servings) => {
  const out = {};
  for (const { k, g } of scaledIng(recipe.ing, servings)) out[k] = (out[k] || 0) + g;
  return out;
};

/* ───────────────────────────── offline "what can I cook" matrix ───────────────────────────── */
// Ingredient × recipe incidence, built once in the browser from the recipe list — no network, no AI.
// Any combination of ticked ingredients is answered by one pass over this table.

export const FOOD_KEYS = FOOD_LIST.map((f) => f.key);

export function buildMatrix(recipes) {
  const col = Object.fromEntries(FOOD_KEYS.map((k, i) => [k, i]));
  const cells = recipes.map((r) => {
    const row = new Uint8Array(FOOD_KEYS.length);
    for (const { k } of r.ing) if (col[k] != null) row[col[k]] = 1;
    return row;
  });
  const byFood = Object.fromEntries(FOOD_KEYS.map((k) => [k, []]));
  cells.forEach((row, ri) => row.forEach((v, ci) => { if (v) byFood[FOOD_KEYS[ci]].push(recipes[ri].id); }));
  return { recipes, cells, col, byFood };
}

const haveRow = (matrix, have) => {
  const h = new Uint8Array(FOOD_KEYS.length);
  for (const k of have) if (matrix.col[k] != null) h[matrix.col[k]] = 1;
  return h;
};

// Every recipe with the ingredients it still lacks, fewest missing first.
export function cookable(matrix, have, { slot } = {}) {
  const h = haveRow(matrix, have);
  const out = [];
  matrix.cells.forEach((row, ri) => {
    const recipe = matrix.recipes[ri];
    if (slot && !recipe.slots.includes(slot)) return;
    const missing = [];
    for (let c = 0; c < row.length; c++) if (row[c] && !h[c]) missing.push(FOOD_KEYS[c]);
    out.push({ recipe, missing });
  });
  out.sort((a, b) => a.missing.length - b.missing.length || a.recipe.name.localeCompare(b.recipe.name));
  return out;
}

// "Buy one thing": which single ingredient you don't have makes the most extra recipes fully cookable.
export function unlocks(matrix, have, { slot } = {}) {
  const count = {};
  for (const { missing } of cookable(matrix, have, { slot })) if (missing.length === 1) count[missing[0]] = (count[missing[0]] || 0) + 1;
  return Object.entries(count).map(([key, n]) => ({ key, name: FOODS[key].name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/* ───────────────────────────── pantry index / deduction ───────────────────────────── */

export function indexPantry(pantry, today) {
  const idx = {};
  for (const it of pantry) {
    const key = matchFood(it.name);
    if (!key) continue;
    const g = qtyToGrams(it.quantity, it.unit, key);
    if (!(g > 0)) continue;
    if (!idx[key]) idx[key] = { grams: 0, soonest: null };
    idx[key].grams += g;
    if (it.expiry && today) {
      const d = daysBetween(today, it.expiry);
      if (idx[key].soonest == null || d < idx[key].soonest) idx[key].soonest = d;
    }
  }
  return idx;
}

// Remove `needs` ({foodKey: grams}) from the pantry, earliest-expiry first.
// Never goes negative: returns what couldn't be covered in `short`.
export function deductFromPantry(pantry, needs) {
  const next = pantry.map((x) => ({ ...x }));
  const touched = new Set();
  const short = [];
  for (const [key, need0] of Object.entries(needs)) {
    let need = need0;
    const rows = [];
    next.forEach((it, i) => { if (matchFood(it.name) === key) rows.push({ it, i }); });
    rows.sort((a, b) => (a.it.expiry || "9999").localeCompare(b.it.expiry || "9999"));
    for (const { it, i } of rows) {
      if (need <= 0.5) break;
      const have = qtyToGrams(it.quantity, it.unit, key);
      if (!(have > 0)) continue;
      const take = Math.min(have, need);
      it.quantity = round2(Number(it.quantity) - gramsToQty(take, it.unit, key));
      touched.add(i);
      need -= take;
    }
    if (need > 0.5) short.push({ key, name: FOODS[key].name, grams: Math.round(need) });
  }
  const kept = next.filter((it, i) => {
    if (!touched.has(i)) return true;
    const k = matchFood(it.name);
    return Number(it.quantity) > 0.0001 && qtyToGrams(it.quantity, it.unit, k) >= 1;
  });
  return { pantry: kept, short };
}

/* ───────────────────────────── targets ───────────────────────────── */

export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };

export function computeTargets(p) {
  const w = Number(p.weightKg) || 60, h = Number(p.heightCm) || 170, age = Number(p.age) || 25;
  const bmr = 10 * w + 6.25 * h - 5 * age + (p.sex === "female" ? -161 : 5);
  const tdee = bmr * (ACTIVITY[p.activity] || 1.375);
  const pace = Number(p.pace) || 0.5; // kg per week
  const delta = p.goal === "gain" ? pace * 1100 : p.goal === "lose" ? -pace * 1100 : 0;
  const kcal = Math.max(1400, Math.round((tdee + delta) / 25) * 25);
  const protein = Math.round((w * 2) / 5) * 5;
  const fat = Math.round((kcal * 0.27) / 9 / 5) * 5;
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5);
  const water = Math.round((w * 35) / 100) * 100;
  return { kcal, protein, fat, carbs, water };
}

// Computed targets plus the trainer's calorie adjustment (carbs absorb the difference).
export function targetsFor(profile, adjust = 0) {
  const t = computeTargets(profile);
  const kcal = Math.max(1400, t.kcal + (Number(adjust) || 0));
  return { ...t, kcal, carbs: Math.max(0, Math.round((kcal - t.protein * 4 - t.fat * 9) / 4 / 5) * 5) };
}

/* ───────────────────────────── ranking ───────────────────────────── */

export const SERVING_STEPS = [0.5, 1, 1.5, 2, 2.5];

const hash01 = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
};

export function bestServings(m, target) {
  let best = 1, bestErr = 1e9;
  for (const s of SERVING_STEPS) {
    const kerr = Math.abs(m.kcal * s - target.kcal) / Math.max(target.kcal, 1);
    const pshort = Math.max(0, target.protein - m.p * s) / Math.max(target.protein, 1);
    const err = kerr + 0.6 * pshort;
    if (err < bestErr) { bestErr = err; best = s; }
  }
  return { s: best, err: bestErr };
}

// How much of each slot's share is still open, after what's been eaten.
export function slotTargets({ targets, eaten, openSlots }) {
  const remK = Math.max(0, targets.kcal - eaten.kcal);
  const remP = Math.max(0, targets.protein - eaten.p);
  const shareSum = openSlots.reduce((a, s) => a + SLOT_META[s].share, 0) || 1;
  const out = {};
  for (const s of openSlots) {
    const w = SLOT_META[s].share / shareSum;
    out[s] = { kcal: remK * w, protein: remP * w };
  }
  return out;
}

export function rankRecipes({ recipes, slot, target, pindex, dayKey, avoid = new Set(), recent = new Set(), limit = 5 }) {
  const out = [];
  for (const r of recipes) {
    if (!r.slots.includes(slot)) continue;
    const { s, err } = bestServings(r.m, target);
    const needs = recipeNeeds(r, s);
    let cov = 0, n = 0, exp = 0;
    for (const [k, g] of Object.entries(needs)) {
      const have = (pindex[k] && pindex[k].grams) || 0;
      cov += Math.min(1, have / g); n++;
      if (have > 0 && pindex[k].soonest != null && pindex[k].soonest <= 3) exp++;
    }
    const coverage = n ? cov / n : 0;
    const score =
      (1 - Math.min(err, 1.5)) + 0.6 * coverage + 0.35 * (n ? exp / n : 0)
      - (avoid.has(r.id) ? 0.8 : 0) - (recent.has(r.id) ? 0.4 : 0)
      + 0.18 * hash01(dayKey + slot + r.id);
    out.push({ recipe: r, servings: s, score, coverage, m: macrosOf(r.ing, s) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// One ranked list per open slot, with no dish repeated across slots — breakfast, lunch and dinner
// never show the same options. Slots take turns picking their best remaining dish.
// pinned: { slot: { recipe, servings } } goes first in its own slot and nowhere else.
export function suggestDay({ recipes, slots, targets, pindex, dayKey, avoid = new Set(), recent = new Set(), pinned = {} }) {
  const ranked = {}, out = {}, ptr = {};
  const taken = new Set();
  for (const s of slots) {
    ranked[s] = rankRecipes({ recipes, slot: s, target: targets[s] || { kcal: 0, protein: 0 }, pindex, dayKey, avoid, recent, limit: Infinity });
    out[s] = []; ptr[s] = 0;
    const p = pinned[s];
    if (p && p.recipe) { out[s].push({ recipe: p.recipe, servings: p.servings, m: macrosOf(p.recipe.ing, p.servings) }); taken.add(p.recipe.id); }
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (const s of slots) {
      const list = ranked[s];
      let i = ptr[s];
      while (i < list.length && taken.has(list[i].recipe.id)) i++;
      if (i < list.length) { out[s].push(list[i]); taken.add(list[i].recipe.id); i++; progress = true; }
      ptr[s] = i;
    }
  }
  return out;
}

/* ───────────────────────────── trainer ───────────────────────────── */
// Pure rules that turn the day's numbers into blunt, specific instructions.

export const DEADLINE = { breakfast: 10, lunch: 14, snack: 17, dinner: 21 }; // hour each meal should be logged by

export const fmtHour = (h) => {
  const hh = Math.floor(h), m = Math.floor((h - hh) * 60);
  return `${hh % 12 || 12}:${pad2(m)} ${hh >= 12 ? "pm" : "am"}`;
};
const nf = (n) => Math.round(n).toLocaleString("en-US");
const totals = (entries) => entries.reduce((a, e) => ({ kcal: a.kcal + (Number(e.kcal) || 0), p: a.p + (Number(e.p) || 0) }), { kcal: 0, p: 0 });
const listOf = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
const real = (entries) => (entries || []).filter((e) => e.source !== "skipped");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Did a day meet the standard for this goal?
export function dayHit(entries, targets, goal = "gain") {
  const t = totals(real(entries));
  if (!t.kcal) return false;
  const k = t.kcal / targets.kcal, p = t.p / targets.protein;
  if (goal === "lose") return k <= 1.05 && k >= 0.75 && p >= 0.85;
  return k >= 0.9 && p >= 0.85 && (goal !== "maintain" || k <= 1.1);
}

// Consecutive days on target, ending yesterday (today counts once it's hit).
export function streakOf(logs, today, targets, goal) {
  let n = dayHit(logs[today], targets, goal) ? 1 : 0;
  for (let i = 1; i <= 90; i++) { if (dayHit(logs[addDaysISO(today, -i)], targets, goal)) n++; else break; }
  return n;
}

export function weekGrade(logs, today, targets, goal) {
  let hit = 0, logged = 0;
  for (let i = 0; i < 7; i++) {
    const es = logs[addDaysISO(today, -i)];
    if (real(es).length) logged++;
    if (dayHit(es, targets, goal)) hit++;
  }
  const verdict = hit >= 6 ? "Strong week. Keep the standard." : hit >= 4 ? "Inconsistent. The off days are costing you." : logged <= 2 ? "I can't coach what you don't log." : "Not good enough. Most days missed the target.";
  return { hit, logged, verdict, level: hit >= 6 ? "good" : hit >= 4 ? "warn" : "bad" };
}

export function coach({ hour, today, targets, slots, logs = {}, water = {}, weights = [], profile = {}, adjustedOn = null, set = true }) {
  const goal = profile.goal || "gain";
  const entries = logs[today] || [];
  const eaten = totals(entries);
  const label = (s) => SLOT_META[s].label;
  const loggedSlots = new Set(entries.map((e) => e.slot));
  const skipped = slots.filter((s) => entries.some((e) => e.slot === s) && !real(entries).some((e) => e.slot === s));
  const open = slots.filter((s) => !loggedSlots.has(s));
  const overdue = open.filter((s) => hour >= DEADLINE[s]);
  const shareSum = slots.reduce((a, s) => a + SLOT_META[s].share, 0) || 1;
  const expectedFrac = slots.filter((s) => hour >= DEADLINE[s]).reduce((a, s) => a + SLOT_META[s].share, 0) / shareSum;
  const expectedK = targets.kcal * expectedFrac;
  const gap = Math.round(expectedK - eaten.kcal); // + means behind
  const remK = Math.max(0, targets.kcal - eaten.kcal), remP = Math.max(0, targets.protein - eaten.p);
  const st = slotTargets({ targets, eaten, openSlots: open });
  const next = open.find((s) => hour < DEADLINE[s]);
  const msgs = [];
  const add = (level, id, title, body, action) => msgs.push({ level, id, title, body, action: action || null });

  if (!set) add("warn", "setup", "I'm working with placeholder numbers.", "Give me your real height, weight and pace. Until then these targets are a guess.", { type: "targets", label: "Set my numbers" });

  // 1. meals that should already be logged
  if (overdue.length) {
    const one = overdue.length === 1;
    add("bad", "overdue",
      `${cap(listOf(overdue.map((s) => label(s).toLowerCase())))} ${one ? "is" : "are"} overdue.`,
      `It's ${fmtHour(hour)} and ${one ? "it isn't" : "they aren't"} logged. ` +
      (gap > 50 ? `You're ${nf(gap)} kcal behind where you should be. Cook it or log it now.` : "If you ate, log it. Unlogged food doesn't count."),
      { type: "slot", slot: overdue[0], label: `Do ${label(overdue[0]).toLowerCase()} now` });
  }

  // 2. every slot handled — judge the day
  if (!open.length && entries.length) {
    const k = eaten.kcal / targets.kcal, p = eaten.p / targets.protein;
    if (goal === "lose" && k > 1.05) add("warn", "over", "Over target today.", `You're ${nf(eaten.kcal - targets.kcal)} kcal over. Don't make up for it by skipping tomorrow. Just hit the number.`);
    else if (goal !== "lose" && k < 0.95) add("bad", "short", "All meals logged, still short.", `${nf(remK)} kcal and ${Math.round(remP)} g protein to go. Eat something before bed: a shake or peanut-butter toast covers most of it.`, { type: "log", label: "Log what I add" });
    else if (p < 0.9) add("warn", "protein-short", "Calories hit, protein short.", `${Math.round(remP)} g of protein missing. Curd, paneer or eggs close that.`, { type: "log", label: "Log what I add" });
    else add("good", "done", "Day done. Target hit.", `${nf(eaten.kcal)} of ${nf(targets.kcal)} kcal and ${Math.round(eaten.p)} g protein. Same again tomorrow.`);
  }

  // 3. skipped meals push the load onto what's left
  if (skipped.length && open.length) {
    const s = next || open[0];
    add("warn", "skipped", `You skipped ${listOf(skipped.map((x) => label(x).toLowerCase()))}.`,
      `Those calories didn't disappear. ${label(s)} now needs about ${nf(st[s].kcal)} kcal. Don't skip another.`, { type: "slot", slot: s, label: `Go to ${label(s).toLowerCase()}` });
  }

  // 4. protein behind pace
  if (open.length && expectedFrac > 0 && eaten.p < targets.protein * expectedFrac * 0.8) {
    add("warn", "protein", "Protein is lagging.",
      `${Math.round(eaten.p)} of ${targets.protein} g. You need ${Math.round(remP)} g across ${open.length} more meal${open.length > 1 ? "s" : ""}, about ${Math.round(remP / open.length)} g each. Take the highest-protein option.`);
  }

  // 5. water
  if (hour >= 10) {
    const w = water[today] || 0;
    const expW = targets.water * Math.max(0, Math.min(1, (hour - 7) / 15));
    if (w < expW * 0.6) add("warn", "water", "Drink water.", `${nf(w)} of ${nf(targets.water)} ml. You should be near ${nf(Math.round(expW / 100) * 100)} ml by now. Drink 500 ml before anything else.`, { type: "water", label: "+500 ml" });
  }

  // 6. yesterday's verdict, until today is underway
  if (hour < 12 || !entries.length) {
    const yes = real(logs[addDaysISO(today, -1)]);
    const hasHistory = Object.keys(logs).some((d) => d < addDaysISO(today, -1) && real(logs[d]).length);
    if (yes.length) {
      const y = totals(yes), k = y.kcal / targets.kcal, p = y.p / targets.protein;
      if (goal === "lose") {
        if (k > 1.1) add("bad", "yesterday", `Yesterday: ${nf(y.kcal - targets.kcal)} kcal over.`, "One day doesn't sink you. A habit does. Hit the number today.");
        else if (k >= 0.75 && p >= 0.85) add("good", "yesterday", "Yesterday: on target.", "That's the standard. Repeat it.");
      } else if (k < 0.85) add("bad", "yesterday", `Yesterday: ${nf(y.kcal)} of ${nf(targets.kcal)} kcal. ${nf(targets.kcal - y.kcal)} short.`, "You don't gain on days like that. No gaps today.");
      else if (k >= 0.95 && p >= 0.9) add("good", "yesterday", "Yesterday: target hit.", "That's the standard. Repeat it.");
      else add("warn", "yesterday", "Yesterday: close, not there.", `${nf(y.kcal)} of ${nf(targets.kcal)} kcal, ${Math.round(y.p)} of ${targets.protein} g protein. Close the last bit today.`);
    } else if (hasHistory) add("bad", "yesterday", "Nothing logged yesterday.", "If you ate, I couldn't count it. Log every meal today, no gaps.");
  }

  // 7. weigh-ins and whether the scale agrees with the plan
  const ws = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const last = ws[ws.length - 1];
  if (!last) add("warn", "weigh", "No weigh-in yet.", "I can't tell if this plan is working without a scale. Weigh in tomorrow morning, before you eat.", { type: "insights", label: "Log my weight" });
  else if (daysBetween(last.date, today) >= 7) add("warn", "weigh", `No weigh-in for ${daysBetween(last.date, today)} days.`, "I can't adjust your plan blind. Weigh in tomorrow morning, before you eat.", { type: "insights", label: "Log my weight" });
  const recentW = ws.filter((w) => daysBetween(w.date, today) <= 35);
  const cooled = !adjustedOn || daysBetween(adjustedOn, today) >= 10;
  if (goal !== "maintain" && cooled && recentW.length >= 2) {
    const a = recentW[0], b = recentW[recentW.length - 1], span = daysBetween(a.date, b.date);
    if (span >= 10) {
      const pace = Number(profile.pace) || 0.5;
      const rate = ((b.kg - a.kg) / span) * 7 * (goal === "lose" ? -1 : 1); // progress toward the goal, kg/week
      const word = goal === "lose" ? "Losing" : "Gaining";
      if (rate < pace * 0.5) add("bad", "trend", `${word} ${rate.toFixed(2)} kg a week. Target is ${pace}.`,
        goal === "lose" ? "The scale says you're eating more than planned. I'm taking 150 kcal a day off." : "The scale says you're under-eating. I'm asking for 150 kcal more a day.",
        { type: "adjust", delta: goal === "lose" ? -150 : 150, label: goal === "lose" ? "Cut 150 kcal from my target" : "Add 150 kcal to my target" });
      else if (rate > pace * 1.6) add("warn", "trend", `${word} ${rate.toFixed(2)} kg a week. Too fast.`,
        goal === "lose" ? "That pace costs muscle. Add 150 kcal a day." : `Past ${pace} kg a week it's mostly fat. Trim 150 kcal a day.`,
        { type: "adjust", delta: goal === "lose" ? 150 : -150, label: goal === "lose" ? "Add 150 kcal to my target" : "Cut 150 kcal from my target" });
    }
  }

  // 8. nothing wrong right now — say what's next
  if (next) {
    const title = overdue.length ? "After that:" : !entries.length ? "Start the day right." : "On pace. Keep going.";
    add("good", "next", title, `${label(next)} by ${fmtHour(DEADLINE[next])}: about ${nf(st[next].kcal)} kcal and ${Math.round(st[next].protein)} g protein.`, { type: "slot", slot: next, label: `See ${label(next).toLowerCase()}` });
  }

  const order = { bad: 0, warn: 1, good: 2 };
  msgs.sort((a, b) => order[a.level] - order[b.level]);
  return {
    messages: msgs, overdue, open, gap, expectedK, eaten,
    behind: goal !== "lose" && gap > targets.kcal * 0.05,
    problems: overdue.length + msgs.filter((m) => m.level === "bad" && m.id !== "overdue").length,
    streak: streakOf(logs, today, targets, goal),
  };
}

/* ───────────────────────────── weekly plan + shopping ───────────────────────────── */
// plan shape: { [date]: { [slot]: { rid, servings, status?: "done"|"skipped" } } }

export function planWeek({ start, days = 7, targets, pantry, recipes, byId, slots = ["breakfast", "lunch", "dinner"], existing = {}, today }) {
  let sim = pantry.map((x) => ({ ...x }));
  const plan = {};
  const recent = [];
  for (let d = 0; d < days; d++) {
    const date = addDaysISO(start, d);
    plan[date] = { ...(existing[date] || {}) };
    // existing, not-yet-eaten entries still consume stock in the simulation
    for (const [slot, e] of Object.entries(plan[date])) {
      if (e.status) continue;
      const r = byId[e.rid];
      if (r) sim = deductFromPantry(sim, recipeNeeds(r, e.servings)).pantry;
      recent.push(e.rid);
      void slot;
    }
    const dayAvoid = new Set(Object.values(plan[date]).map((e) => e.rid));
    const tg = slotTargets({ targets, eaten: { kcal: 0, p: 0 }, openSlots: slots });
    for (const slot of slots) {
      if (plan[date][slot]) continue;
      const opts = rankRecipes({
        recipes, slot, target: tg[slot], pindex: indexPantry(sim, today || start), dayKey: date,
        avoid: new Set([...dayAvoid, ...recent.slice(-12)]), limit: 1,
      });
      if (!opts.length) continue;
      const pick = opts[0];
      plan[date][slot] = { rid: pick.recipe.id, servings: pick.servings };
      dayAvoid.add(pick.recipe.id);
      recent.push(pick.recipe.id);
      sim = deductFromPantry(sim, recipeNeeds(pick.recipe, pick.servings)).pantry;
    }
  }
  return plan;
}

// Everything the uncooked, planned meals need minus what's in the pantry.
export function shoppingNeeds({ plan, byId, pantry, fromDate }) {
  const need = {};
  for (const [date, slots] of Object.entries(plan)) {
    if (date < fromDate) continue;
    for (const e of Object.values(slots)) {
      if (e.status) continue;
      const r = byId[e.rid];
      if (!r) continue;
      for (const [k, g] of Object.entries(recipeNeeds(r, e.servings))) need[k] = (need[k] || 0) + g;
    }
  }
  const idx = indexPantry(pantry, fromDate);
  const rows = [];
  for (const [k, g] of Object.entries(need)) {
    const have = (idx[k] && idx[k].grams) || 0;
    const short = g - have;
    if (short <= 2) continue;
    const f = FOODS[k];
    let qty, unit;
    if (f.count && f.pc) { qty = Math.ceil(short / f.pc - 1e-9); unit = "pcs"; }
    else if (short < 1000) { qty = Math.max(100, Math.ceil(short / 50) * 50); unit = f.liquid ? "ml" : "g"; }
    else { qty = Math.ceil(short / 250) * 250; unit = f.liquid ? "ml" : "g"; }
    rows.push({ key: k, name: f.name, cat: f.cat, needG: Math.round(g), haveG: Math.round(have), buyQty: qty, buyUnit: unit });
  }
  rows.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  return rows;
}

export function fmtBuy(row) {
  if (row.buyUnit === "pcs") {
    const f = FOODS[row.key];
    const nm = f && f.u ? (row.buyQty === 1 ? f.u[0] : f.u[1]) : "pcs";
    return `${row.buyQty} ${nm}`;
  }
  if (row.buyQty >= 1000) return `${round2(row.buyQty / 1000)} ${row.buyUnit === "ml" ? "L" : "kg"}`;
  return `${row.buyQty} ${row.buyUnit}`;
}
