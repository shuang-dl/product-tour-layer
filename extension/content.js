// Fetches the latest published tours; falls back to the copy bundled into the extension at build time.
// app.doorloop.com itself is excluded in the manifest: it redirects to your account's subdomain,
// and the tour should start there so ?tour= survives the redirect.
(function () {
  'use strict';
  const TOURS_URL = 'https://shuang-dl.github.io/product-tour-layer/tours.json';
  const DRAFTS_URL = 'https://shuang-dl.github.io/product-tour-layer/drafts.json';
  // Draft tours only load for people who turned on Show drafts: the extension's menu has a switch, and a ?drafts=on
  // link (from the tours page) turns it on in this browser, ?drafts=off turns it off.
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
  let published = []; // live tours, for the extension's menu
  const ready = (async () => {
    let tours;
    try {
      const res = await fetch(TOURS_URL, { cache: 'no-store' });
      tours = (await res.json()).tours;
    } catch (e) {
      console.warn('[TourLayer] could not fetch published tours, using the bundled copy', e);
      tours = window.TOUR_LAYER_BUNDLED.tours;
    }
    published = tours;
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
    if (saved) window.TourBuilder.open({ restore: saved });
  })();

  // The extension's menu (popup.js) asks what's here, opens the builder, or switches Show drafts. Only the
  // extension's own pages can send these; web pages can't.
  async function fetchDrafts() {
    try {
      return (await (await fetch(DRAFTS_URL, { cache: 'no-store' })).json()).tours;
    } catch {
      return [];
    }
  }
  const forMenu = (t, status) => ({ id: t.id, title: t.title, page: t.page, status });
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('tour-layer:menu-')) return;
    (async () => {
      await ready;
      if (msg.type === 'tour-layer:menu-info') {
        const drafts = await fetchDrafts();
        return {
          path: location.pathname, showDrafts, building: !!document.getElementById('tour-layer-builder'),
          tours: [...published.map((t) => forMenu(t, 'live')), ...drafts.map((t) => forMenu(t, 'draft'))],
        };
      }
      if (msg.type === 'tour-layer:menu-new') {
        window.TourBuilder.open({ name: String(msg.name || 'New tour'), startPath: location.pathname });
      } else if (msg.type === 'tour-layer:menu-edit') {
        const tour = published.find((t) => t.id === msg.id) || (await fetchDrafts()).find((t) => t.id === msg.id);
        if (tour) window.TourBuilder.open({ name: tour.title || tour.id, startPath: location.pathname, tour });
      } else if (msg.type === 'tour-layer:menu-drafts') {
        try {
          if (msg.on) localStorage.setItem(DRAFTS_KEY, '1');
          else localStorage.removeItem(DRAFTS_KEY);
        } catch {}
        setTimeout(() => location.reload(), 50); // drafts load with the page
      }
      return { ok: true };
    })().then(reply);
    return true; // replying asynchronously
  });
})();
