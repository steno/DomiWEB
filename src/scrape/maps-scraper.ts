import { ApifyClient } from "apify-client";
import type {
  CityConfig,
  NicheConfig,
  PlacePhoto,
  Review,
  ScrapedPlace,
} from "../types/index.js";
import { log } from "../utils/logger.js";

const DEFAULT_ACTOR =
  process.env.APIFY_GOOGLE_MAPS_ACTOR?.trim() ||
  "compass/crawler-google-places";

interface ApifyReview {
  name?: string;
  text?: string;
  stars?: number;
  publishedAtDate?: string;
  publishAt?: string;
  responseFromOwnerText?: string;
}

interface ApifyPlace {
  placeId?: string;
  title?: string;
  categoryName?: string;
  categories?: string[];
  address?: string;
  city?: string;
  phone?: string;
  website?: string | null;
  totalScore?: number;
  reviewsCount?: number;
  reviews?: ApifyReview[];
  imageUrls?: string[];
  imagesCount?: number;
  url?: string;
  location?: { lat?: number; lng?: number };
}

function mapReviews(raw: ApifyReview[] | undefined): Review[] {
  if (!raw?.length) return [];
  return raw
    .filter((r) => (r.text ?? "").trim().length > 0 || typeof r.stars === "number")
    .map((r) => ({
      author: (r.name ?? "Anónimo").trim() || "Anónimo",
      rating: typeof r.stars === "number" ? r.stars : 0,
      text: (r.text ?? "").trim(),
      publishedAt: r.publishedAtDate ?? r.publishAt ?? null,
      ownerResponse: r.responseFromOwnerText?.trim() || null,
    }));
}

function mapPhotos(raw: ApifyPlace): PlacePhoto[] {
  const urls = raw.imageUrls ?? [];
  return urls.filter(Boolean).map((url) => ({ url }));
}

function normalizePlace(
  raw: ApifyPlace,
  metro: CityConfig,
  searchQuery: string,
): ScrapedPlace | null {
  const name = raw.title?.trim();
  const placeId = raw.placeId?.trim();
  if (!name || !placeId) return null;

  return {
    placeId,
    name,
    category: raw.categoryName ?? null,
    categories: raw.categories ?? [],
    address: raw.address ?? null,
    city: raw.city ?? metro.name,
    phone: raw.phone ?? null,
    website: raw.website ?? null,
    rating: typeof raw.totalScore === "number" ? raw.totalScore : null,
    reviewCount:
      typeof raw.reviewsCount === "number" ? raw.reviewsCount : null,
    reviews: mapReviews(raw.reviews),
    photos: mapPhotos(raw),
    googleMapsUrl: raw.url ?? null,
    lat: raw.location?.lat ?? null,
    lng: raw.location?.lng ?? null,
    scrapedAt: new Date().toISOString(),
    searchQuery,
    metroId: metro.id,
  };
}

function getClient(): ApifyClient {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "APIFY_TOKEN is missing. Copy .env.example → .env and add your Apify token.",
    );
  }
  return new ApifyClient({ token });
}

/**
 * Scrape one city/metro via Apify Google Maps Places crawler.
 * Returns raw places (not yet qualified).
 */
export async function scrapeCity(
  config: NicheConfig,
  metro: CityConfig,
): Promise<ScrapedPlace[]> {
  const client = getClient();
  const places: ScrapedPlace[] = [];
  const seen = new Set<string>();

  for (const searchQuery of metro.searchQueries) {
    log.info(`Apify · ${metro.name} · “${searchQuery}” (max ${metro.maxResults})`);

    const run = await client.actor(DEFAULT_ACTOR).call(
      {
        searchStringsArray: [searchQuery],
        maxCrawledPlacesPerSearch: metro.maxResults,
        language: config.scrape.language,
        maxReviews: config.scrape.reviewsPerPlace,
        maxImages: Math.max(config.qualification.minPhotos, 10),
        scrapeReviewsPersonalData: false,
        website: "allPlaces",
        skipClosedPlaces: true,
      },
      {
        waitSecs: 60 * 30,
      },
    );

    const { items } = await client.dataset(run.defaultDatasetId!).listItems({
      limit: 10_000,
    });

    for (const item of items as ApifyPlace[]) {
      const place = normalizePlace(item, metro, searchQuery);
      if (!place) continue;
      if (seen.has(place.placeId)) continue;
      seen.add(place.placeId);
      places.push(place);
    }

    log.ok(
      `${metro.name}: +${items.length} raw → ${places.length} unique so far`,
    );
  }

  return places;
}

/** Scrape all configured cities (or a filtered subset by metro id). */
export async function scrapeAll(
  config: NicheConfig,
  metroFilter?: string[],
): Promise<ScrapedPlace[]> {
  const metros = metroFilter?.length
    ? config.cities.filter((c) => metroFilter.includes(c.id))
    : config.cities;

  if (!metros.length) {
    throw new Error(
      `No cities matched filter: ${metroFilter?.join(", ") ?? "(none)"}`,
    );
  }

  const all: ScrapedPlace[] = [];
  const seen = new Set<string>();

  for (const metro of metros) {
    const batch = await scrapeCity(config, metro);
    for (const p of batch) {
      if (seen.has(p.placeId)) continue;
      seen.add(p.placeId);
      all.push(p);
    }
  }

  return all;
}
