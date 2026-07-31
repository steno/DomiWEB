import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "csv-stringify/sync";
import type { Lead, NicheConfig } from "../types/index.js";
import { resolveGithubPagesUrls } from "../config/load.js";
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

function resolveClaimUrl(lead: Lead, config: NicheConfig): string {
  if (lead.claimUrl) return lead.claimUrl;
  const urls = resolveGithubPagesUrls(config, lead.slug);
  if (urls.claimUrl) return urls.claimUrl;
  return `https://steno.github.io/DomiWEB/claim/${lead.slug}/`;
}

function resolveSiteUrl(lead: Lead, config: NicheConfig): string {
  if (lead.siteUrl) return lead.siteUrl;
  const urls = resolveGithubPagesUrls(config, lead.slug);
  if (urls.siteUrl) return urls.siteUrl;
  return `https://steno.github.io/DomiWEB/sites/${lead.slug}/`;
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
): OutreachMessage {
  const emailTpl = parseEmailTemplate(
    readFileSync(promptsDir("outreach-email.md"), "utf8"),
  );
  const postcardTpl = parsePostcardTemplate(
    readFileSync(promptsDir("outreach-postcard.md"), "utf8"),
  );
  const waTpl = parseWhatsAppTemplate(
    readFileSync(promptsDir("outreach-whatsapp.md"), "utf8"),
  );
  const waPriceTpl = parseWhatsAppTemplate(
    readFileSync(promptsDir("outreach-whatsapp-price.md"), "utf8"),
  );
  const waCloseTpl = parseWhatsAppTemplate(
    readFileSync(promptsDir("outreach-whatsapp-close.md"), "utf8"),
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
  const priceOnce = config.pricing?.onceLabel ?? "RD$2,000";
  const hostingNote =
    config.pricing?.hostingNote ?? "si lo necesitas, lo hablamos aparte";
  const transfer = transferVars();

  const vars = {
    OWNER_FIRST_NAME: owner,
    OWNER_GREETING: owner ? ` ${owner}` : "",
    BUSINESS_NAME: lead.place.name,
    REVIEW_QUOTE: finalQuote ?? "",
    REVIEW_SNIPPET: reviewSnippet(finalQuote),
    CLAIM_URL: resolveClaimUrl(lead, config),
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
    siteUrl: resolveSiteUrl(lead, config),
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
  opts: { limit?: number; write?: boolean } = {},
): { messages: OutreachMessage[]; csvPath?: string; jsonPath?: string } {
  const transfer = transferVars();
  if (transfer.missing.length) {
    log.warn(
      `Transferencia incompleta (${transfer.missing.join(", ")}) — rellena .env antes de send-whatsapp --close`,
    );
  }

  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const messages = batch.map((lead) => {
    log.info(`Outreach · ${lead.place.name}`);
    const msg = buildOutreachForLead(lead, config);
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
