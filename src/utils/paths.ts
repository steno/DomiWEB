import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root (…/DomiWEB), regardless of cwd. */
export function projectRoot(): string {
  return resolve(__dirname, "..", "..");
}

export function dataDir(...parts: string[]): string {
  return resolve(projectRoot(), "data", ...parts);
}

export function publicDir(...parts: string[]): string {
  return resolve(projectRoot(), "public", ...parts);
}

export function configDir(...parts: string[]): string {
  return resolve(projectRoot(), "config", ...parts);
}

export function promptsDir(...parts: string[]): string {
  return resolve(projectRoot(), "prompts", ...parts);
}
