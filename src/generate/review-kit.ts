import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { getOpenAI, openAiModel } from "../ai/openai.js";
import type { Lead, NicheConfig, Review } from "../types/index.js";
import { resolveGithubPagesUrls } from "../config/load.js";
import { looksSpanish } from "./site.js";
import { dataDir, promptsDir, publicDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";

export type ReplyTone = "thanks" | "soft_cta" | "recovery";

export interface ReviewReplyItem {
  reviewIndex: number;
  author: string;
  rating: number;
  reviewText: string;
  publishedAt: string | null;
  existingOwnerResponse: string | null;
  tone: ReplyTone;
  reply: string;
}

export interface GeneratedReviewKit {
  html: string;
  kitPath: string;
  publicPath: string;
  replies: ReviewReplyItem[];
  usedFallback: boolean;
  outreachQuote: string | null;
}

const AiRepliesSchema = z.object({
  replies: z.array(
    z.object({
      reviewIndex: z.number().int().nonnegative(),
      tone: z.enum(["thanks", "soft_cta", "recovery"]),
      reply: z.string().min(8),
    }),
  ),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function maxReplies(config: NicheConfig): number {
  return config.products?.reviewKit?.maxReplies ?? 8;
}

/** Prefer Spanish reviews with text; mix ratings so recovery is covered. */
export function selectReviewsForKit(
  reviews: Review[],
  limit: number,
): Review[] {
  const withText = reviews
    .map((r, i) => ({ r, i, spanish: looksSpanish(r.text) }))
    .filter(({ r }) => r.text.trim().length >= 20);

  const spanish = withText.filter((x) => x.spanish);
  const pool = (spanish.length >= Math.min(3, limit) ? spanish : withText)
    .slice()
    .sort((a, b) => {
      // Unanswered first, then lower ratings (recovery), then longer text
      const aAns = a.r.ownerResponse ? 1 : 0;
      const bAns = b.r.ownerResponse ? 1 : 0;
      if (aAns !== bAns) return aAns - bAns;
      if (a.r.rating !== b.r.rating) return a.r.rating - b.r.rating;
      return b.r.text.length - a.r.text.length;
    });

  const picked: typeof pool = [];
  const low = pool.filter((x) => x.r.rating <= 3);
  const high = pool.filter((x) => x.r.rating >= 4);
  for (const item of low.slice(0, Math.min(2, limit))) picked.push(item);
  for (const item of high) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  for (const item of pool) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }

  return picked.slice(0, limit).map((x) => x.r);
}

function fallbackTone(rating: number): ReplyTone {
  if (rating <= 3) return "recovery";
  if (rating >= 5) return "soft_cta";
  return "thanks";
}

function fallbackReply(
  businessName: string,
  review: Review,
  phone: string | null,
): { tone: ReplyTone; reply: string } {
  const tone = fallbackTone(review.rating);
  const sign = `— ${businessName}`;
  if (tone === "recovery") {
    return {
      tone,
      reply: `Lamentamos que tu experiencia no haya sido la esperada. Queremos corregirlo: escríbenos${phone ? ` al ${phone}` : ""} y lo revisamos contigo. Gracias por avisarnos. ${sign}`,
    };
  }
  if (tone === "soft_cta") {
    return {
      tone,
      reply: `¡Gracias por tu reseña! Nos alegra saber que saliste contento. Cuando necesites el taller de nuevo, aquí estamos${phone ? ` (${phone})` : ""}. ${sign}`,
    };
  }
  return {
    tone,
    reply: `¡Muchas gracias por tu comentario! Nos motiva seguir cuidando cada trabajo. ${sign}`,
  };
}

function buildFallbackReplies(
  lead: Lead,
  reviews: Review[],
): ReviewReplyItem[] {
  return reviews.map((review, reviewIndex) => {
    const { tone, reply } = fallbackReply(
      lead.place.name,
      review,
      lead.place.phone,
    );
    return {
      reviewIndex,
      author: review.author,
      rating: review.rating,
      reviewText: review.text.trim(),
      publishedAt: review.publishedAt,
      existingOwnerResponse: review.ownerResponse,
      tone,
      reply,
    };
  });
}

async function generateRepliesWithAi(
  lead: Lead,
  reviews: Review[],
  config: NicheConfig,
): Promise<ReviewReplyItem[] | null> {
  const openai = getOpenAI();
  const system = readFileSync(promptsDir("review-replies.md"), "utf8");
  const payload = {
    name: lead.place.name,
    niche: config.niche.labelSingular,
    city: lead.place.city,
    phone: lead.place.phone,
    language: config.language,
    reviews: reviews.map((r, i) => ({
      index: i,
      author: r.author,
      rating: r.rating,
      text: r.text.trim().slice(0, 500),
      date: r.publishedAt,
      ownerResponse: r.ownerResponse
        ? r.ownerResponse.trim().slice(0, 300)
        : null,
    })),
  };

  const completion = await openai.chat.completions.create({
    model: openAiModel(),
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `${JSON.stringify(payload, null, 2)}\n\nResponde SOLO con JSON válido.`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = AiRepliesSchema.safeParse(parsed);
  if (!result.success) return null;

  const byIndex = new Map(
    result.data.replies.map((r) => [r.reviewIndex, r]),
  );
  const items: ReviewReplyItem[] = [];
  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i]!;
    const ai = byIndex.get(i);
    if (ai?.reply.trim()) {
      items.push({
        reviewIndex: i,
        author: review.author,
        rating: review.rating,
        reviewText: review.text.trim(),
        publishedAt: review.publishedAt,
        existingOwnerResponse: review.ownerResponse,
        tone: ai.tone,
        reply: ai.reply.trim(),
      });
    } else {
      const fb = fallbackReply(lead.place.name, review, lead.place.phone);
      items.push({
        reviewIndex: i,
        author: review.author,
        rating: review.rating,
        reviewText: review.text.trim(),
        publishedAt: review.publishedAt,
        existingOwnerResponse: review.ownerResponse,
        tone: fb.tone,
        reply: fb.reply,
      });
    }
  }
  return items;
}

function stars(n: number): string {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function toneLabel(tone: ReplyTone): string {
  if (tone === "recovery") return "Recuperación";
  if (tone === "soft_cta") return "Agradecimiento + vuelta";
  return "Agradecimiento";
}

function heroPhoto(lead: Lead, config: NicheConfig): string | null {
  const google = lead.place.photos.find((p) =>
    /^https:\/\//i.test(p.url),
  )?.url;
  if (google) return google;
  const local = config.niche.illustrativeImages?.[0];
  return local ? `../../${local.replace(/^\//, "")}` : null;
}

export function buildReviewKitHtml(
  lead: Lead,
  config: NicheConfig,
  replies: ReviewReplyItem[],
): string {
  const photo = heroPhoto(lead, config);
  const rating =
    lead.place.rating != null ? lead.place.rating.toFixed(1) : null;
  const count = lead.place.reviewCount ?? lead.place.reviews.length;
  const cards = replies
    .map((item) => {
      const existing = item.existingOwnerResponse
        ? `<p class="existing"><span>Respuesta actual:</span> ${escapeHtml(item.existingOwnerResponse)}</p>`
        : `<p class="existing muted">Sin respuesta en Google todavía</p>`;
      return `<article class="card">
  <header class="card-top">
    <div>
      <p class="author">${escapeHtml(item.author || "Cliente")}</p>
      <p class="stars" aria-label="${item.rating} de 5">${stars(item.rating)}</p>
    </div>
    <span class="tone">${escapeHtml(toneLabel(item.tone))}</span>
  </header>
  <blockquote class="review">“${escapeHtml(item.reviewText)}”</blockquote>
  ${existing}
  <div class="reply-box">
    <p class="reply-label">Respuesta lista</p>
    <p class="reply">${escapeHtml(item.reply)}</p>
  </div>
</article>`;
    })
    .join("\n");

  const heroStyle = photo
    ? `style="background-image:linear-gradient(180deg,rgba(12,16,14,0.35),rgba(12,16,14,0.92)),url('${escapeHtml(photo)}')"`
    : "";

  return `<!DOCTYPE html>
<html lang="es-DO">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Respuestas listas · ${escapeHtml(lead.place.name)}</title>
<meta name="robots" content="noindex" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,550;9..144,700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
:root {
  --bg: #121816;
  --ink: #eef3ee;
  --muted: #9aab9e;
  --accent: #8fbf8a;
  --panel: rgba(24, 33, 28, 0.92);
  --line: #2a3830;
  --reply: #1a2820;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--ink);
  font-family: "Source Sans 3", system-ui, sans-serif;
  background: var(--bg);
}
.hero {
  min-height: 52vh;
  display: flex;
  align-items: flex-end;
  padding: clamp(1.25rem, 4vw, 2.5rem);
  background-color: #1a2420;
  background-size: cover;
  background-position: center;
}
.hero-inner { max-width: 42rem; }
.eyebrow {
  margin: 0 0 0.5rem;
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}
h1 {
  margin: 0;
  font-family: Fraunces, Georgia, serif;
  font-size: clamp(2.1rem, 7vw, 3.4rem);
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-weight: 700;
}
.sub {
  margin: 0.75rem 0 0;
  font-size: 1.05rem;
  color: #d5e0d6;
  max-width: 34rem;
  line-height: 1.45;
}
.meta {
  margin: 0.85rem 0 0;
  color: var(--muted);
  font-size: 0.92rem;
}
.wrap {
  max-width: 44rem;
  margin: 0 auto;
  padding: 1.5rem 1.15rem 3rem;
}
.note {
  margin: 0 0 1.25rem;
  color: var(--muted);
  font-size: 0.92rem;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  padding: 1.1rem 1.15rem 1.2rem;
  margin: 0 0 1rem;
}
.card-top {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
}
.author { margin: 0; font-weight: 700; }
.stars { margin: 0.2rem 0 0; color: #d4b56a; letter-spacing: 0.05em; }
.tone {
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
  white-space: nowrap;
}
.review {
  margin: 0.85rem 0;
  font-family: Fraunces, Georgia, serif;
  font-size: 1.05rem;
  line-height: 1.45;
  color: #e7eee8;
}
.existing {
  margin: 0 0 0.85rem;
  font-size: 0.88rem;
  color: var(--muted);
  line-height: 1.4;
}
.existing span { color: #c5d2c7; font-weight: 600; }
.existing.muted { font-style: italic; }
.reply-box {
  background: var(--reply);
  border-left: 3px solid var(--accent);
  padding: 0.85rem 1rem;
}
.reply-label {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}
.reply {
  margin: 0;
  font-size: 1rem;
  line-height: 1.5;
  white-space: pre-wrap;
}
footer {
  margin-top: 1.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1.45;
}
</style>
</head>
<body>
  <header class="hero" ${heroStyle}>
    <div class="hero-inner">
      <p class="eyebrow">Kit de respuestas · Google</p>
      <h1>${escapeHtml(lead.place.name)}</h1>
      <p class="sub">
        Respuestas listas en español para pegar en tu perfil público de Google.
        Basadas solo en reseñas reales — sin inventar.
      </p>
      <p class="meta">
        ${rating ? `${escapeHtml(rating)} ★ · ` : ""}${count} reseñas
        ${lead.place.city ? ` · ${escapeHtml(lead.place.city)}` : ""}
      </p>
    </div>
  </header>
  <main class="wrap">
    <p class="note">
      Copia cada “Respuesta lista” en Google Maps / Perfil de Empresa.
      Las fotos de arriba ${photo && /^https:\/\//i.test(photo) ? "provienen de tu perfil público de Google" : "son ilustrativas del rubro"}.
    </p>
    ${cards}
    <footer>
      Las reseñas provienen de nuestro perfil público de Google.
      ${photo && /^https:\/\//i.test(photo) ? "Las fotografías también · Algunas imágenes pueden ser ilustrativas." : "Las fotografías son ilustrativas."}
      DomiWEB no inventa reseñas ni respuestas de clientes.
    </footer>
  </main>
</body>
</html>`;
}

function writeKitFiles(
  slug: string,
  html: string,
  replies: ReviewReplyItem[],
): { kitPath: string; publicPath: string } {
  const kitPath = join(dataDir("kits"), slug, "index.html");
  const publicPath = join(publicDir("kits"), slug, "index.html");
  const jsonPath = join(dataDir("kits"), slug, "replies.json");
  mkdirSync(dirname(kitPath), { recursive: true });
  mkdirSync(dirname(publicPath), { recursive: true });
  writeFileSync(kitPath, html, "utf8");
  writeFileSync(publicPath, html, "utf8");
  writeFileSync(jsonPath, JSON.stringify(replies, null, 2), "utf8");
  writeFileSync(
    join(publicDir("kits"), slug, "replies.json"),
    JSON.stringify(replies, null, 2),
    "utf8",
  );
  return { kitPath, publicPath };
}

export function kitExists(slug: string): boolean {
  return existsSync(join(publicDir("kits"), slug, "index.html"));
}

export function siteHtmlExists(slug: string): boolean {
  return existsSync(join(publicDir("sites"), slug, "index.html"));
}

export async function generateReviewKitForLead(
  lead: Lead,
  config: NicheConfig,
  opts: { useAi?: boolean } = {},
): Promise<GeneratedReviewKit> {
  const limit = maxReplies(config);
  const selected = selectReviewsForKit(lead.place.reviews, limit);
  if (!selected.length) {
    throw new Error(`Sin reseñas con texto para ${lead.place.name}`);
  }

  let replies: ReviewReplyItem[];
  let usedFallback = true;
  const wantAi = opts.useAi !== false;

  if (wantAi) {
    try {
      const ai = await generateRepliesWithAi(lead, selected, config);
      if (ai?.length) {
        replies = ai;
        usedFallback = false;
      } else {
        log.warn(`  AI replies inválidas → plantilla`);
        replies = buildFallbackReplies(lead, selected);
      }
    } catch (err) {
      log.warn(
        `  OpenAI falló: ${err instanceof Error ? err.message : String(err)} → plantilla`,
      );
      replies = buildFallbackReplies(lead, selected);
    }
  } else {
    replies = buildFallbackReplies(lead, selected);
  }

  const html = buildReviewKitHtml(lead, config, replies);
  const { kitPath, publicPath } = writeKitFiles(lead.slug, html, replies);
  const quote =
    selected.find((r) => r.rating >= 4 && looksSpanish(r.text))?.text.trim() ??
    selected.find((r) => r.rating >= 4)?.text.trim() ??
    null;
  const outreachQuote = quote
    ? quote.replace(/\s+/g, " ").slice(0, 100)
    : null;

  return {
    html,
    kitPath,
    publicPath,
    replies,
    usedFallback,
    outreachQuote,
  };
}

export async function generateReviewKitsForLeads(
  leads: Lead[],
  config: NicheConfig,
  opts: { limit?: number; useAi?: boolean } = {},
): Promise<Array<{ lead: Lead; kit: GeneratedReviewKit }>> {
  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const out: Array<{ lead: Lead; kit: GeneratedReviewKit }> = [];

  for (const lead of batch) {
    log.info(`Review kit · ${lead.place.name} (${lead.slug})`);
    try {
      const kit = await generateReviewKitForLead(lead, config, {
        useAi: opts.useAi,
      });
      const urls = resolveGithubPagesUrls(config, lead.slug);
      log.ok(
        `  → ${kit.usedFallback ? "plantilla" : "AI"} · ${kit.replies.length} respuestas · ${kit.publicPath}${urls.kitUrl ? ` · ${urls.kitUrl}` : ""}`,
      );
      out.push({ lead, kit });
    } catch (err) {
      log.error(
        `  ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return out;
}
