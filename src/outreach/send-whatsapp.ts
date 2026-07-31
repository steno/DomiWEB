import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { OutreachMessage } from "./prepare.js";
import { buildWhatsAppUrl, toWhatsAppDigits } from "./phone.js";
import { dataDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";

/** NANP 555 exchange — reserved for fiction; fixture scrape uses these. */
function isDemoPhone(phone: string | null | undefined): boolean {
  const d = toWhatsAppDigits(phone);
  return Boolean(d && /^1(809|829|849)555\d{4}$/.test(d));
}

/** Redirect all messages to a real phone (e.g. test Carlos copy on your WhatsApp). */
export function redirectWhatsAppTo(
  messages: OutreachMessage[],
  phone: string,
): OutreachMessage[] {
  return messages.map((m) => {
    const whatsappUrl = buildWhatsAppUrl(phone, m.whatsappMessage);
    const whatsappPriceUrl = buildWhatsAppUrl(phone, m.whatsappPriceMessage);
    const whatsappCloseUrl = buildWhatsAppUrl(phone, m.whatsappCloseMessage);
    if (!whatsappUrl) {
      throw new Error(`Número inválido para WhatsApp: ${phone}`);
    }
    return { ...m, phone, whatsappUrl, whatsappPriceUrl, whatsappCloseUrl };
  });
}

type SendKind = "whatsapp" | "whatsapp-price" | "whatsapp-close";

function sentLogPath(kind: SendKind = "whatsapp"): string {
  mkdirSync(dataDir("outreach"), { recursive: true });
  const file =
    kind === "whatsapp-price"
      ? "whatsapp-price-sent.log"
      : kind === "whatsapp-close"
        ? "whatsapp-close-sent.log"
        : "whatsapp-sent.log";
  return dataDir("outreach", file);
}

function alreadySent(leadId: string, kind: SendKind = "whatsapp"): boolean {
  const path = sentLogPath(kind);
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(`\t${leadId}\t`);
}

function markSent(leadId: string, slug: string, kind: SendKind = "whatsapp") {
  appendFileSync(
    sentLogPath(kind),
    `${new Date().toISOString()}\t${leadId}\t${slug}\t${kind}\n`,
    "utf8",
  );
}

function openUrl(url: string) {
  const platform = process.platform;
  if (platform === "darwin") {
    execFileSync("open", [url], { stdio: "ignore" });
  } else if (platform === "win32") {
    execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
  } else {
    execFileSync("xdg-open", [url], { stdio: "ignore" });
  }
}

function preview(msg: OutreachMessage) {
  console.log("\n────────────────────────────────────────");
  console.log(`${msg.businessName} · ${msg.ownerFirstName}`);
  console.log(`Tel: ${msg.phone || "(sin teléfono)"}`);
  console.log(`Claim: ${msg.claimUrl}`);
  console.log("────────────────────────────────────────");
  console.log(msg.whatsappMessage);
  console.log("────────────────────────────────────────");
  if (msg.whatsappUrl) console.log(`Link: ${msg.whatsappUrl}`);
  else console.log("⚠ Sin número válido para WhatsApp");
  if (isDemoPhone(msg.phone)) {
    console.log(
      "⚠ Número de demo (fixture 555) — WhatsApp dirá que no existe. Usa un scrape real.",
    );
  }
}

export async function sendWhatsAppSemiAuto(
  messages: OutreachMessage[],
  opts: {
    batch?: boolean;
    open?: boolean;
    skipSent?: boolean;
    limit?: number;
    kind?: SendKind;
  } = {},
): Promise<{ opened: number; skipped: number; failed: number }> {
  const kind = opts.kind ?? "whatsapp";
  let batch = messages.filter((m) => m.whatsappUrl);
  const missingPhone = messages.filter((m) => !m.whatsappUrl).length;
  if (opts.skipSent !== false) {
    batch = batch.filter((m) => !alreadySent(m.leadId, kind));
  }
  if (opts.limit != null) batch = batch.slice(0, opts.limit);

  if (missingPhone > 0) {
    log.warn(`${missingPhone} lead(s) sin teléfono WhatsApp válido.`);
  }
  if (!batch.length) {
    const sentOnly =
      messages.filter((m) => m.whatsappUrl && alreadySent(m.leadId, kind))
        .length > 0;
    if (sentOnly) {
      const logName =
        kind === "whatsapp-price"
          ? "whatsapp-price-sent.log"
          : kind === "whatsapp-close"
            ? "whatsapp-close-sent.log"
            : "whatsapp-sent.log";
      log.warn(
        `Todos ya están en ${logName}. Usa --include-sent para reabrir.`,
      );
    } else {
      log.warn("Nada que abrir (sin números WhatsApp en el bundle).");
    }
    return { opened: 0, skipped: missingPhone, failed: 0 };
  }

  const kindLabel =
    kind === "whatsapp-price"
      ? "precio (follow-up)"
      : kind === "whatsapp-close"
        ? "cierre / transferencia"
        : "primer contacto";
  log.info(
    `${batch.length} mensaje(s) · ${kindLabel} · modo ${opts.batch ? "batch" : "aprobar uno a uno"}`,
  );
  log.info("Se abre WhatsApp con el texto listo — tú pulsas Enviar.");
  const demoCount = batch.filter((m) => isDemoPhone(m.phone)).length;
  if (demoCount > 0) {
    log.warn(
      `${demoCount} número(s) de fixture (809-555-…) — no están en WhatsApp. Corre scrape real con APIFY_TOKEN.`,
    );
  }

  let opened = 0;
  let skipped = 0;
  let failed = 0;

  const openOne = (msg: OutreachMessage) => {
    if (!msg.whatsappUrl) return;
    if (opts.open !== false) {
      openUrl(msg.whatsappUrl);
      markSent(msg.leadId, msg.slug, kind);
      log.ok(`Abierto · ${msg.businessName}`);
    } else {
      log.ok(`Link listo · ${msg.businessName}`);
    }
    opened += 1;
  };

  if (opts.batch) {
    preview(batch[0]!);
    const rl = createInterface({ input, output });
    const ans = (
      await rl.question(
        `\n¿Abrir los ${batch.length} chats de WhatsApp? [y/N] `,
      )
    )
      .trim()
      .toLowerCase();
    rl.close();
    if (!["y", "yes", "s", "si"].includes(ans)) {
      log.warn("Cancelado.");
      return { opened: 0, skipped: batch.length, failed: 0 };
    }
    for (const msg of batch) {
      try {
        openOne(msg);
      } catch (err) {
        failed += 1;
        log.error(
          `Falló ${msg.businessName}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } else {
    const rl = createInterface({ input, output });
    try {
      for (let i = 0; i < batch.length; i += 1) {
        const msg = batch[i]!;
        console.log(`\n[${i + 1}/${batch.length}]`);
        preview(msg);
        const ans = (
          await rl.question(
            "Abrir WhatsApp? [y] sí · [n] saltar · [q] salir · [b] batch resto: ",
          )
        )
          .trim()
          .toLowerCase();

        if (ans === "q" || ans === "quit") {
          skipped += batch.length - i;
          log.warn("Saliste del flujo.");
          break;
        }
        if (ans === "n" || ans === "skip" || ans === "") {
          skipped += 1;
          continue;
        }
        if (ans === "b" || ans === "batch") {
          for (const m of batch.slice(i)) {
            try {
              openOne(m);
            } catch {
              failed += 1;
            }
          }
          break;
        }
        if (["y", "yes", "s", "si"].includes(ans)) {
          try {
            openOne(msg);
            log.info("Pulsa Enviar en WhatsApp, luego vuelve aquí.");
          } catch (err) {
            failed += 1;
            log.error(err instanceof Error ? err.message : String(err));
          }
        } else {
          skipped += 1;
        }
      }
    } finally {
      rl.close();
    }
  }

  const linksPath = join(
    dataDir("outreach"),
    `whatsapp-links-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
  );
  const lines = batch
    .filter((m) => m.whatsappUrl)
    .map((m) => `${m.businessName}\t${m.phone}\t${m.whatsappUrl}`);
  if (lines.length) {
    writeFileSync(linksPath, lines.join("\n") + "\n", "utf8");
    log.info(`Links: ${linksPath}`);
  }

  return { opened, skipped, failed };
}
