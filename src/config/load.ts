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
    minReviews: z.number().int().positive().default(8),
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
    kitsPath: z.string().default("kits"),
    menusPath: z.string().default("menus"),
  }),
  pricing: z
    .object({
      onceLabel: z.string().default("RD$2,000"),
      hostingNote: z
        .string()
        .default("si lo necesitas, lo hablamos aparte"),
      reviewKitOnceLabel: z.string().default("RD$800"),
      menuOnceLabel: z.string().default("RD$1,500"),
    })
    .default({
      onceLabel: "RD$2,000",
      hostingNote: "si lo necesitas, lo hablamos aparte",
      reviewKitOnceLabel: "RD$800",
      menuOnceLabel: "RD$1,500",
    }),
  products: z
    .object({
      reviewKit: z
        .object({
          enabled: z.boolean().default(true),
          maxReplies: z.number().int().positive().default(8),
        })
        .default({ enabled: true, maxReplies: 8 }),
      menu: z
        .object({
          enabled: z.boolean().default(true),
          categories: z
            .array(
              z.object({
                id: z.string().min(1),
                label: z.string().min(1),
                items: z
                  .array(
                    z.object({
                      name: z.string().min(1),
                      note: z.string().optional(),
                      priceHint: z.string().optional(),
                    }),
                  )
                  .optional(),
              }),
            )
            .optional(),
        })
        .default({ enabled: true }),
    })
    .default({
      reviewKit: { enabled: true, maxReplies: 8 },
      menu: { enabled: true },
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
): {
  siteUrl: string | null;
  claimUrl: string | null;
  kitUrl: string | null;
  menuUrl: string | null;
} {
  const base = config.hosting.baseUrl?.replace(/\/$/, "");
  if (!base) {
    return { siteUrl: null, claimUrl: null, kitUrl: null, menuUrl: null };
  }
  const kitsPath = config.hosting.kitsPath ?? "kits";
  const menusPath = config.hosting.menusPath ?? "menus";
  return {
    siteUrl: `${base}/${config.hosting.sitesPath}/${slug}/index.html`,
    claimUrl: `${base}/${config.hosting.claimPath}/${slug}/`,
    kitUrl: `${base}/${kitsPath}/${slug}/`,
    menuUrl: `${base}/${menusPath}/${slug}/`,
  };
}

export function priceOnceForProduct(
  config: NicheConfig,
  product: "site" | "reviewKit" | "menu" = "site",
): string {
  if (product === "reviewKit") {
    return config.pricing.reviewKitOnceLabel ?? "RD$800";
  }
  if (product === "menu") {
    return config.pricing.menuOnceLabel ?? "RD$1,500";
  }
  return config.pricing.onceLabel ?? "RD$2,000";
}
