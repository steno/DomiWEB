import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is missing. Add it to .env (never to .gitignore).",
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

export function openAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

/** Prefer a stronger model for HTML when available; mini is the safe default. */
export function openAiSiteModel(): string {
  return (
    process.env.OPENAI_SITE_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}
