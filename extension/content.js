// Fetches the latest published tours; falls back to the copy bundled into the extension at build time.
// app.doorloop.com itself is excluded in the manifest: it redirects to your account's subdomain,
// and the tour should start there so ?tour= survives the redirect.
(async function () {
  'use strict';
  const TOURS_URL = 'https://shuang-dl.github.io/product-tour-layer/tours.json';
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
