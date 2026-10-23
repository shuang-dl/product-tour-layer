// ==UserScript==
// @name         DoorLoop Product Tour Layer (PoC)
// @namespace    https://github.com/shuang-dl/product-tour-layer
// @version      0.1.0
// @description  Runs product tours on top of DoorLoop. Proof of concept.
// @match        https://*.app.doorloop.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://shuang-dl.github.io/product-tour-layer/tour-layer.user.js
// @updateURL    https://shuang-dl.github.io/product-tour-layer/tour-layer.user.js
// ==/UserScript==

// This loader is the whole integration. If DoorLoop added these same lines to its app,
// customers would get the tours with nothing to install.
(function () {
  'use strict';
  // app.doorloop.com redirects to your account's subdomain; wait for that page so ?tour= survives.
  if (location.hostname === 'app.doorloop.com') return;

  const BASE = 'https://shuang-dl.github.io/product-tour-layer/';
  const bust = '?v=' + Date.now();
  const script = document.createElement('script');
  script.src = BASE + 'tour-layer.js' + bust;
  script.onload = () => window.TourLayer.init({ toursUrl: BASE + 'tours.json' + bust });
  document.head.appendChild(script);
})();
