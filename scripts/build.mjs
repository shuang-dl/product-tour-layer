// Validates tours/*.json and builds the site into dist/.
// Run: node scripts/build.mjs   (fails with a list of problems if any tour is invalid)
import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const TOUR_KEYS = ['id', 'title', 'description', 'page', 'style', 'steps'];
const STEP_KEYS = ['target', 'title', 'text', 'page', 'advanceOn', 'optional', 'image'];
// The step box style (one per tour). Colours are #rrggbb, sizes are whole pixels in a range, the rest are choices.
const STYLE_RULES = {
  frame: 'color', bandText: 'color', button: 'color', buttonText: 'color', bodyText: 'color', bodyBg: 'color',
  headerHeight: [16, 48], footerHeight: [32, 64], sideBorder: [0, 8], corners: [0, 16],
  titleSize: ['h1', 'h2', 'h3'], titleAlign: ['left', 'center', 'right'], textAlign: ['left', 'center', 'right', 'justify'],
};
// An https URL or a path to an image file, with nothing that could break out of an attribute.
const IMAGE = /^(https:\/\/|\/|\.{0,2}\/)?[^\s"'<>]+\.(png|jpe?g|gif|webp|svg)(\?[^\s"'<>]*)?$/i;

function validateStyle(style, err) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return err('"style" must be an object');
  for (const [key, value] of Object.entries(style)) {
    const rule = STYLE_RULES[key];
    if (!rule) err(`style: unknown field "${key}"`);
    else if (rule === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) err(`style.${key} must be a colour like "#0b1f44"`);
    else if (Array.isArray(rule) && typeof rule[0] === 'number' && !(Number.isInteger(value) && value >= rule[0] && value <= rule[1])) {
      err(`style.${key} must be a whole number from ${rule[0]} to ${rule[1]}`);
    } else if (Array.isArray(rule) && typeof rule[0] === 'string' && !rule.includes(value)) err(`style.${key} must be one of ${rule.join(', ')}`);
  }
}
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
  if (tour.style !== undefined) validateStyle(tour.style, err);
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
    if (step.image !== undefined && !(typeof step.image === 'string' && IMAGE.test(step.image))) {
      err(`${at}: "image" must be an https URL or a path to a .png, .jpg, .gif, .webp or .svg file`);
    }
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

// Reads and validates every tour in a folder: tours/ (DoorLoop) or demo-tours/ (the demo app).
async function loadTours(dir) {
  const files = (await readdir(join(root, dir))).filter((f) => f.endsWith('.json')).sort();
  const tours = [];
  const errors = [];
  for (const file of files) {
    let tour;
    try {
      tour = JSON.parse(await readFile(join(root, dir, file), 'utf8'));
    } catch (e) {
      errors.push(`${dir}/${file}: invalid JSON (${e.message})`);
      continue;
    }
    errors.push(...validateTour(tour, file).map((e) => `${dir}/${e}`));
    tours.push(tour);
  }
  const ids = tours.map((t) => t.id);
  ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errors.push(`${dir}: duplicate tour id "${id}"`));
  return { tours, errors };
}

const { tours, errors: tourErrors } = await loadTours('tours');
const { tours: demoTours, errors: demoErrors } = await loadTours('demo-tours');
const errors = [...tourErrors, ...demoErrors];

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

// Demo app: a DoorLoop-style app with sample data. The engine is built in, like DoorLoop would add it.
// 404.html is the same page, so GitHub Pages serves the app for deep links like /demo/tenants/t1.
const demo = join(dist, 'demo');
await mkdir(demo);
for (const f of await readdir(join(root, 'site/demo'))) await copyFile(join(root, 'site/demo', f), join(demo, f));
for (const f of ['tour-layer.js', 'driver.js.iife.js', 'driver.css']) await copyFile(join(ext, f), join(demo, f));
await writeFile(join(demo, 'tours.json'), JSON.stringify({ tours: demoTours }, null, 2));
await copyFile(join(root, 'site/demo/index.html'), join(dist, '404.html'));

console.log(`Built ${tours.length} DoorLoop tour(s), ${demoTours.length} demo tour(s), the extension and the demo app into dist/`);
