import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Lead, NicheConfig } from "../types/index.js";
import { resolveGithubPagesUrls } from "../config/load.js";
import { dataDir, publicDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";

export interface GeneratedClaimPage {
  claimPath: string;
  publicPath: string;
  claimUrl: string | null;
  siteUrl: string | null;
  hasVideo: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/** Relative URL from claim/<slug>/ to sites/<slug>/ */
export function relativeSiteHref(slug: string): string {
  return `../../sites/${slug}/index.html`;
}

/** Niche face-cam video under public/videos/ if present. */
export function resolveFaceCamPublicHref(config: NicheConfig): string | null {
  const file = `facecam-${config.niche.id}.mp4`;
  const pub = join(publicDir("videos"), file);
  const data = join(dataDir("videos"), file);
  if (existsSync(pub) || existsSync(data)) {
    return `../../videos/${file}`;
  }
  return null;
}

function claimMailto(lead: Lead, claimUrl: string | null): string | null {
  const inbox = process.env.CLAIM_INBOX?.trim();
  if (!inbox) return null;
  const name = lead.ownerFirstName || "hola";
  const subject = encodeURIComponent(
    `Quiero reclamar el sitio de ${lead.place.name}`,
  );
  const body = encodeURIComponent(
    [
      `Hola, soy ${name} de ${lead.place.name}.`,
      "",
      "Vi la página que armaron con nuestras reseñas de Google y quiero reclamarla.",
      claimUrl ? `Link: ${claimUrl}` : "",
      lead.place.phone ? `Teléfono del negocio: ${lead.place.phone}` : "",
      "",
      "Gracias.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return `mailto:${inbox}?subject=${subject}&body=${body}`;
}

/**
 * Claim / walkthrough page:
 * - iframe of the generated site with gentle auto-scroll
 * - optional circular face-cam video bubble
 * - big "Reclamar mi sitio" CTA
 * - link to open the live HTML site
 */
export function buildClaimPageHtml(
  lead: Lead,
  config: NicheConfig,
): string {
  const urls = resolveGithubPagesUrls(config, lead.slug);
  const siteHref = relativeSiteHref(lead.slug);
  const absoluteSite = urls.siteUrl ?? siteHref;
  const videoHref = resolveFaceCamPublicHref(config);
  const mailto = claimMailto(lead, urls.claimUrl);
  const greeting = lead.ownerFirstName
    ? `Hola ${escapeHtml(lead.ownerFirstName)}`
    : "Hola";
  const quote = lead.outreachQuote
    ? `“${escapeHtml(lead.outreachQuote)}”`
    : null;
  const phone = lead.place.phone;

  const claimHref = mailto ?? "#reclamar";
  const claimExtra = mailto
    ? ""
    : `data-fallback="1"`;

  return `<!DOCTYPE html>
<html lang="es-DO">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Reclama tu sitio · ${escapeHtml(lead.place.name)}</title>
<meta name="robots" content="noindex" />
<style>
:root {
  --bg: #101612;
  --panel: #18211b;
  --ink: #eef3ee;
  --muted: #9aab9e;
  --accent: #7eb887;
  --accent-ink: #0f1a12;
  --line: #2a3830;
  --danger: #c97858;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  color: var(--ink);
  background:
    radial-gradient(ellipse at 10% 0%, #1e3228 0%, transparent 45%),
    radial-gradient(ellipse at 100% 100%, #1a2a22 0%, transparent 40%),
    var(--bg);
}
.shell {
  min-height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
}
.top {
  padding: 1rem 1.15rem 0.75rem;
  border-bottom: 1px solid var(--line);
  background: rgba(16,22,18,0.88);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 5;
}
.eyebrow {
  margin: 0 0 0.35rem;
  font-family: system-ui, sans-serif;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
h1 {
  margin: 0;
  font-size: clamp(1.35rem, 3.5vw, 1.85rem);
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.lead {
  margin: 0.45rem 0 0;
  color: var(--muted);
  font-size: 0.98rem;
  max-width: 40rem;
}
.quote {
  margin: 0.65rem 0 0;
  color: var(--accent);
  font-style: italic;
  font-size: 0.95rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.9rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.85rem 1.2rem;
  font-family: system-ui, sans-serif;
  font-weight: 700;
  font-size: 1rem;
  text-decoration: none;
  border: 0;
  cursor: pointer;
}
.btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
}
.btn-ghost {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
}
.stage {
  position: relative;
  min-height: 62vh;
  background: #0a0e0b;
}
.stage iframe {
  width: 100%;
  height: min(78vh, 920px);
  border: 0;
  background: #fff;
  display: block;
}
.face-dock {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  width: min(34vw, 180px);
}
.bubble {
  position: relative;
  width: min(28vw, 168px);
  height: min(28vw, 168px);
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid rgba(238,243,238,0.85);
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  background: #1a2420;
  cursor: pointer;
}
.bubble video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.audio-btn {
  width: 100%;
  border: 0;
  border-radius: 999px;
  padding: 0.7rem 0.85rem;
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  background: var(--accent);
  color: var(--accent-ink);
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.audio-btn.hidden { display: none; }
.audio-btn.is-on {
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--line);
}
.bubble-placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 0.75rem;
  font-family: system-ui, sans-serif;
  font-size: 0.72rem;
  color: var(--muted);
  line-height: 1.35;
}
.bottom {
  padding: 1rem 1.15rem 1.4rem;
  border-top: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  align-items: center;
  justify-content: space-between;
  background: var(--panel);
}
.bottom p {
  margin: 0;
  color: var(--muted);
  font-family: system-ui, sans-serif;
  font-size: 0.82rem;
  max-width: 36rem;
}
#panel-ok {
  display: none;
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
  background: #1e2e24;
  border: 1px solid var(--line);
  font-family: system-ui, sans-serif;
  font-size: 0.92rem;
}
#panel-ok.visible { display: block; }
@media (max-width: 640px) {
  .face-dock {
    right: 0.65rem;
    bottom: 0.65rem;
    width: 132px;
  }
  .bubble {
    width: 112px;
    height: 112px;
  }
  .audio-btn { font-size: 0.78rem; padding: 0.65rem 0.7rem; }
  .stage iframe { height: 58vh; }
}
</style>
</head>
<body>
<div class="shell">
  <header class="top">
    <p class="eyebrow">Sitio listo · ${escapeHtml(config.niche.labelSingular)}</p>
    <h1>${greeting}, esto es para ${escapeHtml(lead.place.name)}</h1>
    <p class="lead">
      Armamos una página con tus reseñas públicas de Google.
      Mírala abajo${videoHref ? " (con un vistazo rápido en el video)" : ""}.
      Si te gusta, reclámala — es tuya.
    </p>
    ${quote ? `<p class="quote">${quote}</p>` : ""}
    <div class="actions">
      <a class="btn btn-primary" id="btn-claim" href="${escapeAttr(claimHref)}" ${claimExtra}>Reclamar mi sitio</a>
      ${
        videoHref
          ? `<button type="button" class="btn btn-ghost" id="btn-audio-top">Click to listen</button>`
          : ""
      }
      <a class="btn btn-ghost" href="${escapeAttr(siteHref)}" target="_blank" rel="noopener">Abrir sitio completo</a>
      ${phone ? `<a class="btn btn-ghost" href="tel:${escapeAttr(phone.replace(/[^\d+]/g, ""))}">${escapeHtml(phone)}</a>` : ""}
    </div>
    <div id="panel-ok" role="status">
      Gracias. Anotamos tu interés en <strong>${escapeHtml(lead.place.name)}</strong>.
      ${mailto ? "Revisa tu correo — se abrió un mensaje para confirmar." : "Te contactaremos usando el teléfono público del negocio en Google."}
    </div>
  </header>

  <section class="stage" aria-label="Vista previa del sitio">
    <iframe id="site-frame" title="${escapeAttr(lead.place.name)}" src="${escapeAttr(siteHref)}" loading="eager"></iframe>
    ${
      videoHref
        ? `<div class="face-dock">
      <div class="bubble" id="face-bubble" title="Click to listen" role="button" tabindex="0">
        <video id="face-video" src="${escapeAttr(videoHref)}" autoplay muted loop playsinline preload="auto"></video>
      </div>
      <button type="button" class="audio-btn" id="unmute-btn">Click to listen</button>
    </div>`
        : `<div class="face-dock"><div class="bubble"><div class="bubble-placeholder">Video face-cam<br/>próximamente</div></div></div>`
    }
  </section>

  <footer class="bottom">
    <p>
      Vista previa honesta a partir de reseñas públicas de Google.
      No inventamos datos. El sitio vive en
      <a href="${escapeAttr(absoluteSite)}" style="color:var(--accent)">${escapeHtml(absoluteSite)}</a>
    </p>
    <a class="btn btn-primary" href="${escapeAttr(claimHref)}" ${claimExtra}>Reclamar mi sitio</a>
  </footer>
</div>
<script>
(function () {
  var frame = document.getElementById("site-frame");
  var ok = document.getElementById("panel-ok");
  var buttons = document.querySelectorAll("[data-fallback], #btn-claim");

  function markClaimed() {
    try { localStorage.setItem("domiweb-claim-${escapeAttr(lead.slug)}", "1"); } catch (e) {}
    if (ok) ok.classList.add("visible");
  }

  if (localStorage.getItem("domiweb-claim-${escapeAttr(lead.slug)}")) {
    if (ok) ok.classList.add("visible");
  }

  buttons.forEach(function (btn) {
    btn.addEventListener("click", function (ev) {
      if (btn.getAttribute("data-fallback") === "1") {
        ev.preventDefault();
        markClaimed();
        var el = document.getElementById("panel-ok");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        markClaimed();
      }
    });
  });

  function startScroll() {
    try {
      var doc = frame.contentWindow && frame.contentWindow.document;
      if (!doc || !doc.documentElement) return;
      var max = Math.max(0, (doc.documentElement.scrollHeight || 0) - (frame.contentWindow.innerHeight || 0));
      if (max < 40) return;
      var y = 0;
      var dir = 1;
      setInterval(function () {
        y += dir * 1.15;
        if (y >= max) { y = max; dir = -1; }
        if (y <= 0) { y = 0; dir = 1; }
        frame.contentWindow.scrollTo(0, y);
      }, 32);
    } catch (err) {
      /* file:// or blocked — preview still works without scroll */
    }
  }

  frame.addEventListener("load", function () {
    setTimeout(startScroll, 700);
  });

  var vid = document.getElementById("face-video");
  var unmute = document.getElementById("unmute-btn");
  var topAudio = document.getElementById("btn-audio-top");
  var bubble = document.getElementById("face-bubble");
  var audioOn = false;
  var startedWithSound = false;

  function syncLabels() {
    if (unmute) {
      unmute.classList.remove("hidden");
      unmute.textContent = audioOn ? "Mute" : "Click to listen";
      unmute.classList.toggle("is-on", audioOn);
    }
    if (topAudio) {
      topAudio.textContent = audioOn ? "Mute" : "Click to listen";
    }
    if (bubble) {
      bubble.title = audioOn ? "Click to mute" : "Click to listen";
    }
  }

  function playFromStartWithSound() {
    if (!vid) return;
    startedWithSound = true;
    audioOn = true;
    vid.muted = false;
    vid.volume = 1;
    vid.loop = false;
    try { vid.currentTime = 0; } catch (e) {}
    var p = vid.play();
    if (p && p.then) p.catch(function () {});
    syncLabels();
  }

  function muteAudio() {
    if (!vid) return;
    audioOn = false;
    vid.muted = true;
    syncLabels();
  }

  function toggleAudio(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (audioOn) {
      muteAudio();
      return;
    }
    // Best practice for a pitch clip: first listen starts at 0 with sound.
    playFromStartWithSound();
  }

  if (unmute) unmute.addEventListener("click", toggleAudio);
  if (topAudio) topAudio.addEventListener("click", toggleAudio);
  if (bubble) {
    bubble.addEventListener("click", toggleAudio);
    bubble.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") toggleAudio(ev);
    });
  }

  // Muted autoplay preview only — browsers block sound without a click.
  if (vid) {
    vid.muted = true;
    vid.loop = true;
    vid.play().catch(function () {});
  }
  syncLabels();
})();
</script>
</body>
</html>`;
}

export function writeClaimPage(
  lead: Lead,
  config: NicheConfig,
): GeneratedClaimPage {
  const html = buildClaimPageHtml(lead, config);
  const claimPath = join(dataDir("walkthroughs"), lead.slug, "index.html");
  const publicPath = join(publicDir("claim"), lead.slug, "index.html");
  mkdirSync(dirname(claimPath), { recursive: true });
  mkdirSync(dirname(publicPath), { recursive: true });
  writeFileSync(claimPath, html, "utf8");
  writeFileSync(publicPath, html, "utf8");

  // Ensure videos dir exists on Pages for when face-cam lands
  mkdirSync(publicDir("videos"), { recursive: true });

  const urls = resolveGithubPagesUrls(config, lead.slug);
  return {
    claimPath,
    publicPath,
    claimUrl: urls.claimUrl,
    siteUrl: urls.siteUrl,
    hasVideo: Boolean(resolveFaceCamPublicHref(config)),
  };
}

export function generateClaimPagesForLeads(
  leads: Lead[],
  config: NicheConfig,
  opts: { limit?: number } = {},
): Array<{ lead: Lead; claim: GeneratedClaimPage }> {
  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const out: Array<{ lead: Lead; claim: GeneratedClaimPage }> = [];
  for (const lead of batch) {
    log.info(`Claim · ${lead.place.name} (${lead.slug})`);
    const claim = writeClaimPage(lead, config);
    log.ok(
      `  → ${claim.publicPath}${claim.claimUrl ? ` · ${claim.claimUrl}` : ""}`,
    );
    out.push({ lead, claim });
  }
  return out;
}
