// Loads the built extension (dist/extension) into Chromium and runs the tours against a mock DoorLoop page.
// Run: npm test   (after node scripts/build.mjs). Set CHROME_PATH to use a specific Chromium binary.
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(root, 'dist/extension');
const MOCK = readFileSync(join(root, 'tests/mock-doorloop.html'), 'utf8');
const TOURS_URL = 'https://shuang-dl.github.io/product-tour-layer/tours.json';

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'tour-layer-test-')), {
  channel: 'chromium', // full Chromium: the headless shell can't load extensions
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
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
      { target: "input[aria-label='Search']", title: 'First', text: 'one' },
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
  check('edit: the tour loads into the storyboard', JSON.stringify(await cards()) === JSON.stringify(['First', 'Second']) && (await E.locator('.ws-name').textContent()) === 'Edit me');
  check("edit: the tour's style loads", (await E.locator('.style-panel input[data-var="--tour-frame"]').inputValue()) === '#0f6e56');
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
  await E.locator('.file-btn').click();
  const edited = JSON.parse((await E.locator('.file-out').textContent()).split('\n\n//')[0]);
  check('edit: the tour file keeps the id and reflects the edits',
    edited.id === 'edit-me' && edited.steps.map((x) => x.title).join() === 'Second,First,Inserted' &&
    edited.steps[2].optional === true && edited.steps[2].target === "[data-cy='Choice-B']" && edited.steps[0].advanceOn === 'click' && edited.style.frame === '#0f6e56');
  // Save to GitHub on an edited tour: opens that file's edit page (GitHub can't pre-fill an edit)
  await ctx.route('https://github.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html>GitHub' }));
  const ghEditP = ctx.waitForEvent('page');
  await E.locator('.gh-btn').click();
  const ghEdit = await ghEditP;
  check('save: an edited tour opens its file on GitHub', ghEdit.url() === 'https://github.com/shuang-dl/product-tour-layer/edit/main/tours/edit-me.json', ghEdit.url());
  await ghEdit.close();
  await E.locator('.file-close').click();
  await E.locator('.story-btn').click();
  check('edit: the storyboard can be collapsed', !(await E.locator('.story').isVisible()));

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
  check('sample: without Fill example, ending the tour clicks nothing', (await sp.evaluate(() => document.body.dataset.cancelled)) === undefined);
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
  await ctx.route(TOURS_URL, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tours: [dropTour, dupTour] }) }));
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
  await R.locator('.exit-tool').click();
  await R.locator('.exit-pick').click();
  await rec.click('[data-cy=mockCancel]');
  check('record: picking an exit click does not press it', (await rec.evaluate(() => document.body.dataset.cancelled)) === undefined);
  await R.locator('.file-btn').click();
  const recorded = JSON.parse((await R.locator('.file-out').textContent()).split('\n\n//')[0]);
  check('record: the tour file has the sample data and exit clicks',
    JSON.stringify(recorded.steps[0].fill) === JSON.stringify([{ target: "[data-cy='mockStreet']", value: '1100 Congress Ave', pick: '1100 Congress Ave Austin, TX, 78701' }]) &&
    JSON.stringify(recorded.exitClicks) === JSON.stringify(["[data-cy='mockCancel']"]), JSON.stringify(recorded));
  // Save to GitHub on a new tour: GitHub's new file page, named after the tour and filled in with the file
  const ghNewP = ctx.waitForEvent('page');
  await R.locator('.gh-btn').click();
  const ghNew = new URL((await ghNewP).url());
  const sent = JSON.parse(ghNew.searchParams.get('value') || 'null');
  check('save: a new tour opens a filled-in new file on GitHub',
    ghNew.pathname === '/shuang-dl/product-tour-layer/new/main/tours' && ghNew.searchParams.get('filename') === 'recorded.json' &&
    sent && sent.id === 'recorded' && sent.exitClicks.length === 1 && sent.steps[0].fill.length === 1, ghNew.href.slice(0, 200));
} finally {
  await ctx.close();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
