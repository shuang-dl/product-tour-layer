// Product Tour Layer: runs guided tours on top of DoorLoop without changing DoorLoop's code.
// Load vendor/driver.js (JS + CSS) first, then: TourLayer.init({ tours, basePath? }).
(function () {
  'use strict';
  if (window.TourLayer) return;

  const STATE_KEY = 'tourLayer.state';
  const DRAFT_KEY = 'tourLayer.draft'; // a draft tour sent by the tour builder, kept across page loads
  const TARGET_TIMEOUT_MS = 8000;
  const OPTIONAL_TIMEOUT_MS = 1500;
  // The agreed step box look. A tour's "style" block overrides any of these.
  const DEFAULT_STYLE = {
    frame: '#0b1f44', bandText: '#ffffff', button: '#d8f34a', buttonText: '#0b1f44', bodyText: '#1b1d21', bodyBg: '#ffffff',
    headerHeight: 26, footerHeight: 48, sideBorder: 3, corners: 10,
    titleSize: 'h2', titleAlign: 'left', textAlign: 'left',
  };
  const POLL_MS = 250;
  const OVERLAY_OPACITY = 0.45;
  const STAGE_PADDING = 6;
  const STAGE_RADIUS = 8;
  const OVERLAY_Z = 10000; // driver.js draws its dimmed overlay at this z-index

  let tours = [];
  let driverObj = null;
  let runToken = 0; // bumped on every step change so stale async work can bail out
  let lastPath = location.pathname;
  let basePath = ''; // set when the app lives under a sub-path, e.g. "/product-tour-layer/demo"

  // Current path with basePath removed, so tours can say "/tenants" wherever the app is hosted.
  const currentPath = () =>
    (location.pathname.startsWith(basePath) ? location.pathname.slice(basePath.length) : location.pathname) || '/';

  // ---------- helpers ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Has a size and isn't clipped away by a collapsed parent (e.g. a closed side-menu section).
  // Clipping outside the nearest scroll container doesn't count: the element can be scrolled into view.
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    let checkX = true;
    let checkY = true;
    for (let p = el.parentElement; p && (checkX || checkY); p = p.parentElement) {
      const cs = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      if (checkY && clipY && (r.bottom <= pr.top || r.top >= pr.bottom)) return false;
      if (checkX && clipX && (r.right <= pr.left || r.left >= pr.right)) return false;
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') checkY = false;
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') checkX = false;
    }
    return true;
  };

  // Can be seen without scrolling anything: inside every scrolling or clipping area around it.
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) continue;
      const pr = p.getBoundingClientRect();
      if (r.bottom <= pr.top || r.top >= pr.bottom || r.right <= pr.left || r.left >= pr.right) return false;
    }
    return true;
  };
  // When a label matches more than one element (e.g. a menu item listed under Favorites and again in its section),
  // use the one people can see; otherwise the first one on the page, scrolled to when shown.
  const bestOf = (els) => {
    const shown = els.filter(isVisible);
    return shown.find(inView) || shown[0] || null;
  };

  // "/tenants" matches exactly; "*" matches one path segment, e.g. "/tenants/*".
  function pageMatches(pattern, path) {
    const escaped = pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('^' + escaped.join('[^/]+') + '/?$').test(path);
  }

  // A target is a CSS selector string, or { text, selector? } to match a visible element by its label.
  // A list of targets is a group: found only when every item is, highlighted as one area (see groupBox).
  function findTarget(target) {
    if (Array.isArray(target)) {
      const els = target.map(findTarget);
      return els.every(Boolean) ? els : null;
    }
    if (typeof target === 'string') return bestOf([...document.querySelectorAll(target)]);
    const want = target.text.trim().toLowerCase();
    const candidates = document.querySelectorAll(target.selector || 'button, a, [role="button"]');
    return bestOf([...candidates].filter((el) => el.innerText.trim().split('\n')[0].trim().toLowerCase() === want));
  }

  async function waitForTarget(target, token, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && token === runToken) {
      const el = findTarget(target);
      if (el) return el;
      await sleep(POLL_MS);
    }
    return null;
  }

  const loadState = () => {
    try {
      return JSON.parse(sessionStorage.getItem(STATE_KEY));
    } catch {
      return null;
    }
  };
  const saveState = (state) => sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  // Moving to a step keeps the note that this tour filled in sample data (see fillSample and endTour).
  const saveStep = (tour, step) => {
    const prev = loadState();
    saveState({ tourId: tour.id, step, ...(prev && prev.tourId === tour.id && prev.sampleUsed ? { sampleUsed: true } : {}) });
  };
  const clearState = () => sessionStorage.removeItem(STATE_KEY);
  const findTour = (id) => tours.find((t) => t.id === id);
  // A tour with autoStart opens by itself the first time someone visits its page; once it ends (Done or ×) this
  // browser remembers, and it only runs again from the launcher. Storage can be blocked; then it just shows again.
  const SEEN_KEY = (id) => `tourLayer.seen.${id}`;
  const seen = (id) => {
    try {
      return localStorage.getItem(SEEN_KEY(id)) === '1';
    } catch {
      return false;
    }
  };
  const markSeen = (id) => {
    try {
      localStorage.setItem(SEEN_KEY(id), '1');
    } catch {}
  };
  const loadDraft = () => {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY));
    } catch {
      return null;
    }
  };
  const isTarget = (t) => typeof t === 'string' || (t && typeof t.text === 'string');
  const isFill = (f) => f && isTarget(f.target) && (f.click === true || typeof f.value === 'string');
  // Draft tours come straight from the builder rather than from the checked tour files, so check the basics.
  const isTour = (t) =>
    t && typeof t.id === 'string' && typeof t.page === 'string' && Array.isArray(t.steps) && t.steps.length > 0 &&
    t.steps.every((s) =>
      s && typeof s.title === 'string' && typeof s.text === 'string' &&
      (s.target === undefined || isTarget(s.target) || (Array.isArray(s.target) && s.target.length > 0 && s.target.every(isTarget))) &&
      (s.image === undefined || /^(https:|data:image\/)/.test(s.image)) &&
      (s.fill === undefined || (Array.isArray(s.fill) && s.fill.every(isFill)))) &&
    (t.exitClicks === undefined || (Array.isArray(t.exitClicks) && t.exitClicks.every(isTarget)));

  // ---------- tour flow ----------

  // driver.js highlights one element, so a group gets an invisible box over the area around all its items,
  // kept in place while the page scrolls, resizes or shifts its layout (e.g. a form adds an error line).
  let group = null;
  function groupBox(els, target) {
    const box = el('div', { className: 'tour-layer-group' });
    const fit = () => {
      // The app may re-render an item as a new element; measure the new one, not the detached original.
      if (!els.every((e) => e.isConnected)) els = findTarget(target) || els;
      const rs = els.map((e) => e.getBoundingClientRect());
      const left = Math.min(...rs.map((r) => r.left));
      const top = Math.min(...rs.map((r) => r.top));
      const style = {
        left: left + 'px', top: top + 'px',
        width: Math.max(...rs.map((r) => r.right)) - left + 'px', height: Math.max(...rs.map((r) => r.bottom)) - top + 'px',
      };
      const moved = Object.keys(style).some((k) => box.style[k] !== style[k]);
      Object.assign(box.style, style);
      return moved;
    };
    const onMove = () => {
      if (fit() && driverObj) driverObj.refresh();
    };
    fit();
    document.body.append(box);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    const timer = setInterval(onMove, 250);
    group = {
      box,
      remove: () => {
        box.remove();
        clearInterval(timer);
        window.removeEventListener('scroll', onMove, true);
        window.removeEventListener('resize', onMove);
      },
    };
    return box;
  }

  // driver.js moves focus to the step box when a step shows, and back to where it was when the step ends. While
  // someone is in a field, that takes focus away from it, and dropdowns close when their field loses focus. So leave
  // focus where it is then: focus() does nothing while driver.js runs (it runs in this same script world).
  const inField = () => {
    const a = document.activeElement;
    return !!a && !a.closest('.driver-popover') &&
      a.matches('input, textarea, select, [contenteditable=""], [contenteditable=true], [role=combobox], [aria-expanded=true]');
  };
  function keepFocus() {
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function () {};
    return () => (HTMLElement.prototype.focus = focus);
  }

  // Dropdowns a highlighted field opens are mounted on <body>, outside the highlight, and can end up under the
  // overlay. Lift those above it, but never lower one that's already higher: a dropdown inside a full-screen dialog
  // (e.g. Receive payment, above the overlay) sits above that dialog and has to stay there.
  const POPUP = ':is([role=presentation], [data-radix-popper-content-wrapper]):has([role=listbox], [role=menu])';
  const ABOVE_OVERLAY = 10001;
  const lifted = new Set();
  function liftPopups() {
    if (!document.body.classList.contains('driver-active')) return;
    for (const node of document.body.children) {
      if (lifted.has(node) || !node.matches(POPUP)) continue;
      if (parseInt(getComputedStyle(node).zIndex, 10) >= ABOVE_OVERLAY) continue;
      node.style.setProperty('z-index', String(ABOVE_OVERLAY), 'important');
      lifted.add(node);
    }
  }
  let liftQueued = false;
  new MutationObserver(() => {
    if (liftQueued) return;
    liftQueued = true;
    requestAnimationFrame(() => { liftQueued = false; liftPopups(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // App dialogs can sit above driver.js's overlay (DoorLoop's Create new and Receive payment are at z-index 1000000),
  // so the dimming and the clear ring around the target end up underneath the dialog and nothing looks highlighted.
  // Then draw both just above that dialog instead: a ring whose huge shadow dims everything else. It takes no clicks,
  // and the dialog's own dropdowns (a step higher) still show on top. driver.js's dimming is hidden so the page
  // isn't darkened twice; its overlay still blocks clicks outside the highlight.
  let ring = null;
  function layerAbove(el) {
    let z = null;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const v = parseInt(getComputedStyle(e).zIndex, 10);
      if (!Number.isNaN(v)) z = v; // the outermost one decides where the whole layer sits
    }
    return z !== null && z > OVERLAY_Z ? z : null;
  }
  function ringOver(anchor, target) {
    const z = layerAbove(Array.isArray(target) ? target[0] : target);
    if (z === null) return;
    const box = el('div', { className: 'tour-layer-ring' });
    box.style.zIndex = String(z + 1);
    const fit = () => {
      const r = anchor.getBoundingClientRect();
      Object.assign(box.style, {
        left: r.left - STAGE_PADDING + 'px', top: r.top - STAGE_PADDING + 'px',
        width: r.width + STAGE_PADDING * 2 + 'px', height: r.height + STAGE_PADDING * 2 + 'px',
      });
    };
    fit();
    document.body.append(box);
    document.body.classList.add('tour-layer-ringed');
    const timer = setInterval(fit, 100);
    ring = () => {
      clearInterval(timer);
      box.remove();
      document.body.classList.remove('tour-layer-ringed');
    };
  }

  // driver.js places the step box beside its target, which can run past the window's edge (e.g. on a zoomed-out
  // page). Nudge it back inside, and hide its arrow then, since it no longer lines up with the target.
  let screenTimer = null;
  function keepOnScreen() {
    const box = document.querySelector('.driver-popover.tour-layer-popover');
    if (!box) return;
    const r = box.getBoundingClientRect();
    const m = 8;
    const dx = r.left < m ? m - r.left : r.right > innerWidth - m ? innerWidth - m - r.right : 0;
    const dy = r.top < m ? m - r.top : r.bottom > innerHeight - m ? innerHeight - m - r.bottom : 0;
    if (!dx && !dy) return;
    // The current nudge, e.g. "12px 4px"; the browser shortens "12px 0px" to "12px".
    const [x = 0, y = 0] = (box.style.translate || '').split(' ').map((v) => parseFloat(v) || 0);
    box.style.translate = `${x + dx}px ${y + dy}px`;
    box.querySelector('.driver-popover-arrow')?.style.setProperty('display', 'none');
  }

  function destroyDriver() {
    clearInterval(screenTimer);
    screenTimer = null;
    ring?.();
    ring = null;
    group?.remove();
    group = null;
    stopBlocking?.();
    stopBlocking = null;
    if (!driverObj) return;
    const restore = inField() ? keepFocus() : null;
    try {
      driverObj.destroy();
    } finally {
      restore?.();
    }
    driverObj = null;
  }

  // finished: ended with Done on the last step, rather than × or Stop tour.
  function endTour(finished = false) {
    runToken++;
    const state = loadState();
    const tour = state && findTour(state.tourId);
    if (tour) markSeen(tour.id);
    // Leave the form the tour went through, without saving, once the highlight is gone: always after Done, and after
    // × only if the tour typed sample data (closing early must not throw away what someone typed themselves).
    if (tour && (finished || state.sampleUsed)) setTimeout(() => leaveForm(tour), 0);
    else sampleDialog = stepDialog = null;
    const draft = loadDraft();
    if (draft && state && state.tourId === draft.id) {
      sessionStorage.removeItem(DRAFT_KEY);
      tours = tours.filter((t) => t.id !== draft.id);
    }
    clearState();
    destroyDriver();
    lifted.forEach((node) => node.style.removeProperty('z-index'));
    lifted.clear();
    renderLauncher();
  }

  // direction: +1 or -1, so a skipped optional step keeps moving the same way.
  async function goTo(tour, index, direction = 1) {
    if (index < 0) return;
    if (index >= tour.steps.length) return endTour(true);
    const token = ++runToken;
    saveStep(tour, index);
    removeLauncher();

    // Clear the previous highlight first: driver.js styles the highlighted element's parent
    // (overflow: hidden), which can hide the next step's target from findTarget.
    destroyDriver();
    const step = tour.steps[index];
    if (step.page && !pageMatches(step.page, currentPath())) {
      // Wrong page for this step: pause until the route watcher sees the right one.
      renderLauncher();
      return;
    }
    const timeout = step.optional ? OPTIONAL_TIMEOUT_MS : TARGET_TIMEOUT_MS;
    const el = step.target ? await waitForTarget(step.target, token, timeout) : null;
    if (token !== runToken) return;
    if (step.target && !el && step.optional) return goTo(tour, index + direction, direction);
    if (step.target && !el) {
      console.warn(`[TourLayer] ${tour.id} step ${index + 1}: target not found, showing it unanchored`, step.target);
    }
    showStep(tour, index, el);
  }

  function showStep(tour, index, el) {
    const step = tour.steps[index];
    const total = tour.steps.length;
    const clickToAdvance = step.advanceOn === 'click' && el;
    const prev = tour.steps[index - 1];
    const canGoBack = prev && (!prev.page || pageMatches(prev.page, currentPath()));

    const buttons = [];
    if (canGoBack) buttons.push('previous');
    if (!clickToAdvance) buttons.push('next');
    buttons.push('close');

    destroyDriver();
    if (Array.isArray(el)) el[0].scrollIntoView({ block: 'center' });
    const anchor = Array.isArray(el) ? groupBox(el, step.target) : el;
    driverObj = window.driver.js.driver({
      // Only the × ends a tour (onCloseClick below). Escape and clicks on the dimmed page are too easy to do by
      // accident in the middle of a form, e.g. Escape to close an address dropdown.
      allowClose: false,
      allowKeyboardControl: false,
      animate: !matchMedia('(prefers-reduced-motion: reduce)').matches, // the highlight jumps instead of gliding
      overlayOpacity: OVERLAY_OPACITY,
      stagePadding: STAGE_PADDING,
      stageRadius: STAGE_RADIUS,
      popoverClass: 'tour-layer-popover',
    });
    driverObj.highlight({
      element: anchor || undefined,
      popover: {
        title: escapeHtml(step.title),
        description: escapeHtml(step.text),
        showButtons: buttons,
        showProgress: true,
        progressText: `Step ${index + 1} of ${total}`,
        nextBtnText: index === total - 1 ? 'Done' : 'Next',
        prevBtnText: 'Back',
        onNextClick: () => goTo(tour, index + 1),
        onPrevClick: () => goTo(tour, index - 1, -1),
        onCloseClick: () => endTour(),
        onPopoverRender: (popover) => {
          renderStepBox(popover, tour, step, clickToAdvance, (index + 1) / total);
          // driver.js focuses the step box right after this returns; skip that while someone is in a field.
          if (inField()) queueMicrotask(keepFocus());
        },
      },
    });

    if (el) stepDialog = (Array.isArray(el) ? el[0] : el).closest('[role=dialog]') || stepDialog;
    if (anchor) ringOver(anchor, el);
    screenTimer = setInterval(keepOnScreen, 200);
    if (step.showOnly && el) stopBlocking = blockClicks(step.target);

    if (clickToAdvance) {
      const token = runToken;
      const onClick = () => {
        if (token !== runToken) return;
        runToken++; // a group has several listeners; only the first click counts
        destroyDriver();
        saveStep(tour, index + 1);
        // Let the click do its thing (navigate, open a dialog) before looking for the next target.
        setTimeout(() => goTo(tour, index + 1), 300);
      };
      for (const target of Array.isArray(el) ? el : [el]) target.addEventListener('click', onClick, { once: true, capture: true });
    }
  }

  // A "show only" step points at something (e.g. Finish) without letting it be used. The overlay already blocks the
  // rest of the page; this blocks presses and Enter/Space on the highlighted element itself.
  let stopBlocking = null;
  function blockClicks(target) {
    const block = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      const found = findTarget(target);
      if (!found || !(Array.isArray(found) ? found : [found]).some((t) => t.contains(e.target))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart', 'keydown'];
    types.forEach((t) => window.addEventListener(t, block, true));
    return () => types.forEach((t) => window.removeEventListener(t, block, true));
  }

  // ---------- sample data ----------

  // A full press, for apps that act on mouse-down (DoorLoop's menus) as well as on click.
  function press(target) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      target.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, view: window }));
    }
    target.click();
  }
  const normal = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  async function waitFor(find, ms) {
    for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(100)) {
      const found = find();
      if (found) return found;
    }
    return null;
  }

  // Types a value the way a person would, so frameworks like React see the change, then picks a suggestion if asked.
  async function fillItem(item) {
    const target = await waitFor(() => findTarget(item.target), 3000);
    if (!target) return false;
    if (item.click) {
      // A wrapper around a checkbox or radio (e.g. a labelled field): the click has to reach the control itself.
      const control = target.matches('input, button, a, [role=button], [role=option], [role=radio], [role=checkbox]')
        ? target : target.querySelector('input[type=checkbox], input[type=radio]') || target;
      press(control);
      return true;
    }
    const field = target.matches('input, textarea') ? target : target.querySelector('input:not([type=hidden]), textarea');
    if (!field) return false;
    field.focus();
    field.select();
    if (!document.execCommand('insertText', false, item.value) || field.value !== item.value) {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, item.value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (!item.pick) return true;
    const want = normal(item.pick);
    const option = await waitFor(() => [...document.querySelectorAll('[role=option]')].find((o) => isVisible(o) && normal(o.textContent) === want), 5000);
    if (option) press(option);
    return !!option;
  }

  let sampleDialog = null; // the app dialog the sample data went into, if any (see leaveForm)
  let stepDialog = null; // the app dialog the latest step's target is in, if any
  async function fillSample(tour, step, button) {
    const token = runToken;
    const first = findTarget(step.fill[0].target);
    sampleDialog = (Array.isArray(first) ? first[0] : first)?.closest('[role=dialog]') || sampleDialog;
    const prev = loadState();
    saveState({ ...prev, sampleUsed: true });
    button.disabled = true;
    button.textContent = 'Filling…';
    const ok = await fillAll(step.fill, () => token === runToken);
    if (token === runToken) button.textContent = ok ? 'Filled' : 'Partly filled';
  }
  async function fillAll(items, stillOn = () => true) {
    let ok = true;
    for (const item of items) {
      if (!stillOn()) break;
      ok = (await fillItem(item)) && ok;
      await sleep(150);
    }
    return ok;
  }

  // Returns false if a target never showed up.
  async function clickInOrder(targets) {
    for (const target of targets) {
      const found = await waitFor(() => findTarget(target), 3000);
      if (!found) {
        console.warn('[TourLayer] exit click target not found', target);
        return false;
      }
      press(Array.isArray(found) ? found[0] : found);
      await sleep(400);
    }
    return true;
  }

  // Leave the form without saving: the tour's exit clicks; if it has none, or one isn't there, the close button (×) of
  // the dialog the sample data went into (or else the one the tour was in). Then, if the app asks "Discard your
  // changes?", discard.
  const CLOSE_BUTTON = "[data-slot$='dialog-close'], button[aria-label='Close' i]";
  const DISCARD = /^(discard|leave|close without saving|don't save|yes, discard)\b/i;
  async function leaveForm(tour) {
    const dialog = [sampleDialog, stepDialog].find((d) => d && d.isConnected);
    sampleDialog = stepDialog = null;
    const done = tour.exitClicks ? await clickInOrder(tour.exitClicks) : false;
    if (!done && dialog) {
      const close = [...dialog.querySelectorAll(CLOSE_BUTTON)].find(isVisible);
      if (close) press(close);
    }
    const before = dialog;
    // A confirmation the app opened just now (not the form's own dialog): press its discard button.
    const discard = await waitFor(() => [...document.querySelectorAll('[role=alertdialog], [role=dialog]')]
      .filter((d) => d !== before && !d.closest('.driver-popover'))
      .flatMap((d) => [...d.querySelectorAll('button')])
      .find((b) => isVisible(b) && DISCARD.test(b.innerText.trim())), 1500);
    if (discard) press(discard);
  }

  // Rebuild driver.js's popover into the step box: a header band (step count, close), a body
  // (full-width image, heading title, text) and a footer band (Back, Next or a hint).
  // driver.js's own button classes are kept, so its click handling still works.
  function renderStepBox(p, tour, step, clickToAdvance, progress) {
    const s = Object.assign({}, DEFAULT_STYLE, tour.style);
    const vars = {
      '--tl-frame': s.frame, '--tl-band-text': s.bandText, '--tl-button': s.button, '--tl-button-text': s.buttonText,
      '--tl-body-text': s.bodyText, '--tl-body-bg': s.bodyBg, '--tl-header-h': s.headerHeight + 'px',
      '--tl-footer-h': s.footerHeight + 'px', '--tl-side': s.sideBorder + 'px', '--tl-corners': s.corners + 'px',
      '--tl-title-align': s.titleAlign, '--tl-text-align': s.textAlign,
    };
    for (const [k, v] of Object.entries(vars)) p.wrapper.style.setProperty(k, v);
    // The step box lives outside the app's dialogs. Keep its presses and focus changes from reaching the app, or an
    // open modal dialog (e.g. Receive payment) treats them as "outside" and closes or pulls focus back.
    if (!p.wrapper.dataset.tlIsolated) {
      p.wrapper.dataset.tlIsolated = '1';
      for (const type of ['pointerdown', 'mousedown', 'touchstart', 'focusin', 'focusout']) p.wrapper.addEventListener(type, (e) => e.stopPropagation());
    }

    const title = document.createElement(s.titleSize);
    title.id = 'driver-popover-title';
    title.className = 'driver-popover-title tl-title';
    title.textContent = step.title;
    const body = el('div', { className: 'tl-body' });
    if (step.image) body.append(el('img', { className: 'tl-img', src: step.image, alt: '' }));
    body.append(el('div', { className: 'tl-pad' }, [title, p.description]));

    const right = clickToAdvance ? el('span', { className: 'tl-hint', textContent: 'Click the highlighted item' }) : p.nextButton;
    const fill = step.fill ? [el('button', { className: 'tl-fill', textContent: 'Fill example', onclick: (e) => fillSample(tour, step, e.currentTarget) })] : [];
    p.footer.replaceChildren(p.previousButton, ...fill, right);
    const bar = el('span', { className: 'tl-bar' }, [el('span', { style: `width: ${Math.round(progress * 100)}%` })]);
    p.wrapper.replaceChildren(p.arrow, el('div', { className: 'tl-head' }, [p.progress, bar, p.closeButton]), body, p.footer);
  }

  function onRoute() {
    const state = loadState();
    const tour = state && findTour(state.tourId);
    const step = tour && tour.steps[state.step];
    if (step) {
      if (!step.page || pageMatches(step.page, currentPath())) {
        if (!driverObj) goTo(tour, state.step);
        return;
      }
      destroyDriver(); // navigated away mid-tour: pause, launcher offers Resume
    }
    // Not while the tour builder is open on this page (it keeps its draft under this key).
    const auto = !step && !driverObj && !sessionStorage.getItem('tourLayer.builder') &&
      tours.find((t) => t.autoStart && pageMatches(t.page, currentPath()) && !seen(t.id));
    if (auto) return goTo(auto, 0);
    renderLauncher();
  }

  // ---------- launcher ----------

  const STYLE = `
    .tour-layer-launcher { position: fixed; right: 24px; bottom: 24px; z-index: 9999; font: 14px/1.4 system-ui, sans-serif; }
    .tour-layer-launcher > button { background: #1665d8; color: #fff; border: 0; border-radius: 20px; padding: 10px 16px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.2); font: inherit; font-weight: 600; }
    .tour-layer-panel { position: absolute; right: 0; bottom: 48px; width: 280px; background: #fff; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.2); padding: 8px; }
    .tour-layer-panel button { display: block; width: 100%; text-align: left; background: none; border: 0; border-radius: 6px; padding: 8px 10px; cursor: pointer; font: inherit; color: #1a1a1a; }
    .tour-layer-panel button:hover { background: #f0f4fb; }
    .tour-layer-panel small { display: block; color: #666; }
    .tour-layer-panel .tour-layer-heading { padding: 6px 10px; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    /* A modal dialog turns off clicks outside itself (pointer-events: none on <body>); the step box must stay usable. */
    .driver-popover.tour-layer-popover { pointer-events: auto; }
    .driver-popover.tour-layer-popover { padding: 0; min-width: min(300px, calc(100vw - 16px)); max-width: min(340px, calc(100vw - 16px)); border-radius: var(--tl-corners); background: var(--tl-frame); color: var(--tl-body-text); box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    .tour-layer-popover .tl-head, .tour-layer-popover .driver-popover-footer { display: flex; align-items: center; justify-content: space-between; margin: 0; color: var(--tl-band-text); }
    .tour-layer-popover .tl-head { height: var(--tl-header-h); padding: 0 6px 0 10px; border-radius: var(--tl-corners) var(--tl-corners) 0 0; }
    .tour-layer-popover .driver-popover-progress-text { color: inherit; font-size: 12px; white-space: nowrap; }
    .tour-layer-popover .tl-bar { flex: 1; height: 4px; margin: 0 10px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--tl-band-text) 25%, transparent); }
    .tour-layer-popover .tl-bar > span { display: block; height: 100%; background: var(--tl-button); }
    .tour-layer-popover .driver-popover-close-btn { position: static; width: auto; height: auto; padding: 0 4px; color: inherit; font-size: 18px; line-height: 1; opacity: .85; }
    .tour-layer-popover .driver-popover-close-btn:hover, .tour-layer-popover .driver-popover-close-btn:focus { color: inherit; opacity: 1; }
    .tour-layer-popover .tl-body { margin: 0 var(--tl-side); background: var(--tl-body-bg); color: var(--tl-body-text); }
    .tour-layer-popover .tl-img { display: block; width: 100%; max-height: 180px; object-fit: cover; }
    .tour-layer-popover .tl-pad { padding: 14px 16px 16px; }
    .tour-layer-popover .tl-title { display: block; margin: 0 0 6px; font-weight: 600; line-height: 1.25; text-align: var(--tl-title-align); color: inherit; }
    .tour-layer-popover h1.tl-title { font-size: 22px; } .tour-layer-popover h2.tl-title { font-size: 18px; } .tour-layer-popover h3.tl-title { font-size: 16px; }
    .tour-layer-popover .driver-popover-description { margin: 0; font-size: 14px; line-height: 1.5; text-align: var(--tl-text-align); color: inherit; }
    .tour-layer-popover .driver-popover-footer { height: var(--tl-footer-h); padding: 0 10px 0 12px; gap: 8px; border-radius: 0 0 var(--tl-corners) var(--tl-corners); }
    .tour-layer-popover .driver-popover-footer button { text-shadow: none; border: 0; font-size: 13px; }
    .tour-layer-popover .driver-popover-prev-btn, .tour-layer-popover .driver-popover-prev-btn:hover, .tour-layer-popover .driver-popover-prev-btn:focus { background: none; color: inherit; padding: 2px 4px; }
    .tour-layer-popover .driver-popover-next-btn, .tour-layer-popover .driver-popover-next-btn:hover, .tour-layer-popover .driver-popover-next-btn:focus {
      margin-left: auto; background: var(--tl-button); color: var(--tl-button-text); font-weight: 600; border-radius: 6px;
      padding: max(4px, calc((var(--tl-footer-h) - 22px) / 2.6)) calc(max(4px, calc((var(--tl-footer-h) - 22px) / 2.6)) + 10px); }
    .tour-layer-popover .driver-popover-next-btn:hover { filter: brightness(.95); }
    .tour-layer-group { position: fixed; pointer-events: none; }
    .tour-layer-ring { position: fixed; pointer-events: none; border-radius: ${STAGE_RADIUS}px; box-shadow: 0 0 0 200vmax rgba(0, 0, 0, ${OVERLAY_OPACITY}); }
    .tour-layer-ringed .driver-overlay { opacity: 0 !important; }
    .tour-layer-popover .driver-popover-footer .tl-fill { margin-left: auto; background: none; color: inherit; border: 1px solid currentColor; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
    .tour-layer-popover .driver-popover-footer .tl-fill:disabled { opacity: .7; cursor: default; }
    .tour-layer-popover .tl-fill + .driver-popover-next-btn, .tour-layer-popover .tl-fill + .tl-hint { margin-left: 0; }
    .tour-layer-popover .tl-hint { margin-left: auto; font-size: 12px; font-style: italic; }
    .tour-layer-popover .driver-popover-arrow { border-color: transparent; }
    .tour-layer-popover .driver-popover-arrow-side-left { border-left-color: var(--tl-frame); }
    .tour-layer-popover .driver-popover-arrow-side-right { border-right-color: var(--tl-frame); }
    .tour-layer-popover .driver-popover-arrow-side-top { border-top-color: var(--tl-frame); }
    .tour-layer-popover .driver-popover-arrow-side-bottom { border-bottom-color: var(--tl-frame); }
  `;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    (children || []).forEach((c) => node.append(c));
    return node;
  }

  function removeLauncher() {
    document.querySelector('.tour-layer-launcher')?.remove();
  }

  function renderLauncher() {
    removeLauncher();
    if (driverObj) return;
    const state = loadState();
    const paused = state && findTour(state.tourId);
    const here = tours.filter((t) => pageMatches(t.page, currentPath()));
    if (!paused && !here.length) return;

    const item = (title, sub, onClick) =>
      el('button', { onclick: onClick }, [title, ...(sub ? [el('small', { textContent: sub })] : [])]);

    const panel = el('div', { className: 'tour-layer-panel', hidden: true });
    if (paused) {
      panel.append(
        el('div', { className: 'tour-layer-heading', textContent: 'In progress' }),
        item(`Resume: ${paused.title}`, `Step ${state.step + 1} of ${paused.steps.length}`, () => {
          const page = paused.steps[state.step].page;
          if (!page || pageMatches(page, currentPath())) return goTo(paused, state.step);
          // Reloads the app on the step's page; the saved state picks the tour back up.
          if (page.includes('*')) {
            saveState({ tourId: paused.id, step: 0 });
            location.assign(basePath + paused.page);
          } else {
            location.assign(basePath + page);
          }
        }),
        item('Stop tour', null, () => endTour())
      );
    }
    if (here.length) {
      panel.append(el('div', { className: 'tour-layer-heading', textContent: 'Tours for this page' }));
      here.forEach((t) => panel.append(item(t.title, t.description, () => goTo(t, 0))));
    }

    const toggle = el('button', {
      textContent: paused ? 'Tour paused' : `Tours (${here.length})`,
      onclick: () => (panel.hidden = !panel.hidden),
    });
    document.body.append(el('div', { className: 'tour-layer-launcher' }, [panel, toggle]));
  }

  // ---------- public API ----------

  function init(options) {
    if (!(window.driver && window.driver.js)) throw new Error('[TourLayer] load vendor/driver.js before tour-layer.js');
    tours = options.tours;
    basePath = options.basePath || '';
    const draft = loadDraft();
    if (isTour(draft)) tours = [...tours.filter((t) => t.id !== draft.id), draft];
    document.head.append(el('style', { textContent: STYLE }));

    const params = new URLSearchParams(location.search);
    const requested = params.get('tour');
    if (requested) {
      // Drop ?tour= so a refresh doesn't restart the tour.
      params.delete('tour');
      const qs = params.toString();
      history.replaceState(history.state, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    }
    if (requested && findTour(requested)) {
      goTo(findTour(requested), 0);
    } else {
      if (requested) console.warn(`[TourLayer] no tour with id "${requested}"`);
      onRoute();
    }

    // SPA navigation doesn't reload the page, so watch the path.
    setInterval(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      onRoute();
    }, 500);
  }

  function start(id) {
    const tour = findTour(id);
    if (!tour) return console.warn(`[TourLayer] no tour with id "${id}"`);
    goTo(tour, 0);
  }

  // Run a tour that isn't in the published list (a draft from the tour builder).
  function run(tour) {
    if (!isTour(tour)) return console.warn('[TourLayer] ignored a draft tour with missing fields', tour);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(tour));
    tours = [...tours.filter((t) => t.id !== tour.id), tour];
    goTo(tour, 0);
  }

  window.TourLayer = {
    init,
    start,
    run,
    stop: () => endTour(),
    fill: (items) => fillAll(items), // the tour builder's preview uses it for a step's sample data
    get tours() {
      return tours;
    },
  };
})();
