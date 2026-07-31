---
name: domiweb-pipeline
description: >-
  Runs the DomiWEB Walkthrough Machine for Dominican Republic local businesses
  (talleres, restaurants): Apify scrape, qualify, owner names, HTML sites,
  digital menus + QR, review-reply kits, claim pages, WhatsApp outreach,
  pricing follow-up, and GitHub Pages deploy. Use when the user mentions DomiWEB,
  scrape, qualify, generate-sites, generate-menus, generate-review-kit,
  claim-pages, outreach, send-whatsapp, wa.me, RD$ pricing, or publishing
  public/sites, public/menus, or public/kits.
---

# DomiWEB pipeline

Repo: Walkthrough Machine for RD businesses (default niche: talleres mecánicos).  
Content language: **es-DO**. Code/docs: English.  
Pages: `https://steno.github.io/DomiWEB/`

## Product strategy (money)

One repo. Multiple **product types** (templates), not separate projects.  
No marketing homepage of every service for outbound — the live asset is the pitch.

| Priority | Product | Config | Price field |
|----------|---------|--------|-------------|
| Cash now | `site` (talleres) | `niche.config.json` | `onceLabel` RD$2,000 |
| Ship next | `menu` (restaurants) | `niche.restaurantes.json` | `menuOnceLabel` RD$1,500 |
| Lighter SKU | `reviewKit` | same scrape | `reviewKitOnceLabel` RD$800 |

Do **not** fragment into new repos. Add templates + niche configs here.

## When to use

- Live scrape / qualify / sites / menus / review kits / claims / WhatsApp
- Pricing or outreach copy changes
- Pushing `public/sites` + `public/menus` + `public/kits` + `public/claim` for Pages

Read this skill before inventing new CLI flags or re-explaining the funnel.

## Env (`.env`, never commit)

Required for live work: `APIFY_TOKEN`, `OPENAI_API_KEY`, `GITHUB_PAGES_BASE_URL`, `FAL_KEY` (video).  
Claim CTA: set `CLAIM_WHATSAPP` (your number) so claim CTAs open WhatsApp to you. Optional: `CLAIM_INBOX`.  
Close kit (after yes): `TRANSFER_BANK`, `TRANSFER_ACCOUNT`, `TRANSFER_NAME` (+ optional `DELIVERY_HOURS`).

## Commands (run from repo root)

```bash
npm run status
npm run dashboard
npm run scrape
npm run scrape -- -c config/niche.restaurantes.json -m santo-domingo
npm run extract-names -- --limit 10
npm run generate-sites -- --limit 10
npm run generate-menus -- --limit 10
npm run generate-review-kit -- --limit 10
npm run claim-pages -- --limit 10
npm run claim-pages -- --product menu --limit 10
npm run claim-pages -- --product reviewKit --limit 10
npm run outreach -- --force
npm run outreach -- --product menu --force
npm run send-whatsapp
npm run send-whatsapp -- --slug <slug>
npm run send-whatsapp -- --product menu --price --slug <slug>
npm run send-whatsapp -- --product menu --close --slug <slug>
npm run send-whatsapp -- --to +1XXXXXXXXXX
npm run send-whatsapp -- --batch --limit 10
npm run generate-video -- --lipsync
```

`--force` on outreach/sites/menus/kits when status is already past that stage.  
Fixture phones `809-555-…` are **not** on WhatsApp — use scrape or `--to`.

## Funnel order

### Full site (flagship)

1. scrape → qualify
2. extract-names
3. generate-sites
4. claim-pages
5. outreach
6. send-whatsapp → `--price` → `--close`
7. Commit + push `public/` before first WA

### Digital menu + QR (restaurants)

1. scrape with `-c config/niche.restaurantes.json`
2. extract-names
3. `generate-menus` → `public/menus/<slug>/`
4. `claim-pages --product menu`
5. `outreach --product menu`
6. `send-whatsapp --product menu` → `--price` → `--close`

Placeholder dishes are examples — never invent real prices as facts.

### Review-reply kit (lighter SKU)

1. scrape → qualify → extract-names
2. `generate-review-kit` → `public/kits/<slug>/`
3. `claim-pages --product reviewKit`
4. `outreach --product reviewKit`
5. `send-whatsapp --product reviewKit` → `--price` → `--close`

## Pricing (do not put in first WA)

| Field | Default |
|-------|---------|
| `onceLabel` | `RD$2,000` (sitio) |
| `menuOnceLabel` | `RD$1,500` (menú + QR) |
| `reviewKitOnceLabel` | `RD$800` (kit) |

## Conversion rules

- Prefer Spanish Google quotes in WA
- Never greet with fake names
- Claim CTA only to `CLAIM_WHATSAPP`
- One outreach message per business
- Menu: placeholder items + honesty footer

## Product rules

- Photographic sites/menus (see site-design-imagery rule)
- No invented years, prices, awards, fake reviews
- Track `public/sites/**`, `public/menus/**`, `public/kits/**`, `public/claim/**` in git

## Status check

```bash
npm run status
npm run dashboard
```
