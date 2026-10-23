# product-tour-layer

Proof of concept: guided product tours that run **on top of DoorLoop** without changing DoorLoop's code.

Tours are JSON files in this repo. A small script loads into the DoorLoop tab, reads the tours, and highlights elements on the page with step-by-step popovers (built on [driver.js](https://driverjs.com)).

**Links page:** https://shuang-dl.github.io/product-tour-layer/

## How it works

```
links page ──click──▶ app.doorloop.com/tenants?tour=tenants-list
                                │
                     tour-layer.js (loaded by the userscript)
                       ├─ fetches tours.json from GitHub Pages
                       ├─ sees ?tour=tenants-list → starts that tour
                       └─ no ?tour= → shows a "Tours" button with tours for the current page
```

- **Multi-page tours:** progress is kept in `sessionStorage`, so a tour continues after a step navigates to another page.
- **Waits for the page:** each step waits (up to 8s) for its element to render before showing.
- **Missing elements:** if a step's element never appears, the step still shows, centred, so the tour doesn't get stuck. An `optional` step is skipped instead.

## Try it

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open https://shuang-dl.github.io/product-tour-layer/tour-layer.user.js and click **Install**.
3. Log in to DoorLoop, then click a tour on the [links page](https://shuang-dl.github.io/product-tour-layer/).

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

**Check your tour:** `node scripts/build.mjs` validates every tour and builds the site into `dist/`. CI runs the same check on every pull request; merging to `main` publishes.

## Layout

| Path | |
|---|---|
| `src/tour-layer.js` | the engine (`TourLayer.init`, `start`, `stop`) |
| `tours/*.json` | one file per tour |
| `site/index.html` | links page (lists tours from `tours.json`) |
| `userscript/tour-layer.user.js` | Tampermonkey loader |
| `scripts/build.mjs` | validation + build into `dist/` |
| `.github/workflows/pages.yml` | validate on PRs, publish to GitHub Pages on `main` |

## Path to production

The userscript is about 10 lines and is the whole integration. If DoorLoop shipped the equivalent in its app, customers would get tours with nothing to install:

```html
<script src="https://<doorloop-cdn>/tour-layer.js" async></script>
<script>window.addEventListener('load', () => TourLayer.init({ toursUrl: 'https://<doorloop-cdn>/tours.json' }));</script>
```

Before that, engineering would want: hosting on a DoorLoop-controlled domain, a security review, targeting by role/plan (passed to `init`), per-user "seen" state, analytics events, and a kill switch.
