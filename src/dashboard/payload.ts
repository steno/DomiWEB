import { writeFileSync, mkdirSync } from "node:fs";
import { listLeads, statusCounts } from "../db/store.js";
import { kitExists, siteHtmlExists } from "../generate/review-kit.js";
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
  hasClaim: boolean;
  error: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface DashboardPayload {
  generatedAt: string;
  total: number;
  counts: Record<string, number>;
  leads: DashboardLead[];
}

function toDashboardLead(lead: Lead): DashboardLead {
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
    hasClaim: Boolean(lead.claimPath),
    error: lead.error,
    updatedAt: lead.updatedAt,
    createdAt: lead.createdAt,
  };
}

export function buildDashboardPayload(): DashboardPayload {
  const leads = listLeads().map(toDashboardLead);
  const counts = statusCounts();
  for (const status of STATUS_ORDER) {
    if (counts[status] == null) counts[status] = 0;
  }
  return {
    generatedAt: new Date().toISOString(),
    total: leads.length,
    counts,
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
