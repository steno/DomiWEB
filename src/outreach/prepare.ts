import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "csv-stringify/sync";
import type { Lead, NicheConfig, PipelineProduct } from "../types/index.js";
import {
  priceOnceForProduct,
  resolveGithubPagesUrls,
} from "../config/load.js";
import { pickOutreachQuote } from "../generate/site.js";
import { dataDir, promptsDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";
import { buildWhatsAppUrl } from "./phone.js";

export interface OutreachMessage {
  leadId: string;
  slug: string;
  businessName: string;
  ownerFirstName: string;
  phone: string;
  address: string;
  reviewQuote: string;
  claimUrl: string;
  siteUrl: string;
  emailSubject: string;
  emailBody: string;
  postcardFront: string;
  postcardBack: string;
  whatsappMessage: string;
  whatsappUrl: string | null;
  /** Follow-up after they like / open the claim */
  whatsappPriceMessage: string;
  whatsappPriceUrl: string | null;
  /** After they say yes to the price — bank + delivery */
  whatsappCloseMessage: string;
  whatsappCloseUrl: string | null;
  priceOnce: string;
  hostingNote: string;
  product: PipelineProduct;
  /** Primary channel for DR local businesses */
  channelHint: "whatsapp" | "email_or_postcard" | "postcard";
}

const BAD_OWNER_NAMES = new Set([
  "hola",
  "hello",
  "hi",
  "dueño",
  "dueno",
  "owner",
  "n/a",
  "na",
  "unknown",
  "null",
  "undefined",
  "?",
  "-",
]);

function fill(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out.trim();
}

function parseEmailTemplate(raw: string): { subject: string; body: string } {
  const subjectMatch = raw.match(/Asunto:\s*(.+)/i);
  const subject =
    subjectMatch?.[1]?.trim() ||
    "te armé una página web con tus reseñas de Google";
  const bodyMatch = raw.match(/Cuerpo:\s*([\s\S]*)/i);
  const body = (bodyMatch?.[1] ?? raw).trim();
  return { subject, body };
}

function parsePostcardTemplate(raw: string): {
  front: string;
  back: string;
} {
  const frontMatch = raw.match(
    /Anverso[^\n]*:\s*([\s\S]*?)\n\s*Reverso/i,
  );
  const backMatch = raw.match(/Reverso[^\n]*:\s*([\s\S]*)/i);
  return {
    front: (frontMatch?.[1] ?? "").trim(),
    back: (backMatch?.[1] ?? raw).trim(),
  };
}

function parseWhatsAppTemplate(raw: string): string {
  const match = raw.match(/## Mensaje\s*([\s\S]*?)\n## Reglas/i);
  return (match?.[1] ?? raw).trim();
}

/** Real first name only — never ship "Hola hola". */
export function greetingName(lead: Lead): string {
  const n = lead.ownerFirstName?.trim();
  if (!n || n.length < 2) return "";
  if (BAD_OWNER_NAMES.has(n.toLowerCase())) return "";
  return n;
}

function reviewSnippet(quote: string | null): string {
  if (quote) return ` — alguien escribió: “${quote}”`;
  return " — tus clientes te dejan muy buenas opiniones";
}

function transferVars(): {
  TRANSFER_BANK: string;
  TRANSFER_ACCOUNT: string;
  TRANSFER_NAME: string;
  DELIVERY_HOURS: string;
  missing: string[];
} {
  const bank = process.env.TRANSFER_BANK?.trim() || "";
  const account = process.env.TRANSFER_ACCOUNT?.trim() || "";
  const name = process.env.TRANSFER_NAME?.trim() || "";
  const hours =
    process.env.DELIVERY_HOURS?.trim() || "24–48 horas";
  const missing: string[] = [];
  if (!bank) missing.push("TRANSFER_BANK");
  if (!account) missing.push("TRANSFER_ACCOUNT");
  if (!name) missing.push("TRANSFER_NAME");
  return {
    TRANSFER_BANK: bank || "[configura TRANSFER_BANK en .env]",
    TRANSFER_ACCOUNT: account || "[configura TRANSFER_ACCOUNT en .env]",
    TRANSFER_NAME: name || "[configura TRANSFER_NAME en .env]",
    DELIVERY_HOURS: hours,
    missing,
  };
}

function resolveClaimUrl(
  lead: Lead,
  config: NicheConfig,
  product: PipelineProduct = "site",
): string {
  const urls = resolveGithubPagesUrls(config, lead.slug);
  let url =
    lead.claimUrl ||
    urls.claimUrl ||
    `https://steno.github.io/DomiWEB/claim/${lead.slug}/`;
  // Menu claims use ?v=menu so WhatsApp/OG caches don't keep an old "sitio" preview.
  if (product === "menu") {
    try {
      const u = new URL(url);
      u.searchParams.set("v", "menu");
      url = u.toString();
    } catch {
      url = url.includes("?") ? `${url}&v=menu` : `${url.replace(/\/?$/, "/")}?v=menu`;
    }
  }
  return url;
}

/** Pretty public share link for the menu product (not per-business). */
export function resolveMenuShareUrl(): string {
  const fromEnv = process.env.MENU_SHARE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "https://tinyurl.com/domenus";
}

function resolveAssetUrl(
  lead: Lead,
  config: NicheConfig,
  product: PipelineProduct,
): string {
  const urls = resolveGithubPagesUrls(config, lead.slug);
  if (product === "reviewKit") {
    if (urls.kitUrl) return urls.kitUrl;
    return `https://steno.github.io/DomiWEB/kits/${lead.slug}/`;
  }
  if (product === "menu") {
    if (urls.menuUrl) return urls.menuUrl;
    return `https://steno.github.io/DomiWEB/menus/${lead.slug}/`;
  }
  if (lead.siteUrl) return lead.siteUrl;
  if (urls.siteUrl) return urls.siteUrl;
  return `https://steno.github.io/DomiWEB/sites/${lead.slug}/`;
}

function whatsappPromptFiles(product: PipelineProduct): {
  first: string;
  price: string;
  close: string;
} {
  if (product === "reviewKit") {
    return {
      first: "outreach-whatsapp-review-kit.md",
      price: "outreach-whatsapp-review-kit-price.md",
      close: "outreach-whatsapp-review-kit-close.md",
    };
  }
  if (product === "menu") {
    return {
      first: "outreach-whatsapp-menu.md",
      price: "outreach-whatsapp-menu-price.md",
      close: "outreach-whatsapp-menu-close.md",
    };
  }
  return {
    first: "outreach-whatsapp.md",
    price: "outreach-whatsapp-price.md",
    close: "outreach-whatsapp-close.md",
  };
}

/** Swap active WhatsApp copy to the price follow-up (for send --price). */
export function usePriceFollowUp(messages: OutreachMessage[]): OutreachMessage[] {
  return messages.map((m) => ({
    ...m,
    whatsappMessage: m.whatsappPriceMessage,
    whatsappUrl: m.whatsappPriceUrl,
  }));
}

/** Swap active WhatsApp copy to the close / transfer kit (for send --close). */
export function useCloseFollowUp(messages: OutreachMessage[]): OutreachMessage[] {
  return messages.map((m) => ({
    ...m,
    whatsappMessage: m.whatsappCloseMessage,
    whatsappUrl: m.whatsappCloseUrl,
  }));
}

export function buildOutreachForLead(
  lead: Lead,
  config: NicheConfig,
  opts: { product?: PipelineProduct } = {},
): OutreachMessage {
  const product = opts.product ?? "site";
  const prompts = whatsappPromptFiles(product);
  const emailFile =
    product === "menu" ? "outreach-email-menu.md" : "outreach-email.md";
  const postcardFile =
    product === "menu" ? "outreach-postcard-menu.md" : "outreach-postcard.md";
  const emailTpl = parseEmailTemplate(
    readFileSync(promptsDir(emailFile), "utf8"),
  );
  const postcardTpl = parsePostcardTemplate(
    readFileSync(promptsDir(postcardFile), "utf8"),
  );
  const waTpl = parseWhatsAppTemplate(
    readFileSync(promptsDir(prompts.first), "utf8"),
  );
  const waPriceTpl = parseWhatsAppTemplate(
    readFileSync(promptsDir(prompts.price), "utf8"),
  );
  const waCloseTpl = parseWhatsAppTemplate(
    readFileSync(promptsDir(prompts.close), "utf8"),
  );

  // Prefer a Spanish quote; never ship English tourist text in cold outreach.
  const stored = lead.outreachQuote?.trim() || "";
  const finalQuote =
    (stored
      ? pickOutreachQuote(
          [
            {
              text: stored,
              rating: 5,
              author: "",
              publishedAt: null,
              ownerResponse: null,
            },
          ],
          { spanishOnly: true, maxLen: 100 },
        )
      : null) ||
    pickOutreachQuote(lead.place.reviews, {
      spanishOnly: true,
      maxLen: 100,
    });

  const owner = greetingName(lead);
  const priceOnce = priceOnceForProduct(config, product);
  const hostingNote =
    config.pricing?.hostingNote ?? "si lo necesitas, lo hablamos aparte";
  const transfer = transferVars();

  const vars = {
    OWNER_FIRST_NAME: owner,
    OWNER_GREETING: owner ? ` ${owner}` : "",
    BUSINESS_NAME: lead.place.name,
    REVIEW_QUOTE: finalQuote ?? "",
    REVIEW_SNIPPET: reviewSnippet(finalQuote),
    CLAIM_URL: resolveClaimUrl(lead, config, product),
    MENU_URL: resolveAssetUrl(lead, config, "menu"),
    SITE_URL: resolveAssetUrl(lead, config, "site"),
    /** Product promo short link — not the per-business claim */
    SHARE_URL: resolveMenuShareUrl(),
    PRICE_ONCE: priceOnce,
    HOSTING_NOTE: hostingNote,
    TRANSFER_BANK: transfer.TRANSFER_BANK,
    TRANSFER_ACCOUNT: transfer.TRANSFER_ACCOUNT,
    TRANSFER_NAME: transfer.TRANSFER_NAME,
    DELIVERY_HOURS: transfer.DELIVERY_HOURS,
  };

  const whatsappMessage = fill(waTpl, vars);
  const whatsappPriceMessage = fill(waPriceTpl, vars);
  const whatsappCloseMessage = fill(waCloseTpl, vars);
  const phone = lead.place.phone ?? "";
  const whatsappUrl = buildWhatsAppUrl(phone, whatsappMessage);
  const whatsappPriceUrl = buildWhatsAppUrl(phone, whatsappPriceMessage);
  const whatsappCloseUrl = buildWhatsAppUrl(phone, whatsappCloseMessage);

  return {
    leadId: lead.id,
    slug: lead.slug,
    businessName: lead.place.name,
    ownerFirstName: owner || "",
    phone,
    address: lead.place.address ?? "",
    reviewQuote: finalQuote ?? "",
    claimUrl: vars.CLAIM_URL,
    siteUrl: resolveAssetUrl(lead, config, product),
    emailSubject: fill(emailTpl.subject, vars),
    emailBody: fill(emailTpl.body, vars),
    postcardFront: fill(postcardTpl.front, vars),
    postcardBack: fill(postcardTpl.back, vars),
    whatsappMessage,
    whatsappUrl,
    whatsappPriceMessage,
    whatsappPriceUrl,
    whatsappCloseMessage,
    whatsappCloseUrl,
    priceOnce,
    hostingNote,
    product,
    channelHint: whatsappUrl ? "whatsapp" : "postcard",
  };
}

export function exportOutreachBundle(
  messages: OutreachMessage[],
  stamp: string,
): { csvPath: string; jsonPath: string } {
  mkdirSync(dataDir("outreach"), { recursive: true });
  const csvPath = dataDir("outreach", `outreach-${stamp}.csv`);
  const jsonPath = dataDir("outreach", `outreach-${stamp}.json`);

  const rows = messages.map((m) => ({
    id: m.leadId,
    slug: m.slug,
    product: m.product,
    businessName: m.businessName,
    ownerFirstName: m.ownerFirstName,
    phone: m.phone,
    address: m.address,
    reviewQuote: m.reviewQuote,
    claimUrl: m.claimUrl,
    siteUrl: m.siteUrl,
    channelHint: m.channelHint,
    priceOnce: m.priceOnce,
    hostingNote: m.hostingNote,
    whatsappUrl: m.whatsappUrl ?? "",
    whatsappMessage: m.whatsappMessage.replace(/\n/g, "\\n"),
    whatsappPriceUrl: m.whatsappPriceUrl ?? "",
    whatsappPriceMessage: m.whatsappPriceMessage.replace(/\n/g, "\\n"),
    whatsappCloseUrl: m.whatsappCloseUrl ?? "",
    whatsappCloseMessage: m.whatsappCloseMessage.replace(/\n/g, "\\n"),
    emailSubject: m.emailSubject,
    emailBody: m.emailBody.replace(/\n/g, "\\n"),
    postcardFront: m.postcardFront,
    postcardBack: m.postcardBack.replace(/\n/g, "\\n"),
  }));

  writeFileSync(csvPath, stringify(rows, { header: true }), "utf8");
  writeFileSync(jsonPath, JSON.stringify(messages, null, 2), "utf8");

  for (const m of messages) {
    const dir = dataDir("outreach", m.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "whatsapp.txt"),
      `${m.whatsappMessage}\n\n${m.whatsappUrl ?? "(sin teléfono WhatsApp)"}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "whatsapp-price.txt"),
      `${m.whatsappPriceMessage}\n\n${m.whatsappPriceUrl ?? "(sin teléfono WhatsApp)"}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "whatsapp-close.txt"),
      `${m.whatsappCloseMessage}\n\n${m.whatsappCloseUrl ?? "(sin teléfono WhatsApp)"}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "email.txt"),
      `Asunto: ${m.emailSubject}\n\n${m.emailBody}\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "postcard.txt"),
      `Anverso:\n${m.postcardFront}\n\nReverso:\n${m.postcardBack}\n`,
      "utf8",
    );
  }

  return { csvPath, jsonPath };
}

export function prepareOutreach(
  leads: Lead[],
  config: NicheConfig,
  opts: { limit?: number; write?: boolean; product?: PipelineProduct } = {},
): { messages: OutreachMessage[]; csvPath?: string; jsonPath?: string } {
  const product = opts.product ?? "site";
  const transfer = transferVars();
  if (transfer.missing.length) {
    log.warn(
      `Transferencia incompleta (${transfer.missing.join(", ")}) — rellena .env antes de send-whatsapp --close`,
    );
  }

  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const messages = batch.map((lead) => {
    log.info(`Outreach · ${product} · ${lead.place.name}`);
    const msg = buildOutreachForLead(lead, config, { product });
    const wa = msg.whatsappUrl ? "WhatsApp OK" : "sin WA";
    const name = msg.ownerFirstName || "(sin nombre)";
    log.ok(
      `  → ${name} · ${wa} · ${msg.priceOnce} único · ${msg.claimUrl}`,
    );
    return msg;
  });
  if (opts.write === false) return { messages };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const paths = exportOutreachBundle(messages, stamp);
  return { messages, ...paths };
}

/** Load latest outreach JSON bundle. */
export function loadLatestOutreachMessages(): OutreachMessage[] | null {
  const dir = dataDir("outreach");
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith("outreach-") && f.endsWith(".json"))
      .sort()
      .reverse();
    if (!files[0]) return null;
    return JSON.parse(
      readFileSync(join(dir, files[0]), "utf8"),
    ) as OutreachMessage[];
  } catch {
    return null;
  }
}
