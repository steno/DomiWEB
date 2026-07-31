import { readFileSync } from "node:fs";
import { z } from "zod";
import { getOpenAI, openAiModel } from "../ai/openai.js";
import type { Lead, ScrapedPlace } from "../types/index.js";
import { promptsDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";

const ExtractionSchema = z.object({
  firstName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().nullable().optional(),
});

export type OwnerNameExtraction = z.infer<typeof ExtractionSchema>;

function loadPromptTemplate(): string {
  return readFileSync(promptsDir("name-extraction.md"), "utf8");
}

function reviewsPayload(place: ScrapedPlace): string {
  const lines = place.reviews.map((r, i) => {
    const bits = [
      `#${i + 1}`,
      `autor=${r.author}`,
      `estrellas=${r.rating}`,
      `fecha=${r.publishedAt ?? "desconocida"}`,
      `texto=${JSON.stringify(r.text)}`,
    ];
    if (r.ownerResponse) {
      bits.push(`respuesta_dueno=${JSON.stringify(r.ownerResponse)}`);
    }
    return bits.join(" | ");
  });
  return lines.join("\n") || "(sin reseñas con texto)";
}

/**
 * Extract likely owner/manager first name from Google reviews + owner replies.
 */
export async function extractOwnerFirstName(
  place: ScrapedPlace,
): Promise<OwnerNameExtraction> {
  const openai = getOpenAI();
  const system = loadPromptTemplate();
  const user = [
    `Negocio: ${place.name}`,
    `Categoría: ${place.category ?? "n/d"}`,
    `Ciudad: ${place.city ?? "n/d"}`,
    "",
    "Reseñas:",
    reviewsPayload(place),
    "",
    "Responde SOLO con JSON válido según el formato del prompt (sin markdown).",
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: openAiModel(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { firstName: null, confidence: 0, evidence: "JSON inválido del modelo" };
  }

  const result = ExtractionSchema.safeParse(parsed);
  if (!result.success) {
    return { firstName: null, confidence: 0, evidence: "Schema inválido" };
  }

  const firstName = result.data.firstName?.trim() || null;
  // Normalize: single first token, title case-ish for Spanish names
  const normalized = firstName
    ? firstName.split(/\s+/)[0]!.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]/g, "")
    : null;
  const lowered = normalized?.toLowerCase() ?? "";
  const bogus = new Set([
    "null",
    "undefined",
    "n/a",
    "na",
    "unknown",
    "hola",
    "dueño",
    "dueno",
    "owner",
  ]);

  return {
    firstName: normalized && !bogus.has(lowered) ? normalized : null,
    confidence: result.data.confidence,
    evidence: result.data.evidence ?? null,
  };
}

export async function extractNamesForLeads(
  leads: Lead[],
  opts: { limit?: number; minConfidence?: number } = {},
): Promise<
  Array<{
    lead: Lead;
    extraction: OwnerNameExtraction;
  }>
> {
  const minConfidence = opts.minConfidence ?? 0;
  const batch = opts.limit ? leads.slice(0, opts.limit) : leads;
  const out: Array<{ lead: Lead; extraction: OwnerNameExtraction }> = [];

  for (const lead of batch) {
    log.info(`Nombre · ${lead.place.name}`);
    try {
      const extraction = await extractOwnerFirstName(lead.place);
      if (
        extraction.firstName &&
        extraction.confidence < minConfidence
      ) {
        extraction.firstName = null;
      }
      out.push({ lead, extraction });
      const label = extraction.firstName
        ? `${extraction.firstName} (${extraction.confidence.toFixed(2)})`
        : `sin nombre (${extraction.confidence.toFixed(2)})`;
      log.ok(`  → ${label}`);
    } catch (err) {
      log.error(
        `  → falló: ${err instanceof Error ? err.message : String(err)}`,
      );
      out.push({
        lead,
        extraction: {
          firstName: null,
          confidence: 0,
          evidence: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return out;
}
