import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from "react";
import {
  Package, Camera, Utensils, CalendarDays, ShoppingCart, Sparkles, Plus, Minus,
  Trash2, Pencil, X, Check, Loader2, ImagePlus, Search, ArrowUpDown, Filter,
  Star, CalendarPlus, CalendarClock, TrendingUp, Receipt, AlertTriangle,
  CircleCheck, Clock, DollarSign, Store, ChevronRight, RotateCcw, Lightbulb,
  Cog, KeyRound, ExternalLink,
} from "lucide-react";

/* ─────────────────────────────  constants  ───────────────────────────── */

const CATEGORIES = ["Produce", "Dairy", "Meat & Seafood", "Bakery", "Pantry", "Frozen", "Beverages", "Snacks", "Household", "Other"];
const SHELF_DAYS = { Produce: 7, Dairy: 10, "Meat & Seafood": 4, Bakery: 5, Pantry: 365, Frozen: 120, Beverages: 60, Snacks: 90, Household: 730, Other: 30 };
const CAT_EMOJI = { Produce: "🥬", Dairy: "🧀", "Meat & Seafood": "🍗", Bakery: "🍞", Pantry: "🫙", Frozen: "🧊", Beverages: "🥤", Snacks: "🍪", Household: "🧽", Other: "📦" };
const MODEL = "claude-sonnet-4-6";

const HEAD = "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, sans-serif";
const BODY = "'Nunito', ui-sans-serif, system-ui, -apple-system, sans-serif";

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

/* ─────────────────────────────  storage  ─────────────────────────────── */
// One shared, persisted data layer. Everything (scan, receipts, meals, trips)
// reads and writes through here, so the whole app stays in sync.

// Standalone build: persist to the device via localStorage (survives app restarts).
const store = {
  async get(key, fallback) {
    try { const v = localStorage.getItem("pp_" + key); return v == null ? fallback : JSON.parse(v); }
    catch (_) { return fallback; }
  },
  async set(key, value) {
    try { localStorage.setItem("pp_" + key, JSON.stringify(value)); } catch (_) {}
  },
};

// AI settings — your own Anthropic API key, kept only on this device.
const getKey = () => { try { return localStorage.getItem("pp_api_key") || ""; } catch (_) { return ""; } };
const getModel = () => { try { return localStorage.getItem("pp_model") || "claude-sonnet-5"; } catch (_) { return "claude-sonnet-5"; } };

/* ─────────────────────────────  Claude AI  ────────────────────────────── */

async function callClaude({ system, user, image }) {
  const key = getKey();
  if (!key) { const e = new Error("Add your Anthropic API key in Settings to use AI features."); e.code = "NO_KEY"; throw e; }
  const content = image
    ? [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } }, { type: "text", text: user }]
    : user;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: getModel(), max_tokens: 2048, system, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) {
    let msg = "AI request failed (" + res.status + ")";
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function parseJSON(text) {
  let t = (text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(t); } catch (_) {}
  const s = t.search(/[[{]/);
  const e = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  if (s !== -1 && e !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch (_) {} }
  throw new Error("Could not read the AI response. Please try again.");
}

async function extractFromImage(image, mode) {
  const receipt = mode === "receipt";
  const system =
    "You read food and grocery photos. Return ONLY valid JSON, no prose, no markdown fences. " +
    `Categories must be one of: ${CATEGORIES.join(", ")}.`;
  const user = receipt
    ? 'This is a grocery store receipt. Extract the store, purchase date, total, and every food/household line item. ' +
      'Return: {"store": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, ' +
      '"items":[{"name": string, "category": string, "quantity": number, "unit": string, "price": number|null, "confidence": "high"|"medium"|"low"}]}. ' +
      "Use a clean product name (not the receipt abbreviation) where you can. Skip tax, subtotal, discounts, and non-item lines."
    : "This is a photo of groceries. Identify each distinct food/household item. " +
      'Return: {"store": null, "date": null, "total": null, ' +
      '"items":[{"name": string, "category": string, "quantity": number, "unit": string, "price": null, "confidence": "high"|"medium"|"low"}]}.';
  const out = parseJSON(await callClaude({ system, user, image }));
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

async function suggestMeals(pantry) {
  const names = pantry.map((p) => p.name);
  const system =
    "You are a practical home cook. Suggest meals the person can mostly make from what they already have. " +
    "Return ONLY valid JSON, no prose, no fences.";
  const user =
    `Pantry: ${names.join(", ") || "(nearly empty)"}. ` +
    'Suggest up to 5 realistic meals. Return {"meals":[{"name": string, "description": string (max 12 words), ' +
    '"ingredients": [string], "servings": number}]}. Keep ingredient names simple and singular.';
  const out = parseJSON(await callClaude({ system, user }));
  return (out.meals || []).map((m) => ({
    name: String(m.name || "").trim(),
    description: String(m.description || "").trim(),
    ingredients: Array.isArray(m.ingredients) ? m.ingredients.map((x) => String(x).trim()).filter(Boolean) : [],
    servings: Number(m.servings) > 0 ? Number(m.servings) : 2,
  })).filter((m) => m.name);
}

function mealMatch(meal, pantry) {
  const have = pantry.map((p) => norm(p.name));
  let matched = 0;
  for (const ing of meal.ingredients) {
    const n = norm(ing);
    if (have.some((h) => h && (h.includes(n) || n.includes(h)))) matched++;
  }
  const total = meal.ingredients.length || 1;
  return { matched, total, pct: Math.round((matched / total) * 100) };
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

function usePhoto() {
  const inputRef = useRef(null);
  const resolver = useRef(null);
  const node = (
    <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
      onChange={(e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file || !resolver.current) return;
        const reader = new FileReader();
        reader.onload = () => {
          const data = String(reader.result).split(",")[1];
          resolver.current({ data, mediaType: file.type || "image/jpeg" });
          resolver.current = null;
        };
        reader.onerror = () => { resolver.current(null); resolver.current = null; };
        reader.readAsDataURL(file);
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

function ScanTab() {
  const { addOrMerge, notify } = useApp();
  const { node, pick } = usePhoto();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState(null);

  const run = async (mode) => {
    setErr(""); setItems(null);
    const img = await pick();
    if (!img) return;
    setBusy(true);
    try {
      const res = await extractFromImage(img, mode);
      if (!res.items.length) throw new Error("No items found. Try a clearer, well-lit photo.");
      setItems(res.items);
    } catch (e) { setErr(e.message || "Scan failed. Please try again."); }
    finally { setBusy(false); }
  };

  const edit = (idx, k, v) => setItems((s) => s.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  const drop = (idx) => setItems((s) => s.filter((_, i) => i !== idx));
  const commit = () => {
    const n = addOrMerge(items);
    notify(`${n} item${n > 1 ? "s" : ""} added to inventory`);
    setItems(null);
  };

  return (
    <div className="px-4 pt-2 pb-4">
      {node}
      {!items && (
        <>
          <div className="rounded-3xl bg-gradient-to-br from-emerald-700 to-emerald-900 text-white p-6 text-center relative overflow-hidden">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
            <div className="absolute -left-8 -bottom-8 h-28 w-28 rounded-full bg-white/5" />
            <div className="relative">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-white/15 grid place-items-center mb-3"><Camera size={26} /></div>
              <h2 className="text-xl font-bold" style={{ fontFamily: HEAD }}>Fill your inventory instantly</h2>
              <p className="text-emerald-100/90 text-sm mt-1 max-w-xs mx-auto">Point at a receipt or your groceries. Claude reads the items and adds them for you.</p>
            </div>
          </div>
          {err && <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2.5 text-sm text-rose-700"><AlertTriangle size={16} className="mt-0.5" /> {err}</div>}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button disabled={busy} onClick={() => run("receipt")} className="rounded-2xl bg-white ring-1 ring-stone-200 p-5 text-center hover:ring-emerald-300 hover:shadow-sm transition disabled:opacity-50">
              <Receipt size={24} className="mx-auto text-emerald-700 mb-2" />
              <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>Scan receipt</p>
              <p className="text-xs text-stone-400 mt-0.5">All line items at once</p>
            </button>
            <button disabled={busy} onClick={() => run("groceries")} className="rounded-2xl bg-white ring-1 ring-stone-200 p-5 text-center hover:ring-emerald-300 hover:shadow-sm transition disabled:opacity-50">
              <ImagePlus size={24} className="mx-auto text-emerald-700 mb-2" />
              <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>Snap groceries</p>
              <p className="text-xs text-stone-400 mt-0.5">Identify what's in view</p>
            </button>
          </div>
          {busy && (
            <div className="mt-6 flex flex-col items-center gap-2 text-amber-600">
              <Loader2 size={26} className="animate-spin" />
              <p className="text-sm font-semibold">Reading your photo…</p>
            </div>
          )}
        </>
      )}

      {items && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-bold text-stone-800" style={{ fontFamily: HEAD }}>Review {items.length} item{items.length > 1 ? "s" : ""}</h2>
              <p className="text-xs text-stone-500">Tweak anything, then add to your inventory.</p>
            </div>
            <button onClick={() => setItems(null)} className="text-sm font-semibold text-stone-500">Cancel</button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="rounded-2xl bg-white ring-1 ring-stone-200 p-3">
                <div className="flex items-center gap-2">
                  <input value={it.name} onChange={(e) => edit(i, "name", e.target.value)} className="flex-1 font-bold text-stone-800 bg-transparent outline-none border-b border-transparent focus:border-emerald-400" style={{ fontFamily: HEAD }} />
                  <ConfBadge c={it.confidence} />
                  <button onClick={() => drop(i)} className="h-7 w-7 grid place-items-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600"><X size={15} /></button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <select value={it.category} onChange={(e) => edit(i, "category", e.target.value)} className="h-9 px-2 rounded-lg bg-stone-50 ring-1 ring-stone-200 text-sm text-stone-600">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                  <input type="number" min="0" value={it.quantity} onChange={(e) => edit(i, "quantity", Number(e.target.value))} className="h-9 px-2 rounded-lg bg-stone-50 ring-1 ring-stone-200 text-sm text-center" />
                  <input value={it.unit} onChange={(e) => edit(i, "unit", e.target.value)} className="h-9 px-2 rounded-lg bg-stone-50 ring-1 ring-stone-200 text-sm text-center" />
                </div>
              </div>
            ))}
          </div>
          <Btn className="w-full mt-4" onClick={commit}><Plus size={18} /> Add {items.length} to inventory</Btn>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────  Meals tab  ─────────────────────────────── */

function MealsTab() {
  const { pantry, meals, addMeal, removeMeal, toggleFav, scheduleMeal, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [manual, setManual] = useState(false);

  const generate = async () => {
    setErr(""); setBusy(true);
    try { setIdeas(await suggestMeals(pantry)); }
    catch (e) { setErr(e.message || "Couldn't get suggestions."); }
    finally { setBusy(false); }
  };

  const saveIdea = (m, schedule) => {
    addMeal({ ...m, favorite: false, scheduledDate: schedule ? todayISO() : null });
    notify(schedule ? "Added to today's plan" : "Saved to meals");
    setIdeas((s) => s.filter((x) => x.name !== m.name));
  };

  return (
    <div className="px-4 pt-2 pb-4">
      <button onClick={generate} disabled={busy}
        className="w-full rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 text-white p-5 text-left relative overflow-hidden active:scale-[.99] transition disabled:opacity-70">
        <div className="absolute right-4 top-4 opacity-30"><Sparkles size={48} /></div>
        <div className="flex items-center gap-2 font-bold text-lg" style={{ fontFamily: HEAD }}>
          {busy ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />} AI meal suggestions
        </div>
        <p className="text-amber-50/90 text-sm mt-1 max-w-[16rem]">
          {pantry.length ? `Cook from the ${pantry.length} thing${pantry.length > 1 ? "s" : ""} you already have.` : "Add inventory first for tailored ideas."}
        </p>
      </button>
      {err && <div className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-sm text-rose-700"><AlertTriangle size={16} /> {err}</div>}

      {ideas.length > 0 && (
        <div className="mt-5">
          <SectionTitle>Suggested for you</SectionTitle>
          <div className="space-y-2">
            {ideas.map((m, i) => {
              const mm = mealMatch(m, pantry);
              return (
                <div key={i} className="rounded-2xl bg-white ring-1 ring-stone-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>{m.name}</p>
                      <p className="text-sm text-stone-500 mt-0.5">{m.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-bold ${mm.pct >= 70 ? "text-emerald-600" : mm.pct >= 40 ? "text-amber-600" : "text-stone-400"}`}>{mm.pct}%</div>
                      <div className="text-[10px] text-stone-400 uppercase font-bold">have it</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {m.ingredients.map((ing, k) => {
                      const has = pantry.some((p) => { const n = norm(ing), h = norm(p.name); return h && (h.includes(n) || n.includes(h)); });
                      return <span key={k} className={`text-[11px] px-1.5 py-0.5 rounded-md ${has ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-400"}`}>{ing}</span>;
                    })}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Btn size="sm" variant="soft" className="flex-1" onClick={() => saveIdea(m, false)}><Star size={14} /> Save</Btn>
                    <Btn size="sm" className="flex-1" onClick={() => saveIdea(m, true)}><CalendarPlus size={14} /> Plan today</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6">
        <SectionTitle right={<button onClick={() => setManual(true)} className="text-sm font-bold text-emerald-700 flex items-center gap-1"><Plus size={14} /> Add</button>}>Your meals</SectionTitle>
        {meals.length === 0 ? (
          <Empty icon={Utensils} title="No saved meals yet" sub="Generate AI ideas above, or add a meal by hand." />
        ) : (
          <div className="space-y-2">
            {meals.map((m) => {
              const mm = mealMatch(m, pantry);
              return (
                <div key={m.id} className="rounded-2xl bg-white ring-1 ring-stone-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-stone-800" style={{ fontFamily: HEAD }}>{m.name}</p>
                        {m.scheduledDate && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">PLANNED</span>}
                      </div>
                      {m.description && <p className="text-sm text-stone-500 mt-0.5">{m.description}</p>}
                      <p className="text-xs text-stone-400 mt-1">{mm.matched}/{mm.total} ingredients on hand · {m.servings} servings</p>
                    </div>
                    <button onClick={() => toggleFav(m.id)} className={`h-8 w-8 grid place-items-center rounded-lg shrink-0 ${m.favorite ? "text-amber-500" : "text-stone-300 hover:text-stone-400"}`}><Star size={18} fill={m.favorite ? "currentColor" : "none"} /></button>
                  </div>
                  <div className="flex gap-2 mt-3">
                    {!m.scheduledDate
                      ? <Btn size="sm" variant="soft" className="flex-1" onClick={() => { scheduleMeal(m.id, todayISO()); notify("Planned for today"); }}><CalendarPlus size={14} /> Plan today</Btn>
                      : <Btn size="sm" variant="outline" className="flex-1" onClick={() => { scheduleMeal(m.id, null); notify("Moved to ideas"); }}><RotateCcw size={14} /> Unschedule</Btn>}
                    <Btn size="sm" variant="danger" onClick={() => { removeMeal(m.id); notify("Meal deleted"); }}><Trash2 size={14} /></Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Sheet open={manual} onClose={() => setManual(false)} title="Add a meal">
        <ManualMeal onSave={(m) => { addMeal({ ...m, favorite: false, scheduledDate: null }); notify("Meal added"); setManual(false); }} onClose={() => setManual(false)} />
      </Sheet>
    </div>
  );
}

function ManualMeal({ onSave, onClose }) {
  const [f, setF] = useState({ name: "", description: "", ingredients: "", servings: 2 });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <Field label="Meal name"><TextInput value={f.name} onChange={set("name")} placeholder="e.g. Veggie stir-fry" autoFocus /></Field>
      <Field label="Description"><TextInput value={f.description} onChange={set("description")} placeholder="Optional" /></Field>
      <Field label="Ingredients" hint="Comma separated"><TextInput value={f.ingredients} onChange={set("ingredients")} placeholder="rice, egg, onion, soy sauce" /></Field>
      <Field label="Servings"><TextInput type="number" min="1" value={f.servings} onChange={set("servings")} /></Field>
      <div className="flex gap-2 pt-1">
        <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn className="flex-1" disabled={!f.name.trim()} onClick={() => onSave({
          name: f.name.trim(), description: f.description.trim(),
          ingredients: f.ingredients.split(",").map((x) => x.trim()).filter(Boolean),
          servings: Math.max(1, Number(f.servings) || 1),
        })}><Check size={16} /> Add meal</Btn>
      </div>
    </>
  );
}

/* ─────────────────────────────  Planner tab  ──────────────────────────── */

function PlannerTab() {
  const { meals, scheduleMeal, removeMeal, notify } = useApp();
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
          <div className="space-y-4">
            {dates.map((iso) => (
              <div key={iso}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`h-8 w-8 grid place-items-center rounded-lg ${daysUntil(iso) < 0 ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-700"}`}><CalendarClock size={16} /></div>
                  <p className="font-bold text-stone-700" style={{ fontFamily: HEAD }}>{label(iso)}</p>
                </div>
                <div className="space-y-2 pl-2 border-l-2 border-stone-200 ml-4">
                  {groups[iso].map((m) => (
                    <div key={m.id} className="rounded-xl bg-white ring-1 ring-stone-200 p-3 flex items-center gap-3 ml-2">
                      <Utensils size={16} className="text-emerald-600 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-stone-800 truncate">{m.name}</p>
                        <p className="text-xs text-stone-400">{m.servings} servings</p>
                      </div>
                      <button onClick={() => setPicking(m)} className="h-8 w-8 grid place-items-center rounded-lg text-stone-400 hover:bg-stone-100"><CalendarDays size={15} /></button>
                      <button onClick={() => { scheduleMeal(m.id, null); notify("Moved to ideas"); }} className="h-8 w-8 grid place-items-center rounded-lg text-stone-400 hover:bg-stone-100"><RotateCcw size={15} /></button>
                    </div>
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
    const img = await pick();
    if (!img) return;
    setBusy(true);
    try {
      const res = await extractFromImage(img, "receipt");
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

function SettingsSheet({ onClose, notify }) {
  const [key, setKey] = useState(getKey());
  const [model, setModel] = useState(getModel());
  const [show, setShow] = useState(false);
  const save = () => {
    try {
      localStorage.setItem("pp_api_key", key.trim());
      localStorage.setItem("pp_model", (model.trim() || "claude-sonnet-5"));
    } catch (_) {}
    notify("Settings saved");
    onClose();
  };
  return (
    <>
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 text-sm text-amber-800">
        <KeyRound size={16} className="mt-0.5 shrink-0" />
        <span>The scan and meal-suggestion features call the Anthropic API with <b>your own key</b>. It's stored only on this device and sent straight to Anthropic — nothing runs through any other server.</span>
      </div>
      <Field label="Anthropic API key" hint="Starts with sk-ant-…">
        <div className="relative">
          <input className={inputCls + " pr-16 font-mono text-sm"} type={show ? "text" : "password"} value={key}
            onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" />
          <button onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-500 px-2 py-1 rounded hover:bg-stone-100">{show ? "Hide" : "Show"}</button>
        </div>
      </Field>
      <Field label="Model" hint="Change if your account uses a different model id">
        <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-5" />
      </Field>
      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
        className="text-sm font-semibold text-emerald-700 flex items-center gap-1">
        Get an API key <ExternalLink size={13} />
      </a>
      <div className="flex gap-2 pt-1">
        {getKey() && <Btn variant="danger" onClick={() => { try { localStorage.removeItem("pp_api_key"); } catch (_) {} setKey(""); notify("Key removed"); }}>Remove key</Btn>}
        <Btn className="flex-1" onClick={save}><Check size={16} /> Save settings</Btn>
      </div>
      <p className="text-xs text-stone-400 text-center pt-1">Everything else — inventory, trips, meal planning — works fully offline without a key.</p>
    </>
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
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // load once
  useEffect(() => {
    (async () => {
      setPantry(await store.get("pantry", []));
      setMeals(await store.get("meals", []));
      setTrips(await store.get("trips", []));
      setLoaded(true);
    })();
  }, []);
  // persist on change (after load) — this is the shared data layer everything reads from
  useEffect(() => { if (loaded) store.set("pantry", pantry); }, [pantry, loaded]);
  useEffect(() => { if (loaded) store.set("meals", meals); }, [meals, loaded]);
  useEffect(() => { if (loaded) store.set("trips", trips); }, [trips, loaded]);

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
  const scheduleMeal = (id, date) => setMeals((s) => s.map((m) => m.id === id ? { ...m, scheduledDate: date } : m));

  const addTrip = (t) => setTrips((s) => [{ id: uid(), ...t }, ...s]);
  const removeTrip = (id) => setTrips((s) => s.filter((t) => t.id !== id));

  const ctx = {
    pantry, meals, trips, notify,
    addItem, updateItem, adjustQty, removeItem, clearPantry, addOrMerge,
    addMeal, removeMeal, toggleFav, scheduleMeal, addTrip, removeTrip,
  };

  const expiringCount = pantry.filter((i) => i.expiry && daysUntil(i.expiry) <= 3).length;
  const plannedCount = meals.filter((m) => m.scheduledDate && daysUntil(m.scheduledDate) === 0).length;
  const badges = { inventory: expiringCount, planner: plannedCount };

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
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-stone-400">In stock</p>
                <p className="font-bold text-emerald-700 -mt-0.5">{pantry.length}</p>
              </div>
              <button onClick={() => setShowSettings(true)} className="h-9 w-9 grid place-items-center rounded-xl bg-white ring-1 ring-stone-200 text-stone-500 hover:text-stone-700 active:scale-95"><Cog size={18} /></button>
            </div>
          </div>
        </header>

        {/* content */}
        <main className="max-w-md mx-auto">
          {tab === "inventory" && <InventoryTab />}
          {tab === "scan" && <ScanTab />}
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
        <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Settings">
          <SettingsSheet onClose={() => setShowSettings(false)} notify={notify} />
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
