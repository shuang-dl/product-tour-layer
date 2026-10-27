# Summary

Where the product tour proof of concept stands, how it got here, and what's still open. For how to use it, see the [README](README.md).

**As of October 27, 2026:** extension 0.7.2, 5 tours for DoorLoop, 3 for the demo app, 89 automated checks, all passing.

## What it is

Guided product tours that run on top of DoorLoop without touching DoorLoop's code, built to show the dev team what DoorLoop could build in.

- **Tours are files.** One JSON file per tour in this GitHub repo. GitHub checks them and publishes them to GitHub Pages; nothing is hand-deployed.
- **An in-house Chrome extension runs them on DoorLoop.** It loads the published tours and highlights each step on the real app. No Intercom, no Tampermonkey, nothing loaded from outside servers. The one outside library, driver.js (MIT), is copied into the repo.
- **A demo app shows the built-in version.** A read-only, DoorLoop-style app with made-up data and the tour engine built into the page, with no extension. That's what DoorLoop would do in its own app.
- **A visual tour builder makes tours without writing JSON.** It works on the demo app or directly on top of live DoorLoop.

Links: [tours](https://shuang-dl.github.io/product-tour-layer/), [demo app](https://shuang-dl.github.io/product-tour-layer/demo/home), [builder](https://shuang-dl.github.io/product-tour-layer/builder-concept.html).

## How it got here

**October 23: the basics.**
- The tour engine, tour files, multi-page tours and optional steps.
- The Chrome extension, which replaced an early Tampermonkey loader so everything stays in-house.
- GitHub Actions to check tours and publish them, plus an automated extension test.
- The demo app, and a first clickable builder concept: storyboard, + Step, + Page, box tool for groups.
- The agreed step box style: coloured header and footer bands, white body, full-width images, one style per tour.

**October 26: building on real DoorLoop.**
- The builder gained **Test on: Live DoorLoop**, then **Build on: Live DoorLoop**: the builder opens on top of a real DoorLoop tab.
- Fixes found while building the *Add a new property* tour live:
  - picking an element no longer triggers it;
  - DoorLoop's dialogs no longer steal focus from the builder;
  - group highlights;
  - stable element labels.
- **Editing existing tours:** load a published or pasted tour, insert, reorder and delete steps.
- **Sample data:** a **Fill example** button types realistic values the way a person would. The last step can point at the save button without allowing a save (show only), and exit clicks leave the form without saving.
- **Save to GitHub** from the builder, signed in as yourself.
- The *Receive a payment* tour, added from the builder, which surfaced the dialog problems below.

**October 26–27: making it hold up inside DoorLoop's forms and dialogs** (listed under "What real DoorLoop taught us").
- **Quick wins borrowed from the NPS dashboard's tour:**
  - auto-start once per browser;
  - the step box kept on screen;
  - a progress bar;
  - "reduce motion" support.
- **Done on the last step always leaves the form.** A show-only last step now says what Done does, and lets people save their own data.

## What real DoorLoop taught us

Each of these was found by running a tour on DoorLoop. The engine and builder problems were copied onto the stand-in page the tests run against, then fixed. From the dropdown fixes on, each new check was also confirmed to fail without its fix. The rest were fixes to the tour files themselves.

| Problem on DoorLoop | Cause | Fix |
|---|---|---|
| Couldn't type into highlighted address fields | driver.js forced every element inside the highlight to take clicks, including the decorative outline DoorLoop draws over each input | The build removes that rule; the dimmed layer's shape blocks clicks outside the highlight instead |
| Country and State dropdowns couldn't be picked from | Dropdowns open outside the highlight, under the dimmed layer | Dropdowns are lifted above the dimmed layer |
| The highlight drifted off the address fields, or jumped to the corner of the page | The form added an error line, and re-rendered fields as new elements | A group highlight re-measures, and finds its items again, every quarter second |
| "Add another unit" step waited 8 seconds | That link only exists for multi-unit properties | The step is optional |
| Payment tour's lease and tenant lists "didn't show up" | The lift rule pushed lists *down* under DoorLoop's full-screen dialog | Dropdowns are only ever raised, never lowered |
| Fill example, Next and Done did nothing in the payment dialog | The dialog turns off clicks outside itself, including the step box | The step box always takes clicks, and its clicks don't count as "outside" for the dialog |
| Dropdown closed as soon as the next step appeared | driver.js moves focus to the step box, and DoorLoop's dropdowns close when their field loses focus | Focus stays put while someone is in a field |
| Clicking Receive payment in the menu didn't move the tour on | The item is listed twice; the tour highlighted the copy scrolled out of view | The tour uses the copy people can see |
| Nothing looked highlighted inside Create new or Receive payment | Those dialogs sit above the dimmed layer | The tour draws the dimming and highlight just above the dialog |
| Sample payment left in the dialog after the tour | The tour had no exit clicks, and not every wizard has Cancel | Done, or × after Fill example, clicks the exit clicks; otherwise it closes the dialog with its × and answers "Discard changes?". The builder suggests the × when recording sample data in a dialog |
| Done didn't close the wizard | Exit clicks only ran after Fill example | Done on the last step always leaves the form |
| Build failed: "Unexpected token 'B'" | The builder's screen text was copied into the tour file along with it | In the file view, select-all now selects only the file, notes sit outside it, and the build error explains what happened |
| Step 7 only worked for one lease | It pointed at one tenant by ID | It points at the tenant list again |

## Where things stand

**Works on DoorLoop, checked by playing the tours:**
- *Add a new property*: all 16 steps, with Fill example, the blocked Finish, and Done leaving without saving.
- *Receive a payment*: both dropdowns, Fill example, and Done discarding the payment through the dialog's × and Discard changes.
- No test data was saved in DoorLoop at any point.

**Pushed but not yet tried on DoorLoop:**
- the 0.7.x changes: auto-start, keeping the step box on screen, the progress bar, reduce motion;
- Done always leaving the form;
- the show-only last step's note, and its button saving when no sample data was used.

## Still open

- **driver.js: replace it or keep it.** Most of the fixes above work around it. Replacing it with our own spotlight (the same box-with-a-shadow approach the NPS tour uses) would remove the last outside code. That would settle the "in-house" question, and it's next to discuss.
- **The builder's Preview isn't the real engine.** It ignores show-only, exit clicks and other engine behaviour. Making it run the real engine would make Preview match the published tour. This is also the likeliest reason Create payment was clickable in one of your runs; in my run on 0.7.0 it stayed blocked.
- **A single highlighted item doesn't follow a menu that scrolls.** Groups already do.
- **Images uploaded in the builder aren't saved with the tour.** For now, an image needs an `https://` address.
- **Small tour details:**
  - *Add a new property* step 8 highlights only the checkbox, not its label.
  - "Use this address anyway" is blocked by the dimmed layer, so an address DoorLoop can't verify gets stuck at step 7. Fill example avoids this by picking a real suggestion.
- **Before production:**
  - hosting on a DoorLoop domain;
  - a security review;
  - targeting by role or plan;
  - "seen" state stored per user rather than per browser;
  - analytics;
  - a kill switch.
