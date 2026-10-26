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

  let tours = [];
  let driverObj = null;
  let internalDestroy = false;
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
    if (typeof target === 'string') {
      return [...document.querySelectorAll(target)].find(isVisible) || null;
    }
    const want = target.text.trim().toLowerCase();
    const candidates = document.querySelectorAll(target.selector || 'button, a, [role="button"]');
    return (
      [...candidates].find(
        (el) => isVisible(el) && el.innerText.trim().split('\n')[0].trim().toLowerCase() === want
      ) || null
    );
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
  const clearState = () => sessionStorage.removeItem(STATE_KEY);
  const findTour = (id) => tours.find((t) => t.id === id);
  const loadDraft = () => {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY));
    } catch {
      return null;
    }
  };
  const isTarget = (t) => typeof t === 'string' || (t && typeof t.text === 'string');
  // Draft tours come straight from the builder rather than from the checked tour files, so check the basics.
  const isTour = (t) =>
    t && typeof t.id === 'string' && typeof t.page === 'string' && Array.isArray(t.steps) && t.steps.length > 0 &&
    t.steps.every((s) =>
      s && typeof s.title === 'string' && typeof s.text === 'string' &&
      (s.target === undefined || isTarget(s.target) || (Array.isArray(s.target) && s.target.length > 0 && s.target.every(isTarget))) &&
      (s.image === undefined || /^(https:|data:image\/)/.test(s.image)));

  // ---------- tour flow ----------

  // driver.js highlights one element, so a group gets an invisible box over the area around all its items,
  // kept in place while the page scrolls or resizes.
  let group = null;
  function groupBox(els) {
    const box = el('div', { className: 'tour-layer-group' });
    const fit = () => {
      const rs = els.map((e) => e.getBoundingClientRect());
      const left = Math.min(...rs.map((r) => r.left));
      const top = Math.min(...rs.map((r) => r.top));
      Object.assign(box.style, {
        left: left + 'px', top: top + 'px',
        width: Math.max(...rs.map((r) => r.right)) - left + 'px', height: Math.max(...rs.map((r) => r.bottom)) - top + 'px',
      });
    };
    const onMove = () => {
      fit();
      if (driverObj) driverObj.refresh();
    };
    fit();
    document.body.append(box);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    group = { box, remove: () => { box.remove(); window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); } };
    return box;
  }

  function destroyDriver() {
    group?.remove();
    group = null;
    if (!driverObj) return;
    internalDestroy = true;
    driverObj.destroy();
    internalDestroy = false;
    driverObj = null;
  }

  function endTour() {
    runToken++;
    const state = loadState();
    const draft = loadDraft();
    if (draft && state && state.tourId === draft.id) {
      sessionStorage.removeItem(DRAFT_KEY);
      tours = tours.filter((t) => t.id !== draft.id);
    }
    clearState();
    destroyDriver();
    renderLauncher();
  }

  // direction: +1 or -1, so a skipped optional step keeps moving the same way.
  async function goTo(tour, index, direction = 1) {
    if (index < 0) return;
    if (index >= tour.steps.length) return endTour();
    const token = ++runToken;
    saveState({ tourId: tour.id, step: index });
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
    const anchor = Array.isArray(el) ? groupBox(el) : el;
    driverObj = window.driver.js.driver({
      allowClose: true,
      overlayOpacity: 0.45,
      stagePadding: 6,
      stageRadius: 8,
      popoverClass: 'tour-layer-popover',
      onDestroyed: () => {
        if (!internalDestroy) endTour(); // user closed it (X, Esc, overlay click)
      },
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
        onCloseClick: endTour,
        onPopoverRender: (popover) => renderStepBox(popover, tour, step, clickToAdvance),
      },
    });

    if (clickToAdvance) {
      const token = runToken;
      const onClick = () => {
        if (token !== runToken) return;
        runToken++; // a group has several listeners; only the first click counts
        destroyDriver();
        saveState({ tourId: tour.id, step: index + 1 });
        // Let the click do its thing (navigate, open a dialog) before looking for the next target.
        setTimeout(() => goTo(tour, index + 1), 300);
      };
      for (const target of Array.isArray(el) ? el : [el]) target.addEventListener('click', onClick, { once: true, capture: true });
    }
  }

  // Rebuild driver.js's popover into the step box: a header band (step count, close), a body
  // (full-width image, heading title, text) and a footer band (Back, Next or a hint).
  // driver.js's own button classes are kept, so its click handling still works.
  function renderStepBox(p, tour, step, clickToAdvance) {
    const s = Object.assign({}, DEFAULT_STYLE, tour.style);
    const vars = {
      '--tl-frame': s.frame, '--tl-band-text': s.bandText, '--tl-button': s.button, '--tl-button-text': s.buttonText,
      '--tl-body-text': s.bodyText, '--tl-body-bg': s.bodyBg, '--tl-header-h': s.headerHeight + 'px',
      '--tl-footer-h': s.footerHeight + 'px', '--tl-side': s.sideBorder + 'px', '--tl-corners': s.corners + 'px',
      '--tl-title-align': s.titleAlign, '--tl-text-align': s.textAlign,
    };
    for (const [k, v] of Object.entries(vars)) p.wrapper.style.setProperty(k, v);

    const title = document.createElement(s.titleSize);
    title.id = 'driver-popover-title';
    title.className = 'driver-popover-title tl-title';
    title.textContent = step.title;
    const body = el('div', { className: 'tl-body' });
    if (step.image) body.append(el('img', { className: 'tl-img', src: step.image, alt: '' }));
    body.append(el('div', { className: 'tl-pad' }, [title, p.description]));

    const right = clickToAdvance ? el('span', { className: 'tl-hint', textContent: 'Click the highlighted item' }) : p.nextButton;
    p.footer.replaceChildren(p.previousButton, right);
    p.wrapper.replaceChildren(p.arrow, el('div', { className: 'tl-head' }, [p.progress, p.closeButton]), body, p.footer);
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
    .driver-popover.tour-layer-popover { padding: 0; min-width: 300px; max-width: 340px; border-radius: var(--tl-corners); background: var(--tl-frame); color: var(--tl-body-text); box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    .tour-layer-popover .tl-head, .tour-layer-popover .driver-popover-footer { display: flex; align-items: center; justify-content: space-between; margin: 0; color: var(--tl-band-text); }
    .tour-layer-popover .tl-head { height: var(--tl-header-h); padding: 0 6px 0 10px; border-radius: var(--tl-corners) var(--tl-corners) 0 0; }
    .tour-layer-popover .driver-popover-progress-text { color: inherit; font-size: 12px; }
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
        item('Stop tour', null, endTour)
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
    stop: endTour,
    get tours() {
      return tours;
    },
  };
})();
