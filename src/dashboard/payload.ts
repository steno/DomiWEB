import { writeFileSync, mkdirSync } from "node:fs";
import { listLeads, statusCounts } from "../db/store.js";
import { isMenuOwned, menuExists, readMenuData } from "../generate/menu.js";
import { kitExists, siteHtmlExists } from "../generate/review-kit.js";
import {
  emptyWhatsAppSentStatus,
  loadWhatsAppSentByLeadId,
  type WhatsAppSentStatus,
} from "../outreach/whatsapp-sent.js";
import type { Lead, LeadStatus } from "../types/index.js";
import { dataDir } from "../utils/paths.js";

export const STATUS_ORDER: LeadStatus[] = [
  "scraped",
  "qualified",
  "named",
  "site_generated",
  "walkthrough_ready",
  "outreach_ready",
  "rejected",
  "error",
];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  scraped: "Scraped",
  qualified: "Qualified",
  named: "Named",
  site_generated: "Site generated",
  walkthrough_ready: "Claim ready",
  outreach_ready: "Outreach ready",
  rejected: "Rejected",
  error: "Error",
};

export type MenuOwnership = "none" | "template" | "owned";

export interface DashboardLead {
  id: string;
  slug: string;
  name: string;
  status: LeadStatus;
  statusLabel: string;
  metro: string;
  city: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  ownerFirstName: string | null;
  siteUrl: string | null;
  claimUrl: string | null;
  hasSite: boolean;
  hasKit: boolean;
  hasMenu: boolean;
  /** none = no menu files; template = placeholder; owned = owner draft applied */
  menuOwnership: MenuOwnership;
  hasClaim: boolean;
  /** ISO timestamps from outreach WhatsApp sent logs (null = not opened). */
  waFirstAt: string | null;
  waPriceAt: string | null;
  waCloseAt: string | null;
  error: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface DashboardWaCounts {
  first: number;
  price: number;
  close: number;
  /** outreach_ready with phone-ready stage but no first WA open logged */
  unsent: number;
}

export interface DashboardPayload {
  generatedAt: string;
  total: number;
  counts: Record<string, number>;
  waCounts: DashboardWaCounts;
  menuOwnedCount: number;
  leads: DashboardLead[];
}

function resolveMenuOwnership(slug: string): {
  hasMenu: boolean;
  menuOwnership: MenuOwnership;
} {
  const hasMenu = menuExists(slug);
  if (!hasMenu && !readMenuData(slug)) {
    return { hasMenu: false, menuOwnership: "none" };
  }
  if (isMenuOwned(slug)) {
    return { hasMenu: true, menuOwnership: "owned" };
  }
  return {
    hasMenu: hasMenu || Boolean(readMenuData(slug)),
    menuOwnership: "template",
  };
}

function toDashboardLead(
  lead: Lead,
  wa: WhatsAppSentStatus,
): DashboardLead {
  const menu = resolveMenuOwnership(lead.slug);
  return {
    id: lead.id,
    slug: lead.slug,
    name: lead.place.name,
    status: lead.status,
    statusLabel: STATUS_LABELS[lead.status] ?? lead.status,
    metro: lead.place.metroId,
    city: lead.place.city,
    phone: lead.place.phone,
    rating: lead.place.rating,
    reviewCount: lead.place.reviewCount,
    ownerFirstName: lead.ownerFirstName,
    siteUrl: lead.siteUrl,
    claimUrl: lead.claimUrl,
    hasSite: siteHtmlExists(lead.slug) || Boolean(lead.sitePath),
    hasKit: kitExists(lead.slug),
    hasMenu: menu.hasMenu,
    menuOwnership: menu.menuOwnership,
    hasClaim: Boolean(lead.claimPath),
    waFirstAt: wa.firstAt,
    waPriceAt: wa.priceAt,
    waCloseAt: wa.closeAt,
    error: lead.error,
    updatedAt: lead.updatedAt,
    createdAt: lead.createdAt,
  };
}

export function buildDashboardPayload(): DashboardPayload {
  const waById = loadWhatsAppSentByLeadId();
  const leads = listLeads().map((lead) =>
    toDashboardLead(lead, waById.get(lead.id) ?? emptyWhatsAppSentStatus()),
  );
  const counts = statusCounts();
  for (const status of STATUS_ORDER) {
    if (counts[status] == null) counts[status] = 0;
  }

  const waCounts: DashboardWaCounts = {
    first: leads.filter((l) => l.waFirstAt).length,
    price: leads.filter((l) => l.waPriceAt).length,
    close: leads.filter((l) => l.waCloseAt).length,
    unsent: leads.filter(
      (l) => l.status === "outreach_ready" && !l.waFirstAt,
    ).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    total: leads.length,
    counts,
    waCounts,
    menuOwnedCount: leads.filter((l) => l.menuOwnership === "owned").length,
    leads,
  };
}

/** Persist a snapshot after pipeline events (optional offline read). */
export function writeDashboardSnapshot(payload?: DashboardPayload): DashboardPayload {
  const data = payload ?? buildDashboardPayload();
  const dir = dataDir("dashboard");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    dataDir("dashboard", "latest.json"),
    JSON.stringify(data, null, 2),
    "utf8",
  );
  return data;
}
