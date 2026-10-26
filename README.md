# product-tour-layer

Proof of concept: guided product tours that run **on top of DoorLoop** without changing DoorLoop's code.

Tours are JSON files in this repo. A Chrome extension built here loads into the DoorLoop tab, reads the tours, and highlights elements on the page with step-by-step popovers. Everything it runs is bundled in the extension; the only outside code is [driver.js](https://driverjs.com) (MIT), copied into `vendor/` rather than loaded from a CDN.

**Links page:** https://shuang-dl.github.io/product-tour-layer/

## How it works

```
links page ──click──▶ app.doorloop.com/tenants?tour=tenants-list
                                │
                     DoorLoop Tours extension
                       ├─ fetches tours.json from GitHub Pages (falls back to its bundled copy)
                       ├─ sees ?tour=tenants-list → starts that tour
                       └─ no ?tour= → shows a "Tours" button with tours for the current page
```

- **Multi-page tours:** progress is kept in `sessionStorage`, so a tour continues after a step navigates to another page.
- **Waits for the page:** each step waits (up to 8s) for its element to render before showing.
- **Missing elements:** if a step's element never appears, the step still shows, centred, so the tour doesn't get stuck. An `optional` step is skipped instead.
- **Closing:** only the × ends a tour. Escape and clicks on the dimmed page don't, since they're easy to do by accident in the middle of a form.

## Demo app (no setup)

[`/demo/`](https://shuang-dl.github.io/product-tour-layer/demo/home) is a simple, read-only DoorLoop-style app with made-up data: Overview, Properties, Units, Leases, Tenants (with profiles), Vendors, Tasks, Transactions, Reports and Settings. Navigation, search, filters and tabs work; create and edit buttons only say they're turned off.

- It uses the same element labels as DoorLoop (`data-cy`, `data-intercom-target`, `aria-label`), so tours carry over between the two.
- The tour engine is built into the page (`site/demo/index.html` loads `tour-layer.js` and calls `TourLayer.init`), with no extension. That's the integration DoorLoop would add to its own app.
- Demo tours live in `demo-tours/` and are listed on the links page under "Try it now, no setup".
- Source: `site/demo/` (`data.js` sample data, `app.js` pages and routing). GitHub Pages serves unknown paths with `404.html`, which is a copy of the demo page, so deep links like `/demo/tenants/t1` work.
- Preview locally: `npm run build && npm run serve`, then open http://localhost:4173/product-tour-layer/.

## Try it on DoorLoop

1. Download [doorloop-tours-extension.zip](https://shuang-dl.github.io/product-tour-layer/doorloop-tours-extension.zip) and unzip it (or run `node scripts/build.mjs` and use `dist/extension/`).
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the folder.
3. Log in to DoorLoop, then click a tour on the [links page](https://shuang-dl.github.io/product-tour-layer/). Or open any page that has tours and use the **Tours** button in the bottom-right corner.

Tours included: `home-overview` (`/home`), `tenants-list` (`/tenants`), and `find-a-tenant` (starts on `/home`, continues on `/tenants`).

New and edited tours reach installed extensions on the next page refresh once merged to `main`. Reinstall only when the extension code changes. If GitHub Pages can't be reached, the extension uses the copy of the tours bundled into it at build time.

For wider internal rollout without Developer mode: publish it to the Chrome Web Store as unlisted or private to the DoorLoop domain, or have a Google Workspace admin force-install it on staff browsers.

## Writing a tour

Add `tours/<id>.json`:

```json
{
  "id": "tenants-list",
  "title": "Working with your tenant list",
  "description": "Search, filter, and export tenants.",
  "page": "/tenants",
  "steps": [
    { "target": "input[aria-label='Search']", "title": "Search", "text": "Type a name to narrow the list." },
    { "target": { "text": "New lease" }, "title": "Start a new lease", "text": "Click to begin." }
  ]
}
```

| Tour field | |
|---|---|
| `id` | kebab-case, must match the file name |
| `title`, `description` | shown on the links page and in the launcher |
| `page` | the DoorLoop path the tour starts on |
| `style` | optional. How every step box in this tour looks (see below) |
| `steps` | list of steps |

| Step field | |
|---|---|
| `title`, `text` | popover content (plain text) |
| `target` | optional. A CSS selector, or `{ "text": "Button label", "selector": "button" }` to match by visible label, or a list of those: a group, highlighted as one area. No target = centred popover |
| `page` | optional. The path this step belongs to (`*` matches one segment, e.g. `/tenants/*`). The tour waits until the user is on it |
| `advanceOn` | `"next"` (default) or `"click"`: the user clicks the highlighted element to continue |
| `optional` | `true` = skip this step if its target isn't on screen (e.g. "open the People menu" when it's already open) |
| `image` | optional. An image shown full width at the top of the step: an `https://` URL or a path to a `.png`, `.jpg`, `.gif`, `.webp` or `.svg` file |

**Step box style.** Each step shows as a box with a coloured header band (step count and close), a body (image, title, text) and a coloured footer band (Back and Next). One `style` per tour keeps every step consistent; any field left out uses the default.

```json
"style": { "frame": "#0f6e56", "button": "#ffffff", "buttonText": "#0f6e56", "titleSize": "h3" }
```

| Style field | Default | |
|---|---|---|
| `frame` | `#0b1f44` | header, footer and side borders |
| `bandText` | `#ffffff` | text in the header and footer |
| `button` / `buttonText` | `#d8f34a` / `#0b1f44` | the Next button |
| `bodyText` / `bodyBg` | `#1b1d21` / `#ffffff` | the body |
| `headerHeight` | `26` | px, 16 to 48 |
| `footerHeight` | `48` | px, 32 to 64 |
| `sideBorder` | `3` | px, 0 to 8 |
| `corners` | `10` | px, 0 to 16 |
| `titleSize` | `h2` | `h1` (22px), `h2` (18px) or `h3` (16px); a real heading tag |
| `titleAlign` | `left` | `left`, `center` or `right` |
| `textAlign` | `left` | `left`, `center`, `right` or `justify` (text is always 14px) |

The [builder concept](https://shuang-dl.github.io/product-tour-layer/builder-concept.html)'s Tour style panel (◐) sets these visually, and "View tour file" writes them in this format.

**Building on live DoorLoop.** In the [builder](https://shuang-dl.github.io/product-tour-layer/builder-concept.html), choose **Build on: Live DoorLoop** when creating a tour. DoorLoop opens in a new tab and the DoorLoop Tours extension (0.5.0 or later) opens the same builder on top of it: a top bar, a toolbox on the right and the storyboard along the bottom. Pick elements on the real app, add steps and pages, set the tour style, preview, and copy the tour file.

- The builder is `src/builder.js`, shared by the builder page (demo mode, with the demo app in a frame) and the extension (live mode). It draws inside a shadow root so DoorLoop's CSS and the builder's can't affect each other.
- Pages change through DoorLoop's own links (an in-app page change). Where there's no link, the page loads normally and the builder comes back with the draft, which is kept in `sessionStorage` for that tab.
- The tour launcher is hidden while building. Closing the builder discards the draft, so copy the tour file first.

**Editing a tour.** In the builder's start popup choose **Edit existing tour**, then pick a published tour (DoorLoop or demo) or paste a tour file, and build on the demo or live DoorLoop. The storyboard fills in with the tour's pages and steps, and its style loads into the Tour style panel.

- Click a card to edit that step (the builder goes to its page and finds its element again). For a page pattern like `/tenants/*`, open a matching page first.
- **+** between cards inserts a step there; drag cards to reorder (a step dragged past a page card moves to that page); × removes one.
- The step editor's **Skip this step if it isn't on screen** sets `optional`.
- **View tour file** keeps the tour's id, so the edited file replaces the original in `tours/` (or `demo-tours/`).
- When an element's label is shared by several elements (e.g. two choice cards with the same wrapper label), the builder uses a uniquely labelled element inside it instead, since the tour engine would only ever find the first.
- **Storyboard ▾** in the top bar collapses the storyboard, e.g. to reach an app's bottom bar.
- Like draft previews, the extension only opens the builder when asked by the builder's own site.

**Testing a draft on live DoorLoop.** In the builder, set **Test on** to **Live DoorLoop** and click **Preview**. DoorLoop opens in a new tab and the DoorLoop Tours extension (version 0.2.0 or later) runs the draft there, on your own account. DoorLoop can't be shown inside the builder, so you still build on the demo, whose element labels match DoorLoop's.

- The extension only accepts drafts sent from the builder's own site (`https://shuang-dl.github.io`, or `http://localhost:4173` for `npm run serve`). Messages from anywhere else are ignored.
- The draft is kept for that tab until it finishes, so multi-page drafts keep going after a page loads.
- Demo record pages like `/tenants/t1` become `/tenants/*`, so a step works on any record.
- For the live test, features the engine doesn't support yet are simplified: "type text" steps use a Next button, and text formatting is left out. The builder says which applied.

**Picking targets.** Prefer, in order: `data-cy` (DoorLoop's test ids, e.g. `[data-cy='SideMenu-People-Tenants']`), `data-intercom-target`, `aria-label`, then `{ "text": ... }`. Avoid class names; they change with every DoorLoop release. In DevTools, `document.querySelectorAll('[data-cy]')` lists what's available on a page.

**Check your tour:** `node scripts/build.mjs` validates every tour and fails with a list of problems if any are wrong. CI runs the same check on every pull request.

**Test the extension:** `npm install`, `npx playwright install chromium` (once), then `npm run build && npm test`. This loads the built extension into a headless Chromium and runs the tours against a mock DoorLoop page (`tests/mock-doorloop.html`): multi-page and click-to-advance steps, optional steps, targets below the fold, published vs. bundled tours, and closing. CI runs it on every push and pull request. Publishing stops if it fails. If a tour starts pointing at new DoorLoop elements, add them to the mock page.

## Layout

| Path | |
|---|---|
| `src/tour-layer.js` | the engine (`TourLayer.init`, `start`, `run`, `stop`) |
| `src/builder.js` | the tour builder, used by the builder page and the extension |
| `tours/*.json` | one file per tour on real DoorLoop |
| `demo-tours/*.json` | tours for the demo app (same format) |
| `site/demo/` | the demo app |
| `site/index.html` | links page (lists tours from `tours.json`) |
| `extension/` | Chrome extension manifest and loader (`content.js`) |
| `vendor/driver.js/` | highlight/popover library (MIT), bundled into the extension |
| `scripts/build.mjs` | validation + build site, extension and demo app into `dist/` |
| `scripts/serve.mjs` | serves `dist/` locally the way GitHub Pages does |
| `tests/` | extension test (Playwright) and the mock DoorLoop page it runs against |
| `.github/workflows/pages.yml` | validate on PRs, publish to GitHub Pages on `main` |

## Publishing

A GitHub Actions workflow (`.github/workflows/pages.yml`) runs the tour check and the extension test on every pull request. On merge to `main` it publishes the links page, `tours.json`, and the extension zip to GitHub Pages, usually within a minute.

## Ideas

Future ideas, such as a visual tour builder, are collected in [IDEAS.md](IDEAS.md).

## Path to production

The extension only does three things: load driver.js, load `tour-layer.js`, and call `TourLayer.init({ tours })` (see `extension/content.js`). If DoorLoop's app did the same, customers would get tours with nothing to install. The engine and tour files carry over unchanged.

Before that, engineering would want: hosting on a DoorLoop-controlled domain, a security review, targeting by role/plan (passed to `init`), per-user "seen" state, analytics events, and a kill switch.
