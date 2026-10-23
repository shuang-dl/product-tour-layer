# product-tour-layer

Proof of concept: guided product tours that run **on top of DoorLoop** without changing DoorLoop's code.

Tours are JSON files in this repo. A Chrome extension built here loads into the DoorLoop tab, reads the tours, and highlights elements on the page with step-by-step popovers. Everything it runs is bundled in the extension; the only outside code is [driver.js](https://driverjs.com) (MIT), copied into `vendor/` rather than loaded from a CDN.

**Links page:** https://shuang-dl.github.io/product-tour-layer/ (live once publishing is set up; see [Publishing](#publishing))

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

## Try it

1. Build it: `node scripts/build.mjs` (Node 18+). The extension lands in `dist/extension/`.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select `dist/extension`.
3. Log in to DoorLoop, then open a tour link, e.g. `https://app.doorloop.com/tenants?tour=tenants-list`. Or open any page that has tours and use the **Tours** button in the bottom-right corner.

Tours included: `home-overview` (`/home`), `tenants-list` (`/tenants`), and `find-a-tenant` (starts on `/home`, continues on `/tenants`).

Once publishing is set up, the links page lists every tour and offers the extension as a zip, and new or edited tours reach installed extensions without a reinstall. Until then the extension uses the tours bundled into it at build time, so rebuild and click the reload icon on `chrome://extensions` after editing a tour.

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
| `steps` | list of steps |

| Step field | |
|---|---|
| `title`, `text` | popover content (plain text) |
| `target` | optional. A CSS selector, or `{ "text": "Button label", "selector": "button" }` to match by visible label. No target = centred popover |
| `page` | optional. The path this step belongs to (`*` matches one segment, e.g. `/tenants/*`). The tour waits until the user is on it |
| `advanceOn` | `"next"` (default) or `"click"`: the user clicks the highlighted element to continue |
| `optional` | `true` = skip this step if its target isn't on screen (e.g. "open the People menu" when it's already open) |

**Picking targets.** Prefer, in order: `data-cy` (DoorLoop's test ids, e.g. `[data-cy='SideMenu-People-Tenants']`), `data-intercom-target`, `aria-label`, then `{ "text": ... }`. Avoid class names; they change with every DoorLoop release. In DevTools, `document.querySelectorAll('[data-cy]')` lists what's available on a page.

**Check your tour:** `node scripts/build.mjs` validates every tour and fails with a list of problems if any are wrong.

## Layout

| Path | |
|---|---|
| `src/tour-layer.js` | the engine (`TourLayer.init`, `start`, `stop`) |
| `tours/*.json` | one file per tour |
| `site/index.html` | links page (lists tours from `tours.json`) |
| `extension/` | Chrome extension manifest and loader (`content.js`) |
| `vendor/driver.js/` | highlight/popover library (MIT), bundled into the extension |
| `scripts/build.mjs` | validation + build site and extension into `dist/` |

## Publishing

Planned, not live yet: a GitHub Actions workflow (`.github/workflows/pages.yml`) that runs the tour check on every pull request and, on merge to `main`, publishes the links page, `tours.json`, and the extension zip to GitHub Pages. It needs a GitHub token allowed to push workflow files before it can be added.

## Path to production

The extension only does three things: load driver.js, load `tour-layer.js`, and call `TourLayer.init({ tours })` (see `extension/content.js`). If DoorLoop's app did the same, customers would get tours with nothing to install. The engine and tour files carry over unchanged.

Before that, engineering would want: hosting on a DoorLoop-controlled domain, a security review, targeting by role/plan (passed to `init`), per-user "seen" state, analytics events, and a kill switch.
