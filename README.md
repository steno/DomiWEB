# DomiWEB — Menú digital (República Dominicana)

Pipeline para encontrar **restaurantes y cafés** en RD sin menú digital usable, generarles un menú HTML + QR + pedido por WhatsApp a partir de reseñas públicas de Google, crear página de reclamo, y preparar outreach.

**Hosting por defecto: [GitHub Pages](https://pages.github.com/)** (`public/` → Actions workflow).

**Producto:** menú digital + QR (no talleres / sitios web por defecto).

---

## Estado actual

| Step | Qué | Estado |
|------|-----|--------|
| 1 | Niche & metro config (`config/niche.config.json` = restaurantes) | ✅ |
| 2 | Scrape Google Maps (Apify) + gates de calificación | ✅ |
| 3 | Extracción nombre del dueño (OpenAI) | ✅ |
| 4 | Generación de menús HTML + QR | ✅ |
| 5 | Claim pages + deploy GitHub Pages | ✅ |
| 6 | Outreach WhatsApp | ✅ |

Nicho por defecto: **restaurantes y cafés** en Santo Domingo + Puerto Plata.  
Configs archivadas de talleres: `config/niche.talleres.json` (no usar salvo pedido explícito).

---

## Requisitos

- Node.js **≥ 20**
- Cuenta [Apify](https://apify.com/) + token (scrape real)
- Repo en GitHub con Pages habilitado (Actions)

---

## Setup

```bash
cd DomiWEB
cp .env.example .env
npm install
```

Edita `.env`:

```env
APIFY_TOKEN=apify_api_xxx
GITHUB_PAGES_BASE_URL=https://steno.github.io/DomiWEB
GITHUB_REPO=https://github.com/steno/DomiWEB
CLAIM_WHATSAPP=1809XXXXXXX
```

Edita el nicho / ciudades en `config/niche.config.json`.

### GitHub Pages

1. Sube el repo a GitHub.
2. **Settings → Pages → Source: GitHub Actions**.
3. El workflow `.github/workflows/pages.yml` publica la carpeta `public/`.
4. Menús: `public/menus/<slug>/` → `https://steno.github.io/DomiWEB/menus/<slug>/`
5. Claim: `public/claim/<slug>/` → `https://steno.github.io/DomiWEB/claim/<slug>/`
6. Share product: `https://tinyurl.com/domenus` → splash menú digital

---

## Comandos

### Probar sin Apify (fixture local)

```bash
npm run scrape -- --from-file data/raw/fixture-scrape.json
npm run status
```

### Scrape real (Apify)

```bash
# Todas las ciudades del config (restaurantes)
npm run scrape

# Solo una metro
npm run scrape -- --metro santo-domingo

# Re-calificar un dump raw
npm run qualify -- --from-file data/raw/scrape-XXXX.json

npm run status
```

Salidas:

- `data/raw/scrape-*.json` — dump crudo
- `data/leads/qualified-*.json` / `.csv` — leads que pasan los gates
- `data/db/leads.sqlite` — base de leads + estado del pipeline

### Nombres del dueño (OpenAI)

```bash
npm run extract-names
npm run extract-names -- --force
npm run extract-names -- --limit 5
```

### Menús digitales + QR

```bash
npm run generate-menus
npm run generate-menus -- --limit 10
npm run generate-menus -- --force --slug <slug>
```

Salida:

- `public/menus/<slug>/index.html` ← GitHub Pages
- QR + pedido WhatsApp al teléfono del negocio

Platos placeholder + footer de honestidad — no inventar precios reales.

### Claim / walkthrough

```bash
npm run claim-pages
npm run claim-pages -- --force --slug <slug>

npm run serve:public
# → http://localhost:4173/claim/<slug>/
```

Outreach al dueño: **siempre** el claim URL (no el menú público directo).

### Outreach WhatsApp

```bash
npm run outreach
npm run outreach -- --force --slug <slug>

npm run send-whatsapp
npm run send-whatsapp -- --slug <slug>
npm run send-whatsapp -- --batch --limit 10
npm run send-whatsapp -- --slug <slug> --to +1809XXXXXXX
# Después de interés:
npm run send-whatsapp -- --price --slug <slug>
npm run send-whatsapp -- --close --slug <slug>
```

(`--to` manda el texto a **tu** WhatsApp para probar. `--price` = follow-up **RD$1,500** menú + QR.)

`--product` por defecto es **menu**. Templates: `prompts/outreach-whatsapp-menu*.md`.

### Gates de calificación

1. Sin website **o** solo Facebook/Instagram  
2. Rating ≥ **4.0**  
3. ≥ **8** reseñas (restaurantes)  
4. Reseña reciente según `qualification.recentReviewDays`  
5. Fotos mínimas según config  
6. No cadena (blocklist) / no fuera de nicho  

---

## Cambiar nicho o ciudad

Edita `config/niche.config.json`:

- `niche.keywords`, `niche.labelSingular`, `niche.chainBlocklist`
- `cities[].searchQueries`, `maxResults`
- `qualification.*` si quieres aflojar/apretar gates
- Añade assets en `public/assets/illustrative/<niche-id>/` + `illustrativeImages`

```bash
npm run scrape -- --metro santo-domingo
```

---

## Estructura

```
config/niche.config.json     # Restaurantes (default)
config/niche.talleres.json   # Archivado — no usar
prompts/                     # Prompts editables (ES)
src/cli.ts                   # CLI
src/scrape/                  # Apify + qualifier
src/db/store.ts              # SQLite + export JSON/CSV
public/menus/                # Menús publicados
public/claim/                # Páginas de reclamo
data/                        # leads, raw, outreach
.github/workflows/pages.yml
```
