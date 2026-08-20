import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from "react";
import {
  Package, Camera, Utensils, CalendarDays, ShoppingCart, Sparkles, Plus, Minus,
  Trash2, Pencil, X, Check, Loader2, ImagePlus, Search, ArrowUpDown, Filter,
  Star, CalendarPlus, CalendarClock, TrendingUp, Receipt, AlertTriangle,
  CircleCheck, Clock, DollarSign, Store, ChevronRight, RotateCcw, Lightbulb,
  Cog, KeyRound, ExternalLink, ClipboardList, LogOut, LogIn, ShieldCheck, BookOpen,
} from "lucide-react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

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
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID",
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
async function loadUserData(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const d = snap.exists() ? snap.data() : {};
    return { pantry: d.pantry || [], meals: d.meals || [], trips: d.trips || [], ideas: d.ideas || [], ideasSig: d.ideasSig || "" };
  } catch (e) {
    return { pantry: [], meals: [], trips: [], ideas: [], ideasSig: "", error: e.message };
  }
}
async function saveUserData(uid, data) {
  try { await setDoc(doc(db, "users", uid), data, { merge: true }); } catch (_) {}
}

/* ─────────────────────────────  helpers  ─────────────────────────────── */

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const todayISO = () => new Date().toISOString().slice(0, 10);
const toDate = (iso) => new Date(iso + "T12:00:00");
const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
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
    "Keep it mostly Indian (a few non-Indian dishes are fine). " +
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
// Always resolves an array of {data, mediaType} — one photo or a whole batch,
// so callers can send several images to the AI in a single analysis pass.

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
        Promise.all(files.map((file) => new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res({ data: String(reader.result).split(",")[1], mediaType: file.type || "image/jpeg" });
          reader.onerror = () => rej(new Error("read failed"));
          reader.readAsDataURL(file);
        }))).then(resolve).catch(() => resolve([]));
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

function InvRow({ item, onAdjust, onEdit, onDelete }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);
  const st = expiryStatus(item);
  const TH = 56;

  const down = (e) => { start.current = e.clientX; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (!dragging) return; setDx(Math.max(-96, Math.min(96, e.clientX - start.current))); };
  const up = () => {
    if (dx >= TH) onAdjust(item.id, +1);
    else if (dx <= -TH) onAdjust(item.id, -1);
    setDx(0); setDragging(false);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* swipe reveals */}
      <div className="absolute inset-0 flex items-center justify-between px-5 text-white font-bold">
        <span className={`flex items-center gap-1 transition-opacity ${dx > 8 ? "opacity-100" : "opacity-0"}`}><Plus size={18} /> Add one</span>
        <span className={`flex items-center gap-1 transition-opacity ${dx < -8 ? "opacity-100" : "opacity-0"}`}>Use one <Minus size={18} /></span>
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
          <button onClick={() => onAdjust(item.id, -1)} className="h-8 w-8 grid place-items-center rounded-lg bg-stone-100 text-stone-600 hover:bg-rose-100 hover:text-rose-600 active:scale-95"><Minus size={15} /></button>
          <span className="w-12 text-center font-bold text-stone-800 tabular-nums">{item.quantity}<span className="text-[10px] font-medium text-stone-400 ml-0.5">{item.unit}</span></span>
          <button onClick={() => onAdjust(item.id, +1)} className="h-8 w-8 grid place-items-center rounded-lg bg-stone-100 text-stone-600 hover:bg-emerald-100 hover:text-emerald-600 active:scale-95"><Plus size={15} /></button>
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
          sub={pantry.length ? "Try a different search or category." : "Add items by hand, or snap a receipt or your groceries on the Scan tab."}
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
  const [err, setErr] = useState("");
  const [paste, setPaste] = useState(false);
  const [result, setResult] = useState(null);   // { items, added, undoSnapshot } after auto-commit
  const hasKey = aiReady();

  const run = async (mode) => {
    setErr(""); setResult(null);
    if (!aiReady()) { setErr("Photo scanning uses AI, which needs an API key. Tap the gear (⚙️) to add one — or use “Paste a list” below to add items without AI."); return; }
    const imgs = await pick();                 // opens gallery — pick one or several at once
    if (!imgs.length) return;                   // cancelled
    setBusyCount(imgs.length); setBusy(true);
    try {
      const res = await extractFromImage(imgs, mode);   // all photos analysed together, one AI call
      if (!res.items.length) throw new Error("No items found. Try clearer, well-lit photos.");
      const before = pantry;                      // snapshot for undo
      const added = addOrMerge(res.items);
      setResult({ items: res.items, added, undoSnapshot: before });
      notify(`${added} item${added > 1 ? "s" : ""} added to inventory`);
    } catch (e) { setErr(e.message || "Scan failed. Please try again."); }
    finally { setBusy(false); }
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
          <p className="text-sm font-semibold">Analysing {busyCount > 1 ? `${busyCount} photos together` : "your photo"}…</p>
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

function MealsTab() {
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
        <div className="mt-2"><Empty icon={Utensils} title="No dishes yet" sub="Tap “Suggest Indian dishes” for ~40 ideas across breakfast, lunch, dinner and dessert — or add one by hand."
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

  if (!meals.length) return <div className="pt-2"><Empty icon={CalendarDays} title="No meals planned yet" sub="Save meals on the Meals tab, then schedule them here." /></div>;

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

  const total = trips.reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const avg = trips.length ? total / trips.length : 0;
  const pred = prediction(trips);
  const sorted = [...trips].sort((a, b) => b.date.localeCompare(a.date));
  const maxAmt = Math.max(1, ...trips.map((t) => Number(t.amount) || 0));

  const scanReceipt = async () => {
    setErr("");
    const imgs = await pick();          // supports multiple photos (multi-page receipts)
    if (!imgs.length) return;
    setBusy(true);
    try {
      const res = await extractFromImage(imgs, "receipt");
      const amt = res.total != null ? res.total : res.items.reduce((a, it) => a + (Number(it.price) || 0), 0);
      setForm({ store: res.store || "", date: res.date || todayISO(), amount: amt ? String(amt.toFixed(2)) : "", notes: "", items: res.items });
    } catch (e) { setErr(e.message || "Couldn't read the receipt."); }
    finally { setBusy(false); }
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
      {busy && <p className="text-center text-sm text-amber-600 mt-2 flex items-center justify-center gap-1"><Loader2 size={14} className="animate-spin" /> Reading receipt & pulling items…</p>}

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

const TABS = [
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "scan", label: "Scan", icon: Camera },
  { id: "meals", label: "Meals", icon: Utensils },
  { id: "planner", label: "Planner", icon: CalendarDays },
  { id: "shopping", label: "Shopping", icon: ShoppingCart },
];

export default function App() {
  const [tab, setTab] = useState("inventory");
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
  const doSignOut = async () => { try { await signOut(auth); } catch (_) {} };

  // ── load this user's private data on sign-in ──
  useEffect(() => {
    if (!CONFIGURED) return;
    if (!user) { setLoaded(false); setPantry([]); setMeals([]); setTrips([]); setIdeas([]); setIdeasSig(""); return; }
    let alive = true;
    setLoaded(false);
    loadUserData(user.uid).then((d) => {
      if (!alive) return;
      setPantry(d.pantry); setMeals(d.meals); setTrips(d.trips); setIdeas(d.ideas); setIdeasSig(d.ideasSig);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [user]);

  // ── save (debounced) to this user's private doc ──
  useEffect(() => {
    if (!loaded || !user) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveUserData(user.uid, { pantry, meals, trips, ideas, ideasSig }), 600);
    return () => clearTimeout(saveTimer.current);
  }, [pantry, meals, trips, ideas, ideasSig, loaded, user]);

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
    const q = (Number(i.quantity) || 0) + delta;
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

  const ctx = {
    pantry, meals, trips, ideas, setIdeas, ideasSig, setIdeasSig, notify,
    addItem, updateItem, adjustQty, removeItem, clearPantry, replacePantry, addOrMerge,
    addMeal, removeMeal, toggleFav, scheduleMeal, setMealSteps, setMealServings, addTrip, removeTrip,
  };

  const expiringCount = pantry.filter((i) => i.expiry && daysUntil(i.expiry) <= 3).length;
  const plannedCount = meals.filter((m) => m.scheduledDate && daysUntil(m.scheduledDate) === 0).length;
  const badges = { inventory: expiringCount, planner: plannedCount };

  if (!CONFIGURED) return <ConfigNeeded />;
  if (!authReady) return <div className="min-h-screen grid place-items-center bg-stone-50 text-emerald-700"><Loader2 className="animate-spin" /></div>;
  if (!user) return <SignIn onSignIn={signIn} err={authErr} />;
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
          {tab === "inventory" && <InventoryTab />}
          {tab === "scan" && <ScanTab openSettings={() => setShowSettings(true)} />}
          {tab === "meals" && <MealsTab />}
          {tab === "planner" && <PlannerTab />}
          {tab === "shopping" && <ShoppingTab />}
          <div className="h-24" />
        </main>

        {/* toast */}
        {toast && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-stone-800 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 animate-[slideUp_.2s_ease]">
            <CircleCheck size={16} className="text-emerald-400" /> {toast}
          </div>
        )}

        {/* settings */}
        <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Account & settings">
          <SettingsSheet onClose={() => setShowSettings(false)} notify={notify} user={user} onSignOut={doSignOut} />
        </Sheet>

        {/* bottom nav */}
        <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-stone-200">
          <div className="max-w-md mx-auto grid grid-cols-5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`relative py-2.5 flex flex-col items-center gap-0.5 transition ${tab === id ? "text-emerald-700" : "text-stone-400"}`}>
                <div className="relative">
                  <Icon size={22} strokeWidth={tab === id ? 2.4 : 2} />
                  {badges[id] > 0 && <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold grid place-items-center">{badges[id]}</span>}
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
