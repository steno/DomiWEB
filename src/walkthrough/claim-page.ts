import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Lead, NicheConfig, PipelineProduct } from "../types/index.js";
import { resolveGithubPagesUrls } from "../config/load.js";
import { menuExists, loadOrCreateMenuData, buildQrSvg } from "../generate/menu.js";
import { relativeEditMenuHref, writeMenuEditorPage, buildClaimMenuEditorMarkup } from "../generate/menu-editor.js";
import { kitExists, siteHtmlExists } from "../generate/review-kit.js";
import { looksSpanish } from "../generate/site.js";
import { buildWhatsAppUrl } from "../outreach/phone.js";
import { dataDir, publicDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";
import type { MenuData } from "../generate/menu.js";

export interface GeneratedClaimPage {
  claimPath: string;
  publicPath: string;
  claimUrl: string | null;
  siteUrl: string | null;
  hasVideo: boolean;
  product: PipelineProduct;
}

export interface ClaimPageOptions {
  product?: PipelineProduct | "auto";
  /** Pre-rendered QR SVG for menu claims (owner print block). */
  qrSvg?: string;
}

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

/** Relative URL from claim/<slug>/ to sites/<slug>/ */
export function relativeSiteHref(slug: string): string {
  return `../../sites/${slug}/index.html`;
}

/** Relative URL from claim/<slug>/ to kits/<slug>/ */
export function relativeKitHref(slug: string): string {
  return `../../kits/${slug}/index.html`;
}

/** Relative URL from claim/<slug>/ to menus/<slug>/ */
export function relativeMenuHref(slug: string): string {
  return `../../menus/${slug}/index.html`;
}

export function resolveClaimProduct(
  lead: Lead,
  preferred: PipelineProduct | "auto" = "auto",
): PipelineProduct {
  const hasSite = siteHtmlExists(lead.slug);
  const hasKit = kitExists(lead.slug);
  const hasMenu = menuExists(lead.slug);
  if (preferred === "reviewKit") {
    if (!hasKit) {
      throw new Error(
        `No hay kit de respuestas para ${lead.slug}. Corre generate-review-kit primero.`,
      );
    }
    return "reviewKit";
  }
  if (preferred === "menu") {
    if (!hasMenu) {
      throw new Error(
        `No hay menú digital para ${lead.slug}. Corre generate-menus primero.`,
      );
    }
    return "menu";
  }
  if (preferred === "site") {
    if (!hasSite && hasMenu) return "menu";
    if (!hasSite && hasKit) return "reviewKit";
    return "site";
  }
  // auto: menu first (restaurant default), then site, then kit
  if (hasMenu) return "menu";
  if (hasSite) return "site";
  if (hasKit) return "reviewKit";
  return "site";
}

/** Niche face-cam video under public/videos/ if present. */
export function resolveFaceCamPublicHref(config: NicheConfig): string | null {
  // Face-cam on claim pages disabled for now — re-enable by removing this early return.
  if (process.env.CLAIM_FACECAM !== "1") return null;

  const file = `facecam-${config.niche.id}.mp4`;
  const pub = join(publicDir("videos"), file);
  const data = join(dataDir("videos"), file);
  if (existsSync(pub) || existsSync(data)) {
    return `../../videos/${file}`;
  }
  return null;
}

function claimOwnerLabel(lead: Lead): string {
  const n = lead.ownerFirstName?.trim();
  if (!n || n.length < 2) return "";
  const lower = n.toLowerCase();
  if (["hola", "hello", "hi", "dueño", "dueno", "owner", "n/a", "na"].includes(lower)) {
    return "";
  }
  return n;
}

function claimMessage(
  lead: Lead,
  claimUrl: string | null,
  product: PipelineProduct,
): string {
  const name = claimOwnerLabel(lead);
  const intro = name
    ? `Hola, soy ${name} de ${lead.place.name}.`
    : `Hola, escribo por ${lead.place.name}.`;
  const want =
    product === "reviewKit"
      ? "Vi las respuestas listas para nuestras reseñas de Google y quiero reclamarlas."
      : product === "menu"
        ? "Vi el menú digital con QR y quiero reclamarlo."
        : "Vi la página con nuestras reseñas de Google y quiero reclamarla.";
  return [
    intro,
    "",
    want,
    claimUrl ? `Link: ${claimUrl}` : "",
    lead.place.phone ? `Tel del negocio: ${lead.place.phone}` : "",
    "",
    "¿Cómo seguimos?",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prefer WhatsApp to CLAIM_WHATSAPP; else mailto CLAIM_INBOX. */
function claimActionHref(
  lead: Lead,
  claimUrl: string | null,
  product: PipelineProduct,
): { href: string; kind: "whatsapp" | "mailto" | "fallback" } {
  const waPhone = process.env.CLAIM_WHATSAPP?.trim();
  if (waPhone) {
    const url = buildWhatsAppUrl(
      waPhone,
      claimMessage(lead, claimUrl, product),
    );
    if (url) return { href: url, kind: "whatsapp" };
  }

  const inbox = process.env.CLAIM_INBOX?.trim();
  if (inbox) {
    const subject = encodeURIComponent(
      product === "reviewKit"
        ? `Quiero reclamar las respuestas de ${lead.place.name}`
        : product === "menu"
          ? `Quiero reclamar el menú de ${lead.place.name}`
          : `Quiero reclamar el sitio de ${lead.place.name}`,
    );
    const body = encodeURIComponent(
      claimMessage(lead, claimUrl, product),
    );
    return {
      href: `mailto:${inbox}?subject=${subject}&body=${body}`,
      kind: "mailto",
    };
  }

  return { href: "#reclamar", kind: "fallback" };
}

/** Fail fast so claim CTAs always reach you. */
export function requireClaimContact(): void {
  if (
    !process.env.CLAIM_WHATSAPP?.trim() &&
    !process.env.CLAIM_INBOX?.trim()
  ) {
    throw new Error(
      "Set CLAIM_WHATSAPP in .env so “Reclamar mi sitio” opens WhatsApp to you (or CLAIM_INBOX as mailto fallback).",
    );
  }
}

/**
 * Claim / walkthrough page:
 * - iframe of the generated site (or review kit) with gentle auto-scroll
 * - optional circular face-cam video bubble
 * - big claim CTA
 * - link to open the live asset
 */
export function buildClaimPageHtml(
  lead: Lead,
  config: NicheConfig,
  opts: ClaimPageOptions = {},
): string {
  const product = resolveClaimProduct(lead, opts.product ?? "auto");
  const urls = resolveGithubPagesUrls(config, lead.slug);
  const previewHref =
    product === "reviewKit"
      ? relativeKitHref(lead.slug)
      : product === "menu"
        ? relativeMenuHref(lead.slug)
        : relativeSiteHref(lead.slug);
  const absolutePreview =
    product === "reviewKit"
      ? (urls.kitUrl ?? previewHref)
      : product === "menu"
        ? (urls.menuUrl ?? previewHref)
        : (urls.siteUrl ?? previewHref);
  const videoHref = resolveFaceCamPublicHref(config);
  const claim = claimActionHref(lead, urls.claimUrl, product);
  const owner = claimOwnerLabel(lead);
  const greeting = owner ? `Hola ${escapeHtml(owner)}` : "Hola";
  const rawQuote = lead.outreachQuote?.trim() || "";
  const quote =
    rawQuote && looksSpanish(rawQuote)
      ? `“${escapeHtml(rawQuote)}”`
      : null;

  const claimHref = claim.href;
  const claimExtra = claim.kind === "fallback" ? `data-fallback="1"` : "";
  const ctaLabel =
    product === "reviewKit"
      ? "Reclamar mis respuestas"
      : product === "menu"
        ? "Reclamar mi menú"
        : "Reclamar mi sitio";
  const openLabel =
    product === "reviewKit"
      ? "Abrir kit completo"
      : product === "menu"
        ? "Ver menú del cliente"
        : "Abrir sitio completo";
  const eyebrow =
    product === "reviewKit"
      ? `Respuestas listas · ${escapeHtml(config.niche.labelSingular)}`
      : product === "menu"
        ? `Menú digital · ${escapeHtml(config.niche.labelSingular)}`
        : `Sitio listo · ${escapeHtml(config.niche.labelSingular)}`;
  const leadCopy =
    product === "reviewKit"
      ? `Armamos respuestas en español para tus reseñas públicas de Google.
      Revísalas en la vista previa.
      Si te sirven, reclámalas — son tuyas.`
      : product === "menu"
        ? `Armamos tu menú digital con categorías y platos de ejemplo.
      Revísalo en la vista previa: editas platos, bajas el QR y tus clientes piden por WhatsApp.
      Al reclamarlo lo publicamos con tu carta.`
        : `Armamos una página con tus reseñas públicas de Google.
      Revísala en la vista previa.
      Si te gusta, reclámala — es tuya.`;
  const footerAsset =
    product === "reviewKit"
      ? "El kit vive en"
      : product === "menu"
        ? "El menú vive en"
        : "El sitio vive en";
  const okHint =
    claim.kind === "whatsapp"
      ? product === "reviewKit"
        ? "Se abre WhatsApp para confirmar — escríbenos ahí y te las pasamos."
        : product === "menu"
          ? "Se abre WhatsApp para confirmar — ahí cerramos y lo dejamos publicado con tu carta."
          : "Se abre WhatsApp para confirmar — escríbenos ahí y te la pasamos."
      : claim.kind === "mailto"
        ? "Revisa tu correo — se abrió un mensaje para confirmar."
        : "Escríbenos por el mismo chat de WhatsApp donde te llegó el enlace para confirmar.";

  const claimTitle =
    product === "reviewKit"
      ? "Reclama tus respuestas"
      : product === "menu"
        ? "Reclama tu menú"
        : "Reclama tu sitio";

  const menuDataForEdit: MenuData | null =
    product === "menu" && menuExists(lead.slug)
      ? loadOrCreateMenuData(lead.slug, config)
      : null;
  const menuEditorMarkup = menuDataForEdit
    ? buildClaimMenuEditorMarkup(lead, menuDataForEdit)
    : "";
  const qrSvg = opts.qrSvg?.trim() ?? "";
  const qrPrintMarkup =
    product === "menu" && qrSvg
      ? `<section class="qr-print" id="qr-permanente" aria-label="Código QR del menú">
  <h2>Tu QR permanente</h2>
  <p>Imprímelo para la mesa o la ventana. Apunta a tu menú digital.</p>
  <div class="qr-frame">${qrSvg}</div>
  <p class="qr-url">${escapeHtml(absolutePreview)}</p>
</section>`
      : "";

  return `<!DOCTYPE html>
<html lang="es-DO">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${claimTitle} · ${escapeHtml(lead.place.name)}</title>
<meta name="robots" content="noindex" />
<style>
:root {
  --bg: #101612;
  --panel: #18211b;
  --ink: #eef3ee;
  --muted: #9aab9e;
  --accent: #7eb887;
  --accent-ink: #0f1a12;
  --line: #2a3830;
  --danger: #c97858;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  color: var(--ink);
  background:
    radial-gradient(ellipse at 10% 0%, #1e3228 0%, transparent 45%),
    radial-gradient(ellipse at 100% 100%, #1a2a22 0%, transparent 40%),
    var(--bg);
}
.shell {
  min-height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
}
.top {
  padding: 1rem 1.15rem 0.75rem;
  border-bottom: 1px solid var(--line);
  background: rgba(16,22,18,0.88);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 5;
}
.eyebrow {
  margin: 0 0 0.35rem;
  font-family: system-ui, sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
h1 {
  margin: 0;
  font-size: clamp(1.35rem, 3.5vw, 1.85rem);
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.lead {
  margin: 0.45rem 0 0;
  color: var(--muted);
  font-size: 0.98rem;
  max-width: 40rem;
}
.quote {
  margin: 0.65rem 0 0;
  color: var(--accent);
  font-style: italic;
  font-size: 0.95rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.9rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.85rem 1.2rem;
  font-family: system-ui, sans-serif;
  font-weight: 700;
  font-size: 1rem;
  text-decoration: none;
  border: 0;
  cursor: pointer;
}
.btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
}
.btn-ghost {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
}
.stage {
  position: relative;
  min-height: 62vh;
  background: #0a0e0b;
}
.stage iframe {
  width: 100%;
  height: min(78vh, 920px);
  border: 0;
  background: #fff;
  display: block;
}
.face-dock {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  width: min(34vw, 180px);
}
.bubble {
  position: relative;
  width: min(28vw, 168px);
  height: min(28vw, 168px);
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid rgba(238,243,238,0.85);
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  background: #1a2420;
  cursor: pointer;
}
.bubble video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.audio-btn {
  width: 100%;
  border: 0;
  border-radius: 999px;
  padding: 0.7rem 0.85rem;
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  background: var(--accent);
  color: var(--accent-ink);
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.audio-btn.hidden { display: none; }
.audio-btn.is-on {
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--line);
}
.bubble-placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 0.75rem;
  font-family: system-ui, sans-serif;
  font-size: 0.72rem;
  color: var(--muted);
  line-height: 1.35;
}
.bottom {
  padding: 1rem 1.15rem 1.4rem;
  border-top: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  align-items: center;
  justify-content: space-between;
  background: var(--panel);
}
.bottom p {
  margin: 0;
  color: var(--muted);
  font-family: system-ui, sans-serif;
  font-size: 0.82rem;
  max-width: 36rem;
}
#panel-ok {
  display: none;
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
  background: #1e2e24;
  border: 1px solid var(--line);
  font-family: system-ui, sans-serif;
  font-size: 0.92rem;
}
#panel-ok.visible { display: block; }
@media (max-width: 640px) {
  .face-dock {
    right: 0.65rem;
    bottom: 0.65rem;
    width: 132px;
  }
  .bubble {
    width: 112px;
    height: 112px;
  }
  .audio-btn { font-size: 0.78rem; padding: 0.65rem 0.7rem; }
  .stage iframe { height: 58vh; }
}
.qr-print {
  margin: 0;
  padding: 1.5rem 1.15rem;
  border-top: 1px solid var(--line);
  background: #eef3ee;
  color: #0f1a12;
  text-align: center;
}
.qr-print h2 {
  margin: 0 0 0.35rem;
  font-size: clamp(1.35rem, 3.5vw, 1.65rem);
  letter-spacing: -0.02em;
}
.qr-print > p {
  margin: 0 0 1rem;
  font-family: system-ui, sans-serif;
  font-size: 0.9rem;
  color: #3a4a3e;
  max-width: 28rem;
  margin-left: auto;
  margin-right: auto;
}
.qr-print .qr-frame {
  display: inline-flex;
  padding: 0.65rem;
  background: #fff;
  border: 1px solid #c5d4c8;
}
.qr-print .qr-frame svg { display: block; width: 180px; height: 180px; }
.qr-print .qr-url {
  margin: 0.85rem 0 0;
  font-family: system-ui, sans-serif;
  font-size: 0.72rem;
  word-break: break-all;
  color: #4a5c50;
}
body.menu-editing .qr-print { display: none; }
</style>
</head>
<body>
<div class="shell">
  <header class="top">
    <p class="eyebrow">${eyebrow}</p>
    <h1>${greeting}, esto es para ${escapeHtml(lead.place.name)}</h1>
    <p class="lead">
      ${leadCopy}
    </p>
    ${quote ? `<p class="quote">${quote}</p>` : ""}
    <div class="actions">
      <a class="btn btn-primary" id="btn-claim" href="${escapeAttr(claimHref)}" ${claimExtra}>${ctaLabel}</a>
      ${
        product === "menu"
          ? `<a class="btn btn-ghost" href="${escapeAttr(relativeEditMenuHref(lead.slug))}">Editar mis platos</a>`
          : ""
      }
      <a class="btn btn-ghost" href="${escapeAttr(previewHref)}" target="_blank" rel="noopener">${openLabel}</a>
    </div>
    <div id="panel-ok" role="status">
      Gracias. Anotamos tu interés en <strong>${escapeHtml(lead.place.name)}</strong>.
      ${okHint}
    </div>
  </header>

  <section class="stage" aria-label="Vista previa">
    <iframe id="site-frame" title="${escapeAttr(lead.place.name)}" src="${escapeAttr(previewHref)}" loading="eager"></iframe>
    ${
      videoHref
        ? `<div class="face-dock">
      <div class="bubble" id="face-bubble" title="Escuchar" role="button" tabindex="0">
        <video id="face-video" src="${escapeAttr(videoHref)}" autoplay muted loop playsinline preload="auto"></video>
      </div>
      <button type="button" class="audio-btn" id="unmute-btn">Escuchar</button>
    </div>`
        : ""
    }
  </section>

  ${qrPrintMarkup}

  <footer class="bottom">
    <p>
      Vista previa honesta a partir de reseñas públicas de Google.
      No inventamos datos. ${footerAsset}
      <a href="${escapeAttr(absolutePreview)}" style="color:var(--accent)">${escapeHtml(absolutePreview)}</a>
    </p>
    <a class="btn btn-primary" href="${escapeAttr(claimHref)}" ${claimExtra}>${ctaLabel}</a>
  </footer>
</div>
${menuEditorMarkup}
<script>
(function () {
  var frame = document.getElementById("site-frame");
  var ok = document.getElementById("panel-ok");
  var buttons = document.querySelectorAll("[data-fallback], #btn-claim");

  function markClaimed() {
    try { localStorage.setItem("domiweb-claim-${escapeAttr(lead.slug)}", "1"); } catch (e) {}
    if (ok) ok.classList.add("visible");
  }

  // Only show the Gracias bar right after they click Reclamar — not on page load.
  // Restoring from localStorage made return/first-look visits look like WhatsApp was opening.

  buttons.forEach(function (btn) {
    btn.addEventListener("click", function (ev) {
      if (btn.getAttribute("data-fallback") === "1") {
        ev.preventDefault();
        markClaimed();
        var el = document.getElementById("panel-ok");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        markClaimed();
      }
    });
  });

  function startScroll() {
    try {
      var doc = frame.contentWindow && frame.contentWindow.document;
      if (!doc || !doc.documentElement) return;
      var max = Math.max(0, (doc.documentElement.scrollHeight || 0) - (frame.contentWindow.innerHeight || 0));
      if (max < 40) return;
      var y = 0;
      var dir = 1;
      setInterval(function () {
        y += dir * 1.15;
        if (y >= max) { y = max; dir = -1; }
        if (y <= 0) { y = 0; dir = 1; }
        frame.contentWindow.scrollTo(0, y);
      }, 32);
    } catch (err) {
      /* file:// or blocked — preview still works without scroll */
    }
  }

  frame.addEventListener("load", function () {
    setTimeout(startScroll, 700);
  });

  var vid = document.getElementById("face-video");
  var unmute = document.getElementById("unmute-btn");
  var bubble = document.getElementById("face-bubble");
  var audioOn = false;
  var startedWithSound = false;

  function syncLabels() {
    if (unmute) {
      unmute.classList.remove("hidden");
      unmute.textContent = audioOn ? "Silenciar" : "Escuchar";
      unmute.classList.toggle("is-on", audioOn);
    }
    if (bubble) {
      bubble.title = audioOn ? "Silenciar" : "Escuchar";
    }
  }

  function playFromStartWithSound() {
    if (!vid) return;
    startedWithSound = true;
    audioOn = true;
    vid.muted = false;
    vid.volume = 1;
    vid.loop = false;
    try { vid.currentTime = 0; } catch (e) {}
    var p = vid.play();
    if (p && p.then) p.catch(function () {});
    syncLabels();
  }

  function muteAudio() {
    if (!vid) return;
    audioOn = false;
    vid.muted = true;
    syncLabels();
  }

  function toggleAudio(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (audioOn) {
      muteAudio();
      return;
    }
    // Best practice for a pitch clip: first listen starts at 0 with sound.
    playFromStartWithSound();
  }

  if (unmute) unmute.addEventListener("click", toggleAudio);
  if (bubble) {
    bubble.addEventListener("click", toggleAudio);
    bubble.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") toggleAudio(ev);
    });
  }

  // Muted autoplay preview only — browsers block sound without a click.
  if (vid) {
    vid.muted = true;
    vid.loop = true;
    vid.play().catch(function () {});
  }
  syncLabels();
})();
</script>
</body>
</html>`;
}

export async function writeClaimPage(
  lead: Lead,
  config: NicheConfig,
  opts: ClaimPageOptions = {},
): Promise<GeneratedClaimPage> {
  const product = resolveClaimProduct(lead, opts.product ?? "auto");
  const urls = resolveGithubPagesUrls(config, lead.slug);
  let qrSvg = opts.qrSvg;
  if (product === "menu" && !qrSvg) {
    const menuUrl =
      urls.menuUrl ?? `https://steno.github.io/DomiWEB/menus/${lead.slug}/`;
    qrSvg = await buildQrSvg(menuUrl);
  }
  const html = buildClaimPageHtml(lead, config, { product, qrSvg });
  const claimPath = join(dataDir("walkthroughs"), lead.slug, "index.html");
  const publicPath = join(publicDir("claim"), lead.slug, "index.html");
  mkdirSync(dirname(claimPath), { recursive: true });
  mkdirSync(dirname(publicPath), { recursive: true });
  writeFileSync(claimPath, html, "utf8");
  writeFileSync(publicPath, html, "utf8");

  if (product === "menu" && menuExists(lead.slug)) {
    const menuData = loadOrCreateMenuData(lead.slug, config);
    writeMenuEditorPage(lead, config, menuData);
  }

  // Ensure videos dir exists on Pages for when face-cam lands
  mkdirSync(publicDir("videos"), { recursive: true });

  return {
    claimPath,
    publicPath,
    claimUrl: urls.claimUrl,
    siteUrl:
      product === "reviewKit"
        ? urls.kitUrl
        : product === "menu"
          ? urls.menuUrl
          : urls.siteUrl,
    hasVideo: Boolean(resolveFaceCamPublicHref(config)),
    product,
  };
}

export async function generateClaimPagesForLeads(
  leads: Lead[],
  config: NicheConfig,
  opts: {
    limit?: number;
    requireContact?: boolean;
    product?: PipelineProduct | "auto";
  } = {},
): Promise<Array<{ lead: Lead; claim: GeneratedClaimPage }>> {
  if (opts.requireContact !== false) {
    requireClaimContact();
  }
  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const out: Array<{ lead: Lead; claim: GeneratedClaimPage }> = [];
  for (const lead of batch) {
    log.info(`Claim · ${lead.place.name} (${lead.slug})`);
    try {
      const claim = await writeClaimPage(lead, config, {
        product: opts.product ?? "auto",
      });
      log.ok(
        `  → ${claim.product} · ${claim.publicPath}${claim.claimUrl ? ` · ${claim.claimUrl}` : ""}`,
      );
      out.push({ lead, claim });
    } catch (err) {
      log.error(
        `  ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
}
