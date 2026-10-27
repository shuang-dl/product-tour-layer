// Fetches the latest published tours; falls back to the copy bundled into the extension at build time.
// app.doorloop.com itself is excluded in the manifest: it redirects to your account's subdomain,
// and the tour should start there so ?tour= survives the redirect.
(function () {
  'use strict';
  const TOURS_URL = 'https://shuang-dl.github.io/product-tour-layer/tours.json';
  const DRAFTS_URL = 'https://shuang-dl.github.io/product-tour-layer/drafts.json';
  // Draft tours only load for people who turned on Show drafts: a ?drafts=on link (from the tours page) turns it on
  // in this browser, ?drafts=off turns it off.
  const DRAFTS_KEY = 'tourLayer.showDrafts';
  const params = new URLSearchParams(location.search);
  if (params.has('drafts')) {
    try {
      if (params.get('drafts') === 'on') localStorage.setItem(DRAFTS_KEY, '1');
      else localStorage.removeItem(DRAFTS_KEY);
    } catch {}
    params.delete('drafts');
    const qs = params.toString();
    history.replaceState(history.state, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }
  let showDrafts = false;
  try {
    showDrafts = localStorage.getItem(DRAFTS_KEY) === '1';
  } catch {}
  // Only the tour builder's own site may send a draft tour to run here ("Test on: Live DoorLoop")
  // or ask to open the builder here ("Build on: Live DoorLoop").
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
    if (showDrafts) {
      try {
        const res = await fetch(DRAFTS_URL, { cache: 'no-store' });
        tours = [...tours, ...(await res.json()).tours];
      } catch (e) {
        console.warn('[TourLayer] could not fetch draft tours', e);
      }
    }
    window.TourLayer.init({ tours });
    // A builder was open in this tab before the page reloaded: bring it back with the draft.
    const saved = window.TourBuilder.savedSession();
    if (saved) window.TourBuilder.open({ mode: 'live', restore: saved });
  })();

  // The builder page keeps sending until it hears back, so act on each message only once.
  const seen = new Set();
  window.addEventListener('message', (e) => {
    const type = e.data && e.data.type;
    if (!BUILDER_ORIGINS.includes(e.origin) || (type !== 'tour-layer:draft' && type !== 'tour-layer:build')) return;
    if (e.source) e.source.postMessage({ type: type + '-received', id: e.data.id }, e.origin);
    if (seen.has(e.data.id)) return;
    seen.add(e.data.id);
    ready.then(() => {
      if (type === 'tour-layer:draft') window.TourLayer.run(e.data.tour);
      else {
        const tour = e.data.tour && Array.isArray(e.data.tour.steps) ? e.data.tour : null; // editing an existing tour
        const folder = e.data.folder === 'demo-tours' ? 'demo-tours' : 'tours'; // where Save to GitHub puts it
        window.TourBuilder.open({ mode: 'live', name: String(e.data.name || 'New tour'), startPath: location.pathname, tour, folder });
      }
    });
  });
})();
