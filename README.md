---
permalink: ai-main/projects/product-tour-layer/readme
title: README
type: note
---

# product-tour-layer

Proof of concept: guided product tours that run **on top of DoorLoop** without changing DoorLoop's code.

Tours are JSON files in this repo. A Chrome extension built here loads into the DoorLoop tab, reads the tours, and highlights elements on the page with step-by-step popovers. Tours can also be built visually, on top of live DoorLoop, with the tour builder. Everything it runs is bundled in the extension; the only outside code is [driver.js](https://driverjs.com) (MIT), copied into `vendor/` rather than loaded from a CDN. Its stylesheet is adjusted at build time (see "Clicks" below).

**Current extension version:** 0.18.1. A summary of the work so far, what was found on real DoorLoop and what's still open, is in [SUMMARY.md](SUMMARY.md).

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
- **Clicks:** the highlighted area works as normal, including dropdowns its fields open. The dimmed page around it doesn't take clicks: the overlay's shape blocks them, rather than driver.js's rule that made every element unclickable (the build removes that rule from driver.css, since it broke DoorLoop's form fields). A highlighted group follows its items when the page scrolls, resizes, shifts its layout or re-renders them.
- **Fields and dropdowns:** while someone is typing in a field or has a dropdown open, moving to the next step doesn't take focus away, so the dropdown stays open. Dropdowns that open outside the highlight are lifted above the dimmed layer, but never lowered.
- **DoorLoop's dialogs:** dialogs like Create new and Receive payment sit above the tour's dimmed layer, so for targets inside them the tour draws the dimming and highlight just above the dialog. The step box stays clickable even when a dialog blocks clicks outside itself, and its clicks don't count as "outside" for the dialog.
- **Shared labels:** when a label matches more than one element (e.g. Receive payment under Favorites and again under Transactions), the tour uses the one people can see.
- **On screen:** the step box is kept inside the window (and shrinks on narrow windows), with a progress bar under the step count. With "reduce motion" turned on in the system settings, the highlight jumps between steps instead of gliding.
- **Starting by itself:** a tour with `autoStart` opens the first time someone visits its page, once per browser.
- **Ending:** × ends a tour at any step; **Done** ends it on the last step. Escape and clicks on the dimmed page don't, since they're easy to do by accident in the middle of a form. Done on the last step also leaves the form the tour went through, without saving (see "Sample data").

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
4. To build or edit tours, click the extension's icon (pin it in Chrome's toolbar to keep it handy). See "The extension's menu" below.

Tours included:

- `home-overview` (`/home`) and `tenants-list` (`/tenants`)
- `find-a-tenant`: starts on `/home`, continues on `/tenants`
- `add-a-new-property`: Create new → Property, through the five-part New property wizard, with sample data
- `receive-a-payment`: Create new → Receive payment, in DoorLoop's full-screen payment dialog, with a sample amount

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
| `status` | `"draft"` or `"live"` (no status = live). Drafts are published separately and only show for people who turn on **Show drafts** (see "Drafts and approval" below) |
| `page` | the DoorLoop path the tour starts on |
| `style` | optional. How every step box in this tour looks (see below) |
| `autoStart` | optional. `true` = the tour opens by itself the first time someone visits its `page`. Once it ends (Done or ×), that browser remembers and it only runs again from the launcher or a `?tour=` link. The builder's **Start by itself once** sets it |
| `exitClicks` | optional. A list of targets clicked in order to leave the form without saving when the tour ends with **Done** on its last step (and after × too, if **Fill example** was used): e.g. Cancel, then the Discard button it opens (see "Sample data" below) |
| `steps` | list of steps |

| Step field | |
|---|---|
| `title`, `text` | popover content (plain text) |
| `target` | optional. A CSS selector, or `{ "text": "Button label", "selector": "button" }` to match by visible label, or a list of those: a group, highlighted as one area. No target = centred popover |
| `clues` | optional, set by the builder. What the target element looked like: `{ "tag", "text", "aria", "name", "placeholder", "role", "href" }` (only the ones it has), or for a group a list with one per item. If the `target` stops matching (e.g. a DoorLoop release renames a `data-cy`), the tour uses the element that best fits the clues (see "Picking targets") |
| `page` | optional. The path this step belongs to (`*` matches one segment, e.g. `/tenants/*`). The tour waits until the user is on it |
| `advanceOn` | `"next"` (default) or `"click"`: the user clicks the highlighted element to continue |
| `optional` | `true` = skip this step if its target isn't on screen (e.g. "open the People menu" when it's already open) |
| `image` | optional. An image shown full width at the top of the step: an `https://` URL or a path to a `.png`, `.jpg`, `.gif`, `.webp` or `.svg` file |
| `showOnly` | `true` = the highlighted element can't be clicked or pressed (e.g. point at Finish without anyone saving). Can't be combined with `advanceOn: "click"`. On the **last** step it adds a note: after Fill example, "Click Done to discard the sample data" (the button stays blocked); otherwise "Click Done to discard what you entered, or click Finish to save it", and the button works: it saves and ends the tour. That note and saving only apply when the highlighted element is a button or link (or wraps a single one); a show-only panel, e.g. account details, gets no note |
| `placement` | Where the step box goes: `right`, `left`, `bottom` or `top` of the highlighted area. Left out (or `auto`), it goes on the first side with room, in that order. Either way it never covers the highlighted area when there's room beside it, falls back to another side when the chosen one has no room, and stays inside the window. In the builder: **Box position** in the step editor |
| `fill` | optional. Sample data: adds a **Fill example** button to the step. A list of `{ "target", "value", "pick"? }` (type the value into the field, then click the suggestion whose text is `pick`) or `{ "target", "click": true }` (click a choice or checkbox) |

**Sample data.** A step with `fill` lets people try a form without making up data: **Fill example** types the values the way a person would (so the app sees real typing), picks suggestions and clicks choices. To keep sample data from being saved, the last step points at the save button with `showOnly`, and `exitClicks` leave the form when the tour ends (Done or ×). **Done** on the last step always leaves the form this way, typed data or not. Closing with × partway through only leaves it if Fill example was used, so stopping early never throws away what someone typed themselves. If a tour has no exit clicks, or one of them isn't on the page, and the form is in a dialog, the tour closes that dialog with its close button (×) instead. Either way, if the app then asks "Discard your changes?" (or offers Leave), the tour discards. Full-page forms with no dialog, like New property, still need exit clicks. This only works for forms that save nothing until the last button; check that before adding sample data to a tour.

```json
"exitClicks": ["[data-cy='SideMenu-Rentals-Properties']"],
"steps": [
  { "target": "[data-cy='street1']", "title": "Enter the address", "text": "...",
    "fill": [{ "target": "[data-cy='street1']", "value": "1100 Congress Ave", "pick": "1100 Congress Ave Austin, TX, 78701" }] },
  { "target": "[data-cy='BottomNavigationPanel-NextButton']", "title": "Finish", "text": "...", "showOnly": true }
]
```

**Drafts and approval.** A tour with `"status": "draft"` isn't live. The build publishes it to `drafts.json` instead of `tours.json`, and never bundles it into the extension.

- **Seeing drafts:** on DoorLoop, drafts only load for people who turned on **Show drafts** in that browser, with a `?drafts=on` link (`?drafts=off` turns it off). The tours page has both links, and a **Drafts** section where **Try on DoorLoop** runs a draft (and turns Show drafts on). Draft tours say "Draft" in the step box, and the Tours launcher lists them under their own heading.
- **Approving:** **Approve on GitHub** on the tours page opens the draft's file. Change `"status": "draft"` to `"status": "live"` and commit; once published, everyone with the extension sees it.
- **The builder** saves new tours as drafts. Its **Status** setting (under **⋯ More**) switches between Draft and Live. Editing a live tour keeps it live, so saving those edits publishes them right away; switch it to Draft first to review changes before they're live (it stops being shown to everyone until approved again).

**Exporting a tour as a video or GIF** (for the tour's creator only). Tours stay tours; an export is a recording of one being played, e.g. for a help article or a message. People taking tours never see it: there's no export link on the tours page and the extension ignores `?export=` links. In the live builder, go to the tour's start page and use **⋯ More → Export video** or **Export GIF**. The builder steps aside and a card appears: click **Start recording**, choose this tab when Chrome asks, then play the tour as usual. When it ends (Done or ×), the file downloads (named after the tour): a video of the whole run (MP4 where Chrome can record it, otherwise WebM, at most 1920×1080), or an animated GIF with one frame per step, 2.5 seconds each, up to 1000 px wide. The card isn't recorded and nothing is clicked for you. Afterwards, or if you cancel, the builder comes back with your draft.

- The GIF encoder is our own (`src/gif.js`, no outside code): each frame gets a palette of its 256 most common colours, which suits app screens.
- The tour engine announces each step and its end as window events (`tourlayer:step`, `tourlayer:end`); the export listens for them.
- A full page reload in the middle of the tour stops the recording (the page that was recording goes away). DoorLoop's own page changes don't reload, so this is rare.
- **Stop sharing** in Chrome's bar ends the recording early and downloads what was recorded.
- The tab's picture changes size while recording (Chrome shows its "sharing this tab" bar right after the share starts), and a video whose frame size changes mid-file won't play. So the export draws the tab onto one fixed size, taken once that bar is up, and records that; GIF frames work the same way.

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

**The extension's menu.** The extension is an internal tool, and its icon (a lime spotlight on navy) opens a menu on any DoorLoop page:

- **New tour:** type a name and click **Build a new tour here**: the builder opens on top of the page you're on.
- **Edit a tour:** pick a live tour or a draft and click **Open in the builder**: the builder opens with it loaded.
- **Drafts:** a **Show drafts** switch (reloads the page), the same as the `?drafts=on` / `?drafts=off` links.
- **GitHub:** **Sign in with GitHub** shows a short code; enter it on GitHub's page once and the menu shows who's signed in, with **Sign out**. Anyone can sign in, but only someone with write access to this repo can save (the menu says so otherwise). See "Saving a tour".
- Not on DoorLoop, it offers to open DoorLoop. If the page was open before the extension was loaded or updated, it asks you to reload the page.

Only the extension's own menu can send these requests to the page; websites can't.

**Building on live DoorLoop.** Use the extension's menu (above), or in the [builder page](https://shuang-dl.github.io/product-tour-layer/builder-concept.html) choose **Build on: Live DoorLoop** when creating a tour. DoorLoop opens in a new tab and the DoorLoop Tours extension (0.8.0 or later) opens the same builder on top of it, in one panel on the right: the tour's controls at the top, then the tools, then the storyboard as a list of steps from top to bottom. **Hide ▸** slides the panel away to see the whole page (for example a drawer that opens on the right); the **Show builder** tab on the right edge brings it back. While the panel is open, DoorLoop is narrowed to end where the panel starts, so the panel sits beside the page instead of covering it; DoorLoop's dialogs, drawers and dropdowns stop at the panel's edge too. (DoorLoop's own layout rules still see the full window width, so a page may come out a little cramped.) **⋯ More → Keep DoorLoop beside the panel** turns this off, and the panel covers the page instead. Pick elements on the real app, add steps and pages, set the tour style, preview, and copy the tour file.

- The builder is `src/builder.js`, shared by the builder page (demo mode, with the demo app in a frame) and the extension (live mode). It draws inside a shadow root so DoorLoop's CSS and the builder's can't affect each other.
- Pages change through DoorLoop's own links (an in-app page change). Where there's no link, the page loads normally and the builder comes back with the draft, which is kept in `sessionStorage` for that tab.
- The tour launcher is hidden while building. Closing the builder discards the draft, so copy the tour file first.
- A new tour needs a name, and starts on `/home` unless you enter another page. Each step needs a title and some text before it saves.
- **● Record tour** in the panel records a tour by clicking through it: do the workflow the way people should, then click **Stop recording**. Each click becomes a step that continues when that element is clicked ("Click "Receive payment""); a checkbox becomes a "Tick" step; typing into a field becomes one "Enter …" step with what you typed as its sample data, and a suggestion picked right after goes with it. Picking from a list without typing records a step to open the field and one pointing at the whole list (so it works whatever the list holds). Changing pages adds page cards, and a full page load keeps recording. Clicks on nothing in particular and double clicks are skipped. Elements are named by `data-cy`, `data-testid`, a hand-written id, a placeholder or their `<label>`; one with none of these gets a short path from the nearest named element, so a recorded step never has an empty target. Afterwards every step is a normal card: click it to rewrite its title and text, add show-only, and so on. What you typed ends up in the tour file, so use made-up data.
- The panel has **● Record tour**, **▶ Preview**, **💾 Save tour**, **Hide ▸** and **Close**; **⋯ More** holds **Status** (the tour's `status`; new tours start as Draft), **Start by itself once** (`autoStart`), **View tour file** and **Export video / GIF**.
- In **View tour file**, the box holds only the tour file (notes sit below it), and select-all inside the box selects just the file. Copying the whole page instead brings the builder's screen text along, which the build rejects.
- The builder's **Preview** is a quick stand-in: it doesn't block show-only steps, run exit clicks, or behave exactly like the tour engine. To check those, publish the tour (or use **Test on: Live DoorLoop** from the demo builder) and run it from DoorLoop.

**Saving a tour.** In the live builder, **💾 Save tour** in the panel commits the tour file to `tours/<id>.json` on GitHub, as you, with nothing else to do. Sign in first from the extension's menu (**Sign in with GitHub**). Saving again updates the same file; a new tour whose file name already exists asks before replacing it. Once committed, CI checks the file and publishes it to GitHub Pages; the extension picks it up when DoorLoop next loads (Pages can take a few minutes). New tours are drafts until their status is changed to live.

- **How the sign-in works:** a GitHub App ("DoorLoop Tours") with permission to change files, installed only on this repo, and GitHub's device sign-in (a code entered at github.com/login/device). A sign-in can never do more than the person's own GitHub access, so only contributors with write access can save. The extension's background keeps the login in its own storage and does the saving; it's never handed to DoorLoop's page. Signing out removes it. Anyone using the same Chrome profile while you're signed in can save tours, so sign out on shared computers.
- **Setting it up (once):** register the GitHub App (Contents: read and write; device flow on; token expiry off; webhook off; installed only on this repo) and put its Client ID in `extension/background.js` (`CLIENT_ID`). Done: the app is registered and installed on this repo. To let someone save tours, give them write access to the repo.
- **On the demo builder** (no extension there), **⋯ More → View tour file → Save to GitHub** still opens GitHub's own page instead: a new tour opens the "new file" page (filled in when short, otherwise paste the copied file), an edited tour opens its file's edit page, and you commit there.
- What the tour format can't hold yet is simplified first ("type text" steps use a Next button, text formatting is left out); the builder says which applied. Uploaded images aren't saved with it: put the image online and set the step's `image` to its `https://` address.

**Editing a tour.** In the builder's start popup choose **Edit existing tour**, then pick a published tour (DoorLoop or demo) or paste a tour file, and build on the demo or live DoorLoop. The storyboard fills in with the tour's pages and steps, and its style loads into the Tour style panel.

- Click a card to edit that step (the builder goes to its page and finds its element again). For a page pattern like `/tenants/*`, open a matching page first.
- **+** between cards inserts a step there; drag cards to reorder (a step dragged past a page card moves to that page); × removes one.
- The step editor's **Skip this step if it isn't on screen** sets `optional`, and **Show only** sets `showOnly`.
- **Sample data** in the step editor: click **Record**, then fill in the highlighted area the way people should (type, pick a suggestion, click a choice) and click **Stop**. Only what happens inside the highlight is recorded; a picked suggestion attaches to the field typed into just before it. The list shows what was recorded: edit a value or remove a row before saving the step. Everything in it ends up in the published tour file, so use made-up data.
- **⎋ Leaving without saving** in the panel's tools: **+ Pick a button**, then click what should be pressed when the tour ends (it isn't pressed while picking). These are the tour's `exitClicks`. When you save a step with sample data inside a dialog and the tour has no exit clicks yet, the builder suggests the dialog's × and shows it here to keep or remove.
- **View tour file** keeps the tour's id, so the edited file replaces the original in `tours/` (or `demo-tours/`).
- When an element's label is shared by several elements (e.g. two choice cards with the same wrapper label), the builder uses a uniquely labelled element inside it instead, since the tour engine only uses one of them: the one in view, otherwise the first on the page.
- **Hide ▸** slides the live builder's panel away, e.g. to reach something under it; in the demo builder, **Storyboard ▾** collapses the storyboard.
- Like draft previews, the extension only opens the builder when asked by the builder's own site.

**Testing a draft on live DoorLoop.** In the builder, set **Test on** to **Live DoorLoop** and click **Preview**. DoorLoop opens in a new tab and the DoorLoop Tours extension (version 0.2.0 or later) runs the draft there, on your own account. DoorLoop can't be shown inside the builder, so you still build on the demo, whose element labels match DoorLoop's.

- The extension only accepts drafts sent from the builder's own site (`https://shuang-dl.github.io`, or `http://localhost:4173` for `npm run serve`). Messages from anywhere else are ignored.
- The draft is kept for that tab until it finishes, so multi-page drafts keep going after a page loads.
- Demo record pages like `/tenants/t1` become `/tenants/*`, so a step works on any record.
- For the live test, features the engine doesn't support yet are simplified: "type text" steps use a Next button, and text formatting is left out. The builder says which applied.

**When a target stops matching.** Steps the builder saves carry `clues` as well as a `target`. If the target finds nothing for 1.5 seconds, the tour scores every visible element of the same tag against the clues (text counts most, then aria-label, name, placeholder, link and role; the idea comes from Mimik's Guide Me replay) and uses the best one above 60%. A partial text match only counts when the shorter text is most of the longer one, and role alone never counts, so a poor fit leaves the step centred rather than pointing at the wrong thing. The tour logs a warning in the console when it falls back, and opening that step in the builder finds the element the same way: saving it writes a working target. Tours written by hand, or saved before clues existed, don't have them; re-saving each step in the builder adds them.

**Picking targets.** Prefer, in order: `data-cy` (DoorLoop's test ids, e.g. `[data-cy='SideMenu-People-Tenants']`), `data-intercom-target`, `aria-label`, then `{ "text": ... }`. Avoid class names; they change with every DoorLoop release. In DevTools, `document.querySelectorAll('[data-cy]')` lists what's available on a page.

**Check your tour:** `node scripts/build.mjs` validates every tour and fails with a list of problems if any are wrong, e.g. a step with no text, or other text pasted in with the file. CI runs the same check on every pull request.

**Test the extension:** `npm install`, `npx playwright install chromium` (once), then `npm run build && npm test`. This loads the built extension into a headless Chromium and runs 89 checks against a stand-in DoorLoop page (`tests/mock-doorloop.html`) that copies the traps found on the real app: a field outline over its input, dropdowns mounted outside the field, a full-screen dialog that blocks outside clicks and asks before discarding, a scrolling menu with the same item twice, a wizard with a suggesting street field. The checks cover the engine (steps, groups, dropdowns, dialogs, sample data, show-only, exit clicks, auto-start, on-screen) and the live builder (picking, recording sample data, editing, saving). CI runs it on every push and pull request; publishing stops if it fails. Each check added for a bug was confirmed to fail without its fix. If a tour starts pointing at new DoorLoop elements, add them to the mock page.

## Layout

| Path | |
|---|---|
| `src/tour-layer.js` | the engine (`TourLayer.init`, `start`, `run`, `stop`) |
| `src/builder.js` | the tour builder, used by the builder page and the extension |
| `src/export.js`, `src/gif.js` | exporting a tour as a video or GIF, and the GIF encoder (extension only) |
| `tours/*.json` | one file per tour on real DoorLoop |
| `demo-tours/*.json` | tours for the demo app (same format) |
| `site/demo/` | the demo app |
| `site/index.html` | links page (lists tours from `tours.json`) |
| `extension/` | Chrome extension manifest, loader (`content.js`), the icon's menu (`popup.html`, `popup.js`), icons, and the background worker (`background.js`: GitHub sign-in and saving) |
| `vendor/driver.js/` | highlight/popover library (MIT), bundled into the extension |
| `scripts/build.mjs` | validation + build site, extension and demo app into `dist/` |
| `scripts/serve.mjs` | serves `dist/` locally the way GitHub Pages does |
| `tests/` | extension test (Playwright) and the mock DoorLoop page it runs against |
| `.github/workflows/pages.yml` | validate on PRs, publish to GitHub Pages on `main` |

## Publishing

A GitHub Actions workflow (`.github/workflows/pages.yml`) runs the tour check and the extension test on every pull request. On merge to `main` it publishes the links page, `tours.json` (live tours), `drafts.json` (drafts), and the extension zip to GitHub Pages, usually within a minute.

## Ideas

Future ideas, such as a visual tour builder, are collected in [IDEAS.md](IDEAS.md).

## Path to production

The extension only does three things: load driver.js, load `tour-layer.js`, and call `TourLayer.init({ tours })` (see `extension/content.js`). If DoorLoop's app did the same, customers would get tours with nothing to install. The engine and tour files carry over unchanged.

Before that, engineering would want: hosting on a DoorLoop-controlled domain, a security review, targeting by role/plan (passed to `init`), per-user "seen" state stored with the account (today `autoStart` remembers per browser), analytics events, a kill switch, and a decision on driver.js (replace it with our own spotlight, or keep it).