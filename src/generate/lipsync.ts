import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fal } from "@fal-ai/client";
import { log } from "../utils/logger.js";

const LIPSYNC_MODEL = "fal-ai/sync-lipsync/v3/image-to-video";

function ensureFalKey(): void {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error(
      "FAL_KEY missing. Create one at https://fal.ai/dashboard/keys and add FAL_KEY=… to .env",
    );
  }
  fal.config({ credentials: key });
}

async function uploadLocalFile(path: string, mime: string): Promise<string> {
  const buf = readFileSync(path);
  const file = new File([buf], basename(path), { type: mime });
  const url = await fal.storage.upload(file);
  return url;
}

/**
 * Lip-sync your face photo to Dominican Spanish audio via fal sync-3.
 * Returns a remote mp4 URL (caller downloads to public/videos).
 */
export async function generateLipsyncVideo(opts: {
  imagePath: string;
  audioPath: string;
}): Promise<{ videoUrl: string; requestId: string }> {
  ensureFalKey();
  if (!existsSync(opts.imagePath)) {
    throw new Error(`Image not found: ${opts.imagePath}`);
  }
  if (!existsSync(opts.audioPath)) {
    throw new Error(`Audio not found: ${opts.audioPath}`);
  }

  log.info("fal · uploading face + audio");
  const imageMime = opts.imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const audioMime = opts.audioPath.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  const [imageUrl, audioUrl] = await Promise.all([
    uploadLocalFile(opts.imagePath, imageMime),
    uploadLocalFile(opts.audioPath, audioMime),
  ]);
  log.ok(`fal · image + audio uploaded`);

  log.info(`fal · ${LIPSYNC_MODEL} (lipsync)`);
  const result = await fal.subscribe(LIPSYNC_MODEL, {
    input: {
      image_url: imageUrl,
      audio_url: audioUrl,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS" && update.logs) {
        for (const line of update.logs) {
          if (line.message) log.info(`  ${line.message}`);
        }
      }
    },
  });

  const videoUrl = (result.data as { video?: { url?: string } })?.video?.url;
  if (!videoUrl) {
    throw new Error(`fal lipsync returned no video URL: ${JSON.stringify(result.data)}`);
  }

  return { videoUrl, requestId: result.requestId };
}

export async function downloadToFile(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  // Node 20+ fetch body is a web ReadableStream
  const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(outPath));
}
