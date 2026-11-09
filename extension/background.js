// The extension's background: signs in to GitHub and saves tour files there, so the builder can save a tour with
// one click. The GitHub login is kept here, in the extension's own storage, and never handed to DoorLoop's page.
//
// Sign-in is GitHub's device flow through a GitHub App (Contents: read and write, installed only on this repo):
// the menu shows a code, the person enters it at github.com/login/device, and this worker waits for the login.
'use strict';

// The GitHub App's Client ID (not a secret). Empty until the app is registered; the menu then says so.
const CLIENT_ID = 'Iv23li4Bifpd7B7DLSbl'; // the "DoorLoop Tours" GitHub App (public, not a secret)
const REPO = 'shuang-dl/product-tour-layer';
const BRANCH = 'main';

const STORE = 'tourLayer.github'; // { token, login, canSave }
const SIGNIN = 'tourLayer.githubSignin'; // the sign-in in progress: { userCode, uri, expiresAt } or { error }
// Tests point these at a stand-in GitHub: { web, api, clientId }.
const OVERRIDE = 'tourLayer.githubTest';

async function config() {
  const { [OVERRIDE]: o } = await chrome.storage.local.get(OVERRIDE);
  return { web: o?.web || 'https://github.com', api: o?.api || 'https://api.github.com', clientId: o?.clientId || CLIENT_ID };
}

const form = (data) => ({
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data),
});

async function status() {
  const { clientId } = await config();
  const { [STORE]: auth, [SIGNIN]: signin } = await chrome.storage.local.get([STORE, SIGNIN]);
  return { setUp: !!clientId, login: auth?.login || null, canSave: !!auth?.canSave, signin: signin || null };
}

async function startSignin() {
  const { web, clientId } = await config();
  if (!clientId) return { error: 'GitHub sign-in is not set up yet.' };
  const res = await fetch(`${web}/login/device/code`, form({ client_id: clientId }));
  const code = await res.json();
  if (!code.device_code) return { error: code.error_description || 'GitHub did not start the sign-in.' };
  const signin = { userCode: code.user_code, uri: code.verification_uri, expiresAt: Date.now() + code.expires_in * 1000 };
  await chrome.storage.local.set({ [SIGNIN]: signin });
  wait(code.device_code, (code.interval || 5) * 1000, signin.expiresAt);
  return signin;
}

// Ask GitHub every few seconds whether the code was entered, until it was, was refused, or expired.
// Writing to storage on each round keeps this worker alive meanwhile.
async function wait(deviceCode, interval, expiresAt) {
  const { web, api, clientId } = await config();
  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, interval));
    const res = await fetch(`${web}/login/oauth/access_token`, form({
      client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }));
    const answer = await res.json();
    if (answer.access_token) {
      const headers = { Authorization: `Bearer ${answer.access_token}`, Accept: 'application/vnd.github+json' };
      const me = await (await fetch(`${api}/user`, { headers })).json();
      // Anyone can sign in, but only someone who can change the repo (a contributor with write access) can save.
      const repo = await fetch(`${api}/repos/${REPO}`, { headers });
      const canSave = repo.ok && !!(await repo.json()).permissions?.push;
      await chrome.storage.local.set({ [STORE]: { token: answer.access_token, login: me.login, canSave } });
      await chrome.storage.local.remove(SIGNIN);
      return;
    }
    if (answer.error === 'slow_down') interval += 5000;
    else if (answer.error !== 'authorization_pending') {
      await chrome.storage.local.set({ [SIGNIN]: { error: answer.error === 'access_denied' ? 'Sign-in was cancelled on GitHub.' : 'The code expired. Try again.' } });
      return;
    }
    await chrome.storage.local.set({ [SIGNIN]: { ...(await chrome.storage.local.get(SIGNIN))[SIGNIN], checkedAt: Date.now() } });
  }
  await chrome.storage.local.set({ [SIGNIN]: { error: 'The code expired. Try again.' } });
}

// Save one tour file to the repo as a commit. mode 'create' refuses to replace an existing file (exists: true comes
// back, and the builder asks first); 'replace' updates it.
async function save({ path, content, message, mode }) {
  const { api } = await config();
  const { [STORE]: auth } = await chrome.storage.local.get(STORE);
  if (!auth) return { error: 'signed-out' };
  if (!auth.canSave) return { error: `${auth.login} can't change ${REPO} on GitHub. Ask for write access, then sign in again.` };
  const headers = { Authorization: `Bearer ${auth.token}`, Accept: 'application/vnd.github+json' };
  const url = `${api}/repos/${REPO}/contents/${path}`;
  const current = await fetch(`${url}?ref=${BRANCH}`, { headers });
  if (current.status === 401) return { error: 'signed-out' };
  const sha = current.ok ? (await current.json()).sha : undefined;
  if (sha && mode === 'create') return { exists: true };
  const bytes = new TextEncoder().encode(content);
  const put = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message, content: btoa(String.fromCharCode(...bytes)), branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
  if (put.status === 401) return { error: 'signed-out' };
  if (!put.ok) {
    const detail = await put.json().catch(() => ({}));
    return { error: put.status === 404 || put.status === 403 ? "Your GitHub sign-in can't change this repo. Is the app installed on it?" : detail.message || `GitHub said ${put.status}.` };
  }
  const done = await put.json();
  return { ok: true, commitUrl: done.commit?.html_url, fileUrl: done.content?.html_url };
}

// Reporting (test): tour events from DoorLoop tabs are queued here and sent in batches to the collector set in the
// extension's menu: the tour-reports app on DeployBay, or http://localhost:4174/events (npm run collector). No collector
// set: events are dropped. DeployBay apps need the VPN and a DoorLoop sign-in, so the request carries this browser's
// cookies; a sign-in page instead of the app's answer counts as a failed send.
// Unsent events wait in storage (the newest 1000) and go with the next batch.
const COLLECTOR = 'tourLayer.collector';
const QUEUE = 'tourLayer.events';
const MAX_QUEUE = 1000;
const SEND_AFTER_MS = 5000;
const RETRY_MS = 30000;
let chain = Promise.resolve();
const inTurn = (fn) => (chain = chain.then(fn, fn)); // one storage change at a time, so no event is lost
let sendTimer = null;
const sendSoon = (ms) => {
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => inTurn(send), ms);
};

async function track(event) {
  const { [COLLECTOR]: url, [QUEUE]: queue = [] } = await chrome.storage.local.get([COLLECTOR, QUEUE]);
  if (!url || !event || typeof event.type !== 'string') return { ok: true, queued: false };
  await chrome.storage.local.set({ [QUEUE]: [...queue, event].slice(-MAX_QUEUE) });
  // The end of a run goes straight away; the rest within a few seconds, together
  sendSoon(/^tour_(finished|closed)$/.test(event.type) ? 0 : SEND_AFTER_MS);
  return { ok: true, queued: true };
}

async function send() {
  const { [COLLECTOR]: url, [QUEUE]: queue = [] } = await chrome.storage.local.get([COLLECTOR, QUEUE]);
  if (!url || !queue.length) return;
  try {
    // text/plain keeps it a simple request (no CORS preflight); the body is JSON
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ events: queue }) });
    const answer = await res.json().catch(() => null);
    if (!res.ok || !answer || !answer.ok) throw new Error(`collector said ${res.status}${answer ? '' : ' (not the collector: a sign-in page?)'}`);
    await chrome.storage.local.set({ [QUEUE]: [] });
  } catch (e) {
    console.warn('[TourLayer] could not send tour events; trying again later', e);
    sendSoon(RETRY_MS);
  }
}

async function collector() {
  const { [COLLECTOR]: url = '', [QUEUE]: queue = [] } = await chrome.storage.local.get([COLLECTOR, QUEUE]);
  return { url, waiting: queue.length };
}
async function setCollector(url) {
  url = String(url || '').trim();
  if (url && !/^https?:\/\/[^\s]+$/.test(url)) return { error: 'Enter a web address starting with http:// or https://' };
  if (url) await chrome.storage.local.set({ [COLLECTOR]: url });
  else await chrome.storage.local.remove([COLLECTOR, QUEUE]);
  return collector();
}
chrome.runtime.onStartup.addListener(() => inTurn(send));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = {
    // Only DoorLoop tabs (the content script) report tour events
    'tour-layer:track': () => (sender.tab ? inTurn(() => track(msg.event)) : Promise.resolve({ error: 'not from a tab' })),
    'tour-layer:collector-get': collector,
    'tour-layer:collector-set': () => inTurn(() => setCollector(msg.url)),
    'tour-layer:github-status': status,
    'tour-layer:github-signin': startSignin,
    'tour-layer:github-signout': () => chrome.storage.local.remove([STORE, SIGNIN]).then(() => ({ ok: true })),
    'tour-layer:github-save': () => save(msg),
    // The builder's step screenshots: a picture of the tab as it is now (the builder hides itself first).
    'tour-layer:capture': async () => ({ dataUrl: await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }) }),
  }[msg && msg.type];
  if (!run) return;
  run().then(reply, (e) => reply({ error: e.message }));
  return true; // replying asynchronously
});
