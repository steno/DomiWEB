import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import QRCode from "qrcode";
import type { Lead, NicheConfig } from "../types/index.js";
import { resolveGithubPagesUrls } from "../config/load.js";
import { pickOutreachQuote } from "./site.js";
import { buildWhatsAppUrl, toWhatsAppDigits } from "../outreach/phone.js";
import { dataDir, publicDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";
export interface MenuItem {
  name: string;
  note: string;
  priceHint: string;
}

export interface MenuCategory {
  id: string;
  label: string;
  items: MenuItem[];
}

/** Per-lead menu source of truth (data + public mirrors). */
export interface MenuData {
  slug: string;
  owned: boolean;
  updatedAt: string;
  categories: MenuCategory[];
  source?: "template" | "owner-draft";
}

export interface GeneratedMenu {
  html: string;
  menuPath: string;
  publicPath: string;
  outreachQuote: string | null;
  menuUrl: string | null;
  menuData: MenuData;
}

const DEFAULT_CATEGORIES: MenuCategory[] = [
  {
    id: "entradas",
    label: "Entradas",
    items: [
      { name: "Tostones", note: "Con salsa de ajo", priceHint: "RD$ —" },
      { name: "Empanaditas", note: "Pollo o queso", priceHint: "RD$ —" },
      { name: "Ensalada de la casa", note: "Fresca del día", priceHint: "RD$ —" },
    ],
  },
  {
    id: "fuertes",
    label: "Platos fuertes",
    items: [
      { name: "Bandera dominicana", note: "Arroz, habichuelas y carne", priceHint: "RD$ —" },
      { name: "Pollo guisado", note: "Con acompañamiento", priceHint: "RD$ —" },
      { name: "Pescado frito", note: "Según disponibilidad", priceHint: "RD$ —" },
      { name: "Mofongo", note: "Con chicharrón o camarones", priceHint: "RD$ —" },
    ],
  },
  {
    id: "bebidas",
    label: "Bebidas",
    items: [
      { name: "Jugo natural", note: "Pregunta el sabor del día", priceHint: "RD$ —" },
      { name: "Refresco", note: "Lata o vaso", priceHint: "RD$ —" },
      { name: "Cerveza", note: "Nacional", priceHint: "RD$ —" },
      { name: "Café", note: "Dominicano", priceHint: "RD$ —" },
    ],
  },
  {
    id: "postres",
    label: "Postres",
    items: [
      { name: "Flan", note: "Casero", priceHint: "RD$ —" },
      { name: "Dulce de leche", note: "Porción", priceHint: "RD$ —" },
    ],
  },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function isUsablePhotoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com")) return false;
    if (host === "localhost" || host === "127.0.0.1") return false;
    return true;
  } catch {
    return false;
  }
}

export function resolveCategoriesFromConfig(config: NicheConfig): MenuCategory[] {
  const custom = config.products?.menu?.categories;
  if (custom?.length) {
    return custom.map((c) => ({
      id: c.id,
      label: c.label,
      items: (c.items ?? []).map((it) => ({
        name: it.name,
        note: it.note ?? "",
        priceHint: it.priceHint ?? "RD$ —",
      })),
    }));
  }
  return DEFAULT_CATEGORIES.map((c) => ({
    ...c,
    items: c.items.map((it) => ({ ...it })),
  }));
}

export function menuDataPath(slug: string): string {
  return join(dataDir("menus"), slug, "menu.json");
}

export function publicMenuDataPath(slug: string): string {
  return join(publicDir("menus"), slug, "menu.json");
}

export function menuExists(slug: string): boolean {
  return existsSync(join(publicDir("menus"), slug, "index.html"));
}

export function readMenuData(slug: string): MenuData | null {
  const path = existsSync(menuDataPath(slug))
    ? menuDataPath(slug)
    : existsSync(publicMenuDataPath(slug))
      ? publicMenuDataPath(slug)
      : null;
  if (!path) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as MenuData;
    if (!raw?.slug || !Array.isArray(raw.categories)) return null;
    return {
      slug: raw.slug,
      owned: Boolean(raw.owned),
      updatedAt: raw.updatedAt || new Date().toISOString(),
      categories: raw.categories,
      source: raw.source,
    };
  } catch {
    return null;
  }
}

export function writeMenuData(data: MenuData): void {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const dataPath = menuDataPath(data.slug);
  const pubPath = publicMenuDataPath(data.slug);
  mkdirSync(dirname(dataPath), { recursive: true });
  mkdirSync(dirname(pubPath), { recursive: true });
  writeFileSync(dataPath, json, "utf8");
  writeFileSync(pubPath, json, "utf8");
}

export function defaultMenuData(slug: string, config: NicheConfig): MenuData {
  return {
    slug,
    owned: false,
    updatedAt: new Date().toISOString(),
    categories: resolveCategoriesFromConfig(config),
    source: "template",
  };
}

/** Prefer existing per-lead JSON; otherwise seed a template. */
export function loadOrCreateMenuData(
  slug: string,
  config: NicheConfig,
): MenuData {
  const existing = readMenuData(slug);
  if (existing) return existing;
  const data = defaultMenuData(slug, config);
  writeMenuData(data);
  return data;
}

export function isMenuOwned(slug: string): boolean {
  return readMenuData(slug)?.owned === true;
}

export function resolveMenuUrl(
  config: NicheConfig,
  slug: string,
): string | null {
  return resolveGithubPagesUrls(config, slug).menuUrl;
}

export async function buildQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 220,
    color: { dark: "#1a1208", light: "#00000000" },
  });
}

export function buildMenuHtml(
  lead: Lead,
  config: NicheConfig,
  opts: {
    menuUrl: string;
    categories: MenuCategory[];
    owned: boolean;
    menuData: MenuData;
  },
): string {
  const p = lead.place;
  const categories = opts.categories;
  const owned = opts.owned;

  const googlePhotos = p.photos
    .map((ph) => ph.url)
    .filter(isUsablePhotoUrl)
    .slice(0, 5);

  const illustrative = (config.niche.illustrativeImages ?? []).map((rel) => {
    const clean = rel.replace(/^\/+/, "");
    return `../../${clean}`;
  });

  const usingIllustrative = googlePhotos.length === 0 && illustrative.length > 0;
  const photos = googlePhotos.length ? googlePhotos : illustrative;
  const heroPhoto = photos[0] ?? null;

  const honestyBase = usingIllustrative
    ? "Las reseñas provienen de nuestro perfil público de Google · Las fotografías son ilustrativas"
    : googlePhotos.length
      ? "Las reseñas y fotografías provienen de nuestro perfil público de Google · Algunas imágenes pueden ser ilustrativas"
      : "Las reseñas provienen de nuestro perfil público de Google · Las fotografías son ilustrativas";
  const footerHtml =
    escapeHtml(honestyBase) +
    (owned ? "" : " · Algunos platos y precios pueden ser de ejemplo");

  const waDigits = toWhatsAppDigits(p.phone);
  const waOrder = p.phone
    ? buildWhatsAppUrl(
        p.phone,
        `Hola, vi el menú digital de ${p.name} y quiero ordenar.`,
      )
    : null;

  const categoryBlocks = categories
    .map((cat) => {
      const items = cat.items
        .map((it) => {
          const label = [it.name, it.note].filter(Boolean).join(" — ");
          return `<li class="item">
  <label class="pick">
    <input type="checkbox" class="pick-cb"
      data-name="${escapeAttr(it.name)}"
      data-note="${escapeAttr(it.note)}"
      data-price="${escapeAttr(it.priceHint)}"
      data-cat="${escapeAttr(cat.label)}"
      aria-label="Agregar ${escapeAttr(label)}" />
    <span class="pick-box" aria-hidden="true"></span>
    <span class="item-main">
      <span class="item-name">${escapeHtml(it.name)}</span>
      ${it.note ? `<span class="item-note">${escapeHtml(it.note)}</span>` : ""}
    </span>
    <span class="item-price">${escapeHtml(it.priceHint)}</span>
  </label>
</li>`;
        })
        .join("\n");
      return `<section class="cat" id="${escapeAttr(cat.id)}">
  <h2>${escapeHtml(cat.label)}</h2>
  <ul class="items">${items}</ul>
</section>`;
    })
    .join("\n");

  const ratingBits: string[] = [];
  if (p.rating != null) ratingBits.push(`${p.rating}★ Google`);
  if (p.reviewCount != null) ratingBits.push(`${p.reviewCount} reseñas`);
  const placeLine = [p.category ?? config.niche.labelSingular, p.address ?? p.city]
    .filter(Boolean)
    .map((s) => escapeHtml(String(s)))
    .join(" · ");

  const heroStyle = heroPhoto
    ? `style="--hero-image:url('${escapeAttr(heroPhoto)}')"`
    : "";

  const cta = waOrder
    ? `<a class="btn" href="${escapeAttr(waOrder)}">WhatsApp del local</a>`
    : p.phone
      ? `<a class="btn" href="tel:${escapeAttr(p.phone.replace(/[^\d+]/g, ""))}">Llamar</a>`
      : "";

  return `<!DOCTYPE html>
<html lang="es-DO">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Menú · ${escapeHtml(p.name)}</title>
<style>
:root {
  --bg: #140f0a;
  --ink: #f7f1e8;
  --muted: #b7a894;
  --accent: #e2a45a;
  --panel: #1c1610;
  --line: rgba(226, 164, 90, 0.28);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  background: var(--bg);
  line-height: 1.45;
}
.hero {
  position: relative;
  min-height: 72vh;
  min-height: 72svh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: clamp(1.4rem, 4vh, 2.2rem) 1.15rem 1.5rem;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(20,15,10,0.2) 0%, rgba(20,15,10,0.55) 48%, rgba(20,15,10,0.96) 100%),
    linear-gradient(135deg, #2a1c12, #140f0a 55%, #24180f);
}
.hero.has-photo {
  background-image:
    linear-gradient(180deg, rgba(20,15,10,0.12) 0%, rgba(20,15,10,0.42) 42%, rgba(20,15,10,0.95) 100%),
    var(--hero-image);
  background-size: cover, cover;
  background-position: center, center;
}
.hero-inner { position: relative; z-index: 1; max-width: 40rem; }
.kicker {
  margin: 0 0 0.55rem;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
}
.brand {
  margin: 0;
  font-size: clamp(2.6rem, 11vw, 4.4rem);
  line-height: 0.94;
  letter-spacing: -0.03em;
  font-weight: 700;
  text-wrap: balance;
  text-shadow: 0 12px 36px rgba(0,0,0,0.45);
}
.sub {
  margin: 0.75rem 0 0;
  color: #e8dccb;
  font-size: clamp(1rem, 2.6vw, 1.15rem);
}
.meta {
  margin: 0.7rem 0 0;
  color: var(--accent);
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.92rem;
}
.cta-row {
  margin: 1.15rem 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  align-items: center;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: #1a1208;
  text-decoration: none;
  padding: 0.9rem 1.2rem;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-weight: 800;
  font-size: 0.98rem;
}
.photo-note {
  margin: 0.8rem 0 0;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.72rem;
  color: rgba(247,241,232,0.72);
}
.wrap { max-width: 40rem; margin: 0 auto; padding: 1.75rem 1.15rem 3rem; }
.cat { margin: 0 0 1.85rem; }
.cat h2 {
  margin: 0 0 0.85rem;
  font-size: clamp(1.35rem, 3.5vw, 1.7rem);
  letter-spacing: -0.02em;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.45rem;
}
.items { list-style: none; margin: 0; padding: 0; }
.item {
  padding: 0;
  border-bottom: 1px solid rgba(226,164,90,0.12);
}
.pick {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: start;
  padding: 0.85rem 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.pick:active {
  background: rgba(226,164,90,0.06);
}
.pick-cb {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  pointer-events: none;
}
.pick-box {
  width: 1.15rem;
  height: 1.15rem;
  margin-top: 0.2rem;
  border: 1.5px solid rgba(226,164,90,0.55);
  display: block;
  flex-shrink: 0;
  background: transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.pick-cb:checked + .pick-box {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: inset 0 0 0 2px #140f0a;
}
.pick:has(.pick-cb:focus-visible) .pick-box {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.item-main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.item-name {
  font-size: 1.08rem;
  font-weight: 650;
}
.item-note {
  color: var(--muted);
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.82rem;
}
.item-price {
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-weight: 700;
  color: var(--accent);
  white-space: nowrap;
  padding-top: 0.15rem;
}
.order-hint {
  margin: 0 0 1.25rem;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.88rem;
  color: var(--muted);
}
.order-bar {
  display: none;
  position: fixed;
  left: 0; right: 0; bottom: 0;
  padding: 0.85rem 1.15rem calc(0.85rem + env(safe-area-inset-bottom));
  background: rgba(20,15,10,0.94);
  border-top: 1px solid var(--line);
  gap: 0.65rem;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  backdrop-filter: blur(8px);
  z-index: 15;
}
.order-bar.visible { display: flex; }
.order-bar .order-count {
  margin: 0;
  width: 100%;
  text-align: center;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.85rem;
  color: var(--accent);
}
.order-bar .btn {
  border: none;
  cursor: pointer;
}
.order-bar .btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
body.has-order .wrap { padding-bottom: 5.5rem; }
footer {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  font-size: 0.75rem;
}
</style>
</head>
<body>
  <header class="hero${heroPhoto ? " has-photo" : ""}" ${heroStyle}>
    <div class="hero-inner">
      <p class="kicker">Menú digital</p>
      <h1 class="brand">${escapeHtml(p.name)}</h1>
      <p class="sub">${placeLine}</p>
      ${ratingBits.length ? `<p class="meta">${escapeHtml(ratingBits.join(" · "))}</p>` : ""}
      <div class="cta-row">${cta}</div>
      ${usingIllustrative ? `<p class="photo-note">Imagen ilustrativa · no es una foto del local</p>` : ""}
    </div>
  </header>
  <main class="wrap">
    ${
      waDigits
        ? `<p class="order-hint">Marca lo que quieres y envía el pedido por WhatsApp.</p>`
        : ""
    }
    <div id="menu-list">
    ${categoryBlocks}
    </div>
    <footer><p>${footerHtml}</p></footer>
  </main>
  <div class="order-bar" id="order-bar" hidden>
    <p class="order-count" id="order-count">0 platos seleccionados</p>
    <button type="button" class="btn" id="btn-send-order"${waDigits ? "" : " disabled"}>Enviar pedido por WhatsApp</button>
  </div>
  ${buildOrderPickerScript(p.name, waDigits)}
</body>
</html>`;
}

function escapeJsString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function buildOrderPickerScript(
  businessName: string,
  waDigits: string | null,
): string {
  return `<script>
(function () {
  var WA_DIGITS = ${waDigits ? `'${escapeJsString(waDigits)}'` : "null"};
  var NAME = '${escapeJsString(businessName)}';
  var bar = document.getElementById('order-bar');
  var countEl = document.getElementById('order-count');
  var sendBtn = document.getElementById('btn-send-order');
  if (!bar || !sendBtn) return;

  function selected() {
    return Array.prototype.slice.call(document.querySelectorAll('.pick-cb:checked'));
  }

  function refresh() {
    var items = selected();
    var n = items.length;
    if (countEl) {
      countEl.textContent = n === 1 ? '1 plato seleccionado' : n + ' platos seleccionados';
    }
    if (n > 0) {
      bar.hidden = false;
      bar.classList.add('visible');
      document.body.classList.add('has-order');
      sendBtn.disabled = !WA_DIGITS;
    } else {
      bar.classList.remove('visible');
      bar.hidden = true;
      document.body.classList.remove('has-order');
    }
  }

  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.classList && ev.target.classList.contains('pick-cb')) {
      refresh();
    }
  });

  sendBtn.addEventListener('click', function () {
    if (!WA_DIGITS) return;
    var items = selected();
    if (!items.length) return;
    var lines = ['Hola, quiero pedir en ' + NAME + ':', ''];
    var byCat = {};
    items.forEach(function (cb) {
      var cat = cb.getAttribute('data-cat') || 'Pedido';
      if (!byCat[cat]) byCat[cat] = [];
      var name = cb.getAttribute('data-name') || '';
      var note = cb.getAttribute('data-note') || '';
      var price = cb.getAttribute('data-price') || '';
      var line = '• ' + name;
      if (note) line += ' (' + note + ')';
      if (price && price !== 'RD$ —') line += ' — ' + price;
      byCat[cat].push(line);
    });
    Object.keys(byCat).forEach(function (cat) {
      lines.push(cat + ':');
      byCat[cat].forEach(function (l) { lines.push(l); });
      lines.push('');
    });
    lines.push('Gracias.');
    var href = 'https://wa.me/' + WA_DIGITS + '?text=' + encodeURIComponent(lines.join('\\n'));
    window.open(href, '_blank', 'noopener');
  });

  refresh();
})();
</script>`;
}

function writeMenuFiles(slug: string, html: string): {
  menuPath: string;
  publicPath: string;
} {
  const menuPath = join(dataDir("menus"), slug, "index.html");
  const publicPath = join(publicDir("menus"), slug, "index.html");
  mkdirSync(dirname(menuPath), { recursive: true });
  mkdirSync(dirname(publicPath), { recursive: true });
  writeFileSync(menuPath, html, "utf8");
  writeFileSync(publicPath, html, "utf8");
  return { menuPath, publicPath };
}

export async function generateMenuForLead(
  lead: Lead,
  config: NicheConfig,
): Promise<GeneratedMenu> {
  const urls = resolveGithubPagesUrls(config, lead.slug);
  const menuUrl =
    urls.menuUrl ??
    `https://steno.github.io/DomiWEB/menus/${lead.slug}/`;
  const menuData = loadOrCreateMenuData(lead.slug, config);
  writeMenuData(menuData);
  const html = buildMenuHtml(lead, config, {
    menuUrl,
    categories: menuData.categories,
    owned: menuData.owned,
    menuData,
  });
  const { menuPath, publicPath } = writeMenuFiles(lead.slug, html);
  return {
    html,
    menuPath,
    publicPath,
    outreachQuote: pickOutreachQuote(lead.place.reviews),
    menuUrl: urls.menuUrl,
    menuData,
  };
}

export async function generateMenusForLeads(
  leads: Lead[],
  config: NicheConfig,
  opts: { limit?: number } = {},
): Promise<Array<{ lead: Lead; menu: GeneratedMenu }>> {
  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const out: Array<{ lead: Lead; menu: GeneratedMenu }> = [];

  for (const lead of batch) {
    log.info(`Menú · ${lead.place.name} (${lead.slug})`);
    const menu = await generateMenuForLead(lead, config);
    log.ok(
      `  → ${menu.publicPath}${menu.menuUrl ? ` · ${menu.menuUrl}` : ""}${menu.menuData.owned ? " · owned" : ""}`,
    );
    out.push({ lead, menu });
  }

  return out;
}
