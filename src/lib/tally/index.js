// Vendored from tally sdk/js/src/index.js — @mattrickslauer/tally 0.1.0, tally@c174850. Do not edit here;
// re-copy with infra/vendor-tally.sh.
// The browser half: load tally's t.js on a page, and let the page talk to it
// before it has arrived.
//
// t.js is served by tally itself and does the real work (pageviews, links out,
// the consent banner, sending). This module only puts the <script> tag on the
// page and gives the page a `window.tally` to call straight away. Until t.js
// has loaded, calls wait in `window.tally.q` as `[method, ...args]`; t.js
// replays them in order when it starts. After that every call goes straight
// to t.js.
//
// It is safe to import during server-side rendering: with no `window`, every
// function does nothing. Like t.js, it never throws into the page — counting
// is never worth breaking a page over.

const DEFAULT_HOST = 'https://t.mattrickslauer.com';

// Marks the queueing stand-in, so we can tell it from the real t.js.
const STUB = '__tallyStub';

function browser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined' ? window : null;
}

// The stand-in. Calling it bare is the legacy `tally(name, label)`, which is
// queued as "event"; its methods queue under their own names.
function makeStub() {
  const stub = function () { push(stub, 'event', arguments); };
  for (const method of ['capture', 'identify', 'reset', 'optOut', 'optIn']) {
    stub[method] = function () { push(stub, method, arguments); };
  }
  stub.q = [];
  stub[STUB] = true;
  return stub;
}

function push(stub, method, args) {
  (stub.q = stub.q || []).push([method, ...Array.prototype.slice.call(args)]);
}

// A `window.tally` someone else already put there — the plain snippet in the
// README, or the real t.js — is left alone.
function ensureTally(w) {
  if (typeof w.tally !== 'function') w.tally = makeStub();
  return w.tally;
}

function call(method, args) {
  const w = browser();
  if (!w) return;
  try {
    const t = ensureTally(w);
    if (method === 'event') return void t(...args);
    if (typeof t[method] === 'function') return void t[method](...args);
    // A t.js too old to know the method. A capture can still be counted as a
    // legacy named event; the rest have nothing to land on.
    if (method === 'capture' && !t[STUB]) t(args[0]);
  } catch (err) { /* never break the page */ }
}

function hasScript(doc, src) {
  const scripts = doc.getElementsByTagName ? doc.getElementsByTagName('script') : [];
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    const given = s.getAttribute ? s.getAttribute('src') : null;
    // .src is the resolved URL in a browser; the attribute is what was written.
    if (s.src === src || given === src || (s.dataset && s.dataset.tally !== undefined)) return true;
  }
  return false;
}

/**
 * Put t.js on the page (once) and install the queue, so calls made before it
 * loads are kept. `src` wins over `host`; with neither it is tally's own.
 */
export function init(options = {}) {
  const w = browser();
  if (!w) return;
  try {
    ensureTally(w);
    const host = String(options.host || DEFAULT_HOST).replace(/\/+$/, '');
    const src = options.src || host + '/t.js';
    const doc = w.document || document;
    if (hasScript(doc, src)) return;
    const s = doc.createElement('script');
    s.src = src;
    s.defer = true;
    s.setAttribute('data-tally', '');
    (doc.head || doc.body || doc.documentElement).appendChild(s);
  } catch (err) { /* never break the page */ }
}

/** A named event with properties: capture('signup', { plan: 'pro' }). */
export function capture(name, properties) {
  call('capture', properties === undefined ? [name] : [name, properties]);
}

/** Tie this browser to your own id for the user, with traits about them. */
export function identify(id, properties) {
  call('identify', properties === undefined ? [id] : [id, properties]);
}

/** Forget the identified user (on log out). */
export function reset() { call('reset', []); }

/** Stop counting this browser on this site. */
export function optOut() { call('optOut', []); }

/** Undo optOut(). */
export function optIn() { call('optIn', []); }

/** The legacy call, tally(name, label): a named event with one short label. */
export function event(name, label) {
  call('event', label === undefined ? [name] : [name, label]);
}
