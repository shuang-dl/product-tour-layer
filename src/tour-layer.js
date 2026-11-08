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
    footerHeight: 56, // headerHeight, sideBorder and corners are accepted in older tour files but no longer used
    titleSize: 'h2', titleAlign: 'left', textAlign: 'left',
  };
  const POLL_MS = 250;
  const POINTER_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563z"/></svg>'; // Tabler "pointer" icon (MIT)
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
  // clues (optional, one per group item): what the element looked like when the step was made. When the target no
  // longer matches anything (e.g. a DoorLoop release renamed a data-cy), the element that best fits them is used.
  function findTarget(target, clues) {
    if (Array.isArray(target)) {
      const els = target.map((t, i) => findTarget(t, Array.isArray(clues) ? clues[i] : null));
      return els.every(Boolean) ? els : null;
    }
    return findByTarget(target) || (clues && !Array.isArray(clues) ? findByClues(clues) : null);
  }
  function findByTarget(target) {
    if (typeof target === 'string') return bestOf([...document.querySelectorAll(target)]);
    const want = target.text.trim().toLowerCase();
    const candidates = document.querySelectorAll(target.selector || 'button, a, [role="button"]');
    return bestOf([...candidates].filter((el) => el.innerText.trim().split('\n')[0].trim().toLowerCase() === want));
  }

  // Scoring by clues, after Mimik's Guide Me finder: each clue that's present counts for its share of the weights,
  // text most. Role alone can't identify anything, so at least one identifying clue has to match.
  const CLUE_WEIGHTS = { text: 0.35, aria: 0.2, name: 0.15, placeholder: 0.1, href: 0.1, role: 0.1 };
  const CLUE_THRESHOLD = 0.6;
  const tidy = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const firstLine = (el) => tidy((el.innerText || '').split('\n').find((l) => l.trim()) || '').slice(0, 80);
  const clueOf = {
    text: firstLine,
    aria: (el) => el.getAttribute('aria-label'),
    name: (el) => el.getAttribute('name'),
    placeholder: (el) => el.getAttribute('placeholder'),
    role: (el) => el.getAttribute('role') || el.tagName.toLowerCase(),
    href: (el) => (el instanceof HTMLAnchorElement ? el.pathname : null),
  };
  function compareClue(want, got) {
    if (!got) return 0;
    if (want === got) return 1;
    const a = tidy(want).toLowerCase();
    const b = tidy(got).toLowerCase();
    if (a === b) return 0.8;
    // One starts with the other, and the shorter is most of it ("Save" vs "Save changes", not "A" vs "Archive").
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    return short.length >= 3 && short.length / long.length >= 0.6 && long.startsWith(short) ? 0.6 : 0;
  }
  function findByClues(clues) {
    const present = Object.keys(CLUE_WEIGHTS).filter((k) => clues[k]);
    const total = present.reduce((sum, k) => sum + CLUE_WEIGHTS[k], 0);
    if (!present.some((k) => k !== 'role')) return null;
    let best = [];
    let bestScore = 0;
    for (const el of document.querySelectorAll(clues.tag || '*')) {
      if (el.closest('.driver-popover, #tour-layer-builder') || !isVisible(el)) continue;
      let score = 0;
      let identified = false;
      for (const k of present) {
        const s = compareClue(clues[k], clueOf[k](el));
        if (s && k !== 'role') identified = true;
        score += (s * CLUE_WEIGHTS[k]) / total;
      }
      if (!identified || score < CLUE_THRESHOLD || score < bestScore) continue;
      if (score > bestScore) best = [];
      best.push(el);
      bestScore = score;
    }
    return bestOf(best);
  }

  // Clues only after the target has had a moment to appear, so a lookalike isn't picked while the page still loads.
  const CLUES_AFTER_MS = 1500;
  async function waitForTarget(target, token, timeout, clues) {
    const start = Date.now();
    const deadline = start + timeout;
    while (Date.now() < deadline && token === runToken) {
      const el = findTarget(target, Date.now() - start >= Math.min(CLUES_AFTER_MS, timeout / 2) ? clues : null);
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
  const isClues = (c) => c && typeof c === 'object' && !Array.isArray(c);
  // Draft tours come straight from the builder rather than from the checked tour files, so check the basics.
  const isTour = (t) =>
    t && typeof t.id === 'string' && typeof t.page === 'string' && Array.isArray(t.steps) && t.steps.length > 0 &&
    t.steps.every((s) =>
      s && typeof s.title === 'string' && typeof s.text === 'string' &&
      (s.target === undefined || isTarget(s.target) || (Array.isArray(s.target) && s.target.length > 0 && s.target.every(isTarget))) &&
      (s.image === undefined || /^(https:|data:image\/)/.test(s.image)) &&
      (s.fill === undefined || (Array.isArray(s.fill) && s.fill.every(isFill))) &&
      (s.clues === undefined || isClues(s.clues) || (Array.isArray(s.clues) && s.clues.every((c) => c === null || isClues(c))))) &&
    (t.exitClicks === undefined || (Array.isArray(t.exitClicks) && t.exitClicks.every(isTarget)));

  // ---------- tour flow ----------

  // driver.js highlights one element, so a group gets an invisible box over the area around all its items,
  // kept in place while the page scrolls, resizes or shifts its layout (e.g. a form adds an error line).
  let group = null;
  function groupBox(els, target, clues) {
    const box = el('div', { className: 'tour-layer-group' });
    const fit = () => {
      // The app may re-render an item as a new element; measure the new one, not the detached original.
      if (!els.every((e) => e.isConnected)) els = findTarget(target, clues) || els;
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

  // The step box goes beside the highlighted area, never over it: the step's "placement" side (right, left,
  // bottom or top) when the box fits there, otherwise the first side with room (right, bottom, left, top), and
  // when none has room, the side with the most. It's also kept inside the window. driver.js places the box first;
  // this moves it (with "translate") and keeps it placed as the page moves. Its arrow is hidden once it's moved.
  const GAP = 12;
  const SIDES = ['right', 'bottom', 'left', 'top'];
  let placing = null; // { anchor, placement } for the step showing
  let screenTimer = null;
  function placeBox() {
    const box = document.querySelector('.driver-popover.tour-layer-popover');
    if (!box) return;
    const [x0 = 0, y0 = 0] = (box.style.translate || '').split(' ').map((v) => parseFloat(v) || 0);
    const b = box.getBoundingClientRect();
    const w = b.width, h = b.height, m = 8;
    let left = b.left, top = b.top;
    const a = placing && placing.anchor && placing.anchor.isConnected && placing.anchor.getBoundingClientRect();
    if (a && (a.width || a.height)) {
      const r = { left: a.left - STAGE_PADDING, top: a.top - STAGE_PADDING, right: a.right + STAGE_PADDING, bottom: a.bottom + STAGE_PADDING };
      const room = { right: innerWidth - m - r.right - GAP, left: r.left - GAP - m, bottom: innerHeight - m - r.bottom - GAP, top: r.top - GAP - m };
      const need = (side) => (side === 'left' || side === 'right' ? w : h);
      const fits = (side) => room[side] >= need(side);
      const wanted = SIDES.includes(placing.placement) ? placing.placement : null;
      const side = (wanted && fits(wanted) ? wanted : null) || SIDES.find(fits) ||
        SIDES.reduce((best, x) => (room[x] / need(x) > room[best] / need(best) ? x : best));
      const midX = (r.left + r.right - w) / 2, midY = (r.top + r.bottom - h) / 2;
      if (side === 'right') [left, top] = [r.right + GAP, midY];
      else if (side === 'left') [left, top] = [r.left - GAP - w, midY];
      else if (side === 'bottom') [left, top] = [midX, r.bottom + GAP];
      else [left, top] = [midX, r.top - GAP - h];
    }
    left = Math.max(m, Math.min(left, innerWidth - m - w));
    top = Math.max(m, Math.min(top, innerHeight - m - h));
    const dx = Math.round(left - (b.left - x0)), dy = Math.round(top - (b.top - y0));
    if (Math.abs(dx - x0) < 1 && Math.abs(dy - y0) < 1) return;
    box.style.translate = dx || dy ? `${dx}px ${dy}px` : '';
    box.querySelector('.driver-popover-arrow')?.style.setProperty('display', dx || dy ? 'none' : '');
  }

  function destroyDriver() {
    clearInterval(screenTimer);
    screenTimer = null;
    placing = null;
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
  // The tour announces each step and its end as window events (tourlayer:step, tourlayer:end), for exporting a
  // recording (src/export.js) and, later, reporting.
  const announce = (type, detail) => dispatchEvent(new CustomEvent(`tourlayer:${type}`, { detail }));

  function endTour(finished = false) {
    runToken++;
    const state = loadState();
    const tour = state && findTour(state.tourId);
    if (tour) announce('end', { tourId: tour.id, step: state.step, finished });
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
    const el = step.target ? await waitForTarget(step.target, token, timeout, step.clues) : null;
    if (token !== runToken) return;
    if (step.target && !el && step.optional) return goTo(tour, index + direction, direction);
    if (el && step.clues && !findTarget(step.target)) {
      console.warn(`[TourLayer] ${tour.id} step ${index + 1}: target no longer matches; found the element by its clues instead. Update the step's target.`, step.target);
    }
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

    // The last step pointing at the save button (show only): with sample data typed in, the button stays blocked and
    // Done discards it. Without, it's the person's own data, so the button works: it saves and ends the tour.
    const last = index === total - 1;
    const sampleUsed = !!(loadState() || {}).sampleUsed;
    const target = Array.isArray(el) ? el[0] : el;
    const saveLabel = target && target.innerText.trim().split('\n')[0];
    // Only a button (or a wrapper around one button) can save. A show-only panel, e.g. account details, gets no
    // "click … to save it" note and stays unclickable.
    const ACTION = 'button, a[href], [role=button], [role=menuitem], input[type=submit], input[type=button]';
    const isAction = !!target && !Array.isArray(el) && (target.matches(ACTION) || target.querySelectorAll(ACTION).length === 1);
    const canSave = step.showOnly && last && !sampleUsed && isAction;
    const note = !(step.showOnly && last && el) ? null
      : sampleUsed ? 'Click Done to discard the sample data.'
      : isAction ? `Click Done to discard what you entered, or click ${saveLabel ? `“${saveLabel}”` : 'the highlighted button'} to save it.`
      : null;

    const buttons = [];
    if (canGoBack) buttons.push('previous');
    if (!clickToAdvance) buttons.push('next');
    buttons.push('close');

    destroyDriver();
    if (Array.isArray(el)) el[0].scrollIntoView({ block: 'center' });
    const anchor = Array.isArray(el) ? groupBox(el, step.target, step.clues) : el;
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
        ...(SIDES.includes(step.placement) ? { side: step.placement, align: 'center' } : {}),
        title: escapeHtml(step.title),
        description: escapeHtml(step.text),
        showButtons: buttons,
        showProgress: true,
        progressText: `${tour.status === 'draft' ? 'Draft · ' : ''}${index + 1} of ${total}`,
        nextBtnText: index === total - 1 ? 'Done' : 'Next',
        prevBtnText: 'Back',
        onNextClick: () => goTo(tour, index + 1),
        onPrevClick: () => goTo(tour, index - 1, -1),
        onCloseClick: () => endTour(),
        onPopoverRender: (popover) => {
          renderStepBox(popover, tour, step, clickToAdvance, (index + 1) / total, note);
          // driver.js focuses the step box right after this returns; skip that while someone is in a field.
          if (inField()) queueMicrotask(keepFocus());
        },
      },
    });

    if (el) stepDialog = (Array.isArray(el) ? el[0] : el).closest('[role=dialog]') || stepDialog;
    announce('step', { tourId: tour.id, index, total });
    if (anchor) ringOver(anchor, el);
    placing = { anchor, placement: step.placement };
    requestAnimationFrame(() => requestAnimationFrame(placeBox)); // right after driver.js places it
    screenTimer = setInterval(placeBox, 150);
    if (step.showOnly && el && !canSave) stopBlocking = blockClicks(step.target, step.clues);
    if (canSave) {
      // Saving ends the tour, leaving the form as it is (no exit clicks); the click itself goes on to the app.
      const token = runToken;
      const onSave = () => token === runToken && setTimeout(() => endTour(), 0);
      for (const t of Array.isArray(el) ? el : [el]) t.addEventListener('click', onSave, { once: true, capture: true });
    }

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
  function blockClicks(target, clues) {
    const block = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      const found = findTarget(target, clues);
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
    const target = await waitFor(() => findTarget(item.target, item.clues), 3000);
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
    const first = findTarget(step.fill[0].target, step.fill[0].clues);
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
  const CLOSE_BUTTON = "[data-slot$='dialog-close'], [data-slot$='-close-button'], button[aria-label='Close' i], button[aria-label^='Close ' i]";
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

  // Rebuild driver.js's popover into the step box: a white body (full-width image, heading title, text, close
  // in the corner), a thin progress line, and a bottom bar (step count; Back, Next or a hint). Square, no border,
  // a drop shadow.
  // driver.js's own button classes are kept, so its click handling still works.
  function renderStepBox(p, tour, step, clickToAdvance, progress, note) {
    const s = Object.assign({}, DEFAULT_STYLE, tour.style);
    const vars = {
      '--tl-frame': s.frame, '--tl-band-text': s.bandText, '--tl-button': s.button, '--tl-button-text': s.buttonText,
      '--tl-body-text': s.bodyText, '--tl-body-bg': s.bodyBg, '--tl-footer-h': s.footerHeight + 'px',
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
    body.append(el('div', { className: 'tl-pad' }, [title, p.description, ...(note ? [el('p', { className: 'tl-note', textContent: note })] : [])]), p.closeButton);
    // A step that continues on a click says so in a strip under the text (the bottom bar keeps Back alone).
    if (clickToAdvance) {
      const hint = el('div', { className: 'tl-hint' });
      hint.innerHTML = `${POINTER_ICON}<span>Click the highlighted item to continue</span>`;
      body.append(hint);
    }

    const fill = step.fill ? [el('button', { className: 'tl-fill', textContent: 'Fill example', onclick: (e) => fillSample(tour, step, e.currentTarget) })] : [];
    p.footer.replaceChildren(p.progress, el('span', { className: 'tl-actions' }, [p.previousButton, ...fill, ...(clickToAdvance ? [] : [p.nextButton])]));
    const bar = el('div', { className: 'tl-bar' }, [el('span', { style: `width: ${Math.round(progress * 100)}%` })]);
    p.wrapper.replaceChildren(p.arrow, body, bar, p.footer);
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
    .driver-popover.tour-layer-popover { padding: 0; min-width: min(300px, calc(100vw - 16px)); max-width: min(340px, calc(100vw - 16px)); border-radius: 0; border: 0; background: var(--tl-body-bg); color: var(--tl-body-text); box-shadow: 0 14px 36px rgba(11, 31, 68, .24), 0 2px 8px rgba(11, 31, 68, .14); }
    .tour-layer-popover .tl-body { position: relative; background: var(--tl-body-bg); color: var(--tl-body-text); }
    .tour-layer-popover .tl-img { display: block; width: 100%; max-height: 180px; object-fit: cover; }
    .tour-layer-popover .tl-pad { padding: 16px 40px 18px 18px; }
    .tour-layer-popover .driver-popover-close-btn { position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; padding: 0; color: color-mix(in srgb, var(--tl-body-text) 55%, transparent); font-size: 18px; line-height: 1; background: none; }
    .tour-layer-popover .driver-popover-close-btn:hover, .tour-layer-popover .driver-popover-close-btn:focus { color: var(--tl-body-text); }
    .tour-layer-popover .tl-img + .tl-pad + .driver-popover-close-btn { background: rgba(255, 255, 255, .85); border-radius: 50%; }
    .tour-layer-popover .tl-title { display: block; margin: 0 0 6px; font-weight: 600; line-height: 1.25; text-align: var(--tl-title-align); color: inherit; }
    .tour-layer-popover h1.tl-title { font-size: 22px; } .tour-layer-popover h2.tl-title { font-size: 18px; } .tour-layer-popover h3.tl-title { font-size: 16px; }
    .tour-layer-popover .driver-popover-description { margin: 0; font-size: 14px; line-height: 1.5; text-align: var(--tl-text-align); color: inherit; }
    .tour-layer-popover .tl-bar { height: 3px; background: color-mix(in srgb, var(--tl-band-text) 22%, var(--tl-frame)); }
    .tour-layer-popover .tl-bar > span { display: block; height: 100%; background: var(--tl-button); }
    .tour-layer-popover .driver-popover-footer { display: flex; align-items: center; justify-content: space-between; height: var(--tl-footer-h); margin: 0; padding: 0 12px 0 18px; gap: 10px; background: var(--tl-frame); color: var(--tl-band-text); }
    .tour-layer-popover .driver-popover-progress-text { color: color-mix(in srgb, var(--tl-band-text) 70%, transparent); font-size: 12px; white-space: nowrap; }
    .tour-layer-popover .tl-actions { display: flex; align-items: center; gap: 12px; margin-left: auto; }
    .tour-layer-popover .driver-popover-footer button { text-shadow: none; border: 0; font-size: 13px; }
    .tour-layer-popover .driver-popover-prev-btn, .tour-layer-popover .driver-popover-prev-btn:hover, .tour-layer-popover .driver-popover-prev-btn:focus { background: none; color: inherit; padding: 2px 4px; }
    .tour-layer-popover .driver-popover-next-btn, .tour-layer-popover .driver-popover-next-btn:hover, .tour-layer-popover .driver-popover-next-btn:focus {
      background: var(--tl-button); color: var(--tl-button-text); font-weight: 600; border-radius: 0;
      padding: max(4px, calc((var(--tl-footer-h) - 22px) / 2.6)) calc(max(4px, calc((var(--tl-footer-h) - 22px) / 2.6)) + 10px); }
    .tour-layer-popover .driver-popover-next-btn:hover { filter: brightness(.95); }
    .tour-layer-group { position: fixed; pointer-events: none; }
    .tour-layer-ring { position: fixed; pointer-events: none; border-radius: ${STAGE_RADIUS}px; box-shadow: 0 0 0 200vmax rgba(0, 0, 0, ${OVERLAY_OPACITY}); }
    .tour-layer-ringed .driver-overlay { opacity: 0 !important; }
    .tour-layer-popover .driver-popover-footer .tl-fill { background: none; color: inherit; border: 1px solid currentColor; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
    .tour-layer-popover .driver-popover-footer .tl-fill:disabled { opacity: .7; cursor: default; }
    .tour-layer-popover .tl-note { margin: 8px 0 0; font-size: 13px; line-height: 1.45; font-weight: 600; text-align: var(--tl-text-align); }
    .tour-layer-popover .tl-hint { display: flex; align-items: center; gap: 7px; padding: 9px 18px; font-size: 12px; line-height: 1.35; background: color-mix(in srgb, var(--tl-button) 22%, var(--tl-body-bg)); color: var(--tl-button-text); }
    .tour-layer-popover .tl-hint svg { flex: none; }
    .tour-layer-popover .driver-popover-arrow { border-color: transparent; }
    /* The arrow takes the colour of the edge it sits on: the bottom bar below the box, the white body elsewhere */
    .tour-layer-popover .driver-popover-arrow-side-left { border-left-color: var(--tl-body-bg); }
    .tour-layer-popover .driver-popover-arrow-side-right { border-right-color: var(--tl-body-bg); }
    .tour-layer-popover .driver-popover-arrow-side-top { border-top-color: var(--tl-frame); }
    .tour-layer-popover .driver-popover-arrow-side-bottom { border-bottom-color: var(--tl-body-bg); }
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
    // Drafts only load for people who turned on Show drafts; list them apart so they're never mistaken for live tours.
    const live = here.filter((t) => t.status !== 'draft');
    const drafts = here.filter((t) => t.status === 'draft');
    if (live.length) {
      panel.append(el('div', { className: 'tour-layer-heading', textContent: 'Tours for this page' }));
      live.forEach((t) => panel.append(item(t.title, t.description, () => goTo(t, 0))));
    }
    if (drafts.length) {
      panel.append(el('div', { className: 'tour-layer-heading', textContent: 'Drafts (not live yet)' }));
      drafts.forEach((t) => panel.append(item(t.title, t.description, () => goTo(t, 0))));
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
