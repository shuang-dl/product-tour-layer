// Loads the built extension (dist/extension) into Chromium and runs the tours against a mock DoorLoop page.
// Run: npm test   (after node scripts/build.mjs). Set CHROME_PATH to use a specific Chromium binary.
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(root, 'dist/extension');
const MOCK = readFileSync(join(root, 'tests/mock-doorloop.html'), 'utf8');
const TOURS_URL = 'https://shuang-dl.github.io/product-tour-layer/tours.json';
const DRAFTS_URL = 'https://shuang-dl.github.io/product-tour-layer/drafts.json';

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tour-layer-test-')), {
  channel: 'chromium', // full Chromium: the headless shell can't load extensions
  executablePath: process.env.CHROME_PATH,
  headless: true,
  // auto-accept-this-tab-capture: answers the "share this tab" prompt that exporting a tour opens
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--auto-accept-this-tab-capture'],
});
await ctx.route('https://acme.app.doorloop.com/**', (r) => r.fulfill({ contentType: 'text/html', body: MOCK }));
// Published tours are unreachable unless a test says otherwise, so results don't depend on the live site.
await ctx.route(TOURS_URL, (r) => r.abort());

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const title = (p) => p.locator('.driver-popover-title').textContent({ timeout: 10000 }).catch(() => null);

try {
  // Multi-page tour with click-to-advance steps, using the tours bundled into the extension
  const page = await ctx.newPage();
  await page.goto('https://acme.app.doorloop.com/home?tour=find-a-tenant');
  check('tour starts from ?tour=', (await title(page)) === 'Find a tenant');
  check('?tour= stripped from URL', !page.url().includes('tour='), page.url());
  check('driver.css injected', (await page.locator('.driver-popover').evaluate((e) => getComputedStyle(e).position)) === 'fixed');
  check('step box header shows step count', (await page.locator('.tl-head').textContent()).includes('Step 1 of 5'));
  check('no extra highlight layer outside dialogs', (await page.locator('.tour-layer-ring').count()) === 0);
  check('step box shows a progress bar', (await page.evaluate(() => document.querySelector('.tl-bar > span')?.style.width)) === '20%');
  check('default style applied', (await page.locator('.driver-popover').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(11, 31, 68)');
  await page.click('.driver-popover-next-btn');
  check('optional step shows when its target is visible', (await title(page)) === 'Open People');
  await page.click('#people');
  await page.waitForTimeout(800);
  check('advances after clicking the target', (await title(page)) === 'Open Tenants');
  await page.click('[data-cy="SideMenu-People-Tenants"]');
  await page.waitForTimeout(1200);
  check('continues on the next page', (await title(page)) === 'Search the list', page.url());
  await page.click('.driver-popover-next-btn');
  await page.waitForTimeout(500);
  check('reaches the last step', (await title(page)) === 'Open a profile');
  await page.click('.driver-popover-next-btn');
  await page.waitForTimeout(500);
  check('tour ends and launcher shows', (await page.locator('.tour-layer-launcher > button').textContent()) === 'Tours (1)');
  await page.close();

  // Step target below the fold, inside a scroll container wrapped in overflow: clip
  const page2 = await ctx.newPage();
  await page2.goto('https://acme.app.doorloop.com/home?tour=home-overview');
  await title(page2);
  for (let i = 0; i < 4; i++) {
    await page2.click('.driver-popover-next-btn');
    await page2.waitForTimeout(400);
  }
  await page2
    .waitForFunction(() => document.querySelector('.driver-popover-title')?.textContent === 'Occupancy rate', null, { timeout: 10000 })
    .catch(() => {});
  const anchored = await page2.evaluate(() => document.querySelector('.driver-active-element')?.getAttribute('data-cy'));
  check('below-the-fold target is highlighted', anchored === 'Widget-dashboards.occupancyRate', `highlighted: ${anchored}`);
  const inView = await page2
    .locator('[data-cy="Widget-dashboards.occupancyRate"]')
    .evaluate((e) => e.getBoundingClientRect().top < innerHeight);
  check('below-the-fold target is scrolled into view', inView);
  await page2.close();

  // Published tours win when reachable; close button ends the tour
  await ctx.unroute(TOURS_URL);
  await ctx.route(TOURS_URL, (r) =>
    r.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ tours: [{
        id: 'remote-test', title: 'Remote', page: '/home',
        style: { frame: '#123456', titleSize: 'h1' },
        steps: [{ title: 'From GitHub Pages', text: 'hi', image: 'https://example.com/pic.png' }],
      }] }),
    })
  );
  const page3 = await ctx.newPage();
  await page3.goto('https://acme.app.doorloop.com/home?tour=remote-test');
  check('uses published tours when reachable', (await title(page3)) === 'From GitHub Pages');
  check("tour's style block applied", (await page3.locator('.driver-popover').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(18, 52, 86)');
  check('title uses the chosen heading tag', (await page3.locator('.tl-title').evaluate((e) => e.tagName)) === 'H1');
  check('step image shown', (await page3.locator('.tl-img').count()) === 1);
  await page3.keyboard.press('Escape');
  await page3.waitForTimeout(300);
  check('Escape does not end a tour (only × does)', (await page3.locator('.driver-popover').count()) === 1);
  await page3.click('.driver-popover-close-btn');
  await page3.waitForTimeout(300);
  check('close button ends the tour', (await page3.locator('.driver-popover').count()) === 0);
  await page3.close();

  // Clues: when a step's target stops matching (e.g. a renamed data-cy), the element that fits its clues is used;
  // clues that fit nothing leave the step centred rather than pointing at the wrong thing.
  await ctx.unroute(TOURS_URL);
  await ctx.route(TOURS_URL, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tours: [
    { id: 'clue-test', title: 'Clues', page: '/tenants', steps: [{ target: "[data-cy='Filter-renamed']", clues: { tag: 'button', text: 'Filter', aria: 'Filter', role: 'button' }, title: 'Filter', text: 'x' }] },
    { id: 'clue-miss', title: 'Clues miss', page: '/tenants', steps: [{ target: "[data-cy='nothing']", clues: { tag: 'button', text: 'Archive everything', role: 'button' }, title: 'Miss', text: 'x' }] },
  ] }) }));
  const cp = await ctx.newPage();
  const warnings = [];
  cp.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  await cp.goto('https://acme.app.doorloop.com/tenants?tour=clue-test');
  await title(cp);
  check('clues: a renamed target is found by its clues', (await cp.evaluate(() => document.querySelector('.driver-active-element')?.getAttribute('aria-label'))) === 'Filter');
  check('clues: the tour warns that the target needs updating', warnings.some((w) => w.includes('found the element by its clues')));
  await cp.goto('https://acme.app.doorloop.com/tenants?tour=clue-miss');
  await cp.waitForSelector('.driver-popover', { timeout: 15000 }).catch(() => {});
  const miss = { title: await title(cp), active: await cp.evaluate(() => { const a = document.querySelector('.driver-active-element'); return a ? a.outerHTML.slice(0, 80) : null; }) };
  check("clues: clues that fit nothing don't point at the wrong element", miss.title === 'Miss' && (!miss.active || miss.active.includes('driver-dummy-element')), JSON.stringify(miss));
  await cp.close();

  // "Test on: Live DoorLoop": a page opens DoorLoop and sends it a draft tour. Only the builder's site is accepted.
  const sender = (title) => `<!doctype html><script>
    window.result = 'waiting';
    const tab = window.open('https://acme.app.doorloop.com/home', 'dl');
    const tour = { id: 'draft-x', title: 'Draft', page: '/home', steps: [
      { title: ${JSON.stringify(title)}, text: 'hi', target: ["[data-cy='global-search-trigger']", "[data-cy='SideMenu-CreateNewMenu-Button']", "[data-cy='mockField']"] },
      { title: 'Second', text: 'two' },
    ] };
    const timer = setInterval(() => tab.postMessage({ type: 'tour-layer:draft', id: 'one', tour }, '*'), 300);
    addEventListener('message', (e) => { if (e.data && e.data.type === 'tour-layer:draft-received') { window.result = 'ack'; clearInterval(timer); } });
  </script>`;
  await ctx.route('https://shuang-dl.github.io/product-tour-layer/test-sender.html', (r) => r.fulfill({ contentType: 'text/html', body: sender('Drafted in the builder') }));
  await ctx.route('https://evil.example/', (r) => r.fulfill({ contentType: 'text/html', body: sender('Not from the builder') }));

  const evil = await ctx.newPage();
  const evilTab = ctx.waitForEvent('page');
  await evil.goto('https://evil.example/');
  const evilPopup = await evilTab;
  await evilPopup.waitForTimeout(3000);
  check('draft from another site is ignored', (await evilPopup.locator('.driver-popover').count()) === 0 && (await evil.evaluate(() => window.result)) === 'waiting');
  await evilPopup.close();
  await evil.close();

  const builder = await ctx.newPage();
  const builderTab = ctx.waitForEvent('page');
  await builder.goto('https://shuang-dl.github.io/product-tour-layer/test-sender.html');
  const tab = await builderTab;
  check('draft from the builder runs on DoorLoop', (await title(tab)) === 'Drafted in the builder');
  check('builder hears back', (await builder.evaluate(() => window.result)) === 'ack');
  check('a group target is highlighted as one area', await tab.evaluate(() => {
    const box = document.querySelector('.tour-layer-group');
    const a = document.querySelector("[data-cy='global-search-trigger']").getBoundingClientRect();
    const b = document.querySelector("[data-cy='SideMenu-CreateNewMenu-Button']").getBoundingClientRect();
    const r = box && box.getBoundingClientRect();
    return !!r && r.top <= Math.min(a.top, b.top) + 1 && r.bottom >= Math.max(a.bottom, b.bottom) - 1 && box.classList.contains('driver-active-element');
  }));
  // Items inside a highlighted group must stay usable (driver.js blocks clicks on everything else)
  await tab.click("[data-cy='SideMenu-CreateNewMenu-Button']");
  check('items in a highlighted group can be clicked', await tab.evaluate(() => !document.getElementById('createDialog').hidden));
  await tab.evaluate(() => (document.getElementById('createDialog').hidden = true));
  await tab.click("[data-cy='mockField']"); // lands on the decorative outline, which must let the click through
  check("a highlighted field's own click-through layers still work", await tab.evaluate(() => document.activeElement === document.querySelector("[aria-label='Mock field']")));
  const option = await tab.locator('#mockOption').boundingBox(); // the field's dropdown opens on <body>, outside the highlight
  await tab.mouse.click(option.x + option.width / 2, option.y + option.height / 2);
  check("a highlighted field's dropdown can be used", (await tab.inputValue("[aria-label='Mock field']")) === 'Option A');
  await tab.evaluate(() => scrollTo(0, 0));
  await tab.waitForTimeout(300);
  await tab.evaluate(() => document.querySelector('nav').prepend(Object.assign(document.createElement('div'), { id: 'shift', style: 'height:40px' })));
  await tab.waitForTimeout(500);
  check('a group highlight follows its items when the layout shifts', await tab.evaluate(() =>
    Math.abs(document.querySelector('.tour-layer-group').getBoundingClientRect().top - document.querySelector("[data-cy='global-search-trigger']").getBoundingClientRect().top) < 1));
  await tab.evaluate(() => document.getElementById('shift').remove());
  await tab.evaluate(() => { const f = document.querySelector("[data-cy='mockField']"); f.replaceWith(f.cloneNode(true)); }); // re-rendered as a new element
  await tab.waitForTimeout(500);
  check('a group highlight follows items the app re-renders', await tab.evaluate(() => {
    const box = document.querySelector('.tour-layer-group').getBoundingClientRect();
    const field = document.querySelector("[data-cy='mockField']").getBoundingClientRect();
    return box.top > 0 && box.left > 0 && box.bottom >= field.bottom - 1;
  }));
  await tab.click("body", { position: { x: 900, y: 600 } }); // outside the highlight: blocked by the overlay
  check('clicks outside the highlight are blocked', (await title(tab)) === 'Drafted in the builder');
  await tab.click('.driver-popover-next-btn');
  await tab.waitForTimeout(500);
  await tab.reload();
  check('draft survives a page reload', (await title(tab)) === 'Second');
  await tab.click('.driver-popover-next-btn');
  await tab.waitForTimeout(500);
  check('finished draft is cleared', (await tab.evaluate(() => sessionStorage.getItem('tourLayer.draft'))) === null);

  // "Build on: Live DoorLoop": the builder page asks the extension to open the builder. Same origin rule.
  const buildSender = `<!doctype html><script>
    const tab = window.open('https://acme.app.doorloop.com/tenants', 'dlb');
    setInterval(() => tab.postMessage({ type: 'tour-layer:build', id: 'b1', name: 'Built live', page: '/tenants' }, '*'), 300);
  </script>`;
  await ctx.route('https://shuang-dl.github.io/product-tour-layer/test-build.html', (r) => r.fulfill({ contentType: 'text/html', body: buildSender }));
  await ctx.route('https://evil.example/build', (r) => r.fulfill({ contentType: 'text/html', body: buildSender }));
  const evilB = await ctx.newPage();
  const evilBTab = ctx.waitForEvent('page');
  await evilB.goto('https://evil.example/build');
  const evilBPopup = await evilBTab;
  await evilBPopup.waitForTimeout(3000);
  check('build request from another site is ignored', (await evilBPopup.locator('#tour-layer-builder').count()) === 0);
  await evilBPopup.close();
  await evilB.close();
  const okB = await ctx.newPage();
  const okBTab = ctx.waitForEvent('page');
  await okB.goto('https://shuang-dl.github.io/product-tour-layer/test-build.html');
  const builderTab2 = await okBTab;
  await builderTab2.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 10000 }).catch(() => {});
  check('build request from the builder opens it on DoorLoop',
    (await builderTab2.locator('#tour-layer-builder .ws-name').textContent().catch(() => null)) === 'Built live');

  // Building on live DoorLoop, start to finish: the real builder page (served from dist/ at the builder's address)
  // opens DoorLoop, the extension opens the builder there, and a two-page tour is built, reloaded and previewed.
  await ctx.route('https://app.doorloop.com/**', (r) => {
    const u = new URL(r.request().url());
    r.fulfill({ contentType: 'text/html', body: `<script>location.replace('https://acme.app.doorloop.com${u.pathname}')</script>` });
  });
  await ctx.route('https://shuang-dl.github.io/product-tour-layer/builder*', (r) => {
    const file = new URL(r.request().url()).pathname.split('/').pop();
    r.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html', body: readFileSync(join(root, 'dist', file), 'utf8') });
  });
  const site = await ctx.newPage();
  await site.goto('https://shuang-dl.github.io/product-tour-layer/builder-concept.html');
  await site.click('#create');
  check('builder: a new tour starts on /home by default', (await site.inputValue('#tourUrl')) === '/home');
  check('builder: the tour name starts empty and is required', (await site.inputValue('#tourName')) === '' && (await site.locator('#tourName').evaluate((i) => i.required && i.placeholder === 'e.g. Add a new property')));
  await site.fill('#tourName', 'Working with your tenant list');
  await site.fill('#tourUrl', '/tenants');
  await site.check('input[value=live]');
  const liveTabP = ctx.waitForEvent('page');
  await site.click('#openBtn');
  const live = await liveTabP;
  const errors = [];
  live.on('pageerror', (e) => errors.push(e.message));
  await live.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 15000 }).catch(() => {});
  const B = live.locator('#tour-layer-builder');
  check('builder opens on DoorLoop', (await B.count()) === 1 && (await B.locator('.ws-name').textContent()) === 'Working with your tenant list');
  const dialogOpen = () => live.evaluate(() => !document.getElementById('createDialog').hidden);
  const dropDraft = async () => {
    await B.locator('.pop [data-cancel]').click();
    await B.locator('.card.draft .x').click();
  };
  // Picking a control the app opens on mouse-down must not trigger it
  await B.locator('.add >> text=+ Step').click();
  await live.click('[data-cy="SideMenu-CreateNewMenu-Button"]');
  check('live: picking blocks the press, so menus stay shut', !(await dialogOpen()) && (await B.locator('.pop code').textContent()) === "[data-cy='SideMenu-CreateNewMenu-Button']");
  await dropDraft();
  // With an app dialog open (opened while browsing), using the builder must not close it or lose the typing
  await live.click('[data-cy="SideMenu-CreateNewMenu-Button"]');
  await B.locator('.add >> text=+ Step').click();
  check('live: using the builder leaves an app dialog open', await dialogOpen());
  await live.click('#createDialog [data-item-id="property"]');
  await B.locator('.pop .tb-title').click();
  await live.keyboard.type('Choose Property');
  check('live: typing goes to the step box, not the app dialog',
    (await B.locator('.pop .tb-title').innerText()) === 'Choose Property' && (await live.inputValue('#dialogSearch')) === '' && (await dialogOpen()));
  await dropDraft();
  await live.keyboard.press('Escape');
  await B.locator('.add >> text=+ Step').click();
  await live.click('input[aria-label="Search"]');
  check('live: a real click picks, without the app reacting', (await B.locator('.pop code').textContent()) === "input[aria-label='Search']");
  await B.locator('.pop .tb-title').click();
  await live.keyboard.type('Search your tenants');
  await B.locator('.pop [data-save]').click();
  check('live: a step needs text before it saves', (await B.locator('.pop').count()) === 1 && (await B.locator('.toast').textContent()).startsWith('Add some text'));
  await B.locator('.pop .tb-text').click();
  await live.keyboard.type('Step text');
  await B.locator('.pop [data-save]').click();
  // /home has no link on the stand-in page, so this is a full page load: the builder must come back
  await B.locator('.add >> text=+ Page').click();
  await B.locator('.add-page input').fill('/home');
  await B.locator('.add-page input').press('Enter');
  await live.waitForURL('**/home');
  await live.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 15000 }).catch(() => {});
  await live.waitForTimeout(500);
  check('live: builder and draft survive a page load', (await live.locator('#tour-layer-builder .story').innerText()).includes('Search your tenants'));
  const B2 = live.locator('#tour-layer-builder');
  await B2.locator('.add >> text=+ Step').click();
  await B2.locator('[data-tool=box]').click();
  const w = await live.locator('[data-cy="Widget-dashboards.thingsToDo"]').boundingBox();
  await live.mouse.move(w.x - 6, w.y - 6);
  await live.mouse.down();
  await live.mouse.move(w.x + w.width + 6, w.y + w.height + 6, { steps: 5 });
  await live.mouse.up();
  check('live: box tool picks a widget', (await B2.locator('.pop code').textContent()) === "[data-cy='Widget-dashboards.thingsToDo']");
  await B2.locator('.pop .tb-title').click();
  await live.keyboard.type('Things to do');
  await B2.locator('.pop .tb-text').click();
  await live.keyboard.type('Step text');
  await B2.locator('.pop [data-save]').click();
  await B2.locator('[data-tool=pointer]').click();
  // Preview step 1 goes to /tenants through the app's own link (no reload)
  await B2.locator('.preview-btn').click();
  await live.waitForTimeout(1500);
  check('live: preview moves the app to the step\'s page', live.url().endsWith('/tenants') && (await B2.locator('.pop .tb-title').innerText()) === 'Search your tenants');
  check('live: in-app page change, not a reload', (await B2.count()) === 1);
  await B2.locator('.pop .close').click();
  live.once('dialog', (d) => d.accept());
  await B2.locator('.close-btn').click();
  await live.waitForTimeout(300);
  check('live: closing removes the builder and its draft',
    (await live.locator('#tour-layer-builder').count()) === 0 && (await live.evaluate(() => sessionStorage.getItem('tourLayer.builder'))) === null);
  check('live: no page errors', errors.length === 0, errors.join('; '));

  // Editing an existing tour on live DoorLoop: paste a tour file, insert a missing step, reorder, export.
  const existing = {
    id: 'edit-me', title: 'Edit me', page: '/tenants', style: { frame: '#0f6e56' },
    steps: [
      { target: "input[aria-label='Search-renamed']", clues: { tag: 'input', aria: 'Search' }, title: 'First', text: 'one' },
      { target: "button[aria-label='Filter']", title: 'Second', text: 'two', advanceOn: 'click' },
    ],
  };
  const site2 = await ctx.newPage();
  await site2.goto('https://shuang-dl.github.io/product-tour-layer/builder-concept.html');
  await site2.click('#create');
  await site2.check('input[value=edit]');
  await site2.selectOption('#tourPick', 'paste');
  await site2.fill('#tourPaste', JSON.stringify(existing));
  await site2.check('input[value=live]');
  const editTabP = ctx.waitForEvent('page');
  await site2.click('#openBtn');
  const ed = await editTabP;
  await ed.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 15000 }).catch(() => {});
  const E = ed.locator('#tour-layer-builder');
  const cards = () => E.locator('.card:not(.page-card) .t').allInnerTexts();
  check('builder: an All tours link opens the tours page in a new tab',
    (await E.locator('.all-tours').getAttribute('href')) === 'https://shuang-dl.github.io/product-tour-layer/' && (await E.locator('.all-tours').getAttribute('target')) === '_blank' && (await E.locator('.all-tours').isVisible()));
  const nameRow = await E.evaluate((host) => {
    const r = host.shadowRoot, n = r.querySelector('.ws-name').getBoundingClientRect(), a = r.querySelector('.all-tours').getBoundingClientRect();
    const close = r.querySelector('.close-btn').getBoundingClientRect();
    return { nameW: n.width, sameLine: Math.abs(n.top + n.height / 2 - (a.top + a.height / 2)) < 6, belowClose: n.top >= close.bottom };
  });
  const topBar = await E.evaluate((host) => {
    const r = host.shadowRoot, box = (q) => r.querySelector(q).getBoundingClientRect();
    const off = getComputedStyle(r.querySelector('.record-btn'));
    const btn = r.querySelector('.record-btn');
    btn.classList.add('on');
    const on = getComputedStyle(btn).backgroundColor;
    btn.classList.remove('on');
    return { off: off.borderStyle + ' ' + off.color + ' ' + off.backgroundColor, on, rec: box('.record-btn'), pre: box('.preview-btn'), more: box('.more-btn') };
  });
  check('builder: Record tour is a dashed red outline, solid red while recording; Preview / Save tour / More line up with its edges',
    topBar.off === 'dashed rgb(211, 47, 47) rgba(0, 0, 0, 0)' && topBar.on === 'rgb(211, 47, 47)' && Math.abs(topBar.pre.left - topBar.rec.left) < 1 && Math.abs(topBar.more.right - topBar.rec.right) < 1, JSON.stringify(topBar));
  check('builder: the tour name keeps its own line, with All tours beside it', nameRow.nameW > 150 && nameRow.sameLine && nameRow.belowClose, JSON.stringify(nameRow));
  check('edit: the tour loads into the storyboard', JSON.stringify(await cards()) === JSON.stringify(['First', 'Second']) && (await E.locator('.ws-name').textContent()) === 'Edit me');
  check("edit: the tour's style loads", (await E.locator('.style-panel input[data-var="--tour-frame"]').inputValue()) === '#0f6e56');
  await E.locator('.card:has-text("First")').click();
  await ed.waitForTimeout(1500);
  check("edit: a step whose target was renamed is found by its clues, and gets a working target", (await E.locator('.pop code').textContent().catch(() => '')) === "input[aria-label='Search']");
  // Repoint: with the editor open, an unsaved title edit, then Repoint and click something else
  await E.locator('.pop .tb-title').click();
  await ed.keyboard.press('End');
  await ed.keyboard.type(' (moved)');
  await E.locator('.pop [data-repoint]').click();
  const repointHint = await E.locator('.toast').textContent().catch(() => '');
  const hiddenWhileRepointing = await E.locator('.pop').evaluate((p) => p.style.visibility === 'hidden');
  await ed.click("button[aria-label='Filter']");
  await ed.waitForTimeout(300);
  check('repoint: Repoint explains what to do and moves the editor out of the way', hiddenWhileRepointing && repointHint.startsWith('Click what this step should point at'), repointHint);
  check('repoint: a new editor opens for the new spot', (await E.locator('.pop').count()) === 1 && (await E.locator('.pop').evaluate((p) => p.style.visibility)) === '');
  check('repoint: clicking something else repoints the step and keeps the unsaved edits',
    (await E.locator('.pop code').textContent()) === "button[aria-label='Filter']" && (await E.locator('.pop .tb-title').innerText()) === 'First (moved)' &&
    (await E.locator('.pop .tb-text').innerText()) === 'one');
  await E.locator('.pop [data-cancel]').click();
  // Insert a missing step between First and Second (the "+" before the Second card)
  await E.locator('.ins').nth(1).click();
  await ed.locator('[data-cy=choiceWrap]').nth(1).click({ position: { x: 3, y: 3 } }); // the wrapper itself, not its button
  check('edit: a shared label falls back to a unique one inside', (await E.locator('.pop code').textContent()) === "[data-cy='Choice-B']");
  await E.locator('.pop .tb-title').click();
  await ed.keyboard.type('Inserted');
  await E.locator('.pop [data-optional]').check();
  await E.locator('.pop .tb-text').click();
  await ed.keyboard.type('Step text');
  await E.locator('.pop [data-save]').click();
  check('edit: inserted step lands in place', JSON.stringify(await cards()) === JSON.stringify(['First', 'Inserted', 'Second']));
  // Drag "Second" onto "First": it moves before it
  await E.locator('.card:has-text("Second")').dragTo(E.locator('.card:has-text("First")'));
  check('edit: dragging reorders steps', JSON.stringify(await cards()) === JSON.stringify(['Second', 'First', 'Inserted']));
  await E.locator('.more-btn').click();
  await E.locator('.file-btn').click();
  await ed.keyboard.press('ControlOrMeta+a');
  check('file view: select all picks only the tour file', JSON.parse(await ed.evaluate(() => getSelection().toString())).id === 'edit-me');
  const edited = JSON.parse(await E.locator('.file-out').textContent());
  check('edit: the tour file keeps the id and reflects the edits',
    edited.id === 'edit-me' && edited.status === 'live' && edited.steps.map((x) => x.title).join() === 'Second,First,Inserted' &&
    edited.steps[2].optional === true && edited.steps[2].target === "[data-cy='Choice-B']" && edited.steps[0].advanceOn === 'click' && edited.style.frame === '#0f6e56');
  // Save to GitHub on an edited tour: opens that file's edit page (GitHub can't pre-fill an edit)
  await ctx.route('https://github.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html>GitHub' }));
  const ghEditP = ctx.waitForEvent('page');
  await E.locator('.gh-btn').click();
  const ghEdit = await ghEditP;
  check('save: an edited tour opens its file on GitHub', ghEdit.url() === 'https://github.com/shuang-dl/product-tour-layer/edit/main/tours/edit-me.json', ghEdit.url());
  await ghEdit.close();
  await E.locator('.file-close').click();
  const side = await E.evaluate(() => {
    const r = document.getElementById('tour-layer-builder').shadowRoot.querySelector('.ws').getBoundingClientRect();
    return { right: r.right, width: r.width, top: r.top, height: r.height, vw: innerWidth, vh: innerHeight };
  });
  check('live builder: controls, tools and storyboard are one panel on the right, full height',
    Math.round(side.right) === side.vw && side.width === 340 && side.top === 0 && Math.round(side.height) === side.vh, JSON.stringify(side));
  // Docking: DoorLoop's body ends where the panel starts, and its fixed-position drawers stop there too
  const docked = () => E.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;right:0;width:200px;height:50px';
    document.body.append(d);
    const out = { body: Math.round(document.body.getBoundingClientRect().right), drawerRight: Math.round(d.getBoundingClientRect().right), vw: innerWidth,
      builderOutsideBody: document.getElementById('tour-layer-builder').parentElement === document.documentElement };
    d.remove();
    return out;
  });
  const dk = await docked();
  check('live builder: DoorLoop and its fixed drawers end where the panel starts',
    dk.body === dk.vw - 340 && dk.drawerRight === dk.vw - 340 && dk.builderOutsideBody, JSON.stringify(dk));
  // A drawer that starts past the right edge and takes focus (like the Wallet's Transfer funds) mustn't shift the page
  const shifted = await E.evaluate(async () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;right:-400px;width:400px;height:200px';
    d.innerHTML = '<input id="drawerField">';
    document.body.append(d);
    document.getElementById('drawerField').focus();
    await new Promise((r) => setTimeout(r, 100));
    const left = document.body.scrollLeft;
    d.remove();
    return left;
  });
  check('live builder: a drawer opening past the edge does not scroll DoorLoop sideways', shifted === 0, String(shifted));
  await E.locator('.more-btn').click();
  await E.locator('.dock-opt input').uncheck();
  const undockedByOption = await docked();
  await E.locator('.dock-opt input').check();
  await E.locator('.more-btn').click();
  check('live builder: More → Keep DoorLoop beside the panel switches docking off and on',
    undockedByOption.drawerRight === undockedByOption.vw && undockedByOption.body > undockedByOption.vw - 20 && (await docked()).body === dk.vw - 340, JSON.stringify(undockedByOption));
  await E.locator('.story-btn').click();
  await E.locator('.panel-tab').waitFor({ timeout: 2000 }).catch(() => {});
  const hiddenDock = await docked();
  check('live builder: hiding the panel gives DoorLoop the full width back', hiddenDock.body > hiddenDock.vw - 20 && hiddenDock.drawerRight === hiddenDock.vw, JSON.stringify(hiddenDock));
  check('edit: the panel slides away, leaving a tab to bring it back', !(await E.locator('.story').isVisible()) && (await E.locator('.panel-tab').isVisible()));
  await E.locator('.panel-tab').click();
  await E.locator('.story').waitFor({ timeout: 2000 }).catch(() => {});
  check('edit: the tab brings the panel back', (await E.locator('.story').isVisible()) && !(await E.locator('.panel-tab').isVisible()));
  check('live builder: showing the panel again narrows DoorLoop again', (await docked()).body === dk.vw - 340);

  // Sample data: Fill example types and picks, the Finish step can't be used, and ending the tour clicks Cancel.
  const sampleTour = {
    id: 'sample-test', title: 'Sample', page: '/properties/new', exitClicks: ["[data-cy='mockCancel']"],
    steps: [
      {
        target: ["[data-cy='mockStreet']", "[data-cy='mockCity']", "[data-cy='mockCheck']", "[data-cy='mockChoice']"], title: 'Fill it', text: 'x',
        fill: [
          { target: "[data-cy='mockStreet']", value: '1100 Congress Ave', pick: '1100 Congress Ave Austin, TX, 78701' },
          { target: "[data-cy='mockCheck']", click: true },
          { target: "[data-cy='mockChoice']", click: true },
        ],
      },
      { target: "[data-cy='mockFinish']", title: 'Finish', text: 'y', showOnly: true },
    ],
  };
  await ctx.unroute(TOURS_URL);
  await ctx.route(TOURS_URL, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tours: [sampleTour] }) }));
  const sp = await ctx.newPage();
  await sp.goto('https://acme.app.doorloop.com/properties/new?tour=sample-test');
  check('sample: the step box offers Fill example', (await title(sp)) === 'Fill it' && (await sp.locator('.tl-fill').textContent()) === 'Fill example');
  await sp.click('.tl-fill');
  await sp.waitForFunction(() => document.querySelector('.tl-fill')?.textContent !== 'Filling…', null, { timeout: 15000 }).catch(() => {});
  check('sample: Fill example types, picks the suggestion and clicks choices', await sp.evaluate(() =>
    document.querySelector('[aria-label=Street]').value === '1100 Congress Ave' && document.querySelector('[aria-label=City]').value === 'Austin' &&
    document.querySelector('[aria-label=Federal]').checked && document.querySelector('[data-cy=mockChoice]').getAttribute('aria-pressed') === 'true' &&
    document.querySelector('.tl-fill').textContent === 'Filled'));
  await sp.click('.driver-popover-next-btn');
  check('sample: reaches the show-only step', (await title(sp)) === 'Finish');
  check('sample: the last show-only step says Done discards the sample data', (await sp.locator('.tl-note').textContent()) === 'Click Done to discard the sample data.');
  const fin = await sp.locator('[data-cy=mockFinish]').boundingBox();
  await sp.mouse.click(fin.x + fin.width / 2, fin.y + fin.height / 2);
  await sp.focus('[data-cy=mockFinish]');
  await sp.keyboard.press('Enter');
  check("sample: a show-only step's element can't be clicked or pressed", (await sp.evaluate(() => document.getElementById('main').dataset.saved)) === undefined);
  await sp.click('.driver-popover-next-btn'); // Done
  await sp.waitForTimeout(800);
  check('sample: ending the tour after Fill example clicks the exit clicks', (await sp.evaluate(() => document.body.dataset.cancelled)) === 'yes' && sp.url().endsWith('/home'));
  await sp.goto('https://acme.app.doorloop.com/properties/new?tour=sample-test');
  await title(sp);
  await sp.click('.driver-popover-close-btn');
  await sp.waitForTimeout(800);
  check('sample: without Fill example, closing with × clicks nothing', (await sp.evaluate(() => document.body.dataset.cancelled)) === undefined);
  // Done on the last step always leaves the form, Fill example or not
  await sp.goto('https://acme.app.doorloop.com/properties/new?tour=sample-test');
  await title(sp);
  await sp.click('.driver-popover-next-btn');
  check('sample: reaches the last step without Fill example', (await title(sp)) === 'Finish');
  await sp.click('.driver-popover-next-btn'); // Done
  await sp.waitForTimeout(800);
  check('Done on the last step runs the exit clicks even without Fill example', (await sp.evaluate(() => document.body.dataset.cancelled)) === 'yes');
  // Without sample data, the last show-only step's button works: it saves (here, marks the page) and ends the tour
  await sp.goto('https://acme.app.doorloop.com/properties/new?tour=sample-test');
  await title(sp);
  await sp.click('.driver-popover-next-btn');
  await title(sp);
  check('without sample data, the last step offers Done or the real button', (await sp.locator('.tl-note').textContent()) === 'Click Done to discard what you entered, or click “Finish” to save it.');
  const finBox = await sp.locator('[data-cy=mockFinish]').boundingBox();
  await sp.mouse.click(finBox.x + finBox.width / 2, finBox.y + finBox.height / 2);
  await sp.waitForTimeout(800);
  check('without sample data, the real button saves and ends the tour, without exit clicks', await sp.evaluate(() =>
    document.getElementById('main').dataset.saved === 'yes' && !document.querySelector('.driver-popover') && document.body.dataset.cancelled === undefined));
  await sp.close();

  // A dropdown step: click the field to open its list, then pick from it. Showing the next step must not take
  // focus from the field (its list closes when the field loses focus).
  const dropTour = {
    id: 'dropdown-test', title: 'Dropdown', page: '/payment',
    steps: [
      { target: "[data-cy='mockLease']", title: 'Open the list', text: 'x', advanceOn: 'click' },
      { target: "[data-cy='mockLeasePicker']", title: 'Pick a lease', text: 'y', advanceOn: 'click' },
      { title: 'Done', text: 'z' },
    ],
  };
  await ctx.unroute(TOURS_URL);
  const dupTour = {
    id: 'dup-test', title: 'Dup', page: '/home',
    steps: [{ title: 'Start', text: 'x' }, { target: "[data-item-id='dupItem']", title: 'Pick it', text: 'y', advanceOn: 'click' }],
  };
  // Sample data in a dialog: with no exit clicks (or one that isn't there), ending the tour closes the dialog with its
  // × and answers "Discard your changes?"
  const amountStep = { target: "[data-cy='mockAmount']", title: 'Amount', text: 'x', fill: [{ target: "[data-cy='mockAmount']", value: '1500' }] };
  const doneTour = { id: 'done-test', title: 'Done', page: '/payment', steps: [{ target: "[data-cy='mockAmount']", title: 'Amount', text: 'x' }] };
  const autoTour = { id: 'auto-test', title: 'Auto', page: '/welcome', autoStart: true, steps: [{ title: 'Welcome', text: 'x' }] };
  const leaveTour = { id: 'leave-test', title: 'Leave', page: '/payment', steps: [amountStep] };
  const leaveTour2 = { id: 'leave-test-2', title: 'Leave 2', page: '/payment', exitClicks: ["[data-cy='notThere']"], steps: [amountStep] };
  await ctx.route(TOURS_URL, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tours: [dropTour, dupTour, leaveTour, leaveTour2, autoTour, doneTour] }) }));
  // Drafts: only load for people who turned on Show drafts (?drafts=on), and are labelled as drafts
  const draftTour = { id: 'draft-test', title: 'Not live yet', status: 'draft', page: '/drafty', steps: [{ title: 'Draft step', text: 'x' }] };
  await ctx.route(DRAFTS_URL, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tours: [draftTour] }) }));
  const dr = await ctx.newPage();
  await dr.goto('https://acme.app.doorloop.com/drafty?tour=draft-test');
  await dr.waitForTimeout(3000);
  check("drafts: a draft doesn't run without Show drafts", (await dr.locator('.driver-popover').count()) === 0);
  await dr.goto('https://acme.app.doorloop.com/drafty?tour=draft-test&drafts=on');
  check('drafts: ?drafts=on turns on Show drafts and the draft runs, labelled',
    (await title(dr)) === 'Draft step' && (await dr.locator('.tl-head').textContent()).includes('Draft · Step 1 of 1') &&
    !dr.url().includes('drafts=') && (await dr.evaluate(() => localStorage.getItem('tourLayer.showDrafts'))) === '1');
  await dr.click('.driver-popover-close-btn');
  await dr.goto('https://acme.app.doorloop.com/drafty');
  await dr.click('.tour-layer-launcher > button');
  check('drafts: listed apart in the launcher', await dr.evaluate(() => {
    const heads = [...document.querySelectorAll('.tour-layer-heading')];
    const h = heads.find((x) => x.textContent === 'Drafts (not live yet)');
    return !!h && h.nextElementSibling?.textContent === 'Not live yet';
  }));
  await dr.goto('https://acme.app.doorloop.com/drafty?drafts=off');
  await dr.waitForTimeout(2000);
  check('drafts: ?drafts=off turns Show drafts off', (await dr.locator('.tour-layer-launcher').count()) === 0 &&
    (await dr.evaluate(() => localStorage.getItem('tourLayer.showDrafts'))) === null);
  await dr.close();

  // The GIF encoder (src/gif.js): Chromium must decode what it writes, colours intact, including a noisy frame
  // big enough to fill the compression table and reset it
  const gp = await ctx.newPage();
  await gp.setContent('<!doctype html><body></body>');
  await gp.addScriptTag({ content: readFileSync(join(EXT, 'gif.js'), 'utf8') });
  const gif = await gp.evaluate(async () => {
    const flat = new ImageData(300, 200);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) {
      const i = (y * 300 + x) * 4;
      flat.data.set(x < 150 ? [220, 30, 30, 255] : [30, 60, 220, 255], i);
    }
    const noisy = new ImageData(300, 200);
    for (let i = 0; i < noisy.data.length; i += 4) noisy.data.set([Math.random() * 255, Math.random() * 255, Math.random() * 255, 255], i);
    const bytes = TourGif.encode([flat, noisy], { delayMs: 500 });
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
    const loaded = await new Promise((r) => { img.onload = () => r(true); img.onerror = () => r(false); });
    const c = document.createElement('canvas');
    c.width = 300; c.height = 200;
    const ctx2 = c.getContext('2d');
    ctx2.drawImage(img, 0, 0);
    const px = (x, y) => [...ctx2.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return { loaded, w: img.naturalWidth, head: String.fromCharCode(...bytes.slice(0, 6)), left: px(20, 20), right: px(280, 20) };
  });
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 8);
  check('gif: encodes a GIF that Chromium decodes, with the right colours', gif.loaded && gif.w === 300 && gif.head === 'GIF89a' && near(gif.left, [220, 30, 30]) && near(gif.right, [30, 60, 220]), JSON.stringify(gif));
  await gp.close();

  // Exporting a tour is for its creator only.
  // The creator exports from the live builder: Export → Video or GIF, Start recording, play the tour, file downloads,
  // and the builder comes back with the draft
  const exportTour = { id: 'export-test', title: 'Export me', page: '/home', steps: [
    { title: 'First', text: 'x' }, { target: "[data-cy='Widget-dashboards.thingsToDo']", title: 'Second', text: 'y' }] };
  await ctx.unroute(TOURS_URL);
  await ctx.route(TOURS_URL, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tours: [dropTour, dupTour, leaveTour, leaveTour2, autoTour, doneTour, exportTour] }) }));
  // A ?export= link does nothing special for someone taking the tour
  const tk = await ctx.newPage();
  await tk.goto('https://acme.app.doorloop.com/home?tour=export-test&export=gif');
  check('export: people taking a tour are never offered an export', (await title(tk)) === 'First' && (await tk.locator('.tour-export-card').count()) === 0);
  await tk.close();
  const exportSender = `<!doctype html><script>
    const tab = window.open('https://acme.app.doorloop.com/home', 'dlx');
    setInterval(() => tab.postMessage({ type: 'tour-layer:build', id: 'x1', name: 'Export me', page: '/home', tour: ${JSON.stringify(exportTour)} }, '*'), 300);
  </script>`;
  await ctx.route('https://shuang-dl.github.io/product-tour-layer/test-build-export.html', (r) => r.fulfill({ contentType: 'text/html', body: exportSender }));
  for (const kind of ['gif', 'video']) {
    const opener = await ctx.newPage();
    const xpP = ctx.waitForEvent('page');
    await opener.goto('https://shuang-dl.github.io/product-tour-layer/test-build-export.html');
    const xp = await xpP;
    await xp.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 15000 }).catch(() => {});
    await opener.close();
    const X = xp.locator('#tour-layer-builder');
    await X.locator('.more-btn').click();
    await X.locator(`.export-menu [data-kind=${kind}]`).click();
    await xp.waitForSelector('.tour-export-card', { timeout: 5000 }).catch(() => {});
    const offered = (await xp.locator('.tour-export-card').count()) === 1 && (await xp.locator('#tour-layer-builder').count()) === 0;
    await xp.click('.tour-export-card .go');
    await xp.waitForTimeout(1500);
    const why = await xp.evaluate(() => document.querySelector('.tour-export-card .note')?.textContent || '');
    if (why) { check(`export ${kind}: recording starts`, false, why); await xp.close(); continue; }
    await title(xp);
    await xp.waitForTimeout(1500);
    // Like Chrome's "sharing this tab" bar appearing: the recorded picture changes size mid-recording
    await xp.setViewportSize({ width: 1100, height: 600 });
    await xp.click('.driver-popover-next-btn');
    await xp.waitForTimeout(1500);
    const dl = xp.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await xp.click('.driver-popover-next-btn'); // Done
    const file = await dl;
    const bytes = file ? readFileSync(await file.path()) : Buffer.alloc(0);
    if (kind === 'gif') {
      const frames = bytes.length ? bytes.toString('latin1').split('\x21\xf9\x04').length - 1 : 0;
      check('export gif: the builder offers to record, then a GIF with a frame per step downloads', offered && file?.suggestedFilename() === 'export-test.gif' && bytes.toString('latin1', 0, 6) === 'GIF89a' && frames === 2, `${file?.suggestedFilename()} frames=${frames}`);
      await xp.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 5000 }).catch(() => {});
      check('export: the builder comes back with the draft afterwards', (await xp.locator('#tour-layer-builder .card:not(.page-card)').count()) === 2);
    } else {
      check('export video: the builder offers to record, then a video of the run downloads', offered && /^export-test\.(mp4|webm)$/.test(file?.suggestedFilename() || '') && bytes.length > 1000, `${file?.suggestedFilename()} ${bytes.length} bytes`);
      // ... and the video actually plays: load it into a <video> and decode a frame
      const vp = await ctx.newPage();
      await vp.setContent('<!doctype html><video muted></video>');
      const played = await vp.evaluate(async ({ b64, type }) => {
        const v = document.querySelector('video');
        v.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type }));
        await v.play().catch(() => {});
        await new Promise((r) => setTimeout(r, 1500));
        return { time: v.currentTime, w: v.videoWidth, error: v.error && v.error.message };
      }, { b64: bytes.toString('base64'), type: file?.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm' });
      check('export video: the downloaded video plays, even though the page changed size while recording', !played.error && played.w > 0 && played.time > 0.5, JSON.stringify(played));
      await vp.close();
    }
    await xp.close();
  }

  // The extension's menu (its icon), opened as a page and pointed at a DoorLoop tab: new tour, edit a tour, Show drafts
  const mgr = await ctx.newPage();
  await mgr.goto('chrome://extensions');
  const extId = await mgr.evaluate(() => document.querySelector('extensions-manager').shadowRoot
    .querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id);
  await mgr.close();
  const mt = await ctx.newPage();
  await mt.goto('https://acme.app.doorloop.com/menu-test');
  await mt.waitForTimeout(2000);
  const openMenu = async (path) => {
    const m = await ctx.newPage();
    await m.goto(`chrome-extension://${extId}/popup.html`);
    const id = await m.evaluate(async (p) => (await chrome.tabs.query({ url: `https://acme.app.doorloop.com${p}*` }))[0]?.id, path);
    await m.goto(`chrome-extension://${extId}/popup.html?tab=${id}`);
    await m.waitForSelector('main section, main button', { timeout: 10000 }).catch(() => {});
    return m;
  };
  let menu = await openMenu('/menu-test');
  const groups = await menu.evaluate(() => [...document.querySelectorAll('optgroup')].map((g) => g.label + ': ' + [...g.children].map((o) => o.textContent).join(', ')));
  check('menu: shows the page and lists live tours and drafts apart', (await menu.textContent('main')).includes('On /menu-test') &&
    groups.some((g) => g.startsWith('Live: ')) && groups.some((g) => g === 'Drafts: Not live yet (/drafty)'), JSON.stringify(groups));
  await menu.click('input[type=text]');
  await menu.keyboard.type('Made from the menu'); // typed, not filled: a cancelled keypress once threw every key away
  check('menu: the tour name can be typed', (await menu.inputValue('input[type=text]')) === 'Made from the menu');
  await menu.click('text=Build a new tour here');
  await mt.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 10000 }).catch(() => {});
  check('menu: New tour opens the builder on that page', (await mt.locator('#tour-layer-builder .ws-name').textContent().catch(() => null)) === 'Made from the menu');
  if (!menu.isClosed()) await menu.close();
  menu = await openMenu('/menu-test');
  check('menu: says when the builder is already open', (await menu.textContent('main')).includes('The builder is open on this page'));
  await menu.selectOption('select', 'draft-test');
  await menu.click('text=Open in the builder');
  await mt.waitForTimeout(1000);
  check('menu: Edit opens a draft in the builder', (await mt.locator('#tour-layer-builder .ws-name').textContent().catch(() => null)) === 'Not live yet' &&
    (await mt.locator('#tour-layer-builder .card:not(.page-card)').count()) === 1);
  if (!menu.isClosed()) await menu.close();
  await mt.evaluate(() => sessionStorage.removeItem('tourLayer.builder')); // so the builder doesn't come back after the reload
  menu = await openMenu('/menu-test');
  const reloaded = mt.waitForEvent('load', { timeout: 10000 }).catch(() => null);
  await menu.click('input[type=checkbox]').catch(() => {}); // the menu closes itself
  await reloaded;
  check('menu: the Show drafts switch turns drafts on (and reloads the page)', (await mt.evaluate(() => localStorage.getItem('tourLayer.showDrafts'))) === '1');
  if (!menu.isClosed()) await menu.close();
  const off = await ctx.newPage();
  await off.goto(`chrome-extension://${extId}/popup.html`);
  const offId = await off.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  await off.goto(`chrome-extension://${extId}/popup.html?tab=${offId}`);
  await off.waitForTimeout(500);
  check('menu: off DoorLoop it offers to open DoorLoop', (await off.textContent('main')).includes('Open DoorLoop to build or edit tours'));
  await off.close();
  await mt.evaluate(() => localStorage.removeItem('tourLayer.showDrafts'));
  await mt.close();

  // Saving to GitHub from the builder, against a stand-in GitHub (device sign-in, repo access, contents API)
  const gh = { push: true, polls: 0, files: {}, puts: [] };
  const fake = createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') return send(204);
      if (url.pathname === '/login/device/code') return send(200, { device_code: 'dc1', user_code: 'TEST-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
      if (url.pathname === '/login/oauth/access_token') return send(200, ++gh.polls < 2 ? { error: 'authorization_pending' } : { access_token: 'tok-1' });
      if (req.headers.authorization !== 'Bearer tok-1') return send(401, { message: 'Bad credentials' });
      if (url.pathname === '/user') return send(200, { login: 'tester' });
      if (url.pathname === '/repos/shuang-dl/product-tour-layer') return send(200, { permissions: { push: gh.push } });
      const file = url.pathname.replace('/repos/shuang-dl/product-tour-layer/contents/', '');
      if (req.method === 'GET') return gh.files[file] ? send(200, { sha: gh.files[file] }) : send(404, { message: 'Not Found' });
      if (req.method === 'PUT') {
        const body = JSON.parse(raw);
        gh.puts.push({ file, body });
        gh.files[file] = `sha-${gh.puts.length}`;
        return send(gh.files[file] && body.sha ? 200 : 201, { content: { html_url: `https://github.com/x/${file}` }, commit: { html_url: 'https://github.com/x/commit/1' } });
      }
      send(404, {});
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const ghBase = `http://127.0.0.1:${fake.address().port}`;
  const setup = await ctx.newPage();
  await setup.goto(`chrome-extension://${extId}/popup.html`);
  await setup.evaluate((base) => chrome.storage.local.set({ 'tourLayer.githubTest': { web: base, api: base, clientId: 'test-client' } }), ghBase);
  await setup.close();
  const sv = await ctx.newPage();
  await sv.goto('https://acme.app.doorloop.com/save-test');
  await sv.waitForTimeout(1500);
  menu = await openMenu('/save-test');
  check('github: the menu offers Sign in with GitHub', (await menu.textContent('main')).includes('Sign in with GitHub'));
  await menu.click('text=Sign in with GitHub');
  await menu.waitForSelector('.code', { timeout: 5000 }).catch(() => {});
  const shownCode = await menu.textContent('.code').catch(() => null);
  await menu.waitForFunction(() => document.querySelector('main').textContent.includes('Signed in as tester'), null, { timeout: 15000 }).catch(() => {});
  check('github: sign in with a code, then the menu shows who is signed in', shownCode === 'TEST-1234' && (await menu.textContent('main')).includes('Signed in as tester. Save tour'));
  // A new tour from the menu, one step, then Save tour
  await menu.click('input[type=text]');
  await menu.keyboard.type('Saved from builder');
  await menu.click('text=Build a new tour here');
  if (!menu.isClosed()) await menu.close();
  await sv.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 10000 }).catch(() => {});
  const SB = sv.locator('#tour-layer-builder');
  await SB.locator('.adders .add', { hasText: '+ Step' }).click();
  await sv.click('[data-cy="Widget-dashboards.thingsToDo"]');
  await SB.locator('.pop .tb-title').click();
  await sv.keyboard.type('Things to do');
  await SB.locator('.pop .tb-text').click();
  await sv.keyboard.type('Your open tasks.');
  await SB.locator('.pop [data-save]').click();
  await SB.locator('.save-btn').click();
  await sv.waitForFunction(() => document.getElementById('tour-layer-builder').shadowRoot.querySelector('.toast')?.textContent.startsWith('Saved'), null, { timeout: 10000 }).catch(() => {});
  const first = gh.puts[0];
  const savedTour = first ? JSON.parse(Buffer.from(first.body.content, 'base64').toString()) : null;
  check('github: Save tour commits the tour file as a draft, no other steps',
    first?.file === 'tours/saved-from-builder.json' && !first.body.sha && savedTour?.status === 'draft' && savedTour.steps[0].title === 'Things to do' &&
    (await SB.locator('.toast').textContent()).startsWith('Saved tours/saved-from-builder.json to GitHub (draft)'), JSON.stringify(first && { file: first.file, sha: first.body.sha, message: first.body.message }));
  await sv.waitForTimeout(500);
  await SB.locator('.save-btn').click();
  await sv.waitForTimeout(1500);
  check('github: saving again updates the same file', gh.puts.length === 2 && gh.puts[1].file === 'tours/saved-from-builder.json' && gh.puts[1].body.sha === 'sha-1');
  // A different new tour with the same name: asks before replacing (here: no, so nothing is saved)
  await sv.evaluate(() => sessionStorage.removeItem('tourLayer.builder'));
  menu = await openMenu('/save-test');
  await menu.click('input[type=text]');
  await menu.keyboard.type('Saved from builder');
  await menu.click('text=Build a new tour here');
  if (!menu.isClosed()) await menu.close();
  await sv.waitForTimeout(800);
  await SB.locator('.adders .add', { hasText: '+ Step' }).click();
  await sv.click('[data-cy="Widget-dashboards.thingsToDo"]');
  await SB.locator('.pop .tb-title').click();
  await sv.keyboard.type('Another');
  await SB.locator('.pop .tb-text').click();
  await sv.keyboard.type('x');
  await SB.locator('.pop [data-save]').click();
  let asked = null;
  sv.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await SB.locator('.save-btn').click();
  await sv.waitForTimeout(1500);
  check('github: a new tour asks before replacing a file with the same name', (asked || '').includes('already a tour file tours/saved-from-builder.json') && gh.puts.length === 2, asked);
  // Someone without write access can sign in, but saving stays off
  menu = await openMenu('/save-test');
  await menu.click('text=Sign out');
  gh.push = false;
  gh.polls = 0;
  await menu.click('text=Sign in with GitHub');
  await menu.waitForFunction(() => document.querySelector('main').textContent.includes('Signed in as tester'), null, { timeout: 15000 }).catch(() => {});
  check("github: someone without write access is told saving is off", (await menu.textContent('main')).includes("who can't change shuang-dl/product-tour-layer, so saving is off"));
  if (!menu.isClosed()) await menu.close();
  await sv.evaluate(() => sessionStorage.removeItem('tourLayer.builder'));
  await sv.close();
  fake.close();

  // Builder Preview: a "click the highlighted item" step lets the click reach the app, so a row's ⋮ menu opens
  const pv = await ctx.newPage();
  await pv.goto('https://acme.app.doorloop.com/wallet');
  await pv.evaluate(() => sessionStorage.setItem('tourLayer.builder', JSON.stringify({
    name: 'Row menu', id: null, folder: 'tours', style: {}, inputs: {}, active: null, exitClicks: [], autoStart: false, status: 'draft', recordingTour: false,
    flow: [{ type: 'page', path: '/wallet' },
      { type: 'step', page: '/wallet', target: "button[aria-label='Row actions']", label: 'Row actions', titleHtml: 'Row actions', textHtml: 'Click the dots', image: null, advanceOn: 'click', optional: false, showOnly: false, placement: 'auto', fill: [] },
      { type: 'step', page: '/wallet', target: '[role=menu]', label: 'menu', titleHtml: 'The menu', textHtml: 'Options for this wallet', image: null, advanceOn: 'next', optional: false, showOnly: false, placement: 'auto', fill: [] }],
  })));
  await pv.reload();
  await pv.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 10000 }).catch(() => {});
  const PV = pv.locator('#tour-layer-builder');
  await pv.emulateMedia({ colorScheme: 'dark' });
  check('builder: the panel stays light when the computer is in dark mode', await PV.evaluate((host) => {
    const r = host.shadowRoot, ws = getComputedStyle(r.querySelector('.ws'));
    return matchMedia('(prefers-color-scheme: dark)').matches && ws.backgroundColor === 'rgb(255, 255, 255)' && ws.colorScheme === 'light';
  }));
  await PV.locator('.preview-btn').click();
  await pv.waitForTimeout(800);
  await pv.click('#rowActions');
  await pv.waitForTimeout(1200);
  check('preview: clicking a "click the highlighted item" step opens the app\'s menu and moves on',
    (await pv.locator('#rowMenu').count()) === 1 && (await PV.locator('.pop .tb-title').innerText().catch(() => '')) === 'The menu');
  await pv.waitForTimeout(600);
  const follow = await pv.evaluate(() => {
    const m = document.getElementById('rowMenu').getBoundingClientRect();
    const b = document.getElementById('tour-layer-builder').shadowRoot.querySelector('.sel-box').getBoundingClientRect();
    return { menu: Math.round(m.left), box: Math.round(b.left) };
  });
  check('preview: the highlight follows an element that moves after the step shows (a sliding drawer)', Math.abs(follow.box + 4 - follow.menu) <= 1, JSON.stringify(follow));
  await PV.locator('.pop .close').click();
  await pv.evaluate(() => sessionStorage.removeItem('tourLayer.builder'));
  await pv.close();

  // autoStart: opens by itself on its page once; after it ends, this browser doesn't start it again
  const ap = await ctx.newPage();
  await ap.goto('https://acme.app.doorloop.com/welcome');
  check('autoStart: the tour opens by itself on its page', (await title(ap)) === 'Welcome');
  if (await ap.locator('.driver-popover-close-btn').count()) await ap.click('.driver-popover-close-btn');
  await ap.reload();
  await ap.waitForTimeout(3000);
  check('autoStart: once ended, it does not start again', (await ap.locator('.driver-popover').count()) === 0 &&
    (await ap.evaluate(() => localStorage.getItem('tourLayer.seen.auto-test'))) === '1');
  await ap.close();
  // A narrow window: the step box stays inside it. Reduce motion: no animation.
  const np = await ctx.newPage();
  await np.setViewportSize({ width: 340, height: 640 });
  await np.emulateMedia({ reducedMotion: 'reduce' });
  await np.goto('https://acme.app.doorloop.com/home?tour=dup-test');
  await title(np);
  check('reduce motion: the highlight does not animate', !(await np.evaluate(() => document.body.classList.contains('driver-fade'))));
  await np.click('.driver-popover-next-btn');
  await np.waitForTimeout(1000);
  await np.evaluate(() => (document.querySelector('.driver-popover').style.left = '-150px')); // placed past the edge
  await np.waitForTimeout(600);
  await np.evaluate(() => (document.querySelector('.driver-popover').style.top = '-200px')); // then past the top too
  await np.waitForTimeout(600);
  const boxAt = await np.evaluate(() => {
    const b = document.querySelector('.driver-popover');
    const r = b.getBoundingClientRect();
    return { ok: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, rect: [r.left, r.top, r.right, r.bottom].map(Math.round), w: innerWidth, h: innerHeight, style: b.getAttribute('style') };
  });
  check('the step box is brought back inside the window', boxAt.ok, JSON.stringify(boxAt));
  await np.close();
  const dp2 = await ctx.newPage();
  await dp2.goto('https://acme.app.doorloop.com/payment?tour=done-test');
  await title(dp2);
  await dp2.locator('[aria-label=Amount]').fill('42'); // typed by hand, no Fill example
  await dp2.click('.driver-popover-next-btn'); // Done
  await dp2.waitForTimeout(1500);
  check("Done without sample data closes the tour's dialog with its × and discards", await dp2.evaluate(() => document.body.dataset.discarded === 'yes' && !document.getElementById('takeover')));
  await dp2.close();
  for (const [id, wait, name] of [['leave-test', 1500, 'with no exit clicks'], ['leave-test-2', 5000, "when an exit click isn't there"]]) {
    const lp = await ctx.newPage();
    await lp.goto(`https://acme.app.doorloop.com/payment?tour=${id}`);
    await title(lp);
    await lp.click('.tl-fill');
    await lp.waitForTimeout(800);
    const filled = (await lp.inputValue('[aria-label=Amount]')) === '1500';
    await lp.click('.driver-popover-next-btn'); // Done
    await lp.waitForTimeout(wait);
    check(`leaving ${name}: the dialog's × closes it and its prompt is discarded`, filled &&
      (await lp.evaluate(() => document.body.dataset.discarded === 'yes' && !document.getElementById('takeover') && !document.querySelector('[role=alertdialog]'))));
    await lp.close();
  }
  const dup = await ctx.newPage();
  await dup.goto('https://acme.app.doorloop.com/home?tour=dup-test');
  await title(dup);
  await dup.evaluate(() => (document.getElementById('menuList').scrollTop = 200)); // Dup A scrolls out, Dup B in
  await dup.click('.driver-popover-next-btn');
  await dup.waitForTimeout(800);
  check('a label on two elements highlights the one in view', (await dup.evaluate(() => document.querySelector('.driver-active-element')?.textContent)) === 'Dup B');
  await dup.close();
  const dp = await ctx.newPage();
  await dp.goto('https://acme.app.doorloop.com/payment?tour=dropdown-test');
  await title(dp);
  check('a target inside a dialog above the overlay gets its highlight drawn above the dialog', await dp.evaluate(() => {
    const ring = document.querySelector('.tour-layer-ring');
    const lease = document.querySelector('[data-cy=mockLease]').getBoundingClientRect();
    if (!ring) return false;
    const r = ring.getBoundingClientRect();
    return getComputedStyle(ring).zIndex === '1000001' && r.left < lease.left && r.right > lease.right &&
      getComputedStyle(document.querySelector('.driver-overlay')).opacity === '0' &&
      document.elementFromPoint(lease.x + 5, lease.y + 5)?.getAttribute('aria-label') === 'Lease';
  }));
  const lease = await dp.locator('[aria-label=Lease]').boundingBox();
  await dp.mouse.click(lease.x + lease.width / 2, lease.y + lease.height / 2);
  await dp.waitForTimeout(1200);
  check('dropdown: the list stays open when the next step shows', (await title(dp)) === 'Pick a lease' && (await dp.locator('#leasePopper').count()) === 1);
  check('dropdown: a list above a full-screen dialog stays on top (not lowered under it)', await dp.evaluate(() => {
    const o = [...document.querySelectorAll('#leasePopper li')][1]?.getBoundingClientRect();
    return !!o && document.elementFromPoint(o.x + o.width / 2, o.y + o.height / 2)?.textContent === 'Lease 2';
  }));
  const pick = await dp.locator('#leasePopper li', { hasText: 'Lease 2' }).boundingBox().catch(() => null);
  if (pick) await dp.mouse.click(pick.x + pick.width / 2, pick.y + pick.height / 2);
  await dp.waitForTimeout(1200);
  check('dropdown: picking from the list works and the tour moves on', (await dp.inputValue('[aria-label=Lease]')) === 'Lease 2' && (await title(dp)) === 'Done');
  const done = await dp.locator('.driver-popover-next-btn').boundingBox();
  await dp.mouse.click(done.x + done.width / 2, done.y + done.height / 2);
  await dp.waitForTimeout(500);
  check("dropdown: the step box works over a modal dialog, without closing it",
    (await dp.locator('.driver-popover').count()) === 0 && (await dp.locator('#takeover').count()) === 1);
  await dp.close();

  // Recording sample data in the live builder, and picking the exit click
  const site3 = await ctx.newPage();
  await site3.goto('https://shuang-dl.github.io/product-tour-layer/builder-concept.html');
  await site3.click('#create');
  await site3.fill('#tourName', 'Recorded');
  await site3.fill('#tourUrl', '/properties/new');
  await site3.check('input[value=live]');
  const recTabP = ctx.waitForEvent('page');
  await site3.click('#openBtn');
  const rec = await recTabP;
  await rec.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 15000 }).catch(() => {});
  const R = rec.locator('#tour-layer-builder');
  await R.locator('.adders .add', { hasText: '+ Step' }).click();
  await rec.click('[aria-label=Street]');
  check('record: picking a field highlights its labelled wrapper', (await R.locator('.pop code').textContent()) === "[data-cy='mockStreet']");
  await R.locator('.pop .tb-title').click();
  await rec.keyboard.type('Street');
  await R.locator('.pop [data-record]').click();
  await rec.click('[aria-label=Street]');
  await rec.keyboard.type('1100 Congress Ave');
  await rec.click('#streetPopper li:has-text("Austin")');
  await rec.click('[aria-label=City]'); // outside the highlight: not recorded
  await rec.keyboard.type('Elsewhere');
  await R.locator('.pop [data-record]').click();
  const rows = await R.locator('.sample-list li').allInnerTexts();
  check('record: typing and the picked suggestion show in the review list',
    rows.length === 1 && rows[0].includes('mockStreet') && rows[0].includes('1100 Congress Ave Austin, TX, 78701') &&
    (await R.locator('.sample-list input').inputValue()) === '1100 Congress Ave', JSON.stringify(rows));
  await R.locator('.pop .tb-text').click();
  await rec.keyboard.type('Step text');
  await R.locator('.pop [data-save]').click();
  await rec.waitForTimeout(3600); // the suggestion comes after the "Step saved" message
  check('record: no exit click is suggested outside a dialog', (await R.locator('.exit-list li:not(.empty)').count()) === 0);
  await R.locator('.exit-tool').click();
  await R.locator('.exit-pick').click();
  await rec.click('[data-cy=mockCancel]');
  check('record: picking an exit click does not press it', (await rec.evaluate(() => document.body.dataset.cancelled)) === undefined);
  await R.locator('.more-btn').click();
  await R.locator('.auto-start input').check();
  await R.locator('.file-btn').click();
  check('builder: Start by itself once sets autoStart in the tour file', JSON.parse(await R.locator('.file-out').textContent()).autoStart === true);
  check('builder: a new tour is saved as a draft', JSON.parse(await R.locator('.file-out').textContent()).status === 'draft');
  const recorded = JSON.parse((await R.locator('.file-out').textContent()).split('\n\n//')[0]);
  check('record: the tour file has the sample data and exit clicks',
    JSON.stringify(recorded.steps[0].fill.map(({ clues, ...f }) => f)) === JSON.stringify([{ target: "[data-cy='mockStreet']", value: '1100 Congress Ave', pick: '1100 Congress Ave Austin, TX, 78701' }]) &&
    recorded.steps[0].clues?.tag === 'input' && recorded.steps[0].clues?.aria === 'Street' && recorded.steps[0].fill[0].clues?.aria === 'Street' &&
    JSON.stringify(recorded.exitClicks) === JSON.stringify(["[data-cy='mockCancel']"]), JSON.stringify(recorded));
  // Save to GitHub on a new tour: GitHub's new file page, named after the tour and filled in with the file
  const ghNewP = ctx.waitForEvent('page');
  await R.locator('.gh-btn').click();
  const ghNew = new URL((await ghNewP).url());
  const sent = JSON.parse(ghNew.searchParams.get('value') || 'null');
  check('save: a new tour opens a filled-in new file on GitHub',
    ghNew.pathname === '/shuang-dl/product-tour-layer/new/main/tours' && ghNew.searchParams.get('filename') === 'recorded.json' &&
    sent && sent.id === 'recorded' && sent.exitClicks.length === 1 && sent.steps[0].fill.length === 1, ghNew.href.slice(0, 200));

  // Sample data recorded in a dialog with no exit clicks yet: the builder suggests the dialog's ×
  const site4 = await ctx.newPage();
  await site4.goto('https://shuang-dl.github.io/product-tour-layer/builder-concept.html');
  await site4.click('#create');
  await site4.fill('#tourName', 'In a dialog');
  await site4.fill('#tourUrl', '/payment');
  await site4.check('input[value=live]');
  const dlgTabP = ctx.waitForEvent('page');
  await site4.click('#openBtn');
  const dlg = await dlgTabP;
  await dlg.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 15000 }).catch(() => {});
  const D = dlg.locator('#tour-layer-builder');
  await D.locator('.adders .add', { hasText: '+ Step' }).click();
  await dlg.click('[aria-label=Amount]');
  await D.locator('.pop .tb-title').click();
  await dlg.keyboard.type('Amount');
  await D.locator('.pop .tb-text').click();
  await dlg.keyboard.type('Enter the amount');
  await D.locator('.pop [data-record]').click();
  await dlg.click('[aria-label=Amount]');
  await dlg.keyboard.type('1500');
  await D.locator('.pop [data-record]').click();
  await D.locator('.pop [data-save]').click();
  await dlg.waitForTimeout(3600);
  const suggested = await D.locator('.exit-list li:not(.empty)').allInnerTexts();
  // Recording a tour by clicking through it: each click and each filled-in field becomes a step, page changes add
  // page cards, and a suggestion picked after typing goes into that field's sample data
  const site5 = await ctx.newPage();
  await site5.goto('https://shuang-dl.github.io/product-tour-layer/builder-concept.html');
  await site5.click('#create');
  await site5.fill('#tourName', 'Recorded by clicking');
  await site5.fill('#tourUrl', '/properties/new');
  await site5.check('input[value=live]');
  const rtP = ctx.waitForEvent('page');
  await site5.click('#openBtn');
  const rt = await rtP;
  await rt.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 15000 }).catch(() => {});
  const T = rt.locator('#tour-layer-builder');
  await T.locator('.record-btn').click();
  await rt.click('[data-cy=mockChoice]');
  await rt.click('[aria-label=Street]');
  await rt.keyboard.type('1100 Congress Ave');
  await rt.click('#streetPopper li:has-text("Austin")');
  await rt.click('[aria-label=Federal]');
  await rt.click('[data-cy=mockCancel]'); // the stand-in goes to /home
  await rt.waitForTimeout(500);
  await rt.locator('#menuList [data-item-id=dupItem]').first().click(); // a menu item on /home
  await T.locator('.record-btn').click(); // stop
  const recCards = await T.locator('.card .t').allInnerTexts();
  check('record tour: clicks, typing and page changes become steps and page cards',
    JSON.stringify(recCards) === JSON.stringify(['/properties/new', 'Click “Single-Family”', 'Enter Street', 'Tick “Federal”', 'Click “Cancel”', '/home', 'Click “Dup A”']), JSON.stringify(recCards));
  await T.locator('.more-btn').click();
  await T.locator('.file-btn').click();
  const recTour = JSON.parse(await T.locator('.file-out').textContent());
  const street = recTour.steps.find((x) => x.title === 'Enter Street');
  check('record tour: typing is the sample data, with the suggestion picked after it',
    street && street.fill[0].value === '1100 Congress Ave' && street.fill[0].pick === '1100 Congress Ave Austin, TX, 78701' &&
    recTour.steps[0].advanceOn === 'click' && recTour.steps.find((x) => x.title === 'Click “Dup A”')?.page === '/home', JSON.stringify(street));
  await T.locator('.file-close').click();

  check("record: sample data in a dialog suggests the dialog's × as the exit click",
    suggested.length === 1 && suggested[0].includes('Close') && (await D.locator('.exit-panel').isVisible()), JSON.stringify(suggested));
  // Recording a pick from a list without typing: a step to open the field, then one pointing at the whole list
  await D.locator('.record-btn').click();
  await dlg.click('[aria-label=Lease]');
  await dlg.click('#leasePopper li:has-text("Lease 2")');
  await D.locator('.record-btn').click();
  const pickCards = (await D.locator('.card:not(.page-card) .t').allInnerTexts()).slice(-2);
  check('record tour: a pick from a list without typing opens the field, then points at the whole list',
    JSON.stringify(pickCards) === JSON.stringify(['Open “Lease”', 'Pick from the list']), JSON.stringify(pickCards));
  // Recording on a page named with data-testid and <label for> (like DoorLoop's Wallet): no step without a target
  const site6 = await ctx.newPage();
  await site6.goto('https://shuang-dl.github.io/product-tour-layer/builder-concept.html');
  await site6.click('#create');
  await site6.fill('#tourName', 'Wallet recorded');
  await site6.fill('#tourUrl', '/wallet');
  await site6.check('input[value=live]');
  const wtP = ctx.waitForEvent('page');
  await site6.click('#openBtn');
  const wt = await wtP;
  await wt.waitForSelector('#tour-layer-builder', { state: 'attached', timeout: 15000 }).catch(() => {});
  const W = wt.locator('#tour-layer-builder');
  await W.locator('.record-btn').click();
  await wt.click('#wallet-movement-amount');
  await wt.keyboard.type('1000');
  await wt.click('textarea');
  await wt.keyboard.type('Transfer to bank');
  await wt.click('[data-testid=WalletMovement-Authorize]');
  await W.locator('.record-btn').click();
  await W.locator('.more-btn').click();
  await W.locator('.file-btn').click();
  const wTour = JSON.parse(await W.locator('.file-out').textContent());
  const wSteps = wTour.steps.map((x) => ({ title: x.title, target: x.target, fill: x.fill?.[0]?.target }));
  check('record tour: data-testid, <label for> and stable ids name the steps',
    wSteps[0]?.title === 'Enter Amount' && wSteps[0].target === 'input#wallet-movement-amount' && wSteps[0].fill === 'input#wallet-movement-amount' &&
    wSteps[2]?.title === 'Tick “I authorize this withdrawal from the selected wallet.”' && wSteps[2].target === "[data-testid='WalletMovement-Authorize']", JSON.stringify(wSteps));
  const pathHits = typeof wSteps[1]?.target === 'string' ? await wt.locator(wSteps[1].target).count() : 0;
  check('record tour: a field with no name gets a path, never an empty target',
    wSteps[1]?.target?.endsWith('textarea') && wSteps[1].fill === wSteps[1].target && pathHits === 1, JSON.stringify(wSteps[1]));
  await W.locator('.file-close').click();
  // Step box placement: beside the highlighted area, never over it; a step's placement is used when it fits
  await ctx.unroute(TOURS_URL);
  await ctx.route(TOURS_URL, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tours: [{
    id: 'place-test', title: 'Placement', page: '/home', steps: [
      { target: "[data-cy='Widget-dashboards.thingsToDo']", title: 'Wide', text: 'A wide widget: the box goes below it' },
      { target: "[data-cy='SideMenu-CreateNewMenu-Button']", title: 'Auto', text: 'A small button: the box goes beside it' },
      { target: "[data-cy='SideMenu-CreateNewMenu-Button']", placement: 'bottom', title: 'Below', text: 'Chosen: below it' },
      { target: "[data-cy='Widget-dashboards.thingsToDo']", showOnly: true, title: 'Panel', text: 'A show-only panel, not a button' },
    ],
  }] }) }));
  const pl = await ctx.newPage();
  await pl.goto('https://acme.app.doorloop.com/home?tour=place-test');
  const boxVsTarget = async (sel) => {
    await pl.waitForTimeout(700);
    return pl.evaluate((s) => {
      const b = document.querySelector('.driver-popover').getBoundingClientRect();
      const t = document.querySelector(s).getBoundingClientRect();
      const overlap = b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top;
      const inside = b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
      return { overlap, inside, below: b.top >= t.bottom, right: b.left >= t.right, box: [b.left, b.top, b.right, b.bottom].map(Math.round), target: [t.left, t.top, t.right, t.bottom].map(Math.round) };
    }, sel);
  };
  await title(pl);
  const wide = await boxVsTarget("[data-cy='Widget-dashboards.thingsToDo']");
  check('placement: the step box sits below a wide area, not over it', !wide.overlap && wide.inside && wide.below, JSON.stringify(wide));
  await pl.click('.driver-popover-next-btn');
  const small = await boxVsTarget("[data-cy='SideMenu-CreateNewMenu-Button']");
  check('placement: auto puts the box beside a small button', !small.overlap && small.inside && small.right, JSON.stringify(small));
  await pl.click('.driver-popover-next-btn');
  const chosen = await boxVsTarget("[data-cy='SideMenu-CreateNewMenu-Button']");
  check("placement: a step's chosen side is used when the box fits there", !chosen.overlap && chosen.inside && chosen.below, JSON.stringify(chosen));
  await pl.click('.driver-popover-next-btn');
  check('a show-only last step on a panel (not a button) has no "click … to save it" note',
    (await title(pl)) === 'Panel' && (await pl.locator('.tl-note').count()) === 0);
  await pl.close();
} finally {
  await ctx.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
