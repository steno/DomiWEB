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

function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}

/**
 * Deterministic honest template — used if the model fails validation.
 * Only real facts + verbatim quotes.
 */
export function fallbackSiteHtml(lead: Lead, config: NicheConfig): string {
  const p = lead.place;
  const quotes = p.reviews
    .filter((r) => r.text.trim().length > 15)
    .slice(0, 5);
  const photos = p.photos.slice(0, 4).map((ph) => ph.url);
  const hasRealPhotos = photos.length > 0;
  const footer = hasRealPhotos
    ? "Las reseñas y fotografías provienen de nuestro perfil público de Google · Algunas imágenes pueden ser ilustrativas"
    : "Las reseñas provienen de nuestro perfil público de Google · Las fotografías son ilustrativas";

  const quoteBlocks = quotes
    .map(
      (r) => `
      <figure class="quote">
        <blockquote>“${escapeHtml(r.text.trim().slice(0, 280))}”</blockquote>
        <figcaption>— ${escapeHtml(r.author)}${r.rating ? ` · ${r.rating}★` : ""}</figcaption>
      </figure>`,
    )
    .join("\n");

  const photoBlocks = photos
    .map(
      (url) =>
        `<img src="${escapeHtml(url)}" alt="${escapeHtml(p.name)}" loading="lazy" width="800" height="500" />`,
    )
    .join("\n");

  const phoneBlock = p.phone
    ? `<p class="cta"><a class="btn" href="${telHref(p.phone)}">Llamar ${escapeHtml(p.phone)}</a></p>`
    : "";

  const ratingLine =
    p.rating != null
      ? `<p class="meta">${p.rating}★ en Google${p.reviewCount != null ? ` · ${p.reviewCount} reseñas` : ""}</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="es-DO">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(p.name)}</title>
<style>
:root {
  --bg: #141a16;
  --ink: #eef3ee;
  --muted: #9aab9e;
  --accent: #6fa87a;
  --panel: #1c2620;
  --line: #2c3a31;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  color: var(--ink);
  background:
    radial-gradient(ellipse at 15% 0%, #24352a 0%, transparent 50%),
    radial-gradient(ellipse at 90% 70%, #1a2820 0%, transparent 40%),
    var(--bg);
  line-height: 1.5;
}
.wrap { max-width: 920px; margin: 0 auto; padding: 1.25rem 1.25rem 3rem; }
header.hero {
  min-height: 72vh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 2.5rem 0 1.5rem;
  border-bottom: 1px solid var(--line);
}
.brand {
  font-size: clamp(2.4rem, 7vw, 4rem);
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin: 0 0 0.75rem;
  font-weight: 700;
}
.sub { margin: 0; color: var(--muted); max-width: 34rem; font-size: 1.1rem; }
.meta { color: var(--accent); font-weight: 600; margin: 1rem 0 0; }
.btn {
  display: inline-block;
  margin-top: 1.25rem;
  background: var(--accent);
  color: #102016;
  text-decoration: none;
  padding: 0.85rem 1.25rem;
  font-family: system-ui, sans-serif;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.photos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.6rem;
  margin: 2rem 0;
}
.photos img {
  width: 100%;
  height: 160px;
  object-fit: cover;
  background: #cfd6c8;
}
section h2 {
  font-size: 1.35rem;
  margin: 2rem 0 1rem;
  letter-spacing: -0.02em;
}
.quote {
  margin: 0 0 1.1rem;
  padding: 1rem 1.1rem;
  background: var(--panel);
  border-left: 3px solid var(--accent);
}
.quote blockquote { margin: 0; font-size: 1.05rem; }
.quote figcaption {
  margin-top: 0.55rem;
  color: var(--muted);
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
}
footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-family: system-ui, sans-serif;
  font-size: 0.8rem;
}
</style>
</head>
<body>
<main class="wrap">
  <header class="hero">
    <h1 class="brand">${escapeHtml(p.name)}</h1>
    <p class="sub">${escapeHtml(p.category ?? config.niche.labelSingular)}${p.address ? ` · ${escapeHtml(p.address)}` : p.city ? ` · ${escapeHtml(p.city)}` : ""}</p>
    ${ratingLine}
    ${phoneBlock}
  </header>
  ${hasRealPhotos ? `<div class="photos">${photoBlocks}</div>` : ""}
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
  opts: { preferFallback?: boolean } = {},
): Promise<GeneratedSite> {
  const quote = pickOutreachQuote(lead.place.reviews);
  let html = "";
  let usedFallback = Boolean(opts.preferFallback);

  if (!opts.preferFallback) {
    try {
      html = await generateHtmlWithAi(lead, config);
      const errors = validateGeneratedHtml(html, lead.place);
      if (errors.length) {
        log.warn(`  HTML AI rechazado: ${errors.join("; ")} → fallback`);
        usedFallback = true;
        html = fallbackSiteHtml(lead, config);
      }
    } catch (err) {
      log.warn(
        `  OpenAI falló: ${err instanceof Error ? err.message : String(err)} → fallback`,
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
  opts: { limit?: number; preferFallback?: boolean } = {},
): Promise<Array<{ lead: Lead; site: GeneratedSite }>> {
  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const out: Array<{ lead: Lead; site: GeneratedSite }> = [];

  for (const lead of batch) {
    log.info(`Sitio · ${lead.place.name} (${lead.slug})`);
    const site = await generateSiteForLead(lead, config, {
      preferFallback: opts.preferFallback,
    });
    const urls = resolveGithubPagesUrls(config, lead.slug);
    log.ok(
      `  → ${site.usedFallback ? "fallback" : "AI"} · ${site.publicPath}${urls.siteUrl ? ` · ${urls.siteUrl}` : ""}`,
    );
    out.push({ lead, site });
  }

  return out;
}
