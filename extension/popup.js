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

// GitHub: sign in once (a code to enter on GitHub's page), so the builder's Save tour commits on its own. Anyone can
// sign in, but only someone with write access to the repo can save; the background checks that at sign-in.
const background = (type) => chrome.runtime.sendMessage({ type });
function githubSection() {
  const body = el('div', { className: 'gh' });
  const show = async () => {
    const s = await background('tour-layer:github-status');
    if (!s.setUp) return body.replaceChildren(el('p', { textContent: "GitHub sign-in isn't set up yet: the extension needs its GitHub App's Client ID." }));
    if (s.login) {
      return body.replaceChildren(
        el('p', { className: s.canSave ? '' : 'error', textContent: s.canSave
          ? `Signed in as ${s.login}. Save tour in the builder commits to GitHub.`
          : `Signed in as ${s.login}, who can't change shuang-dl/product-tour-layer, so saving is off. Ask for write access, then sign in again.` }),
        el('button', { className: 'quiet', textContent: 'Sign out', onclick: () => background('tour-layer:github-signout').then(show) })
      );
    }
    const pending = s.signin && s.signin.userCode && Date.now() < s.signin.expiresAt;
    if (pending) {
      body.replaceChildren(
        el('p', { textContent: 'Enter this code on GitHub:' }),
        el('div', { className: 'code', textContent: s.signin.userCode }),
        el('div', { className: 'row' }, [
          el('button', { textContent: 'Open GitHub', onclick: () => chrome.tabs.create({ url: s.signin.uri }) }),
          el('button', { className: 'quiet', textContent: 'Copy code', onclick: () => navigator.clipboard.writeText(s.signin.userCode) }),
        ]),
        el('p', { textContent: 'Waiting for you to enter it. You can close this menu; the sign-in finishes on its own.' })
      );
      return setTimeout(show, 1500);
    }
    body.replaceChildren(
      ...(s.signin && s.signin.error ? [el('p', { className: 'error', textContent: s.signin.error })] : []),
      el('p', { textContent: 'Sign in so the builder can save tours straight to GitHub. Only contributors to product-tour-layer can save.' }),
      el('button', { textContent: 'Sign in with GitHub', onclick: async () => {
        const r = await background('tour-layer:github-signin');
        if (r && r.error) body.prepend(el('p', { className: 'error', textContent: r.error }));
        else show();
      } })
    );
  };
  show();
  return el('section', {}, [el('h2', { textContent: 'GitHub' }), body]);
}

function notOnDoorLoop() {
  main.replaceChildren(
    el('p', { textContent: 'Open DoorLoop to build or edit tours. The menu works on any DoorLoop page.' }),
    el('button', { textContent: 'Open DoorLoop', onclick: () => chrome.tabs.create({ url: 'https://app.doorloop.com/' }).then(() => window.close()) }),
    githubSection()
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
    el('section', {}, [el('h2', { textContent: 'Drafts' }), el('label', { className: 'switch' }, [drafts, 'Show drafts on DoorLoop (reloads the page)'])]),
    githubSection()
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
