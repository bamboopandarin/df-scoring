import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import worker from '../static/_worker.js';
import { localD1 } from './local-d1.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = resolve(root, 'static');
const dbPath = process.env.DF_LOCAL_DB || resolve(root, '.wrangler', 'local-scoring.sqlite');
await mkdir(resolve(root, '.wrangler'), { recursive: true });

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webm': 'audio/webm', '.mp3': 'audio/mpeg' };

const env = {
  DF_ADMIN_PASSWORD: process.env.DF_ADMIN_PASSWORD,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  DF_SCORING_DB: localD1(dbPath),
  DF_SCORING_KV: {
    async get(key) {
      if (process.env.DF_LOCAL_DB === ':memory:') return null;
      try {
        return JSON.parse(await readFile(resolve(root, 'data', key + '.json'), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }
  },
  ASSETS: {
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const fromUploads = pathname.startsWith('/uploads/');
      const assetRoot = fromUploads ? resolve(root, 'uploads') : staticRoot;
      const relative = fromUploads ? pathname.slice('/uploads/'.length) : pathname.slice(1) || 'index.html';
      const path = resolve(assetRoot, relative);
      if (!path.startsWith(assetRoot + sep) || relative === '_worker.js') return new Response(null, { status: 404 });
      try {
        const content = await readFile(path);
        return new Response(content, {
          headers: { 'Content-Type': (types[extname(path)] || 'application/octet-stream'), 'Cache-Control': 'no-store' }
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    }
  }
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://' + incoming.headers.host);
    const request = new Request(url, {
      method: incoming.method, headers: incoming.headers,
      ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' })
    });
    const response = await worker.fetch(request, env, { waitUntil: () => {} });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.writeHead(500).end();
  }
});
server.listen(Number(process.env.DF_LOCAL_PORT || 8000), () => console.log('DF Scoring aktif di http://localhost:' + server.address().port));
