import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from "react";
import {
  Package, Camera, Utensils, CalendarDays, ShoppingCart, Sparkles, Plus, Minus,
  Trash2, Pencil, X, Check, Loader2, ImagePlus, Search, ArrowUpDown, Filter,
  Star, CalendarPlus, CalendarClock, TrendingUp, Receipt, AlertTriangle,
  CircleCheck, Clock, DollarSign, Store, ChevronRight, RotateCcw, Lightbulb,
  Cog, KeyRound, ExternalLink, ClipboardList, LogOut, LogIn, ShieldCheck, BookOpen,
  ChevronLeft, Pin, Target, Droplet, Home,
} from "lucide-react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, onSnapshot } from "firebase/firestore";
import {
  SLOTS, SLOT_META, addDaysISO, daysBetween, isoOf, FOODS, fmtAmount, ALL_LIBRARY, macrosOf, withMacros,
  recipeNeeds, indexPantry, deductFromPantry, computeTargets, slotTargets, rankRecipes, planWeek,
  shoppingNeeds, fmtBuy, buildMatrix, cookable, unlocks, suggestDay, coach, weekGrade, targetsFor, DEADLINE, fmtHour, cuisineOrder, CUISINES, CUISINE_LABEL,
} from "./engine.js";

/* ─────────────────────────────  constants  ───────────────────────────── */

const CATEGORIES = ["Produce", "Dairy", "Meat & Seafood", "Bakery", "Pantry", "Frozen", "Beverages", "Snacks", "Household", "Other"];
const SHELF_DAYS = { Produce: 7, Dairy: 10, "Meat & Seafood": 4, Bakery: 5, Pantry: 365, Frozen: 120, Beverages: 60, Snacks: 90, Household: 730, Other: 30 };
const CAT_EMOJI = { Produce: "🥬", Dairy: "🧀", "Meat & Seafood": "🍗", Bakery: "🍞", Pantry: "🫙", Frozen: "🧊", Beverages: "🥤", Snacks: "🍪", Household: "🧽", Other: "📦" };
const MODEL = "claude-sonnet-4-6";

const HEAD = "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, sans-serif";
const BODY = "'Nunito', ui-sans-serif, system-ui, -apple-system, sans-serif";

/* ─────────────────────────────  Firebase  ─────────────────────────────── */
// 1. Create a project at https://console.firebase.google.com
// 2. Add a Web app, copy its config, and paste the values below.
// 3. Enable Authentication → Google, and create a Firestore database.
// (These values are safe to be public — access is controlled by security rules.)
const firebaseConfig = {
  apiKey: "AIzaSyB8ZDDg2QSO7By_bUCRcVifwyjUGzJCNOU",
  authDomain: "pantry-planner-1265f.firebaseapp.com",
  projectId: "pantry-planner-1265f",
  storageBucket: "pantry-planner-1265f.firebasestorage.app",
  messagingSenderId: "599790697185",
  appId: "1:599790697185:web:4aca0e13950c3fc3d0d5a0",
};

// After you deploy the Cloudflare Worker, paste its URL here (e.g.
// "https://pantry-ai.YOUR-SUBDOMAIN.workers.dev"). When set, AI works for every
// signed-in user with no personal key. Leave "" to fall back to per-user keys.
const AI_PROXY_URL = "";

const CONFIGURED = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("PASTE");
let auth = null, db = null, googleProvider = null;
if (CONFIGURED) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
}

// Per-user private cloud storage. Each person's data lives at users/{uid},
// readable/writable only by that signed-in user (enforced by Firestore rules).
function parseUserDoc(d) {
  d = d || {};
  return { pantry: d.pantry || [], meals: d.meals || [], trips: d.trips || [], ideas: d.ideas || [], ideasSig: d.ideasSig || "", fit: normalizeFit(d.fit) };
}
// Exactly what gets written to the cloud, and what a cloud snapshot is compared against.
const payloadOf = (s, today) => ({ pantry: s.pantry, meals: s.meals, trips: s.trips, ideas: s.ideas, ideasSig: s.ideasSig, fit: pruneFit(s.fit, today) });
// Key-order-independent JSON, so "same data" compares equal whichever device wrote it.
const stableJSON = (v) => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val)
  ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));
async function saveUserData(uid, data) {
  try {
    // JSON round-trip strips `undefined`, which Firestore rejects (and we'd never see the error).
    // mergeFields replaces each listed field wholesale, so deleted plan/log keys really disappear.
    const clean = JSON.parse(JSON.stringify(data));
    await setDoc(doc(db, "users", uid), clean, { mergeFields: Object.keys(clean) });
    return true;
  } catch (e) { console.warn("Save failed", e); return false; }
}

// Instant local cache for meal ideas, written synchronously the moment they're
// generated. Mobile browsers can discard a backgrounded tab before a debounced
// Firestore write finishes, which is what was wiping suggestions on tab-switch —
// this cache has no network round-trip, so it can't be lost that way.
const ideasCacheKey = (uid) => "pp_ideas_cache_" + uid;
function cacheIdeasLocally(uid, ideas, sig) {
  try { localStorage.setItem(ideasCacheKey(uid), JSON.stringify({ ideas, sig })); } catch (_) {}
}
function readIdeasCache(uid) {
  try { const v = localStorage.getItem(ideasCacheKey(uid)); return v ? JSON.parse(v) : null; } catch (_) { return null; }
}
function clearIdeasCache(uid) {
  try { localStorage.removeItem(ideasCacheKey(uid)); } catch (_) {}
}

/* ─────────────────────────────  helpers  ─────────────────────────────── */

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const todayISO = () => isoOf(new Date());
const toDate = (iso) => new Date(iso + "T12:00:00");
const addDays = (iso, n) => addDaysISO(iso, n);
const daysUntil = (iso) => Math.round((toDate(iso) - toDate(todayISO())) / 86400000);
const fmtShort = (iso) => toDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtLong = (iso) => toDate(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const norm = (s) => (s || "").toLowerCase().trim().replace(/s$/, "");
// A cheap fingerprint of pantry contents — used to detect "new items added" for auto-refresh.
const pantrySig = (pantry) => pantry.map((p) => norm(p.name) + ":" + p.quantity).sort().join("|");

function expiryStatus(item) {
  if (!item.expiry) return { tone: "none", label: "No date", short: "—" };
  const d = daysUntil(item.expiry);
  if (d < 0) return { tone: "expired", label: `Expired ${-d}d ago`, short: "Expired" };
  if (d === 0) return { tone: "soon", label: "Expires today", short: "Today" };
  if (d <= 3) return { tone: "soon", label: `Expires in ${d}d`, short: `${d}d` };
  return { tone: "fresh", label: `Fresh · ${d}d left`, short: `${d}d` };
}

const TONE = {
  fresh: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  soon: "bg-amber-50 text-amber-700 ring-amber-600/20",
  expired: "bg-rose-50 text-rose-700 ring-rose-600/20",
  none: "bg-stone-100 text-stone-500 ring-stone-500/10",
};

// Guess a category from the item name so bulk-added items get sensible expiry.
const CAT_KEYWORDS = {
  Produce: ["tomato", "onion", "potato", "banana", "apple", "spinach", "okra", "chili", "chilli", "gourd", "doodhi", "tindora", "lettuce", "carrot", "pepper", "garlic", "ginger", "lemon", "lime", "fruit", "veg", "cilantro", "coriander", "mango", "grape", "berry", "cucumber", "broccoli", "cauliflower", "gobi", "matar", "peas", "mint", "watermelon", "avocado", "kale"],
  Dairy: ["milk", "yogurt", "yoghurt", "curd", "cheese", "paneer", "butter", "cream", "egg", "ghee"],
  "Meat & Seafood": ["chicken", "beef", "pork", "fish", "shrimp", "mutton", "lamb", "drumstick", "meat", "salmon", "turkey", "bacon", "sausage"],
  Bakery: ["bread", "roti", "naan", "croissant", "bun", "bagel", "cake", "tortilla", "muffin"],
  Frozen: ["frozen", "ice cream", "waffle", "nugget"],
  Beverages: ["juice", "soda", "water", "coffee", "tea", "cola", "drink", "lassi"],
  Snacks: ["chips", "cookie", "biscuit", "murukku", "namkeen", "snack", "cracker", "chocolate", "candy", "nuts", "dates", "popcorn"],
  Pantry: ["rice", "flour", "atta", "dal", "lentil", "bean", "oil", "masala", "powder", "paste", "spice", "sugar", "salt", "oats", "cereal", "granola", "pasta", "sauce", "honey", "vinegar", "garam", "turmeric", "sona", "basmati"],
  Household: ["soap", "detergent", "tissue", "paper", "cleaner", "towel", "foil", "bag", "wrap"],
};
function guessCategory(name) {
  const n = (name || "").toLowerCase();
  for (const cat of Object.keys(CAT_KEYWORDS)) if (CAT_KEYWORDS[cat].some((w) => n.includes(w))) return cat;
  return "Other";
}
// Parse a pasted list ("Okra 2", "2 Doodhi", "Rice x3", "Onions - 4") into items.
function parseBulk(text) {
  const out = [];
  for (const rawLine of (text || "").split(/[\n,]+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let qty = 1, name = line, m;
    if (/^\d/.test(line) && (m = line.match(/^(\d+(?:\.\d+)?)\s*[xX]?\s+(.+)$/))) { qty = parseFloat(m[1]); name = m[2]; }
    else if ((m = line.match(/^(.+?)\s*(?:[xX]|[-:])\s*(\d+(?:\.\d+)?)$/))) { name = m[1]; qty = parseFloat(m[2]); }
    else if ((m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/))) { name = m[1]; qty = parseFloat(m[2]); }
    name = name.replace(/\s+/g, " ").trim();
    if (!name) continue;
    out.push({ name, category: guessCategory(name), quantity: qty > 0 ? qty : 1, unit: "pcs", confidence: "high" });
  }
  return out;
}

/* ─────────────────────────────  device settings  ─────────────────────── */
// Pantry/meal/trip data lives in the user's private Firestore doc (above).
// The Anthropic API key stays on the device only — never uploaded.

// AI settings — keys stay only on this device. Both providers can be filled in
// at once; "auto" picks the cheapest capable one per task automatically.
const getKey = () => { try { return localStorage.getItem("pp_api_key") || ""; } catch (_) { return ""; } };
const getGeminiKey = () => { try { return localStorage.getItem("pp_gemini_key") || ""; } catch (_) { return ""; } };
const getProvider = () => { try { return localStorage.getItem("pp_provider") || "auto"; } catch (_) { return "auto"; } };

// Two cost tiers per provider: "light" (scans, recipe steps — cheap/fast models
// are plenty) and "heavy" (the big ~40-dish generation, which benefits from a
// stronger model). Defaults favour the cheapest model that's still reliable.
const getModelLight = () => { try { return localStorage.getItem("pp_model_light") || "claude-haiku-4-5-20251001"; } catch (_) { return "claude-haiku-4-5-20251001"; } };
const getModelHeavy = () => { try { return localStorage.getItem("pp_model_heavy") || "claude-sonnet-5"; } catch (_) { return "claude-sonnet-5"; } };
const getGeminiModelLight = () => { try { return localStorage.getItem("pp_gemini_model_light") || "gemini-2.5-flash"; } catch (_) { return "gemini-2.5-flash"; } };
const getGeminiModelHeavy = () => { try { return localStorage.getItem("pp_gemini_model_heavy") || "gemini-2.5-pro"; } catch (_) { return "gemini-2.5-pro"; } };

// Decide which provider actually handles a given call, respecting the user's
// preference but falling back sensibly, and — in "auto" — favouring the
// cheaper Gemini key for light everyday tasks to keep token spend down.
function pickProvider(tier) {
  const pref = getProvider();
  const hasA = !!getKey(), hasG = !!getGeminiKey();
  if (!hasA && !hasG) return null;
  if (pref === "anthropic") return hasA ? "anthropic" : "gemini";
  if (pref === "gemini") return hasG ? "gemini" : "anthropic";
  // auto: cheap tier prefers whichever is set up, leaning Gemini (usually free/cheaper);
  // heavy tier leans Claude for quality on the big suggestion list, falling back otherwise.
  if (tier === "light") return hasG ? "gemini" : "anthropic";
  return hasA ? "anthropic" : "gemini";
}

/* ─────────────────────────────  Claude AI  ────────────────────────────── */

const aiReady = () => !!AI_PROXY_URL || !!getKey() || !!getGeminiKey();

async function callGemini({ system, user, images, maxTokens, tier }) {
  const key = getGeminiKey();
  if (!key) { const e = new Error("Add your Gemini API key in Settings to use AI features."); e.code = "NO_KEY"; throw e; }
  const parts = [{ text: user }];
  for (const img of (images || [])) parts.unshift({ inline_data: { mime_type: img.mediaType, data: img.data } });
  const model = tier === "heavy" ? getGeminiModelHeavy() : getGeminiModelLight();
  const body = {
    contents: [{ role: "user", parts }],
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "The request timed out. Check your connection and try again." : "Couldn't reach Gemini. Check your connection.");
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    let msg = "Gemini request failed (" + res.status + ")";
    try { const jr = await res.json(); if (jr.error && jr.error.message) msg = jr.error.message; } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  const cand = (data.candidates || [])[0];
  return ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || "").join("\n");
}

// Central AI entry point. `tier` is "light" (scans, recipe steps — cheap/fast
// models are plenty) or "heavy" (the big ~40-dish list, worth a stronger model).
// `images` is an array so multiple photos can be analysed together in one call.
async function callClaude({ system, user, images, maxTokens = 2048, tier = "light" }) {
  const provider = AI_PROXY_URL ? "anthropic" : pickProvider(tier);
  if (!provider) { const e = new Error("Add an Anthropic or Gemini API key in Settings to use AI features."); e.code = "NO_KEY"; throw e; }
  if (!AI_PROXY_URL && provider === "gemini") return callGemini({ system, user, images, maxTokens, tier });

  const imgBlocks = (images || []).map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } }));
  const content = imgBlocks.length ? [...imgBlocks, { type: "text", text: user }] : user;
  const model = AI_PROXY_URL ? undefined : (tier === "heavy" ? getModelHeavy() : getModelLight());
  const payload = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] };

  let url, headers;
  if (AI_PROXY_URL) {
    // Shared mode: call our Worker, proving who we are with the Google login token.
    let token = null;
    try { if (auth && auth.currentUser) token = await auth.currentUser.getIdToken(); } catch (_) {}
    url = AI_PROXY_URL;
    headers = { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) };
  } else {
    // Personal mode: call Anthropic directly with the user's own key.
    const key = getKey();
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let res;
  try {
    res = await fetch(url, { method: "POST", signal: ctrl.signal, headers, body: JSON.stringify(payload) });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "The request timed out. Check your connection and try again." : "Couldn't reach the AI service. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = "AI request failed (" + res.status + ")";
    try { const jr = await res.json(); if (jr.error && jr.error.message) msg = jr.error.message; } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// Salvage complete {...} objects even if a long JSON array was cut off by the token limit.
function extractObjects(text) {
  const t = (text || "").replace(/```json/gi, "").replace(/```/g, "");
  const objs = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { try { objs.push(JSON.parse(t.slice(start, i + 1))); } catch (_) {} start = -1; } }
  }
  return objs;
}

function parseJSON(text) {
  let t = (text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(t); } catch (_) {}
  const s = t.search(/[[{]/);
  const e = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  if (s !== -1 && e !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch (_) {} }
  throw new Error("Could not read the AI response. Please try again.");
}

async function extractFromImage(images, mode) {
  const receipt = mode === "receipt";
  const multi = images.length > 1;
  const system =
    "You read food and grocery photos. Return ONLY valid JSON, no prose, no markdown fences. " +
    `Categories must be one of: ${CATEGORIES.join(", ")}.`;
  const user = receipt
    ? `You are given ${images.length} photo${multi ? "s of the same receipt or shopping trip (pages/angles)" : " of a receipt"}. ` +
      (multi ? "Combine everything into ONE list — do not duplicate an item that appears in more than one photo. " : "") +
      'Extract the store, purchase date, total, and every food/household line item. ' +
      'Return: {"store": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, ' +
      '"items":[{"name": string, "category": string, "quantity": number, "unit": string, "price": number|null, "confidence": "high"|"medium"|"low"}]}. ' +
      "Use a clean product name (not the receipt abbreviation) where you can. Skip tax, subtotal, discounts, and non-item lines."
    : `You are given ${images.length} photo${multi ? "s of groceries — possibly the same haul from different angles or separate batches" : " of groceries"}. ` +
      (multi ? "Combine everything into ONE list — if the same item appears in more than one photo, list it once with a combined quantity, not duplicated. " : "") +
      "Identify each distinct food/household item. " +
      'Return: {"store": null, "date": null, "total": null, ' +
      '"items":[{"name": string, "category": string, "quantity": number, "unit": string, "price": null, "confidence": "high"|"medium"|"low"}]}.';
  const out = parseJSON(await callClaude({ system, user, images, tier: "light", maxTokens: 3072 }));
  const items = (out.items || []).map((it) => ({
    name: String(it.name || "").trim(),
    category: CATEGORIES.includes(it.category) ? it.category : "Other",
    quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
    unit: (it.unit || "pcs").toString().trim() || "pcs",
    price: it.price == null ? null : Number(it.price),
    confidence: ["high", "medium", "low"].includes(it.confidence) ? it.confidence : "medium",
  })).filter((it) => it.name);
  return { store: out.store || null, date: out.date || null, total: out.total == null ? null : Number(out.total), items };
}

// A single AI call with too many images risks the request-size limit and slow
// mobile uploads. Split large batches into small groups, analyse each, and
// merge the results — so "select 20 photos" stays reliable either way.
const SCAN_BATCH_SIZE = 6;
async function extractFromImages(images, mode, onProgress) {
  const chunks = [];
  for (let i = 0; i < images.length; i += SCAN_BATCH_SIZE) chunks.push(images.slice(i, i + SCAN_BATCH_SIZE));
  let store = null, date = null, total = null;
  const items = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i + 1, chunks.length);
    const res = await extractFromImage(chunks[i], mode);
    if (!store) store = res.store;
    if (!date) date = res.date;
    if (total == null) total = res.total; // keep the first total seen rather than summing (avoids double-counting a repeated receipt total)
    items.push(...res.items);
  }
  return { store, date, total, items };
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "dessert"];

async function suggestMeals(pantry) {
  const names = pantry.map((p) => p.name);
  const system =
    "You are an experienced Indian home cook. Suggest a large, varied set of dishes, defaulting to Indian cuisine " +
    "across breakfast, lunch, dinner and dessert. Favour dishes that use what the person already has, but also include " +
    "some that need a few extra common ingredients. Return ONLY valid JSON, no prose, no markdown fences.";
  const user =
    `Pantry: ${names.join(", ") || "(nearly empty)"}. ` +
    "Suggest about 40 dishes in total, spread across breakfast, lunch, dinner and dessert. " +
    "Put Telangana home cooking first and make it the largest group (pappu, pulusu, vepudu, jonna rotte, bagara rice, sarva pindi, Hyderabadi dishes), then Andhra (pesarattu, pulusu, iguru, ulavacharu, Guntur-style curries), then other South Indian, then North Indian, then a few American. " +
    "The person eats chicken and eggs but no other meat and no fish or seafood; dairy is fine. " +
    'Return {"meals":[{"name": string, "type": "breakfast"|"lunch"|"dinner"|"dessert", ' +
    '"description": string (max 10 words), "ingredients": [string], "servings": number}]}. ' +
    "Keep ingredient names simple and singular. Do NOT include cooking steps.";
  const raw = await callClaude({ system, user, maxTokens: 4096, tier: "heavy" });
  let list = [];
  try { const out = parseJSON(raw); list = out.meals || []; }
  catch (_) { const lb = raw.indexOf("["); list = extractObjects(lb === -1 ? raw : raw.slice(lb)); }
  const seen = new Set();
  return list.map((m) => {
    const type = MEAL_TYPES.includes(String(m.type || "").toLowerCase()) ? String(m.type).toLowerCase() : "dinner";
    return {
      name: String(m.name || "").trim(),
      type,
      description: String(m.description || "").trim(),
      ingredients: Array.isArray(m.ingredients) ? m.ingredients.map((x) => String(x).trim()).filter(Boolean) : [],
      servings: Number(m.servings) > 0 ? Number(m.servings) : 2,
    };
  }).filter((m) => m.name && !seen.has(m.name.toLowerCase()) && seen.add(m.name.toLowerCase()));
}

async function generateSteps(meal) {
  const system = "You are an Indian home cook. Give brief, clear home-cooking steps. Return ONLY valid JSON, no prose, no fences.";
  const user =
    `Dish: ${meal.name}. Ingredients: ${(meal.ingredients || []).join(", ") || "common pantry items"}. Servings: ${meal.servings || 2}. ` +
    'Give between 3 and 10 short steps, each a single clear sentence. Return {"steps": [string, ...]}.';
  const out = parseJSON(await callClaude({ system, user, maxTokens: 1024, tier: "light" }));
  let steps = Array.isArray(out.steps) ? out.steps.map((s) => String(s).trim()).filter(Boolean) : [];
  return steps.slice(0, 10);
}

function mealMatch(meal, pantry) {
  const have = pantry.map((p) => norm(p.name));
  const missing = [];
  let matched = 0;
  for (const ing of meal.ingredients) {
    const n = norm(ing);
    if (have.some((h) => h && (h.includes(n) || n.includes(h)))) matched++;
    else missing.push(ing);
  }
  const total = meal.ingredients.length || 1;
  return { matched, total, missing, pct: Math.round((matched / total) * 100) };
}

/* ─────────────────────────────  app context  ─────────────────────────── */

const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

/* ─────────────────────────────  UI atoms  ─────────────────────────────── */

function Btn({ variant = "solid", size = "md", className = "", ...p }) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition active:scale-[.97] disabled:opacity-50 disabled:pointer-events-none select-none";
  const sizes = { sm: "text-sm px-3 h-9", md: "text-[15px] px-4 h-11", icon: "h-10 w-10" };
  const variants = {
    solid: "bg-emerald-700 text-white shadow-sm shadow-emerald-900/10 hover:bg-emerald-800",
    ai: "bg-amber-500 text-white shadow-sm shadow-amber-900/10 hover:bg-amber-600",
    soft: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    ghost: "text-stone-600 hover:bg-stone-100",
    danger: "bg-rose-50 text-rose-700 hover:bg-rose-100",
    outline: "ring-1 ring-stone-200 text-stone-700 bg-white hover:bg-stone-50",
  };
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...p} />;
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
    </label>
  );
}
const inputCls = "w-full h-11 px-3 rounded-xl bg-white ring-1 ring-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none text-[15px] text-stone-800 placeholder:text-stone-400";
const TextInput = (p) => <input className={inputCls} {...p} />;
const Select = ({ children, ...p }) => <select className={inputCls + " appearance-none pr-8"} {...p}>{children}</select>;

function Sheet({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-stone-50 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col animate-[slideUp_.2s_ease]">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-200/70 shrink-0">
          <h3 className="text-lg font-bold text-stone-800" style={{ fontFamily: HEAD }}>{title}</h3>
          <button onClick={onClose} className="h-9 w-9 grid place-items-center rounded-full hover:bg-stone-200 text-stone-500"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-stone-200/70 shrink-0">{footer}</div>}
      </div>
      <style>{`@keyframes slideUp{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}

function Empty({ icon: Icon, title, sub, action }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="mx-auto h-16 w-16 rounded-2xl bg-emerald-50 grid place-items-center text-emerald-600 mb-4"><Icon size={28} /></div>
      <p className="font-bold text-stone-700" style={{ fontFamily: HEAD }}>{title}</p>
      <p className="text-sm text-stone-500 mt-1 max-w-xs mx-auto">{sub}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-3 mt-2">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-stone-500">{children}</h2>
      {right}
    </div>
  );
}

/* ─────────────────────────────  image picker  ─────────────────────────── */
// Always resolves an array of {data, mediaType} — one photo or a whole batch.
// Every photo is downscaled + re-encoded as JPEG first: a phone photo is
// commonly 3–8MB, and 15–20 of those in one request (60–150MB) is what fails
// on upload or hits the AI provider's request-size limit. Compressing first
// keeps even a big batch small and reliable.

function compressImage(file, maxDim = 1440, quality = 0.72) {
  return new Promise((resolve) => {
    const fallback = () => {
      const reader = new FileReader();
      reader.onload = () => resolve({ data: String(reader.result).split(",")[1], mediaType: file.type || "image/jpeg" });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) { fallback(); return; }
          const reader = new FileReader();
          reader.onload = () => resolve({ data: String(reader.result).split(",")[1], mediaType: "image/jpeg" });
          reader.onerror = fallback;
          reader.readAsDataURL(blob);
        }, "image/jpeg", quality);
      };
      img.onerror = fallback;
      img.src = url;
    } catch (_) { fallback(); }
  });
}

function usePhoto() {
  const inputRef = useRef(null);
  const resolver = useRef(null);
  const node = (
    <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = "";
        const resolve = resolver.current;
        resolver.current = null;
        if (!files.length || !resolve) { resolve && resolve([]); return; }
        Promise.all(files.map((file) => compressImage(file))).then((imgs) => resolve(imgs.filter(Boolean))).catch(() => resolve([]));
      }} />
  );
  const pick = () => new Promise((res) => { resolver.current = res; inputRef.current && inputRef.current.click(); });
  return { node, pick };
}

/* ─────────────────────────────  Inventory tab  ────────────────────────── */


function ConfBadge({ c }) {
  const map = { high: "bg-emerald-100 text-emerald-700", medium: "bg-amber-100 text-amber-700", low: "bg-rose-100 text-rose-700" };
  return <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${map[c] || map.medium}`}>{c}</span>;
}

const QTY_STEP = { g: 50, kg: 0.25, lb: 0.5, oz: 4, ml: 100, L: 0.25, cup: 0.5, pcs: 1, dozen: 1, pack: 1 };
function InvRow({ item, onAdjust, onEdit, onDelete }) {
  const step = QTY_STEP[item.unit] || 1;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);
  const st = expiryStatus(item);
  const TH = 56;

  const down = (e) => { start.current = e.clientX; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (!dragging) return; setDx(Math.max(-96, Math.min(96, e.clientX - start.current))); };
  const up = () => {
    if (dx >= TH) onAdjust(item.id, +step);
    else if (dx <= -TH) onAdjust(item.id, -step);
    setDx(0); setDragging(false);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* swipe reveals */}
      <div className="absolute inset-0 flex items-center justify-between px-5 text-white font-bold">
        <span className={`flex items-center gap-1 transition-opacity ${dx > 8 ? "opacity-100" : "opacity-0"}`}><Plus size={18} /> Add {step}</span>
        <span className={`flex items-center gap-1 transition-opacity ${dx < -8 ? "opacity-100" : "opacity-0"}`}>Use {step} <Minus size={18} /></span>
      </div>
      <div className="absolute inset-0 flex">
        <div className="flex-1 bg-emerald-500" style={{ opacity: Math.max(0, dx) / 96 }} />
        <div className="flex-1 bg-rose-500" style={{ opacity: Math.max(0, -dx) / 96 }} />
      </div>
      {/* card */}
      <div
        className="relative bg-white ring-1 ring-stone-200/80 p-3 flex items-center gap-3 touch-pan-y"
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : "transform .18s ease" }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      >
        <div className="h-11 w-11 shrink-0 rounded-xl bg-stone-50 grid place-items-center text-xl">{CAT_EMOJI[item.category] || "📦"}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-bold text-stone-800 truncate" style={{ fontFamily: HEAD }}>{item.name}</p>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ring-1 ${TONE[st.tone]}`}>{st.label}</span>
            <span className="text-xs text-stone-400">{item.category}</span>
          </div>
        </div>
        {/* stepper */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onAdjust(item.id, -step)} className="h-8 w-8 grid place-items-center rounded-lg bg-stone-100 text-stone-600 hover:bg-rose-100 hover:text-rose-600 active:scale-95"><Minus size={15} /></button>
          <span className="w-14 text-center font-bold text-stone-800 tabular-nums">{item.quantity}<span className="text-[10px] font-medium text-stone-400 ml-0.5">{item.unit}</span></span>
          <button onClick={() => onAdjust(item.id, +step)} className="h-8 w-8 grid place-items-center rounded-lg bg-stone-100 text-stone-600 hover:bg-emerald-100 hover:text-emerald-600 active:scale-95"><Plus size={15} /></button>
        </div>
        <button onClick={() => onEdit(item)} className="h-8 w-8 grid place-items-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 shrink-0"><Pencil size={14} /></button>
      </div>
    </div>
  );
}

function ItemForm({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial || { name: "", category: "Produce", quantity: 1, unit: "pcs", purchase: todayISO(), expiry: "" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const autoExpiry = () => setF((s) => ({ ...s, expiry: addDays(s.purchase || todayISO(), SHELF_DAYS[s.category] || 30) }));
  const save = () => {
    if (!f.name.trim()) return;
    onSave({ ...f, name: f.name.trim(), quantity: Math.max(0, Number(f.quantity) || 0) });
  };
  return (
    <>
      <Field label="Item name"><TextInput value={f.name} onChange={set("name")} placeholder="e.g. Roma tomatoes" autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category"><Select value={f.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Qty"><TextInput type="number" min="0" value={f.quantity} onChange={set("quantity")} /></Field>
          <Field label="Unit"><TextInput value={f.unit} onChange={set("unit")} placeholder="pcs" /></Field>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Purchased"><TextInput type="date" value={f.purchase} onChange={set("purchase")} /></Field>
        <Field label="Best by"><TextInput type="date" value={f.expiry} onChange={set("expiry")} /></Field>
      </div>
      <button onClick={autoExpiry} className="text-sm font-semibold text-amber-600 flex items-center gap-1"><Sparkles size={14} /> Estimate best-by from category</button>
      <div className="flex gap-2 pt-1">
        <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn className="flex-1" onClick={save}><Check size={16} /> {initial ? "Save changes" : "Add item"}</Btn>
      </div>
    </>
  );
}

function InventoryTab() {
  const { pantry, addItem, updateItem, adjustQty, removeItem, clearPantry, notify } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("expiry");
  const [form, setForm] = useState(null); // {} for new, item for edit

  let rows = pantry.filter((i) =>
    (cat === "All" || i.category === cat) && (!q || i.name.toLowerCase().includes(q.toLowerCase())));
  rows = [...rows].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "category") return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    const ax = a.expiry ? daysUntil(a.expiry) : 9e9, bx = b.expiry ? daysUntil(b.expiry) : 9e9;
    return ax - bx;
  });

  const expiring = pantry.filter((i) => i.expiry && daysUntil(i.expiry) <= 3).length;

  return (
    <div className="pb-4">
      <div className="px-4 pt-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inventory" className={inputCls + " pl-9"} />
          </div>
          <Btn size="icon" onClick={() => setForm({})}><Plus size={20} /></Btn>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 pl-2 pr-7 rounded-lg bg-white ring-1 ring-stone-200 text-sm font-semibold text-stone-600 shrink-0">
            <option value="All">All categories</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 pl-2 pr-7 rounded-lg bg-white ring-1 ring-stone-200 text-sm font-semibold text-stone-600 shrink-0">
            <option value="expiry">Sort: Best-by</option>
            <option value="name">Sort: Name</option>
            <option value="category">Sort: Category</option>
          </select>
        </div>
      </div>

      {expiring > 0 && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm text-amber-800">
          <Clock size={16} /> <b>{expiring}</b> item{expiring > 1 ? "s" : ""} expiring within 3 days — use them soon.
        </div>
      )}

      {rows.length === 0 ? (
        <Empty icon={Package} title={pantry.length ? "Nothing matches" : "Your inventory is empty"}
          sub={pantry.length ? "Try a different search or category." : "Add items by hand, or snap a receipt or your groceries under Scan & add."}
          action={!pantry.length && <Btn onClick={() => setForm({})}><Plus size={16} /> Add first item</Btn>} />
      ) : (
        <>
          <div className="px-4 mt-3 space-y-2">
            <p className="text-xs text-stone-400 text-center mb-1">Swipe a row right to add · left to use one · a row hits 0 and it's gone</p>
            {rows.map((i) => (
              <InvRow key={i.id} item={i} onAdjust={adjustQty} onEdit={setForm}
                onDelete={(id) => { removeItem(id); notify("Removed"); }} />
            ))}
          </div>
          <div className="px-4 mt-4">
            <button onClick={() => { if (confirm("Clear the whole inventory?")) { clearPantry(); notify("Inventory cleared"); } }}
              className="text-sm text-stone-400 hover:text-rose-600 flex items-center gap-1 mx-auto"><Trash2 size={14} /> Clear inventory</button>
          </div>
        </>
      )}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form && form.id ? "Edit item" : "Add item"}>
        {form && <ItemForm initial={form.id ? form : null}
          onSave={(v) => { form.id ? updateItem(form.id, v) : addItem(v); notify(form.id ? "Item updated" : "Item added"); setForm(null); }}
          onClose={() => setForm(null)} />}
      </Sheet>
    </div>
  );
}

/* ─────────────────────────────  Scan tab  ─────────────────────────────── */

function ScanTab({ openSettings }) {
  const { pantry, addOrMerge, replacePantry, notify } = useApp();
  const { node, pick } = usePhoto();
  const [busy, setBusy] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [batchProgress, setBatchProgress] = useState(null); // {i, n} while batching a big photo set
  const [err, setErr] = useState("");
  const [paste, setPaste] = useState(false);
  const [result, setResult] = useState(null);   // { items, added, undoSnapshot } after auto-commit
  const hasKey = aiReady();

  const run = async (mode) => {
    setErr(""); setResult(null); setBatchProgress(null);
    if (!aiReady()) { setErr("Photo scanning uses AI, which needs an API key. Tap the gear (⚙️) to add one — or use “Paste a list” below to add items without AI."); return; }
    const imgs = await pick();                 // opens gallery — pick one or several at once (auto-compressed)
    if (!imgs.length) return;                   // cancelled
    setBusyCount(imgs.length); setBusy(true);
    try {
      const res = await extractFromImages(imgs, mode, (i, n) => n > 1 && setBatchProgress({ i, n }));
      if (!res.items.length) throw new Error("No items found. Try clearer, well-lit photos.");
      const before = pantry;                      // snapshot for undo
      const added = addOrMerge(res.items);
      setResult({ items: res.items, added, undoSnapshot: before });
      notify(`${added} item${added > 1 ? "s" : ""} added to inventory`);
    } catch (e) { setErr(e.message || "Scan failed. Please try again — or split into a couple of smaller batches."); }
    finally { setBusy(false); setBatchProgress(null); }
  };

  const addPasted = (text) => {
    const parsed = parseBulk(text);
    if (!parsed.length) { setErr("Type at least one item, e.g. “Okra 2”."); return; }
    const before = pantry;
    const added = addOrMerge(parsed);
    setResult({ items: parsed, added, undoSnapshot: before });
    notify(`${added} item${added > 1 ? "s" : ""} added to inventory`);
    setPaste(false);
  };

  const undo = () => {
    if (!result) return;
    replacePantry(result.undoSnapshot);
    notify("Undone");
    setResult(null);
  };

  return (
    <div className="px-4 pt-2 pb-4">
      {node}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-700 to-emerald-900 text-white p-6 text-center relative overflow-hidden">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute -left-8 -bottom-8 h-28 w-28 rounded-full bg-white/5" />
        <div className="relative">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-white/15 grid place-items-center mb-3"><Camera size={26} /></div>
          <h2 className="text-xl font-bold" style={{ fontFamily: HEAD }}>Fill your inventory fast</h2>
          <p className="text-emerald-100/90 text-sm mt-1 max-w-xs mx-auto">Pick one photo or several at once — everything gets analysed together and added straight to inventory.</p>
        </div>
      </div>

      {!hasKey && (
        <button onClick={openSettings} className="mt-4 w-full flex items-center gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 text-sm text-amber-800 text-left">
          <KeyRound size={16} className="shrink-0" /> <span>Photo scanning needs an API key. <b>Tap to add one.</b> Or paste a list below — no key needed.</span>
        </button>
      )}
      {err && <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2.5 text-sm text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {err}</div>}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <button disabled={busy} onClick={() => run("receipt")} className="rounded-2xl bg-white ring-1 ring-stone-200 p-5 text-center hover:ring-emerald-300 hover:shadow-sm transition disabled:opacity-50">
          <Receipt size={24} className="mx-auto text-emerald-700 mb-2" />
          <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>Scan receipt(s)</p>
          <p className="text-xs text-stone-400 mt-0.5">Multi-page OK — pick several</p>
        </button>
        <button disabled={busy} onClick={() => run("groceries")} className="rounded-2xl bg-white ring-1 ring-stone-200 p-5 text-center hover:ring-emerald-300 hover:shadow-sm transition disabled:opacity-50">
          <ImagePlus size={24} className="mx-auto text-emerald-700 mb-2" />
          <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>Snap groceries</p>
          <p className="text-xs text-stone-400 mt-0.5">Select the whole batch at once</p>
        </button>
      </div>

      <button disabled={busy} onClick={() => { setErr(""); setResult(null); setPaste(true); }} className="mt-3 w-full rounded-2xl bg-stone-800 text-white p-4 flex items-center justify-center gap-2 font-semibold active:scale-[.99] transition disabled:opacity-50">
        <ClipboardList size={18} /> Paste a list  <span className="text-stone-400 font-normal text-sm">· no key needed</span>
      </button>

      {busy && (
        <div className="mt-6 flex flex-col items-center gap-2 text-amber-600">
          <Loader2 size={26} className="animate-spin" />
          <p className="text-sm font-semibold">
            {batchProgress
              ? `Analysing batch ${batchProgress.i} of ${batchProgress.n} (${busyCount} photos)…`
              : `Analysing ${busyCount > 1 ? `${busyCount} photos together` : "your photo"}…`}
          </p>
        </div>
      )}

      {result && (
        <div className="mt-5 rounded-2xl bg-white ring-1 ring-emerald-200 p-4">
          <div className="flex items-center justify-between">
            <p className="font-bold text-emerald-700 flex items-center gap-1.5" style={{ fontFamily: HEAD }}><CircleCheck size={17} /> Added to inventory</p>
            <button onClick={undo} className="text-xs font-bold text-stone-400 hover:text-rose-600 flex items-center gap-1"><RotateCcw size={12} /> Undo</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {result.items.map((it, i) => (
              <span key={i} className="text-xs bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15 rounded-md px-2 py-1">{CAT_EMOJI[it.category] || "📦"} {it.name} ×{it.quantity}</span>
            ))}
          </div>
        </div>
      )}

      <Sheet open={paste} onClose={() => setPaste(false)} title="Paste a list">
        <BulkPaste onAdd={addPasted} onClose={() => setPaste(false)} />
      </Sheet>
    </div>
  );
}

function BulkPaste({ onAdd, onClose }) {
  const [text, setText] = useState("");
  const preview = parseBulk(text);
  return (
    <>
      <p className="text-sm text-stone-500">One item per line. Add a number for quantity — it's optional.</p>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} autoFocus rows={7}
        placeholder={"Okra 2\nDoodhi 1\nYellow Onions 3\nSona Masoori Rice\nChicken Drumsticks x2"}
        className="w-full p-3 rounded-xl bg-white ring-1 ring-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none text-[15px] text-stone-800 font-mono resize-none"
      />
      <p className="text-xs text-stone-400">Formats that work: <code>Okra 2</code> · <code>2 Okra</code> · <code>Okra x2</code> · <code>Onions - 3</code></p>
      {preview.length > 0 && (
        <div className="rounded-xl bg-stone-50 ring-1 ring-stone-200 p-2 max-h-32 overflow-y-auto">
          <p className="text-[11px] font-bold uppercase text-stone-400 px-1 mb-1">{preview.length} item{preview.length > 1 ? "s" : ""} detected</p>
          <div className="flex flex-wrap gap-1">
            {preview.map((p, i) => <span key={i} className="text-xs bg-white ring-1 ring-stone-200 rounded-md px-1.5 py-0.5">{CAT_EMOJI[p.category]} {p.name} ×{p.quantity}</span>)}
          </div>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn className="flex-1" disabled={!preview.length} onClick={() => onAdd(text)}><Check size={16} /> Review {preview.length || ""}</Btn>
      </div>
    </>
  );
}

/* ─────────────────────────────  Meals tab  ─────────────────────────────── */

const TYPE_META = {
  breakfast: { label: "Breakfast", icon: "🌅" },
  lunch: { label: "Lunch", icon: "🍛" },
  dinner: { label: "Dinner", icon: "🌙" },
  dessert: { label: "Dessert", icon: "🍮" },
};

function MealCard({ meal, pantry, onOpen, onSave, onPlan, planned, planning }) {
  const mm = mealMatch(meal, pantry);
  return (
    <div className="rounded-2xl bg-white ring-1 ring-stone-200 overflow-hidden">
      <button onClick={onOpen} className="w-full text-left p-4 active:bg-stone-50 transition">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>{meal.name}</p>
              {planned && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">PLANNED</span>}
            </div>
            {meal.description && <p className="text-sm text-stone-500 mt-0.5">{meal.description}</p>}
          </div>
          <div className="text-right shrink-0">
            <div className={`text-sm font-bold ${mm.pct >= 70 ? "text-emerald-600" : mm.pct >= 40 ? "text-amber-600" : "text-stone-400"}`}>{mm.pct}%</div>
            <div className="text-[10px] text-stone-400 uppercase font-bold">have it</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {meal.ingredients.map((ing, k) => {
            const has = pantry.some((p) => { const n = norm(ing), h = norm(p.name); return h && (h.includes(n) || n.includes(h)); });
            return <span key={k} className={`text-[11px] px-1.5 py-0.5 rounded-md ${has ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-400"}`}>{ing}</span>;
          })}
        </div>
        {mm.missing.length > 0 && <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1"><ShoppingCart size={11} /> Need: {mm.missing.slice(0, 4).join(", ")}{mm.missing.length > 4 ? "…" : ""}</p>}
        <p className="text-[11px] text-stone-400 mt-2 flex items-center gap-1"><BookOpen size={11} /> Tap for the recipe</p>
      </button>
      <div className="flex gap-2 px-4 pb-3">
        {onSave && <Btn size="sm" variant="soft" className="flex-1" onClick={onSave}><Star size={14} /> Save</Btn>}
        <Btn size="sm" className="flex-1" onClick={onPlan} disabled={planning}>
          {planning ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />} {planning ? "Prepping recipe…" : "Plan today"}
        </Btn>
      </div>
    </div>
  );
}

function RecipeSheet({ dish, pantry, steps, loading, err, onSave, onPlan, planned }) {
  if (!dish) return null;
  const mm = mealMatch(dish, pantry);
  const tm = TYPE_META[dish.type] || {};
  return (
    <>
      <div className="flex items-center gap-2 -mt-1">
        {tm.label && <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{tm.icon} {tm.label}</span>}
        <span className="text-xs text-stone-400">{dish.servings} servings · {mm.matched}/{mm.total} on hand</span>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-stone-400 mb-1.5">Ingredients</p>
        <div className="flex flex-wrap gap-1.5">
          {dish.ingredients.map((ing, k) => {
            const has = pantry.some((p) => { const n = norm(ing), h = norm(p.name); return h && (h.includes(n) || n.includes(h)); });
            return <span key={k} className={`text-xs px-2 py-1 rounded-lg ring-1 ${has ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15" : "bg-amber-50 text-amber-700 ring-amber-600/20"}`}>{has ? "✓" : "+"} {ing}</span>;
          })}
        </div>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-stone-400 mb-1.5">Steps</p>
        {loading && <div className="flex items-center gap-2 text-amber-600 py-3"><Loader2 size={18} className="animate-spin" /> <span className="text-sm font-semibold">Writing the recipe…</span></div>}
        {err && <div className="flex items-center gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-sm text-rose-700"><AlertTriangle size={16} /> {err}</div>}
        {steps && steps.length > 0 && (
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-emerald-700 text-white text-xs font-bold grid place-items-center">{i + 1}</span>
                <span className="text-[15px] text-stone-700 leading-snug pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        {onSave && <Btn variant="soft" className="flex-1" onClick={onSave}><Star size={16} /> Save</Btn>}
        <Btn className="flex-1" onClick={onPlan}><CalendarPlus size={16} /> {planned ? "Planned" : "Plan today"}</Btn>
      </div>
    </>
  );
}

function MealIdeas() {
  const { pantry, meals, ideas, setIdeas, ideasSig, setIdeasSig, addMeal, removeMeal, toggleFav, scheduleMeal, setMealSteps, notify } = useApp();
  const [busy, setBusy] = useState(false);      // true only for the first, explicit generate
  const [refreshing, setRefreshing] = useState(false); // true for silent background auto-refresh
  const [err, setErr] = useState("");
  const [manual, setManual] = useState(false);
  const [section, setSection] = useState("all");
  const [open, setOpen] = useState(null);            // dish currently shown in recipe sheet
  const [stepCache, setStepCache] = useState({});    // name -> {steps,loading,err}
  const [planning, setPlanning] = useState(null);    // name of dish currently being planned (preloading steps)
  const refreshTimer = useRef(null);

  const fetchStepsFor = async (dish, mealId) => {
    setStepCache((c) => ({ ...c, [dish.name]: { loading: true } }));
    try {
      const steps = await generateSteps(dish);
      setStepCache((c) => ({ ...c, [dish.name]: { steps } }));
      if (mealId) setMealSteps(mealId, steps);
      return steps;
    } catch (e) {
      setStepCache((c) => ({ ...c, [dish.name]: { err: e.message || "Couldn't write the recipe." } }));
      return null;
    }
  };

  const generate = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await suggestMeals(pantry);
      if (!res.length) throw new Error("No suggestions came back. Try again.");
      setIdeas(res);
      setIdeasSig(pantrySig(pantry));
    } catch (e) { setErr(e.message || "Couldn't get suggestions."); }
    finally { setBusy(false); }
  };

  // Auto-refresh in the background whenever the pantry changes — old suggestions
  // stay on screen the whole time, only swapped once fresh ones arrive.
  useEffect(() => {
    if (!ideas.length || busy || refreshing) return;
    const sig = pantrySig(pantry);
    if (sig === ideasSig) return;
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      if (!aiReady()) return; // silently skip if no key/proxy configured
      setRefreshing(true);
      try {
        const res = await suggestMeals(pantry);
        if (res.length) { setIdeas(res); setIdeasSig(pantrySig(pantry)); }
      } catch (_) { /* stay on old suggestions rather than error the user for a background refresh */ }
      finally { setRefreshing(false); }
    }, 2500);
    return () => clearTimeout(refreshTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantry, ideas.length, ideasSig]);

  // Saving/planning a dish. When scheduling for today, preload the recipe steps
  // right away — since it's already intended to be cooked, no extra tap needed.
  const saveIdea = async (m, schedule) => {
    let steps = stepCache[m.name]?.steps || null;
    if (schedule && !steps) { setPlanning(m.name); steps = await fetchStepsFor(m); setPlanning(null); }
    addMeal({ ...m, favorite: false, scheduledDate: schedule ? todayISO() : null, steps });
    notify(schedule ? "Planned for today · recipe ready" : "Saved to meals");
    setIdeas((s) => s.filter((x) => x.name !== m.name));
  };

  const planSavedToday = async (m) => {
    scheduleMeal(m.id, todayISO());
    if (!m.steps) { setPlanning(m.name); await fetchStepsFor(m, m.id); setPlanning(null); }
    notify("Planned for today · recipe ready");
  };

  // open recipe + lazily fetch steps (used for "just browsing", not planning)
  const openRecipe = async (dish, mealId) => {
    setOpen({ ...dish, mealId });
    const cached = (mealId && dish.steps) ? dish.steps : stepCache[dish.name]?.steps;
    if (cached && cached.length) { setStepCache((c) => ({ ...c, [dish.name]: { steps: cached } })); return; }
    await fetchStepsFor(dish, mealId);
  };

  // combine AI ideas + saved meals for browsing; saved meals flagged
  const savedNames = new Set(meals.map((m) => m.name.toLowerCase()));
  const browse = [
    ...meals.map((m) => ({ ...m, _saved: true, planned: !!m.scheduledDate })),
    ...ideas.filter((m) => !savedNames.has(m.name.toLowerCase())).map((m) => ({ ...m, _saved: false })),
  ];
  const inSection = browse.filter((m) => section === "all" || m.type === section);
  const withPct = inSection.map((m) => ({ m, mm: mealMatch(m, pantry) })).sort((a, b) => b.mm.pct - a.mm.pct);
  const ready = withPct.filter((x) => x.mm.missing.length <= 1);
  const needMore = withPct.filter((x) => x.mm.missing.length > 1);

  const openStep = open ? (stepCache[open.name] || {}) : {};
  const countByType = (t) => browse.filter((m) => m.type === t).length;

  return (
    <div className="px-4 pt-2 pb-4">
      <button onClick={generate} disabled={busy}
        className="w-full rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 text-white p-5 text-left relative overflow-hidden active:scale-[.99] transition disabled:opacity-70">
        <div className="absolute right-4 top-4 opacity-30"><Sparkles size={48} /></div>
        <div className="flex items-center gap-2 font-bold text-lg" style={{ fontFamily: HEAD }}>
          {busy ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />} {ideas.length ? "Refresh suggestions" : "Suggest Indian dishes"}
        </div>
        <p className="text-amber-50/90 text-sm mt-1 max-w-[17rem]">
          {pantry.length ? `~40 breakfast, lunch, dinner & dessert ideas from the ${pantry.length} things you have.` : "Add inventory first for tailored ideas."}
        </p>
      </button>
      {err && <div className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-sm text-rose-700"><AlertTriangle size={16} /> {err}</div>}
      {busy && <p className="text-center text-sm text-amber-600 mt-3 flex items-center justify-center gap-1"><Loader2 size={14} className="animate-spin" /> Cooking up ~40 dishes…</p>}
      {refreshing && <p className="text-center text-xs text-stone-400 mt-3 flex items-center justify-center gap-1"><Loader2 size={12} className="animate-spin" /> New items detected — quietly refreshing ideas…</p>}

      {/* section filter */}
      {browse.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mt-4 -mx-1 px-1">
          {[["all", "All", "🍽️"], ...MEAL_TYPES.map((t) => [t, TYPE_META[t].label, TYPE_META[t].icon])].map(([id, label, icon]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`shrink-0 h-9 px-3 rounded-full text-sm font-semibold ring-1 transition ${section === id ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-stone-600 ring-stone-200"}`}>
              {icon} {label} {id !== "all" && countByType(id) > 0 && <span className={section === id ? "text-emerald-200" : "text-stone-400"}>·{countByType(id)}</span>}
            </button>
          ))}
        </div>
      )}

      {browse.length === 0 ? (
        <div className="mt-2"><Empty icon={Utensils} title="No dishes yet"
          sub={pantry.length === 0
            ? "Your pantry is empty, so there's nothing to suggest from yet. Add items, then tap “Suggest Indian dishes.”"
            : "Tap “Suggest Indian dishes” for ~40 ideas across breakfast, lunch, dinner and dessert — or add one by hand."}
          action={<Btn variant="outline" onClick={() => setManual(true)}><Plus size={16} /> Add manually</Btn>} /></div>
      ) : (
        <div className="mt-3 space-y-2">
          {ready.length > 0 && <p className="text-[13px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1 mt-1"><CircleCheck size={14} /> Ready to cook</p>}
          {ready.map(({ m }) => (
            <MealCard key={(m.id || m.name)} meal={m} pantry={pantry} planned={m.planned} planning={planning === m.name}
              onOpen={() => openRecipe(m, m._saved ? m.id : null)}
              onSave={m._saved ? null : () => saveIdea(m, false)}
              onPlan={() => (m._saved ? planSavedToday(m) : saveIdea(m, true))} />
          ))}
          {needMore.length > 0 && <p className="text-[13px] font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1 mt-4"><ShoppingCart size={14} /> Need a few more items</p>}
          {needMore.map(({ m }) => (
            <MealCard key={(m.id || m.name)} meal={m} pantry={pantry} planned={m.planned} planning={planning === m.name}
              onOpen={() => openRecipe(m, m._saved ? m.id : null)}
              onSave={m._saved ? null : () => saveIdea(m, false)}
              onPlan={() => (m._saved ? planSavedToday(m) : saveIdea(m, true))} />
          ))}
        </div>
      )}

      {/* saved meals management */}
      <div className="mt-6">
        <SectionTitle right={<button onClick={() => setManual(true)} className="text-sm font-bold text-emerald-700 flex items-center gap-1"><Plus size={14} /> Add</button>}>
          Saved meals {meals.length ? `· ${meals.length}` : ""}
        </SectionTitle>
        {meals.length === 0 ? (
          <p className="text-sm text-stone-400 py-2">Save any dish above to keep it here and schedule it.</p>
        ) : (
          <div className="space-y-1.5">
            {meals.map((m) => (
              <div key={m.id} className="rounded-xl bg-white ring-1 ring-stone-200 p-2.5 flex items-center gap-2">
                <button onClick={() => toggleFav(m.id)} className={`h-8 w-8 grid place-items-center rounded-lg shrink-0 ${m.favorite ? "text-amber-500" : "text-stone-300"}`}><Star size={16} fill={m.favorite ? "currentColor" : "none"} /></button>
                <button onClick={() => openRecipe(m, m.id)} className="min-w-0 flex-1 text-left">
                  <p className="font-semibold text-stone-800 truncate">{m.name}</p>
                  <p className="text-xs text-stone-400">{(TYPE_META[m.type] || {}).label || "Meal"} · {m.servings} servings{m.scheduledDate ? " · planned" : ""}</p>
                </button>
                <Btn size="sm" variant="danger" onClick={() => { removeMeal(m.id); notify("Meal deleted"); }}><Trash2 size={14} /></Btn>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name || "Recipe"}>
        <RecipeSheet dish={open} pantry={pantry} steps={openStep.steps} loading={openStep.loading} err={openStep.err}
          planned={open?.mealId ? meals.find((x) => x.id === open.mealId)?.scheduledDate : false}
          onSave={open && !open.mealId ? () => { saveIdea(open, false); setOpen(null); } : null}
          onPlan={() => { (open.mealId ? planSavedToday(meals.find((x) => x.id === open.mealId)) : saveIdea(open, true)); setOpen(null); }} />
      </Sheet>

      <Sheet open={manual} onClose={() => setManual(false)} title="Add a meal">
        <ManualMeal onSave={(m) => { addMeal({ ...m, type: m.type || "dinner", favorite: false, scheduledDate: null }); notify("Meal added"); setManual(false); }} onClose={() => setManual(false)} />
      </Sheet>
    </div>
  );
}

function ManualMeal({ onSave, onClose }) {
  const [f, setF] = useState({ name: "", type: "dinner", description: "", ingredients: "", servings: 2 });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <Field label="Meal name"><TextInput value={f.name} onChange={set("name")} placeholder="e.g. Masala Dosa" autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><Select value={f.type} onChange={set("type")}>{MEAL_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</Select></Field>
        <Field label="Servings"><TextInput type="number" min="1" value={f.servings} onChange={set("servings")} /></Field>
      </div>
      <Field label="Description"><TextInput value={f.description} onChange={set("description")} placeholder="Optional" /></Field>
      <Field label="Ingredients" hint="Comma separated"><TextInput value={f.ingredients} onChange={set("ingredients")} placeholder="rice, dal, onion, cumin" /></Field>
      <div className="flex gap-2 pt-1">
        <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn className="flex-1" disabled={!f.name.trim()} onClick={() => onSave({
          name: f.name.trim(), type: f.type, description: f.description.trim(),
          ingredients: f.ingredients.split(",").map((x) => x.trim()).filter(Boolean),
          servings: Math.max(1, Number(f.servings) || 1),
        })}><Check size={16} /> Add meal</Btn>
      </div>
    </>
  );
}

/* ─────────────────────────────  Planner tab  ──────────────────────────── */

// Swipe right to bump servings (1→2→3…), swipe left to delete the planned meal.
function PlannedMealRow({ meal, onServings, onReschedule, onUnschedule, onDelete }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);
  const TH = 56;

  const down = (e) => { start.current = e.clientX; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (!dragging) return; setDx(Math.max(-96, Math.min(96, e.clientX - start.current))); };
  const up = () => {
    if (dx >= TH) onServings(+1);
    else if (dx <= -TH) onDelete();
    setDx(0); setDragging(false);
  };

  return (
    <div className="relative overflow-hidden rounded-xl ml-2">
      <div className="absolute inset-0 flex items-center justify-between px-4 text-white font-bold text-sm">
        <span className={`flex items-center gap-1 transition-opacity ${dx > 8 ? "opacity-100" : "opacity-0"}`}><Plus size={16} /> +1 serving</span>
        <span className={`flex items-center gap-1 transition-opacity ${dx < -8 ? "opacity-100" : "opacity-0"}`}>Delete <Trash2 size={16} /></span>
      </div>
      <div className="absolute inset-0 flex">
        <div className="flex-1 bg-emerald-500" style={{ opacity: Math.max(0, dx) / 96 }} />
        <div className="flex-1 bg-rose-500" style={{ opacity: Math.max(0, -dx) / 96 }} />
      </div>
      <div className="relative bg-white ring-1 ring-stone-200 p-3 flex items-center gap-3 touch-pan-y"
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : "transform .18s ease" }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <Utensils size={16} className="text-emerald-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-stone-800 truncate">{meal.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <button onClick={() => onServings(-1)} className="h-5 w-5 grid place-items-center rounded bg-stone-100 text-stone-500"><Minus size={11} /></button>
            <span className="text-xs text-stone-400 tabular-nums w-16">{meal.servings} servings</span>
            <button onClick={() => onServings(+1)} className="h-5 w-5 grid place-items-center rounded bg-stone-100 text-stone-500"><Plus size={11} /></button>
          </div>
        </div>
        <button onClick={onReschedule} className="h-8 w-8 grid place-items-center rounded-lg text-stone-400 hover:bg-stone-100 shrink-0"><CalendarDays size={15} /></button>
        <button onClick={onUnschedule} className="h-8 w-8 grid place-items-center rounded-lg text-stone-400 hover:bg-stone-100 shrink-0"><RotateCcw size={15} /></button>
      </div>
    </div>
  );
}

function PlannerTab() {
  const { meals, scheduleMeal, removeMeal, setMealServings, notify } = useApp();
  const [picking, setPicking] = useState(null); // meal being scheduled

  const scheduled = meals.filter((m) => m.scheduledDate);
  const ideas = meals.filter((m) => !m.scheduledDate);

  const groups = {};
  scheduled.forEach((m) => { (groups[m.scheduledDate] = groups[m.scheduledDate] || []).push(m); });
  const dates = Object.keys(groups).sort();

  const label = (iso) => {
    const d = daysUntil(iso);
    if (d < 0) return `${fmtLong(iso)} · overdue`;
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d <= 6) return fmtLong(iso);
    return fmtLong(iso);
  };

  if (!meals.length) return <div className="pt-2"><Empty icon={CalendarDays} title="No meals planned yet" sub="Save meals under Ideas, then schedule them here." /></div>;

  return (
    <div className="px-4 pt-2 pb-4 space-y-5">
      {dates.length > 0 && (
        <div>
          <SectionTitle>Scheduled</SectionTitle>
          <p className="text-xs text-stone-400 -mt-2 mb-2">Swipe a meal right to add a serving · left to delete</p>
          <div className="space-y-4">
            {dates.map((iso) => (
              <div key={iso}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`h-8 w-8 grid place-items-center rounded-lg ${daysUntil(iso) < 0 ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-700"}`}><CalendarClock size={16} /></div>
                  <p className="font-bold text-stone-700" style={{ fontFamily: HEAD }}>{label(iso)}</p>
                </div>
                <div className="space-y-2 pl-2 border-l-2 border-stone-200 ml-4">
                  {groups[iso].map((m) => (
                    <PlannedMealRow key={m.id} meal={m}
                      onServings={(d) => setMealServings(m.id, d)}
                      onReschedule={() => setPicking(m)}
                      onUnschedule={() => { scheduleMeal(m.id, null); notify("Moved to ideas"); }}
                      onDelete={() => { removeMeal(m.id); notify("Meal deleted"); }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>Ideas · unscheduled</SectionTitle>
        {ideas.length === 0 ? (
          <p className="text-sm text-stone-400 py-4 text-center">Everything's scheduled. Nice.</p>
        ) : (
          <div className="space-y-2">
            {ideas.map((m) => (
              <div key={m.id} className="rounded-xl bg-white ring-1 ring-stone-200 p-3 flex items-center gap-3">
                <Lightbulb size={16} className="text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-stone-800 truncate">{m.name}</p>
                  {m.description && <p className="text-xs text-stone-400 truncate">{m.description}</p>}
                </div>
                <Btn size="sm" variant="soft" onClick={() => { scheduleMeal(m.id, todayISO()); notify("Planned for today"); }}>Today</Btn>
                <button onClick={() => setPicking(m)} className="h-9 w-9 grid place-items-center rounded-lg text-stone-400 hover:bg-stone-100"><CalendarPlus size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!picking} onClose={() => setPicking(null)} title={`Schedule "${picking?.name || ""}"`}>
        {picking && <DatePick initial={picking.scheduledDate || todayISO()}
          onPick={(d) => { scheduleMeal(picking.id, d); notify("Scheduled for " + fmtShort(d)); setPicking(null); }}
          onClose={() => setPicking(null)} />}
      </Sheet>
    </div>
  );
}

function DatePick({ initial, onPick, onClose }) {
  const [d, setD] = useState(initial);
  const quick = [["Today", todayISO()], ["Tomorrow", addDays(todayISO(), 1)], ["In 3 days", addDays(todayISO(), 3)], ["Next week", addDays(todayISO(), 7)]];
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {quick.map(([lbl, iso]) => (
          <button key={lbl} onClick={() => setD(iso)} className={`h-11 rounded-xl font-semibold text-sm ring-1 ${d === iso ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-stone-600 ring-stone-200"}`}>{lbl}</button>
        ))}
      </div>
      <Field label="Or pick a date"><TextInput type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn className="flex-1" onClick={() => onPick(d)}><Check size={16} /> Schedule</Btn>
      </div>
    </>
  );
}

/* ─────────────────────────────  Shopping tab  ─────────────────────────── */

function prediction(trips) {
  if (trips.length < 2) return null;
  const dates = trips.map((t) => t.date).sort();
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push((toDate(dates[i]) - toDate(dates[i - 1])) / 86400000);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((a, b) => a + (b - avg) ** 2, 0) / gaps.length;
  const cv = avg ? Math.sqrt(variance) / avg : 1;
  const next = addDays(dates[dates.length - 1], Math.round(avg));
  return { next, avg: Math.round(avg), confidence: cv < 0.25 ? "High" : cv < 0.6 ? "Medium" : "Low", daysAway: daysUntil(next) };
}

function ShoppingTab() {
  const { trips, addTrip, removeTrip, addOrMerge, notify } = useApp();
  const { node, pick } = usePhoto();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [batchProgress, setBatchProgress] = useState(null);

  const total = trips.reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const avg = trips.length ? total / trips.length : 0;
  const pred = prediction(trips);
  const sorted = [...trips].sort((a, b) => b.date.localeCompare(a.date));
  const maxAmt = Math.max(1, ...trips.map((t) => Number(t.amount) || 0));

  const scanReceipt = async () => {
    setErr(""); setBatchProgress(null);
    const imgs = await pick();          // supports multiple photos (multi-page receipts), auto-compressed
    if (!imgs.length) return;
    setBusy(true);
    try {
      const res = await extractFromImages(imgs, "receipt", (i, n) => n > 1 && setBatchProgress({ i, n }));
      const amt = res.total != null ? res.total : res.items.reduce((a, it) => a + (Number(it.price) || 0), 0);
      setForm({ store: res.store || "", date: res.date || todayISO(), amount: amt ? String(amt.toFixed(2)) : "", notes: "", items: res.items });
    } catch (e) { setErr(e.message || "Couldn't read the receipt — try again or a smaller batch."); }
    finally { setBusy(false); setBatchProgress(null); }
  };

  const save = () => {
    if (!form.store.trim()) return;
    let added = 0;
    if (form.items && form.items.length) added = addOrMerge(form.items);
    addTrip({ store: form.store.trim(), date: form.date, amount: Number(form.amount) || 0, notes: form.notes.trim(), items: (form.items || []).length });
    notify(added ? `Trip logged · ${added} items added to inventory` : "Trip logged");
    setForm(null);
  };

  return (
    <div className="px-4 pt-2 pb-4">
      {node}
      {/* stats */}
      <div className="grid grid-cols-3 gap-2">
        {[["Total spent", money(total)], ["Trips", String(trips.length)], ["Avg / trip", money(avg)]].map(([l, v]) => (
          <div key={l} className="rounded-2xl bg-white ring-1 ring-stone-200 p-3 text-center">
            <p className="text-lg font-bold text-stone-800 tabular-nums" style={{ fontFamily: HEAD }}>{v}</p>
            <p className="text-[11px] text-stone-400 font-semibold uppercase tracking-wide">{l}</p>
          </div>
        ))}
      </div>

      {/* prediction */}
      <div className="mt-3 rounded-2xl bg-gradient-to-br from-stone-800 to-stone-900 text-white p-4">
        <div className="flex items-center gap-2 text-stone-300 text-xs font-bold uppercase tracking-wide"><TrendingUp size={14} /> Next shopping trip</div>
        {pred ? (
          <div className="mt-1 flex items-end justify-between">
            <div>
              <p className="text-xl font-bold" style={{ fontFamily: HEAD }}>{pred.daysAway <= 0 ? "Due now" : `in ${pred.daysAway} days`}</p>
              <p className="text-stone-400 text-sm">{fmtLong(pred.next)} · every ~{pred.avg} days</p>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded-full ${pred.confidence === "High" ? "bg-emerald-500/20 text-emerald-300" : pred.confidence === "Medium" ? "bg-amber-500/20 text-amber-300" : "bg-stone-500/30 text-stone-300"}`}>{pred.confidence} confidence</span>
          </div>
        ) : (
          <p className="mt-1 text-sm text-stone-400">Log at least 2 trips to predict your next one.</p>
        )}
      </div>

      {err && <div className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-sm text-rose-700"><AlertTriangle size={16} /> {err}</div>}

      {/* actions */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Btn variant="ai" onClick={scanReceipt} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Scan receipt</Btn>
        <Btn variant="outline" onClick={() => setForm({ store: "", date: todayISO(), amount: "", notes: "", items: [] })}><Plus size={16} /> Log manually</Btn>
      </div>
      {busy && <p className="text-center text-sm text-amber-600 mt-2 flex items-center justify-center gap-1"><Loader2 size={14} className="animate-spin" /> {batchProgress ? `Reading batch ${batchProgress.i} of ${batchProgress.n}…` : "Reading receipt & pulling items…"}</p>}

      {/* history */}
      <SectionTitle>Trip history</SectionTitle>
      {sorted.length === 0 ? (
        <Empty icon={ShoppingCart} title="No trips logged yet" sub="Scan a receipt to log spend and auto-fill your inventory in one shot." />
      ) : (
        <div className="space-y-2">
          {sorted.map((t) => (
            <div key={t.id} className="rounded-2xl bg-white ring-1 ring-stone-200 p-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 grid place-items-center text-emerald-700 shrink-0"><Store size={18} /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-stone-800 truncate" style={{ fontFamily: HEAD }}>{t.store}</p>
                  <p className="text-xs text-stone-400">{fmtLong(t.date)}{t.items ? ` · ${t.items} items` : ""}{t.notes ? ` · ${t.notes}` : ""}</p>
                </div>
                <p className="font-bold text-stone-800 tabular-nums shrink-0">{money(t.amount)}</p>
                <button onClick={() => { removeTrip(t.id); notify("Trip removed"); }} className="h-8 w-8 grid place-items-center rounded-lg text-stone-300 hover:bg-rose-50 hover:text-rose-600 shrink-0"><Trash2 size={14} /></button>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-emerald-400 rounded-full" style={{ width: `${((Number(t.amount) || 0) / maxAmt) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form && form.items && form.items.length ? "Confirm trip" : "Log shopping trip"}
        footer={<Btn className="w-full" onClick={save} disabled={!form || !form.store.trim()}><Check size={16} /> {form && form.items && form.items.length ? `Save trip · add ${form.items.length} items` : "Save trip"}</Btn>}>
        {form && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Store"><TextInput value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} placeholder="Store name" autoFocus /></Field>
              <Field label="Date"><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            </div>
            <Field label="Total amount"><div className="relative"><DollarSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" /><input className={inputCls + " pl-8"} type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></div></Field>
            <Field label="Notes"><TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" /></Field>
            {form.items && form.items.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{form.items.length} items → inventory</span>
                  <Sparkles size={14} className="text-amber-500" />
                </div>
                <div className="rounded-xl bg-white ring-1 ring-stone-200 divide-y divide-stone-100 max-h-56 overflow-y-auto">
                  {form.items.map((it, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-base">{CAT_EMOJI[it.category] || "📦"}</span>
                      <input value={it.name} onChange={(e) => setForm({ ...form, items: form.items.map((x, k) => k === i ? { ...x, name: e.target.value } : x) })} className="flex-1 text-sm font-semibold text-stone-700 bg-transparent outline-none min-w-0" />
                      <input type="number" min="0" value={it.quantity} onChange={(e) => setForm({ ...form, items: form.items.map((x, k) => k === i ? { ...x, quantity: Number(e.target.value) } : x) })} className="w-12 text-sm text-center bg-stone-50 rounded-md py-1" />
                      <button onClick={() => setForm({ ...form, items: form.items.filter((_, k) => k !== i) })} className="text-stone-300 hover:text-rose-500"><X size={15} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}

/* ─────────────────────────────  settings  ─────────────────────────────── */

function SettingsSheet({ onClose, notify, user, onSignOut }) {
  const [key, setKey] = useState(getKey());
  const [modelLight, setModelLight] = useState(getModelLight());
  const [modelHeavy, setModelHeavy] = useState(getModelHeavy());
  const [provider, setProvider] = useState(getProvider());
  const [gkey, setGkey] = useState(getGeminiKey());
  const [gModelLight, setGModelLight] = useState(getGeminiModelLight());
  const [gModelHeavy, setGModelHeavy] = useState(getGeminiModelHeavy());
  const [show, setShow] = useState(false);
  const [showG, setShowG] = useState(false);
  const save = () => {
    try {
      localStorage.setItem("pp_provider", provider);
      localStorage.setItem("pp_api_key", key.trim());
      localStorage.setItem("pp_model_light", (modelLight.trim() || "claude-haiku-4-5-20251001"));
      localStorage.setItem("pp_model_heavy", (modelHeavy.trim() || "claude-sonnet-5"));
      localStorage.setItem("pp_gemini_key", gkey.trim());
      localStorage.setItem("pp_gemini_model_light", (gModelLight.trim() || "gemini-2.5-flash"));
      localStorage.setItem("pp_gemini_model_heavy", (gModelHeavy.trim() || "gemini-2.5-pro"));
    } catch (_) {}
    notify("Settings saved");
    onClose();
  };
  return (
    <>
      {user && (
        <div className="flex items-center gap-3 rounded-xl bg-white ring-1 ring-stone-200 p-3">
          {user.photoURL
            ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />
            : <div className="h-10 w-10 rounded-full bg-emerald-100 grid place-items-center text-emerald-700 font-bold">{(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}</div>}
          <div className="min-w-0 flex-1">
            <p className="font-bold text-stone-800 truncate" style={{ fontFamily: HEAD }}>{user.displayName || "Signed in"}</p>
            <p className="text-xs text-stone-400 truncate">{user.email}</p>
          </div>
          <Btn size="sm" variant="outline" onClick={() => { onSignOut(); onClose(); }}><LogOut size={14} /> Sign out</Btn>
        </div>
      )}
      <div className="flex items-start gap-2 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2.5 text-sm text-emerald-800">
        <ShieldCheck size={16} className="mt-0.5 shrink-0" />
        <span>Your inventory, meals and trips are stored privately in your account — only you can see them.</span>
      </div>
      {AI_PROXY_URL ? (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2.5 text-sm text-emerald-800">
          <Sparkles size={16} className="mt-0.5 shrink-0" />
          <span>AI photo scan and meal suggestions are <b>ready for everyone</b> — no key needed. Just signing in is enough.</span>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 text-sm text-amber-800">
            <KeyRound size={16} className="mt-0.5 shrink-0" />
            <span>You can add <b>either or both</b> keys, stored on this device only. <b>Auto</b> uses the cheap/fast model for everyday scans and steps, and only reaches for the stronger model on the big meal-suggestion list — keeping token spend down.</span>
          </div>

          <Field label="AI provider">
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => setProvider("auto")} className={`h-11 rounded-xl font-semibold text-xs ring-1 ${provider === "auto" ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-stone-600 ring-stone-200"}`}>⚡ Auto (smart)</button>
              <button onClick={() => setProvider("anthropic")} className={`h-11 rounded-xl font-semibold text-xs ring-1 ${provider === "anthropic" ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-stone-600 ring-stone-200"}`}>Claude only</button>
              <button onClick={() => setProvider("gemini")} className={`h-11 rounded-xl font-semibold text-xs ring-1 ${provider === "gemini" ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-stone-600 ring-stone-200"}`}>Gemini only</button>
            </div>
          </Field>

          <div className="rounded-xl bg-white ring-1 ring-stone-200 p-3 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-400">Claude (Anthropic)</p>
            <Field label="API key" hint="Starts with sk-ant-…">
              <div className="relative">
                <input className={inputCls + " pr-16 font-mono text-sm"} type={show ? "text" : "password"} value={key}
                  onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" />
                <button onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-500 px-2 py-1 rounded hover:bg-stone-100">{show ? "Hide" : "Show"}</button>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cheap model" hint="scans, recipe steps"><TextInput value={modelLight} onChange={(e) => setModelLight(e.target.value)} placeholder="claude-haiku-4-5-20251001" /></Field>
              <Field label="Full model" hint="~40-dish list"><TextInput value={modelHeavy} onChange={(e) => setModelHeavy(e.target.value)} placeholder="claude-sonnet-5" /></Field>
            </div>
            <div className="flex items-center justify-between">
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-sm font-semibold text-emerald-700 flex items-center gap-1">Get an API key <ExternalLink size={13} /></a>
              {getKey() && <button onClick={() => { try { localStorage.removeItem("pp_api_key"); } catch (_) {} setKey(""); notify("Key removed"); }} className="text-xs font-bold text-rose-600">Remove</button>}
            </div>
          </div>

          <div className="rounded-xl bg-white ring-1 ring-stone-200 p-3 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-400">Gemini (Google) · usually cheaper</p>
            <Field label="API key" hint="From Google AI Studio">
              <div className="relative">
                <input className={inputCls + " pr-16 font-mono text-sm"} type={showG ? "text" : "password"} value={gkey}
                  onChange={(e) => setGkey(e.target.value)} placeholder="AIza..." autoComplete="off" />
                <button onClick={() => setShowG((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-500 px-2 py-1 rounded hover:bg-stone-100">{showG ? "Hide" : "Show"}</button>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cheap model" hint="scans, recipe steps"><TextInput value={gModelLight} onChange={(e) => setGModelLight(e.target.value)} placeholder="gemini-2.5-flash" /></Field>
              <Field label="Full model" hint="~40-dish list"><TextInput value={gModelHeavy} onChange={(e) => setGModelHeavy(e.target.value)} placeholder="gemini-2.5-pro" /></Field>
            </div>
            <div className="flex items-center justify-between">
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-sm font-semibold text-emerald-700 flex items-center gap-1">Get a free Gemini key <ExternalLink size={13} /></a>
              {getGeminiKey() && <button onClick={() => { try { localStorage.removeItem("pp_gemini_key"); } catch (_) {} setGkey(""); notify("Key removed"); }} className="text-xs font-bold text-rose-600">Remove</button>}
            </div>
          </div>
        </>
      )}
      <div className="flex gap-2 pt-1">
        <Btn variant="outline" className="flex-1" onClick={onClose}>Close</Btn>
        {!AI_PROXY_URL && <Btn className="flex-1" onClick={save}><Check size={16} /> Save settings</Btn>}
      </div>
    </>
  );
}

/* ─────────────────────────────  auth screens  ─────────────────────────── */

function SignIn({ onSignIn, err }) {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col" style={{ fontFamily: BODY }}>
      <div className="flex-1 grid place-items-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-emerald-700 grid place-items-center text-white text-3xl mb-4">🥗</div>
          <h1 className="text-2xl font-extrabold text-stone-800" style={{ fontFamily: HEAD }}>Pantry Planner</h1>
          <p className="text-stone-500 mt-2">Track what's in your kitchen, scan receipts, plan meals, and never lose your list. Your data stays private to your account.</p>
          <button onClick={onSignIn} className="mt-7 w-full h-12 rounded-xl bg-white ring-1 ring-stone-300 font-semibold text-stone-700 flex items-center justify-center gap-3 hover:bg-stone-50 active:scale-[.98] transition">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continue with Google
          </button>
          {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
        </div>
      </div>
      <p className="text-center text-xs text-stone-400 pb-6 px-6">By continuing you agree to sign in with your Google account. We store only your pantry data, tied to your account.</p>
    </div>
  );
}

function ConfigNeeded() {
  return (
    <div className="min-h-screen bg-stone-50 grid place-items-center px-6" style={{ fontFamily: BODY }}>
      <div className="max-w-sm text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-100 grid place-items-center text-amber-600 mb-4"><KeyRound size={26} /></div>
        <h1 className="text-xl font-bold text-stone-800" style={{ fontFamily: HEAD }}>Almost there</h1>
        <p className="text-stone-500 mt-2 text-sm">This app needs your Firebase project details to enable Google sign-in and private storage. Open <code className="bg-stone-200 px-1 rounded">App.jsx</code> and paste your config into the <code className="bg-stone-200 px-1 rounded">firebaseConfig</code> block near the top, then redeploy.</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────  root app  ─────────────────────────────── */

/* ─────────────────────────────  Fit: state shape, AI helpers  ─────────────────────────────── */

const DEFAULT_PROFILE = { sex: "male", age: 26, heightCm: 170, weightKg: 60, activity: "light", goal: "gain", pace: 0.5 };
const DEFAULT_FIT = {
  targets: { ...computeTargets(DEFAULT_PROFILE), profile: DEFAULT_PROFILE, set: false, manual: false },
  logs: {},        // { "YYYY-MM-DD": [entry] }
  water: {},       // { "YYYY-MM-DD": ml }
  plan: {},        // { "YYYY-MM-DD": { slot: { rid, servings, status? } } }
  leftovers: [],
  dishMemory: {},  // { dishKey: { scale, n } } — remembers how you correct portion estimates
  weights: [],     // [{ date, kg }]
  userRecipes: [], // AI-made recipes built only from known ingredients
  prefs: { snack: true, extraHave: [], tasteFirst: "telangana" }, // extraHave: staples ticked in Cook now that aren't tracked in the pantry
};

function normalizeFit(raw) {
  const f = raw || {};
  const t = f.targets && f.targets.kcal ? f.targets : DEFAULT_FIT.targets;
  return { ...DEFAULT_FIT, ...f, targets: t, prefs: { ...DEFAULT_FIT.prefs, ...(f.prefs || {}) } };
}
// Keep the user doc small: ~2 months of logs, 2 weeks of plan.
function pruneFit(fit, today) {
  const keep = (obj, days) => Object.fromEntries(Object.entries(obj || {}).filter(([d]) => daysBetween(d, today) <= days));
  return {
    ...fit,
    logs: keep(fit.logs, 60), water: keep(fit.water, 60), plan: keep(fit.plan, 14),
    leftovers: (fit.leftovers || []).filter((l) => daysBetween(l.date, today) <= 3),
    weights: (fit.weights || []).slice(-200),
  };
}

const round1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
const sumEntries = (entries) => entries.reduce((a, e) => ({
  kcal: a.kcal + (Number(e.kcal) || 0), p: a.p + (Number(e.p) || 0), c: a.c + (Number(e.c) || 0), f: a.f + (Number(e.f) || 0),
}), { kcal: 0, p: 0, c: 0, f: 0 });
const guessSlot = () => { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 21 ? "dinner" : "snack"; };

// Hour of the day as a decimal (14.5 = 2:30 pm), refreshed every minute and whenever the app comes back into view.
function useClock() {
  const read = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  const [h, setH] = useState(read);
  useEffect(() => {
    const tick = () => setH(read());
    const id = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return h;
}

function useToday() {
  const [t, setT] = useState(todayISO());
  useEffect(() => {
    const tick = () => setT((cur) => { const n = todayISO(); return n === cur ? cur : n; });
    const id = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return t;
}

// Photo and/or text → editable list of foods with grams + macros.
async function estimateMeal({ images, note }) {
  const n = images.length;
  const system =
    "You are a careful nutrition estimator for home-cooked and restaurant food, especially Telangana, Andhra and other South Indian home cooking. " +
    "Return ONLY valid JSON, no prose, no markdown fences.";
  const user =
    (n ? `You are given ${n} photo${n > 1 ? "s" : ""} of one meal or snack${n > 1 ? " (different angles or separate items)" : ""}. ` : "") +
    (note ? `The person describes it as: "${note.slice(0, 400)}". ` : "") +
    "Identify each distinct dish or food and estimate the portion actually shown as ready-to-eat weight in grams. " +
    'Return {"items":[{"name": string, "grams": number, "kcal": number, "protein": number, "carbs": number, "fat": number, "confidence": "high"|"medium"|"low"}]}. ' +
    "One entry per dish (for example 'Dal tadka', 'Roti', 'Steamed rice'), not per ingredient. " +
    "Protein, carbs and fat are grams for the whole portion, and kcal should roughly equal 4*protein + 4*carbs + 9*fat. " +
    "Do not invent items that are not visible or described.";
  const out = parseJSON(await callClaude({ system, user, images, tier: "light", maxTokens: 1500 }));
  return (out.items || []).map((it) => {
    const p = Math.max(0, Number(it.protein) || 0), c = Math.max(0, Number(it.carbs) || 0), f = Math.max(0, Number(it.fat) || 0);
    const calc = 4 * p + 4 * c + 9 * f;
    let kcal = Math.max(0, Number(it.kcal) || 0);
    if (!kcal || (calc && Math.abs(kcal - calc) / calc > 0.25)) kcal = Math.round(calc); // keep the numbers self-consistent
    return {
      name: String(it.name || "").trim(), grams: Math.max(0, Number(it.grams) || 0), kcal, p, c, f,
      confidence: ["high", "medium", "low"].includes(it.confidence) ? it.confidence : "medium",
    };
  }).filter((it) => it.name && it.kcal > 0);
}

// New recipes built ONLY from ingredients the engine knows, so macros and pantry maths stay exact.
async function aiRecipes(slot, existingNames) {
  const keys = Object.values(FOODS).map((f) => `${f.key} (${f.name})`).join(", ");
  const system = "You are an Indian home cook and sports dietitian. Return ONLY valid JSON, no prose, no markdown fences.";
  const user =
    `Create 6 NEW home-cooking recipes suited to ${slot}. At least 3 must be Telangana home cooking (pappu, pulusu, vepudu, jonna rotte, bagara rice, Hyderabadi dishes) and at least 2 Andhra (iguru, pulusu, ulavacharu, Guntur-style); the rest other South Indian, North Indian or American. ` +
    "The person eats chicken and eggs but no other meat and no fish or seafood; dairy is fine. " +
    `Use ONLY these ingredient keys: ${keys}. ` +
    "Salt, spices, masala powders, tamarind, ginger, garlic, chilies, curry leaves, herbs and lemon are always available — do not list them. " +
    "Give each ingredient in grams for ONE serving (liquids in ml, treated as grams). " +
    `Aim for roughly ${slot === "snack" ? "250-400" : "550-800"} kcal per serving with good protein. ` +
    `Avoid duplicating these dishes: ${existingNames.slice(0, 50).join(", ")}. ` +
    'Return {"recipes":[{"name": string, "description": string (max 8 words), "cuisine": "telangana"|"andhra"|"south"|"north"|"american", "ingredients":[{"key": string, "grams": number}], "steps":[string, ...3 to 5 short sentences]}]}.';
  const out = parseJSON(await callClaude({ system, user, tier: "light", maxTokens: 3000 }));
  const seen = new Set(existingNames.map((n) => n.toLowerCase()));
  const slots = slot === "lunch" || slot === "dinner" ? ["lunch", "dinner"] : [slot];
  const res = [];
  for (const r of out.recipes || []) {
    const name = String(r.name || "").trim();
    const ing = (r.ingredients || [])
      .filter((x) => FOODS[x.key] && Number(x.grams) >= 5 && Number(x.grams) <= 600)
      .map((x) => ({ k: x.key, g: Math.round(Number(x.grams)) }));
    const steps = (r.steps || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
    if (!name || seen.has(name.toLowerCase()) || ing.length < 2 || steps.length < 2) continue;
    const m = macrosOf(ing, 1);
    if (m.kcal < (slot === "snack" ? 150 : 350) || m.kcal > 1100) continue;
    seen.add(name.toLowerCase());
    res.push({ id: "u-" + uid(), name, slots, desc: String(r.description || "").trim().slice(0, 80), ing, steps, src: "ai", cui: CUISINES.includes(r.cuisine) ? r.cuisine : "north" });
  }
  return res;
}

/* ─────────────────────────────  Fit: small UI pieces  ─────────────────────────────── */

function Ring({ value, max, size = 124, stroke = 11, color = "#047857", children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e5e4" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset .5s ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

function MacroBar({ label, value, max, color }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-bold text-stone-500 uppercase tracking-wide">{label}</span>
        <span className="tabular-nums text-stone-500"><b className="text-stone-800">{Math.round(value)}</b> / {Math.round(max)} g</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-stone-200 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: pct + "%", background: color }} />
      </div>
    </div>
  );
}

function Stepper({ label, value, onChange, min = 0.5, max = 8, step = 0.5 }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-semibold text-stone-600">{label}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(Math.max(min, round1(value - step)))} className="h-8 w-8 grid place-items-center rounded-lg bg-stone-100 text-stone-600 active:scale-95"><Minus size={15} /></button>
        <span className="w-10 text-center font-bold tabular-nums">{value}</span>
        <button onClick={() => onChange(Math.min(max, round1(value + step)))} className="h-8 w-8 grid place-items-center rounded-lg bg-stone-100 text-stone-600 active:scale-95"><Plus size={15} /></button>
      </div>
    </div>
  );
}

/* ─────────────────────────────  Today  ─────────────────────────────── */

function SlotCard({ slot, entries, opts, target, pindex }) {
  const { today, fit, cookMeal, skipMeal, lockMeal, unlockMeal, removeEntry, openLog, addAiRecipes } = useApp();
  const meta = SLOT_META[slot];
  const [selRid, setSelRid] = useState(null);
  const [sv, setSv] = useState({});
  const [steps, setSteps] = useState(false);
  const [extra, setExtra] = useState(null); // { cook, eat } while the "cooked extra" sheet is open
  const [busy, setBusy] = useState(false);

  if (entries.length) {
    return (
      <div className="rounded-3xl bg-white ring-1 ring-stone-200 p-4">
        <div className="flex items-center justify-between">
          <p className="font-extrabold text-stone-800" style={{ fontFamily: HEAD }}>{meta.emoji} {meta.label}</p>
          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 flex items-center gap-1"><Check size={12} /> Done</span>
        </div>
        <div className="mt-2 divide-y divide-stone-100">
          {entries.map((e) => (
            <div key={e.id} className="py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-stone-800 truncate">{e.name}{e.servings ? <span className="text-stone-400 font-normal"> · {e.servings} srv</span> : null}</p>
                <p className="text-xs text-stone-400">{e.source === "skipped" ? "Nothing counted for this meal" : `${e.kcal} kcal · P ${round1(e.p)} · C ${round1(e.c)} · F ${round1(e.f)}`}</p>
              </div>
              <button onClick={() => removeEntry(e.id)} aria-label="Remove" className="h-8 w-8 grid place-items-center rounded-lg text-stone-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <Btn variant="soft" size="sm" className="mt-2" onClick={() => openLog(slot)}><Plus size={14} /> Add more</Btn>
      </div>
    );
  }

  if (!opts.length) {
    return (
      <div className="rounded-3xl bg-white ring-1 ring-stone-200 p-6 text-center">
        <p className="font-extrabold text-stone-800" style={{ fontFamily: HEAD }}>{meta.emoji} {meta.label}</p>
        <p className="text-sm text-stone-500 mt-1">No ideas for this slot yet.</p>
        {aiReady() && <Btn variant="ai" size="sm" className="mt-3" onClick={() => addAiRecipes(slot)}><Sparkles size={14} /> Find ideas</Btn>}
      </div>
    );
  }

  const idx = Math.max(0, opts.findIndex((o) => o.recipe.id === selRid));
  const opt = opts[idx];
  const r = opt.recipe;
  const servings = sv[r.id] != null ? sv[r.id] : opt.servings;
  const m = macrosOf(r.ing, servings);
  const need = recipeNeeds(r, servings);
  const rows = r.ing.map(({ k }) => {
    const have = (pindex[k] && pindex[k].grams) || 0;
    return { k, n: need[k], short: Math.max(0, need[k] - have) };
  });
  const missing = rows.filter((x) => x.short > 2);
  const lk = fit.plan[today] && fit.plan[today][slot];
  const planned = !!(lk && !lk.status && lk.rid === r.id);
  const go = (d) => setSelRid(opts[(idx + d + opts.length) % opts.length].recipe.id);
  const setServ = (d) => setSv((s) => ({ ...s, [r.id]: Math.max(0.5, Math.min(4, round1(servings + d))) }));
  const more = async () => { setBusy(true); try { await addAiRecipes(slot); } finally { setBusy(false); } };

  return (
    <div className="rounded-3xl bg-white ring-1 ring-stone-200 p-4">
      <div className="flex items-center justify-between">
        <p className="font-extrabold text-stone-800" style={{ fontFamily: HEAD }}>{meta.emoji} {meta.label}</p>
        <div className="flex items-center gap-1 text-stone-400">
          <button onClick={() => go(-1)} aria-label="Previous idea" className="h-8 w-8 grid place-items-center rounded-full hover:bg-stone-100"><ChevronLeft size={18} /></button>
          <span className="text-xs font-semibold tabular-nums">{idx + 1}/{opts.length}</span>
          <button onClick={() => go(1)} aria-label="Next idea" className="h-8 w-8 grid place-items-center rounded-full hover:bg-stone-100"><ChevronRight size={18} /></button>
        </div>
      </div>
      <p className="text-[11px] text-stone-400">Aim ≈ {Math.round(target.kcal)} kcal · {Math.round(target.protein)} g protein</p>

      <div className="mt-2">
        <p className="text-lg font-extrabold text-stone-800 leading-snug" style={{ fontFamily: HEAD }}>
          {r.name}{planned && <span className="ml-2 align-middle text-[10px] font-bold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">PLANNED</span>}
        </p>
        <p className="text-sm text-stone-500">{r.cui && <span className="font-bold text-emerald-700">{CUISINE_LABEL[r.cui]} · </span>}{r.desc}</p>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[["kcal", m.kcal, "text-stone-800"], ["Protein", m.p + " g", "text-emerald-700"], ["Carbs", m.c + " g", "text-amber-600"], ["Fat", m.f + " g", "text-sky-600"]].map(([l, v, cls]) => (
          <div key={l} className="rounded-xl bg-stone-50 py-2">
            <p className={`font-bold tabular-nums ${cls}`}>{v}</p>
            <p className="text-[10px] uppercase tracking-wide text-stone-400 font-semibold">{l}</p>
          </div>
        ))}
      </div>

      <div className="mt-3"><Stepper label="Servings" value={servings} onChange={(v) => setSv((s) => ({ ...s, [r.id]: v }))} max={4} /></div>

      <div className="mt-3 rounded-2xl bg-stone-50 divide-y divide-stone-100">
        {rows.map((x) => (
          <div key={x.k} className="flex items-center justify-between px-3 py-1.5 text-sm">
            <span className="text-stone-700">{FOODS[x.k].name}</span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className="font-semibold text-stone-800">{fmtAmount(x.k, x.n)}</span>
              {x.short > 2 ? <span className="text-[11px] font-bold text-rose-600">need {fmtAmount(x.k, x.short)}</span> : <Check size={14} className="text-emerald-600" />}
            </span>
          </div>
        ))}
      </div>
      {missing.length > 0 && <p className="mt-1.5 text-xs text-rose-600">Short on {missing.length} item{missing.length > 1 ? "s" : ""}. Plan this meal and they go on your shopping list.</p>}

      <button onClick={() => setSteps(!steps)} className="mt-2 text-sm font-semibold text-emerald-700 flex items-center gap-1"><BookOpen size={14} /> {steps ? "Hide steps" : "How to cook"}</button>
      {steps && <ol className="mt-1 space-y-1.5 text-sm text-stone-600 list-decimal pl-5">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Btn onClick={() => { cookMeal({ slot, rid: r.id, cook: servings, eat: servings }); setSelRid(null); }}><Check size={16} /> Cooked it</Btn>
        <Btn variant="outline" className="whitespace-nowrap" onClick={() => openLog(slot)}><Camera size={16} className="shrink-0" /> Something else</Btn>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
        <button onClick={() => (planned ? unlockMeal(today, slot) : lockMeal(today, slot, r.id, servings))} className="text-amber-700 flex items-center gap-1">
          <Pin size={14} /> {planned ? "Unplan" : "Plan this"}
        </button>
        <button onClick={() => setExtra({ cook: round1(servings + 1), eat: servings })} className="text-stone-500">Cooked extra…</button>
        <button onClick={() => { if (window.confirm(`Skip ${meta.label.toLowerCase()}? Its ${Math.round(target.kcal)} kcal move onto the meals you have left today.`)) skipMeal(slot); }} className="text-stone-500">Skip meal</button>
        {aiReady() && <button onClick={more} disabled={busy} className="text-stone-500 flex items-center gap-1">{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} More ideas</button>}
      </div>

      <Sheet open={!!extra} onClose={() => setExtra(null)} title="Cooked extra?"
        footer={<Btn className="w-full" onClick={() => { cookMeal({ slot, rid: r.id, cook: extra.cook, eat: extra.eat }); setExtra(null); setSelRid(null); }}><Check size={16} /> Confirm</Btn>}>
        {extra && (
          <>
            <p className="text-sm text-stone-500">The pantry is reduced for everything you cook. Only what you eat now counts toward today — the rest is saved as a leftover.</p>
            <Stepper label="Servings cooked" value={extra.cook} max={8} onChange={(v) => setExtra({ cook: v, eat: Math.min(extra.eat, v) })} />
            <Stepper label="Servings eaten now" value={extra.eat} max={extra.cook} onChange={(v) => setExtra({ ...extra, eat: Math.min(v, extra.cook) })} />
          </>
        )}
      </Sheet>
    </div>
  );
}

const LEVEL_DOT = { bad: "bg-rose-500", warn: "bg-amber-400", good: "bg-emerald-400" };

function CoachCard({ c, onAct }) {
  const [more, setMore] = useState(false);
  const top = c.messages[0];
  if (!top) return null;
  const rest = c.messages.slice(1);
  return (
    <div className="rounded-3xl bg-stone-900 text-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[top.level]}`} /> Your trainer
        </span>
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${c.streak ? "bg-amber-400 text-stone-900" : "bg-white/10 text-stone-300"}`}>
          {c.streak ? `🔥 ${c.streak}-day streak` : "No streak yet"}
        </span>
      </div>
      <p className="mt-2 text-lg font-extrabold leading-snug" style={{ fontFamily: HEAD }}>{top.title}</p>
      <p className="text-sm text-stone-300 mt-1">{top.body}</p>
      {top.action && <button onClick={() => onAct(top.action)} className="mt-3 h-10 px-4 rounded-xl bg-white text-stone-900 font-bold text-sm active:scale-95">{top.action.label}</button>}
      {rest.length > 0 && (
        <button onClick={() => setMore(!more)} className="mt-3 block text-xs font-bold text-stone-400">
          {more ? "Hide" : `${rest.length} more from your trainer`}
        </button>
      )}
      {more && rest.map((m) => (
        <div key={m.id} className="mt-2 pt-2 border-t border-white/10">
          <p className="text-sm font-bold flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full shrink-0 ${LEVEL_DOT[m.level]}`} />{m.title}</p>
          <p className="text-xs text-stone-300 mt-0.5">{m.body}</p>
          {m.action && <button onClick={() => onAct(m.action)} className="mt-1.5 text-xs font-bold text-white underline underline-offset-2">{m.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

function TodayTab({ openLog, openTargets }) {
  const { today, fit, pantry, recipes, byId, addWater, eatLeftover, planNextWeek, setTab, trainer, adjustKcal } = useApp();
  const t = fit.targets;
  const visibleSlots = fit.prefs.snack ? SLOTS : SLOTS.filter((s) => s !== "snack");
  const logsToday = fit.logs[today] || [];
  const eaten = sumEntries(logsToday);
  const doneSlots = new Set(logsToday.map((e) => e.slot));
  const openSlots = visibleSlots.filter((s) => !doneSlots.has(s));
  const stg = slotTargets({ targets: t, eaten, openSlots });
  const pindex = indexPantry(pantry, today);
  const planToday = fit.plan[today] || {};

  const recent = new Set();
  for (let i = 1; i <= 2; i++) (fit.logs[addDaysISO(today, -i)] || []).forEach((e) => e.rid && recent.add(e.rid));
  // Every dish for each open slot, best first, and never the same dish under two meals.
  const pinned = {};
  for (const slot of openSlots) {
    const lk = planToday[slot];
    if (lk && !lk.status && byId[lk.rid]) pinned[slot] = { recipe: byId[lk.rid], servings: lk.servings };
  }
  const optsBySlot = suggestDay({
    recipes, slots: openSlots, targets: stg, pindex, dayKey: today, pinned, recent, cuisines: cuisineOrder(fit.prefs.tasteFirst),
    avoid: new Set(logsToday.map((e) => e.rid).filter(Boolean)),
  });

  const scroller = useRef(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const i = Math.max(0, visibleSlots.indexOf(guessSlot()));
    const el = scroller.current;
    if (el && i > 0) el.scrollTo({ left: i * el.clientWidth, behavior: "auto" });
    setActive(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = (e) => {
    const el = e.currentTarget;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    setActive((a) => (a === i ? a : i));
  };
  const goTo = (i) => { const el = scroller.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); };
  // What the trainer's buttons do.
  const act = (a) => {
    if (a.type === "slot") { const i = visibleSlots.indexOf(a.slot); if (i >= 0) { goTo(i); if (scroller.current) scroller.current.scrollIntoView({ behavior: "smooth", block: "center" }); } }
    else if (a.type === "log") openLog("");
    else if (a.type === "water") addWater(500);
    else if (a.type === "insights") setTab("today", "insights");
    else if (a.type === "targets") openTargets();
    else if (a.type === "adjust") adjustKcal(a.delta);
  };
  const matrix = React.useMemo(() => buildMatrix(recipes), [recipes]);
  // The row would otherwise be as tall as its tallest card; track the visible card's height instead.
  const slides = useRef([]);
  const [slideH, setSlideH] = useState(null);
  useEffect(() => {
    const el = slides.current[active];
    if (!el) return;
    const upd = () => setSlideH(el.offsetHeight);
    upd();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(upd); ro.observe(el);
    return () => ro.disconnect();
  }, [active, visibleSlots.length]);

  const left = Math.max(0, t.kcal - eaten.kcal);
  const over = eaten.kcal > t.kcal * 1.05;
  const wml = fit.water[today] || 0;

  return (
    <div className="px-4 pt-3 pb-4 space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold text-stone-400">{fmtLong(today)}</p>
          <h1 className="text-2xl font-extrabold text-stone-800 -mt-0.5" style={{ fontFamily: HEAD }}>Today</h1>
        </div>
        <Btn variant="outline" size="sm" onClick={openTargets}><Target size={14} /> Targets</Btn>
      </div>
      <p className="!mt-1 text-xs text-stone-500 tabular-nums">{t.profile.weightKg} kg · {t.profile.goal === "maintain" ? "maintain" : `${t.profile.goal} ${t.profile.pace} kg/week`} · {t.kcal} kcal · {t.protein} g protein a day</p>

      <CoachCard c={trainer} onAct={act} />

      <div className="rounded-3xl bg-white ring-1 ring-stone-200 p-4 flex items-center gap-4">
        <Ring value={eaten.kcal} max={t.kcal} color={over ? "#e11d48" : "#047857"}>
          <div>
            <p className="text-2xl font-extrabold text-stone-800 tabular-nums leading-none" style={{ fontFamily: HEAD }}>{over ? Math.round(eaten.kcal - t.kcal) : Math.round(left)}</p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400 mt-1">{over ? "kcal over" : "kcal left"}</p>
          </div>
        </Ring>
        <div className="flex-1 space-y-2.5 min-w-0">
          <MacroBar label="Protein" value={eaten.p} max={t.protein} color="#047857" />
          <MacroBar label="Carbs" value={eaten.c} max={t.carbs} color="#d97706" />
          <MacroBar label="Fat" value={eaten.f} max={t.fat} color="#0284c7" />
          <p className="text-[11px] text-stone-400 tabular-nums">
            {Math.round(eaten.kcal)} of {t.kcal} kcal eaten
            {trainer.behind
              ? <span className="ml-1.5 font-bold text-rose-600">· {Math.round(trainer.gap)} behind pace</span>
              : trainer.expectedK > 0 && <span className="ml-1.5 font-bold text-emerald-700">· on pace</span>}
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-white ring-1 ring-stone-200 p-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-sky-50 text-sky-600 grid place-items-center shrink-0"><Droplet size={20} /></div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-stone-800 tabular-nums">{wml} <span className="text-xs text-stone-400 font-medium">/ {t.water} ml</span></p>
          <div className="mt-1 h-1.5 rounded-full bg-stone-200 overflow-hidden"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: Math.min(100, (wml / Math.max(1, t.water)) * 100) + "%" }} /></div>
        </div>
        <button onClick={() => addWater(-250)} aria-label="Less water" className="h-9 w-9 grid place-items-center rounded-lg bg-stone-100 text-stone-600 active:scale-95"><Minus size={16} /></button>
        <button onClick={() => addWater(250)} className="h-9 px-3 rounded-lg bg-sky-600 text-white text-sm font-bold active:scale-95">+250</button>
      </div>

      <Btn variant="ai" className="w-full" onClick={() => openLog("")}><Camera size={18} /> Log what I ate</Btn>

      {openSlots.length === 0 && <p className="text-center text-sm font-semibold text-emerald-700">Every meal for today is logged. 🎉</p>}
      {openSlots.length > 0 && left < 120 && <p className="text-center text-xs font-semibold text-emerald-700">Calories for today are covered — only log what you actually eat.</p>}

      <div className="flex gap-1.5 overflow-x-auto pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleSlots.map((s, i) => (
          <button key={s} onClick={() => goTo(i)}
            className={`shrink-0 px-2.5 h-9 rounded-full text-[13px] font-bold flex items-center gap-1 transition ${active === i ? "bg-emerald-700 text-white" : "bg-white ring-1 ring-stone-200 text-stone-600"}`}>
            {doneSlots.has(s) ? <Check size={14} /> : SLOT_META[s].emoji} {SLOT_META[s].label}
          </button>
        ))}
      </div>

      <div ref={scroller} onScroll={onScroll} style={{ height: slideH || undefined, transition: "height .2s ease" }}
        className="flex items-start overflow-x-auto overflow-y-hidden snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleSlots.map((slot, i) => (
          <div key={slot} ref={(el) => { slides.current[i] = el; }} className="w-full shrink-0 snap-center px-0.5 py-0.5">
            <SlotCard slot={slot} entries={logsToday.filter((e) => e.slot === slot)} opts={optsBySlot[slot] || []} target={stg[slot] || { kcal: 0, protein: 0 }} pindex={pindex} />
          </div>
        ))}
      </div>
      <p className="text-center text-[11px] text-stone-400 -mt-1">Swipe sideways for the next meal · use ‹ › on a card for other ideas</p>
      {(() => {
        const slot = visibleSlots[active];
        if (!slot || doneSlots.has(slot)) return null;
        const have = [...Object.keys(pindex).filter((k) => pindex[k].grams > 0), ...(fit.prefs.extraHave || [])];
        const tips = unlocks(matrix, have, { slot }).slice(0, 3);
        if (!tips.length) return null;
        return (
          <button onClick={() => setTab("meals", "cook")} className="w-full text-left rounded-2xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm text-amber-900">
            <span className="font-bold">One item away from more {SLOT_META[slot].label.toLowerCase()}s:</span>{" "}
            {tips.map((x, i) => <span key={x.key}>{i > 0 && " · "}{x.name.replace(/ \(.*\)/, "")} → {x.n} more</span>)}
            <span className="block text-[11px] text-amber-700 mt-0.5">Tap to see every dish and what each one is missing.</span>
          </button>
        );
      })()}

      {fit.leftovers.length > 0 && (
        <div>
          <SectionTitle>Leftovers</SectionTitle>
          <div className="space-y-2">
            {fit.leftovers.map((l) => (
              <div key={l.id} className="rounded-2xl bg-white ring-1 ring-stone-200 p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1"><p className="font-bold text-stone-800 truncate">{l.name}</p><p className="text-xs text-stone-400">{l.servings} serving{l.servings === 1 ? "" : "s"} left · cooked {fmtShort(l.date)}</p></div>
                <Btn size="sm" variant="soft" onClick={() => eatLeftover(l)}>Eat {l.servings >= 1 ? "1" : "rest"}</Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      <Btn variant="soft" className="w-full" onClick={() => { planNextWeek(); setTab("shopping", "list"); }}><CalendarDays size={16} /> Plan my week &amp; build the shopping list</Btn>
      <p className="text-center text-[11px] text-stone-400">Salt, spices and masala powders, tamarind, sesame, ginger, garlic, chilies, curry leaves and herbs are assumed to always be in stock.</p>
    </div>
  );
}

/* ─────────────────────────────  Log sheet (photo / text / manual)  ─────────────────────────────── */

function LogSheet({ open, slot0, onClose }) {
  const { today, fit, logEntries, rememberDishes, notify, openSettings } = useApp();
  const { node, pick } = usePhoto();
  const [step, setStep] = useState("input");
  const [images, setImages] = useState([]);
  const [note, setNote] = useState("");
  const [items, setItems] = useState([]);
  const [slot, setSlot] = useState(slot0 || guessSlot());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("input"); setImages([]); setNote(""); setItems([]); setErr(""); setBusy(false);
    setSlot(slot0 || guessSlot());
  }, [open, slot0]);

  const addPhotos = async () => { const got = await pick(); if (got.length) setImages((a) => [...a, ...got].slice(0, 8)); };
  const hasAI = aiReady();

  const estimate = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await estimateMeal({ images, note });
      if (!res.length) throw new Error("Couldn't spot any food. Try a clearer photo or describe it.");
      setItems(res.map((it) => {
        const mem = fit.dishMemory[norm(it.name)];
        return { ...it, id: uid(), scale: mem ? mem.scale : 1, remembered: !!mem };
      }));
      setStep("review");
    } catch (e) { setErr(e.message || "Couldn't analyse that."); }
    finally { setBusy(false); }
  };

  const startManual = () => { setItems([{ id: uid(), name: "", grams: 0, kcal: 0, p: 0, c: 0, f: 0, scale: 1, manual: true }]); setStep("review"); };
  const patch = (id, ch) => setItems((a) => a.map((x) => (x.id === id ? { ...x, ...ch } : x)));
  const sc = (it) => it.scale || 1;
  const shown = items.map((it) => ({ ...it, kcal: Math.round(it.kcal * sc(it)), p: round1(it.p * sc(it)), c: round1(it.c * sc(it)), f: round1(it.f * sc(it)), g: Math.round((it.grams || 0) * sc(it)) }));
  const tot = sumEntries(shown);

  const save = () => {
    const ok = shown.filter((it) => it.name.trim() && it.kcal > 0);
    if (!ok.length) { setErr("Add at least one item with a name and calories."); return; }
    logEntries(ok.map((it) => ({
      id: uid(), date: today, slot, name: it.name.trim(), kcal: it.kcal, p: it.p, c: it.c, f: it.f, g: it.g,
      source: it.manual ? "manual" : "photo",
    })));
    rememberDishes(items.filter((it) => !it.manual && it.name.trim()));
    notify(`Logged ${ok.length} item${ok.length > 1 ? "s" : ""} · ${Math.round(tot.kcal)} kcal`);
    onClose();
  };

  return (
    <>
      {node}
      <Sheet open={open} onClose={onClose} title={step === "input" ? "Log a meal" : "Check the portions"}
        footer={step === "review"
          ? <Btn className="w-full" onClick={save}><Check size={16} /> Log {Math.round(tot.kcal)} kcal</Btn>
          : null}>
        <div className="flex gap-1.5 flex-wrap">
          {SLOTS.map((s) => (
            <button key={s} onClick={() => setSlot(s)} className={`px-3 h-8 rounded-full text-xs font-bold ${slot === s ? "bg-emerald-700 text-white" : "bg-white ring-1 ring-stone-200 text-stone-600"}`}>{SLOT_META[s].emoji} {SLOT_META[s].label}</button>
          ))}
        </div>

        {err && <div className="flex items-start gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-sm text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {err}</div>}

        {step === "input" && (
          <>
            {images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {images.map((im, i) => (
                  <div key={i} className="relative shrink-0">
                    <img src={`data:${im.mediaType};base64,${im.data}`} alt="" className="h-20 w-20 rounded-xl object-cover ring-1 ring-stone-200" />
                    <button onClick={() => setImages((a) => a.filter((_, k) => k !== i))} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-stone-800 text-white grid place-items-center"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <Btn variant="ai" className="w-full" onClick={addPhotos}><Camera size={16} /> {images.length ? "Add another photo" : "Take or choose photos"}</Btn>
            <Field label="Or describe it" hint="e.g. 2 rotis, paneer bhurji, a bowl of curd">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional with a photo, required without one"
                className="w-full px-3 py-2 rounded-xl bg-white ring-1 ring-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none text-[15px] text-stone-800 placeholder:text-stone-400" />
            </Field>
            {hasAI
              ? <Btn className="w-full" onClick={estimate} disabled={busy || (!images.length && !note.trim())}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? "Estimating…" : "Estimate calories & macros"}</Btn>
              : <button onClick={openSettings} className="w-full text-left rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm text-amber-800 flex items-center gap-2"><KeyRound size={15} /> Add an AI key in settings to estimate from photos.</button>}
            <button onClick={startManual} className="w-full text-sm font-semibold text-stone-500 py-1">Enter calories myself</button>
          </>
        )}

        {step === "review" && (
          <>
            {items.map((it) => {
              const s = shown.find((x) => x.id === it.id);
              return (
                <div key={it.id} className="rounded-2xl bg-white ring-1 ring-stone-200 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={it.name} onChange={(e) => patch(it.id, { name: e.target.value })} placeholder="Food name" className="flex-1 min-w-0 font-bold text-stone-800 bg-transparent outline-none" />
                    {!it.manual && it.confidence && <ConfBadge c={it.confidence} />}
                    <button onClick={() => setItems((a) => a.filter((x) => x.id !== it.id))} aria-label="Remove item" className="text-stone-300 hover:text-rose-500"><X size={16} /></button>
                  </div>
                  {it.manual ? (
                    <div className="grid grid-cols-4 gap-2">
                      {[["kcal", "kcal"], ["p", "Protein"], ["c", "Carbs"], ["f", "Fat"]].map(([k, l]) => (
                        <label key={k} className="block"><span className="text-[10px] font-semibold uppercase text-stone-400">{l}</span>
                          <input type="number" min="0" inputMode="decimal" value={it[k] || ""} onChange={(e) => patch(it.id, { [k]: Math.max(0, Number(e.target.value) || 0) })} className="w-full h-9 px-2 rounded-lg bg-stone-50 ring-1 ring-stone-200 text-sm tabular-nums" /></label>
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-stone-500 tabular-nums">{s.g ? `${s.g} g · ` : ""}<b className="text-stone-800">{s.kcal} kcal</b> · P {s.p} · C {s.c} · F {s.f}</p>
                      <input type="range" min="0.25" max="2.5" step="0.05" value={sc(it)} onChange={(e) => patch(it.id, { scale: Number(e.target.value) })} className="w-full accent-emerald-700" />
                      <div className="flex justify-between text-[10px] text-stone-400"><span>¼×</span><span className="font-semibold text-stone-500">{sc(it).toFixed(2)}× of the estimate</span><span>2½×</span></div>
                      {it.remembered && <p className="text-[11px] text-amber-600">Started from how you corrected this dish before.</p>}
                    </>
                  )}
                </div>
              );
            })}
            <Btn variant="outline" size="sm" onClick={() => setItems((a) => [...a, { id: uid(), name: "", grams: 0, kcal: 0, p: 0, c: 0, f: 0, scale: 1, manual: true }])}><Plus size={14} /> Add an item</Btn>
            <div className="rounded-xl bg-emerald-50 text-emerald-900 px-3 py-2 text-sm font-semibold tabular-nums">Total {Math.round(tot.kcal)} kcal · P {round1(tot.p)} g · C {round1(tot.c)} g · F {round1(tot.f)} g</div>
            <p className="text-[11px] text-stone-400">Photo estimates are often 20–30% off. Slide the portion until it looks right — it's remembered for next time.</p>
          </>
        )}
      </Sheet>
    </>
  );
}

/* ─────────────────────────────  Targets sheet  ─────────────────────────────── */

function TargetsSheet({ open, onClose }) {
  const { fit, saveTargets, setSnack, setCuisineFirst } = useApp();
  const t = fit.targets;
  const [p, setP] = useState(t.profile);
  const [custom, setCustom] = useState(!!t.manual);
  const [man, setMan] = useState({ kcal: t.kcal, protein: t.protein, fat: t.fat, water: t.water });
  useEffect(() => {
    if (!open) return;
    setP(t.profile); setCustom(!!t.manual);
    setMan({ kcal: t.kcal, protein: t.protein, fat: t.fat, water: t.water });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const adj = Number(t.adjust) || 0;
  const calc = targetsFor(p, adj);
  const kcal = custom ? Number(man.kcal) || 0 : calc.kcal;
  const protein = custom ? Number(man.protein) || 0 : calc.protein;
  const fat = custom ? Number(man.fat) || 0 : calc.fat;
  const water = custom ? Number(man.water) || 0 : calc.water;
  const carbs = custom ? Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5) : calc.carbs;
  const perKg = (Number(p.weightKg) || 60) > 0 ? protein / (Number(p.weightKg) || 60) : 0;
  const setField = (k) => (e) => setP((s) => ({ ...s, [k]: e.target.value }));

  const save = () => {
    const profile = { ...p, age: Number(p.age) || 25, heightCm: Number(p.heightCm) || 170, weightKg: Number(p.weightKg) || 60, pace: Number(p.pace) || 0.5 };
    saveTargets({ profile, kcal, protein, fat, carbs, water, set: true, manual: custom, adjust: custom ? 0 : adj });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Your daily targets"
      footer={<Btn className="w-full" onClick={save}><Check size={16} /> Save targets</Btn>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sex"><Select value={p.sex} onChange={setField("sex")}><option value="male">Male</option><option value="female">Female</option></Select></Field>
        <Field label="Age"><TextInput type="number" inputMode="numeric" value={p.age} onChange={setField("age")} /></Field>
        <Field label="Height (cm)"><TextInput type="number" inputMode="numeric" value={p.heightCm} onChange={setField("heightCm")} /></Field>
        <Field label="Weight (kg)"><TextInput type="number" inputMode="decimal" value={p.weightKg} onChange={setField("weightKg")} /></Field>
        <Field label="Activity"><Select value={p.activity} onChange={setField("activity")}><option value="sedentary">Sedentary</option><option value="light">Lightly active</option><option value="moderate">Moderately active</option><option value="active">Very active</option></Select></Field>
        <Field label="Goal"><Select value={p.goal} onChange={setField("goal")}><option value="gain">Gain weight</option><option value="maintain">Maintain</option><option value="lose">Lose weight</option></Select></Field>
      </div>
      {p.goal !== "maintain" && (
        <Field label="Pace" hint="Lean gain is usually 0.25–0.5 kg a week; faster mostly adds fat.">
          <Select value={String(p.pace)} onChange={setField("pace")}><option value="0.25">Slow · 0.25 kg / week</option><option value="0.5">Optimal · 0.5 kg / week</option><option value="0.75">Fast · 0.75 kg / week</option></Select>
        </Field>
      )}

      <div className="rounded-2xl bg-white ring-1 ring-stone-200 p-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          {[["kcal", kcal], ["Protein", protein + " g"], ["Carbs", carbs + " g"], ["Fat", fat + " g"]].map(([l, v]) => (
            <div key={l}><p className="font-extrabold text-stone-800 tabular-nums" style={{ fontFamily: HEAD }}>{v}</p><p className="text-[10px] uppercase tracking-wide text-stone-400 font-semibold">{l}</p></div>
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">Protein is {perKg.toFixed(1)} g per kg of body weight · water {water} ml</p>
        {!custom && adj !== 0 && <p className="mt-1 text-xs font-semibold text-stone-600">Includes your trainer's {adj > 0 ? "+" : "−"}{Math.abs(adj)} kcal adjustment from your weigh-ins.</p>}
        {perKg > 2.6 && <p className="mt-1 text-xs font-semibold text-amber-700">That's above the usual 1.6–2.2 g/kg range, and expensive to hit with food.</p>}
      </div>

      <label className="flex items-center justify-between gap-3 text-sm font-semibold text-stone-700">
        Set the numbers myself
        <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="h-5 w-5 accent-emerald-700" />
      </label>
      {custom && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Calories"><TextInput type="number" inputMode="numeric" value={man.kcal} onChange={(e) => setMan({ ...man, kcal: e.target.value })} /></Field>
          <Field label="Protein (g)"><TextInput type="number" inputMode="numeric" value={man.protein} onChange={(e) => setMan({ ...man, protein: e.target.value })} /></Field>
          <Field label="Fat (g)"><TextInput type="number" inputMode="numeric" value={man.fat} onChange={(e) => setMan({ ...man, fat: e.target.value })} /></Field>
          <Field label="Water (ml)"><TextInput type="number" inputMode="numeric" value={man.water} onChange={(e) => setMan({ ...man, water: e.target.value })} /></Field>
        </div>
      )}

      <Field label="Food style shown first" hint="The rest follow in the usual order: Telangana, Andhra, South Indian, North Indian, American.">
        <Select value={fit.prefs.tasteFirst || "telangana"} onChange={(e) => setCuisineFirst(e.target.value)}>
          {CUISINES.map((c) => <option key={c} value={c}>{CUISINE_LABEL[c]}</option>)}
        </Select>
      </Field>

      <label className="flex items-center justify-between gap-3 text-sm font-semibold text-stone-700">
        Show a snack card each day
        <input type="checkbox" checked={!!fit.prefs.snack} onChange={(e) => setSnack(e.target.checked)} className="h-5 w-5 accent-emerald-700" />
      </label>
    </Sheet>
  );
}

/* ─────────────────────────────  Insights  ─────────────────────────────── */

function WeightSpark({ points }) {
  if (points.length < 2) return <p className="text-sm text-stone-400">Log your weight a couple of times to see the trend.</p>;
  const W = 300, H = 64, pad = 6;
  const ys = points.map((x) => x.kg);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = Math.max(0.5, hi - lo);
  const pts = points.map((x, i) => `${pad + (i * (W - 2 * pad)) / (points.length - 1)},${H - pad - ((x.kg - lo) / span) * (H - 2 * pad)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16">
      <polyline points={pts} fill="none" stroke="#047857" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InsightsTab() {
  const { today, fit, addWeight, setTab } = useApp();
  const t = fit.targets;
  const [kg, setKg] = useState("");
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(today, i - 6));
  const rows = days.map((d) => {
    const es = fit.logs[d] || [];
    return { d, ...sumEntries(es), n: es.filter((e) => e.source !== "skipped").length, water: fit.water[d] || 0 };
  });
  const logged = rows.filter((r) => r.n > 0);
  const avg = (k) => (logged.length ? logged.reduce((a, r) => a + r[k], 0) / logged.length : 0);
  const maxBar = Math.max(t.kcal * 1.15, ...rows.map((r) => r.kcal), 1);
  const waterDays = rows.filter((r) => r.water >= t.water * 0.9).length;
  const weights = [...(fit.weights || [])].sort((a, b) => a.date.localeCompare(b.date));
  const lastW = weights[weights.length - 1];
  const dayLetter = (d) => toDate(d).toLocaleDateString(undefined, { weekday: "narrow" });
  const grade = weekGrade(fit.logs, today, t, t.profile.goal);

  return (
    <div className="px-4 pt-3 pb-4 space-y-3">
      <h1 className="text-2xl font-extrabold text-stone-800" style={{ fontFamily: HEAD }}>Insights</h1>

      <div className="rounded-3xl bg-stone-900 text-white p-4">
        <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${LEVEL_DOT[grade.level]}`} /> This week's verdict</span>
        <p className="mt-2 text-lg font-extrabold leading-snug" style={{ fontFamily: HEAD }}>{grade.hit} of 7 days on target.</p>
        <p className="text-sm text-stone-300 mt-1">{grade.verdict}</p>
      </div>

      {logged.length === 0 ? (
        <Empty icon={TrendingUp} title="No meals logged this week" sub="Log a meal under Today and your weekly numbers will show up here."
          action={<Btn onClick={() => setTab("today", "today")}><Camera size={16} /> Go to Today</Btn>} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[["Avg kcal", Math.round(avg("kcal")), `of ${t.kcal}`], ["Avg protein", Math.round(avg("p")) + " g", `of ${t.protein} g`], ["Days logged", logged.length + "/7", `water ${waterDays}/7`]].map(([l, v, s]) => (
              <div key={l} className="rounded-2xl bg-white ring-1 ring-stone-200 p-3 text-center">
                <p className="text-lg font-bold text-stone-800 tabular-nums" style={{ fontFamily: HEAD }}>{v}</p>
                <p className="text-[10px] text-stone-400 font-semibold uppercase tracking-wide">{l}</p>
                <p className="text-[10px] text-stone-400">{s}</p>
              </div>
            ))}
          </div>

          <div className="rounded-3xl bg-white ring-1 ring-stone-200 p-4">
            <p className="text-[13px] font-bold uppercase tracking-wider text-stone-500">Calories this week</p>
            <div className="relative mt-3 h-36">
              <div className="absolute inset-x-0 border-t border-dashed border-emerald-500/70" style={{ bottom: (t.kcal / maxBar) * 100 + "%" }}>
                <span className="absolute -top-4 right-0 text-[10px] font-bold text-emerald-700">target {t.kcal}</span>
              </div>
              <div className="absolute inset-0 flex items-end gap-2">
                {rows.map((r) => (
                  <div key={r.d} className="flex-1 h-full flex flex-col justify-end items-center">
                    <div className={`w-full rounded-t-lg ${r.n === 0 ? "bg-stone-100" : r.kcal > t.kcal * 1.05 ? "bg-rose-400" : "bg-emerald-500"}`} style={{ height: Math.max(r.n ? 4 : 2, (r.kcal / maxBar) * 100) + "%" }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-1">
              {rows.map((r) => <div key={r.d} className={`flex-1 text-center text-[11px] font-semibold ${r.d === today ? "text-emerald-700" : "text-stone-400"}`}>{dayLetter(r.d)}</div>)}
            </div>
          </div>
        </>
      )}

      <div className="rounded-3xl bg-white ring-1 ring-stone-200 p-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-bold uppercase tracking-wider text-stone-500">Weight</p>
          {lastW && <p className="text-sm font-bold text-stone-800 tabular-nums">{lastW.kg} kg <span className="text-xs text-stone-400 font-medium">· {fmtShort(lastW.date)}</span></p>}
        </div>
        <div className="mt-2"><WeightSpark points={weights.slice(-12)} /></div>
        <div className="mt-2 flex gap-2">
          <input type="number" inputMode="decimal" step="0.1" min="20" max="300" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="Today's weight (kg)" className={inputCls} />
          <Btn onClick={() => { const v = Number(kg); if (v >= 20 && v <= 300) { addWeight(round1(v)); setKg(""); } }} disabled={!(Number(kg) >= 20)}>Log</Btn>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────  Plan + shopping list (lives in the Shop tab)  ─────────────────────────────── */

function PlanShopping() {
  const { fit, today, pantry, byId, planNextWeek, clearPlan, removePlanned, addOrMerge, withUndo, notify } = useApp();
  const [showPlan, setShowPlan] = useState(false);
  const needs = shoppingNeeds({ plan: fit.plan, byId, pantry, fromDate: today });
  const days = Object.keys(fit.plan).filter((d) => d >= today && Object.values(fit.plan[d]).some((e) => !e.status)).sort();
  const cats = [...new Set(needs.map((n) => n.cat))];

  const buy = (rows, label) => withUndo(label, () => addOrMerge(rows.map((r) => ({ name: r.name, category: r.cat, quantity: r.buyQty, unit: r.buyUnit }))));

  return (
    <div className="mb-4">
      <div className="rounded-3xl bg-white ring-1 ring-stone-200 p-4">
        <div className="flex items-center justify-between">
          <p className="font-extrabold text-stone-800" style={{ fontFamily: HEAD }}>This week's plan</p>
          {days.length > 0 && <button onClick={() => setShowPlan(!showPlan)} className="text-sm font-semibold text-emerald-700">{showPlan ? "Hide" : `View ${days.length} days`}</button>}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Btn onClick={planNextWeek}><CalendarDays size={16} /> {days.length ? "Fill the gaps" : "Plan 7 days"}</Btn>
          <Btn variant="outline" onClick={clearPlan} disabled={!days.length}>Clear plan</Btn>
        </div>
        {showPlan && (
          <div className="mt-3 space-y-2">
            {days.map((d) => (
              <div key={d} className="rounded-xl bg-stone-50 p-2">
                <p className="text-xs font-bold text-stone-500">{fmtLong(d)}</p>
                {SLOTS.filter((s) => fit.plan[d][s] && !fit.plan[d][s].status && byId[fit.plan[d][s].rid]).map((s) => {
                  const e = fit.plan[d][s];
                  return (
                    <div key={s} className="flex items-center gap-2 text-sm py-0.5">
                      <span className="w-5 text-center">{SLOT_META[s].emoji}</span>
                      <span className="flex-1 min-w-0 truncate text-stone-700">{byId[e.rid].name} <span className="text-stone-400">× {e.servings}</span></span>
                      <button onClick={() => removePlanned(d, s)} aria-label="Remove from plan" className="text-stone-300 hover:text-rose-500"><X size={14} /></button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <SectionTitle right={needs.length > 0 && <button onClick={() => buy(needs, `${needs.length} items added to pantry`)} className="text-xs font-bold text-emerald-700">Mark all bought</button>}>Need to buy</SectionTitle>
      {needs.length === 0 ? (
        <div className="rounded-2xl bg-white ring-1 ring-stone-200 p-4 text-center text-sm text-stone-500">
          {days.length ? "Your pantry covers every planned meal. 🎉" : "Plan your week and the exact shopping list appears here."}
        </div>
      ) : (
        <div className="space-y-3">
          {cats.map((c) => (
            <div key={c} className="rounded-2xl bg-white ring-1 ring-stone-200 divide-y divide-stone-100 overflow-hidden">
              <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-400 bg-stone-50">{CAT_EMOJI[c] || "📦"} {c}</p>
              {needs.filter((n) => n.cat === c).map((n) => (
                <div key={n.key} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-stone-800 truncate">{n.name}</p>
                    <p className="text-xs text-stone-400">buy {fmtBuy(n)} · plan needs {fmtAmount(n.key, n.needG)}{n.haveG ? `, you have ${fmtAmount(n.key, n.haveG)}` : ""}</p>
                  </div>
                  <Btn size="sm" variant="soft" onClick={() => buy([n], `${n.name} added to pantry`)}><Check size={14} /> Bought</Btn>
                </div>
              ))}
            </div>
          ))}
          <p className="text-[11px] text-stone-400">Amounts are rounded up to practical sizes. Spices, masala powders, tamarind, salt, ginger, garlic, chilies and curry leaves are not listed.</p>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────  Meals tab wrapper (ideas + scheduled)  ─────────────────────────────── */

/* ─────────────────────────────  Cook now (offline ingredient → recipe matrix)  ─────────────────────────────── */

function CookNow() {
  const { today, pantry, recipes, fit, cookMeal, lockMeal, setExtraHave, notify } = useApp();
  const matrix = React.useMemo(() => buildMatrix(recipes), [recipes]);
  const pindex = React.useMemo(() => indexPantry(pantry, today), [pantry, today]);
  const [off, setOff] = useState(() => new Set());   // pantry items unticked just for this look
  const [edit, setEdit] = useState(false);
  const [slot, setSlot] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [all, setAll] = useState(false);            // also list dishes missing 3 or more things

  const extra = new Set(fit.prefs.extraHave || []);
  const inPantry = (k) => !!(pindex[k] && pindex[k].grams > 0);
  const has = (k) => (inPantry(k) && !off.has(k)) || extra.has(k);
  const toggle = (k) => {
    if (inPantry(k)) setOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
    else setExtraHave(extra.has(k) ? [...extra].filter((x) => x !== k) : [...extra, k]);
  };
  const foods = Object.values(FOODS);
  const cats = [...new Set(foods.map((f) => f.cat))];
  const have = foods.filter((f) => has(f.key)).map((f) => f.key);
  const cuisines = cuisineOrder(fit.prefs.tasteFirst);
  const opt = slot === "all" ? { cuisines } : { slot, cuisines };
  const rows = cookable(matrix, have, opt).map((x) => ({
    ...x,
    // ticked from the pantry, but less there than one serving needs
    low: x.recipe.ing.filter((i) => inPantry(i.k) && !off.has(i.k) && pindex[i.k].grams + 2 < i.g).map((i) => i.k),
  }));
  const ready = rows.filter((x) => !x.missing.length);
  const tips = unlocks(matrix, have, opt).slice(0, 3);
  const near = rows.filter((x) => x.missing.length <= 2);
  const shown = all ? rows : near;
  const slotFor = (r) => { const g = guessSlot(); return r.slots.includes(g) ? g : r.slots[0]; };
  const names = (keys) => keys.map((k) => FOODS[k].name.replace(/ \(.*\)/, "")).join(", ");

  const plan = (r) => {
    const s = slotFor(r);
    const done = (fit.logs[today] || []).some((e) => e.slot === s);
    const date = done ? addDaysISO(today, 1) : today;
    lockMeal(date, s, r.id, 1);
    notify(`Planned for ${done ? "tomorrow's" : "today's"} ${SLOT_META[s].label.toLowerCase()}`);
  };

  return (
    <div className="px-4 pt-3 pb-4 space-y-3">
      <div className="rounded-3xl bg-white ring-1 ring-stone-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-extrabold text-stone-800" style={{ fontFamily: HEAD }}>What can I cook right now?</p>
            <p className="text-xs text-stone-500 mt-0.5">{have.length} ingredients ticked — your pantry is ticked for you.</p>
          </div>
          <Btn size="sm" variant={edit ? "solid" : "outline"} onClick={() => setEdit(!edit)}>{edit ? "Done" : "Edit"}</Btn>
        </div>
        {edit && (
          <div className="mt-3 space-y-3">
            {cats.map((c) => (
              <div key={c}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-stone-400">{CAT_EMOJI[c] || "📦"} {c}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {foods.filter((f) => f.cat === c).map((f) => (
                    <button key={f.key} onClick={() => toggle(f.key)} aria-pressed={has(f.key)}
                      className={`px-2.5 h-8 rounded-full text-[13px] font-semibold flex items-center gap-1 transition ${has(f.key) ? "bg-emerald-700 text-white" : "bg-stone-100 text-stone-500"}`}>
                      {has(f.key) && <Check size={13} />}{f.name.replace(/ \(.*\)/, "")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-stone-400">Ticks you add for things not in your pantry (oil, ghee, flour…) are remembered. Salt, spices, masala powders, tamarind, ginger, garlic, chilies and curry leaves are always assumed.</p>
          </div>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[["all", "All"], ...SLOTS.map((s) => [s, SLOT_META[s].label])].map(([id, l]) => (
          <button key={id} onClick={() => setSlot(id)} className={`shrink-0 px-3 h-8 rounded-full text-[13px] font-bold ${slot === id ? "bg-emerald-700 text-white" : "bg-white ring-1 ring-stone-200 text-stone-600"}`}>{l}</button>
        ))}
      </div>

      <p className="text-sm font-bold text-stone-700">
        {ready.length ? `${ready.length} dish${ready.length > 1 ? "es" : ""} you can make now` : "Nothing is fully covered yet"}
        <span className="font-medium text-stone-400"> · {near.length - ready.length} need 1 or 2 things</span>
      </p>

      {tips.length > 0 && (
        <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm text-amber-900">
          <span className="font-bold">One item away:</span>{" "}
          {tips.map((t, i) => <span key={t.key}>{i > 0 && " · "}{t.name.replace(/ \(.*\)/, "")} → {t.n} more</span>)}
        </div>
      )}

      <div className="space-y-2">
        {shown.map(({ recipe: r, missing, low }) => {
          const open = openId === r.id;
          return (
            <div key={r.id} className="rounded-2xl bg-white ring-1 ring-stone-200 overflow-hidden">
              <button onClick={() => setOpenId(open ? null : r.id)} className="w-full text-left p-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>{r.name}</p>
                  <p className="text-xs text-stone-400 tabular-nums">{r.cui ? CUISINE_LABEL[r.cui] + " · " : ""}{r.m.kcal} kcal · {Math.round(r.m.p)} g protein · {r.slots.map((s) => SLOT_META[s].label.toLowerCase()).join(" / ")}</p>
                  {missing.length > 0
                    ? <p className="text-xs font-semibold text-amber-700 mt-0.5">Missing {missing.length}: {names(missing)}</p>
                    : low.length > 0 && <p className="text-xs font-semibold text-amber-700 mt-0.5">Running low on {names(low)}</p>}
                </div>
                <span className={`shrink-0 text-[11px] font-bold rounded-full px-2 py-0.5 ${missing.length ? "bg-stone-100 text-stone-500" : "bg-emerald-50 text-emerald-700"}`}>
                  {missing.length ? `${r.ing.length - missing.length}/${r.ing.length}` : "Ready"}
                </span>
              </button>
              {open && (
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-sm text-stone-500">{r.desc}</p>
                  <div className="rounded-xl bg-stone-50 divide-y divide-stone-100">
                    {r.ing.map((i) => (
                      <div key={i.k} className="flex items-center justify-between px-3 py-1.5 text-sm">
                        <span className="text-stone-700">{FOODS[i.k].name}</span>
                        <span className="flex items-center gap-2 tabular-nums">
                          <span className="font-semibold text-stone-800">{fmtAmount(i.k, i.g)}</span>
                          {missing.includes(i.k) ? <span className="text-[11px] font-bold text-rose-600">missing</span>
                            : low.includes(i.k) ? <span className="text-[11px] font-bold text-amber-600">low</span>
                            : <Check size={14} className="text-emerald-600" />}
                        </span>
                      </div>
                    ))}
                  </div>
                  <ol className="space-y-1.5 text-sm text-stone-600 list-decimal pl-5">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Btn onClick={() => { cookMeal({ slot: slotFor(r), rid: r.id, cook: 1, eat: 1 }); setOpenId(null); }}><Check size={16} /> Cooked it</Btn>
                    <Btn variant="outline" onClick={() => plan(r)}><Pin size={16} /> Plan it</Btn>
                  </div>
                  <p className="text-[11px] text-stone-400">Amounts are for one serving. Planning it puts anything you're short of on the shopping list.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rows.length > near.length && (
        <Btn variant="soft" className="w-full" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show the other ${rows.length - near.length} dishes`}</Btn>
      )}

      <a href="https://myfridgefood.com" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-700 py-2">
        <ExternalLink size={14} /> Want more ideas? Open MyFridgeFood
      </a>
    </div>
  );
}

function Seg({ value, onChange, options }) {
  return (
    <div className="px-4 pt-2">
      <div className="grid rounded-xl bg-stone-200/70 p-1 text-sm font-bold" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(([id, l]) => (
          <button key={id} onClick={() => onChange(id)} className={`h-9 rounded-lg transition ${value === id ? "bg-white shadow text-emerald-700" : "text-stone-500"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

const TABS = [
  { id: "today", label: "Today", icon: Home },
  { id: "inventory", label: "Pantry", icon: Package },
  { id: "meals", label: "Meals", icon: Utensils },
  { id: "shopping", label: "Shop", icon: ShoppingCart },
];
// Each tab has two views behind one switch.
const VIEWS = {
  today: [["today", "Today"], ["insights", "Insights"]],
  inventory: [["items", "In stock"], ["scan", "Scan & add"]],
  meals: [["cook", "Cook now"], ["ideas", "Ideas"], ["scheduled", "Scheduled"]],
  shopping: [["list", "Shopping list"], ["trips", "Trips & receipts"]],
};

export default function App() {
  const [tab, setTabRaw] = useState("today");
  const [views, setViews] = useState({ today: "today", inventory: "items", meals: "cook", shopping: "list" });
  const setView = (t, v) => setViews((s) => ({ ...s, [t]: v }));
  const setTab = (t, v) => { setTabRaw(t); if (v) setView(t, v); };
  const today = useToday();
  const hour = useClock();
  const [fit, setFit] = useState(() => normalizeFit(null));
  const [logSheet, setLogSheet] = useState(null);   // { slot } while the log sheet is open
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [undo, setUndo] = useState(null);           // { label, snap }
  const undoTimer = useRef(null);
  const [pantry, setPantry] = useState([]);
  const [meals, setMeals] = useState([]);
  const [trips, setTrips] = useState([]);
  const [ideas, setIdeas] = useState([]);          // persisted AI suggestions — survive reloads
  const [ideasSig, setIdeasSig] = useState("");     // pantry snapshot the ideas were generated from
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const saveTimer = useRef(null);

  // ── auth ──
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authErr, setAuthErr] = useState("");

  useEffect(() => {
    if (!CONFIGURED) { setAuthReady(true); return; }
    getRedirectResult(auth).catch(() => {});
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); });
    return unsub;
  }, []);

  const signIn = async () => {
    setAuthErr("");
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) {
      try { await signInWithRedirect(auth, googleProvider); }
      catch (e2) { setAuthErr(e2.message || e.message || "Sign-in failed."); }
    }
  };
  const doSignOut = async () => { try { if (user) clearIdeasCache(user.uid); await signOut(auth); } catch (_) {} };

  // ── live sync: this user's private doc streams in, so every open device stays current ──
  const syncedRef = useRef("");     // stable JSON of what the cloud is known to hold
  const dirtyRef = useRef(false);   // local edits waiting to be written
  const pendingRef = useRef(null);  // { json, payload } for an immediate flush when the tab is hidden
  const [loadErr, setLoadErr] = useState("");
  const [loadKey, setLoadKey] = useState(0);
  useEffect(() => {
    if (!CONFIGURED) return;
    if (!user) { setLoaded(false); setPantry([]); setMeals([]); setTrips([]); setIdeas([]); setIdeasSig(""); setFit(normalizeFit(null)); syncedRef.current = ""; return; }
    setLoaded(false); setLoadErr(""); syncedRef.current = ""; dirtyRef.current = false; pendingRef.current = null;
    // Instant hydrate from the local cache first — no network wait, so meal
    // ideas reappear immediately even if the last Firestore write never landed
    // (e.g. the tab got discarded mid-save). Firestore then confirms/updates.
    const cached = readIdeasCache(user.uid);
    if (cached && cached.ideas && cached.ideas.length) { setIdeas(cached.ideas); setIdeasSig(cached.sig || ""); }
    let first = true;
    const unsub = onSnapshot(doc(db, "users", user.uid), { includeMetadataChanges: true }, (snap) => {
      if (snap.metadata.hasPendingWrites) return;            // our own write, not confirmed yet
      const d = parseUserDoc(snap.exists() ? snap.data() : {});
      const json = stableJSON(payloadOf(d, todayISO()));
      if (!first && (dirtyRef.current || json === syncedRef.current)) return; // unsaved local edits win; echoes are ignored
      syncedRef.current = json;
      setPantry(d.pantry); setMeals(d.meals); setTrips(d.trips); setFit(d.fit);
      // On first load only, an empty cloud list must not erase ideas restored from the local cache.
      if (!first || (d.ideas && d.ideas.length)) { setIdeas(d.ideas); setIdeasSig(d.ideasSig); }
      first = false;
      setLoaded(true);
    }, (e) => { if (first) setLoadErr((e && e.message) || "Couldn't reach your data."); });
    return unsub;
  }, [user, loadKey]);

  // ── save (debounced) to this user's private doc — only when something differs from the cloud ──
  const flushSave = useCallback(async () => {
    const p = pendingRef.current;
    if (!p || !user) return;
    pendingRef.current = null; clearTimeout(saveTimer.current);
    syncedRef.current = p.json; dirtyRef.current = false;
    const ok = await saveUserData(user.uid, p.payload);
    if (!ok && syncedRef.current === p.json) syncedRef.current = "";  // try again on the next change
  }, [user]);
  useEffect(() => {
    if (!loaded || !user) return;
    const payload = payloadOf({ pantry, meals, trips, ideas, ideasSig, fit }, today);
    const json = stableJSON(payload);
    if (json === syncedRef.current) { dirtyRef.current = false; pendingRef.current = null; return; }
    dirtyRef.current = true;
    pendingRef.current = { json, payload };
    saveTimer.current = setTimeout(flushSave, 600);
    return () => clearTimeout(saveTimer.current);
  }, [pantry, meals, trips, ideas, ideasSig, fit, today, loaded, user, flushSave]);
  // Phones can freeze a tab the moment you switch apps — write straight away instead of waiting.
  useEffect(() => {
    const h = () => { if (document.visibilityState === "hidden") flushSave(); };
    document.addEventListener("visibilitychange", h); window.addEventListener("pagehide", flushSave);
    return () => { document.removeEventListener("visibilitychange", h); window.removeEventListener("pagehide", flushSave); };
  }, [flushSave]);

  // Mirror ideas to the instant local cache the moment they change — this write
  // is synchronous (no network), so it survives even if the tab gets killed
  // before the debounced Firestore save above has a chance to run.
  useEffect(() => {
    if (!loaded || !user) return;
    if (ideas.length) cacheIdeasLocally(user.uid, ideas, ideasSig);
    else clearIdeasCache(user.uid);
  }, [ideas, ideasSig, loaded, user]);

  // Once the pantry is empty there's nothing left to suggest from — clear the
  // stale idea list rather than leaving old suggestions sitting around forever.
  useEffect(() => {
    if (!loaded || !user) return;
    if (pantry.length === 0 && ideas.length > 0) { setIdeas([]); setIdeasSig(""); }
  }, [pantry.length, loaded, user]);

  // fonts
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://api.fontshare.com/v2/css?f[]=plus-jakarta-sans@400,500,600,700,800&f[]=nunito@400,500,600,700&display=swap";
    document.head.appendChild(l);
    return () => { try { document.head.removeChild(l); } catch (_) {} };
  }, []);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // ── actions (single source of truth) ──
  const withExpiry = (it) => ({
    id: uid(),
    name: it.name, category: it.category || "Other",
    quantity: Number(it.quantity) || 1, unit: it.unit || "pcs",
    purchase: it.purchase || todayISO(),
    expiry: it.expiry || addDays(it.purchase || todayISO(), SHELF_DAYS[it.category] || 30),
  });

  const addItem = (it) => setPantry((p) => [withExpiry(it), ...p]);
  const updateItem = (id, patch) => setPantry((p) => p.map((i) => i.id === id ? { ...i, ...patch, quantity: Number(patch.quantity) || 0 } : i));
  const adjustQty = (id, delta) => setPantry((p) => p.flatMap((i) => {
    if (i.id !== id) return [i];
    const q = Math.round(((Number(i.quantity) || 0) + delta) * 100) / 100;
    return q <= 0 ? [] : [{ ...i, quantity: q }]; // hits 0 → removed
  }));
  const removeItem = (id) => setPantry((p) => p.filter((i) => i.id !== id));
  const clearPantry = () => setPantry([]);
  const replacePantry = (arr) => setPantry(arr); // used to undo an auto-committed scan

  // merge-by-name so scans + receipts + manual all feed ONE inventory
  const addOrMerge = (items) => {
    let count = 0;
    setPantry((prev) => {
      const next = [...prev];
      for (const raw of items) {
        const it = { ...raw, quantity: Number(raw.quantity) || 1 };
        const idx = next.findIndex((e) => norm(e.name) === norm(it.name) && (e.unit || "") === (it.unit || "pcs"));
        if (idx >= 0) next[idx] = { ...next[idx], quantity: next[idx].quantity + it.quantity };
        else next.unshift(withExpiry(it));
        count++;
      }
      return next;
    });
    return count;
  };

  const addMeal = (m) => setMeals((s) => [{ id: uid(), ...m }, ...s]);
  const removeMeal = (id) => setMeals((s) => s.filter((m) => m.id !== id));
  const toggleFav = (id) => setMeals((s) => s.map((m) => m.id === id ? { ...m, favorite: !m.favorite } : m));
  const setMealSteps = (id, steps) => setMeals((s) => s.map((m) => m.id === id ? { ...m, steps } : m));
  const scheduleMeal = (id, date) => setMeals((s) => s.map((m) => m.id === id ? { ...m, scheduledDate: date } : m));
  const setMealServings = (id, delta) => setMeals((s) => s.map((m) => m.id === id ? { ...m, servings: Math.max(1, (Number(m.servings) || 2) + delta) } : m));

  const addTrip = (t) => setTrips((s) => [{ id: uid(), ...t }, ...s]);
  const removeTrip = (id) => setTrips((s) => s.filter((t) => t.id !== id));

  // ── food system: recipes, plan, logs ──
  const recipes = React.useMemo(() => [...ALL_LIBRARY, ...(fit.userRecipes || []).map(withMacros)], [fit.userRecipes]);
  const byId = React.useMemo(() => Object.fromEntries(recipes.map((r) => [r.id, r])), [recipes]);
  const patchFit = (fn) => setFit((f) => fn(f));

  // Snapshot pantry + fit, run the change, and offer a 10-second Undo.
  const withUndo = (label, fn) => {
    setUndo({ label, snap: { pantry, fit } });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 10000);
    return fn();
  };
  const doUndo = () => {
    if (!undo) return;
    setPantry(undo.snap.pantry); setFit(undo.snap.fit);
    clearTimeout(undoTimer.current); setUndo(null); notify("Undone");
  };

  const pushLog = (f, entries) => {
    const logs = { ...f.logs };
    for (const e of entries) logs[e.date] = [...(logs[e.date] || []), e];
    return logs;
  };
  const logEntries = (entries) => patchFit((f) => ({ ...f, logs: pushLog(f, entries) }));
  const removeEntry = (id) => withUndo("Entry removed", () => patchFit((f) => ({
    ...f, logs: { ...f.logs, [today]: (f.logs[today] || []).filter((e) => e.id !== id) },
  })));
  const markPlan = (plan, date, slot, status) => {
    const e = plan[date] && plan[date][slot];
    return e ? { ...plan, [date]: { ...plan[date], [slot]: { ...e, status } } } : plan;
  };

  const cookMeal = ({ slot, rid, cook, eat }) => {
    const r = byId[rid]; if (!r) return;
    withUndo(`Cooked ${r.name}`, () => {
      const { pantry: np, short } = deductFromPantry(pantry, recipeNeeds(r, cook));
      setPantry(np);
      const m = macrosOf(r.ing, eat);
      const entry = { id: uid(), date: today, slot, name: r.name, rid, servings: eat, kcal: m.kcal, p: m.p, c: m.c, f: m.f, source: "cooked" };
      patchFit((f) => ({
        ...f,
        logs: pushLog(f, [entry]),
        plan: markPlan(f.plan, today, slot, "done"),
        leftovers: cook > eat ? [...f.leftovers, { id: uid(), rid, name: r.name, servings: round1(cook - eat), date: today }] : f.leftovers,
      }));
      notify(short.length ? `Cooked · pantry was short on ${short.slice(0, 2).map((s) => s.name.toLowerCase()).join(", ")}` : "Cooked · pantry updated");
    });
  };
  const skipMeal = (slot) => withUndo("Meal skipped", () => patchFit((f) => ({
    ...f,
    logs: pushLog(f, [{ id: uid(), date: today, slot, name: "Skipped this meal", kcal: 0, p: 0, c: 0, f: 0, source: "skipped" }]),
    plan: markPlan(f.plan, today, slot, "skipped"),
  })));
  const eatLeftover = (l) => {
    const r = byId[l.rid]; const eat = l.servings >= 1 ? 1 : l.servings;
    const m = r ? macrosOf(r.ing, eat) : { kcal: 0, p: 0, c: 0, f: 0 };
    withUndo("Leftover eaten", () => patchFit((f) => ({
      ...f,
      logs: pushLog(f, [{ id: uid(), date: today, slot: guessSlot(), name: l.name + " (leftover)", rid: l.rid, servings: eat, kcal: m.kcal, p: m.p, c: m.c, f: m.f, source: "leftover" }]),
      leftovers: f.leftovers.flatMap((x) => (x.id !== l.id ? [x] : l.servings - eat > 0.01 ? [{ ...x, servings: round1(l.servings - eat) }] : [])),
    })));
  };

  const lockMeal = (date, slot, rid, servings) => patchFit((f) => ({ ...f, plan: { ...f.plan, [date]: { ...(f.plan[date] || {}), [slot]: { rid, servings } } } }));
  const removePlanned = (date, slot) => patchFit((f) => {
    const day = { ...(f.plan[date] || {}) }; delete day[slot];
    const plan = { ...f.plan }; if (Object.keys(day).length) plan[date] = day; else delete plan[date];
    return { ...f, plan };
  });
  const unlockMeal = removePlanned;
  const clearPlan = () => withUndo("Plan cleared", () => patchFit((f) => ({ ...f, plan: {} })));
  const planNextWeek = () => withUndo("Week planned", () => {
    const slots = fit.prefs.snack ? SLOTS : SLOTS.filter((s) => s !== "snack");
    const existing = JSON.parse(JSON.stringify(fit.plan));
    // slots already eaten today must not be planned again
    for (const e of fit.logs[today] || []) existing[today] = { ...(existing[today] || {}), [e.slot]: (existing[today] || {})[e.slot] || { rid: e.rid || "", servings: 0, status: "done" } };
    const planned = planWeek({ start: today, days: 7, targets: fit.targets, pantry, recipes, byId, slots, existing, today, cuisines: cuisineOrder(fit.prefs.tasteFirst) });
    for (const d of Object.keys(planned)) for (const s of Object.keys(planned[d])) if (!planned[d][s].servings) delete planned[d][s];
    patchFit((f) => ({ ...f, plan: { ...f.plan, ...planned } }));
    notify("Week planned · shopping list updated");
  });

  const addWater = (ml) => patchFit((f) => ({ ...f, water: { ...f.water, [today]: Math.max(0, (f.water[today] || 0) + ml) } }));
  // A weigh-in is the truth: it becomes your profile weight and the targets are recalculated from it.
  const addWeight = (kg) => {
    const tg = fit.targets;
    const profile = { ...tg.profile, weightKg: kg };
    const next = tg.manual ? {} : targetsFor(profile, tg.adjust);
    patchFit((f) => ({
      ...f,
      weights: [...(f.weights || []).filter((w) => w.date !== today), { date: today, kg }],
      targets: { ...f.targets, ...next, profile },
    }));
    notify(tg.manual || (next.kcal === tg.kcal && next.protein === tg.protein) ? `${kg} kg logged` : `${kg} kg logged · targets now ${next.kcal} kcal, ${next.protein} g protein`);
  };
  const saveTargets = (t) => { patchFit((f) => ({ ...f, targets: { ...f.targets, ...t } })); notify(`Targets saved · ${t.kcal} kcal, ${t.protein} g protein`); };
  // The trainer moves the calorie target when the scale disagrees with the plan.
  const adjustKcal = (delta) => withUndo(`Target ${delta > 0 ? "raised" : "cut"} by ${Math.abs(delta)} kcal`, () => patchFit((f) => {
    const tg = f.targets;
    const adjust = (Number(tg.adjust) || 0) + delta;
    const next = tg.manual
      ? { kcal: tg.kcal + delta, carbs: Math.max(0, Math.round((tg.kcal + delta - tg.protein * 4 - tg.fat * 9) / 4 / 5) * 5) }
      : targetsFor(tg.profile, adjust);
    return { ...f, targets: { ...tg, ...next, adjust, adjustedOn: today } };
  }));
  const coachSlots = fit.prefs.snack ? SLOTS : SLOTS.filter((s) => s !== "snack");
  const trainer = React.useMemo(() => coach({
    hour, today, targets: fit.targets, slots: coachSlots, logs: fit.logs, water: fit.water, weights: fit.weights,
    profile: fit.targets.profile, adjustedOn: fit.targets.adjustedOn || null, set: !!fit.targets.set,
  }), [hour, today, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  // Chase: the tab title carries the count, and coming back to the app lands on what's overdue.
  const problemsRef = useRef(0);
  problemsRef.current = trainer.problems;
  useEffect(() => { document.title = trainer.problems ? `(${trainer.problems}) Behind · Pantry Planner` : "Pantry Planner"; }, [trainer.problems]);
  useEffect(() => {
    const h = () => { if (document.visibilityState === "visible" && problemsRef.current) { setTabRaw("today"); setViews((s) => ({ ...s, today: "today" })); window.scrollTo(0, 0); } };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  const setSnack = (on) => patchFit((f) => ({ ...f, prefs: { ...f.prefs, snack: on } }));
  const setExtraHave = (keys) => patchFit((f) => ({ ...f, prefs: { ...f.prefs, extraHave: keys } }));
  const setCuisineFirst = (c) => patchFit((f) => ({ ...f, prefs: { ...f.prefs, tasteFirst: c } }));
  const rememberDishes = (items) => patchFit((f) => {
    const mem = { ...f.dishMemory };
    for (const it of items) {
      const k = norm(it.name); const old = mem[k]; const n = old ? Math.min(old.n, 5) : 0;
      mem[k] = { scale: Math.round((((old ? old.scale * n : 0) + (it.scale || 1)) / (n + 1)) * 100) / 100, n: n + 1 };
    }
    const keys = Object.keys(mem); if (keys.length > 150) for (const k of keys.slice(0, keys.length - 150)) delete mem[k];
    return { ...f, dishMemory: mem };
  });
  const addAiRecipes = async (slot) => {
    try {
      const got = await aiRecipes(slot, recipes.map((r) => r.name));
      if (!got.length) { notify("No new ideas this time. Try again."); return; }
      patchFit((f) => ({ ...f, userRecipes: [...got, ...(f.userRecipes || [])].slice(0, 40) }));
      notify(`${got.length} new ideas added`);
    } catch (e) { notify("Couldn't get ideas: " + (e.message || "AI error").slice(0, 60)); }
  };
  const openLog = (slot) => setLogSheet({ slot: slot || "" });
  const openSettings = () => setShowSettings(true);

  const ctx = {
    today, fit, recipes, byId, setTab, withUndo, logEntries, removeEntry, cookMeal, skipMeal, eatLeftover,
    lockMeal, unlockMeal, removePlanned, clearPlan, planNextWeek, addWater, addWeight, saveTargets, setSnack, setExtraHave, setCuisineFirst, trainer, adjustKcal, hour,
    rememberDishes, addAiRecipes, openLog, openSettings,
    pantry, meals, trips, ideas, setIdeas, ideasSig, setIdeasSig, notify,
    addItem, updateItem, adjustQty, removeItem, clearPantry, replacePantry, addOrMerge,
    addMeal, removeMeal, toggleFav, scheduleMeal, setMealSteps, setMealServings, addTrip, removeTrip,
  };

  const expiringCount = pantry.filter((i) => i.expiry && daysUntil(i.expiry) <= 3).length;
  const plannedCount = meals.filter((m) => m.scheduledDate && daysUntil(m.scheduledDate) === 0).length;
  const badges = { today: trainer.problems, inventory: expiringCount, meals: plannedCount };

  if (!CONFIGURED) return <ConfigNeeded />;
  if (!authReady) return <div className="min-h-screen grid place-items-center bg-stone-50 text-emerald-700"><Loader2 className="animate-spin" /></div>;
  if (!user) return <SignIn onSignIn={signIn} err={authErr} />;
  if (!loaded && loadErr) return (
    <div className="min-h-screen grid place-items-center bg-stone-50 px-6 text-center">
      <div>
        <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>Couldn't load your kitchen</p>
        <p className="text-sm text-stone-500 mt-1">Check your connection and try again. Nothing has been changed.</p>
        <Btn className="mt-4" onClick={() => setLoadKey((k) => k + 1)}><RotateCcw size={16} /> Retry</Btn>
      </div>
    </div>
  );
  if (!loaded) return <div className="min-h-screen grid place-items-center bg-stone-50 text-emerald-700"><Loader2 className="animate-spin" /></div>;

  return (
    <Ctx.Provider value={ctx}>
      <div className="min-h-screen bg-stone-50 text-stone-800" style={{ fontFamily: BODY }}>
        {/* header */}
        <header className="sticky top-0 z-30 bg-stone-50/85 backdrop-blur border-b border-stone-200/70">
          <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-emerald-700 grid place-items-center text-white text-lg">🥗</div>
            <div className="leading-tight">
              <p className="font-extrabold text-stone-800" style={{ fontFamily: HEAD }}>Pantry Planner</p>
              <p className="text-[11px] text-stone-400 -mt-0.5">Your kitchen, connected</p>
            </div>
            <div className="ml-auto flex items-center gap-2.5">
              <div className="text-right">
                <p className="text-xs text-stone-400">In stock</p>
                <p className="font-bold text-emerald-700 -mt-0.5">{pantry.length}</p>
              </div>
              <button onClick={() => setShowSettings(true)} className="h-9 w-9 grid place-items-center rounded-full overflow-hidden ring-1 ring-stone-200 bg-white text-stone-500 hover:text-stone-700 active:scale-95">
                {user.photoURL ? <img src={user.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Cog size={18} />}
              </button>
            </div>
          </div>
        </header>

        {/* content */}
        <main className="max-w-md mx-auto">
          <Seg value={views[tab]} onChange={(v) => setView(tab, v)} options={VIEWS[tab]} />
          {tab === "today" && (views.today === "today" ? <TodayTab openLog={openLog} openTargets={() => setTargetsOpen(true)} /> : <InsightsTab />)}
          {tab === "inventory" && (views.inventory === "items" ? <InventoryTab /> : <ScanTab openSettings={() => setShowSettings(true)} />)}
          {tab === "meals" && (views.meals === "cook" ? <CookNow /> : views.meals === "ideas" ? <MealIdeas /> : <PlannerTab />)}
          {tab === "shopping" && (views.shopping === "list" ? <div className="px-4 pt-3 pb-4"><PlanShopping /></div> : <ShoppingTab />)}
          <div className="h-24" />
        </main>

        {/* undo */}
        {undo && (
          <div className="fixed bottom-36 inset-x-0 mx-auto w-fit max-w-[92vw] z-50 bg-stone-800 text-white text-sm font-semibold pl-4 pr-2 py-2 rounded-full shadow-lg flex items-center gap-3">
            <span className="truncate">{undo.label}</span>
            <button onClick={doUndo} className="shrink-0 px-3 h-8 rounded-full bg-white/15 hover:bg-white/25 font-bold flex items-center gap-1"><RotateCcw size={13} /> Undo</button>
          </div>
        )}
        <LogSheet open={!!logSheet} slot0={logSheet ? logSheet.slot : ""} onClose={() => setLogSheet(null)} />
        <TargetsSheet open={targetsOpen} onClose={() => setTargetsOpen(false)} />

        {/* toast */}
        {toast && (
          <div className="fixed bottom-24 inset-x-0 mx-auto w-fit max-w-[92vw] z-50 bg-stone-800 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 animate-[slideUp_.2s_ease]">
            <CircleCheck size={16} className="text-emerald-400" /> {toast}
          </div>
        )}

        {/* settings */}
        <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Account & settings">
          <SettingsSheet onClose={() => setShowSettings(false)} notify={notify} user={user} onSignOut={doSignOut} />
        </Sheet>

        {/* bottom nav */}
        <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-stone-200">
          <div className="max-w-md mx-auto grid grid-cols-4">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`relative py-2.5 flex flex-col items-center gap-0.5 transition ${tab === id ? "text-emerald-700" : "text-stone-400"}`}>
                <div className="relative">
                  <Icon size={22} strokeWidth={tab === id ? 2.4 : 2} />
                  {badges[id] > 0 && <span className={`absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full text-white text-[10px] font-bold grid place-items-center ${id === "today" ? "bg-rose-600" : "bg-amber-500"}`}>{badges[id]}</span>}
                </div>
                <span className={`text-[10px] ${tab === id ? "font-bold" : "font-semibold"}`}>{label}</span>
                {tab === id && <span className="absolute -bottom-0 h-0.5 w-8 rounded-full bg-emerald-700" />}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </Ctx.Provider>
  );
}
