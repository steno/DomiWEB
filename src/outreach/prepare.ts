import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "csv-stringify/sync";
import type { Lead, NicheConfig } from "../types/index.js";
import { resolveGithubPagesUrls } from "../config/load.js";
import { pickOutreachQuote } from "../generate/site.js";
import { dataDir, promptsDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";

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
  channelHint: "email_or_postcard";
}

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

function greetingName(lead: Lead): string {
  const n = lead.ownerFirstName?.trim();
  if (n) return n;
  return "hola";
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

  const quote =
    lead.outreachQuote?.trim() ||
    pickOutreachQuote(lead.place.reviews) ||
    "muy buen servicio";

  const vars = {
    OWNER_FIRST_NAME: greetingName(lead),
    BUSINESS_NAME: lead.place.name,
    REVIEW_QUOTE: quote,
    CLAIM_URL: resolveClaimUrl(lead, config),
  };

  return {
    leadId: lead.id,
    slug: lead.slug,
    businessName: lead.place.name,
    ownerFirstName: greetingName(lead),
    phone: lead.place.phone ?? "",
    address: lead.place.address ?? "",
    reviewQuote: quote,
    claimUrl: vars.CLAIM_URL,
    siteUrl: resolveSiteUrl(lead, config),
    emailSubject: fill(emailTpl.subject, vars),
    emailBody: fill(emailTpl.body, vars),
    postcardFront: fill(postcardTpl.front, vars),
    postcardBack: fill(postcardTpl.back, vars),
    channelHint: "email_or_postcard",
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
    emailSubject: m.emailSubject,
    emailBody: m.emailBody.replace(/\n/g, "\\n"),
    postcardFront: m.postcardFront,
    postcardBack: m.postcardBack.replace(/\n/g, "\\n"),
    channelHint: m.channelHint,
    oneMessageOnly: "true",
  }));

  writeFileSync(csvPath, stringify(rows, { header: true }), "utf8");
  writeFileSync(jsonPath, JSON.stringify(messages, null, 2), "utf8");

  // Also write per-lead text files for easy copy/paste
  for (const m of messages) {
    const dir = dataDir("outreach", m.slug);
    mkdirSync(dir, { recursive: true });
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
  opts: { limit?: number } = {},
): { messages: OutreachMessage[]; csvPath: string; jsonPath: string } {
  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const messages = batch.map((lead) => {
    log.info(`Outreach · ${lead.place.name}`);
    const msg = buildOutreachForLead(lead, config);
    log.ok(`  → ${msg.ownerFirstName} · ${msg.claimUrl}`);
    return msg;
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const paths = exportOutreachBundle(messages, stamp);
  return { messages, ...paths };
}
