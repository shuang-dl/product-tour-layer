// The extension's menu (click its icon): build a new tour on this DoorLoop page, open a published tour or a draft
// in the builder, or turn Show drafts on or off. It talks to the content script in the DoorLoop tab (content.js).
// popup.html?tab=<id> targets that tab instead of the active one (used by the tests, which open the menu as a page).
'use strict';

const DOORLOOP = /^https:\/\/[a-z0-9-]+\.app\.doorloop\.com\//; // an account's address, not the bare app.doorloop.com
const main = document.getElementById('main');

function el(tag, props, children) {
  const node = Object.assign(document.createElement(tag), props);
  (children || []).forEach((c) => node.append(c));
  return node;
}

async function targetTab() {
  const id = Number(new URLSearchParams(location.search).get('tab'));
  if (id) return chrome.tabs.get(id);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function ask(tab, message) {
  return chrome.tabs.sendMessage(tab.id, message);
}

function notOnDoorLoop() {
  main.replaceChildren(
    el('p', { textContent: 'Open DoorLoop to build or edit tours. The menu works on any DoorLoop page.' }),
    el('button', { textContent: 'Open DoorLoop', onclick: () => chrome.tabs.create({ url: 'https://app.doorloop.com/' }).then(() => window.close()) })
  );
}

function render(tab, info) {
  // New tour
  const name = el('input', { type: 'text', placeholder: 'Tour name, e.g. Add a new property' });
  const build = el('button', { textContent: 'Build a new tour here', disabled: true });
  name.oninput = () => (build.disabled = !name.value.trim());
  // A block body: an on* handler that returns false cancels the key, so nothing could be typed.
  name.onkeydown = (e) => {
    if (e.key === 'Enter' && !build.disabled) build.click();
  };
  build.onclick = async () => {
    await ask(tab, { type: 'tour-layer:menu-new', name: name.value.trim() });
    window.close();
  };

  // Edit a tour
  const pick = el('select');
  for (const [label, status] of [['Live', 'live'], ['Drafts', 'draft']]) {
    const list = info.tours.filter((t) => t.status === status);
    if (!list.length) continue;
    const group = el('optgroup', { label });
    list.forEach((t) => group.append(el('option', { value: t.id, textContent: `${t.title} (${t.page})` })));
    pick.append(group);
  }
  const edit = el('button', { textContent: 'Open in the builder', disabled: !pick.options.length });
  edit.onclick = async () => {
    await ask(tab, { type: 'tour-layer:menu-edit', id: pick.value });
    window.close();
  };

  // Show drafts
  const drafts = el('input', { type: 'checkbox', checked: info.showDrafts });
  drafts.onchange = async () => {
    await ask(tab, { type: 'tour-layer:menu-drafts', on: drafts.checked });
    window.close();
  };

  main.replaceChildren(
    el('p', {}, ['On ', el('code', { textContent: info.path })]),
    ...(info.building ? [el('p', { className: 'note', textContent: "The builder is open on this page; starting another replaces it (copy its tour file first if you're keeping it)." })] : []),
    el('section', {}, [el('h2', { textContent: 'New tour' }), name, build]),
    el('section', {}, [el('h2', { textContent: 'Edit a tour' }), ...(pick.options.length ? [pick] : [el('p', { textContent: 'No tours yet.' })]), edit]),
    el('section', {}, [el('h2', { textContent: 'Drafts' }), el('label', { className: 'switch' }, [drafts, 'Show drafts on DoorLoop (reloads the page)'])])
  );
  name.focus();
}

(async () => {
  const tab = await targetTab();
  if (!tab || !tab.url || !DOORLOOP.test(tab.url)) return notOnDoorLoop();
  try {
    render(tab, await ask(tab, { type: 'tour-layer:menu-info' }));
  } catch {
    main.replaceChildren(el('p', { textContent: 'Reload this DoorLoop page, then open the menu again. (The page was opened before the extension was loaded or updated.)' }));
  }
})();
