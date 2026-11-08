// Tour builder: build tours visually on top of an app.
//   demo: on the builder page, with the demo app in a frame (TourBuilder.open({ mode: 'demo', ... })).
//   live: on DoorLoop itself, opened by the DoorLoop Tours extension (TourBuilder.open({ mode: 'live', ... })).
// The UI lives in a shadow root, so the app's CSS and the builder's CSS can't affect each other.
(function () {
  'use strict';
  if (window.TourBuilder) return;

  const PICKABLE = '[data-cy], [data-testid], [data-intercom-target], [data-item-id], [aria-label], [role=tab], [role=checkbox], [role=switch], button, a, input, textarea, tr, h1';
  const LABELLED = '[data-cy], [data-testid], [data-intercom-target], [data-item-id], [data-section-value]';
  const REPO = 'https://github.com/shuang-dl/product-tour-layer'; // where tours are published from
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
      --panel-w: 340px; /* PANEL_W in the docking code */
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
    .ws-top { grid-column: 1 / -1; position: relative; z-index: 7; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--card); }
    .ws-top strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
    .ws-top .url { flex: 1; min-width: 0; font-size: 13px; color: var(--muted); background: var(--bg); border-radius: 6px; padding: 5px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ws-top > button { white-space: nowrap; }
    .ws-top .test-on { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); white-space: nowrap; }
    .tools { border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; padding: 8px; background: var(--card); }
    .tool { width: 40px; height: 40px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 16px; display: grid; place-items: center; position: relative; }
    .tool:hover { background: var(--bg); }
    .tool.on { background: var(--accent); color: #fff; }
    .live .tool[data-tip]:hover::after { left: auto; right: 48px; }
    .tool[data-tip]:hover::after { content: attr(data-tip); position: absolute; left: 48px; white-space: nowrap; background: #222; color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 6px; z-index: 5; }
    .tools hr { width: 100%; border: 0; border-top: 1px solid var(--border); margin: 4px 0; }
    .stage { position: relative; overflow: auto; background: #e9edf3; padding: 16px; }
    .stage-inner { position: relative; min-width: 1100px; height: 100%; min-height: 560px; }
    .frame { display: block; width: 100%; height: 100%; border: 0; border-radius: 8px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
    .story { grid-column: 1 / -1; border-top: 1px solid var(--border); padding: 10px 14px; display: flex; gap: 8px; align-items: stretch; overflow-x: auto; min-height: 112px; background: var(--card); }

    /* live: one panel on the right with the controls, tools and storyboard; it slides away to show the page */
    .live .ws { position: fixed; top: 0; right: 0; bottom: 0; width: var(--panel-w); display: flex; flex-direction: column; background: var(--card); border-left: 1px solid var(--border); box-shadow: -6px 0 24px rgba(0,0,0,.14); pointer-events: auto; z-index: 3; transition: right .2s, visibility 0s; }
    .live.story-collapsed .ws { right: calc(-1 * var(--panel-w) - 30px); visibility: hidden; transition: right .2s, visibility 0s .2s; }
    .live .ws-top { flex-wrap: wrap; gap: 8px; padding: 12px 14px; }
    .live .ws-top .badge { order: 0; font-size: 11px; font-weight: 600; background: var(--accent); color: #fff; border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
    .live .ws-top .story-btn { order: 1; margin-left: auto; }
    .live .ws-top .close-btn { order: 2; }
    .live .ws-top .ws-name { order: 3; flex: 1 0 100%; max-width: none; font-size: 15px; }
    .live .ws-top .url { order: 4; flex: 1 0 100%; }
    .live .ws-top .record-btn, .live .ws-top .preview-btn, .live .ws-top .save-btn, .live .ws-top .more-wrap { order: 5; }
    .live .ws-top .record-btn { flex: 1 0 100%; }
    .live .tools { flex-direction: row; flex-wrap: wrap; border-right: 0; border-bottom: 1px solid var(--border); padding: 6px 10px; position: relative; z-index: 4; }
    .live .tools hr { width: 1px; height: auto; align-self: stretch; margin: 4px 2px; border: 0; border-left: 1px solid var(--border); }
    .live .tool[data-tip]:hover::after { left: 0; right: auto; top: 44px; }
    .live .story { flex: 1; min-height: 0; flex-direction: column; align-items: stretch; overflow-x: hidden; overflow-y: auto; border-top: 0; padding: 12px 14px; }
    .live .story .card { flex: 0 0 auto; }
    .live .story .ins { align-self: center; }
    .live .story .arrow { align-self: center; transform: rotate(90deg); }
    .live .story .card.drop-here { box-shadow: 0 -4px 0 var(--accent); }
    .live .story .adders { flex-direction: row; flex-wrap: wrap; justify-content: flex-start; }
    .live .story .add-page input { width: 100%; }
    .panel-tab { display: none; position: fixed; right: 0; top: 50%; transform: translateY(-50%); writing-mode: vertical-rl; background: var(--accent); color: #fff; border: 0; border-radius: 8px 0 0 8px; padding: 12px 6px; font-weight: 600; pointer-events: auto; z-index: 3; box-shadow: -4px 0 14px rgba(0,0,0,.2); }
    .live.story-collapsed .panel-tab { display: block; }

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
    .pop .meta .anchor { gap: 8px; }
    .pop .meta .anchor span { min-width: 0; }
    .pop .meta .anchor .link { white-space: nowrap; }
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
    .ins { align-self: center; flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; border: 1px dashed var(--border); background: var(--card); color: var(--muted); font-size: 14px; line-height: 1; padding: 0; }
    .ins:hover { border-style: solid; border-color: var(--accent); color: var(--accent); }
    .card.dragging { opacity: .4; }
    .card.drop-here { box-shadow: -4px 0 0 var(--accent); }
    .story-collapsed .story { display: none; }
    .pop .meta .opt { display: flex; align-items: center; gap: 6px; }
    .more-wrap { position: relative; }
    .more-menu { position: absolute; top: calc(100% + 6px); right: 0; background: var(--card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.15); padding: 6px; display: grid; gap: 2px; z-index: 5; white-space: nowrap; font-size: 13px; }
    .more-menu[hidden] { display: none; }
    .more-menu label { display: flex; align-items: center; gap: 6px; padding: 4px 8px; color: var(--text); }
    .more-menu hr { border: 0; border-top: 1px solid var(--border); margin: 4px 0; width: 100%; }
    .more-menu .export-menu { display: grid; }
    .more-menu button { background: none; border: 0; text-align: left; padding: 6px 8px; border-radius: 6px; font: inherit; color: var(--text); }
    .more-menu button:hover { background: var(--bg); }
    .record-btn.on { color: #c62828; border-color: #c62828; font-weight: 600; }
    .tour-status { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); white-space: nowrap; }
    .tour-status select { font: inherit; font-size: 12px; padding: 2px; border-radius: 6px; }
    .dock-opt { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); white-space: nowrap; }
    .auto-start { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); white-space: nowrap; }
    .pop .meta .sample { border-top: 1px solid var(--border); padding-top: 6px; display: grid; gap: 4px; }
    .pop .meta .sample .rec { color: #c62828; font-weight: 600; }
    .sample-list, .exit-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
    .sample-list li, .exit-list li { display: flex; align-items: center; gap: 6px; }
    .sample-list li > span:first-child, .exit-list li > span:first-child { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); max-width: 45%; }
    .sample-list input { flex: 1; min-width: 0; font: inherit; font-size: 12px; padding: 2px 4px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
    .sample-list small { color: var(--muted); }
    .sample-list li.empty, .exit-list li.empty { color: var(--muted); font-style: italic; }
    .sample-list .rm, .exit-list .rm { margin-left: auto; background: none; border: 0; color: var(--muted); padding: 0 4px; }
    .tb-fill { background: none; color: inherit; border: 1px solid currentColor; border-radius: 6px; font: inherit; font-size: 12px; padding: 3px 8px; margin-left: auto; }
    .tb-fill + .tb-advance { margin-left: 0; }
    .card.page-card { flex-basis: 140px; border-style: dashed; border-color: var(--border); }
    .card.draft { border-style: dashed; border-color: var(--accent); }
    .card.draft .t { color: var(--muted); font-weight: 500; font-style: italic; }
    .adders { flex: 0 0 auto; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
    .add { border: 2px dashed var(--border); background: transparent; color: var(--accent); border-radius: 10px; padding: 7px 14px; font-weight: 600; white-space: nowrap; }
    .add:hover { border-color: var(--accent); }
    .add-page input { width: 170px; padding: 7px 10px; border: 2px solid var(--accent); border-radius: 10px; background: var(--card); color: var(--text); font: inherit; font-size: 13px; }

    /* panels and overlays */
    .panel { position: absolute; left: 64px; top: 56px; max-height: calc(100% - 190px); overflow-y: auto; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.2); z-index: 6; width: 270px; font-size: 13px; pointer-events: auto; }
    .live .panel { position: fixed; left: auto; right: calc(var(--panel-w) + 12px); top: 12px; max-height: calc(100vh - 24px); }
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
    .filebox pre { margin: 0; padding: 16px; overflow: auto; flex: 1; font-size: 12px; outline: none; }
    .filebox .file-notes { margin: 0; padding: 10px 16px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); white-space: pre-line; }
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
        ${live ? LAYERS + '<button class="panel-tab" title="Show the builder">Show builder</button>' : '<div class="backdrop"></div>'}
        <div class="ws">
          <div class="ws-top">
            ${live ? '<span class="badge">Building on live DoorLoop</span>' : ''}
            <strong class="ws-name"></strong>
            <span class="url"></span>
            ${live ? '' : '<span class="test-on">Test on <span class="seg test-seg"><button data-v="demo" class="on">Demo</button><button data-v="live">Live DoorLoop</button></span></span>'}
            <button class="ghost story-btn" title="${live ? 'Slide the builder away to see the whole page' : 'Show or hide the storyboard'}">${live ? 'Hide ▸' : 'Storyboard ▾'}</button>
            <button class="ghost record-btn" title="Click through the workflow; each click or typed value becomes a step">● Record tour</button>
            <button class="ghost preview-btn">▶ Preview</button>
            <button class="ghost save-btn" title="Save this tour to GitHub (sign in from the extension's menu first)">💾 Save tour</button>
            <span class="more-wrap"><button class="ghost more-btn" title="Status, starting by itself, the tour file, export">⋯ More</button>
              <span class="more-menu" hidden>
                <label class="tour-status" title="Drafts only show for people with Show drafts on; Live tours show for everyone">Status <select><option value="draft">Draft</option><option value="live">Live</option></select></label>
                ${live ? '<label class="dock-opt" title="Narrow DoorLoop so the panel sits beside it instead of covering it"><input type="checkbox"> Keep DoorLoop beside the panel</label>' : ''}
                <label class="auto-start" title="Open this tour by itself the first time someone visits its start page (once per browser)"><input type="checkbox"> Start by itself once</label>
                <hr>
                <button class="file-btn">View tour file</button>
                <span class="export-menu"><button data-kind="video">Export video</button><button data-kind="gif">Export GIF (a frame per step)</button></span>
              </span>
            </span>
            <button class="ghost close-btn">Close</button>
          </div>
          <div class="tools">
            <button class="tool on" data-tool="pointer" data-tip="Pointer: click an element">↖</button>
            <button class="tool" data-tool="box" data-tip="Box: draw around an area">▭</button>
            <button class="tool text-tool" data-tip="Text: edit the step's text">T</button>
            <button class="tool style-tool" data-tip="Tour style">◐</button>
            <button class="tool exit-tool" data-tip="Leaving without saving">⎋</button>
            <hr>
            <button class="tool undo-tool" data-tip="Remove last storyboard item">↶</button>
          </div>
          ${live ? '' : `<div class="stage"><div class="stage-inner"><iframe class="frame" title="Demo app"></iframe>${LAYERS}</div></div>`}
          <div class="story"></div>
          <div class="panel style-panel" hidden>${STYLE_PANEL}</div>
          <div class="panel exit-panel" hidden>
            <h3>Leaving without saving<small>When a tour ends after someone used Fill example, these are clicked in order so the sample data isn't saved (e.g. Cancel, then the Discard button it opens).</small></h3>
            <ol class="exit-list"></ol>
            <button class="ghost exit-pick">+ Pick a button</button>
          </div>
        </div>
        <div class="filebox" hidden>
          <header><strong>Tour file</strong><button class="ghost copy-btn">Copy</button><button class="ghost gh-btn">Save to GitHub</button><button class="ghost file-close">Close</button></header>
          <pre class="file-out" tabindex="0"></pre>
          <p class="file-notes"></p>
        </div>
        <div class="toast" role="status" hidden></div>
      </div>`;
    // On live DoorLoop the builder sits outside <body>, so shrinking the body (see dock) doesn't shrink the builder.
    (live ? document.documentElement : document.body).append(host);
    // Keep the builder's own presses, typing and focus changes from reaching the app. Otherwise an open app
    // dialog sees them as "outside" and pulls focus back to itself or closes.
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'focusin', 'focusout', 'keydown', 'keyup', 'keypress']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    // A dialog's focus trap also watches its own fields losing focus and takes focus back when it goes outside.
    // That event fires on the app's field, so catch it first when focus is moving into the builder.
    const keepFocus = (e) => {
      if (e.relatedTarget && (e.relatedTarget === host || host.contains(e.relatedTarget))) e.stopPropagation();
    };
    window.addEventListener('focusout', keepFocus, true);
    const rootEl = $('.root');
    const layer = $('.layer');

    // While building on DoorLoop, hide the tour launcher so it doesn't get in the way.
    const hideLauncher = live ? Object.assign(document.createElement('style'), { textContent: '.tour-layer-launcher { display: none !important; }' }) : null;
    if (hideLauncher) document.head.append(hideLauncher);

    // Docking: while the panel is open, DoorLoop's <body> is narrowed to end where the panel starts. "contain: layout"
    // makes the body the box that DoorLoop's fixed-position dialogs, drawers and dropdowns place themselves in, so they
    // stop at the panel's edge too. DoorLoop's CSS breakpoints still see the real window width. Can be switched off
    // under More (remembered per browser).
    const DOCK_KEY = 'tourLayer.dock';
    const PANEL_W = 340;
    const dockStyle = live ? Object.assign(document.createElement('style'), { textContent: `
      html.tour-layer-docked { overflow: hidden !important; }
      html.tour-layer-docked > body { width: auto !important; margin-right: ${PANEL_W}px !important; height: 100vh !important;
        overflow-x: hidden !important; overflow-y: auto !important; contain: layout !important; }` }) : null;
    if (dockStyle) document.head.append(dockStyle);
    const dockWanted = () => { try { return localStorage.getItem(DOCK_KEY) !== 'off'; } catch { return true; } };
    function dock() {
      if (!live) return;
      const on = !closed && dockWanted() && !rootEl.classList.contains('story-collapsed');
      if (document.documentElement.classList.contains('tour-layer-docked') === on) return;
      document.documentElement.classList.toggle('tour-layer-docked', on);
      window.dispatchEvent(new Event('resize')); // let DoorLoop re-measure its layout and open menus
    }
    // A drawer sliding in from the right starts past the body's edge; focusing it would scroll the body sideways and
    // shift the whole page (seen with the Wallet's Transfer funds). While docked, the body never scrolls sideways.
    const noSidewaysScroll = () => {
      if (document.documentElement.classList.contains('tour-layer-docked') && document.body.scrollLeft) document.body.scrollLeft = 0;
    };
    if (live) document.addEventListener('scroll', noSidewaysScroll, true);

    // flow: the storyboard, in order. { type: 'page', path } or { type: 'step', page, draft?, els, target, ... }.
    // active: index of the step being picked or edited; highlighting only works while a step is active.
    // id: kept from the tour file when editing an existing tour, so the edited file replaces the original.
    // exitClicks: targets clicked when a tour that filled in sample data ends. recording: sample data being recorded
    // for the step in the editor; pickingExit: the next click on the app picks an exit click.
    const state = { name: options.name, id: null, flow: [{ type: 'page', path: options.startPath }], tool: 'pointer', active: null, previewing: false, addingPage: false, testOn: 'demo', exitClicks: [], recording: null, pickingExit: false };
    // In Preview, the elements of a "click the highlighted item" step, whose clicks reach the app
    let previewClick = null;
    const previewClickHit = (e) => !!(state.previewing && previewClick && previewClick.els.some((el) => el.contains(e.target)));
    const style = { titleTag: 'h2', titleAlign: 'left', textAlign: 'left' };
    let closed = false;

    function toast(msg, ms = 3200) {
      const t = $('.toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => (t.hidden = true), ms);
    }
    const pathOf = (url) => { try { return new URL(url).pathname; } catch { return url.startsWith('/') ? url : '/' + url; } };
    const currentPage = () => [...state.flow].reverse().find((i) => i.type === 'page').path;
    // "/tenants" matches exactly; "*" matches one path segment, e.g. "/tenants/*" (same rule as the tour engine).
    const matches = (pattern, path) => !!path &&
      new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '/?$').test(path);
    const pageAt = (index) => [...state.flow.slice(0, index)].reverse().find((i) => i.type === 'page').path;
    // After cards move or go away, each step belongs to the page card before it.
    function repage() {
      let page = state.flow[0].path;
      for (const item of state.flow) {
        if (item.type === 'page') page = item.path;
        else item.page = page;
      }
    }
    const steps = () => state.flow.filter((i) => i.type === 'step' && !i.draft);
    // Move the storyboard to a page. An empty page card at the end is reused rather than piling up cards
    // (keepStart: + Page never changes where the tour starts), and two cards for the same page in a row merge.
    function pageCard(path, keepStart) {
      if (matches(currentPage(), path) && !keepStart) return;
      const last = state.flow[state.flow.length - 1];
      if (last.type !== 'page' || (keepStart && state.flow.length === 1)) {
        if (path !== currentPage()) state.flow.push({ type: 'page', path });
        return;
      }
      last.path = path;
      const before = state.flow.slice(0, -1).reverse().find((i) => i.type === 'page');
      if (before && before.path === path) state.flow.pop();
    }
    const showPage = (path) => ($('.url').textContent = live
      ? `${location.host}${path}`
      : `app.doorloop.com${path}  (demo app)` + (state.testOn === 'live' ? '  ·  Preview runs on live DoorLoop' : ''));

    // ---------- the app being built on: the framed demo, or this page itself ----------
    const frame = $('.frame');
    const app = live
      ? {
          doc: () => document,
          path: () => location.pathname,
          // Move DoorLoop the way its own menu does: click its link to that page (an in-app page change).
          // With no such link, load the page; the extension brings the builder back with the draft.
          async navigate(path) {
            if (location.pathname === path) return;
            const link = [...document.querySelectorAll('a[href]')].find((a) => a.origin === location.origin && a.pathname === path && !host.contains(a));
            if (link) {
              navigating = true;
              link.click();
              navigating = false;
              for (let i = 0; i < 30 && location.pathname !== path; i++) await sleep(100);
              await sleep(400);
              return;
            }
            save();
            location.assign(path);
            await new Promise(() => {}); // the page is unloading
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
    // A page pattern like /tenants/* can't be opened directly; you open a matching page yourself.
    let missingPage = null;
    async function goToPage(path) {
      if (!path.includes('*')) return app.navigate(path), true;
      if (matches(path, app.path())) return true;
      missingPage = path;
      toast(`Open a page that matches ${path} first (for example one record), then click it again.`);
      return false;
    }
    let navigating = false; // the builder itself is clicking a link to change pages
    // The element under the pointer, or the labelled element wrapped around it when that's about the same size
    // (a form field's wrapper rather than its bare input), so targets use stable labels.
    const pickable = (node) => {
      let el = node.closest && node.closest(PICKABLE);
      if (!el || el === app.doc().body || host.contains(el)) return null;
      const wrap = el.matches(LABELLED) ? null : el.parentElement && el.parentElement.closest(LABELLED);
      if (wrap && !host.contains(wrap)) {
        const a = el.getBoundingClientRect(), b = wrap.getBoundingClientRect();
        if (b.width * b.height <= a.width * a.height * 3) el = wrap;
      }
      return el;
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
        if (inBuilder(e) || navigating) return;
        if (state.recordingTour) return recordTourClick(e);
        if (state.recording) return recordClick(e);
        if (state.pickingExit) {
          e.preventDefault();
          e.stopPropagation();
          const el = pickable(e.target);
          if (el) addExitClick(el);
          return;
        }
        if (previewClickHit(e)) {
          const go = previewClick.go;
          previewClick = null;
          setTimeout(go, 300); // like the tour engine: let the click open its menu or dialog first
          return;
        }
        if (state.previewing || (canPick() && state.tool === 'pointer')) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (state.previewing || !canPick() || state.tool !== 'pointer') return;
        const el = pickable(e.target);
        if (el) select([el]);
      }, true);
      on('scroll', refreshOverlay, true);
      on('input', recordInput, true);
      on('input', recordTourInput, true);
      // Apps open menus and dialogs as the mouse button goes down, before the click, so block the whole press.
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart']) {
        on(type, (e) => {
          if (inBuilder(e) || navigating || previewClickHit(e)) return;
          if (state.previewing || (canPick() && state.tool === 'pointer')) {
            e.preventDefault();
            e.stopPropagation();
          }
        }, true);
      }
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
      const own = el.getAttribute('aria-label') || el.innerText.trim().split('\n')[0].slice(0, 28);
      if (own) return own;
      // A checkbox or field with no text of its own: its <label> (e.g. "I authorize this withdrawal ...")
      const label = (el.id && el.ownerDocument.querySelector(`label[for='${window.CSS.escape(el.id)}']`)) || el.closest('label') || el.labels?.[0];
      return label?.innerText.trim().split('\n')[0].slice(0, 60) || el.getAttribute('placeholder') || el.tagName.toLowerCase();
    }
    // Same preference order as the README: data-cy, data-intercom-target, other stable data labels, aria-label,
    // a form field's name, then visible text.
    function selectorsFor(el) {
      const tag = el.tagName.toLowerCase();
      const out = [];
      if (el.dataset.cy) out.push(`[data-cy='${el.dataset.cy}']`);
      if (el.dataset.testid) out.push(`[data-testid='${el.dataset.testid}']`);
      if (el.dataset.intercomTarget) out.push(`[data-intercom-target='${el.dataset.intercomTarget}']`);
      if (el.dataset.itemId) out.push(`[data-item-id='${el.dataset.itemId}']`);
      if (el.dataset.sectionValue) out.push(`${tag}[data-section-value='${el.dataset.sectionValue}']`);
      const aria = el.getAttribute('aria-label');
      if (aria && !/^DLUI_/.test(aria)) out.push(`${tag}[aria-label='${aria}']`);
      if (el.getAttribute('name')) out.push(`${tag}[name='${el.getAttribute('name')}']`);
      // A hand-written id (not a generated one like "radix-:r30:" or ":r35:")
      if (el.id && /^[a-z][a-z0-9_-]*$/i.test(el.id) && !/\d{3,}/.test(el.id)) out.push(`${tag}#${el.id}`);
      if (el.getAttribute('placeholder')) out.push(`${tag}[placeholder='${el.getAttribute('placeholder')}']`);
      return out;
    }
    // Last resort for an element with no label or text: a short path from the nearest labelled element around it
    // (or from <body>), e.g. "[data-testid='WalletMovement'] > div:nth-of-type(2) > textarea". Saved with clues.
    function pathFor(el) {
      const parts = [];
      for (let node = el; node && node !== node.ownerDocument.body; node = node.parentElement) {
        const anchor = node !== el && selectorsFor(node).find((sel) => findsIt(sel, node));
        if (anchor) return [anchor, ...parts].join(' > ');
        const tag = node.tagName.toLowerCase();
        const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : [];
        parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
      }
      return ['body', ...parts].join(' > ');
    }
    // The tour engine uses the match people can see (inside every scrolling area around it), else the first match on
    // the page, so a label shared by several elements only works for that one.
    const isShown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const inView = (e) => {
      const r = e.getBoundingClientRect();
      for (let p = e.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (!/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) continue;
        const pr = p.getBoundingClientRect();
        if (r.bottom <= pr.top || r.top >= pr.bottom || r.right <= pr.left || r.left >= pr.right) return false;
      }
      return true;
    };
    const findsIt = (sel, el) => {
      try {
        const shown = [...el.ownerDocument.querySelectorAll(sel)].filter(isShown);
        return (shown.find(inView) || shown[0]) === el;
      } catch {
        return false;
      }
    };
    function targetFor(el) {
      const own = selectorsFor(el).find((sel) => findsIt(sel, el));
      if (own) return own;
      // Its label is shared (e.g. two choice cards with the same wrapper label): use a uniquely labelled element inside.
      for (const inner of el.querySelectorAll(LABELLED + ', [aria-label], [name]')) {
        const sel = selectorsFor(inner).find((x) => findsIt(x, inner));
        if (sel) return sel;
      }
      const text = el.innerText.trim().split('\n')[0];
      return text ? { text, selector: el.tagName.toLowerCase() } : pathFor(el); // never "the element with no text"
    }
    // Clues about an element, saved with its target so the tour engine can still find it if the target stops matching
    // (e.g. a DoorLoop release renames a data-cy): its tag, first line of text, aria-label, name, placeholder, role
    // and link path. Only the ones it has.
    const tidy = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const firstLine = (el) => tidy((el.innerText || '').split('\n').find((l) => l.trim()) || '').slice(0, 80);
    const CLUE_OF = {
      text: firstLine,
      aria: (el) => el.getAttribute('aria-label'),
      name: (el) => el.getAttribute('name'),
      placeholder: (el) => el.getAttribute('placeholder'),
      role: (el) => el.getAttribute('role') || el.tagName.toLowerCase(),
      href: (el) => (el.tagName === 'A' && el.getAttribute('href') ? new URL(el.href).pathname : null),
    };
    function cluesFor(el) {
      // A field's labelled wrapper usually has nothing identifying of its own: describe the field inside instead
      // (its name, placeholder, aria-label), so the engine can find the field if the wrapper's label changes.
      const fields = el.matches('input, textarea, select') ? [] : el.querySelectorAll('input:not([type=hidden]), textarea, select');
      if (fields.length === 1 && !['text', 'aria', 'name', 'placeholder', 'href'].some((k) => CLUE_OF[k](el))) el = fields[0];
      const clues = { tag: el.tagName.toLowerCase() };
      for (const [k, get] of Object.entries(CLUE_OF)) {
        const v = get(el);
        if (v) clues[k] = v;
      }
      return clues;
    }
    // The same scoring as the tour engine (src/tour-layer.js, findByClues), to find a step's element again here.
    const CLUE_WEIGHTS = { text: 0.35, aria: 0.2, name: 0.15, placeholder: 0.1, href: 0.1, role: 0.1 };
    function compareClue(want, got) {
      if (!got) return 0;
      if (want === got) return 1;
      const a = tidy(want).toLowerCase(), b = tidy(got).toLowerCase();
      if (a === b) return 0.8;
      const [short, long] = a.length < b.length ? [a, b] : [b, a];
      return short.length >= 3 && short.length / long.length >= 0.6 && long.startsWith(short) ? 0.6 : 0;
    }
    function byClues(clues) {
      const present = Object.keys(CLUE_WEIGHTS).filter((k) => clues[k]);
      const total = present.reduce((sum, k) => sum + CLUE_WEIGHTS[k], 0);
      if (!present.some((k) => k !== 'role')) return null;
      let best = null, bestScore = 0;
      for (const el of app.doc().querySelectorAll(clues.tag || '*')) {
        if (host.contains(el) || !isShown(el)) continue;
        let score = 0, identified = false;
        for (const k of present) {
          const v = compareClue(clues[k], CLUE_OF[k](el));
          if (v && k !== 'role') identified = true;
          score += (v * CLUE_WEIGHTS[k]) / total;
        }
        if (identified && score >= 0.6 && score > bestScore) { best = el; bestScore = score; }
      }
      return best;
    }
    // A short label for a saved target (storyboard chips), e.g. "SideMenu-People-Tenants" or "3 items".
    const describe = (t) => Array.isArray(t) ? `${t.length} items` : typeof t === 'string' ? (t.match(/=['"]([^'"]+)['"]/) || [, t])[1] : t.text;
    // Find a saved target again (after moving pages or reloading), the way the tour engine would.
    function resolve(target, clues) {
      const doc = app.doc();
      const one = (t) => {
        const sized = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !host.contains(el); };
        if (typeof t === 'string') return [...doc.querySelectorAll(t)].find(sized);
        const want = t.text.trim().toLowerCase();
        return [...doc.querySelectorAll(t.selector || 'button, a, [role="button"]')].find((el) => sized(el) && el.innerText.trim().split('\n')[0].trim().toLowerCase() === want);
      };
      const clueList = Array.isArray(target) ? (Array.isArray(clues) ? clues : []) : [clues];
      const list = (Array.isArray(target) ? target : [target]).map((t, i) => one(t) || (clueList[i] ? byClues(clueList[i]) : null));
      return list.every(Boolean) ? list : null;
    }
    async function elsFor(step) {
      missingPage = null;
      if (step.page.includes('*')) {
        if (!(await goToPage(step.page))) return null;
      } else await app.navigate(step.page);
      if (step.els && step.els.every((e) => e.isConnected)) return step.els;
      for (let i = 0; i < 30; i++) {
        const els = resolve(step.target, step.clues);
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
      if (here) pageCard(here);
      state.flow.push({ type: 'step', draft: true, page: currentPage() });
      state.active = state.flow.length - 1;
      scrollStoryToEnd = true;
      renderStory();
      toast(`Step added. Now click something ${live ? 'on the page' : 'in the demo'}, or use the box tool to draw around it.`);
    }
    async function addPage(path) {
      clearSelection();
      state.flow = state.flow.filter((i) => !i.draft);
      state.active = null;
      pageCard(pathOf(path), true);
      scrollStoryToEnd = true;
      renderStory();
      if (await goToPage(currentPage())) toast(`Now on ${currentPage()}. Click + Step to add steps for this page.`);
    }
    async function activate(i) {
      clearSelection();
      state.active = i;
      const item = state.flow[i];
      renderStory();
      if (item.draft) return goToPage(item.page);
      if (!item.target) {
        // Not pinned to anything (shows centred): edit its text where it is.
        await goToPage(item.page);
        openEditor([], item);
        return renderStory();
      }
      const els = await elsFor(item);
      if (state.active !== i) return;
      if (!els) return missingPage || toast(`Couldn't find “${item.label}” on ${item.page}. Click what it should point at to repoint it.`, 6000);
      select(els);
    }
    // Insert an empty step before flow[at], on the page in effect there.
    function insertStep(at) {
      const draft = state.flow.findIndex((i) => i.draft);
      if (draft !== -1) {
        activate(draft);
        return toast('Finish this step first: pick something to highlight.');
      }
      clearSelection();
      const page = pageAt(at);
      state.flow.splice(at, 0, { type: 'step', draft: true, page });
      state.active = at;
      renderStory();
      goToPage(page);
      toast('Step inserted. Now pick what it highlights.');
    }
    function moveItem(from, to) {
      if (from === to || from === 0) return;
      to = Math.max(1, to);
      clearSelection();
      const [item] = state.flow.splice(from, 1);
      const at = from < to ? to - 1 : to;
      state.flow.splice(at, 0, item);
      if (state.active === from) state.active = at;
      else if (state.active !== null) {
        if (from < state.active && at >= state.active) state.active--;
        else if (from > state.active && at <= state.active) state.active++;
      }
      repage();
      renderStory();
    }
    function removeItem(i) {
      if (i === 0) return;
      clearSelection();
      state.flow.splice(i, 1);
      if (state.active === i) state.active = null;
      else if (state.active > i) state.active--;
      repage();
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

    const canPick = () => (state.active !== null || state.pickingExit) && !state.previewing && !state.recording && !state.recordingTour;

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
    // Picking again while the editor is open repoints the step: what was typed in the editor is kept.
    function select(els) {
      clearHover();
      const kept = editing && editing.snapshot ? editing.snapshot() : null;
      highlight(els);
      const item = state.flow[state.active];
      openEditor(els, kept || (item.draft ? null : item));
      if (kept) toast('Repointed. Your text and settings are kept; Save step to keep the new spot.');
      renderStory();
    }
    // Put the step box beside the highlight, never over it, like the tour engine does (tour-layer.js placeBox):
    // the step's Box position when the box fits there, otherwise the first side with room, otherwise the roomiest.
    // In live mode it keeps clear of the builder's panel.
    let boxSide = 'auto';
    function placePop() {
      if (!shown || !shown.length) {
        Object.assign(pop.style, { left: (layer.clientWidth - 320) / 2 + 'px', top: Math.max(8, (layer.clientHeight - pop.offsetHeight) / 2) + 'px' });
        return;
      }
      const a = unionRect(shown);
      const m = 8, gap = 14, w = pop.offsetWidth || 320, h = pop.offsetHeight;
      const right = live && !rootEl.classList.contains('story-collapsed') ? $('.ws').getBoundingClientRect().left - 10 : layer.clientWidth;
      const bottom = layer.clientHeight;
      const r = { left: a.left, top: a.top, right: a.left + a.width, bottom: a.top + a.height };
      const room = { right: right - m - r.right - gap, left: r.left - gap - m, bottom: bottom - m - r.bottom - gap, top: r.top - gap - m };
      const need = (side) => (side === 'left' || side === 'right' ? w : h);
      const fits = (side) => room[side] >= need(side);
      const sides = ['right', 'bottom', 'left', 'top'];
      const side = (sides.includes(boxSide) && fits(boxSide) ? boxSide : null) || sides.find(fits) ||
        sides.reduce((best, x) => (room[x] / need(x) > room[best] / need(best) ? x : best));
      const midX = (r.left + r.right - w) / 2, midY = (r.top + r.bottom - h) / 2;
      let [left, top] = side === 'right' ? [r.right + gap, midY] : side === 'left' ? [r.left - gap - w, midY]
        : side === 'bottom' ? [midX, r.bottom + gap] : [midX, r.top - gap - h];
      left = Math.max(m, Math.min(left, right - m - w));
      top = Math.max(m, Math.min(top, bottom - m - h));
      Object.assign(pop.style, { left: left + 'px', top: top + 'px' });
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
      // Tour files may use a path relative to the app (e.g. the demo's "tour-welcome.svg").
      const shown = /^(https?:|data:|\/)/.test(src) || live ? src : `${options.demoBase || 'demo'}/${src}`;
      slot.append(Object.assign(document.createElement('img'), { src: shown, alt: '' }));
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
        <label class="opt"><input type="checkbox" data-optional> Skip this step if it isn't on screen</label>
        <label class="opt"><input type="checkbox" data-showonly> Show only: it can't be clicked (e.g. Finish)</label>
        <label>Box position: <select data-placement><option value="auto">Auto (where there's room)</option><option value="right">Right of it</option><option value="left">Left of it</option><option value="bottom">Below it</option><option value="top">Above it</option></select></label>
        <div class="sample">
          <div class="row"><strong>Sample data</strong><button class="link rec" data-record>● Record</button></div>
          <ul class="sample-list"></ul>
        </div>
        <div class="row anchor"><span>Anchored to <code></code></span><button class="link" data-repoint title="Point this step at something else">⌖ Repoint</button></div>
        <div class="row"><button class="link" data-cancel>Cancel</button><button class="save" data-save>Save step</button></div>`;
      pop.append(meta);
      layer.append(pop);

      const title = () => box.querySelector('.tb-title'); // re-read: changing the title size swaps the element
      const text = box.querySelector('.tb-text');
      const advance = meta.querySelector('select:not([data-placement])');
      const placement = meta.querySelector('[data-placement]');
      placement.value = (step && step.placement) || 'auto';
      placement.onchange = () => { boxSide = placement.value; placePop(); };
      boxSide = placement.value;
      title().innerHTML = step ? step.titleHtml : '';
      text.innerHTML = step ? step.textHtml : '';
      let image = step ? step.image : null;
      meta.querySelector('[data-optional]').checked = !!(step && step.optional);
      meta.querySelector('[data-showonly]').checked = !!(step && step.showOnly);
      const showImage = () => { setImage(box, image, () => { image = null; showImage(); }); placePop(); };
      showImage();
      const single = els.length === 1;
      advance.value = step ? step.advanceOn : single && els[0].matches('input') ? 'type' : 'next';
      const showAdvance = () => setAdvance(box, advance.value, n === all.length);
      advance.onchange = showAdvance;
      showAdvance();
      const target = !els.length ? undefined : single ? targetFor(els[0]) : els.map(targetFor);
      const clues = !els.length ? undefined : single ? cluesFor(els[0]) : els.map(cluesFor);
      const show = (t) => (typeof t === 'string' ? t : `text “${t.text}”`);
      meta.querySelector('code').textContent = !els.length ? 'nothing (shows centred)' : single ? show(target) : `${els.length} items: ${target.map(show).join(', ')}`;

      // Sample data: recorded from what you type and choose in the highlighted area, then reviewed here.
      const fill = step && step.fill ? step.fill.map((f) => ({ ...f })) : [];
      editing = {
        target, fill, list: meta.querySelector('.sample-list'),
        // The editor as it is now, for repointing without losing unsaved edits
        snapshot: () => ({ titleHtml: title().innerHTML, textHtml: text.innerHTML, image, advanceOn: advance.value,
          optional: meta.querySelector('[data-optional]').checked, showOnly: meta.querySelector('[data-showonly]').checked,
          placement: placement.value, fill }),
      };
      // Repoint: the editor steps out of the way (it may cover the right spot) until something is picked; Esc brings it back.
      meta.querySelector('[data-repoint]').onclick = () => {
        const editor = pop;
        editor.style.visibility = 'hidden';
        const docs = [...new Set([document, app.doc()].filter(Boolean))];
        const onKey = (e) => {
          if (e.key !== 'Escape') return;
          docs.forEach((d) => d.removeEventListener('keydown', onKey, true));
          if (editor.isConnected) editor.style.visibility = '';
        };
        docs.forEach((d) => d.addEventListener('keydown', onKey, true));
        toast(`Click what this step should point at ${live ? 'on the page' : 'in the demo'}, or draw around it with the box tool. Your edits are kept. Esc to keep it where it is.`, 6000);
      };
      renderSample();
      const recBtn = meta.querySelector('[data-record]');
      recBtn.onclick = () => {
        if (!els.length) return toast('Sample data needs a step that highlights something.');
        state.recording = state.recording ? null : { lastTyped: null };
        recBtn.textContent = state.recording ? '■ Stop' : '● Record';
        rootEl.classList.toggle('picking', canPick());
        if (state.recording) toast('Recording. Fill in the highlighted area the way people should: type, pick suggestions, click choices. Then click Stop.');
      };

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
        if (!text.innerText.trim()) return toast('Add some text for the step: what should people know or do here?');
        if (fill.length && !state.exitClicks.length) setTimeout(() => suggestExit(els), 3300);
        const page = state.flow[state.active].page;
        state.flow[state.active] = {
          type: 'step', page, els, target, clues, label: !els.length ? 'centred' : single ? labelFor(els[0]) : `${els.length} items`,
          titleHtml: title().innerHTML, textHtml: text.innerHTML, image, advanceOn: advance.value,
          optional: meta.querySelector('[data-optional]').checked,
          showOnly: meta.querySelector('[data-showonly]').checked,
          placement: placement.value,
          fill: fill.filter((f) => f.click || f.value !== ''),
        };
        if (state.flow[state.active].showOnly && advance.value === 'click') {
          state.flow[state.active].showOnly = false;
          toast("A step that continues on a click can't be show-only; that box was cleared.");
        }
        state.active = null;
        clearSelection();
        renderStory();
        toast('Step saved. Click + Step to add another, or + Page to move to another page.');
      };
      placePop();
      title().focus();
    }

    function clearSelection() {
      previewClick = null;
      state.recording = null;
      editing = null;
      pop?.remove();
      selBox?.remove();
      pop = selBox = shown = null;
    }

    // ---------- sample data and leaving without saving ----------
    let editing = null; // the step in the editor: { target, fill, list }
    const key = (t) => JSON.stringify(t);
    // Inside the step's highlighted area (found again if the app re-rendered it).
    function inHighlight(node) {
      const els = shown && shown.length && shown.every((e) => e.isConnected) ? shown : (editing && editing.target && resolve(editing.target)) || [];
      return els.some((e) => e.contains(node));
    }
    function recordInput(e) {
      if (!state.recording || !e.isTrusted || inBuilder(e)) return;
      const field = e.target;
      if (!field.matches || !field.matches('input:not([type=checkbox]):not([type=radio]), textarea') || !inHighlight(field)) return;
      const target = targetFor(pickable(field) || field);
      let item = editing.fill.find((f) => key(f.target) === key(target));
      if (!item) editing.fill.push((item = { target, clues: cluesFor(pickable(field) || field), value: '' }));
      delete item.click;
      delete item.pick; // typed again: any suggestion picked before no longer applies
      item.value = field.value;
      state.recording.lastTyped = item;
      renderSample();
    }
    function recordClick(e) {
      if (!e.isTrusted) return;
      // A suggestion in a dropdown (outside the highlight): it belongs to the field typed into just before.
      const option = e.target.closest && e.target.closest('[role=option]');
      if (option) {
        if (state.recording.lastTyped) state.recording.lastTyped.pick = option.textContent.replace(/\s+/g, ' ').trim();
        return renderSample();
      }
      if (e.target.closest('input:not([type=checkbox]):not([type=radio]), textarea') || !inHighlight(e.target)) return;
      // Clicks around a text field (its dropdown arrow, its label) are part of typing into it, not a choice.
      const wrap = e.target.closest(LABELLED);
      if (wrap && wrap.querySelector('input:not([type=checkbox]):not([type=radio]), textarea')) return;
      const el = pickable(e.target);
      if (!el) return;
      const target = targetFor(el);
      if (!editing.fill.some((f) => key(f.target) === key(target))) editing.fill.push({ target, clues: cluesFor(el), click: true });
      renderSample();
    }
    function renderSample() {
      if (!editing) return;
      const list = editing.list;
      list.replaceChildren();
      if (!editing.fill.length) {
        list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'None. Click Record, then fill in the highlighted area.' }));
      }
      editing.fill.forEach((item, i) => {
        const li = document.createElement('li');
        li.append(Object.assign(document.createElement('span'), { textContent: describe(item.target), title: typeof item.target === 'string' ? item.target : item.target.text }));
        if (item.click) li.append(Object.assign(document.createElement('small'), { textContent: 'click' }));
        else {
          const input = Object.assign(document.createElement('input'), { value: item.value, title: 'Text typed into this field' });
          input.oninput = () => (item.value = input.value);
          li.append(input);
          if (item.pick) li.append(Object.assign(document.createElement('small'), { textContent: `→ ${item.pick}`, title: 'Suggestion picked after typing' }));
        }
        const rm = Object.assign(document.createElement('button'), { className: 'rm', textContent: '×', title: 'Remove' });
        rm.onclick = () => { editing.fill.splice(i, 1); renderSample(); };
        li.append(rm);
        list.append(li);
      });
      if (pop) placePop();
    }

    // Sample data in a dialog and no exit clicks yet: suggest the dialog's close button (×), shown in the ⎋ panel to
    // keep or remove. If the app then asks "Discard your changes?", the tour engine answers it.
    function suggestExit(els) {
      const dialog = els.map((e) => e.closest('[role=dialog]')).find(Boolean);
      const close = dialog && [...dialog.querySelectorAll("[data-slot$='dialog-close'], [data-slot$='-close-button'], button[aria-label='Close' i], button[aria-label^='Close ' i]")].find(isShown);
      if (!close) return toast('This step has sample data. Use ⎋ in the toolbox to pick what to click when the tour ends (e.g. Cancel), so it isn\'t saved.', 6000);
      state.exitClicks.push(targetFor(close));
      $('.exit-panel').hidden = false;
      renderExit();
      save();
      toast('Sample data is in a dialog, so its × is set as the exit click: when the tour ends it closes the dialog without saving. Change it in ⎋.', 8000);
    }

    $('.auto-start input').onchange = save;
    if (live) {
      $('.dock-opt input').checked = dockWanted();
      $('.dock-opt input').onchange = (e) => {
        try { localStorage.setItem(DOCK_KEY, e.target.checked ? 'on' : 'off'); } catch {}
        dock();
        if (shown && pop) placePop();
      };
    }
    $('.tour-status select').onchange = () => {
      save();
      if ($('.tour-status select').value === 'live') toast('Live: once saved to GitHub, everyone with the extension sees this tour. Keep it a draft until it\'s approved.', 6000);
    };

    $('.exit-tool').onclick = () => { $('.exit-panel').hidden = !$('.exit-panel').hidden; renderExit(); };
    $('.exit-pick').onclick = () => {
      clearSelection();
      state.active = null;
      state.pickingExit = true;
      renderStory();
      toast('Click the button to press when the tour ends, e.g. Cancel.');
    };
    function addExitClick(el) {
      state.exitClicks.push(targetFor(el));
      state.pickingExit = false;
      renderExit();
      renderStory();
      toast(`Added “${labelFor(el)}”. Pick another if it opens a confirmation.`);
    }
    function renderExit() {
      const list = $('.exit-list');
      list.replaceChildren();
      if (!state.exitClicks.length) list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Nothing yet.' }));
      state.exitClicks.forEach((t, i) => {
        const li = document.createElement('li');
        li.append(Object.assign(document.createElement('span'), { textContent: `${i + 1}. ${describe(t)}` }));
        const rm = Object.assign(document.createElement('button'), { className: 'rm', textContent: '×', title: 'Remove' });
        rm.onclick = () => { state.exitClicks.splice(i, 1); renderExit(); save(); };
        li.append(rm);
        list.append(li);
      });
    }

    // ---------- recording a tour by clicking through it ----------
    // Each click becomes a step that continues when that element is clicked; typing into a field becomes one step
    // with what was typed as its sample data (a suggestion picked right after is attached to it). Picking from a
    // list without typing points the step at the whole list, so it works whatever the list holds. Afterwards every
    // step is a normal card: click it to edit what it says.
    const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const CLICKABLE = "button, a[href], [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], input[type=checkbox], input[type=radio], [data-item-id], [data-section-value]";
    const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea';
    let lastTyped = null; // the step a just-typed value went into, for a suggestion picked next
    let lastClick = { key: null, at: 0 };
    let pendingOpen = null; // a click into a field that offers a list: a step only if a pick follows without typing
    function fieldLabel(field) {
      const wrap = pickable(field);
      return field.getAttribute('aria-label') || field.labels?.[0]?.innerText.trim() ||
        (field.id && field.ownerDocument.querySelector(`label[for='${window.CSS.escape(field.id)}']`)?.innerText.trim()) ||
        wrap?.querySelector('label, legend')?.innerText.replace(/\*/g, '').trim() ||
        field.getAttribute('placeholder') || field.getAttribute('name') || 'this field';
    }
    // A required field's label ends with "*"; leave it out of the step's words.
    const plain = (label) => label.replace(/\s*\*\s*$/, '');
    function recordStep(el, { title, text, advanceOn, fill }) {
      const here = app.path();
      if (here) pageCard(here);
      const step = {
        type: 'step', page: currentPage(), target: targetFor(el), clues: cluesFor(el), label: labelFor(el),
        titleHtml: escHtml(title), textHtml: escHtml(text), image: null, advanceOn, optional: false, showOnly: false, fill: fill || [],
      };
      state.flow.push(step);
      scrollStoryToEnd = true;
      renderStory();
      return step;
    }
    function recordTourClick(e) {
      if (!e.isTrusted || inBuilder(e)) return;
      const option = e.target.closest && e.target.closest('[role=option]');
      if (option) {
        const text = option.textContent.replace(/\s+/g, ' ').trim();
        if (lastTyped && Date.now() - lastTyped.at < 15000) {
          lastTyped.step.fill[0].pick = text; // the suggestion picked after typing
          return save();
        }
        const list = option.closest('[role=listbox], [role=menu]') || option.parentElement;
        if (pendingOpen) recordStep(pendingOpen.el, { title: `Open “${plain(pendingOpen.label)}”`, text: `Click ${plain(pendingOpen.label)} to see the options.`, advanceOn: 'click' });
        pendingOpen = null;
        recordStep(pickable(list) || list, { title: 'Pick from the list', text: `Choose one, for example “${text}”.`, advanceOn: 'click' });
        return;
      }
      const field = e.target.closest(TEXT_FIELD);
      pendingOpen = null;
      // Clicking into a text field is part of typing. One that offers a list only becomes a step if a pick follows.
      if (field) {
        if (field.matches('[role=combobox], [aria-autocomplete], [aria-haspopup]')) pendingOpen = { el: pickable(field) || field, label: fieldLabel(field) };
        return;
      }
      const hit = e.target.closest(CLICKABLE);
      const el = hit ? pickable(hit) || hit : null;
      if (!el) return; // a click on nothing in particular
      const key = JSON.stringify(targetFor(el));
      if (key === lastClick.key && Date.now() - lastClick.at < 1000) return; // a double click
      lastClick = { key, at: Date.now() };
      lastTyped = null;
      const label = plain(labelFor(el));
      const tick = el.matches('input[type=checkbox], [role=checkbox], [role=switch]') || !!el.querySelector('input[type=checkbox]');
      recordStep(el, tick
        ? { title: `Tick “${label}”`, text: `Tick ${label} if it applies.`, advanceOn: 'next' }
        : { title: `Click “${label}”`, text: `Click ${label}.`, advanceOn: 'click' });
    }
    function recordTourInput(e) {
      if (!state.recordingTour || !e.isTrusted || inBuilder(e)) return;
      const field = e.target;
      if (!field.matches || !field.matches(TEXT_FIELD)) return;
      pendingOpen = null;
      const el = pickable(field) || field;
      const target = targetFor(el);
      const last = state.flow[state.flow.length - 1];
      if (lastTyped && last === lastTyped.step && JSON.stringify(last.target) === JSON.stringify(target)) {
        last.fill[0].value = field.value;
        delete last.fill[0].pick;
        lastTyped.at = Date.now();
        return save();
      }
      const label = plain(fieldLabel(field));
      const step = recordStep(el, { title: `Enter ${label}`, text: `Type ${label}.`, advanceOn: 'next', fill: [{ target, clues: cluesFor(el), value: field.value }] });
      lastTyped = { step, at: Date.now() };
    }
    function setRecordingTour(on) {
      clearSelection();
      state.flow = state.flow.filter((i) => !i.draft);
      state.active = null;
      state.recordingTour = on;
      lastTyped = null;
      $('.record-btn').classList.toggle('on', on);
      $('.record-btn').textContent = on ? '■ Stop recording' : '● Record tour';
      renderStory();
    }
    $('.record-btn').onclick = () => {
      const before = steps().length;
      setRecordingTour(!state.recordingTour);
      if (state.recordingTour) {
        recordStart = before;
        toast('Recording. Do the workflow the way people should: each click and each field you fill in becomes a step. Click Stop recording when done.', 8000);
      } else {
        const n = steps().length - recordStart;
        toast(`Recorded ${n} step${n === 1 ? '' : 's'}. Click a card to edit what it says. What you typed is kept as each step's sample data: check it before saving, it ends up in the tour file.`, 10000);
      }
    };
    let recordStart = 0;

    // ---------- saving to GitHub ----------
    // On live DoorLoop the extension's background commits the tour file as the signed-in person (extension/
    // background.js); the GitHub login stays there. A new tour asks before replacing a file with the same name.
    // The demo builder can't reach the extension, so there it's View tour file → Save to GitHub as before.
    $('.save-btn').onclick = async () => {
      if (!steps().length) return toast('Add a step first: there is nothing to save yet.');
      const extension = live && window.chrome && chrome.runtime && chrome.runtime.id;
      if (!extension) return toast('Saving straight to GitHub works in the builder on live DoorLoop. Here, use View tour file → Save to GitHub.', 7000);
      const { tour, changes } = buildTour('publish');
      const folder = options.folder === 'demo-tours' ? 'demo-tours' : 'tours';
      const path = `${folder}/${tour.id}.json`;
      const request = (mode) => chrome.runtime.sendMessage({
        type: 'tour-layer:github-save', path, mode, content: JSON.stringify(tour, null, 2) + '\n',
        message: `${state.id ? 'Update' : 'Add'} the "${tour.title}" tour (${tour.status}) from the builder`,
      });
      const button = $('.save-btn');
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        let result = await request(state.id ? 'replace' : 'create');
        if (result.exists) {
          if (!window.confirm(`There's already a tour file ${path} on GitHub. Replace it with this tour?`)) return toast('Not saved. Rename this tour to keep both.');
          result = await request('replace');
        }
        if (result.error === 'signed-out') return toast('Sign in to GitHub first: click the extension icon, then Sign in with GitHub.', 7000);
        if (result.error) return toast(`Not saved: ${result.error}`, 9000);
        state.id = tour.id; // later saves update this file
        save();
        toast(`Saved ${path} to GitHub (${tour.status}). CI checks it and publishes it in a few minutes.` +
          (changes.length ? ` For publishing, ${changes.join('; ')}.` : ''), 9000);
      } catch (e) {
        toast(`Not saved: ${e.message}`, 9000);
      } finally {
        button.disabled = false;
        button.textContent = '💾 Save tour';
      }
    };

    // ---------- export (for the tour's creator) ----------
    // Record the tour as a video or GIF while playing it on live DoorLoop (src/export.js). The builder steps aside so
    // it isn't recorded, and comes back with the draft when the file has downloaded or the export is cancelled.
    $('.more-btn').onclick = () => ($('.more-menu').hidden = !$('.more-menu').hidden);
    $$('.export-menu button').forEach((b) => (b.onclick = () => exportAs(b.dataset.kind)));
    function exportAs(kind) {
      $('.more-menu').hidden = true;
      if (!steps().length) return toast('Add a step first: there is nothing to record yet.');
      if (!live || !window.TourExport) return toast('Export records the tour on live DoorLoop: build it there (Build on: Live DoorLoop), then export.', 6000);
      const { tour } = buildTour('engine');
      if (!matches(tour.page, app.path())) return toast(`Go to the tour's start page first (${tour.page}): click the Start page card, then Export.`, 6000);
      clearSelection();
      save();
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      close(true);
      window.TourExport.offer(tour, kind, () => open({ mode: 'live', restore: saved }));
    }

    // ---------- storyboard ----------
    let dragFrom = null;
    let scrollStoryToEnd = false;
    $('.story-btn').onclick = () => {
      const hidden = rootEl.classList.toggle('story-collapsed');
      if (!live) $('.story-btn').textContent = hidden ? 'Storyboard ▴' : 'Storyboard ▾';
      dock();
      if (shown && pop) placePop();
    };
    if (live) $('.panel-tab').onclick = () => $('.story-btn').click();
    function renderStory() {
      const story = $('.story');
      story.replaceChildren();
      let stepNo = 0;
      state.flow.forEach((item, i) => {
        if (i > 0) {
          const ins = Object.assign(document.createElement('button'), { className: 'ins', title: 'Insert a step here', textContent: '+' });
          ins.onclick = () => insertStep(i);
          story.append(ins);
        }
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        // Drag cards to reorder (the start page stays first).
        if (i > 0) {
          card.draggable = true;
          card.ondragstart = (e) => { dragFrom = i; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
          card.ondragend = () => card.classList.remove('dragging');
        }
        card.ondragover = (e) => { if (dragFrom !== null) { e.preventDefault(); card.classList.add('drop-here'); } };
        card.ondragleave = () => card.classList.remove('drop-here');
        card.ondrop = (e) => {
          e.preventDefault();
          const from = dragFrom;
          dragFrom = null;
          if (from !== null) moveItem(from, i);
        };
        if (item.type === 'page') {
          const next = state.flow.slice(i + 1).findIndex((x) => x.type === 'page');
          const n = (next === -1 ? state.flow.slice(i + 1) : state.flow.slice(i + 1, i + 1 + next)).filter((x) => x.type === 'step').length;
          card.classList.add('page-card');
          card.title = 'Go to this page';
          card.innerHTML = `<div class="n">${i === 0 ? 'Start page' : 'Page'}</div><div class="t"></div><div class="chips"><span class="chip">${n} step${n === 1 ? '' : 's'}</span></div>`;
          card.querySelector('.t').textContent = item.path;
          card.onclick = () => goToPage(item.path);
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
      // Keep the step you're working on in view.
      const on = story.querySelector('.card.on');
      if (on) story.scrollLeft = on.offsetLeft - story.clientWidth / 2 + on.offsetWidth / 2;
      else if (scrollStoryToEnd) story.scrollLeft = story.scrollWidth;
      scrollStoryToEnd = false;
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
      const els = s.target ? await elsFor(s) : (await goToPage(s.page), []);
      if (run !== previewRun || !state.previewing) return;
      if (!els) {
        toast(`Couldn't find “${s.label}” on ${s.page}; skipping it.`);
        return showPreview(i + 1);
      }
      if (els.length) highlight(els);
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
      if (s.fill && s.fill.length) {
        const fillBtn = Object.assign(document.createElement('button'), { className: 'tb-fill', textContent: 'Fill example' });
        fillBtn.onclick = async () => {
          // The tour engine does the typing: in this page on DoorLoop, in the demo's own page otherwise.
          const engine = live ? window.TourLayer : frame.contentWindow && frame.contentWindow.TourLayer;
          if (!engine || !engine.fill) return toast("The tour engine isn't loaded here, so Fill example can't run.");
          fillBtn.disabled = true;
          fillBtn.textContent = 'Filling…';
          fillBtn.textContent = (await engine.fill(s.fill)) ? 'Filled' : 'Partly filled';
        };
        box.querySelector('.tb-advance').before(fillBtn);
      }
      // A "click the highlighted item" step: the click goes to the app (opening its menu, say), then on to the next step
      if (s.advanceOn === 'click' && els.length) previewClick = { els, go };
      else if (s.advanceOn === 'type') {
        const input = Object.assign(document.createElement('input'), { className: 'tb-typed', placeholder: 'Type here, then press Enter' });
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && input.value.trim()) go(); // not returned: false from an on* handler cancels the key
        };
        box.querySelector('.tb-pad').append(input);
      }
      layer.append(pop);
      placePop();
    }

    // ---------- tour file ----------
    // The storyboard as a tour file. mode 'view' shows everything, including what the tour format can't hold yet.
    // 'engine' (a live test) and 'publish' (Save to GitHub) simplify that (listed in `changes`); a live test also
    // keeps images embedded, since the tour engine has to run the file as-is.
    function buildTour(mode) {
      const forEngine = mode === 'engine';
      const simplify = mode !== 'view';
      const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.trim(); };
      const id = (forEngine ? 'draft-' : '') + (state.id || state.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
      // Record pages (/tenants/t1, /tenants/64f1c...) become patterns (/tenants/*) so the step works for any record.
      const general = (path) => path.split('/').map((seg) => (/^([a-z]\d+|\d+|[0-9a-f]{8,}|[0-9a-f-]{20,})$/i.test(seg) ? '*' : seg)).join('/');
      const start = state.flow[0].path;
      const changes = new Set();
      const tour = {
        id,
        title: state.name,
        status: $('.tour-status select').value, // new tours start as drafts; approving one means changing this to live
        page: start,
        // Same field names the tour engine and the build check use.
        style: {
          ...Object.fromEntries([...$$('.style-panel input')].map((i) => [STYLE_FIELDS[i.dataset.var], i.type === 'range' ? +i.value : i.value])),
          titleSize: style.titleTag,
          titleAlign: style.titleAlign,
          textAlign: style.textAlign,
        },
        ...($('.auto-start input').checked ? { autoStart: true } : {}),
        ...(state.exitClicks.length ? { exitClicks: state.exitClicks } : {}),
        steps: steps().map((s, i) => {
          const target = s.target;
          let advanceOn = s.advanceOn;
          if (simplify && advanceOn === 'type') {
            advanceOn = 'next';
            changes.add('"type text" steps use a Next button');
          }
          const formatted = /<(b|i|u|ul|font|span)\b/.test(s.textHtml);
          if (simplify && formatted) changes.add('text formatting is left out');
          return {
            ...(s.page !== start ? { page: general(s.page) } : {}),
            target,
            ...(s.clues ? { clues: s.clues } : {}),
            title: plain(s.titleHtml),
            text: plain(s.textHtml),
            ...(advanceOn !== 'next' ? { advanceOn } : {}),
            ...(s.optional ? { optional: true } : {}),
            ...(s.showOnly ? { showOnly: true } : {}),
            ...(s.placement && s.placement !== 'auto' ? { placement: s.placement } : {}),
            ...(s.fill && s.fill.length ? { fill: s.fill } : {}),
            ...(!simplify && formatted ? { formattedText: '(formatting kept)' } : {}),
            ...(s.image ? { image: forEngine || !s.image.startsWith('data:') ? s.image : `images/${id}-step-${i + 1}.png` } : {}),
          };
        }),
      };
      return { tour, changes: [...changes] };
    }
    $('.file-btn').onclick = () => {
      $('.more-menu').hidden = true;
      const { tour } = buildTour('view');
      const drafts = state.flow.filter((i) => i.draft).length;
      // Only the file goes in the box, so selecting all of it copies a file that's ready to save; notes sit below.
      $('.file-out').textContent = JSON.stringify(tour, null, 2);
      $('.file-notes').textContent =
        'Uploaded images would be saved next to the tour as the "image" path shown.' +
        '\nNot in the tour format yet: "formattedText" and advanceOn "type".' +
        (drafts ? '\nSteps with nothing highlighted yet are left out.' : '');
      $('.filebox').hidden = false;
      $('.file-out').focus();
    };
    // Select all (Cmd/Ctrl+A) in the box selects just the tour file, not the whole page around it.
    $('.file-out').onkeydown = (e) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a')) return;
      e.preventDefault();
      getSelection().selectAllChildren($('.file-out'));
    };
    $('.file-close').onclick = () => ($('.filebox').hidden = true);
    $('.copy-btn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(buildTour('view').tour, null, 2));
        toast('Tour file copied.');
      } catch {
        toast("Couldn't copy. Select the text and copy it instead.");
      }
    };

    // Save to GitHub: GitHub's own pages, signed in as you, so the builder never holds a GitHub login.
    // A new tour opens the "new file" page filled in (when it fits in a link); an edited tour opens its file's edit
    // page, which GitHub can't fill in. The file is copied either way, to paste if needed. CI checks and publishes it.
    $('.gh-btn').onclick = async () => {
      const { tour, changes } = buildTour('publish');
      const text = JSON.stringify(tour, null, 2) + '\n';
      let copied = true;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        copied = false;
      }
      const folder = options.folder === 'demo-tours' ? 'demo-tours' : 'tours';
      const value = encodeURIComponent(text);
      const fits = value.length < 6000; // GitHub rejected a ~10,000-character pre-fill ("Bad request")
      const url = state.id
        ? `${REPO}/edit/main/${folder}/${tour.id}.json`
        : `${REPO}/new/main/${folder}?filename=${encodeURIComponent(tour.id + '.json')}${fits ? `&value=${value}` : ''}`;
      if (!window.open(url, '_blank')) return toast('Your browser blocked the new tab. Allow pop-ups for this page and try again.');
      const paste = copied ? 'paste the tour file (it\'s copied)' : 'paste the tour file (copy it with Copy first)';
      const what = state.id ? `Opened ${folder}/${tour.id}.json on GitHub: select everything in the editor, ${paste}, then Commit changes.`
        : fits ? `Opened GitHub with ${folder}/${tour.id}.json filled in. Check it, then Commit changes.`
        : `Opened GitHub's new file page as ${folder}/${tour.id}.json: ${paste}, then Commit changes.`;
      const images = tour.steps.some((s) => s.image && s.image.startsWith('images/')) ? ' Uploaded images aren\'t saved with it: put each image online and set the step\'s "image" to its https:// address.' : '';
      toast(`${what} Once committed, CI checks it and publishes it.${changes.length ? ` For publishing, ${changes.join('; ')}.` : ''}${images}`, 12000);
    };

    // Demo only: open DoorLoop in a tab and hand it the draft (see sendToDoorLoop).
    function previewOnDoorLoop() {
      const { tour, changes } = buildTour('engine');
      const ok = sendToDoorLoop(tour.page, 'doorloop-tour-test', { type: 'tour-layer:draft', tour }, () => toast('Tour started on DoorLoop. Switch to that tab.'));
      if (!ok) return toast('Your browser blocked the new tab. Allow pop-ups for this page and try again.');
      toast(changes.length ? `Opening DoorLoop. For this test, ${changes.join('; ')}.` : 'Opening DoorLoop…');
    }

    // ---------- live mode: keep the draft across page reloads ----------
    function save() {
      if (!live || closed) return;
      const flow = state.flow.map(({ els, ...rest }) => rest); // elements can't be saved; targets find them again
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        name: state.name, id: state.id, folder: options.folder, flow, style, active: state.active, exitClicks: state.exitClicks,
        autoStart: $('.auto-start input').checked, status: $('.tour-status select').value, recordingTour: state.recordingTour,
        inputs: Object.fromEntries([...$$('.style-panel input')].map((i) => [i.dataset.var, i.value])),
      }));
    }
    function restore(saved) {
      state.name = saved.name;
      state.id = saved.id || null;
      state.flow = saved.flow;
      state.active = saved.active ?? null;
      state.exitClicks = saved.exitClicks || [];
      state.recordingTour = !!saved.recordingTour;
      options.folder = saved.folder;
      $('.auto-start input').checked = !!saved.autoStart;
      $('.tour-status select').value = saved.status || 'draft';
      Object.assign(style, saved.style);
      $$('.style-panel input').forEach((i) => { if (saved.inputs[i.dataset.var] !== undefined) i.value = saved.inputs[i.dataset.var]; });
      $$('.style-panel .seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === style[seg.dataset.key])));
    }

    // Open an existing tour file: page cards where the page changes, then its steps, then its style.
    function loadTour(tour) {
      const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      state.name = tour.title || tour.id;
      state.id = tour.id;
      state.flow = [{ type: 'page', path: tour.page }];
      state.exitClicks = tour.exitClicks ? [...tour.exitClicks] : [];
      $('.auto-start input').checked = !!tour.autoStart;
      $('.tour-status select').value = tour.status === 'draft' ? 'draft' : 'live'; // a published tour with no status is live
      for (const step of tour.steps) {
        if (step.page && step.page !== currentPage()) state.flow.push({ type: 'page', path: step.page });
        state.flow.push({
          type: 'step', page: currentPage(), target: step.target, clues: step.clues, label: describe(step.target || 'centred'),
          titleHtml: esc(step.title), textHtml: esc(step.text), image: step.image || null,
          advanceOn: step.advanceOn || 'next', optional: !!step.optional, showOnly: !!step.showOnly, placement: step.placement || 'auto',
          fill: step.fill ? step.fill.map((f) => ({ ...f })) : [],
        });
      }
      const st = tour.style || {};
      for (const [cssVar, field] of Object.entries(STYLE_FIELDS)) {
        if (st[field] !== undefined) shadow.querySelector(`.style-panel input[data-var='${cssVar}']`).value = st[field];
      }
      if (st.titleSize) style.titleTag = st.titleSize;
      if (st.titleAlign) style.titleAlign = st.titleAlign;
      if (st.textAlign) style.textAlign = st.textAlign;
      $$('.style-panel .seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === style[seg.dataset.key])));
    }

    function close(silent) {
      if (!silent && steps().length && !window.confirm('Close the builder? Copy the tour file first if you want to keep this tour.')) return;
      closed = true;
      clearInterval(pathTimer);
      listeners.forEach((off) => off());
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('focusout', keepFocus, true);
      if (live) sessionStorage.removeItem(SESSION_KEY);
      hideLauncher?.remove();
      document.documentElement.classList.remove('tour-layer-docked');
      dockStyle?.remove();
      document.removeEventListener('scroll', noSidewaysScroll, true);
      if (live) window.dispatchEvent(new Event('resize'));
      host.remove();
      if (current && current.host === host) current = null;
      options.onClose?.();
    }
    $('.close-btn').onclick = () => close(false);

    // ---------- start ----------
    const LOADED = 'Tour loaded. Click a card to edit that step, + between cards to insert one, or drag cards to reorder.';
    if (options.restore) restore(options.restore);
    else if (options.tour) loadTour(options.tour);
    $('.ws-name').textContent = state.name;
    applyStyle();
    if (state.recordingTour) setRecordingTour(true); // still recording after a page load
    renderStory();
    renderExit();
    dock();
    showPage(live ? app.path() : currentPage());
    if (live) {
      toast(options.restore ? 'Builder restored. Your draft is still here.' : options.tour ? LOADED : 'Building on live DoorLoop. Click + Step, then click what it should highlight.');
    } else {
      app.navigate(currentPage()).then(() => toast(options.tour ? LOADED : 'Browse the demo if you like. Click + Step in the storyboard to add the first step.'));
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
