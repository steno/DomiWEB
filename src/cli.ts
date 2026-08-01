#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfig, priceOnceForProduct, resolveGithubPagesUrls } from "./config/load.js";
import {
  exportQualifiedJsonCsv,
  listLeads,
  listLeadsForClaimPages,
  listLeadsForOutreach,
  listLeadsForReviewKitGen,
  listLeadsForSiteGen,
  saveRawScrape,
  saveRunSummary,
  statusCounts,
  updateOwnerName,
  updateOutreachReady,
  updateSiteGenerated,
  updateWalkthroughReady,
  upsertScrapedLeads,
} from "./db/store.js";
import { extractNamesForLeads } from "./extract/owner-name.js";
import { generateSitesForLeads } from "./generate/site.js";
import {
  generateReviewKitsForLeads,
  siteHtmlExists,
} from "./generate/review-kit.js";
import { generateMenusForLeads, menuExists } from "./generate/menu.js";
import { applyMenuDraft } from "./generate/apply-menu-draft.js";
import { generateFaceCamVideo } from "./generate/video.js";
import { downloadToFile, generateLipsyncVideo } from "./generate/lipsync.js";
import {
  loadLatestOutreachMessages,
  prepareOutreach,
  useCloseFollowUp,
  usePriceFollowUp,
} from "./outreach/prepare.js";
import {
  redirectWhatsAppTo,
  sendWhatsAppSemiAuto,
} from "./outreach/send-whatsapp.js";
import { scrapeAll } from "./scrape/maps-scraper.js";
import { qualifyPlace } from "./scrape/qualifier.js";
import type { PipelineProduct, ScrapedPlace } from "./types/index.js";
import { generateClaimPagesForLeads } from "./walkthrough/claim-page.js";
import { log } from "./utils/logger.js";
import { pagesSetupInstructions } from "./host/github-pages.js";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, publicDir } from "./utils/paths.js";

function parseProduct(raw?: string): PipelineProduct {
  const v = (raw ?? "menu").trim().toLowerCase();
  if (v === "reviewkit" || v === "review-kit" || v === "kit") {
    return "reviewKit";
  }
  if (v === "site" || v === "sites" || v === "website") {
    return "site";
  }
  if (v === "menu" || v === "menus" || v === "digital-menu") {
    return "menu";
  }
  return "menu";
}

const program = new Command();

program
  .name("domiweb")
  .description(
    "Walkthrough Machine — República Dominicana · scrape → menus → claim → WhatsApp",
  )
  .version("1.0.0");

program
  .command("scrape")
  .description("Scrape Google Maps for configured niche + cities, then qualify")
  .option("-c, --config <path>", "Path to niche.config.json")
  .option(
    "-m, --metro <ids>",
    "Comma-separated metro ids (e.g. santo-domingo,santiago)",
  )
  .option(
    "--from-file <path>",
    "Skip Apify and qualify from an existing raw scrape JSON",
  )
  .action(async (opts: { config?: string; metro?: string; fromFile?: string }) => {
    const config = loadConfig(opts.config);
    const metroFilter = opts.metro
      ? opts.metro.split(",").map((s: string) => s.trim()).filter(Boolean)
      : undefined;

    log.step(1, `Nicho: ${config.niche.label} · idioma: ${config.language}`);
    log.info(
      `Ciudades: ${(metroFilter ?? config.cities.map((c) => c.id)).join(", ")}`,
    );
    log.info(`Hosting: GitHub Pages (${config.hosting.baseUrl || "baseUrl pendiente"})`);

    const startedAt = new Date().toISOString();
    let places: ScrapedPlace[];

    if (opts.fromFile) {
      log.step(2, `Cargando scrape desde archivo: ${opts.fromFile}`);
      places = JSON.parse(readFileSync(opts.fromFile, "utf8")) as ScrapedPlace[];
    } else {
      log.step(2, "Scrape Google Maps (Apify)");
      places = await scrapeAll(config, metroFilter);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rawPath = saveRawScrape(places, stamp);
    log.ok(`Raw scrape: ${rawPath} (${places.length} lugares)`);

    log.step(3, "Calificación (gates duros)");
    const quals = new Map(
      places.map((p) => [p.placeId, qualifyPlace(p, config)]),
    );
    const leads = upsertScrapedLeads(places, quals, config);
    const qualified = leads.filter((l) => l.status === "qualified");
    const rejected = leads.filter((l) => l.status === "rejected");

    log.ok(`Calificados: ${qualified.length}`);
    log.warn(`Rechazados: ${rejected.length}`);

    if (rejected.length && rejected.length <= 15) {
      for (const r of rejected.slice(0, 10)) {
        log.info(`  · ${r.place.name}: ${r.qualification.reasons.join("; ")}`);
      }
    }

    const { jsonPath, csvPath } = exportQualifiedJsonCsv(leads, stamp);
    log.ok(`JSON: ${jsonPath}`);
    log.ok(`CSV:  ${csvPath}`);

    const summary = {
      runId: randomUUID().slice(0, 8),
      startedAt,
      finishedAt: new Date().toISOString(),
      metroIds: [...new Set(places.map((p) => p.metroId))],
      totalScraped: places.length,
      totalQualified: qualified.length,
      totalRejected: rejected.length,
      outputPath: jsonPath,
    };
    saveRunSummary(summary);
    log.step(4, "Listo");
    console.log(JSON.stringify(summary, null, 2));
  });

program
  .command("qualify")
  .description("Re-run qualification on the latest raw scrape (or --from-file)")
  .requiredOption("--from-file <path>", "Raw scrape JSON path")
  .option("-c, --config <path>", "Path to niche.config.json")
  .action((opts: { fromFile: string; config?: string }) => {
    const config = loadConfig(opts.config);
    const places = JSON.parse(
      readFileSync(opts.fromFile, "utf8"),
    ) as ScrapedPlace[];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const quals = new Map(
      places.map((p) => [p.placeId, qualifyPlace(p, config)]),
    );
    const leads = upsertScrapedLeads(places, quals, config);
    const { jsonPath, csvPath } = exportQualifiedJsonCsv(leads, stamp);
    log.ok(
      `Qualified ${leads.filter((l) => l.status === "qualified").length} / ${leads.length}`,
    );
    log.ok(jsonPath);
    log.ok(csvPath);
  });

program
  .command("extract-names")
  .description("Step 3 — extract owner first names from reviews (OpenAI)")
  .option("--limit <n>", "Max qualified leads to process", (v) => parseInt(v, 10))
  .option("--force", "Re-process leads that already have a name", false)
  .action(async (opts: { limit?: number; force?: boolean }) => {
    log.step(3, "Extracción de nombre del dueño (OpenAI)");
    let leads = listLeads("qualified");
    const alreadyNamed = listLeads("named");
    if (opts.force) {
      leads = [...leads, ...alreadyNamed];
    }

    if (!leads.length) {
      log.warn(
        "No hay leads `qualified`. Corre scrape primero, o usa --force si ya están `named`.",
      );
      return;
    }

    log.info(`${leads.length} lead(s) a procesar`);
    const results = await extractNamesForLeads(leads, { limit: opts.limit });
    let named = 0;
    for (const { lead, extraction } of results) {
      updateOwnerName(
        lead.id,
        extraction.firstName,
        extraction.confidence,
      );
      if (extraction.firstName) named += 1;
    }
    log.ok(`Nombres encontrados: ${named} / ${results.length}`);
    console.log("\nStatus:");
    for (const [status, n] of Object.entries(statusCounts()).sort()) {
      console.log(`  ${status.padEnd(18)} ${n}`);
    }
  });

program
  .command("generate-sites")
  .description("Step 4 — generate single-file HTML sites (crafted template by default)")
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("--limit <n>", "Max leads to process", (v) => parseInt(v, 10))
  .option("--force", "Regenerate even if status is site_generated", false)
  .option("--ai", "Use OpenAI for HTML instead of crafted template", false)
  .option("--fallback", "Force crafted template (default)", false)
  .option("--slug <slug>", "Only generate for this lead slug")
  .action(async (opts: {
    config?: string;
    limit?: number;
    force?: boolean;
    fallback?: boolean;
    ai?: boolean;
    slug?: string;
  }) => {
    const config = loadConfig(opts.config);
    log.step(4, "Generación de sitios HTML");
    const leads = listLeadsForSiteGen(Boolean(opts.force), opts.slug);
    if (!leads.length) {
      log.warn("No hay leads qualified/named. Corre scrape + extract-names primero.");
      return;
    }
    const useAi = Boolean(opts.ai) && !opts.fallback;
    log.info(`${leads.length} lead(s) · ${useAi ? "OpenAI" : "crafted template"}`);

    const results = await generateSitesForLeads(leads, config, {
      limit: opts.limit,
      preferFallback: !useAi,
      useAi,
    });

    for (const { lead, site } of results) {
      const urls = resolveGithubPagesUrls(config, lead.slug);
      updateSiteGenerated(lead.id, {
        sitePath: site.sitePath,
        siteUrl: urls.siteUrl,
        claimUrl: urls.claimUrl,
        outreachQuote: site.outreachQuote,
      });
    }

    log.ok(`Sitios generados: ${results.length}`);
    log.info("Archivos en public/sites/<slug>/ — listos para GitHub Pages");
    for (const [status, n] of Object.entries(statusCounts()).sort()) {
      console.log(`  ${status.padEnd(18)} ${n}`);
    }
  });

program
  .command("generate-review-kit")
  .description(
    "Generate Google review-reply kits under public/kits/ (OpenAI drafts + HTML)",
  )
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("--limit <n>", "Max leads to process", (v) => parseInt(v, 10))
  .option("--force", "Regenerate even if already site_generated+", false)
  .option("--no-ai", "Use template replies only (no OpenAI)")
  .option("--slug <slug>", "Only generate for this lead slug")
  .action(async (opts: {
    config?: string;
    limit?: number;
    force?: boolean;
    ai?: boolean;
    slug?: string;
  }) => {
    const config = loadConfig(opts.config);
    if (config.products?.reviewKit?.enabled === false) {
      log.warn("products.reviewKit.enabled es false en la config.");
      return;
    }
    log.step(4, "Kit de respuestas a reseñas Google");
    const leads = listLeadsForReviewKitGen(Boolean(opts.force), opts.slug);
    if (!leads.length) {
      log.warn("No hay leads qualified/named. Corre scrape + extract-names primero.");
      return;
    }
    const useAi = opts.ai !== false;
    log.info(
      `${leads.length} lead(s) · ${useAi ? "OpenAI + HTML" : "plantilla + HTML"}`,
    );

    const results = await generateReviewKitsForLeads(leads, config, {
      limit: opts.limit,
      useAi,
    });

    for (const { lead, kit } of results) {
      const urls = resolveGithubPagesUrls(config, lead.slug);
      const keepSitePath =
        siteHtmlExists(lead.slug) && lead.sitePath
          ? lead.sitePath
          : kit.kitPath;
      updateSiteGenerated(lead.id, {
        sitePath: keepSitePath,
        siteUrl: siteHtmlExists(lead.slug) ? urls.siteUrl : urls.kitUrl,
        claimUrl: urls.claimUrl,
        outreachQuote: kit.outreachQuote,
      });
    }

    log.ok(`Kits generados: ${results.length}`);
    log.info("Archivos en public/kits/<slug>/ — luego: claim-pages --product reviewKit");
    for (const [status, n] of Object.entries(statusCounts()).sort()) {
      console.log(`  ${status.padEnd(18)} ${n}`);
    }
  });

program
  .command("generate-menus")
  .description(
    "Generate mobile digital menus + QR under public/menus/",
  )
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("--limit <n>", "Max leads to process", (v) => parseInt(v, 10))
  .option("--force", "Regenerate even if already site_generated+", false)
  .option("--slug <slug>", "Only generate for this lead slug")
  .action(async (opts: {
    config?: string;
    limit?: number;
    force?: boolean;
    slug?: string;
  }) => {
    const config = loadConfig(opts.config);
    if (config.products?.menu?.enabled === false) {
      log.warn("products.menu.enabled es false en la config.");
      return;
    }
    log.step(4, "Menú digital + QR");
    const leads = listLeadsForSiteGen(Boolean(opts.force), opts.slug);
    if (!leads.length) {
      log.warn("No hay leads qualified/named. Corre scrape + extract-names primero.");
      return;
    }
    log.info(`${leads.length} lead(s)`);

    const results = await generateMenusForLeads(leads, config, {
      limit: opts.limit,
    });

    for (const { lead, menu } of results) {
      const urls = resolveGithubPagesUrls(config, lead.slug);
      const keepSitePath =
        (siteHtmlExists(lead.slug) || menuExists(lead.slug)) && lead.sitePath
          ? lead.sitePath
          : menu.menuPath;
      updateSiteGenerated(lead.id, {
        sitePath: keepSitePath,
        siteUrl: siteHtmlExists(lead.slug) ? urls.siteUrl : urls.menuUrl,
        claimUrl: urls.claimUrl,
        outreachQuote: menu.outreachQuote,
      });
    }

    log.ok(`Menús generados: ${results.length}`);
    log.info("Archivos en public/menus/<slug>/ — luego: claim-pages --product menu");
    for (const [status, n] of Object.entries(statusCounts()).sort()) {
      console.log(`  ${status.padEnd(18)} ${n}`);
    }
  });

program
  .command("apply-menu-draft")
  .description(
    "Apply an owner menu JSON draft (from edit-menu download) and regenerate public/menus/<slug>/",
  )
  .requiredOption("--slug <slug>", "Lead slug")
  .requiredOption("--file <path>", "Path to menu-<slug>.json from the owner")
  .option("-c, --config <path>", "Path to niche.config.json")
  .action(async (opts: { slug: string; file: string; config?: string }) => {
    const config = loadConfig(opts.config);
    log.step(4, "Aplicar borrador de menú");
    const result = await applyMenuDraft({
      slug: opts.slug,
      filePath: opts.file,
      config,
    });
    const urls = resolveGithubPagesUrls(config, result.lead.slug);
    updateSiteGenerated(result.lead.id, {
      sitePath:
        (siteHtmlExists(result.lead.slug) || menuExists(result.lead.slug)) &&
        result.lead.sitePath
          ? result.lead.sitePath
          : result.publicPath,
      siteUrl: siteHtmlExists(result.lead.slug) ? urls.siteUrl : urls.menuUrl,
      claimUrl: urls.claimUrl,
      outreachQuote: result.lead.outreachQuote,
    });
    log.ok(`Menú actualizado · ${result.publicPath}`);
    log.info("Commit + push public/menus/<slug>/ para publicar en Pages");
  });

program
  .command("generate-video")
  .description(
    "Step 5 — reusable face-cam video (photo + Dominican Spanish TTS + optional lipsync)",
  )
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("--lipsync", "Run fal.ai sync-3 lipsync (requires FAL_KEY)", false)
  .option("--refresh-claims", "Regenerate claim pages so the bubble picks up the mp4", false)
  .action(async (opts: {
    config?: string;
    lipsync?: boolean;
    refreshClaims?: boolean;
  }) => {
    const config = loadConfig(opts.config);
    log.step(5, "Video face-cam reutilizable");
    const result = await generateFaceCamVideo(config);

    if (opts.lipsync) {
      try {
        const { videoUrl, requestId } = await generateLipsyncVideo({
          imagePath: result.sourceImage,
          audioPath: result.audioPath,
        });
        log.ok(`fal lipsync ready · ${requestId}`);
        const lipsyncPath = join(
          dataDir("videos"),
          `facecam-${config.niche.id}-lipsync.mp4`,
        );
        await downloadToFile(videoUrl, lipsyncPath);
        copyFileSync(lipsyncPath, result.publicVideoPath);
        copyFileSync(
          lipsyncPath,
          join(publicDir("videos"), `facecam-${config.niche.id}-lipsync.mp4`),
        );
        log.ok(`Lipsync video → ${result.publicVideoPath}`);
      } catch (err) {
        log.error(
          `Lipsync falló: ${err instanceof Error ? err.message : String(err)}`,
        );
        log.warn("Se mantiene el video still+audio anterior.");
      }
    }

    console.log(
      JSON.stringify(
        {
          script: result.script,
          video: result.publicVideoPath,
          audio: result.audioPath,
          lipsyncRequested: Boolean(opts.lipsync),
          hasFalKey: Boolean(process.env.FAL_KEY?.trim()),
        },
        null,
        2,
      ),
    );
    if (opts.refreshClaims) {
      const leads = listLeadsForClaimPages(true);
      if (leads.length) {
        const claims = await generateClaimPagesForLeads(leads, config);
        for (const { lead, claim } of claims) {
          updateWalkthroughReady(lead.id, {
            claimPath: claim.claimPath,
            claimUrl: claim.claimUrl,
            siteUrl: claim.siteUrl,
          });
        }
        log.ok(`Claim pages actualizadas: ${claims.length}`);
      }
    }
  });

program
  .command("claim-pages")
  .description("Step 6 — claim/walkthrough pages under public/claim/ (GitHub Pages)")
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("--limit <n>", "Max leads", (v) => parseInt(v, 10))
  .option("--force", "Regenerate existing walkthrough pages", false)
  .option("--slug <slug>", "Only this slug")
  .option(
    "--product <name>",
    "Asset to preview: site | reviewKit | menu (default: auto)",
    "auto",
  )
  .action(async (opts: {
    config?: string;
    limit?: number;
    force?: boolean;
    slug?: string;
    product?: string;
  }) => {
    const config = loadConfig(opts.config);
    const productOpt =
      opts.product === "auto"
        ? "auto"
        : parseProduct(opts.product);
    log.step(6, `Páginas de reclamo (${productOpt})`);
    if (!config.hosting.baseUrl) {
      log.warn("GITHUB_PAGES_BASE_URL vacío — URLs absolutas quedarán pendientes.");
      console.log(pagesSetupInstructions(process.env.GITHUB_REPO));
    }

    const leads = listLeadsForClaimPages(
      Boolean(opts.force),
      opts.slug,
      productOpt,
    );
    if (!leads.length) {
      log.warn(
        productOpt === "reviewKit"
          ? "No hay leads con kit. Corre generate-review-kit primero."
          : productOpt === "menu"
            ? "No hay leads con menú. Corre generate-menus primero."
            : "No hay leads con sitio (`site_generated`). Corre generate-sites primero.",
      );
      return;
    }

    const results = await generateClaimPagesForLeads(leads, config, {
      limit: opts.limit,
      product: productOpt,
    });
    for (const { lead, claim } of results) {
      updateWalkthroughReady(lead.id, {
        claimPath: claim.claimPath,
        claimUrl: claim.claimUrl,
        siteUrl: claim.siteUrl,
      });
    }
    log.ok(`Claim pages: ${results.length}`);
    log.info("Abre con un server local (file:// rompe el iframe a veces):");
    log.info("  npx --yes serve public -p 4173");
    for (const [status, n] of Object.entries(statusCounts()).sort()) {
      console.log(`  ${status.padEnd(18)} ${n}`);
    }
  });

program
  .command("outreach")
  .description(
    "Step 7 — WhatsApp (primary) + email/postcard fallback → CSV/JSON",
  )
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("--limit <n>", "Max leads", (v) => parseInt(v, 10))
  .option("--force", "Include leads already outreach_ready / site_generated", false)
  .option("--slug <slug>", "Only this slug")
  .option(
    "--product <name>",
    "menu (default) | reviewKit | site — copy + price",
    "menu",
  )
  .action((opts: {
    config?: string;
    limit?: number;
    force?: boolean;
    slug?: string;
    product?: string;
  }) => {
    const config = loadConfig(opts.config);
    const product = parseProduct(opts.product);
    log.step(7, `Outreach (${product})`);
    const leads = listLeadsForOutreach(
      Boolean(opts.force),
      opts.slug,
      product,
    );
    if (!leads.length) {
      log.warn(
        product === "reviewKit"
          ? "No hay leads con kit + claim. Corre generate-review-kit + claim-pages --product reviewKit."
          : product === "site"
            ? "No hay leads listos. Corre claim-pages primero (status walkthrough_ready)."
            : "No hay leads con menú + claim. Corre generate-menus + claim-pages --product menu.",
      );
      return;
    }

    const { messages, csvPath, jsonPath } = prepareOutreach(leads, config, {
      limit: opts.limit,
      product,
    });

    for (const msg of messages) {
      updateOutreachReady(msg.leadId, {
        claimUrl: msg.claimUrl,
        siteUrl: msg.siteUrl,
        outreachQuote: msg.reviewQuote || null,
      });
    }

    const withWa = messages.filter((m) => m.whatsappUrl).length;
    log.ok(`Mensajes: ${messages.length} (${withWa} con WhatsApp)`);
    log.ok(`CSV:  ${csvPath}`);
    log.ok(`JSON: ${jsonPath}`);
    log.info("Canal principal: WhatsApp. Luego: npm run send-whatsapp");
    for (const [status, n] of Object.entries(statusCounts()).sort()) {
      console.log(`  ${status.padEnd(18)} ${n}`);
    }
  });

program
  .command("send-whatsapp")
  .description(
    "Open wa.me chats with prefilled text (you hit Send). Approve each or --batch.",
  )
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("--limit <n>", "Max chats to open", (v) => parseInt(v, 10))
  .option("--batch", "Confirm once, then open all", false)
  .option("--no-open", "Only print/write links — do not open browser")
  .option("--include-sent", "Re-open leads already logged as sent", false)
  .option("--force", "Rebuild outreach from leads before sending", false)
  .option("--slug <slug>", "Only this slug")
  .option(
    "--product <name>",
    "menu (default) | reviewKit | site — when rebuilding outreach",
    "menu",
  )
  .option(
    "--to <phone>",
    "Send to this WhatsApp number instead (test fixtures on your phone)",
  )
  .option(
    "--price",
    "Send price follow-up — only after interest",
    false,
  )
  .option(
    "--close",
    "Send payment/transfer close kit — only after they say yes to price",
    false,
  )
  .action(async (opts: {
    config?: string;
    limit?: number;
    batch?: boolean;
    open?: boolean;
    includeSent?: boolean;
    force?: boolean;
    slug?: string;
    product?: string;
    to?: string;
    price?: boolean;
    close?: boolean;
  }) => {
    const config = loadConfig(opts.config);
    const product = parseProduct(opts.product);
    if (opts.price && opts.close) {
      log.error("Usa --price o --close, no ambos.");
      return;
    }
    const mode = opts.close ? "close" : opts.price ? "price" : "first";
    log.step(
      7,
      mode === "close"
        ? "Send WhatsApp cierre (transferencia)"
        : mode === "price"
          ? "Send WhatsApp precio (follow-up)"
          : "Send WhatsApp (semi-auto)",
    );

    let messages = loadLatestOutreachMessages() ?? [];

    if (opts.force || !messages.length) {
      const leads = listLeadsForOutreach(true, undefined, product);
      if (!leads.length) {
        log.warn("No hay leads. Corre outreach / claim-pages primero.");
        return;
      }
      const prepared = prepareOutreach(leads, config, {
        limit: opts.limit,
        product,
      });
      messages = prepared.messages;
      for (const msg of messages) {
        updateOutreachReady(msg.leadId, {
          claimUrl: msg.claimUrl,
          siteUrl: msg.siteUrl,
          outreachQuote: msg.reviewQuote || null,
        });
      }
    }

    // Rebuild if latest JSON predates price/close fields or product mismatch
    if (
      (opts.price && messages.some((m) => !m.whatsappPriceMessage)) ||
      (opts.close && messages.some((m) => !m.whatsappCloseMessage)) ||
      (opts.force === false &&
        messages.some((m) => (m.product ?? "menu") !== product) &&
        (opts.price || opts.close || opts.product === "reviewKit"))
    ) {
      const leads = listLeadsForOutreach(true, opts.slug, product);
      messages = prepareOutreach(leads, config, {
        write: false,
        limit: opts.limit,
        product,
      }).messages;
    }

    if (opts.slug) {
      let filtered = messages.filter((m) => m.slug === opts.slug);
      if (!filtered.length) {
        const leads = listLeadsForOutreach(true, opts.slug, product);
        if (!leads.length) {
          log.warn(`No hay lead con slug ${opts.slug}.`);
          return;
        }
        filtered = prepareOutreach(leads, config, {
          write: false,
          product,
        }).messages;
      }
      messages = filtered;
    }

    if (opts.price) {
      messages = usePriceFollowUp(messages);
      log.info(
        `Precio: ${priceOnceForProduct(config, product)} único (${product})`,
      );
    }

    if (opts.close) {
      const missing = [
        !process.env.TRANSFER_BANK?.trim() && "TRANSFER_BANK",
        !process.env.TRANSFER_ACCOUNT?.trim() && "TRANSFER_ACCOUNT",
        !process.env.TRANSFER_NAME?.trim() && "TRANSFER_NAME",
      ].filter(Boolean) as string[];
      if (missing.length) {
        log.error(
          `Falta configurar en .env: ${missing.join(", ")} — no envíes el cierre con placeholders.`,
        );
        return;
      }
      messages = useCloseFollowUp(messages);
      log.info(
        `Cierre: ${config.pricing.onceLabel} → ${process.env.TRANSFER_BANK} / ${process.env.TRANSFER_NAME}`,
      );
    }

    if (opts.to) {
      try {
        messages = redirectWhatsAppTo(messages, opts.to);
        log.info(`Redirigido a ${opts.to} (texto del lead intacto).`);
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    const result = await sendWhatsAppSemiAuto(messages, {
      batch: Boolean(opts.batch),
      open: opts.open !== false,
      skipSent: opts.to ? false : !opts.includeSent,
      limit: opts.limit,
      kind:
        opts.close
          ? "whatsapp-close"
          : opts.price
            ? "whatsapp-price"
            : "whatsapp",
    });

    log.ok(
      `Abiertos: ${result.opened} · saltados: ${result.skipped} · fallos: ${result.failed}`,
    );
  });

program
  .command("status")
  .description("Show lead counts by pipeline status")
  .action(() => {
    const counts = statusCounts();
    const leads = listLeads();
    console.log("\nPipeline status\n---------------");
    if (!Object.keys(counts).length) {
      log.warn("No leads yet. Run: npm run scrape");
      return;
    }
    for (const [status, n] of Object.entries(counts).sort()) {
      console.log(`  ${status.padEnd(18)} ${n}`);
    }
    console.log(`  ${"TOTAL".padEnd(18)} ${leads.length}`);

    const withNames = leads.filter((l) => l.ownerFirstName);
    if (withNames.length) {
      console.log("\nNombres detectados:");
      for (const l of withNames.slice(0, 20)) {
        console.log(
          `  · ${l.place.name} → ${l.ownerFirstName} (${l.ownerNameConfidence?.toFixed(2) ?? "?"})`,
        );
      }
    }

    const withSites = leads.filter((l) => l.sitePath);
    if (withSites.length) {
      console.log("\nSitios:");
      for (const l of withSites.slice(0, 20)) {
        console.log(`  · ${l.place.name} → ${l.sitePath}`);
      }
    }

    const withClaims = leads.filter((l) => l.claimPath);
    if (withClaims.length) {
      console.log("\nClaim pages:");
      for (const l of withClaims.slice(0, 20)) {
        console.log(
          `  · ${l.place.name} → ${l.claimUrl ?? `public/claim/${l.slug}/`}`,
        );
      }
    }

    const ready = leads.filter((l) => l.status === "outreach_ready");
    if (ready.length) {
      console.log("\nOutreach listo:");
      for (const l of ready.slice(0, 20)) {
        console.log(
          `  · ${l.place.name} → ${l.claimUrl ?? `(claim/${l.slug}/)`}`,
        );
      }
    }
    console.log();
  });

program
  .command("dashboard")
  .description("Live pipeline dashboard (sites + statuses, auto-refresh)")
  .option("-p, --port <n>", "Port", (v) => parseInt(v, 10), 4174)
  .action(async (opts: { port: number }) => {
    const { startDashboardServer } = await import("./dashboard/server.js");
    startDashboardServer(opts.port);
  });

program
  .command("pipeline")
  .description(
    "scrape → qualify → extract-names → generate-sites → claim-pages → outreach",
  )
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("-m, --metro <ids>", "Comma-separated metro ids")
  .option("--from-file <path>", "Skip Apify; use raw scrape JSON")
  .option("--skip-names", "Stop after qualify", false)
  .option("--skip-sites", "Stop after extract-names", false)
  .option("--skip-claims", "Stop after generate-sites", false)
  .option("--skip-outreach", "Stop after claim-pages", false)
  .option("--limit <n>", "Limit for names/sites/claims/outreach", (v) =>
    parseInt(v, 10),
  )
  .action(async (opts: {
    config?: string;
    metro?: string;
    fromFile?: string;
    skipNames?: boolean;
    skipSites?: boolean;
    skipClaims?: boolean;
    skipOutreach?: boolean;
    limit?: number;
  }) => {
    log.info(
      "Pipeline: scrape → qualify → extract-names → generate-sites → claim-pages → outreach",
    );
    await program.parseAsync(
      [
        "scrape",
        ...(opts.config ? ["--config", opts.config] : []),
        ...(opts.metro ? ["--metro", opts.metro] : []),
        ...(opts.fromFile ? ["--from-file", opts.fromFile] : []),
      ],
      { from: "user" },
    );
    if (opts.skipNames) return;
    await program.parseAsync(
      [
        "extract-names",
        ...(opts.limit != null ? ["--limit", String(opts.limit)] : []),
      ],
      { from: "user" },
    );
    if (opts.skipSites) return;
    await program.parseAsync(
      [
        "generate-sites",
        ...(opts.config ? ["--config", opts.config] : []),
        ...(opts.limit != null ? ["--limit", String(opts.limit)] : []),
      ],
      { from: "user" },
    );
    if (opts.skipClaims) return;
    await program.parseAsync(
      [
        "claim-pages",
        ...(opts.config ? ["--config", opts.config] : []),
        ...(opts.limit != null ? ["--limit", String(opts.limit)] : []),
      ],
      { from: "user" },
    );
    if (opts.skipOutreach) return;
    await program.parseAsync(
      [
        "outreach",
        ...(opts.config ? ["--config", opts.config] : []),
        ...(opts.limit != null ? ["--limit", String(opts.limit)] : []),
      ],
      { from: "user" },
    );
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
