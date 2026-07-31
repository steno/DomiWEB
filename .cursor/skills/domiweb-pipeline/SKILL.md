---
name: domiweb-pipeline
description: >-
  Runs the DomiWEB Walkthrough Machine for Dominican Republic local businesses
  (talleres): Apify scrape, qualify, owner names, HTML sites, claim pages,
  WhatsApp outreach, pricing follow-up, and GitHub Pages deploy. Use when the
  user mentions DomiWEB, scrape, qualify, generate-sites, claim-pages,
  outreach, send-whatsapp, wa.me, RD$ pricing, or publishing public/sites.
---

# DomiWEB pipeline

Repo: Walkthrough Machine for RD businesses (default niche: talleres mecánicos).  
Content language: **es-DO**. Code/docs: English.  
Pages: `https://steno.github.io/DomiWEB/`

## When to use

- Live scrape / qualify / sites / claims / WhatsApp
- Pricing or outreach copy changes
- Pushing `public/sites` + `public/claim` for Pages

Read this skill before inventing new CLI flags or re-explaining the funnel.

## Env (`.env`, never commit)

Required for live work: `APIFY_TOKEN`, `OPENAI_API_KEY`, `GITHUB_PAGES_BASE_URL`, `FAL_KEY` (video).  
Claim CTA: set `CLAIM_WHATSAPP` (your number) so “Reclamar mi sitio” opens WhatsApp to you. Optional: `CLAIM_INBOX`.  
Close kit (after yes): `TRANSFER_BANK`, `TRANSFER_ACCOUNT`, `TRANSFER_NAME` (+ optional `DELIVERY_HOURS`).

## Commands (run from repo root)

```bash
npm run status
npm run scrape                              # Apify + qualify
npm run scrape -- -c config/niche.first-batch.json -m santo-domingo
npm run extract-names -- --limit 10
npm run generate-sites -- --limit 10
npm run claim-pages -- --limit 10
npm run outreach -- --force
npm run send-whatsapp                       # first contact (no price)
npm run send-whatsapp -- --slug <slug>
npm run send-whatsapp -- --price --slug <slug>   # AFTER interest only
npm run send-whatsapp -- --close --slug <slug>   # AFTER they say yes → bank details
npm run send-whatsapp -- --to +1XXXXXXXXXX  # redirect to a real phone (test)
npm run send-whatsapp -- --batch --limit 10
npm run generate-video -- --lipsync         # optional face-cam
```

`--force` on outreach/sites when status is already past that stage.  
Fixture phones `809-555-…` are **not** on WhatsApp — use scrape or `--to`.

## Funnel order

1. scrape → qualify (hard gates in `config/niche.config.json`)
2. extract-names (gpt-4o-mini)
3. generate-sites (crafted template default; Google photos)
4. claim-pages → `public/claim/<slug>/` (requires `CLAIM_WHATSAPP`)
5. outreach → CSV/JSON + `whatsapp.txt` + `whatsapp-price.txt` + `whatsapp-close.txt`
6. send-whatsapp (user hits Send in WhatsApp)
7. On interest → `send-whatsapp --price`
8. On yes → `send-whatsapp --close` (transfer details)
9. Commit + push `public/` so Pages serves claim URLs **before** first WA

Apify calls need `locationQuery` (city + country) — already in `maps-scraper.ts`.

## Pricing (do not put in first WA)

Config: `config/niche.config.json` → `pricing`

| Field | Default |
|-------|---------|
| `onceLabel` | `RD$2,000` (pago único — transfer site) |
| `hostingNote` | `si lo necesitas, lo hablamos aparte` (not in default price WA) |

Templates:

- First: `prompts/outreach-whatsapp.md` — no price; Spanish review quotes only
- Follow-up: `prompts/outreach-whatsapp-price.md` — only with `--price`
- Close: `prompts/outreach-whatsapp-close.md` — only with `--close` after yes

## Conversion rules

- Prefer Spanish Google quotes in WA; if none, generic “muy buenas opiniones” (never English tourist quotes)
- Never greet with fake names (`hola`, empty) — omit name
- Claim page: one CTA to you (`CLAIM_WHATSAPP`); no “WhatsApp del negocio”
- One outreach message per business; no fake scarcity

## Product rules

- Sites: photographic (see `.cursor/rules/site-design-imagery.mdc`)
- Honesty fences: no invented years, prices, awards, fake reviews
- Claim audio: muted preview; first click = restart from 0 + sound; labels “Click to listen” / “Mute”
- Track `public/sites/**` and `public/claim/**` in git (Pages); keep `data/**` runtime dumps gitignored

## After generating real sites

1. `git add` sites/claims + code as needed  
2. Commit when user asks; push `main` → Actions deploys Pages  
3. Only then send WhatsApp with live claim URLs  

## Status check

```bash
npm run status
```

Leads live in SQLite `data/db/leads.sqlite`. Outreach bundles: `data/outreach/outreach-*.json`.
