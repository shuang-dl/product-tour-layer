// Validates tours/*.json and builds the site into dist/.
// Run: node scripts/build.mjs   (fails with a list of problems if any tour is invalid)
import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const TOUR_KEYS = ['id', 'title', 'description', 'page', 'steps'];
const STEP_KEYS = ['target', 'title', 'text', 'page', 'advanceOn', 'optional'];
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

function validateTour(tour, file) {
  const errors = [];
  const err = (msg) => errors.push(`${file}: ${msg}`);

  for (const key of Object.keys(tour)) if (!TOUR_KEYS.includes(key)) err(`unknown field "${key}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tour.id || '')) err('"id" must be kebab-case, e.g. "add-tenant"');
  if (`${tour.id}.json` !== file) err(`file name must match id ("${tour.id}.json")`);
  if (!isText(tour.title)) err('"title" is required');
  if (tour.description !== undefined && !isText(tour.description)) err('"description" must be text');
  if (!/^\/[^*]*$/.test(tour.page || '')) err('"page" must be a path like "/tenants" (no "*": it is where the tour starts)');
  if (!Array.isArray(tour.steps) || !tour.steps.length) {
    err('"steps" must be a non-empty list');
    return errors;
  }

  tour.steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    for (const key of Object.keys(step)) if (!STEP_KEYS.includes(key)) err(`${at}: unknown field "${key}"`);
    if (!isText(step.title)) err(`${at}: "title" is required`);
    if (!isText(step.text)) err(`${at}: "text" is required`);
    if (step.page !== undefined && !/^\//.test(step.page)) err(`${at}: "page" must start with "/"`);
    if (step.advanceOn !== undefined && !['next', 'click'].includes(step.advanceOn)) {
      err(`${at}: "advanceOn" must be "next" or "click"`);
    }
    if (step.advanceOn === 'click' && step.target === undefined) err(`${at}: "advanceOn": "click" needs a "target"`);
    if (step.optional !== undefined && typeof step.optional !== 'boolean') err(`${at}: "optional" must be true or false`);
    if (step.optional && step.target === undefined) err(`${at}: "optional" needs a "target"`);
    const t = step.target;
    if (t !== undefined && !isText(t) && !(t && typeof t === 'object' && isText(t.text))) {
      err(`${at}: "target" must be a CSS selector or { "text": "...", "selector": "..." }`);
    }
    if (t && typeof t === 'object') {
      for (const key of Object.keys(t)) if (!['text', 'selector'].includes(key)) err(`${at}: unknown target field "${key}"`);
    }
  });
  return errors;
}

const files = (await readdir(join(root, 'tours'))).filter((f) => f.endsWith('.json')).sort();
const tours = [];
const errors = [];
for (const file of files) {
  let tour;
  try {
    tour = JSON.parse(await readFile(join(root, 'tours', file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON (${e.message})`);
    continue;
  }
  errors.push(...validateTour(tour, file));
  tours.push(tour);
}
const ids = tours.map((t) => t.id);
ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errors.push(`duplicate tour id "${id}"`));

if (errors.length) {
  console.error(`Tour validation failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist);
await writeFile(join(dist, 'tours.json'), JSON.stringify({ tours }, null, 2));
await copyFile(join(root, 'site/index.html'), join(dist, 'index.html'));
await copyFile(join(root, 'site/builder-concept.html'), join(dist, 'builder-concept.html'));

// Chrome extension: everything it runs is bundled, nothing loads from a CDN.
const ext = join(dist, 'extension');
await mkdir(ext);
const extFiles = {
  'manifest.json': 'extension/manifest.json',
  'content.js': 'extension/content.js',
  'tour-layer.js': 'src/tour-layer.js',
  'driver.js.iife.js': 'vendor/driver.js/driver.js.iife.js',
  'driver.css': 'vendor/driver.js/driver.css',
  'DRIVER_LICENSE': 'vendor/driver.js/LICENSE',
};
for (const [to, from] of Object.entries(extFiles)) await copyFile(join(root, from), join(ext, to));
await writeFile(join(ext, 'bundled-tours.js'), `window.TOUR_LAYER_BUNDLED = ${JSON.stringify({ tours })};\n`);
execFileSync('zip', ['-qr', '../doorloop-tours-extension.zip', '.'], { cwd: ext });

console.log(`Built ${tours.length} tour(s) and the extension into dist/`);
