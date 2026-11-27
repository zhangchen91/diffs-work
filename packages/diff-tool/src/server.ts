/**
 * The local diffs.work server.
 *
 *   diffs local            → http://127.0.0.1:5279  (viewer + inbox)
 *
 * Binds to loopback only. Serves the static viewer (apps/local/out) and a tiny
 * JSON API used by the DSH plugin and the Chrome extension. Files are read from
 * disk on request by name and never copied anywhere; the only things persisted
 * are tiny JSON records in ~/.diffs.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareFiles, summarizeThin, type CompareInput } from "./index.ts";
import { diffsHome, LOCAL_DEFAULT_PORT } from "@diffs/shared";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export interface LocalServerOptions {
  /** Directory of the built viewer (apps/local/out). */
  staticDir: string;
  port?: number;
  host?: string;
  /** Called with the real bound port (after listen). */
  onReady?: (info: { url: string; port: number }) => void;
}

export interface LocalServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * Loopback-only server. The public website probes /api/health and /api/diff from
 * a cross-origin page, so allow Origin but keep everything on 127.0.0.1.
 */
const CORS = process.env.DIFFS_CORS === "off" ? {} : {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS };

export async function startLocalServer(opts: LocalServerOptions): Promise<LocalServer> {
  const dataDir = diffsHome();
  await mkdir(path.join(dataDir, "inbox"), { recursive: true });
  await mkdir(path.join(dataDir, "diffs"), { recursive: true });

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, opts, dataDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A caller that sent a bad path or malformed JSON learns more from 400 than from 500, and a
      // monitor stops paging on errors the client caused. Anything else really is our fault.
      const status = isClientError(err, message) ? 400 : 500;
      sendJson(res, status, { error: message });
    }
  });

  const port = opts.port ?? LOCAL_DEFAULT_PORT;
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EADDRINUSE") return reject(err);
      // Port taken. The common cause is that the viewer is already running, so say that — and if
      // it is *our* server answering, that is worth knowing before anyone goes killing processes.
      void (async () => {
        let running = false;
        try {
          const res = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(800) });
          const body = (await res.json()) as { ok?: boolean; version?: string };
          running = body?.ok === true;
        } catch {
          /* something else holds the port */
        }
        reject(
          new Error(
            running
              ? `diffs is already running at http://${host}:${port} — open that tab, or stop it first.`
              : `port ${port} on ${host} is in use by another program. Stop it, or start diffs on another port: --port ${port + 1}`,
          ),
        );
      })();
    });
    server.listen(port, host, () => resolve());
  });
  const bound = (server.address() as { port: number }).port;
  const url = `http://${host}:${bound}`;
  opts.onReady?.({ url, port: bound });
  return {
    url,
    port: bound,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Whether the caller, rather than this server, caused the failure. */
function isClientError(err: unknown, message: string): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT" || code === "EISDIR" || code === "EACCES") return true;
  if (err instanceof SyntaxError) return true; // malformed JSON body
  return /needs `old`|needs `new`|over the .* limit|is a directory|no such file/.test(message);
}

async function route(req: IncomingMessage, res: ServerResponse, opts: LocalServerOptions, dataDir: string): Promise<void> {
  await routeInner(req, res, opts, dataDir);
}

async function routeInner(req: IncomingMessage, res: ServerResponse, opts: LocalServerOptions, dataDir: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const p = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (p === "/api/pair" && req.method === "POST") {
    const pair = (await readJson(req)) as { oldBase64?: string; oldName?: string; newBase64?: string; newName?: string };
    const id = crypto.randomUUID();
    const dir = path.join(dataDir, "pairs");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({ ...pair, id, at: new Date().toISOString() }),
    );
    sendJson(res, 200, { id, url: `/#/compare?pair=${id}` });
    return;
  }
  if (p.startsWith("/api/pair/") && p.endsWith("/config")) {
    const id = p.slice("/api/pair/".length, -"/config".length).replace(/[^\w-]/g, "");
    const raw = await readFile(path.join(dataDir, "pairs", `${id}.json`), "utf8").catch(() => null);
    if (!raw) return sendJson(res, 404, { error: "pair not found" });
    const pair = JSON.parse(raw) as { oldName?: string; oldBase64?: string; newName?: string; newBase64?: string };
    // the engine picks its renderer from the file NAME: keep the real extension
    const nameOf = (n: string | undefined) => (n && /\.[a-z0-9]{1,8}$/i.test(n) ? n : `${n ?? "file"}.bin`);
    return sendJson(res, 200, {
      title: `${pair.oldName ?? "old"} → ${pair.newName ?? "new"}`,
      subtitle: "由 diffs.work 本地视图打开的对比",
      old: { name: nameOf(pair.oldName), data: pair.oldBase64 },
      new: { name: nameOf(pair.newName), data: pair.newBase64 },
    });
  }
  if (p.startsWith("/api/pair/")) {
    const id = p.slice("/api/pair/".length);
    const f = path.join(dataDir, "pairs", `${id.replace(/[^\w-]/g, "")}.json`);
    const raw = await readFile(f, "utf8").catch(() => null);
    if (!raw) return sendJson(res, 404, { error: "pair not found" });
    res.writeHead(200, { ...JSON_HEADERS });
    res.end(raw);
    return;
  }
  if (p === "/api/health") return sendJson(res, 200, { ok: true, version: "local", cwd: process.cwd() });
  if (p === "/api/diff") return handleDiff(req, res, url);
  if (p === "/api/file") return handleFile(res, url);
  if (p === "/api/open") return handleOpen(req, res, dataDir);
  if (p === "/api/inbox" && req.method === "GET") return handleInboxList(res, dataDir);
  if (p === "/api/inbox" && req.method === "POST") return handleInboxAdd(req, res, dataDir);
  if (p === "/api/zip") return sendJson(res, 501, { error: "zip is not supported yet" });
  // Anything else under /api/ is a mistake, and answering with the HTML shell (status 200) made a
  // client try to parse a web page as JSON. Say 404, in JSON, like every other API response.
  if (p.startsWith("/api/")) return sendJson(res, 404, { error: `no such endpoint: ${p}` });

  // the local viewer reuses the website's /examples bookmarks
  if (p.startsWith("/examples/")) {
    const siteDir = path.resolve(opts.staticDir, "../../website/public");
    const repoExamples = path.resolve(opts.staticDir, "../../../examples");
    for (const base of [repoExamples, siteDir]) {
      const f = path.join(base, p);
      const st = await stat(f).catch(() => null);
      if (st?.isFile()) {
        const bytes = await readFile(f);
        res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream", ...CORS });
        res.end(bytes);
        return;
      }
    }
  }
  // The local viewer embeds the legacy rev view; its module script may not be
  // served as text/html (Vite's preview does that).
  if (p.endsWith(".mjs") || p.endsWith(".js")) {
    const abs = path.join(opts.staticDir, decodeURIComponent(p.replace(/^\/+/, "")));
    const bytes = await readFile(abs).catch(() => null);
    if (bytes) {
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        ...CORS,
      });
      res.end(bytes);
      return;
    }
  }
  if (p === "/legacy/diff.json") {
    const bytes = JSON.stringify(
      {
        title: "本地 Diff · 把两份文件拖进 /legacy 页面即可",
        subtitle: "也可以在第 1 个卡片里换 diff.json 指向你自己的文件（相对路径以本站为根）",
        old: { name: "old", url: "/examples/docx/contract-v1.docx" },
        new: { name: "new", url: "/examples/docx/contract-v2.docx" },
      },
      null,
      2,
    );
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(bytes);
    return;
  }

  await serveStatic(res, opts.staticDir, p);
}

async function handleDiff(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  let input: CompareInput = {};
  if (req.method === "POST") input = (await readJson(req)) as CompareInput;
  else {
    input = {
      old: url.searchParams.get("old") ?? undefined,
      new: url.searchParams.get("new") ?? undefined,
      revision: url.searchParams.get("revision") ?? undefined,
      cwd: url.searchParams.get("cwd") ?? undefined,
      context: url.searchParams.get("context") ? Number(url.searchParams.get("context")) : undefined,
    };
  }
  // `compareFiles` already carries the summary. Recomputing it here made the same xlsx come back
  // with a different `summary` over HTTP than on the command line.
  const result = await compareFiles(input);
  sendJson(res, 200, result);
}

async function handleFile(res: ServerResponse, url: URL): Promise<void> {
  const file = url.searchParams.get("path");
  if (!file) return sendJson(res, 400, { error: "path required" });
  const abs = path.resolve(file.startsWith("/") ? file : path.join(process.cwd(), file));
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile()) return sendJson(res, 404, { error: `not a file: ${abs}` });
  const bytes = await readFile(abs);
  res.writeHead(200, {
    "content-type": MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
    "content-length": String(bytes.byteLength),
    "cache-control": "no-store",
    "x-diffs-path": encodeURIComponent(abs),
  });
  res.end(bytes);
}

interface OpenedDiff {
  id: string;
  createdAt: string;
  title: string;
  old: { label: string; path: string } | null;
  new: { label: string; path: string } | null;
  source: string;
}

async function handleOpen(req: IncomingMessage, res: ServerResponse, dataDir: string): Promise<void> {
  const body = (await readJson(req)) as Partial<OpenedDiff> & { from?: OpenedDiff };
  const id = crypto.randomUUID();
  const record: OpenedDiff = {
    id,
    createdAt: new Date().toISOString(),
    title: body.title || "未命名对比",
    old: body.old ?? body.from?.old ?? null,
    new: body.new ?? body.from?.new ?? null,
    source: body.source || "api",
  };
  await writeFile(path.join(dataDir, "diffs", `${id}.json`), JSON.stringify(record, null, 2));
  sendJson(res, 200, { id, url: `/#/compare?pair=${id}` });
}

async function handleInboxList(res: ServerResponse, dataDir: string): Promise<void> {
  const dir = path.join(dataDir, "diffs");
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const items = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as OpenedDiff),
  );
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  sendJson(res, 200, { items: items.slice(0, 100) });
}

async function handleInboxAdd(req: IncomingMessage, res: ServerResponse, dataDir: string): Promise<void> {
  const body = (await readJson(req)) as OpenedDiff;
  const id = body.id || crypto.randomUUID();
  const record = { ...body, id, createdAt: body.createdAt || new Date().toISOString() };
  await writeFile(path.join(dataDir, "diffs", `${id}.json`), JSON.stringify(record, null, 2));
  sendJson(res, 200, { id });
}

async function serveStatic(res: ServerResponse, root: string, pathname: string): Promise<void> {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.replace(/^\/+/, ""));
  const abs = path.join(root, rel);
  if (!abs.startsWith(path.resolve(root))) return sendJson(res, 403, { error: "forbidden" });
  let target = abs;
  const st = await stat(target).catch(() => null);
  if (!st || st.isDirectory()) target = path.join(abs, "index.html");
  const exists = await stat(target).catch(() => null);
  if (!exists?.isFile()) {
    // SPA fallback
    const fallback = path.join(root, "index.html");
    if (await stat(fallback).catch(() => null)) {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(await readFile(fallback));
      return;
    }
    return sendJson(res, 404, { error: "not found" });
  }
  const bytes = await readFile(target);
  res.writeHead(200, {
    "content-type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream",
    "cache-control": "no-store",
    ...CORS,
  });
  res.end(bytes);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}