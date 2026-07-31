import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getOpenAI, openAiSiteModel } from "../ai/openai.js";
import type { Lead, NicheConfig, Review, ScrapedPlace } from "../types/index.js";
import { resolveGithubPagesUrls } from "../config/load.js";
import { dataDir, promptsDir, publicDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";

export interface GeneratedSite {
  html: string;
  sitePath: string;
  publicPath: string;
  outreachQuote: string | null;
  usedFallback: boolean;
}

function siteModel(): string {
  return openAiSiteModel();
}

function loadPrompt(): string {
  return readFileSync(promptsDir("site-generation.md"), "utf8");
}

/** Compact payload for the model — facts only, no pipeline internals. */
export function buildBusinessPayload(lead: Lead, config: NicheConfig) {
  const p = lead.place;
  const reviews = p.reviews
    .filter((r) => r.text.trim().length > 12)
    .slice(0, 12)
    .map((r) => ({
      author: r.author,
      rating: r.rating,
      text: r.text.trim().slice(0, 400),
      date: r.publishedAt,
    }));

  return {
    name: p.name,
    category: p.category,
    categories: p.categories,
    address: p.address,
    city: p.city,
    phone: p.phone,
    rating: p.rating,
    reviewCount: p.reviewCount,
    photos: p.photos.slice(0, 8).map((ph) => ph.url),
    reviews,
    niche: config.niche.labelSingular,
    language: config.language,
    country: config.countryName,
  };
}

export function pickOutreachQuote(reviews: Review[]): string | null {
  const scored = reviews
    .filter((r) => r.text.trim().length >= 20 && r.rating >= 4)
    .map((r) => {
      const t = r.text.trim().replace(/\s+/g, " ");
      return { t, score: Math.min(t.length, 120) + r.rating * 5 };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  let quote = scored[0]!.t;
  if (quote.length > 140) quote = `${quote.slice(0, 137).trim()}…`;
  return quote;
}

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return s.trim();
}

/** Soft validation — honesty + technical fences. */
export function validateGeneratedHtml(
  html: string,
  place: ScrapedPlace,
): string[] {
  const errors: string[] = [];
  const lower = html.toLowerCase();

  if (!lower.includes("<!doctype html>")) {
    errors.push("Falta <!DOCTYPE html>");
  }
  if (/<script[\s>]/i.test(html)) {
    errors.push("Contiene <script> (prohibido)");
  }
  if (/https?:\/\/fonts\.googleapis/i.test(html) || /cdn\./i.test(html)) {
    errors.push("Dependencia externa detectada");
  }
  if (!place.name || !html.includes(place.name)) {
    errors.push("Nombre del negocio no aparece en el HTML");
  }
  if (place.phone) {
    const digits = place.phone.replace(/\D/g, "");
    if (digits.length >= 7 && !html.replace(/\D/g, "").includes(digits.slice(-7))) {
      // soft: tel link may format differently — check tel: presence
      if (!/tel:/i.test(html)) {
        errors.push("Hay teléfono pero no hay enlace tel:");
      }
    }
  }
  if (!/reseñas provienen|reseñas y fotografías provienen/i.test(html)) {
    errors.push("Falta el footer de atribución de reseñas");
  }
  if (/años de experiencia|premio|certificad|licencia #|fundad[oa] en \d{4}/i.test(html)) {
    errors.push("Posible hecho inventado (años/premios/licencias)");
  }

  return errors;
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

function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
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

/**
 * Crafted honest template — primary generator (better than gpt-4o-mini for local DR shops).
 * Only real facts + verbatim quotes. No invented services/years/awards.
 */
export function fallbackSiteHtml(lead: Lead, config: NicheConfig): string {
  const p = lead.place;
  const quotes = p.reviews
    .filter((r) => r.text.trim().length > 15)
    .slice(0, 5);

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
  const footer = usingIllustrative
    ? "Las reseñas provienen de nuestro perfil público de Google · Las fotografías son ilustrativas"
    : googlePhotos.length
      ? "Las reseñas y fotografías provienen de nuestro perfil público de Google · Algunas imágenes pueden ser ilustrativas"
      : "Las reseñas provienen de nuestro perfil público de Google · Las fotografías son ilustrativas";

  const heroPhoto = photos[0] ?? null;
  const gallery = photos.slice(1);

  const quoteBlocks = quotes
    .map(
      (r) => `
      <figure class="quote">
        <blockquote>“${escapeHtml(r.text.trim().slice(0, 280))}”</blockquote>
        <figcaption>— ${escapeHtml(r.author)}${r.rating ? ` · ${r.rating}★` : ""}</figcaption>
      </figure>`,
    )
    .join("\n");

  const galleryBlocks = gallery
    .map(
      (url) =>
        `<figure class="shot"><img src="${escapeHtml(url)}" alt="${escapeHtml(p.name)}" loading="lazy" width="800" height="500" />${usingIllustrative ? "<figcaption>Ilustrativa</figcaption>" : ""}</figure>`,
    )
    .join("\n");

  const phoneBlock = p.phone
    ? `<p class="cta"><a class="btn" href="${telHref(p.phone)}">Llamar ahora</a>
       <span class="phone-hint">${escapeHtml(p.phone)}</span></p>`
    : "";

  const ratingBits: string[] = [];
  if (p.rating != null) ratingBits.push(`${p.rating}★ en Google`);
  if (p.reviewCount != null) ratingBits.push(`${p.reviewCount} reseñas`);
  const ratingLine = ratingBits.length
    ? `<p class="meta">${escapeHtml(ratingBits.join(" · "))}</p>`
    : "";

  const placeLine = [p.category ?? config.niche.labelSingular, p.address ?? p.city]
    .filter(Boolean)
    .map((s) => escapeHtml(String(s)))
    .join(" · ");

  const heroStyle = heroPhoto
    ? `style="--hero-image:url('${escapeAttr(heroPhoto)}')"`
    : "";

  return `<!DOCTYPE html>
<html lang="es-DO">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(p.name)}</title>
<style>
:root {
  --bg: #0c100e;
  --ink: #f3f6f2;
  --muted: #a7b6ab;
  --accent: #c4a35a;
  --line: rgba(196, 163, 90, 0.28);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  background: var(--bg);
  line-height: 1.5;
}
.hero {
  position: relative;
  min-height: 100vh;
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: clamp(1.5rem, 4vh, 2.5rem) 1.25rem 1.75rem;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(8,12,10,0.2) 0%, rgba(8,12,10,0.55) 48%, rgba(8,12,10,0.94) 100%),
    linear-gradient(135deg, #1a2820, #0e1411 55%, #182218);
}
.hero.has-photo {
  background-image:
    linear-gradient(180deg, rgba(8,12,10,0.15) 0%, rgba(8,12,10,0.4) 45%, rgba(8,12,10,0.92) 100%),
    var(--hero-image);
  background-size: cover, cover;
  background-position: center, center;
}
.hero-inner {
  position: relative;
  z-index: 1;
  max-width: 920px;
  width: 100%;
  margin: 0 auto;
}
.kicker {
  display: inline-block;
  margin: 0 0 0.75rem;
  font-family: system-ui, sans-serif;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}
.brand {
  margin: 0;
  font-size: clamp(3rem, 10vw, 5.6rem);
  line-height: 0.92;
  letter-spacing: -0.035em;
  font-weight: 700;
  max-width: 11ch;
  text-wrap: balance;
  text-shadow: 0 10px 40px rgba(0,0,0,0.45);
}
.sub {
  margin: 0.9rem 0 0;
  color: #d5ddd6;
  font-size: clamp(1.05rem, 2.4vw, 1.28rem);
  max-width: 30rem;
}
.meta {
  margin: 0.9rem 0 0;
  color: var(--accent);
  font-family: system-ui, sans-serif;
  font-weight: 700;
  font-size: 0.95rem;
}
.cta { margin: 1.35rem 0 0; display: flex; flex-wrap: wrap; gap: 0.75rem 1rem; align-items: center; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: #1a1408;
  text-decoration: none;
  padding: 0.95rem 1.35rem;
  font-family: system-ui, sans-serif;
  font-weight: 800;
  font-size: 1rem;
  border: 0;
}
.phone-hint { font-family: system-ui, sans-serif; color: #c5d0c8; font-size: 0.92rem; }
.photo-note {
  margin: 0.85rem 0 0;
  font-family: system-ui, sans-serif;
  font-size: 0.75rem;
  color: rgba(243,246,242,0.7);
}
.wrap { max-width: 960px; margin: 0 auto; padding: 2.75rem 1.25rem 3.5rem; }
.photos {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.45rem;
  margin: 0 0 2.5rem;
}
.shot { margin: 0; position: relative; overflow: hidden; background: #1c2620; }
.shot img {
  width: 100%;
  height: 200px;
  object-fit: cover;
  display: block;
  filter: saturate(0.95) contrast(1.04);
}
.shot figcaption {
  position: absolute;
  left: 0.5rem;
  bottom: 0.45rem;
  font-family: system-ui, sans-serif;
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(0,0,0,0.45);
  padding: 0.2rem 0.4rem;
}
section h2 {
  margin: 0 0 1.25rem;
  font-size: clamp(1.5rem, 3vw, 2rem);
  letter-spacing: -0.02em;
}
.quote {
  margin: 0 0 1.6rem;
  padding: 0 0 0 1rem;
  border-left: 3px solid var(--accent);
}
.quote blockquote {
  margin: 0;
  font-size: clamp(1.15rem, 2.4vw, 1.5rem);
  line-height: 1.35;
  max-width: 34rem;
}
.quote figcaption {
  margin-top: 0.55rem;
  color: var(--muted);
  font-family: system-ui, sans-serif;
  font-size: 0.84rem;
}
footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-family: system-ui, sans-serif;
  font-size: 0.78rem;
}
@media (max-width: 720px) {
  .brand { max-width: none; }
  .photos { grid-template-columns: 1fr; }
  .shot img { height: 220px; }
}
</style>
</head>
<body>
  <header class="hero${heroPhoto ? " has-photo" : ""}" ${heroStyle}>
    <div class="hero-inner">
      <p class="kicker">${escapeHtml(config.countryName)}</p>
      <h1 class="brand">${escapeHtml(p.name)}</h1>
      <p class="sub">${placeLine}</p>
      ${ratingLine}
      ${phoneBlock}
      ${usingIllustrative ? `<p class="photo-note">Imagen ilustrativa del oficio · no es una foto del local</p>` : ""}
    </div>
  </header>
  <main class="wrap">
    ${gallery.length ? `<section aria-label="Fotos"><div class="photos">${galleryBlocks}</div></section>` : ""}
    <section>
      <h2>Lo que dicen en Google</h2>
      ${quoteBlocks || "<p>Consulta nuestras reseñas en Google.</p>"}
    </section>
    <footer><p>${escapeHtml(footer)}</p></footer>
  </main>
</body>
</html>`;
}

async function generateHtmlWithAi(
  lead: Lead,
  config: NicheConfig,
): Promise<string> {
  const openai = getOpenAI();
  const template = loadPrompt();
  const payload = buildBusinessPayload(lead, config);
  const system = template.replace(
    "{{BUSINESS_JSON}}",
    JSON.stringify(payload, null, 2),
  );

  const completion = await openai.chat.completions.create({
    model: siteModel(),
    temperature: 0.4,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          "Genera el index.html completo ahora. Recuerda: sin JavaScript, sin inventar hechos, solo teléfono como contacto.",
      },
    ],
  });

  return stripFences(completion.choices[0]?.message?.content ?? "");
}

function writeSiteFiles(slug: string, html: string): {
  sitePath: string;
  publicPath: string;
} {
  const sitePath = join(dataDir("sites"), slug, "index.html");
  const publicPath = join(publicDir("sites"), slug, "index.html");
  mkdirSync(dirname(sitePath), { recursive: true });
  mkdirSync(dirname(publicPath), { recursive: true });
  writeFileSync(sitePath, html, "utf8");
  writeFileSync(publicPath, html, "utf8");
  return { sitePath, publicPath };
}

export async function generateSiteForLead(
  lead: Lead,
  config: NicheConfig,
  opts: { preferFallback?: boolean; useAi?: boolean } = {},
): Promise<GeneratedSite> {
  const quote = pickOutreachQuote(lead.place.reviews);
  // Crafted template is default — gpt-4o-mini designs were too generic.
  const useAi = Boolean(opts.useAi) && !opts.preferFallback;
  let html = "";
  let usedFallback = !useAi;

  if (useAi) {
    try {
      html = await generateHtmlWithAi(lead, config);
      const errors = validateGeneratedHtml(html, lead.place);
      if (errors.length) {
        log.warn(`  HTML AI rechazado: ${errors.join("; ")} → template`);
        usedFallback = true;
        html = fallbackSiteHtml(lead, config);
      }
    } catch (err) {
      log.warn(
        `  OpenAI falló: ${err instanceof Error ? err.message : String(err)} → template`,
      );
      usedFallback = true;
      html = fallbackSiteHtml(lead, config);
    }
  } else {
    html = fallbackSiteHtml(lead, config);
  }

  // Final safety: never ship scripts
  if (/<script[\s>]/i.test(html)) {
    usedFallback = true;
    html = fallbackSiteHtml(lead, config);
  }

  const { sitePath, publicPath } = writeSiteFiles(lead.slug, html);
  return { html, sitePath, publicPath, outreachQuote: quote, usedFallback };
}

export async function generateSitesForLeads(
  leads: Lead[],
  config: NicheConfig,
  opts: { limit?: number; preferFallback?: boolean; useAi?: boolean } = {},
): Promise<Array<{ lead: Lead; site: GeneratedSite }>> {
  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const out: Array<{ lead: Lead; site: GeneratedSite }> = [];

  for (const lead of batch) {
    log.info(`Sitio · ${lead.place.name} (${lead.slug})`);
    const site = await generateSiteForLead(lead, config, {
      preferFallback: opts.preferFallback,
      useAi: opts.useAi,
    });
    const urls = resolveGithubPagesUrls(config, lead.slug);
    log.ok(
      `  → ${site.usedFallback ? "template" : "AI"} · ${site.publicPath}${urls.siteUrl ? ` · ${urls.siteUrl}` : ""}`,
    );
    out.push({ lead, site });
  }

  return out;
}
