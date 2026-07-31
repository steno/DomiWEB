import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { watch, existsSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { dataDir, publicDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";
import { buildDashboardPayload, writeDashboardSnapshot } from "./payload.js";

type SseClient = {
  id: number;
  res: ServerResponse;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(json);
}

function dbWatchTargets(): string[] {
  const base = dataDir("db", "leads.sqlite");
  return [base, `${base}-wal`, `${base}-shm`];
}

function latestDbMtimeMs(): number {
  let max = 0;
  for (const p of dbWatchTargets()) {
    if (!existsSync(p)) continue;
    try {
      max = Math.max(max, statSync(p).mtimeMs);
    } catch {
      /* ignore race */
    }
  }
  return max;
}

export function startDashboardServer(port = 4174): void {
  const clients = new Map<number, SseClient>();
  let nextClientId = 1;
  let lastPayload = writeDashboardSnapshot(buildDashboardPayload());
  let lastMtime = latestDbMtimeMs();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function broadcast() {
    try {
      lastPayload = writeDashboardSnapshot(buildDashboardPayload());
      lastMtime = latestDbMtimeMs();
      const data = `event: update\ndata: ${JSON.stringify(lastPayload)}\n\n`;
      for (const client of clients.values()) {
        client.res.write(data);
      }
    } catch (err) {
      log.error(
        `Dashboard refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function scheduleRefresh(reason: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const mtime = latestDbMtimeMs();
      if (mtime === lastMtime && reason !== "force") return;
      log.info(`Dashboard refresh (${reason})`);
      broadcast();
    }, 150);
  }

  for (const target of dbWatchTargets()) {
    const dir = dataDir("db");
    if (!existsSync(dir)) continue;
    try {
      watch(target, { persistent: true }, () => scheduleRefresh("db"));
    } catch {
      /* file may not exist yet */
    }
  }

  // Catch creates of wal/shm after first write
  try {
    watch(dataDir("db"), { persistent: true }, (_event, filename) => {
      if (!filename || !String(filename).startsWith("leads.sqlite")) return;
      scheduleRefresh("db-dir");
    });
  } catch {
    /* ignore */
  }

  // Poll as fallback — SQLite WAL updates can be quiet on some FS
  setInterval(() => {
    const mtime = latestDbMtimeMs();
    if (mtime !== lastMtime) scheduleRefresh("poll");
  }, 1000);

  const dashboardDir = publicDir("dashboard");

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/api/state") {
      try {
        lastPayload = buildDashboardPayload();
        sendJson(res, 200, lastPayload);
      } catch (err) {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (url.pathname === "/api/stream") {
      const id = nextClientId++;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(`event: update\ndata: ${JSON.stringify(lastPayload)}\n\n`);
      res.write(`: connected ${id}\n\n`);
      clients.set(id, { id, res });
      req.on("close", () => clients.delete(id));
      return;
    }

    let path = url.pathname;
    if (path === "/" || path === "/dashboard" || path === "/dashboard/") {
      path = "/index.html";
    }
    if (path.startsWith("/dashboard/")) {
      path = path.slice("/dashboard".length);
    }

    const filePath = publicDir("dashboard", path.replace(/^\//, "") || "index.html");
    if (!filePath.startsWith(dashboardDir) || !existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const type = MIME[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": path.endsWith(".html") ? "no-store" : "public, max-age=60",
    });
    createReadStream(filePath).pipe(res);
  });

  server.listen(port, () => {
    log.ok(`Dashboard live at http://localhost:${port}`);
    log.info("Auto-updates when leads.sqlite changes (pipeline events).");
  });
}
