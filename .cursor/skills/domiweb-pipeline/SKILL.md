---
name: domiweb-pipeline
description: >-
  Runs the DomiWEB Walkthrough Machine for Dominican Republic restaurants:
  Apify scrape, qualify, owner names, digital menus + QR, claim pages,
  WhatsApp outreach, pricing follow-up, and GitHub Pages deploy. Use when the
  user mentions DomiWEB, scrape, qualify, generate-menus, claim-pages,
  outreach, send-whatsapp, wa.me, RD$ pricing, or publishing public/menus or
  public/claim.
---

# DomiWEB pipeline

Repo: Walkthrough Machine for RD **restaurants** (digital menu + QR + WhatsApp order).  
Content language: **es-DO**. Code/docs: English.  
Pages: `https://steno.github.io/DomiWEB/`

## Product strategy (money)

**One product:** digital menu + QR + WhatsApp ordering.  
Default niche config: `config/niche.config.json` (= restaurantes).  
Archived taller configs: `config/niche.talleres.json` (do not use unless the user explicitly asks).

| Product | When | Price field |
|---------|------|-------------|
| `menu` (default) | Always for food businesses | `menuOnceLabel` RD$1,500 |
| `reviewKit` | Only if user explicitly asks | `reviewKitOnceLabel` RD$800 |
| `site` | Only if user explicitly asks for a full website | `onceLabel` RD$2,000 |

Do **not** scrape talleres, run `generate-sites` by default, or pitch websites for food places.

### Default product (do not ask)

- **Restaurants, cafés, beach food, mariscos, chimis, bars with food** → always the **digital menu + QR + WhatsApp order** funnel (`generate-menus` → `claim-pages` → `outreach` → `send-whatsapp`).  
  If the user says “claim site”, “create a site”, or “scan and claim” for a food business, still ship **menu**, not `generate-sites`.
- Only use `generate-sites` if the user **explicitly** asks for a website instead of (or in addition to) the menu.

## When to use

- Live scrape / qualify / menus / claims / WhatsApp
- Pricing or outreach copy changes
- Pushing `public/menus` + `public/claim` (+ `public/edit-menu` when relevant) for Pages

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
npm run scrape -- -m santo-domingo
npm run extract-names -- --limit 10
npm run generate-menus -- --limit 10
npm run claim-pages -- --limit 10
npm run outreach -- --force
npm run send-whatsapp
npm run send-whatsapp -- --slug <slug>
npm run send-whatsapp -- --price --slug <slug>
npm run send-whatsapp -- --close --slug <slug>
npm run send-whatsapp -- --to +1XXXXXXXXXX
npm run send-whatsapp -- --batch --limit 10
```

`--product` defaults to **menu**. Pass `--product site` / `--product reviewKit` only when explicitly requested.  
`--force` on outreach/menus/claims when status is already past that stage.  
Fixture phones `809-555-…` are **not** on WhatsApp — use scrape or `--to`.

## Funnel order

### Digital menu + QR (default)

1. scrape (default = restaurantes niche)
2. extract-names
3. `generate-menus` → `public/menus/<slug>/`
4. `claim-pages` (auto → menu)
5. `outreach`
6. `send-whatsapp` → `--price` → `--close`
7. Commit + push `public/menus`, `public/claim`, `public/edit-menu` before first WA

Placeholder dishes are examples — never invent real prices as facts.

### Review-reply kit / full site (opt-in only)

Only when the user explicitly asks. Same scrape → then `generate-review-kit` or `generate-sites` → claim/outreach with `--product reviewKit` or `--product site`.

## Pricing (do not put in first WA)

| Field | Default |
|-------|---------|
| `menuOnceLabel` | `RD$1,500` (menú + QR) |
| `reviewKitOnceLabel` | `RD$800` (kit, opt-in) |
| `onceLabel` | `RD$2,000` (sitio, opt-in) |

## Conversion rules

- Prefer Spanish Google quotes in WA
- Never greet with fake names
- Claim CTA only to `CLAIM_WHATSAPP`
- One outreach message per business
- Menu: placeholder items + honesty footer
- **Outreach URL = claim only** (`/claim/<slug>/`). Do not lead with `/menus/<slug>/` — claim embeds menu + edit + QR.
- **Pretty product share** (ads, Facebook, generic pitch): `https://tinyurl.com/domenus` → splash `menu-digital/`. Override with `MENU_SHARE_URL` in `.env`. Never use the long GitHub Pages splash URL in promo copy.

## Product rules

- Photographic menus (see site-design-imagery rule)
- No invented years, prices, awards, fake reviews
- Track `public/menus/**`, `public/claim/**`, `public/edit-menu/**` in git

## Status check

```bash
npm run status
npm run dashboard
```
