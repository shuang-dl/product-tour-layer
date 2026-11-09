// A stand-in for where tour events will go once the tour script is inside DoorLoop (DoorLoop's own analytics).
// It keeps the events the extension sends, one JSON object per line, in data/events.ndjson.
// Run: npm run collector, then in the extension's menu set Reporting (test) to http://localhost:4174/events
//   POST /events  { events: [...] }   adds events (the extension sends them in batches)
//   GET  /events?tour=<id>            the events kept so far, oldest first (all tours without ?tour=)
// PORT and EVENTS_FILE change the port and the file (the tests use both).
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.env.EVENTS_FILE || join(dirname(fileURLToPath(import.meta.url)), '../data/events.ndjson');
const PORT = Number(process.env.PORT) || 4174;
const MAX_BODY = 1_000_000;
// The extension's background is another origin; it may send and read
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const reply = (res, status, body) => res.writeHead(status, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify(body));
const isEvent = (e) => e && typeof e === 'object' && typeof e.type === 'string' && typeof e.tourId === 'string';

async function readEvents() {
  try {
    return (await readFile(FILE, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  if (url.pathname !== '/events') return reply(res, 404, { error: 'not found' });
  try {
    if (req.method === 'GET') {
      const tour = url.searchParams.get('tour');
      const events = await readEvents();
      return reply(res, 200, { events: tour ? events.filter((e) => e.tourId === tour) : events });
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'use GET or POST' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) return reply(res, 413, { error: 'too big' });
    }
    const events = JSON.parse(body).events;
    if (!Array.isArray(events) || !events.every(isEvent)) return reply(res, 400, { error: 'expected { events: [...] }' });
    const receivedAt = new Date().toISOString();
    await mkdir(dirname(FILE), { recursive: true });
    await appendFile(FILE, events.map((e) => JSON.stringify({ ...e, receivedAt }) + '\n').join(''));
    reply(res, 200, { ok: true, kept: events.length });
  } catch (e) {
    reply(res, 400, { error: e.message });
  }
}).listen(PORT, () => console.log(`Collecting tour events at http://localhost:${PORT}/events into ${FILE}`));
