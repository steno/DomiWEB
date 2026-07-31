import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { getOpenAI } from "../ai/openai.js";
import type { NicheConfig } from "../types/index.js";
import { dataDir, projectRoot, promptsDir, publicDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";

const require = createRequire(import.meta.url);

export interface FaceCamResult {
  script: string;
  audioPath: string;
  videoPath: string;
  publicVideoPath: string;
  sourceImage: string;
  voiceProvider: string;
}

function loadVideoPrompt(): string {
  return readFileSync(promptsDir("face-cam-video.md"), "utf8");
}

export function resolveFaceSourceImage(): string {
  const preferred = join(projectRoot(), "assets", "facecam-source.png");
  if (existsSync(preferred)) return preferred;
  const jpg = join(projectRoot(), "assets", "facecam-source.jpg");
  if (existsSync(jpg)) return jpg;
  throw new Error(
    "Missing assets/facecam-source.png — drop your face photo there.",
  );
}

export function buildSpokenScript(config: NicheConfig): string {
  const prompt = loadVideoPrompt();
  const match = prompt.match(/>\s*([\s\S]*?)\n\n## Rules/);
  let script =
    match?.[1]
      ?.split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() ??
    "oye, esto puede sonar un poco random, pero encontré tu negocio de {{NICHE_SINGULAR}} en Google, las reseñas están buenísimas de verdad, y noté que no tenías página web. así que te armé una con tus propias reseñas. aquí te dejo un vistazo rápido, y si te gusta, es tuya.";

  return script.replace(/\{\{NICHE_SINGULAR\}\}/g, config.niche.labelSingular);
}

function edgeVoice(): string {
  // Male Dominican Spanish neural voice (Microsoft Edge TTS).
  return process.env.EDGE_TTS_VOICE?.trim() || "es-DO-EmilioNeural";
}

async function synthesizeWithEdge(script: string, outPath: string): Promise<void> {
  const { EdgeTTS } = require("node-edge-tts") as {
    EdgeTTS: new (opts: { voice: string; lang: string }) => {
      ttsPromise: (text: string, file: string) => Promise<void>;
    };
  };
  mkdirSync(dirname(outPath), { recursive: true });
  const tts = new EdgeTTS({ voice: edgeVoice(), lang: "es-DO" });
  await tts.ttsPromise(script, outPath);
}

async function synthesizeWithOpenAI(
  script: string,
  outPath: string,
): Promise<void> {
  const openai = getOpenAI();
  const model = process.env.OPENAI_TTS_MODEL?.trim() || "tts-1-hd";
  const voice = (process.env.OPENAI_TTS_VOICE?.trim() || "onyx") as "onyx";
  const res = await openai.audio.speech.create({
    model,
    voice,
    input: script,
    response_format: "mp3",
  });
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

async function synthesizeSpeech(
  script: string,
  outPath: string,
): Promise<string> {
  const prefer = process.env.TTS_PROVIDER?.trim().toLowerCase() || "edge";
  if (prefer === "openai") {
    try {
      await synthesizeWithOpenAI(script, outPath);
      return "openai";
    } catch (err) {
      log.warn(
        `OpenAI TTS falló (${err instanceof Error ? err.message : String(err)}) → Edge es-DO`,
      );
      await synthesizeWithEdge(script, outPath);
      return "edge";
    }
  }

  try {
    await synthesizeWithEdge(script, outPath);
    return `edge:${edgeVoice()}`;
  } catch (err) {
    log.warn(
      `Edge TTS falló (${err instanceof Error ? err.message : String(err)}) → OpenAI`,
    );
    await synthesizeWithOpenAI(script, outPath);
    return "openai";
  }
}

/**
 * Build a reusable face-cam mp4: provided still + Dominican Spanish TTS.
 * Subtle slow zoom so the bubble feels alive until a lipsync model is wired.
 */
export function stitchFaceCamVideo(
  imagePath: string,
  audioPath: string,
  outPath: string,
): void {
  mkdirSync(dirname(outPath), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loop",
      "1",
      "-i",
      imagePath,
      "-i",
      audioPath,
      "-vf",
      "scale=720:720:force_original_aspect_ratio=increase,crop=720:720,zoompan=z='min(zoom+0.00035,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x720:fps=25",
      "-c:v",
      "libx264",
      "-tune",
      "stillimage",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      outPath,
    ],
    { stdio: "pipe" },
  );
}

export async function generateFaceCamVideo(
  config: NicheConfig,
): Promise<FaceCamResult> {
  const sourceImage = resolveFaceSourceImage();
  const script = buildSpokenScript(config);
  const nicheId = config.niche.id;

  const workDir = dataDir("videos");
  mkdirSync(workDir, { recursive: true });
  mkdirSync(publicDir("videos"), { recursive: true });

  const audioPath = join(workDir, `facecam-${nicheId}.mp3`);
  const videoPath = join(workDir, `facecam-${nicheId}.mp4`);
  const publicVideoPath = join(publicDir("videos"), `facecam-${nicheId}.mp4`);
  const publicSource = join(publicDir("videos"), "facecam-source.png");

  log.info(`Face source · ${sourceImage}`);
  log.info(`Script · ${script.slice(0, 90)}…`);

  copyFileSync(sourceImage, publicSource);

  log.info(`TTS · ${edgeVoice()} (español dominicano)`);
  const voiceProvider = await synthesizeSpeech(script, audioPath);
  log.ok(`Audio · ${audioPath} (${voiceProvider})`);

  log.info("ffmpeg · still + audio → mp4");
  stitchFaceCamVideo(sourceImage, audioPath, videoPath);
  copyFileSync(videoPath, publicVideoPath);
  log.ok(`Video · ${publicVideoPath}`);

  writeFileSync(
    join(workDir, `facecam-${nicheId}-script.txt`),
    script + "\n",
    "utf8",
  );

  return {
    script,
    audioPath,
    videoPath,
    publicVideoPath,
    sourceImage,
    voiceProvider,
  };
}
