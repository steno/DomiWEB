import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Lead, NicheConfig } from "../types/index.js";
import { listLeads } from "../db/store.js";
import { log } from "../utils/logger.js";
import {
  generateMenuForLead,
  writeMenuData,
  type MenuCategory,
  type MenuData,
} from "./menu.js";

const MAX_CATEGORIES = 20;
const MAX_ITEMS_PER_CATEGORY = 60;
const MAX_FIELD_LEN = 200;

const itemSchema = z.object({
  name: z.string().trim().min(1).max(MAX_FIELD_LEN),
  note: z.string().trim().max(MAX_FIELD_LEN).default(""),
  priceHint: z.string().trim().max(80).default("RD$ —"),
});

const categorySchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(MAX_FIELD_LEN),
  items: z.array(itemSchema).min(1).max(MAX_ITEMS_PER_CATEGORY),
});

const draftSchema = z.object({
  slug: z.string().trim().min(1).max(120).optional(),
  categories: z.array(categorySchema).min(1).max(MAX_CATEGORIES),
  source: z.string().optional(),
  owned: z.boolean().optional(),
  updatedAt: z.string().optional(),
});

function slugifyId(label: string, fallback: string): string {
  const s = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || fallback;
}

function sanitizeText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
}

export function parseMenuDraftJson(
  raw: unknown,
  expectedSlug: string,
): MenuData {
  const parsed = draftSchema.parse(raw);
  if (parsed.slug && parsed.slug !== expectedSlug) {
    throw new Error(
      `El JSON es para slug "${parsed.slug}" pero pediste "${expectedSlug}".`,
    );
  }

  const categories: MenuCategory[] = parsed.categories.map((c, i) => ({
    id: sanitizeText(c.id || slugifyId(c.label, `cat-${i + 1}`)).slice(0, 80),
    label: sanitizeText(c.label),
    items: c.items.map((it) => ({
      name: sanitizeText(it.name),
      note: sanitizeText(it.note ?? ""),
      priceHint: sanitizeText(it.priceHint || "RD$ —") || "RD$ —",
    })),
  }));

  return {
    slug: expectedSlug,
    owned: true,
    updatedAt: new Date().toISOString(),
    source: "owner-draft",
    categories,
  };
}

export function loadMenuDraftFile(
  filePath: string,
  expectedSlug: string,
): MenuData {
  const text = readFileSync(filePath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`No se pudo leer JSON: ${filePath}`);
  }
  return parseMenuDraftJson(raw, expectedSlug);
}

export function findLeadBySlug(slug: string): Lead | null {
  return listLeads().find((l) => l.slug === slug) ?? null;
}

export async function applyMenuDraft(opts: {
  slug: string;
  filePath: string;
  config: NicheConfig;
  lead?: Lead | null;
}): Promise<{ lead: Lead; menuData: MenuData; publicPath: string }> {
  const lead = opts.lead ?? findLeadBySlug(opts.slug);
  if (!lead) {
    throw new Error(
      `No hay lead con slug "${opts.slug}" en la base. ¿Corre scrape primero?`,
    );
  }

  const menuData = loadMenuDraftFile(opts.filePath, opts.slug);
  writeMenuData(menuData);
  log.info(
    `Borrador aplicado · ${lead.place.name} · ${menuData.categories.length} categorías · owned`,
  );

  const menu = await generateMenuForLead(lead, opts.config);
  return {
    lead,
    menuData: menu.menuData,
    publicPath: menu.publicPath,
  };
}
