// Fetches the latest published tours; falls back to the copy bundled into the extension at build time.
// app.doorloop.com itself is excluded in the manifest: it redirects to your account's subdomain,
// and the tour should start there so ?tour= survives the redirect.
(function () {
  'use strict';
  const TOURS_URL = 'https://shuang-dl.github.io/product-tour-layer/tours.json';
  // Only the tour builder's own site may send a draft tour to run here ("Test on: Live DoorLoop").
  // localhost:4173 is `npm run serve`, for trying the builder locally.
  const BUILDER_ORIGINS = ['https://shuang-dl.github.io', 'http://localhost:4173'];

  const ready = (async () => {
    let tours;
    try {
      const res = await fetch(TOURS_URL, { cache: 'no-store' });
      tours = (await res.json()).tours;
    } catch (e) {
      console.warn('[TourLayer] could not fetch published tours, using the bundled copy', e);
      tours = window.TOUR_LAYER_BUNDLED.tours;
    }
    window.TourLayer.init({ tours });
  })();

  // The builder keeps sending until it hears back, so run each draft only once.
  const seen = new Set();
  window.addEventListener('message', (e) => {
    if (!BUILDER_ORIGINS.includes(e.origin) || !e.data || e.data.type !== 'tour-layer:draft') return;
    if (e.source) e.source.postMessage({ type: 'tour-layer:draft-received', id: e.data.id }, e.origin);
    if (seen.has(e.data.id)) return;
    seen.add(e.data.id);
    ready.then(() => window.TourLayer.run(e.data.tour));
  });
})();
