import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { NicheConfig } from "../types/index.js";
import { projectRoot } from "../utils/paths.js";

const CitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  searchQueries: z.array(z.string().min(1)).min(1),
  maxResults: z.number().int().positive().default(50),
});

const ConfigSchema = z.object({
  language: z.string().default("es-DO"),
  country: z.string().default("DO"),
  countryName: z.string().default("República Dominicana"),
  niche: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    labelSingular: z.string().min(1),
    keywords: z.array(z.string()).min(1),
    categoryHints: z.array(z.string()).default([]),
    chainBlocklist: z.array(z.string()).default([]),
    illustrativeImages: z.array(z.string()).default([]),
  }),
  cities: z.array(CitySchema).min(1),
  qualification: z.object({
    minRating: z.number().min(0).max(5).default(4.0),
    minReviews: z.number().int().positive().default(20),
    minPhotos: z.number().int().nonnegative().default(5),
    recentReviewDays: z.number().int().positive().default(90),
    allowSocialOnlyWebsite: z.boolean().default(true),
    socialWebsiteHosts: z.array(z.string()).default([
      "facebook.com",
      "instagram.com",
    ]),
  }),
  scrape: z.object({
    reviewsPerPlace: z.number().int().positive().default(40),
    language: z.string().default("es"),
    maxConcurrency: z.number().int().positive().default(5),
  }),
  hosting: z.object({
    provider: z.literal("github-pages"),
    baseUrl: z.string().default(""),
    sitesPath: z.string().default("sites"),
    claimPath: z.string().default("claim"),
  }),
  pricing: z
    .object({
      onceLabel: z.string().default("RD$2,000"),
      hostingNote: z
        .string()
        .default("si lo necesitas, lo hablamos aparte"),
    })
    .default({
      onceLabel: "RD$2,000",
      hostingNote: "si lo necesitas, lo hablamos aparte",
    }),
});

export function loadConfig(configPath?: string): NicheConfig {
  const path = resolve(
    configPath ?? resolve(projectRoot(), "config", "niche.config.json"),
  );
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const parsed = ConfigSchema.parse(raw);

  // Prefer env override for GitHub Pages base URL
  const envBase = process.env.GITHUB_PAGES_BASE_URL?.trim();
  if (envBase) {
    parsed.hosting.baseUrl = envBase.replace(/\/$/, "");
  }

  return parsed as NicheConfig;
}

export function resolveGithubPagesUrls(
  config: NicheConfig,
  slug: string,
): { siteUrl: string | null; claimUrl: string | null } {
  const base = config.hosting.baseUrl?.replace(/\/$/, "");
  if (!base) {
    return { siteUrl: null, claimUrl: null };
  }
  return {
    siteUrl: `${base}/${config.hosting.sitesPath}/${slug}/index.html`,
    claimUrl: `${base}/${config.hosting.claimPath}/${slug}/`,
  };
}
