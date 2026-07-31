/** Shared types for the DomiWEB Walkthrough Machine pipeline. */

export type LeadStatus =
  | "scraped"
  | "qualified"
  | "rejected"
  | "named"
  | "site_generated"
  | "walkthrough_ready"
  | "outreach_ready"
  | "error";

export interface Review {
  author: string;
  rating: number;
  text: string;
  publishedAt: string | null;
  ownerResponse: string | null;
}

export interface PlacePhoto {
  url: string;
  width?: number;
  height?: number;
}

export interface ScrapedPlace {
  placeId: string;
  name: string;
  category: string | null;
  categories: string[];
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  reviews: Review[];
  photos: PlacePhoto[];
  googleMapsUrl: string | null;
  lat: number | null;
  lng: number | null;
  scrapedAt: string;
  searchQuery: string;
  metroId: string;
}

export interface QualificationResult {
  ok: boolean;
  reasons: string[];
  hasNoRealWebsite: boolean;
  hasRecentReview: boolean;
}

export interface Lead {
  id: string;
  slug: string;
  status: LeadStatus;
  place: ScrapedPlace;
  qualification: QualificationResult;
  ownerFirstName: string | null;
  ownerNameConfidence: number | null;
  sitePath: string | null;
  claimPath: string | null;
  claimUrl: string | null;
  siteUrl: string | null;
  outreachQuote: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface NicheConfig {
  language: string;
  country: string;
  countryName: string;
  niche: {
    id: string;
    label: string;
    labelSingular: string;
    keywords: string[];
    categoryHints: string[];
    chainBlocklist: string[];
    /** Local illustrative image paths (under public/) when Google photos missing */
    illustrativeImages?: string[];
  };
  cities: CityConfig[];
  qualification: {
    minRating: number;
    minReviews: number;
    minPhotos: number;
    recentReviewDays: number;
    allowSocialOnlyWebsite: boolean;
    socialWebsiteHosts: string[];
  };
  scrape: {
    reviewsPerPlace: number;
    language: string;
    maxConcurrency: number;
  };
  hosting: {
    provider: "github-pages";
    baseUrl: string;
    sitesPath: string;
    claimPath: string;
  };
}

export interface CityConfig {
  id: string;
  name: string;
  searchQueries: string[];
  maxResults: number;
}

export interface ScrapeRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  metroIds: string[];
  totalScraped: number;
  totalQualified: number;
  totalRejected: number;
  outputPath: string;
}
