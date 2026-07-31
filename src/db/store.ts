import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { stringify } from "csv-stringify/sync";
import type {
  Lead,
  NicheConfig,
  QualificationResult,
  ScrapedPlace,
  ScrapeRunSummary,
} from "../types/index.js";
import { resolveGithubPagesUrls } from "../config/load.js";
import { dataDir } from "../utils/paths.js";
import { leadIdFromPlace, slugify } from "../utils/slug.js";

function ensureDirs() {
  for (const p of [
    dataDir("leads"),
    dataDir("raw"),
    dataDir("db"),
    dataDir("sites"),
    dataDir("videos"),
    dataDir("walkthroughs"),
    dataDir("outreach"),
  ]) {
    mkdirSync(p, { recursive: true });
  }
}

function dbPath(): string {
  ensureDirs();
  return dataDir("db", "leads.sqlite");
}

function openDb(): Database.Database {
  const db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      status TEXT NOT NULL,
      place_json TEXT NOT NULL,
      qualification_json TEXT NOT NULL,
      owner_first_name TEXT,
      owner_name_confidence REAL,
      site_path TEXT,
      claim_path TEXT,
      claim_url TEXT,
      site_url TEXT,
      outreach_quote TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_slug ON leads(slug);
  `);
  return db;
}

function rowToLead(row: Record<string, unknown>): Lead {
  return {
    id: row.id as string,
    slug: row.slug as string,
    status: row.status as Lead["status"],
    place: JSON.parse(row.place_json as string) as ScrapedPlace,
    qualification: JSON.parse(
      row.qualification_json as string,
    ) as QualificationResult,
    ownerFirstName: (row.owner_first_name as string) ?? null,
    ownerNameConfidence:
      row.owner_name_confidence != null
        ? Number(row.owner_name_confidence)
        : null,
    sitePath: (row.site_path as string) ?? null,
    claimPath: (row.claim_path as string) ?? null,
    claimUrl: (row.claim_url as string) ?? null,
    siteUrl: (row.site_url as string) ?? null,
    outreachQuote: (row.outreach_quote as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    error: (row.error as string) ?? null,
  };
}

function uniqueSlug(db: Database.Database, base: string, id: string): string {
  let slug = base || `negocio-${id.slice(0, 8)}`;
  const exists = db.prepare("SELECT 1 FROM leads WHERE slug = ? AND id != ?");
  let n = 2;
  while (exists.get(slug, id)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export function upsertScrapedLeads(
  places: ScrapedPlace[],
  qualifications: Map<string, QualificationResult>,
  config: NicheConfig,
): Lead[] {
  const db = openDb();
  const now = new Date().toISOString();
  const results: Lead[] = [];

  const select = db.prepare("SELECT * FROM leads WHERE id = ?");
  const insert = db.prepare(`
    INSERT INTO leads (
      id, slug, status, place_json, qualification_json,
      owner_first_name, owner_name_confidence,
      site_path, claim_path, claim_url, site_url, outreach_quote,
      created_at, updated_at, error
    ) VALUES (
      @id, @slug, @status, @place_json, @qualification_json,
      @owner_first_name, @owner_name_confidence,
      @site_path, @claim_path, @claim_url, @site_url, @outreach_quote,
      @created_at, @updated_at, @error
    )
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      status = excluded.status,
      place_json = excluded.place_json,
      qualification_json = excluded.qualification_json,
      updated_at = excluded.updated_at,
      error = excluded.error
  `);

  const tx = db.transaction(() => {
    for (const place of places) {
      const id = leadIdFromPlace(place.placeId, place.metroId);
      const qual = qualifications.get(place.placeId) ?? {
        ok: false,
        reasons: ["missing qualification"],
        hasNoRealWebsite: false,
        hasRecentReview: false,
      };
      const existing = select.get(id) as Record<string, unknown> | undefined;
      const baseSlug = slugify(place.name);
      const slug = uniqueSlug(db, baseSlug, id);
      const urls = resolveGithubPagesUrls(config, slug);
      const status = qual.ok ? "qualified" : "rejected";

      const lead: Lead = {
        id,
        slug,
        status,
        place,
        qualification: qual,
        ownerFirstName: existing
          ? ((existing.owner_first_name as string) ?? null)
          : null,
        ownerNameConfidence: existing
          ? existing.owner_name_confidence != null
            ? Number(existing.owner_name_confidence)
            : null
          : null,
        sitePath: existing ? ((existing.site_path as string) ?? null) : null,
        claimPath: existing ? ((existing.claim_path as string) ?? null) : null,
        claimUrl: urls.claimUrl,
        siteUrl: urls.siteUrl,
        outreachQuote: existing
          ? ((existing.outreach_quote as string) ?? null)
          : null,
        createdAt: existing ? (existing.created_at as string) : now,
        updatedAt: now,
        error: null,
      };

      insert.run({
        id: lead.id,
        slug: lead.slug,
        status: lead.status,
        place_json: JSON.stringify(lead.place),
        qualification_json: JSON.stringify(lead.qualification),
        owner_first_name: lead.ownerFirstName,
        owner_name_confidence: lead.ownerNameConfidence,
        site_path: lead.sitePath,
        claim_path: lead.claimPath,
        claim_url: lead.claimUrl,
        site_url: lead.siteUrl,
        outreach_quote: lead.outreachQuote,
        created_at: lead.createdAt,
        updated_at: lead.updatedAt,
        error: lead.error,
      });

      results.push(lead);
    }
  });

  tx();
  db.close();
  return results;
}

export function listLeads(status?: Lead["status"]): Lead[] {
  const db = openDb();
  const rows = status
    ? (db
        .prepare("SELECT * FROM leads WHERE status = ? ORDER BY updated_at DESC")
        .all(status) as Record<string, unknown>[])
    : (db
        .prepare("SELECT * FROM leads ORDER BY updated_at DESC")
        .all() as Record<string, unknown>[]);
  db.close();
  return rows.map(rowToLead);
}

/** Update owner first-name fields; marks qualified leads as `named` when a name is found. */
export function updateOwnerName(
  leadId: string,
  firstName: string | null,
  confidence: number | null,
): Lead | null {
  const db = openDb();
  const existing = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    db.close();
    return null;
  }

  const now = new Date().toISOString();
  const prevStatus = existing.status as Lead["status"];
  let status = prevStatus;
  if (prevStatus === "qualified" || prevStatus === "named") {
    status = firstName ? "named" : "qualified";
  }

  db.prepare(
    `UPDATE leads SET
      owner_first_name = @owner_first_name,
      owner_name_confidence = @owner_name_confidence,
      status = @status,
      updated_at = @updated_at
    WHERE id = @id`,
  ).run({
    id: leadId,
    owner_first_name: firstName,
    owner_name_confidence: confidence,
    status,
    updated_at: now,
  });

  const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | Record<string, unknown>
    | undefined;
  db.close();
  return row ? rowToLead(row) : null;
}

/** Persist generated site paths + outreach quote; status → site_generated. */
export function updateSiteGenerated(
  leadId: string,
  fields: {
    sitePath: string;
    claimPath?: string | null;
    siteUrl?: string | null;
    claimUrl?: string | null;
    outreachQuote?: string | null;
  },
): Lead | null {
  const db = openDb();
  const existing = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    db.close();
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE leads SET
      site_path = @site_path,
      claim_path = COALESCE(@claim_path, claim_path),
      site_url = COALESCE(@site_url, site_url),
      claim_url = COALESCE(@claim_url, claim_url),
      outreach_quote = COALESCE(@outreach_quote, outreach_quote),
      status = 'site_generated',
      updated_at = @updated_at,
      error = NULL
    WHERE id = @id`,
  ).run({
    id: leadId,
    site_path: fields.sitePath,
    claim_path: fields.claimPath ?? null,
    site_url: fields.siteUrl ?? null,
    claim_url: fields.claimUrl ?? null,
    outreach_quote: fields.outreachQuote ?? null,
    updated_at: now,
  });

  const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | Record<string, unknown>
    | undefined;
  db.close();
  return row ? rowToLead(row) : null;
}

/** Persist claim page paths; status → walkthrough_ready. */
export function updateWalkthroughReady(
  leadId: string,
  fields: {
    claimPath: string;
    claimUrl?: string | null;
    siteUrl?: string | null;
  },
): Lead | null {
  const db = openDb();
  const existing = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    db.close();
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE leads SET
      claim_path = @claim_path,
      claim_url = COALESCE(@claim_url, claim_url),
      site_url = COALESCE(@site_url, site_url),
      status = 'walkthrough_ready',
      updated_at = @updated_at,
      error = NULL
    WHERE id = @id`,
  ).run({
    id: leadId,
    claim_path: fields.claimPath,
    claim_url: fields.claimUrl ?? null,
    site_url: fields.siteUrl ?? null,
    updated_at: now,
  });

  const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | Record<string, unknown>
    | undefined;
  db.close();
  return row ? rowToLead(row) : null;
}

/** Mark lead outreach_ready; optionally refresh claim/site URLs + quote. */
export function updateOutreachReady(
  leadId: string,
  fields: {
    claimUrl?: string | null;
    siteUrl?: string | null;
    outreachQuote?: string | null;
  } = {},
): Lead | null {
  const db = openDb();
  const existing = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    db.close();
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE leads SET
      claim_url = COALESCE(@claim_url, claim_url),
      site_url = COALESCE(@site_url, site_url),
      outreach_quote = COALESCE(@outreach_quote, outreach_quote),
      status = 'outreach_ready',
      updated_at = @updated_at,
      error = NULL
    WHERE id = @id`,
  ).run({
    id: leadId,
    claim_url: fields.claimUrl ?? null,
    site_url: fields.siteUrl ?? null,
    outreach_quote: fields.outreachQuote ?? null,
    updated_at: now,
  });

  const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) as
    | Record<string, unknown>
    | undefined;
  db.close();
  return row ? rowToLead(row) : null;
}

export function listLeadsForOutreach(force = false, slug?: string): Lead[] {
  let leads = force
    ? [
        ...listLeads("walkthrough_ready"),
        ...listLeads("outreach_ready"),
        ...listLeads("site_generated"),
      ]
    : listLeads("walkthrough_ready");

  const seen = new Set<string>();
  leads = leads.filter((l) => {
    if (!l.sitePath) return false;
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
  if (slug) leads = leads.filter((l) => l.slug === slug);
  return leads;
}

export function listLeadsForClaimPages(force = false, slug?: string): Lead[] {
  let leads = force
    ? [
        ...listLeads("site_generated"),
        ...listLeads("walkthrough_ready"),
        ...listLeads("outreach_ready"),
      ]
    : listLeads("site_generated");

  const seen = new Set<string>();
  leads = leads.filter((l) => {
    if (!l.sitePath) return false;
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
  if (slug) leads = leads.filter((l) => l.slug === slug);
  return leads;
}

/** Leads ready for site generation: named preferred, else qualified. */
export function listLeadsForSiteGen(force = false, slug?: string): Lead[] {
  let leads: Lead[];
  if (force) {
    leads = [
      ...listLeads("qualified"),
      ...listLeads("named"),
      ...listLeads("site_generated"),
      ...listLeads("walkthrough_ready"),
      ...listLeads("outreach_ready"),
    ];
  } else {
    leads = [...listLeads("named"), ...listLeads("qualified")];
  }
  // Dedupe by id (force can overlap statuses in theory)
  const seen = new Set<string>();
  leads = leads.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
  if (slug) {
    leads = leads.filter((l) => l.slug === slug);
  }
  return leads;
}

export function statusCounts(): Record<string, number> {
  const db = openDb();
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM leads GROUP BY status")
    .all() as { status: string; n: number }[];
  db.close();
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export function exportQualifiedJsonCsv(
  leads: Lead[],
  stamp: string,
): { jsonPath: string; csvPath: string } {
  ensureDirs();
  const qualified = leads.filter(
    (l) => l.status === "qualified" || l.status === "named",
  );
  const jsonPath = dataDir("leads", `qualified-${stamp}.json`);
  const csvPath = dataDir("leads", `qualified-${stamp}.csv`);

  writeFileSync(jsonPath, JSON.stringify(qualified, null, 2), "utf8");

  const rows = qualified.map((l) => ({
    id: l.id,
    slug: l.slug,
    name: l.place.name,
    ownerFirstName: l.ownerFirstName ?? "",
    ownerNameConfidence: l.ownerNameConfidence ?? "",
    metro: l.place.metroId,
    category: l.place.category ?? "",
    address: l.place.address ?? "",
    phone: l.place.phone ?? "",
    rating: l.place.rating ?? "",
    reviewCount: l.place.reviewCount ?? "",
    website: l.place.website ?? "",
    photos: l.place.photos.length,
    googleMapsUrl: l.place.googleMapsUrl ?? "",
    claimUrl: l.claimUrl ?? "",
    siteUrl: l.siteUrl ?? "",
  }));

  writeFileSync(
    csvPath,
    stringify(rows, { header: true }),
    "utf8",
  );

  return { jsonPath, csvPath };
}

export function saveRawScrape(
  places: ScrapedPlace[],
  stamp: string,
): string {
  ensureDirs();
  const path = dataDir("raw", `scrape-${stamp}.json`);
  writeFileSync(path, JSON.stringify(places, null, 2), "utf8");
  return path;
}

export function saveRunSummary(summary: ScrapeRunSummary): string {
  ensureDirs();
  const path = dataDir("leads", `run-${summary.runId}.json`);
  writeFileSync(path, JSON.stringify(summary, null, 2), "utf8");
  return path;
}
