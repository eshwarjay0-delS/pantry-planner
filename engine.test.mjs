// Run with: node --test engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  FOODS, ALL_LIBRARY, matchFood, qtyToGrams, gramsToQty, indexPantry, deductFromPantry,
  computeTargets, bestServings, slotTargets, rankRecipes, planWeek, shoppingNeeds, recipeNeeds,
  macrosOf, fmtAmount, addDaysISO, isoOf,
} from "./engine.js";

const byId = Object.fromEntries(ALL_LIBRARY.map((r) => [r.id, r]));
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("matchFood handles real pantry names without false hits", () => {
  assert.equal(matchFood("Basmati Rice"), "rice");
  assert.equal(matchFood("Eggs"), "egg");
  assert.equal(matchFood("Eggplant"), "eggplant"); // must NOT be egg
  assert.equal(matchFood("Brinjal"), "eggplant");
  assert.equal(matchFood("Tomatoes"), "tomato");
  assert.equal(matchFood("Roma tomatoes"), "tomato");
  assert.equal(matchFood("Bhindi"), "okra");
  assert.equal(matchFood("Indian Okra"), "okra");
  assert.equal(matchFood("Peanut butter"), "pb");
  assert.equal(matchFood("Peanuts"), "peanut");
  assert.equal(matchFood("Groundnut oil"), "oil");
  assert.equal(matchFood("Rice flour"), null);
  assert.equal(matchFood("Coconut milk"), null);
  assert.equal(matchFood("Whole milk"), "milk");
  assert.equal(matchFood("Flattened rice"), "poha");
  assert.equal(matchFood("Toor Dal"), "toor");
  assert.equal(matchFood("Chana dal"), "chanadal");
  assert.equal(matchFood("Green peas"), "peas");
  assert.equal(matchFood("Bell pepper"), "capsicum");
  assert.equal(matchFood("Lauki"), "bottlegourd");
  assert.equal(matchFood("Salt"), null);
});

test("unit conversion round-trips and respects piece weights", () => {
  assert.equal(qtyToGrams(2, "kg", "rice"), 2000);
  near(qtyToGrams(1, "lb", "potato"), 453.592, 0.01);
  assert.equal(qtyToGrams(3, "pcs", "egg"), 150);
  assert.equal(qtyToGrams(2, "pcs", "onion"), 220);
  assert.equal(qtyToGrams(1, "dozen", "egg"), 600);
  assert.equal(qtyToGrams(1, "L", "milk"), 1000);
  for (const [u, k] of [["g", "rice"], ["kg", "rice"], ["pcs", "onion"], ["lb", "potato"], ["pack", "paneer"]]) {
    near(gramsToQty(qtyToGrams(3.3, u, k), u, k), 3.3, 1e-9);
  }
});

test("macros match hand calculation", () => {
  const m = macrosOf([{ k: "rice", g: 100 }, { k: "egg", g: 100 }], 1);
  assert.equal(m.kcal, 503);
  near(m.p, 19.6, 0.05);
});

test("every library recipe is sane", () => {
  assert.ok(ALL_LIBRARY.length >= 30);
  for (const r of ALL_LIBRARY) {
    for (const { k } of r.ing) assert.ok(FOODS[k], `${r.id}: unknown ingredient ${k}`);
    assert.ok(r.steps.length >= 2, r.id);
    const bySlot = r.slots.includes("snack");
    assert.ok(r.m.kcal >= (bySlot ? 200 : 400) && r.m.kcal <= 1000, `${r.id} kcal ${r.m.kcal}`);
  }
  for (const s of ["breakfast", "lunch", "dinner", "snack"]) {
    assert.ok(ALL_LIBRARY.filter((r) => r.slots.includes(s)).length >= 5, s);
  }
});

test("deducting a recipe scales quantities and keeps units", () => {
  const pantry = [
    { id: "1", name: "Eggs", quantity: 12, unit: "pcs", expiry: "2026-10-12" },
    { id: "2", name: "Onion", quantity: 2, unit: "lb", expiry: "2026-10-20" },
    { id: "3", name: "Tomatoes", quantity: 500, unit: "g" },
    { id: "4", name: "Cooking oil", quantity: 1, unit: "L" },
    { id: "5", name: "Bread", quantity: 10, unit: "slices" },
  ];
  const r = byId["egg-bhurji-toast"]; // 150 g egg = 3 eggs, 50 g onion, 50 g tomato, 10 g oil, 90 g bread = 3 slices
  const res = deductFromPantry(pantry, recipeNeeds(r, 2)); // cook 2 servings
  assert.equal(res.short.length, 0);
  const get = (id) => res.pantry.find((x) => x.id === id);
  near(get("1").quantity, 6, 0.01);                 // 12 - 6 eggs
  near(get("2").quantity, 2 - 100 / 453.592, 0.01); // 100 g off 2 lb
  near(get("3").quantity, 400, 0.01);
  near(get("4").quantity, 0.98, 0.01);
  near(get("5").quantity, 4, 0.01);
  assert.equal(pantry[0].quantity, 12); // original untouched
});

test("deduction never goes negative, reports shortfall, removes emptied items", () => {
  const pantry = [{ id: "1", name: "Paneer", quantity: 100, unit: "g" }, { id: "2", name: "Salt", quantity: 1, unit: "pack" }];
  const res = deductFromPantry(pantry, { paneer: 250 });
  assert.equal(res.pantry.find((x) => x.id === "1"), undefined); // used up -> removed
  assert.equal(res.short.length, 1);
  assert.equal(res.short[0].grams, 150);
  assert.ok(res.pantry.find((x) => x.id === "2")); // unrelated item kept
});

test("deduction uses the earliest-expiring stock first", () => {
  const pantry = [
    { id: "late", name: "Onion", quantity: 500, unit: "g", expiry: "2026-11-01" },
    { id: "soon", name: "Onion", quantity: 100, unit: "g", expiry: "2026-10-08" },
  ];
  const res = deductFromPantry(pantry, { onion: 150 });
  assert.equal(res.pantry.find((x) => x.id === "soon"), undefined);
  near(res.pantry.find((x) => x.id === "late").quantity, 450, 0.01);
});

test("targets: reproduces a sensible plan for 60 kg / 170 cm / 26 y male", () => {
  const t = computeTargets({ sex: "male", age: 26, heightCm: 170, weightKg: 60, activity: "light", goal: "gain", pace: 0.5 });
  assert.equal(t.protein, 120);
  assert.ok(t.kcal > 2500 && t.kcal < 2800, String(t.kcal));
  near(t.kcal, t.protein * 4 + t.fat * 9 + t.carbs * 4, 80);
  const fast = computeTargets({ sex: "male", age: 26, heightCm: 170, weightKg: 60, activity: "light", goal: "gain", pace: 0.75 });
  assert.ok(fast.kcal > t.kcal);
});

test("serving picker fills the slot and values protein", () => {
  const m = { kcal: 600, p: 30 };
  assert.equal(bestServings(m, { kcal: 900, protein: 45 }).s, 1.5);
  assert.equal(bestServings(m, { kcal: 280, protein: 14 }).s, 0.5);
  assert.equal(bestServings(m, { kcal: 5000, protein: 300 }).s, 2.5); // capped
});

test("slot targets redistribute what is left across open slots", () => {
  const t = slotTargets({ targets: { kcal: 2600, protein: 120 }, eaten: { kcal: 700, p: 30 }, openSlots: ["lunch", "dinner"] });
  near(t.lunch.kcal + t.dinner.kcal, 1900, 0.01);
  near(t.lunch.protein + t.dinner.protein, 90, 0.01);
  assert.ok(t.lunch.kcal > t.dinner.kcal);
  const done = slotTargets({ targets: { kcal: 2600, protein: 120 }, eaten: { kcal: 3000, p: 130 }, openSlots: ["dinner"] });
  assert.equal(done.dinner.kcal, 0);
});

test("ranking prefers meals the pantry can cover and expiring stock", () => {
  const pantry = [
    { id: "a", name: "Paneer", quantity: 500, unit: "g", expiry: "2026-10-08" },
    { id: "b", name: "Spinach", quantity: 500, unit: "g", expiry: "2026-10-07" },
    { id: "c", name: "Atta", quantity: 2, unit: "kg" },
    { id: "d", name: "Onion", quantity: 1, unit: "kg" },
    { id: "e", name: "Cooking oil", quantity: 1, unit: "L" },
  ];
  const pindex = indexPantry(pantry, "2026-10-06");
  const [top] = rankRecipes({ recipes: ALL_LIBRARY, slot: "dinner", target: { kcal: 800, protein: 40 }, pindex, dayKey: "2026-10-06", cuisines: [] }); // cuisine-neutral
  assert.equal(top.recipe.id, "palak-paneer-roti");
  assert.ok(top.coverage > 0.9);
});

test("ranking is stable for a given day and skips avoided meals", () => {
  const args = { recipes: ALL_LIBRARY, slot: "lunch", target: { kcal: 900, protein: 45 }, pindex: {}, dayKey: "2026-10-06" };
  const a = rankRecipes(args).map((o) => o.recipe.id);
  const b = rankRecipes(args).map((o) => o.recipe.id);
  assert.deepEqual(a, b);
  const c = rankRecipes({ ...args, avoid: new Set([a[0]]) }).map((o) => o.recipe.id);
  assert.notEqual(c[0], a[0]);
});

test("weekly plan: 7 days x 3 meals, varied, and shopping list = needs minus pantry", () => {
  const pantry = [{ id: "r", name: "Basmati rice", quantity: 1, unit: "kg" }];
  const plan = planWeek({ start: "2026-10-07", days: 7, targets: { kcal: 2650, protein: 120 }, pantry, recipes: ALL_LIBRARY, byId, today: "2026-10-07" });
  const dates = Object.keys(plan);
  assert.equal(dates.length, 7);
  const ids = [];
  for (const d of dates) { assert.equal(Object.keys(plan[d]).length, 3); ids.push(...Object.values(plan[d]).map((e) => e.rid)); }
  assert.ok(new Set(ids).size >= 12, `only ${new Set(ids).size} distinct meals`);
  // no recipe twice on the same day
  for (const d of dates) { const day = Object.values(plan[d]).map((e) => e.rid); assert.equal(new Set(day).size, day.length); }

  const need = shoppingNeeds({ plan, byId, pantry, fromDate: "2026-10-07" });
  assert.ok(need.length > 5);
  // exact check on one line: total rice needed minus 1 kg in stock
  let riceNeed = 0;
  for (const e of dates.flatMap((d) => Object.values(plan[d]))) riceNeed += (recipeNeeds(byId[e.rid], e.servings).rice || 0);
  const riceRow = need.find((r) => r.key === "rice");
  if (riceNeed > 1000) { assert.ok(riceRow); assert.ok(riceRow.buyQty >= riceNeed - 1000); assert.ok(riceRow.buyQty - (riceNeed - 1000) < 250); }
  else assert.equal(riceRow, undefined);

  // after buying everything on the list, nothing is left to buy
  const bought = pantry.concat(need.map((r, i) => ({ id: "n" + i, name: r.name, quantity: r.buyQty, unit: r.buyUnit })));
  assert.equal(shoppingNeeds({ plan, byId, pantry: bought, fromDate: "2026-10-07" }).length, 0);
});

test("cooked/skipped meals leave the shopping list; existing entries are preserved", () => {
  const targets = { kcal: 2650, protein: 120 };
  const first = planWeek({ start: "2026-10-07", days: 2, targets, pantry: [], recipes: ALL_LIBRARY, byId });
  const doneRid = first["2026-10-07"].lunch.rid;
  first["2026-10-07"].lunch = { ...first["2026-10-07"].lunch, status: "done" };
  const before = shoppingNeeds({ plan: { ...first, "2026-10-07": { ...first["2026-10-07"], lunch: { ...first["2026-10-07"].lunch, status: undefined } } }, byId, pantry: [], fromDate: "2026-10-07" });
  const after = shoppingNeeds({ plan: first, byId, pantry: [], fromDate: "2026-10-07" });
  const sum = (rows) => rows.reduce((a, r) => a + r.needG, 0);
  assert.ok(sum(after) < sum(before));
  const again = planWeek({ start: "2026-10-07", days: 2, targets, pantry: [], recipes: ALL_LIBRARY, byId, existing: first });
  assert.equal(again["2026-10-07"].lunch.rid, doneRid);
  assert.equal(again["2026-10-07"].lunch.status, "done");
});

test("amount formatting is human-friendly", () => {
  assert.equal(fmtAmount("egg", 150), "3 eggs");
  assert.equal(fmtAmount("egg", 50), "1 egg");
  assert.equal(fmtAmount("rice", 90), "90 g");
  assert.equal(fmtAmount("rice", 1500), "1.5 kg");
  assert.equal(fmtAmount("milk", 300), "300 ml");
});

test("dates use the local calendar day, not UTC", () => {
  assert.equal(isoOf(new Date(2026, 9, 6, 23, 30)), "2026-10-06");
  assert.equal(addDaysISO("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysISO("2026-03-08", 1), "2026-03-09"); // across a DST change
});

/* ───── offline cook-now matrix ───── */
import { FOOD_KEYS, buildMatrix, cookable, unlocks } from "./engine.js";

const MX = buildMatrix(ALL_LIBRARY);
// independent reference: straight from each recipe's ingredient list
const refMissing = (r, have) => [...new Set(r.ing.map((i) => i.k))].filter((k) => !have.has(k)).sort();
const checkCombo = (keys) => {
  const have = new Set(keys);
  const res = cookable(MX, have);
  assert.equal(res.length, ALL_LIBRARY.length);
  let prev = -1;
  for (const { recipe, missing } of res) {
    assert.deepEqual([...missing].sort(), refMissing(recipe, have), `${recipe.id} with [${keys}]`);
    assert.ok(missing.length >= prev, "sorted by fewest missing");
    prev = missing.length;
  }
};

test("matrix: one row per recipe, one column per ingredient, every ingredient used", () => {
  assert.equal(MX.cells.length, ALL_LIBRARY.length);
  assert.ok(MX.cells.every((row) => row.length === FOOD_KEYS.length));
  for (const k of FOOD_KEYS) assert.ok(MX.byFood[k].length >= 1, `${k} is in no recipe`);
});

test("matrix: every single, pair and triple of ingredients matches the reference", () => {
  const n = FOOD_KEYS.length;
  let combos = 0;
  checkCombo([]); combos++;
  for (let a = 0; a < n; a++) {
    checkCombo([FOOD_KEYS[a]]); combos++;
    for (let b = a + 1; b < n; b++) {
      checkCombo([FOOD_KEYS[a], FOOD_KEYS[b]]); combos++;
      for (let c = b + 1; c < n; c++) { checkCombo([FOOD_KEYS[a], FOOD_KEYS[b], FOOD_KEYS[c]]); combos++; }
    }
  }
  assert.equal(combos, 1 + n + (n * (n - 1)) / 2 + (n * (n - 1) * (n - 2)) / 6);
});

test("matrix: 20,000 random larger combinations match the reference", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 20000; i++) {
    const p = rnd();
    checkCombo(FOOD_KEYS.filter(() => rnd() < p));
  }
});

test("matrix: nothing ticked → nothing ready; everything ticked → everything ready", () => {
  assert.ok(cookable(MX, []).every((x) => x.missing.length === new Set(x.recipe.ing.map((i) => i.k)).size));
  assert.ok(cookable(MX, FOOD_KEYS).every((x) => x.missing.length === 0));
  assert.ok(cookable(MX, FOOD_KEYS, { slot: "snack" }).every((x) => x.recipe.slots.includes("snack")));
});

test("matrix: unlocks counts recipes that are exactly one ingredient away", () => {
  const have = ["rice", "onion", "tomato", "oil", "atta", "curd"];
  const res = cookable(MX, have);
  for (const u of unlocks(MX, have)) {
    assert.equal(u.n, res.filter((x) => x.missing.length === 1 && x.missing[0] === u.key).length);
    const after = cookable(MX, [...have, u.key]).filter((x) => !x.missing.length).length;
    assert.equal(after - res.filter((x) => !x.missing.length).length, u.n);
  }
  assert.ok(unlocks(MX, have).length > 0);
});

/* ───── whole pieces, distinct slot lists, trainer ───── */
import { scaledIng, suggestDay, coach, streakOf, dayHit, targetsFor, weekGrade, SLOTS } from "./engine.js";

test("eggs, slices and fruit scale to whole pieces everywhere", () => {
  const r = byId["egg-bhurji-roti"]; // 150 g egg = 3 eggs per serving
  assert.equal(scaledIng(r.ing, 1.5).find((i) => i.k === "egg").g, 250); // 4.5 → 5 eggs
  assert.equal(recipeNeeds(r, 1.5).egg, 250);
  assert.equal(fmtAmount("egg", recipeNeeds(r, 1.5).egg), "5 eggs");
  assert.equal(recipeNeeds(r, 1.5).onion, 75); // weighable things stay exact
  assert.equal(macrosOf(r.ing, 1).kcal, r.m.kcal);
});

test("suggestDay: no dish appears under two slots, and every dish is offered somewhere", () => {
  const slots = ["breakfast", "lunch", "dinner", "snack"];
  const targets = { breakfast: { kcal: 700, protein: 35 }, lunch: { kcal: 950, protein: 50 }, dinner: { kcal: 800, protein: 45 }, snack: { kcal: 300, protein: 15 } };
  const out = suggestDay({ recipes: ALL_LIBRARY, slots, targets, pindex: {}, dayKey: "2026-10-07" });
  const seen = new Map();
  for (const s of slots) {
    assert.ok(out[s].length >= 8, `${s} has ${out[s].length}`);
    for (const o of out[s]) {
      assert.ok(o.recipe.slots.includes(s), `${o.recipe.id} is not a ${s}`);
      assert.ok(!seen.has(o.recipe.id), `${o.recipe.id} is in ${seen.get(o.recipe.id)} and ${s}`);
      seen.set(o.recipe.id, s);
    }
  }
  assert.equal(seen.size, ALL_LIBRARY.length);
  // a pinned dish leads its slot and is removed from the others
  const pin = byId["egg-curry-rice"];
  const p = suggestDay({ recipes: ALL_LIBRARY, slots, targets, pindex: {}, dayKey: "2026-10-07", pinned: { dinner: { recipe: pin, servings: 2 } } });
  assert.equal(p.dinner[0].recipe.id, pin.id);
  assert.ok(!p.lunch.some((o) => o.recipe.id === pin.id));
});

const T = { kcal: 2800, protein: 150, fat: 85, carbs: 360, water: 2600 };
const E = (slot, kcal, p, source = "cooked") => ({ id: slot + kcal, slot, kcal, p, c: 0, f: 0, name: slot, source });
const base = { today: "2026-10-07", targets: T, slots: SLOTS, profile: { goal: "gain", pace: 0.5 }, weights: [{ date: "2026-10-06", kg: 75 }] };

test("trainer: overdue meals lead, with the gap and a way to act", () => {
  const c = coach({ ...base, hour: 14.5, logs: { "2026-10-07": [E("breakfast", 700, 35)] }, water: { "2026-10-07": 1500 } });
  assert.deepEqual(c.overdue, ["lunch"]);
  assert.equal(c.messages[0].id, "overdue");
  assert.match(c.messages[0].title, /Lunch is overdue/);
  assert.match(c.messages[0].body, /2:30 pm/);
  assert.equal(c.messages[0].action.slot, "lunch");
  assert.ok(c.behind && c.problems >= 1);
});

test("trainer: on pace says what's next; nothing nags when the day is hit", () => {
  const on = coach({ ...base, hour: 11, logs: { "2026-10-07": [E("breakfast", 750, 40)] }, water: { "2026-10-07": 900 } });
  assert.equal(on.problems, 0);
  assert.ok(on.messages.some((m) => m.id === "next" && /Lunch by 2:00 pm/.test(m.body)));
  const done = coach({ ...base, hour: 21.5, water: { "2026-10-07": 2600 },
    logs: { "2026-10-07": [E("breakfast", 700, 40), E("lunch", 1000, 50), E("dinner", 850, 45), E("snack", 280, 20)] } });
  assert.deepEqual(done.messages.map((m) => m.id), ["done"]);
  assert.equal(done.streak, 1);
});

test("trainer: water, skipped meals, short days and yesterday's verdict", () => {
  const c = coach({ ...base, hour: 15, water: {}, logs: {
    "2026-10-05": [E("lunch", 900, 40)],
    "2026-10-06": [E("breakfast", 600, 30), E("lunch", 800, 40)],
    "2026-10-07": [E("breakfast", 700, 20), E("lunch", 0, 0, "skipped")] } });
  const ids = c.messages.map((m) => m.id);
  assert.ok(ids.includes("water") && ids.includes("skipped"));
  assert.ok(!ids.includes("overdue"), "a skipped meal is not overdue");
  const morning = coach({ ...base, hour: 8, logs: { "2026-10-06": [E("breakfast", 600, 30), E("lunch", 800, 40)] } });
  assert.match(morning.messages.find((m) => m.id === "yesterday").title, /1,400 of 2,800 kcal\. 1,400 short/);
  const gone = coach({ ...base, hour: 8, logs: { "2026-10-04": [E("lunch", 900, 40)] } });
  assert.equal(gone.messages.find((m) => m.id === "yesterday").title, "Nothing logged yesterday.");
  const fresh = coach({ ...base, hour: 8, logs: {}, weights: [] });
  assert.ok(!fresh.messages.some((m) => m.id === "yesterday"), "a brand-new user isn't blamed for yesterday");
  assert.ok(fresh.messages.some((m) => m.id === "weigh"));
  const short = coach({ ...base, hour: 22, water: { "2026-10-07": 2600 },
    logs: { "2026-10-07": [E("breakfast", 500, 30), E("lunch", 700, 40), E("dinner", 700, 40), E("snack", 200, 10)] } });
  assert.equal(short.messages[0].id, "short");
});

test("trainer: the scale adjusts the plan, with a cool-down", () => {
  const weights = [{ date: "2026-09-20", kg: 75 }, { date: "2026-10-06", kg: 75.2 }];
  const slow = coach({ ...base, hour: 9, weights, logs: {} });
  const m = slow.messages.find((x) => x.id === "trend");
  assert.equal(m.action.delta, 150);
  assert.ok(!coach({ ...base, hour: 9, weights, logs: {}, adjustedOn: "2026-10-03" }).messages.some((x) => x.id === "trend"));
  const fast = coach({ ...base, hour: 9, logs: {}, weights: [{ date: "2026-09-20", kg: 75 }, { date: "2026-10-06", kg: 77.5 }] });
  assert.equal(fast.messages.find((x) => x.id === "trend").action.delta, -150);
  const t = targetsFor({ sex: "male", age: 26, heightCm: 170, weightKg: 75, activity: "light", goal: "gain", pace: 0.5 }, 150);
  assert.equal(t.kcal, 3025);
  assert.ok(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal) <= 20);
});

test("trainer: streaks and the weekly grade", () => {
  const good = [E("breakfast", 900, 50), E("lunch", 1000, 50), E("dinner", 800, 45)];
  const logs = { "2026-10-04": good, "2026-10-05": good, "2026-10-06": good, "2026-10-03": [E("lunch", 900, 30)] };
  assert.ok(dayHit(good, T, "gain"));
  assert.equal(streakOf(logs, "2026-10-07", T, "gain"), 3);
  const g = weekGrade(logs, "2026-10-07", T, "gain");
  assert.equal(g.hit, 3); assert.equal(g.level, "bad");
});

/* ───── cuisine order and diet ───── */
import { cuisineOrder, cuisineRank, CUISINES } from "./engine.js";

test("South Indian dishes lead every meal, then North Indian, then American", () => {
  const slots = ["breakfast", "lunch", "dinner", "snack"];
  const targets = { breakfast: { kcal: 700, protein: 35 }, lunch: { kcal: 950, protein: 50 }, dinner: { kcal: 800, protein: 45 }, snack: { kcal: 300, protein: 15 } };
  const out = suggestDay({ recipes: ALL_LIBRARY, slots, targets, pindex: {}, dayKey: "2026-10-07" });
  for (const s of slots) {
    const tiers = out[s].map((o) => cuisineRank(o.recipe));
    assert.equal(out[s][0].recipe.cui, "south", `${s} starts with ${out[s][0].recipe.name}`);
    for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i] >= tiers[i - 1], `${s}: ${out[s][i].recipe.name} is out of order`);
  }
  // the preference can be changed
  const am = suggestDay({ recipes: ALL_LIBRARY, slots, targets, pindex: {}, dayKey: "2026-10-07", cuisines: cuisineOrder("american") });
  assert.equal(am.lunch[0].recipe.cui, "american");
  assert.deepEqual(cuisineOrder("north"), ["north", "south", "american"]);
});

test("a planned week leans South Indian but still varies", () => {
  const plan = planWeek({ start: "2026-10-07", days: 7, targets: { kcal: 2875, protein: 150 }, pantry: [], recipes: ALL_LIBRARY, byId, today: "2026-10-07" });
  const picks = Object.values(plan).flatMap((d) => Object.values(d)).map((e) => byId[e.rid]);
  assert.equal(picks.length, 21);
  assert.ok(picks.filter((r) => r.cui === "south").length >= 14, `south ${picks.filter((r) => r.cui === "south").length}/21`);
  assert.ok(new Set(picks.map((r) => r.id)).size >= 17, "variety");
});

test("diet: chicken and eggs are the only meats in the library", () => {
  const meats = new Set(Object.values(FOODS).filter((f) => f.cat === "Meat & Seafood").map((f) => f.key));
  assert.deepEqual([...meats], ["chicken"]);
  assert.ok(ALL_LIBRARY.filter((r) => r.ing.some((i) => i.k === "chicken")).length >= 12);
  assert.ok(ALL_LIBRARY.every((r) => CUISINES.includes(r.cui)));
  assert.equal(matchFood("Chicken breast"), "chicken");
  assert.equal(matchFood("Chicken masala powder"), null);
});
