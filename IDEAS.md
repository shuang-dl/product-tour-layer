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

**Notes on how it could fit the current setup**

- The builder could produce the same tour files that live in `tours/` today. The engine and publishing wouldn't change.
- Picking an element would need to produce a target that survives DoorLoop releases. Prefer `data-cy`, `data-intercom-target` and `aria-label` over class names, as described under "Picking targets" in the README.
- Images, styling and formatted text would each need new fields in the tour format, plus checks in `scripts/build.mjs`. Formatted text must stay safe: allow a limited set of formatting, never raw HTML.
- The extension could host the builder, since it already runs on DoorLoop pages.
