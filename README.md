# DomiWEB — Walkthrough Machine (República Dominicana)

Pipeline para encontrar negocios locales en RD **sin sitio web**, generarles un HTML honesto a partir de reseñas públicas de Google, crear walkthrough + página de reclamo, y preparar outreach.

**Hosting por defecto: [GitHub Pages](https://pages.github.com/)** (`public/` → Actions workflow).

---

## Estado actual (Steps 1–2)

| Step | Qué | Estado |
|------|-----|--------|
| 1 | Niche & metro config (`config/niche.config.json`) | ✅ |
| 2 | Scrape Google Maps (Apify) + gates de calificación | ✅ |
| 3 | Extracción nombre del dueño (OpenAI) | ✅ |
| 4 | Generación de sitios HTML | ✅ |
| 5 | Video face-cam reutilizable | ✅ |
| 6 | Claim pages + deploy GitHub Pages | ✅ |
| 7 | Outreach email / postcard | ⏳ templates listos |

Nicho inicial: **talleres mecánicos** en Santo Domingo + Santiago (configurable).

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
```

Edita el nicho / ciudades en `config/niche.config.json`.

### GitHub Pages

1. Sube el repo a GitHub.
2. **Settings → Pages → Source: GitHub Actions**.
3. El workflow `.github/workflows/pages.yml` publica la carpeta `public/`.
4. Sitios: `public/sites/<slug>/` → `https://steno.github.io/DomiWEB/sites/<slug>/`
5. Claim: `public/claim/<slug>/` → `https://steno.github.io/DomiWEB/claim/<slug>/`

---

## Comandos (Steps 1–2)

### Probar sin Apify (fixture local)

```bash
npm run scrape -- --from-file data/raw/fixture-scrape.json
npm run status
```

Esperado: **2 calificados** (Taller El Rayo, Taller Los Hermanos — Facebook cuenta como “sin web”), **3 rechazados** (tiene web, pocas reseñas, cadena Firestone).

### Scrape real (Apify)

```bash
# Todas las ciudades del config
npm run scrape

# Solo una metro
npm run scrape -- --metro santo-domingo

# Re-calificar un dump raw
npm run qualify -- --from-file data/raw/scrape-XXXX.json

# Contadores
npm run status
```

Salidas:

- `data/raw/scrape-*.json` — dump crudo
- `data/leads/qualified-*.json` / `.csv` — leads que pasan los gates
- `data/db/leads.sqlite` — base de leads + estado del pipeline

### Step 3 — nombres del dueño (OpenAI)

```bash
npm run extract-names
npm run extract-names -- --force          # re-procesar
npm run extract-names -- --limit 5
npm run status
```

O pipeline completo hasta nombres:

```bash
npm run pipeline -- --from-file data/raw/fixture-scrape.json
# live:
npm run pipeline -- --metro santo-domingo
```

### Step 4 — sitios HTML (OpenAI + honesty fences)

```bash
npm run generate-sites
npm run generate-sites -- --limit 3
npm run generate-sites -- --force --slug taller-el-rayo
npm run generate-sites -- --fallback   # plantilla honesta sin AI
```

Salida:
- `data/sites/<slug>/index.html`
- `public/sites/<slug>/index.html` ← GitHub Pages

Cada sitio: un solo HTML, sin JS, teléfono `tel:`, citas verbatim, footer de atribución Google.

**Design/images are mandatory:** every site gets a full-bleed hero photo (Google when available, otherwise `niche.illustrativeImages` under `public/assets/illustrative/<niche-id>/`). Do not ship empty-gradient heroes. When adding a niche, also add its illustrative asset set in config.

### Step 6 — claim / walkthrough (GitHub Pages)

```bash
npm run claim-pages
npm run claim-pages -- --force --slug taller-el-rayo

# Preview local (recomendado)
npm run serve:public
# → http://localhost:4173/claim/taller-el-rayo/
```

Cada claim page incluye:
- iframe del sitio con auto-scroll suave
- burbuja face-cam (cuando exista `public/videos/facecam-<nicho>.mp4`)
- botón grande **Reclamar mi sitio** (`mailto:` si defines `CLAIM_INBOX` en `.env`)
- link al HTML completo

Tras push a `main`, Actions publica `public/`.

### Gates de calificación

1. Sin website **o** solo Facebook/Instagram  
2. Rating ≥ **4.0**  
3. ≥ **20** reseñas  
4. ≥ 1 reseña en los últimos **90** días  
5. ≥ **5** fotos  
6. No cadena (blocklist) / no fuera de nicho  

---

## Cambiar nicho o ciudad

Edita `config/niche.config.json`:

- `niche.keywords`, `niche.labelSingular`, `niche.chainBlocklist`
- `cities[].searchQueries`, `maxResults`
- `qualification.*` si quieres aflojar/apretar gates

Luego:

```bash
npm run scrape -- --metro punta-cana   # después de añadir la ciudad al JSON
```

---

## Estructura

```
config/niche.config.json     # Step 1 — nicho + metros + hosting
prompts/                     # Prompts editables (ES)
src/cli.ts                   # CLI
src/scrape/                  # Apify + qualifier
src/db/store.ts              # SQLite + export JSON/CSV
src/host/github-pages.ts     # URLs Pages
public/                      # ← lo que despliega GitHub Pages
data/                        # leads, raw, videos, outreach
.github/workflows/pages.yml
```

---

## Siguiente

Cuando tengas `APIFY_TOKEN` y quieras seguir: **Step 3** (nombre del dueño con OpenAI/Anthropic) → sitios → video → claim pages en `public/` → outreach CSV.

Di qué proveedor de AI prefieres (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) y seguimos.
