import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { AppCompiler, buildBase, bundledFonts, type Build, type BaseBuild } from '@mimicry/compiler';
import { DEVICES, type PlatformName } from '@mimicry/protocol';
import { buildStudio, STUDIO_HTML } from './studio-build';

/**
 * Dev server: serves the Studio, the content-addressed base module, per-
 * platform side modules, project assets and fonts, and pushes hot updates
 * over Server-Sent Events.
 */
export interface DevServerOptions {
  project: string;
  port: number;
  host: string;
  log?: (line: string) => void;
}

/** Only these project files are served: what an app can `require` as an image. */
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ttf', '.otf']);

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.bmp': 'image/bmp',
};

export async function startDevServer(options: DevServerOptions) {
  const log = options.log ?? ((l: string) => console.log(l));
  const root = resolve(options.project);
  const compiler = new AppCompiler({
    root,
    assetUrl: (file) => `/__mimicry/assets/${encodeURI(file.slice(root.length + 1).split(sep).join('/'))}`,
  });
  compiler.entry(); // fail fast with a clear message when there is no entry
  const projectName = await readProjectName(root);

  const t0 = Date.now();
  let base: BaseBuild = await buildBase();
  let studio = await buildStudio();
  log(`  base module   ${base.fileName}  ${(base.bytes / 1024).toFixed(0)} KB  (${Date.now() - t0} ms)`);

  const fonts = bundledFonts();
  const fontFiles = new Map(fonts.map((f) => [basename(f.url), f.file]));
  const builds = new Map<PlatformName, Promise<Build>>();
  const clients = new Set<ServerResponse>();

  const broadcast = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(payload);
  };

  const stopWatching = compiler.watch(
    (updates) => {
      for (const u of updates) {
        if (u.modules.length) log(`  hot update    ${u.platform}: ${u.modules.map((m) => m.id).join(', ')}`);
        for (const e of u.errors) log(`  error         ${e.file ?? ''} ${e.message.split('\n')[0]}`);
        builds.set(u.platform, compiler.build(u.platform));
        broadcast('update', u);
      }
    },
    (error) => broadcast('log', { message: String(error) }),
  );

  const send = (res: ServerResponse, status: number, body: string | Buffer, type: string, cache = 'no-cache') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  };

  // DNS rebinding guard: a page on another origin that resolves to this machine
  // must not be able to read project files through the dev server.
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', options.host]);
  const hostAllowed = (header: string | undefined) => {
    if (!header) return false;
    const name = header.startsWith('[') ? header.slice(0, header.indexOf(']') + 1) : header.split(':')[0]!;
    return allowedHosts.has(name) || options.host === '0.0.0.0';
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host)) return send(res, 403, 'Forbidden host', 'text/plain');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    if (path === '/' || path === '/index.html') return send(res, 200, STUDIO_HTML, MIME['.html']!);
    if (path === '/favicon.ico') return send(res, 204, '', 'image/x-icon');
    if (path === '/__mimicry/studio.js') return send(res, 200, studio.js, MIME['.js']!);
    if (path === '/__mimicry/studio.css') return send(res, 200, studio.css, MIME['.css']!);
    if (path === '/__mimicry/manifest') {
      return send(res, 200, JSON.stringify({
        project: { name: projectName },
        base: `/__mimicry/${base.fileName}`,
        devices: DEVICES,
        fonts: fonts.map(({ family, weight, style, url }) => ({ family, weight, style, url })),
      }), MIME['.json']!);
    }
    if (path === `/__mimicry/${base.fileName}`) return send(res, 200, base.code, MIME['.js']!, 'public, max-age=31536000, immutable');
    if (path === '/__mimicry/app') {
      const platform = url.searchParams.get('platform') === 'android' ? 'android' : 'ios';
      let pending = builds.get(platform);
      if (!pending) {
        pending = compiler.build(platform);
        builds.set(platform, pending);
      }
      try {
        const build = await pending;
        return send(res, 200, JSON.stringify(build), MIME['.json']!);
      } catch (error) {
        builds.delete(platform);
        return send(res, 500, String((error as Error).message ?? error), 'text/plain; charset=utf-8');
      }
    }
    if (path === '/__mimicry/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path.startsWith('/__mimicry/assets/')) {
      const file = normalize(join(root, decodeURI(path.slice('/__mimicry/assets/'.length))));
      if (!ASSET_EXTENSIONS.has(extname(file).toLowerCase())) return send(res, 403, 'Forbidden', 'text/plain');
      let real: string;
      try {
        real = await realpath(file);
      } catch {
        return send(res, 404, 'Not found', 'text/plain');
      }
      const realRoot = await realpath(root);
      if (!real.startsWith(realRoot + sep)) return send(res, 403, 'Forbidden', 'text/plain');
      return serveFile(res, real);
    }
    if (path.startsWith('/__mimicry/fonts/')) {
      const file = fontFiles.get(basename(path));
      if (!file) return send(res, 404, 'Not found', 'text/plain');
      return serveFile(res, file, 'public, max-age=31536000, immutable');
    }
    return send(res, 404, 'Not found', 'text/plain');
  }

  async function serveFile(res: ServerResponse, file: string, cache = 'no-cache'): Promise<void> {
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      send(res, 200, await readFile(file), MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', cache);
    } catch {
      send(res, 404, 'Not found', 'text/plain');
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => send(res, 500, String(error), 'text/plain'));
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port, options.host, done);
  });
  const heartbeat = setInterval(() => broadcast('ping', {}), 25_000);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${port}`,
    async rebuildBase() {
      base = await buildBase();
      studio = await buildStudio();
    },
    async close() {
      clearInterval(heartbeat);
      stopWatching();
      for (const c of clients) c.end();
      await new Promise((done) => server.close(done));
    },
  };
}

async function readProjectName(root: string): Promise<string> {
  try {
    const app = JSON.parse(await readFile(join(root, 'app.json'), 'utf8'));
    if (app?.expo?.name) return app.expo.name;
  } catch {
    // no app.json
  }
  try {
    return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name ?? basename(root);
  } catch {
    return basename(root);
  }
}
