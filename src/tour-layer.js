// Product Tour Layer: runs guided tours on top of DoorLoop without changing DoorLoop's code.
// Load vendor/driver.js (JS + CSS) first, then: TourLayer.init({ tours }).
(function () {
  'use strict';
  if (window.TourLayer) return;

  const STATE_KEY = 'tourLayer.state';
  const TARGET_TIMEOUT_MS = 8000;
  const OPTIONAL_TIMEOUT_MS = 1500;
  const POLL_MS = 250;

  let tours = [];
  let driverObj = null;
  let internalDestroy = false;
  let runToken = 0; // bumped on every step change so stale async work can bail out
  let lastPath = location.pathname;

  // ---------- helpers ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Has a size and isn't clipped away by a collapsed parent (e.g. a closed side-menu section).
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      if (!clipX && !clipY) continue;
      const pr = p.getBoundingClientRect();
      if (clipY && (r.bottom <= pr.top || r.top >= pr.bottom)) return false;
      if (clipX && (r.right <= pr.left || r.left >= pr.right)) return false;
    }
    return true;
  };

  // "/tenants" matches exactly; "*" matches one path segment, e.g. "/tenants/*".
  function pageMatches(pattern, path) {
    const escaped = pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('^' + escaped.join('[^/]+') + '/?$').test(path);
  }

  // A target is a CSS selector string, or { text, selector? } to match a visible element by its label.
  function findTarget(target) {
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

  // ---------- tour flow ----------

  function destroyDriver() {
    if (!driverObj) return;
    internalDestroy = true;
    driverObj.destroy();
    internalDestroy = false;
    driverObj = null;
  }

  function endTour() {
    runToken++;
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

    const step = tour.steps[index];
    if (step.page && !pageMatches(step.page, location.pathname)) {
      // Wrong page for this step: pause until the route watcher sees the right one.
      destroyDriver();
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
    const canGoBack = prev && (!prev.page || pageMatches(prev.page, location.pathname));

    const buttons = [];
    if (canGoBack) buttons.push('previous');
    if (!clickToAdvance) buttons.push('next');
    buttons.push('close');

    destroyDriver();
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
      element: el || undefined,
      popover: {
        title: escapeHtml(step.title),
        description:
          escapeHtml(step.text) +
          (clickToAdvance ? '<p class="tour-layer-hint">Click the highlighted item to continue.</p>' : ''),
        showButtons: buttons,
        showProgress: true,
        progressText: `${index + 1} of ${total}`,
        nextBtnText: index === total - 1 ? 'Done' : 'Next',
        prevBtnText: 'Back',
        onNextClick: () => goTo(tour, index + 1),
        onPrevClick: () => goTo(tour, index - 1, -1),
        onCloseClick: endTour,
      },
    });

    if (clickToAdvance) {
      const token = runToken;
      el.addEventListener(
        'click',
        () => {
          if (token !== runToken) return;
          destroyDriver();
          saveState({ tourId: tour.id, step: index + 1 });
          // Let the click do its thing (navigate, open a dialog) before looking for the next target.
          setTimeout(() => goTo(tour, index + 1), 300);
        },
        { once: true, capture: true }
      );
    }
  }

  function onRoute() {
    const state = loadState();
    const tour = state && findTour(state.tourId);
    const step = tour && tour.steps[state.step];
    if (step) {
      if (!step.page || pageMatches(step.page, location.pathname)) {
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
    .tour-layer-popover .tour-layer-hint { margin: 8px 0 0; font-style: italic; color: #555; }
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
    const here = tours.filter((t) => pageMatches(t.page, location.pathname));
    if (!paused && !here.length) return;

    const item = (title, sub, onClick) =>
      el('button', { onclick: onClick }, [title, ...(sub ? [el('small', { textContent: sub })] : [])]);

    const panel = el('div', { className: 'tour-layer-panel', hidden: true });
    if (paused) {
      panel.append(
        el('div', { className: 'tour-layer-heading', textContent: 'In progress' }),
        item(`Resume: ${paused.title}`, `Step ${state.step + 1} of ${paused.steps.length}`, () => {
          const page = paused.steps[state.step].page;
          if (!page || pageMatches(page, location.pathname)) return goTo(paused, state.step);
          // Reloads the app on the step's page; the saved state picks the tour back up.
          if (page.includes('*')) {
            saveState({ tourId: paused.id, step: 0 });
            location.assign(paused.page);
          } else {
            location.assign(page);
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

  window.TourLayer = {
    init,
    start,
    stop: endTour,
    get tours() {
      return tours;
    },
  };
})();
