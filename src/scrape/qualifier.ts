import type {
  NicheConfig,
  QualificationResult,
  Review,
  ScrapedPlace,
} from "../types/index.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** True when website is missing or only Facebook/Instagram. */
export function hasNoRealWebsite(
  website: string | null | undefined,
  socialHosts: string[],
): boolean {
  if (!website || !website.trim()) return true;
  const host = hostnameOf(website.trim());
  if (!host) return true;
  return socialHosts.some(
    (s) => host === s.toLowerCase() || host.endsWith(`.${s.toLowerCase()}`),
  );
}

function parseReviewDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function hasRecentReview(
  reviews: Review[],
  withinDays: number,
  now = new Date(),
): boolean {
  const cutoff = now.getTime() - withinDays * MS_PER_DAY;
  return reviews.some((r) => {
    const d = parseReviewDate(r.publishedAt);
    return d !== null && d.getTime() >= cutoff;
  });
}

function isChain(name: string, blocklist: string[]): boolean {
  const n = name.toLowerCase();
  return blocklist.some((b) => n.includes(b.toLowerCase()));
}

function looksOnNiche(place: ScrapedPlace, config: NicheConfig): boolean {
  const hay = [
    place.name,
    place.category ?? "",
    ...place.categories,
  ]
    .join(" ")
    .toLowerCase();

  const keywords = config.niche.keywords.map((k) => k.toLowerCase());
  const hints = config.niche.categoryHints.map((k) => k.toLowerCase());

  return [...keywords, ...hints].some((k) => hay.includes(k));
}

/**
 * Hard qualification gates from the Walkthrough Machine guide:
 * - No website OR website is only Facebook/Instagram
 * - ≥ minRating stars
 * - ≥ minReviews
 * - ≥ 1 review in last recentReviewDays
 * - ≥ minPhotos
 * - Not a chain / not off-niche
 */
export function qualifyPlace(
  place: ScrapedPlace,
  config: NicheConfig,
  now = new Date(),
): QualificationResult {
  const q = config.qualification;
  const reasons: string[] = [];

  const noWebsite = hasNoRealWebsite(
    place.website,
    q.socialWebsiteHosts,
  );
  if (!noWebsite) {
    reasons.push(`Tiene sitio web propio: ${place.website}`);
  }

  const rating = place.rating ?? 0;
  if (rating < q.minRating) {
    reasons.push(`Rating ${rating} < ${q.minRating}`);
  }

  const reviewCount = place.reviewCount ?? place.reviews.length;
  if (reviewCount < q.minReviews) {
    reasons.push(`Reviews ${reviewCount} < ${q.minReviews}`);
  }

  const recent = hasRecentReview(place.reviews, q.recentReviewDays, now);
  if (!recent) {
    reasons.push(`Sin reseña en los últimos ${q.recentReviewDays} días`);
  }

  if (place.photos.length < q.minPhotos) {
    reasons.push(`Fotos ${place.photos.length} < ${q.minPhotos}`);
  }

  if (isChain(place.name, config.niche.chainBlocklist)) {
    reasons.push("Parece cadena / franquicia (blocklist)");
  }

  if (!looksOnNiche(place, config)) {
    reasons.push("Fuera de nicho (keywords/categorías no coinciden)");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    hasNoRealWebsite: noWebsite,
    hasRecentReview: recent,
  };
}
