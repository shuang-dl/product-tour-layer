// Tour reports: receives tour events and shows the report pages (all tours, then one tour's step funnel).
// A stand-in for DoorLoop's own analytics until the tour script is inside DoorLoop.
//   POST /events             { events: [...] }  adds events (the extension sends them in batches, as text/plain)
//   GET  /events?tour=<id>   the raw events kept, oldest first (the newest 5000)
//   GET  /api/report?days=30&previews=1   the numbers the pages show (see report.js)
//   GET  /                   the report pages
//   GET  /healthz            always 200
// Storage: Postgres when DATABASE_URL is set (on DeployBay), otherwise a file, data/events.ndjson (npm run collector).
// PORT and EVENTS_FILE change the port and the file (the tests use both).
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { report } from './report.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4174;
const MAX_BODY = 1_000_000;
const MAX_EVENTS = 5000;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const reply = (res, status, body) => res.writeHead(status, { ...CORS, 'content-type': 'application/json' }).end(JSON.stringify(body));
// Only the fields the tour engine sends, so nothing else can be stored by accident
const FIELDS = ['type', 'tourId', 'tourStatus', 'tourUpdated', 'runId', 'ms', 'at', 'path', 'step', 'total', 'how', 'anchor', 'reason', 'context'];
const clean = (e) => Object.fromEntries(FIELDS.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
const isEvent = (e) => e && typeof e === 'object' && typeof e.type === 'string' && typeof e.tourId === 'string' &&
  typeof e.runId === 'string' && !Number.isNaN(Date.parse(e.at)) && JSON.stringify(e).length < 4000;

// ---------- storage ----------

function fileStore() {
  const file = process.env.EVENTS_FILE || join(here, '../data/events.ndjson');
  console.log(`Keeping tour events in ${file}`);
  return {
    async add(events, receivedAt) {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, events.map((e) => JSON.stringify({ ...e, receivedAt }) + '\n').join(''));
    },
    async since(time) {
      try {
        return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => Date.parse(e.at) >= time);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
  };
}

async function pgStore() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  pool.on('error', (e) => console.error('database connection error:', e.message));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_events (
      id          BIGSERIAL PRIMARY KEY,
      at          TIMESTAMPTZ NOT NULL,   -- when it happened (from the browser)
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tour_id     TEXT NOT NULL,
      run_id      TEXT NOT NULL,
      type        TEXT NOT NULL,
      event       JSONB NOT NULL          -- the whole event, as sent
    );
    CREATE INDEX IF NOT EXISTS tour_events_at ON tour_events (at);
    CREATE INDEX IF NOT EXISTS tour_events_tour ON tour_events (tour_id, at);`);
  console.log('Keeping tour events in Postgres (tour_events)');
  return {
    async add(events, receivedAt) {
      await pool.query(
        `INSERT INTO tour_events (at, received_at, tour_id, run_id, type, event)
         SELECT (e->>'at')::timestamptz, $2, e->>'tourId', e->>'runId', e->>'type', e FROM jsonb_array_elements($1::jsonb) e`,
        [JSON.stringify(events), receivedAt]);
    },
    async since(time) {
      const { rows } = await pool.query(
        `SELECT event || jsonb_build_object('receivedAt', received_at) AS e FROM tour_events WHERE at >= $1 ORDER BY at, id`, [new Date(time)]);
      return rows.map((r) => r.e);
    },
  };
}

const store = process.env.DATABASE_URL ? await pgStore() : fileStore();
const page = await readFile(join(here, 'index.html'));

// ---------- routes ----------

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
    if (url.pathname === '/healthz') return reply(res, 200, { ok: true });
    if (url.pathname === '/' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
    if (url.pathname === '/api/report' && req.method === 'GET') {
      const days = [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
      const now = Date.now();
      const events = await store.since(now - 2 * days * 86400000); // this period and the one before, for the trend
      return reply(res, 200, report(events, { days, now, previews: url.searchParams.get('previews') === '1' }));
    }
    if (url.pathname !== '/events') return reply(res, 404, { error: 'not found' });
    if (req.method === 'GET') {
      const tour = url.searchParams.get('tour');
      const events = (await store.since(0)).filter((e) => !tour || e.tourId === tour);
      return reply(res, 200, { events: events.slice(-MAX_EVENTS) });
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'use GET or POST' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) return reply(res, 413, { error: 'too big' });
    }
    const events = JSON.parse(body).events;
    if (!Array.isArray(events) || !events.length || !events.every(isEvent)) return reply(res, 400, { error: 'expected { events: [...] }' });
    await store.add(events.map(clean), new Date().toISOString());
    reply(res, 200, { ok: true, kept: events.length });
  } catch (e) {
    console.error(e);
    reply(res, e instanceof SyntaxError ? 400 : 500, { error: e instanceof SyntaxError ? 'not JSON' : 'something went wrong' });
  }
}).listen(PORT, () => console.log(`Tour reports at http://localhost:${PORT}/ (events: POST /events)`));
