# Ideas

Things we may build later. Not planned or scheduled yet.

## Visual tour builder

A way to create tours without writing JSON by hand.

**What it would do**

- **Builder overlay:** a dashboard that sits on top of the site or page you choose, where tours are built.
- **Picking what to highlight**, two ways:
  - Point at an element and click it.
  - Draw a box around the area you want highlighted. The system picks the closest matching element.
- **Step content:** after you select something, a text box appears for the step's tour text. You can also add images.
- **Styling:** change the colours of the background, border, text block, and so on. Settled as one style per tour; see "Step box style" below.
- **Text editing:** full text editing and formatting.

**Flow (draft)**

Clickable concept: [builder-concept.html](https://shuang-dl.github.io/product-tour-layer/builder-concept.html) (source: `site/builder-concept.html`).

1. **Create new tour** button opens a popup asking for the tour name and the page where the tour starts.
2. The same popup loads that page with the builder tools around it. The concept loads the [demo app](https://shuang-dl.github.io/product-tour-layer/demo/home), so these are real, clickable pages:
   - **Toolbox** on the side: pointer (click an element), box (draw around an area), text formatting, colours.
   - **Box tool and groups:** draw around several things, e.g. a group of menu items, and they become one step, highlighted as a single area with one popup. A box that only covers one thing snaps to that element.
   - **Storyboard** along the bottom: the tour's flow as cards, in order, ending with **+ Step** and **+ Page**. Click a card to edit it; × removes it.
3. **+ Step** adds an empty step to the storyboard first. Highlighting only works while a step is active, so nothing gets added by an accidental click. With no step active you can browse the app normally; if you add a step after browsing to a new page, a page card for it is added automatically.
4. **+ Page** asks for a page path (e.g. `/leases`) and moves the app there. Steps added after it happen on that page. Clicking a page card goes back to that page, and editing or previewing a step goes to its page. This becomes `page` on those steps in the tour file, the same field multi-page tours use today.
5. Picking something for the active step opens the step box right next to it, looking like the final tour popup. You type the title and text there, format it, and add images.
6. Each step sets how the tour **continues**: a Next button, clicking the highlighted element, or typing text into it.
7. **Edit existing tour** loads a published or pasted tour into the same storyboard: click a card to edit, **+** between cards to insert, drag to reorder.
8. **Preview** plays the tour from the storyboard, either in the builder on the demo or, with **Test on: Live DoorLoop**, in a new DoorLoop tab through the extension. **View tour file** shows the file it would publish.

**Step box style (draft, agreed)**

One style per tour: every step in a tour looks the same. Set in the builder's Tour style panel (◐), not per step. Built into the [builder concept](https://shuang-dl.github.io/product-tour-layer/builder-concept.html) and the real tour engine (the `style` block and step `image` in the tour file; see the README).

- **Layout:** a white body framed by a coloured header band on top, a coloured footer band below, and thin borders of the same colour down both sides.
- **Header band** (default 26px, adjustable 16–48): step count ("Step 2 of 5") and the close ×.
- **Footer band** (default 48px, adjustable 32–64): Back on the left, Next as a button on the right. The button's padding grows with the footer.
- **Side borders:** default 3px, adjustable 0–8. **Corners:** default 10px, adjustable 0–16.
- **Colours** (each set separately): frame (header, footer, sides), header/footer text, button, button text, body text, body background (white by default).
- **Images** stretch edge to edge across the body, between the side borders, directly under the header. Title and text sit below with normal padding.
- **Title:** a real heading tag, H1 (22px), H2 (18px) or H3 (16px); aligned left, centre or right.
- **Body text:** fixed size (14px); aligned left, centre, right or justified, separately from the title. Formatting (bold, italic, underline, lists, colour) stays available inside the text.
- Open: whether the image can also go below the text, and whether Back should be a second button.

**Notes on how it could fit the current setup**

- DoorLoop can't be shown inside another site, so the builder can't show live DoorLoop in a popup. Instead, **Build on: Live DoorLoop** opens the same builder on top of the DoorLoop tab itself, through the extension (0.3.0 or later). **Build on: Demo site** embeds the demo app, which works because both are on the same site.
- Pages picked while browsing are exact paths like `/tenants/t1`; the tour file turns demo record pages into patterns like `/tenants/*`. A real builder would let you choose.
- "Type text to continue" would be a new `advanceOn` option in the engine.
- Groups: the engine accepts a list of targets and highlights the area around all of them (an invisible box over the group, since driver.js highlights one element).
- The builder could produce the same tour files that live in `tours/` today. The engine and publishing wouldn't change.
- Picking an element would need to produce a target that survives DoorLoop releases. Prefer `data-cy`, `data-intercom-target` and `aria-label` over class names, as described under "Picking targets" in the README.
- Images, styling and formatted text would each need new fields in the tour format, plus checks in `scripts/build.mjs`. Formatted text must stay safe: allow a limited set of formatting, never raw HTML.
- The extension could host the builder, since it already runs on DoorLoop pages.

## Tour reporting

Data on how each tour is used, so we can tell which tours help, where people drop off, and which steps break.

**What to measure**

- **Runs:** how many times each tour was started, and how: by itself (`autoStart`), from the Tours launcher, from a `?tour=` link, or from the builder.
- **How far they got:** the furthest step reached, and how many people reached each step (a funnel per tour).
- **How they left:**
  - finished with Done on the last step;
  - closed with × (and on which step);
  - Stop tour in the launcher;
  - left mid-tour by going to another page, and whether they came back with Resume;
  - never came back (abandoned).
- **Finished or not:** completion rate per tour.
- **Repeats:** did the same person run the tour again, and how often. A high repeat rate may mean the tour, or the feature, is confusing.
- **Time:** how long each step and the whole tour took.
- **Sample data:** whether Fill example was used, and on the last step whether they discarded (Done) or saved for real.
- **Broken steps:** steps whose target was never found (shown centred) or skipped as optional. A spike usually means a DoorLoop release changed the page and the tour needs updating.

**Where it could show up**

- A per-tour report: runs, completion rate, the funnel by step, how people exited, repeat rate, average time.
- An alert when a step starts failing to find its target, so tours get fixed before many people notice.

**Notes on how it could fit the current setup**

- The engine already knows every moment worth counting: start, each step shown, Fill example, how the tour ended, and a step's target not found. It would report them as events, e.g. `tour_started`, `step_shown`, `sample_filled`, `tour_ended` (with how: done, close, stop, left page), `target_missing`.
- `TourLayer.init({ tours, onEvent })` could pass each event to whatever DoorLoop already uses for analytics. That way the engine doesn't need its own server, and the data sits with the rest of DoorLoop's product data.
- Knowing who ran a tour (for repeats) needs DoorLoop's own user id, which only works once tours run inside DoorLoop's app rather than the extension. Until then, a per-browser id would do for the proof of concept.
- Never send what people typed into forms. Only tour ids, step numbers, timings and how it ended.
- Sending data anywhere from the extension needs a destination DoorLoop controls and a security review. This is part of the "Path to production" list in the README.
