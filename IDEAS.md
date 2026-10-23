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
- **Styling:** change the colours of the background, border, text block, and so on.
- **Text editing:** full text editing and formatting.

**Flow (draft)**

Clickable concept: [builder-concept.html](https://shuang-dl.github.io/product-tour-layer/builder-concept.html) (source: `site/builder-concept.html`).

1. **Create new tour** button opens a popup asking for the tour name and the page where the tour starts.
2. The same popup loads that page with the builder tools around it:
   - **Toolbox** on the side: pointer (click an element), box (draw around an area, snaps to the closest element), text formatting, colours.
   - **Storyboard** along the bottom: each step becomes a card, in order, showing the flow. Click a card to edit it; × removes it.
3. Selecting something opens the step box right next to it, looking like the final tour popup. You type the title and text there, format it, and add images.
4. Each step sets how the tour **continues**: a Next button, clicking the highlighted element, or typing text into it.
5. **Preview** plays the tour from the storyboard. **View tour file** shows the file it would publish.

**Notes on how it could fit the current setup**

- DoorLoop can't be shown inside another site, so the real builder can't be a popup on the links page showing live DoorLoop. It would open on top of the DoorLoop tab itself, through the extension. The concept uses a sample page instead.
- "Type text to continue" would be a new `advanceOn` option in the engine.

- The builder could produce the same tour files that live in `tours/` today. The engine and publishing wouldn't change.
- Picking an element would need to produce a target that survives DoorLoop releases. Prefer `data-cy`, `data-intercom-target` and `aria-label` over class names, as described under "Picking targets" in the README.
- Images, styling and formatted text would each need new fields in the tour format, plus checks in `scripts/build.mjs`. Formatted text must stay safe: allow a limited set of formatting, never raw HTML.
- The extension could host the builder, since it already runs on DoorLoop pages.
