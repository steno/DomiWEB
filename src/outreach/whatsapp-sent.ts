import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dataDir } from "../utils/paths.js";

export type WhatsAppSendKind = "whatsapp" | "whatsapp-price" | "whatsapp-close";

export type WhatsAppSentStatus = {
  firstAt: string | null;
  priceAt: string | null;
  closeAt: string | null;
};

export function sentLogPath(kind: WhatsAppSendKind = "whatsapp"): string {
  mkdirSync(dataDir("outreach"), { recursive: true });
  const file =
    kind === "whatsapp-price"
      ? "whatsapp-price-sent.log"
      : kind === "whatsapp-close"
        ? "whatsapp-close-sent.log"
        : "whatsapp-sent.log";
  return dataDir("outreach", file);
}

/** Latest ISO timestamp per leadId from a sent log (format: iso\tleadId\tslug\tkind). */
function latestTimestampsByLeadId(kind: WhatsAppSendKind): Map<string, string> {
  const path = sentLogPath(kind);
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [iso, leadId] = line.split("\t");
    if (!iso || !leadId) continue;
    map.set(leadId, iso);
  }
  return map;
}

export function alreadySent(
  leadId: string,
  kind: WhatsAppSendKind = "whatsapp",
): boolean {
  const path = sentLogPath(kind);
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(`\t${leadId}\t`);
}

export function markSent(
  leadId: string,
  slug: string,
  kind: WhatsAppSendKind = "whatsapp",
) {
  appendFileSync(
    sentLogPath(kind),
    `${new Date().toISOString()}\t${leadId}\t${slug}\t${kind}\n`,
    "utf8",
  );
}

/** Merge first / price / close sent logs keyed by lead id. */
export function loadWhatsAppSentByLeadId(): Map<string, WhatsAppSentStatus> {
  const first = latestTimestampsByLeadId("whatsapp");
  const price = latestTimestampsByLeadId("whatsapp-price");
  const close = latestTimestampsByLeadId("whatsapp-close");
  const ids = new Set([...first.keys(), ...price.keys(), ...close.keys()]);
  const out = new Map<string, WhatsAppSentStatus>();
  for (const id of ids) {
    out.set(id, {
      firstAt: first.get(id) ?? null,
      priceAt: price.get(id) ?? null,
      closeAt: close.get(id) ?? null,
    });
  }
  return out;
}

export function emptyWhatsAppSentStatus(): WhatsAppSentStatus {
  return { firstAt: null, priceAt: null, closeAt: null };
}
