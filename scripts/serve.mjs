// Serves dist/ the way GitHub Pages does: under /product-tour-layer/, with 404.html for unknown paths
// (which is how the demo app's deep links work). Run: npm run build && npm run serve
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist');
const PREFIX = '/product-tour-layer';
const PORT = Number(process.env.PORT) || 4173;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.zip': 'application/zip',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') return res.writeHead(302, { location: PREFIX + '/' }).end();
  let file = url.pathname.startsWith(PREFIX) ? decodeURIComponent(url.pathname.slice(PREFIX.length)) : null;
  if (file !== null && (file === '' || file.endsWith('/'))) file += 'index.html';
  try {
    if (file === null || file.includes('..')) throw new Error('not found');
    const body = await readFile(join(dist, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' }).end(await readFile(join(dist, '404.html')));
  }
}).listen(PORT, () => console.log(`Serving dist/ at http://localhost:${PORT}${PREFIX}/`));
