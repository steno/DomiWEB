#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfig, resolveGithubPagesUrls } from "./config/load.js";
import {
  exportQualifiedJsonCsv,
  listLeads,
  listLeadsForClaimPages,
  listLeadsForOutreach,
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
import { generateFaceCamVideo } from "./generate/video.js";
import { downloadToFile, generateLipsyncVideo } from "./generate/lipsync.js";
import { prepareOutreach } from "./outreach/prepare.js";
import { scrapeAll } from "./scrape/maps-scraper.js";
import { qualifyPlace } from "./scrape/qualifier.js";
import type { ScrapedPlace } from "./types/index.js";
import { generateClaimPagesForLeads } from "./walkthrough/claim-page.js";
import { log } from "./utils/logger.js";
import { pagesSetupInstructions } from "./host/github-pages.js";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, publicDir } from "./utils/paths.js";

const program = new Command();

program
  .name("domiweb")
  .description(
    "Walkthrough Machine — República Dominicana · scrape → qualify → sites → outreach",
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
        const claims = generateClaimPagesForLeads(leads, config);
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
  .action((opts: {
    config?: string;
    limit?: number;
    force?: boolean;
    slug?: string;
  }) => {
    const config = loadConfig(opts.config);
    log.step(6, "Páginas de reclamo (GitHub Pages)");
    if (!config.hosting.baseUrl) {
      log.warn("GITHUB_PAGES_BASE_URL vacío — URLs absolutas quedarán pendientes.");
      console.log(pagesSetupInstructions(process.env.GITHUB_REPO));
    }

    const leads = listLeadsForClaimPages(Boolean(opts.force), opts.slug);
    if (!leads.length) {
      log.warn("No hay leads con sitio (`site_generated`). Corre generate-sites primero.");
      return;
    }

    const results = generateClaimPagesForLeads(leads, config, {
      limit: opts.limit,
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
    "Step 7 — personalized email + postcard copy → CSV/JSON (one message per business)",
  )
  .option("-c, --config <path>", "Path to niche.config.json")
  .option("--limit <n>", "Max leads", (v) => parseInt(v, 10))
  .option("--force", "Include leads already outreach_ready / site_generated", false)
  .option("--slug <slug>", "Only this slug")
  .action((opts: {
    config?: string;
    limit?: number;
    force?: boolean;
    slug?: string;
  }) => {
    const config = loadConfig(opts.config);
    log.step(7, "Outreach (email + postcard)");
    const leads = listLeadsForOutreach(Boolean(opts.force), opts.slug);
    if (!leads.length) {
      log.warn(
        "No hay leads listos. Corre claim-pages primero (status walkthrough_ready).",
      );
      return;
    }

    const { messages, csvPath, jsonPath } = prepareOutreach(leads, config, {
      limit: opts.limit,
    });

    for (const msg of messages) {
      updateOutreachReady(msg.leadId, {
        claimUrl: msg.claimUrl,
        siteUrl: msg.siteUrl,
        outreachQuote: msg.reviewQuote,
      });
    }

    log.ok(`Mensajes: ${messages.length}`);
    log.ok(`CSV:  ${csvPath}`);
    log.ok(`JSON: ${jsonPath}`);
    log.info("Un mensaje por negocio — sin escasez falsa.");
    for (const [status, n] of Object.entries(statusCounts()).sort()) {
      console.log(`  ${status.padEnd(18)} ${n}`);
    }
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
