// Tour builder: build tours visually on top of an app.
//   demo: on the builder page, with the demo app in a frame (TourBuilder.open({ mode: 'demo', ... })).
//   live: on DoorLoop itself, opened by the DoorLoop Tours extension (TourBuilder.open({ mode: 'live', ... })).
// The UI lives in a shadow root, so the app's CSS and the builder's CSS can't affect each other.
(function () {
  'use strict';
  if (window.TourBuilder) return;

  const PICKABLE = '[data-cy], [data-intercom-target], [aria-label], [role=tab], button, a, input, tr, h1';
  const ADVANCE = { next: 'Next button', click: 'Click the element', type: 'Type text' };
  const SESSION_KEY = 'tourLayer.builder'; // live mode: the draft survives page reloads
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STYLE_FIELDS = {
    '--tour-frame': 'frame', '--tour-band-text': 'bandText', '--tour-button': 'button', '--tour-button-text': 'buttonText',
    '--tour-body-text': 'bodyText', '--tour-body-bg': 'bodyBg', '--tour-header-h': 'headerHeight', '--tour-footer-h': 'footerHeight',
    '--tour-side': 'sideBorder', '--tour-radius': 'corners',
  };

  const align = (rows) =>
    '<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">' +
    rows.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="1.6" fill="currentColor"/>`).join('') + '</svg>';
  const AL = { left: align([[0, 1, 14], [0, 5, 9], [0, 9, 12]]), center: align([[0, 1, 14], [2.5, 5, 9], [1, 9, 12]]),
    right: align([[0, 1, 14], [5, 5, 9], [2, 9, 12]]), justify: align([[0, 1, 14], [0, 5, 14], [0, 9, 14]]) };

  const CSS = `
    :host { all: initial; }
    .root {
      --bg: #f6f8fb; --card: #fff; --text: #1a1a1a; --muted: #5b6472; --accent: #1665d8; --border: #e2e7ef;
      --tour-frame: #0b1f44; --tour-band-text: #ffffff; --tour-button: #d8f34a; --tour-button-text: #0b1f44; --tour-body-text: #1b1d21; --tour-body-bg: #ffffff;
      --tour-header-h: 26px; --tour-footer-h: 48px; --tour-side: 3px; --tour-radius: 10px; --tour-title-align: left; --tour-text-align: left;
      position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
      font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--text);
    }
    @media (prefers-color-scheme: dark) {
      .root { --bg: #11151c; --card: #1a2029; --text: #e8ecf2; --muted: #9aa4b2; --accent: #5b9bff; --border: #2a323e; }
    }
    .root * { box-sizing: border-box; }
    .root button { font: inherit; cursor: pointer; }
    .ghost { background: transparent; color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; white-space: nowrap; }
    .ghost.live-preview { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

    /* layout: demo = full-screen workspace with the demo app framed; live = floating pieces over the real app */
    .demo .backdrop { position: fixed; inset: 0; background: rgba(10, 15, 25, .55); pointer-events: auto; }
    .demo .ws { position: fixed; inset: 12px; background: var(--card); border-radius: 12px; display: grid; grid-template: auto 1fr auto / 56px 1fr; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.35); pointer-events: auto; }
    .ws-top { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--card); }
    .ws-top strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
    .ws-top .url { flex: 1; min-width: 0; font-size: 13px; color: var(--muted); background: var(--bg); border-radius: 6px; padding: 5px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ws-top .test-on { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); white-space: nowrap; }
    .tools { border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; padding: 8px; background: var(--card); }
    .tool { width: 40px; height: 40px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 16px; display: grid; place-items: center; position: relative; }
    .tool:hover { background: var(--bg); }
    .tool.on { background: var(--accent); color: #fff; }
    .tool[data-tip]:hover::after { content: attr(data-tip); position: absolute; left: 48px; white-space: nowrap; background: #222; color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 6px; z-index: 5; }
    .tools hr { width: 100%; border: 0; border-top: 1px solid var(--border); margin: 4px 0; }
    .stage { position: relative; overflow: auto; background: #e9edf3; padding: 16px; }
    .stage-inner { position: relative; min-width: 1100px; height: 100%; min-height: 560px; }
    .frame { display: block; width: 100%; height: 100%; border: 0; border-radius: 8px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
    .story { grid-column: 1 / -1; border-top: 1px solid var(--border); padding: 10px 14px; display: flex; gap: 8px; align-items: stretch; overflow-x: auto; min-height: 112px; background: var(--card); }

    .live .ws-top { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); width: min(980px, calc(100vw - 140px)); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); pointer-events: auto; z-index: 3; }
    .live .ws-top .badge { font-size: 11px; font-weight: 600; background: var(--accent); color: #fff; border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
    .live .tools { position: fixed; left: 10px; top: 50%; transform: translateY(-50%); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); pointer-events: auto; z-index: 3; }
    .live .story { position: fixed; left: 0; right: 0; bottom: 0; box-shadow: 0 -6px 24px rgba(0,0,0,.12); pointer-events: auto; z-index: 3; }

    /* highlight layer: the draw surface sits under the layer so the step editor stays clickable */
    .layer, .draw-surface { position: absolute; inset: 0; }
    .live .layer, .live .draw-surface { position: fixed; z-index: 2; }
    .layer { pointer-events: none; }
    .draw-surface { cursor: crosshair; display: none; pointer-events: auto; }
    .mode-box .draw-surface { display: block; }
    .root:not(.picking) .draw-surface { cursor: not-allowed; }
    .hover-box, .sel-box, .drawn-box { position: absolute; border-radius: 6px; pointer-events: none; }
    .hover-box { outline: 2px dashed var(--accent); background: rgba(22, 101, 216, .06); }
    .sel-box { outline: 3px solid var(--tour-frame); box-shadow: 0 0 0 9999px rgba(10, 15, 25, .35); }
    .drawn-box { border: 2px dashed #e5484d; background: rgba(229, 72, 77, .08); }

    /* step editor and preview */
    .pop { position: absolute; width: 320px; pointer-events: auto; z-index: 3; font-size: 14px; }
    .pop .fmt, .pop .meta { background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.15); }
    .pop .fmt { display: flex; gap: 2px; padding: 4px; margin-bottom: 6px; flex-wrap: wrap; align-items: center; }
    .pop .fmt button { border: 0; background: transparent; color: inherit; border-radius: 4px; min-width: 26px; height: 26px; }
    .pop .fmt button:hover { background: var(--bg); }
    .pop .fmt input[type=color] { width: 26px; height: 26px; border: 0; padding: 0; background: none; }
    .pop .fmt .sep { width: 1px; align-self: stretch; background: var(--border); margin: 2px 4px; }
    .pop .meta { margin-top: 6px; padding: 8px 10px; font-size: 12px; display: grid; gap: 6px; }
    .pop .meta code { font-size: 11px; word-break: break-all; }
    .pop .meta select { font: inherit; font-size: 12px; padding: 3px; border-radius: 6px; }
    .pop .meta .row { display: flex; justify-content: space-between; align-items: center; }
    .pop .meta .save { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 5px 12px; font-weight: 600; }
    .pop .meta .link { background: none; border: 0; color: var(--muted); padding: 4px; }
    .pop [contenteditable]:empty::before { content: attr(data-placeholder); opacity: .45; }

    /* the tour's step box, styled by the tour-wide --tour-* settings */
    .tbox { background: var(--tour-frame); padding: 0 var(--tour-side); border-radius: var(--tour-radius); overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    .tb-head, .tb-foot { display: flex; align-items: center; justify-content: space-between; color: var(--tour-band-text); }
    .tb-head { height: var(--tour-header-h); padding: 0 8px 0 10px; font-size: 12px; }
    .tb-foot { height: var(--tour-footer-h); padding: 0 10px 0 12px; font-size: 13px; gap: 8px; }
    .tb-head .close, .tb-foot .back { background: none; border: 0; color: inherit; font: inherit; padding: 2px 4px; }
    .tb-head .close { font-size: 16px; line-height: 1; }
    .tb-next { background: var(--tour-button); color: var(--tour-button-text); border: 0; border-radius: 6px; font-weight: 600; font-size: 13px;
      padding: max(4px, calc((var(--tour-footer-h) - 22px) / 2.6)) calc(max(4px, calc((var(--tour-footer-h) - 22px) / 2.6)) + 10px); }
    .tb-hint { font-size: 12px; font-style: italic; }
    .tb-body { background: var(--tour-body-bg); color: var(--tour-body-text); }
    .tb-img { position: relative; }
    .tb-img img { display: block; width: 100%; max-height: 180px; object-fit: cover; }
    .tb-img .rm { position: absolute; top: 6px; right: 6px; border: 0; border-radius: 6px; background: rgba(0,0,0,.6); color: #fff; font-size: 11px; padding: 3px 8px; }
    .tb-pad { padding: 14px 16px 16px; }
    .tb-title { margin: 0 0 6px; line-height: 1.25; font-weight: 600; text-align: var(--tour-title-align); outline: none; }
    h1.tb-title { font-size: 22px; } h2.tb-title { font-size: 18px; } h3.tb-title { font-size: 16px; }
    .tb-text { font-size: 14px; line-height: 1.5; text-align: var(--tour-text-align); outline: none; min-height: 21px; }
    .tb-typed { width: 100%; margin-top: 10px; padding: 6px 8px; border: 1px solid rgba(0,0,0,.2); border-radius: 6px; font: inherit; }

    /* storyboard */
    .card { flex: 0 0 168px; background: var(--bg); border: 2px solid transparent; border-radius: 10px; padding: 8px 10px; text-align: left; color: var(--text); position: relative; cursor: pointer; }
    .card.on { border-color: var(--accent); }
    .card .n { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .card .t { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card .chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
    .chip { font-size: 11px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 0 6px; }
    .card .x { position: absolute; top: 4px; right: 6px; border: 0; background: none; color: var(--muted); }
    .arrow { align-self: center; color: var(--muted); }
    .card.page-card { flex-basis: 140px; border-style: dashed; border-color: var(--border); }
    .card.draft { border-style: dashed; border-color: var(--accent); }
    .card.draft .t { color: var(--muted); font-weight: 500; font-style: italic; }
    .adders { flex: 0 0 auto; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
    .add { border: 2px dashed var(--border); background: transparent; color: var(--accent); border-radius: 10px; padding: 7px 14px; font-weight: 600; white-space: nowrap; }
    .add:hover { border-color: var(--accent); }
    .add-page input { width: 170px; padding: 7px 10px; border: 2px solid var(--accent); border-radius: 10px; background: var(--card); color: var(--text); font: inherit; font-size: 13px; }

    /* panels and overlays */
    .panel { position: absolute; left: 64px; top: 56px; max-height: calc(100% - 190px); overflow-y: auto; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.2); z-index: 6; width: 270px; font-size: 13px; pointer-events: auto; }
    .live .panel { position: fixed; left: 70px; top: 70px; max-height: calc(100vh - 220px); }
    .panel[hidden] { display: none; }
    .panel h3 { margin: 0 0 8px; font-size: 13px; }
    .panel h3 small { display: block; font-weight: 400; color: var(--muted); font-size: 12px; }
    .panel .pgrp { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 12px 0 2px; }
    .panel label { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 6px 0; }
    .panel input[type=range] { flex: 1; min-width: 0; }
    .panel label span.px { min-width: 34px; text-align: right; color: var(--text); }
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
    .seg button { border: 0; background: transparent; color: var(--text); min-width: 30px; height: 26px; font-size: 12px; display: grid; place-items: center; padding: 0 6px; }
    .seg button + button { border-left: 1px solid var(--border); }
    .seg button.on { background: var(--accent); color: #fff; }
    .filebox { position: fixed; inset: 40px; background: var(--card); border-radius: 12px; z-index: 20; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.4); pointer-events: auto; }
    .filebox[hidden] { display: none; }
    .filebox header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .filebox header strong { flex: 1; }
    .filebox pre { margin: 0; padding: 16px; overflow: auto; flex: 1; font-size: 12px; }
    .toast { position: fixed; bottom: 140px; left: 50%; transform: translateX(-50%); background: #222; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 13px; z-index: 30; max-width: min(640px, calc(100vw - 32px)); }
    .toast[hidden] { display: none; }
  `;

  const STYLE_PANEL = `
    <h3>Tour style <small>Applies to every step in this tour.</small></h3>
    <div class="pgrp">Colors</div>
    <label>Frame <input type="color" data-var="--tour-frame" value="#0b1f44"></label>
    <label>Header and footer text <input type="color" data-var="--tour-band-text" value="#ffffff"></label>
    <label>Button <input type="color" data-var="--tour-button" value="#d8f34a"></label>
    <label>Button text <input type="color" data-var="--tour-button-text" value="#0b1f44"></label>
    <label>Body text <input type="color" data-var="--tour-body-text" value="#1b1d21"></label>
    <label>Body background <input type="color" data-var="--tour-body-bg" value="#ffffff"></label>
    <div class="pgrp">Sizes</div>
    <label>Header <input type="range" data-var="--tour-header-h" min="16" max="48" value="26"><span class="px"></span></label>
    <label>Footer <input type="range" data-var="--tour-footer-h" min="32" max="64" value="48"><span class="px"></span></label>
    <label>Side border <input type="range" data-var="--tour-side" min="0" max="8" value="3"><span class="px"></span></label>
    <label>Corners <input type="range" data-var="--tour-radius" min="0" max="16" value="10"><span class="px"></span></label>
    <div class="pgrp">Text</div>
    <label>Title size <span class="seg" data-key="titleTag"><button data-v="h1">H1</button><button data-v="h2" class="on">H2</button><button data-v="h3">H3</button></span></label>
    <label>Title align <span class="seg" data-key="titleAlign">${['left', 'center', 'right'].map((a, i) => `<button data-v="${a}" title="${a}" class="${i ? '' : 'on'}">${AL[a]}</button>`).join('')}</span></label>
    <label>Text align <span class="seg" data-key="textAlign">${['left', 'center', 'right', 'justify'].map((a, i) => `<button data-v="${a}" title="${a}" class="${i ? '' : 'on'}">${AL[a]}</button>`).join('')}</span></label>`;

  let current = null; // one builder at a time

  // options: { mode: 'demo' | 'live', name, startPath, demoBase?, restore?, onClose? }
  function open(options) {
    if (current) current.close(true);
    current = createBuilder(options);
    return current;
  }

  function savedSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  }

  function createBuilder(options) {
    const live = options.mode === 'live';
    const host = document.createElement('div');
    host.id = 'tour-layer-builder';
    const shadow = host.attachShadow({ mode: 'open' });
    const $ = (s) => shadow.querySelector(s);
    const $$ = (s) => shadow.querySelectorAll(s);

    const LAYERS = '<div class="draw-surface"></div><div class="layer"></div>';
    shadow.innerHTML = `
      <style>${CSS}</style>
      <div class="root ${live ? 'live' : 'demo'}">
        ${live ? '' : '<div class="backdrop"></div>'}
        <div class="ws">
          <div class="ws-top">
            ${live ? '<span class="badge">Building on live DoorLoop</span>' : ''}
            <strong class="ws-name"></strong>
            <span class="url"></span>
            ${live ? '' : '<span class="test-on">Test on <span class="seg test-seg"><button data-v="demo" class="on">Demo</button><button data-v="live">Live DoorLoop</button></span></span>'}
            <button class="ghost preview-btn">▶ Preview</button>
            <button class="ghost file-btn">View tour file</button>
            <button class="ghost close-btn">Close</button>
          </div>
          <div class="tools">
            <button class="tool on" data-tool="pointer" data-tip="Pointer: click an element">↖</button>
            <button class="tool" data-tool="box" data-tip="Box: draw around an area">▭</button>
            <button class="tool text-tool" data-tip="Text: edit the step's text">T</button>
            <button class="tool style-tool" data-tip="Tour style">◐</button>
            <hr>
            <button class="tool undo-tool" data-tip="Remove last storyboard item">↶</button>
          </div>
          ${live ? LAYERS : `<div class="stage"><div class="stage-inner"><iframe class="frame" title="Demo app"></iframe>${LAYERS}</div></div>`}
          <div class="story"></div>
          <div class="panel style-panel" hidden>${STYLE_PANEL}</div>
        </div>
        <div class="filebox" hidden>
          <header><strong>Tour file</strong><button class="ghost copy-btn">Copy</button><button class="ghost file-close">Close</button></header>
          <pre class="file-out"></pre>
        </div>
        <div class="toast" role="status" hidden></div>
      </div>`;
    document.body.append(host);
    const rootEl = $('.root');
    const layer = $('.layer');

    // While building on DoorLoop, hide the tour launcher so it doesn't get in the way.
    const hideLauncher = live ? Object.assign(document.createElement('style'), { textContent: '.tour-layer-launcher { display: none !important; }' }) : null;
    if (hideLauncher) document.head.append(hideLauncher);

    // flow: the storyboard, in order. { type: 'page', path } or { type: 'step', page, draft?, els, target, ... }.
    // active: index of the step being picked or edited; highlighting only works while a step is active.
    const state = { name: options.name, flow: [{ type: 'page', path: options.startPath }], tool: 'pointer', active: null, previewing: false, addingPage: false, testOn: 'demo' };
    const style = { titleTag: 'h2', titleAlign: 'left', textAlign: 'left' };
    let closed = false;

    function toast(msg) {
      const t = $('.toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => (t.hidden = true), 3200);
    }
    const pathOf = (url) => { try { return new URL(url).pathname; } catch { return url.startsWith('/') ? url : '/' + url; } };
    const currentPage = () => [...state.flow].reverse().find((i) => i.type === 'page').path;
    const steps = () => state.flow.filter((i) => i.type === 'step' && !i.draft);
    const showPage = (path) => ($('.url').textContent = live
      ? `${location.host}${path}`
      : `app.doorloop.com${path}  (demo app)` + (state.testOn === 'live' ? '  ·  Preview runs on live DoorLoop' : ''));

    // ---------- the app being built on: the framed demo, or this page itself ----------
    const frame = $('.frame');
    const app = live
      ? {
          doc: () => document,
          path: () => location.pathname,
          // DoorLoop routes in the browser, so move it the way its own links do.
          async navigate(path) {
            if (location.pathname === path) return;
            history.pushState({}, '', path);
            window.dispatchEvent(new PopStateEvent('popstate'));
            await sleep(400);
          },
          offset: () => ({ left: 0, top: 0 }),
        }
      : {
          doc: () => frame.contentDocument,
          path: () => {
            const w = frame.contentWindow;
            return w && w.DEMO_ROOT ? w.location.pathname.slice(w.DEMO_ROOT.length) || '/' : null;
          },
          // Once loaded, use the demo's own routing, so nothing reloads.
          async navigate(path) {
            const w = frame.contentWindow;
            if (w && w.DEMO_ROOT) {
              if (app.path() !== path) {
                w.history.pushState({}, '', w.DEMO_ROOT + path);
                w.dispatchEvent(new PopStateEvent('popstate'));
              }
              return;
            }
            await new Promise((resolve) => {
              frame.addEventListener('load', resolve, { once: true });
              frame.src = (options.demoBase || 'demo') + path;
            });
          },
          offset: () => frame.getBoundingClientRect(),
        };
    const inBuilder = (e) => e.composedPath().includes(host);
    const pickable = (node) => {
      const el = node.closest && node.closest(PICKABLE);
      return el && el !== app.doc().body && !host.contains(el) ? el : null;
    };
    // Actually showing on screen: not clipped away (e.g. inside a closed menu section) or covered.
    const visibleAt = (el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const hit = app.doc().elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    };

    // Listen on the app's document: hover and click to pick, and follow scrolling.
    const listeners = [];
    function wire(doc) {
      const on = (type, fn, capture) => {
        doc.addEventListener(type, fn, capture);
        listeners.push(() => doc.removeEventListener(type, fn, capture));
      };
      on('mousemove', (e) => {
        if (inBuilder(e) || state.tool !== 'pointer' || !canPick()) return clearHover();
        const el = pickable(e.target);
        if (!el) return clearHover();
        if (!hoverBox) {
          hoverBox = document.createElement('div');
          hoverBox.className = 'hover-box';
          layer.append(hoverBox);
        }
        place(hoverBox, rectIn(el), 2);
      });
      // With a step active, clicks pick; otherwise you can use the app normally.
      on('click', (e) => {
        if (inBuilder(e)) return;
        if (state.previewing || (canPick() && state.tool === 'pointer')) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (state.previewing || !canPick() || state.tool !== 'pointer') return;
        const el = pickable(e.target);
        if (el) select([el]);
      }, true);
      on('scroll', refreshOverlay, true);
    }
    if (live) wire(document);
    else frame.addEventListener('load', () => wire(frame.contentDocument));

    // Follow the app's page as you browse it.
    let shownPath = null;
    const pathTimer = setInterval(() => {
      const p = app.path();
      if (!p || p === shownPath) return;
      shownPath = p;
      clearHover();
      if (!state.previewing) {
        showPage(p);
        if (shown && !shown.every((e) => e.isConnected)) clearSelection();
      }
    }, 300);

    // ---------- geometry ----------
    // An element's position relative to the highlight layer.
    function rectIn(el) {
      const r = el.getBoundingClientRect();
      const o = layer.getBoundingClientRect();
      const f = el.ownerDocument === app.doc() && !live ? app.offset() : { left: 0, top: 0 };
      return { left: r.left + f.left - o.left, top: r.top + f.top - o.top, width: r.width, height: r.height };
    }
    function unionRect(els) {
      const rs = els.map(rectIn);
      const left = Math.min(...rs.map((r) => r.left));
      const top = Math.min(...rs.map((r) => r.top));
      const right = Math.max(...rs.map((r) => r.left + r.width));
      const bottom = Math.max(...rs.map((r) => r.top + r.height));
      return { left, top, width: right - left, height: bottom - top };
    }
    function place(div, r, pad = 4) {
      Object.assign(div.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    }
    function labelFor(el) {
      return el.getAttribute('aria-label') || el.innerText.trim().split('\n')[0].slice(0, 28) || el.tagName.toLowerCase();
    }
    // Same preference order as the README: data-cy, data-intercom-target, aria-label, then visible text.
    function targetFor(el) {
      if (el.dataset.cy) return `[data-cy='${el.dataset.cy}']`;
      if (el.dataset.intercomTarget) return `[data-intercom-target='${el.dataset.intercomTarget}']`;
      const aria = el.getAttribute('aria-label');
      if (aria) return `${el.tagName.toLowerCase()}[aria-label='${aria}']`;
      return { text: el.innerText.trim().split('\n')[0], selector: el.tagName.toLowerCase() };
    }
    // Find a saved target again (after moving pages or reloading), the way the tour engine would.
    function resolve(target) {
      const doc = app.doc();
      const one = (t) => {
        const sized = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !host.contains(el); };
        if (typeof t === 'string') return [...doc.querySelectorAll(t)].find(sized);
        const want = t.text.trim().toLowerCase();
        return [...doc.querySelectorAll(t.selector || 'button, a, [role="button"]')].find((el) => sized(el) && el.innerText.trim().split('\n')[0].trim().toLowerCase() === want);
      };
      const list = (Array.isArray(target) ? target : [target]).map(one);
      return list.every(Boolean) ? list : null;
    }
    async function elsFor(step) {
      await app.navigate(step.page);
      if (step.els && step.els.every((e) => e.isConnected)) return step.els;
      for (let i = 0; i < 30; i++) {
        const els = resolve(step.target);
        if (els) return els;
        await sleep(100);
      }
      return null;
    }

    // ---------- storyboard actions ----------
    function addStep() {
      const draft = state.flow.findIndex((i) => i.draft);
      if (draft !== -1) {
        activate(draft);
        return toast('Finish this step first: pick something to highlight.');
      }
      clearSelection();
      // Browsed to another page since the last page card? Add a card for it.
      const here = app.path();
      if (here && here !== currentPage()) state.flow.push({ type: 'page', path: here });
      state.flow.push({ type: 'step', draft: true, page: currentPage() });
      state.active = state.flow.length - 1;
      renderStory();
      toast(`Step added. Now click something ${live ? 'on the page' : 'in the demo'}, or use the box tool to draw around it.`);
    }
    async function addPage(path) {
      clearSelection();
      state.flow = state.flow.filter((i) => !i.draft);
      state.active = null;
      state.flow.push({ type: 'page', path: pathOf(path) });
      renderStory();
      await app.navigate(currentPage());
      toast(`Now on ${currentPage()}. Click + Step to add steps for this page.`);
    }
    async function activate(i) {
      clearSelection();
      state.active = i;
      const item = state.flow[i];
      renderStory();
      if (item.draft) return app.navigate(item.page);
      const els = await elsFor(item);
      if (state.active !== i) return;
      if (!els) return toast(`Couldn't find “${item.label}” on ${item.page}.`);
      select(els);
    }
    function removeItem(i) {
      if (i === 0) return;
      clearSelection();
      state.flow.splice(i, 1);
      if (state.active === i) state.active = null;
      else if (state.active > i) state.active--;
      renderStory();
    }

    // ---------- tools ----------
    $$('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    function setTool(tool) {
      state.tool = tool;
      $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
      rootEl.classList.toggle('mode-box', tool === 'box');
      clearHover();
    }
    $('.text-tool').onclick = () => {
      const t = $('.pop .tb-text');
      if (t) t.focus();
      else toast('Add a step and pick what it highlights, then edit its text.');
    };
    $('.undo-tool').onclick = () => removeItem(state.flow.length - 1);

    // Tour style: one look for every step, applied through the --tour-* CSS variables.
    $('.style-tool').onclick = () => ($('.style-panel').hidden = !$('.style-panel').hidden);
    function applyStyle() {
      $$('.style-panel input').forEach((i) => {
        const px = i.type === 'range';
        rootEl.style.setProperty(i.dataset.var, i.value + (px ? 'px' : ''));
        if (px) i.nextElementSibling.textContent = i.value + 'px';
      });
      rootEl.style.setProperty('--tour-title-align', style.titleAlign);
      rootEl.style.setProperty('--tour-text-align', style.textAlign);
      // Titles are real heading tags, so swap the tag when the size changes.
      $$('.tb-title').forEach((t) => {
        if (t.tagName.toLowerCase() === style.titleTag) return;
        const h = document.createElement(style.titleTag);
        for (const a of t.attributes) h.setAttribute(a.name, a.value);
        h.innerHTML = t.innerHTML;
        t.replaceWith(h);
      });
      refreshOverlay();
      save();
    }
    $$('.style-panel input').forEach((i) => (i.oninput = applyStyle));
    $$('.style-panel .seg').forEach((seg) => (seg.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      style[seg.dataset.key] = b.dataset.v;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      applyStyle();
    }));

    const canPick = () => state.active !== null && !state.previewing;

    let hoverBox = null;
    function clearHover() {
      hoverBox?.remove();
      hoverBox = null;
    }

    // box: draw a rectangle; groups everything inside it, or snaps to the best single match
    let drawStart = null;
    let drawn = null;
    const surface = $('.draw-surface');
    surface.addEventListener('mousedown', (e) => {
      if (!canPick()) return toast('Click + Step first, then draw around what it highlights.');
      const o = layer.getBoundingClientRect();
      drawStart = { x: e.clientX - o.left, y: e.clientY - o.top };
      drawn?.remove();
      drawn = document.createElement('div');
      drawn.className = 'drawn-box';
      layer.append(drawn);
    });
    surface.addEventListener('mousemove', (e) => {
      if (!drawStart) return;
      const o = layer.getBoundingClientRect();
      const x = e.clientX - o.left, y = e.clientY - o.top;
      place(drawn, { left: Math.min(x, drawStart.x), top: Math.min(y, drawStart.y), width: Math.abs(x - drawStart.x), height: Math.abs(y - drawStart.y) }, 0);
    });
    const onMouseUp = () => {
      if (!drawStart) return;
      drawStart = null;
      const d = { left: parseFloat(drawn.style.left), top: parseFloat(drawn.style.top), width: parseFloat(drawn.style.width), height: parseFloat(drawn.style.height) };
      const box = drawn;
      setTimeout(() => box.remove(), 600);
      if (!(d.width >= 6 && d.height >= 6)) return;
      const group = elementsInBox(d);
      if (group.length > 1) {
        select(group);
        return toast(`Grouped ${group.length} items`);
      }
      const el = group[0] || closestElement(d);
      if (!el) return toast('No element there. Try drawing a bit bigger.');
      select([el]);
      toast(`Snapped to “${labelFor(el)}”`);
    };
    window.addEventListener('mouseup', onMouseUp);
    const overlap = (d, r) => {
      const ix = Math.max(0, Math.min(d.left + d.width, r.left + r.width) - Math.max(d.left, r.left));
      const iy = Math.max(0, Math.min(d.top + d.height, r.top + r.height) - Math.max(d.top, r.top));
      return ix * iy;
    };
    // Everything visible and mostly (60%+) inside the box. Nested matches collapse to the outermost,
    // so a box around a widget picks the widget, and a box around menu items picks the items.
    // The builder's own UI covers part of the page in live mode, so hide it while measuring.
    function measuring(fn) {
      if (!live) return fn(); // in demo mode the app is inside the builder, so it can't be hidden
      host.style.visibility = 'hidden';
      try {
        return fn();
      } finally {
        host.style.visibility = '';
      }
    }
    function elementsInBox(d) {
      return measuring(() => {
        const inside = [...app.doc().querySelectorAll(PICKABLE)].filter((el) => {
          if (host.contains(el) || !visibleAt(el)) return false;
          const r = rectIn(el);
          return overlap(d, r) / (r.width * r.height) >= 0.6;
        });
        return inside.filter((el) => !inside.some((o) => o !== el && o.contains(el)));
      });
    }
    function closestElement(d) {
      return measuring(() => {
        let best = null, bestScore = 0;
        app.doc().querySelectorAll(PICKABLE).forEach((el) => {
          if (host.contains(el) || !visibleAt(el)) return;
          const r = rectIn(el);
          const inter = overlap(d, r);
          const score = inter / (d.width * d.height + r.width * r.height - inter); // overlap ÷ combined area
          if (score > bestScore) { best = el; bestScore = score; }
        });
        return bestScore > 0.05 ? best : null;
      });
    }

    // ---------- highlight + step editor (looks like the tour popover itself) ----------
    let selBox = null;
    let pop = null;
    let shown = null; // elements currently highlighted

    function highlight(els) {
      clearSelection();
      shown = els;
      els[0].scrollIntoView({ block: 'nearest' });
      selBox = document.createElement('div');
      selBox.className = 'sel-box';
      layer.append(selBox);
      place(selBox, unionRect(els));
    }
    function refreshOverlay() {
      clearHover();
      if (!shown || !shown.every((e) => e.isConnected)) return;
      place(selBox, unionRect(shown));
      if (pop) placePop();
    }
    // Highlight els (one element, or a box-tool group) for the active step and open its editor.
    function select(els) {
      clearHover();
      highlight(els);
      const item = state.flow[state.active];
      openEditor(els, item.draft ? null : item);
      renderStory();
    }
    // Put the step box beside the highlight (or below it), clear of the builder's own bars in live mode.
    function placePop() {
      const r = unionRect(shown);
      const w = layer.clientWidth;
      const top0 = live ? $('.ws-top').getBoundingClientRect().bottom + 8 : 8;
      const bottom = layer.clientHeight - (live ? $('.story').offsetHeight : 0) - 8;
      const beside = r.left + r.width + 340 < w;
      const left = beside ? r.left + r.width + 14 : Math.max(live ? 70 : 8, Math.min(r.left, w - 328));
      const top = beside ? r.top : r.top + r.height + 14;
      Object.assign(pop.style, { left: left + 'px', top: Math.max(top0, Math.min(top, bottom - pop.offsetHeight)) + 'px' });
    }

    // The tour's step box: header band, body (full-width image, title, text), footer band.
    function stepBox({ n, total, editable }) {
      const box = document.createElement('div');
      box.className = 'tbox';
      const edit = (ph) => (editable ? `contenteditable data-placeholder="${ph}"` : '');
      box.innerHTML = `
        <div class="tb-head"><span>Step ${n} of ${total}</span><button class="close" aria-label="Close">×</button></div>
        <div class="tb-body">
          <div class="tb-img"></div>
          <div class="tb-pad">
            <${style.titleTag} class="tb-title" ${edit('Step title')}></${style.titleTag}>
            <div class="tb-text" ${edit('What should people know here?')}></div>
          </div>
        </div>
        <div class="tb-foot"><button class="back" style="visibility:${n > 1 ? 'visible' : 'hidden'}">Back</button><span class="tb-advance"></span></div>`;
      return box;
    }
    function setImage(box, src, onRemove) {
      const slot = box.querySelector('.tb-img');
      slot.replaceChildren();
      if (!src) return;
      slot.append(Object.assign(document.createElement('img'), { src, alt: '' }));
      if (onRemove) {
        const rm = Object.assign(document.createElement('button'), { className: 'rm', textContent: 'Remove image' });
        rm.onclick = onRemove;
        slot.append(rm);
      }
    }
    function setAdvance(box, advanceOn, last, onNext) {
      const slot = box.querySelector('.tb-advance');
      slot.replaceChildren();
      if (advanceOn === 'next') {
        const b = Object.assign(document.createElement('button'), { className: 'tb-next', textContent: last ? 'Done' : 'Next' });
        if (onNext) b.onclick = onNext;
        slot.append(b);
      } else {
        slot.append(Object.assign(document.createElement('span'), { className: 'tb-hint', textContent: advanceOn === 'click' ? 'Click the highlighted item' : 'Type to continue' }));
      }
    }

    function openEditor(els, step) {
      const all = state.flow.filter((i) => i.type === 'step');
      const n = all.indexOf(state.flow[state.active]) + 1;
      pop = document.createElement('div');
      pop.className = 'pop';
      pop.innerHTML = `
        <div class="fmt">
          <button data-cmd="bold" title="Bold"><b>B</b></button>
          <button data-cmd="italic" title="Italic"><i>I</i></button>
          <button data-cmd="underline" title="Underline"><u>U</u></button>
          <button data-cmd="insertUnorderedList" title="Bullet list">•≡</button>
          <input type="color" title="Text color" value="#1665d8">
          <span class="sep"></span>
          <button data-img title="Add image">🖼 Image</button>
          <input type="file" accept="image/*" hidden>
        </div>`;
      const box = stepBox({ n, total: all.length, editable: true });
      pop.append(box);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `
        <label>Continue when: <select>${Object.entries(ADVANCE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <span>Anchored to <code></code></span>
        <div class="row"><button class="link" data-cancel>Cancel</button><button class="save" data-save>Save step</button></div>`;
      pop.append(meta);
      layer.append(pop);

      const title = () => box.querySelector('.tb-title'); // re-read: changing the title size swaps the element
      const text = box.querySelector('.tb-text');
      const advance = meta.querySelector('select');
      title().innerHTML = step ? step.titleHtml : '';
      text.innerHTML = step ? step.textHtml : '';
      let image = step ? step.image : null;
      const showImage = () => { setImage(box, image, () => { image = null; showImage(); }); placePop(); };
      showImage();
      const single = els.length === 1;
      advance.value = step ? step.advanceOn : single && els[0].matches('input') ? 'type' : 'next';
      const showAdvance = () => setAdvance(box, advance.value, n === all.length);
      advance.onchange = showAdvance;
      showAdvance();
      const target = single ? targetFor(els[0]) : els.map(targetFor);
      const show = (t) => (typeof t === 'string' ? t : `text “${t.text}”`);
      meta.querySelector('code').textContent = single ? show(target) : `${els.length} items: ${target.map(show).join(', ')}`;

      pop.querySelectorAll('[data-cmd]').forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); document.execCommand(b.dataset.cmd); }));
      pop.querySelector('.fmt input[type=color]').oninput = (e) => document.execCommand('foreColor', false, e.target.value);
      const file = pop.querySelector('input[type=file]');
      pop.querySelector('[data-img]').onclick = () => file.click();
      file.onchange = () => {
        const f = file.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => { image = reader.result; showImage(); };
        reader.readAsDataURL(f);
      };
      // Cancel keeps an unfinished step active so you can pick something else; it leaves a saved step as it was.
      meta.querySelector('[data-cancel]').onclick = () => {
        clearSelection();
        if (!state.flow[state.active].draft) state.active = null;
        renderStory();
      };
      meta.querySelector('[data-save]').onclick = () => {
        if (!title().innerText.trim()) return toast('Give the step a title.');
        const page = state.flow[state.active].page;
        state.flow[state.active] = { type: 'step', page, els, target, label: single ? labelFor(els[0]) : `${els.length} items`, titleHtml: title().innerHTML, textHtml: text.innerHTML, image, advanceOn: advance.value };
        state.active = null;
        clearSelection();
        renderStory();
        toast('Step saved. Click + Step to add another, or + Page to move to another page.');
      };
      placePop();
      title().focus();
    }

    function clearSelection() {
      pop?.remove();
      selBox?.remove();
      pop = selBox = shown = null;
    }

    // ---------- storyboard ----------
    function renderStory() {
      const story = $('.story');
      story.replaceChildren();
      let stepNo = 0;
      state.flow.forEach((item, i) => {
        if (i > 0) story.append(Object.assign(document.createElement('span'), { className: 'arrow', textContent: '→' }));
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        if (item.type === 'page') {
          const next = state.flow.slice(i + 1).findIndex((x) => x.type === 'page');
          const n = (next === -1 ? state.flow.slice(i + 1) : state.flow.slice(i + 1, i + 1 + next)).filter((x) => x.type === 'step').length;
          card.classList.add('page-card');
          card.title = 'Go to this page';
          card.innerHTML = `<div class="n">${i === 0 ? 'Start page' : 'Page'}</div><div class="t"></div><div class="chips"><span class="chip">${n} step${n === 1 ? '' : 's'}</span></div>`;
          card.querySelector('.t').textContent = item.path;
          card.onclick = () => app.navigate(item.path);
        } else {
          stepNo++;
          card.classList.toggle('on', state.active === i);
          card.classList.toggle('draft', !!item.draft);
          card.innerHTML = `<div class="n">Step ${stepNo}</div><div class="t"></div><div class="chips"></div>`;
          if (item.draft) {
            card.querySelector('.t').textContent = 'Pick something to highlight…';
          } else {
            const tmp = document.createElement('div');
            tmp.innerHTML = item.titleHtml;
            card.querySelector('.t').textContent = tmp.textContent;
            card.querySelector('.chips').append(
              Object.assign(document.createElement('span'), { className: 'chip', textContent: item.label }),
              Object.assign(document.createElement('span'), { className: 'chip', textContent: ADVANCE[item.advanceOn] })
            );
          }
          card.onclick = () => activate(i);
        }
        if (i > 0) {
          const x = Object.assign(document.createElement('button'), { className: 'x', title: 'Remove', textContent: '×' });
          x.onclick = (e) => { e.stopPropagation(); removeItem(i); };
          card.append(x);
        }
        story.append(card);
      });

      const adders = document.createElement('div');
      adders.className = 'adders';
      const addStepBtn = Object.assign(document.createElement('button'), { className: 'add', textContent: '+ Step' });
      addStepBtn.onclick = addStep;
      adders.append(addStepBtn);
      if (state.addingPage) {
        const form = document.createElement('form');
        form.className = 'add-page';
        const here = app.path();
        const input = Object.assign(document.createElement('input'), { placeholder: 'Page path, e.g. /leases', required: true, value: here && here !== currentPage() ? here : '' });
        input.onkeydown = (e) => { if (e.key === 'Escape') { state.addingPage = false; renderStory(); } };
        form.onsubmit = (e) => { e.preventDefault(); state.addingPage = false; addPage(input.value.trim()); };
        form.append(input);
        adders.append(form);
        setTimeout(() => input.focus());
      } else {
        const addPageBtn = Object.assign(document.createElement('button'), { className: 'add', textContent: '+ Page' });
        addPageBtn.onclick = () => { state.addingPage = true; renderStory(); };
        adders.append(addPageBtn);
      }
      story.append(Object.assign(document.createElement('span'), { className: 'arrow', textContent: '→' }));
      story.append(adders);
      rootEl.classList.toggle('picking', canPick());
      save();
    }

    // ---------- preview ----------
    let previewRun = 0;
    // Demo only. Test on: the demo (here) or live DoorLoop (a new tab, run by the DoorLoop Tours extension).
    const testSeg = $('.test-seg');
    if (testSeg) testSeg.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.testOn = b.dataset.v;
      testSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const toLive = state.testOn === 'live';
      $('.preview-btn').textContent = toLive ? '▶ Preview on DoorLoop' : '▶ Preview';
      $('.preview-btn').classList.toggle('live-preview', toLive);
      showPage(app.path() || currentPage());
      if (toLive) toast(steps().length ? 'Click “Preview on DoorLoop” to run this tour in a new DoorLoop tab.' : 'Add a step, then click “Preview on DoorLoop” to run it in a new DoorLoop tab.');
    };
    $('.preview-btn').onclick = () => {
      if (!steps().length) return toast('Add a step first: click + Step in the storyboard, pick something, and save it.');
      if (!live && state.testOn === 'live') return previewOnDoorLoop();
      clearSelection();
      state.active = null;
      state.previewing = true;
      renderStory();
      showPreview(0);
    };
    function endPreview(msg) {
      previewRun++;
      state.previewing = false;
      clearSelection();
      renderStory();
      if (msg) toast(msg);
    }
    async function showPreview(i) {
      clearSelection();
      const all = steps();
      if (i >= all.length) return endPreview('End of tour.');
      const run = ++previewRun;
      const s = all[i];
      if (i > 0 && s.page !== all[i - 1].page) toast(`The tour moves to ${s.page}`);
      showPage(s.page);
      const els = await elsFor(s);
      if (run !== previewRun || !state.previewing) return;
      if (!els) {
        toast(`Couldn't find “${s.label}” on ${s.page}; skipping it.`);
        return showPreview(i + 1);
      }
      highlight(els);
      pop = document.createElement('div');
      pop.className = 'pop';
      const box = stepBox({ n: i + 1, total: all.length, editable: false });
      pop.append(box);
      box.querySelector('.tb-title').innerHTML = s.titleHtml;
      box.querySelector('.tb-text').innerHTML = s.textHtml;
      setImage(box, s.image);
      box.querySelector('.back').onclick = () => showPreview(i - 1);
      box.querySelector('.close').onclick = () => endPreview();
      const go = () => showPreview(i + 1);
      setAdvance(box, s.advanceOn, i === all.length - 1, go);
      if (s.advanceOn === 'click') {
        selBox.style.pointerEvents = 'auto';
        selBox.style.cursor = 'pointer';
        selBox.onclick = go;
      } else if (s.advanceOn === 'type') {
        const input = Object.assign(document.createElement('input'), { className: 'tb-typed', placeholder: 'Type here, then press Enter' });
        input.onkeydown = (e) => e.key === 'Enter' && input.value.trim() && go();
        box.querySelector('.tb-pad').append(input);
      }
      layer.append(pop);
      placePop();
    }

    // ---------- tour file ----------
    // The storyboard as a tour file. For a live test the tour engine has to run it as-is, so images stay embedded
    // and anything the engine doesn't support yet is simplified (and listed in `changes`).
    function buildTour(forEngine) {
      const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.trim(); };
      const id = (forEngine ? 'draft-' : '') + state.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      // Record pages (/tenants/t1, /tenants/64f1c...) become patterns (/tenants/*) so the step works for any record.
      const general = (path) => path.split('/').map((seg) => (/^([a-z]\d+|\d+|[0-9a-f]{8,}|[0-9a-f-]{20,})$/i.test(seg) ? '*' : seg)).join('/');
      const start = state.flow[0].path;
      const changes = new Set();
      const tour = {
        id,
        title: state.name,
        page: start,
        // Same field names the tour engine and the build check use.
        style: {
          ...Object.fromEntries([...$$('.style-panel input')].map((i) => [STYLE_FIELDS[i.dataset.var], i.type === 'range' ? +i.value : i.value])),
          titleSize: style.titleTag,
          titleAlign: style.titleAlign,
          textAlign: style.textAlign,
        },
        steps: steps().map((s, i) => {
          let target = s.target;
          let advanceOn = s.advanceOn;
          if (forEngine && Array.isArray(target)) {
            target = target[0];
            changes.add('groups highlight their first item');
          }
          if (forEngine && advanceOn === 'type') {
            advanceOn = 'next';
            changes.add('"type text" steps use a Next button');
          }
          const formatted = /<(b|i|u|ul|font|span)\b/.test(s.textHtml);
          if (forEngine && formatted) changes.add('text formatting is left out');
          return {
            ...(s.page !== start ? { page: general(s.page) } : {}),
            target,
            title: plain(s.titleHtml),
            text: plain(s.textHtml),
            ...(advanceOn !== 'next' ? { advanceOn } : {}),
            ...(!forEngine && formatted ? { formattedText: '(formatting kept)' } : {}),
            ...(s.image ? { image: forEngine ? s.image : `images/${id}-step-${i + 1}.png` } : {}),
          };
        }),
      };
      return { tour, changes: [...changes] };
    }
    $('.file-btn').onclick = () => {
      const { tour } = buildTour(false);
      const drafts = state.flow.filter((i) => i.draft).length;
      $('.file-out').textContent =
        JSON.stringify(tour, null, 2) +
        '\n\n// Uploaded images would be saved next to the tour as the "image" path shown.' +
        '\n// Not in the tour format yet: "formattedText", advanceOn "type", and a list as "target" (groups).' +
        (drafts ? '\n// Steps with nothing highlighted yet are left out.' : '');
      $('.filebox').hidden = false;
    };
    $('.file-close').onclick = () => ($('.filebox').hidden = true);
    $('.copy-btn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(buildTour(false).tour, null, 2));
        toast('Tour file copied.');
      } catch {
        toast("Couldn't copy. Select the text and copy it instead.");
      }
    };

    // Demo only: open DoorLoop in a tab and hand it the draft (see sendToDoorLoop).
    function previewOnDoorLoop() {
      const { tour, changes } = buildTour(true);
      const ok = sendToDoorLoop(tour.page, 'doorloop-tour-test', { type: 'tour-layer:draft', tour }, () => toast('Tour started on DoorLoop. Switch to that tab.'));
      if (!ok) return toast('Your browser blocked the new tab. Allow pop-ups for this page and try again.');
      toast(changes.length ? `Opening DoorLoop. For this test, ${changes.join('; ')}.` : 'Opening DoorLoop…');
    }

    // ---------- live mode: keep the draft across page reloads ----------
    function save() {
      if (!live || closed) return;
      const flow = state.flow.map(({ els, ...rest }) => rest); // elements can't be saved; targets find them again
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        name: state.name, flow, style,
        inputs: Object.fromEntries([...$$('.style-panel input')].map((i) => [i.dataset.var, i.value])),
      }));
    }
    function restore(saved) {
      state.name = saved.name;
      state.flow = saved.flow;
      Object.assign(style, saved.style);
      $$('.style-panel input').forEach((i) => { if (saved.inputs[i.dataset.var] !== undefined) i.value = saved.inputs[i.dataset.var]; });
      $$('.style-panel .seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === style[seg.dataset.key])));
    }

    function close(silent) {
      if (!silent && steps().length && !window.confirm('Close the builder? Copy the tour file first if you want to keep this tour.')) return;
      closed = true;
      clearInterval(pathTimer);
      listeners.forEach((off) => off());
      window.removeEventListener('mouseup', onMouseUp);
      if (live) sessionStorage.removeItem(SESSION_KEY);
      hideLauncher?.remove();
      host.remove();
      if (current && current.host === host) current = null;
      options.onClose?.();
    }
    $('.close-btn').onclick = () => close(false);

    // ---------- start ----------
    if (options.restore) restore(options.restore);
    $('.ws-name').textContent = state.name;
    applyStyle();
    renderStory();
    showPage(live ? app.path() : currentPage());
    if (live) {
      toast(options.restore ? 'Builder restored. Your draft is still here.' : 'Building on live DoorLoop. Click + Step, then click what it should highlight.');
    } else {
      app.navigate(currentPage()).then(() => toast('Browse the demo if you like. Click + Step in the storyboard to add the first step.'));
    }

    return { host, close };
  }

  // Open DoorLoop in a named tab and keep posting a message until the DoorLoop Tours extension answers.
  // The tab starts on app.doorloop.com and redirects to your account's address, where the extension runs,
  // so its exact origin isn't known here.
  const sends = {};
  function sendToDoorLoop(path, tabName, message, onAnswer) {
    const tab = window.open(`https://app.doorloop.com${path}`, tabName);
    if (!tab) return false;
    const id = String(Date.now());
    clearInterval(sends[tabName]);
    let tries = 0;
    sends[tabName] = setInterval(() => {
      if (tab.closed || ++tries > 80) return clearInterval(sends[tabName]);
      tab.postMessage({ ...message, id }, '*');
    }, 750);
    const onMessage = (e) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*app\.doorloop\.com$/.test(e.origin) || !e.data || e.data.id !== id) return;
      clearInterval(sends[tabName]);
      window.removeEventListener('message', onMessage);
      onAnswer();
    };
    window.addEventListener('message', onMessage);
    return true;
  }

  window.TourBuilder = { open, savedSession, sendToDoorLoop };
})();
