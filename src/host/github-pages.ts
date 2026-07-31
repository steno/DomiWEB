import type { NicheConfig } from "../types/index.js";

/**
 * GitHub Pages URL helpers.
 * Sites live under public/sites/<slug>/index.html
 * Claim pages live under public/claim/<slug>/index.html
 * Deployed via .github/workflows/pages.yml → https://<user>.github.io/<repo>/
 */
export function sitePublicPath(slug: string): string {
  return `sites/${slug}/index.html`;
}

export function claimPublicPath(slug: string): string {
  return `claim/${slug}/index.html`;
}

export function absoluteSiteUrl(config: NicheConfig, slug: string): string | null {
  const base = config.hosting.baseUrl?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/${config.hosting.sitesPath}/${slug}/`;
}

export function absoluteClaimUrl(config: NicheConfig, slug: string): string | null {
  const base = config.hosting.baseUrl?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/${config.hosting.claimPath}/${slug}/`;
}

export function pagesSetupInstructions(repoUrl?: string): string {
  return [
    "GitHub Pages setup",
    "------------------",
    "1. Push this repo to GitHub.",
    "2. Settings → Pages → Source: GitHub Actions.",
    "3. Set GITHUB_PAGES_BASE_URL in .env, e.g.:",
    "   https://steno.github.io/DomiWEB",
    "4. After generating sites/claim pages into public/, push — the workflow deploys public/.",
    repoUrl ? `5. Repo: ${repoUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
