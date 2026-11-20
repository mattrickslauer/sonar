// Vendored from tally sdk/js/src/server.js — @mattrickslauer/tally 0.1.0, tally@c174850. Do not edit here;
// re-copy with infra/vendor-tally.sh.
// The server half: send events from your own backend — a purchase confirmed by
// a Stripe webhook, a signup, a job finished — with your site's secret key.
//
//   const tally = new Tally({ key: process.env.TALLY_KEY });
//   tally.capture({ distinctId: user.id, event: 'purchase', properties: { plan: 'pro' } });
//   await tally.shutdown();   // on the way out
//
// Events are kept and sent together: when `flushAt` have gathered, or
// `flushInterval` ms after the first one, whichever is sooner. The timer is
// unref()'d, so it never holds a Node process open; call shutdown() (or
// flush()) before exit if the last few events matter.
//
// In an edge or serverless runtime, where nothing runs after the response,
// use `flushAt: 1` and hand the send to the platform:
// `ctx.waitUntil(tally.flush())`.
//
// Nothing here throws into your app. Bad input is dropped with a warning, a
// failed send is retried (network error, 5xx, 429; three tries in all) and then
// given up on; both are reported to `onError`, which defaults to console.warn.

import * as check from './tally-validate.mjs';

const DEFAULT_HOST = 'https://t.mattrickslauer.com';
const TRIES = 3;
const BACKOFF = 500; // ms before the second try; doubled before the third
const MAX_WAIT = 10_000; // the longest a Retry-After is honoured for
const encoder = new TextEncoder();

export class TallyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TallyError';
    Object.assign(this, details);
  }
}

function warnToConsole(err) {
  // eslint-disable-next-line no-console
  console.warn('[tally]', err.message);
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t && typeof t.unref === 'function') t.unref();
  });
}

function bytes(s) { return encoder.encode(s).length; }

export class Tally {
  /**
   * @param {object} options
   * @param {string} options.key        the site's secret key, sk_<site>_<hex>
   * @param {string} [options.host]     where tally lives
   * @param {number} [options.flushAt]  send once this many are waiting
   * @param {number} [options.flushInterval] ms after the first waiting event to send anyway
   * @param {number} [options.timeout]  ms one request may take
   * @param {(err: TallyError) => void} [options.onError]
   * @param {number} [options.maxQueueSize] events kept while tally can't be reached
   * @param {typeof fetch} [options.fetch]  for tests or a runtime without a global
   * @param {(ms: number) => Promise<void>} [options.sleep]  for tests
   */
  constructor({
    key, host = DEFAULT_HOST, flushAt = 20, flushInterval = 2000, timeout = 5000,
    onError, maxQueueSize = 10_000, fetch: fetchImpl, sleep = defaultSleep,
  } = {}) {
    this.onError = typeof onError === 'function' ? onError : warnToConsole;
    if (!key || typeof key !== 'string') {
      // Still usable: nothing is sent, and the app keeps working.
      this._report(new TallyError('no key given; events will not be sent', { code: 'config' }));
    }
    this.key = key || '';
    this.url = String(host).replace(/\/+$/, '') + '/e';
    this.flushAt = Math.max(1, Math.min(check.MAX_BATCH, Math.floor(flushAt) || 1));
    this.flushInterval = flushInterval;
    this.timeout = timeout;
    this.maxQueueSize = maxQueueSize;
    this._fetch = fetchImpl || globalThis.fetch;
    this._sleep = sleep;
    this._queue = [];
    this._timer = null;
    this._sending = Promise.resolve();
    this._closed = false;
  }

  /** Queue an event. Returns false if it was dropped. */
  capture({ distinctId, event, properties, timestamp } = {}) {
    const warn = (m) => this._report(new TallyError(m, { code: 'invalid' }));
    const name = check.eventName(event, warn);
    const id = name === null ? null : check.distinctId(distinctId, warn);
    if (name === null || id === null) return false;
    const item = { type: 'capture', event: name, distinct_id: id };
    const props = check.properties(properties, warn);
    if (props !== undefined) item.properties = props;
    item.timestamp = check.timestamp(timestamp, warn);
    return this._enqueue(item);
  }

  /** Attach properties to a user. Returns false if it was dropped. */
  identify({ distinctId, properties } = {}) {
    const warn = (m) => this._report(new TallyError(m, { code: 'invalid' }));
    const id = check.distinctId(distinctId, warn);
    if (id === null) return false;
    const item = { type: 'identify', distinct_id: id };
    const props = check.properties(properties, warn);
    if (props !== undefined) item.properties = props;
    return this._enqueue(item);
  }

  /** Send everything waiting. Resolves when it has gone (or been given up on); never rejects. */
  flush() {
    this._clearTimer();
    // One send at a time, in order: a flush waits for any already going.
    const run = this._sending.then(() => this._drain());
    this._sending = run.catch(() => {});
    return this._sending;
  }

  /** Send what's left and stop. Later captures are dropped. */
  async shutdown() {
    this._closed = true;
    await this.flush();
  }

  // --- inside ---------------------------------------------------------------

  _report(err) {
    try { this.onError(err); } catch (e) { /* a broken logger is not our crash */ }
  }

  _enqueue(item) {
    if (this._closed) {
      this._report(new TallyError('capture after shutdown; dropped', { code: 'closed' }));
      return false;
    }
    if (this._queue.length >= this.maxQueueSize) {
      this._report(new TallyError(`queue is full (${this.maxQueueSize}); event dropped`, { code: 'full' }));
      return false;
    }
    this._queue.push(item);
    if (this._queue.length >= this.flushAt) this.flush();
    else this._startTimer();
    return true;
  }

  _startTimer() {
    if (this._timer || !(this.flushInterval > 0)) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, this.flushInterval);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  }

  _clearTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  async _drain() {
    while (this._queue.length) {
      const batch = this._takeBatch();
      if (batch.length) await this._send(batch);
    }
  }

  // Up to 100 items, and no more than fit in 256 KB once wrapped.
  _takeBatch() {
    const batch = [];
    let size = bytes('{"batch":[]}');
    while (this._queue.length && batch.length < check.MAX_BATCH) {
      const one = bytes(JSON.stringify(this._queue[0])) + (batch.length ? 1 : 0);
      if (size + one > check.MAX_BODY) {
        if (batch.length) break;
        this._queue.shift(); // alone it is too big; it can never be sent
        this._report(new TallyError('event is larger than 256 KB; dropped', { code: 'invalid' }));
        continue;
      }
      batch.push(this._queue.shift());
      size += one;
    }
    return batch;
  }

  async _send(batch) {
    if (!this.key || typeof this._fetch !== 'function') {
      this._report(new TallyError(
        !this.key ? 'no key; batch not sent' : 'no fetch available; batch not sent',
        { code: 'config', batch }));
      return;
    }
    const body = JSON.stringify({ batch });
    let last;
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      let wait = BACKOFF * 2 ** (attempt - 1);
      try {
        const res = await this._post(body);
        if (res.ok) return this._read(res, batch);
        const text = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
        last = new TallyError(`tally answered ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`,
          { code: 'http', status: res.status, batch });
        // 4xx is our fault (or the key's) and will be the same next time; 429 is not.
        if (res.status !== 429 && res.status < 500) break;
        const after = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        if (res.status === 429 && after > 0) wait = Math.min(after * 1000, MAX_WAIT);
      } catch (err) {
        last = new TallyError(`could not reach tally: ${err && err.message ? err.message : err}`,
          { code: 'network', cause: err, batch });
      }
      if (attempt < TRIES) await this._sleep(wait);
    }
    this._report(last);
  }

  async _post(body) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller && this.timeout > 0
      ? setTimeout(() => controller.abort(), this.timeout) : null;
    if (timer && typeof timer.unref === 'function') timer.unref();
    try {
      return await this._fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'x-tally-key': this.key },
        body,
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 200 can still turn some items away; say which.
  async _read(res, batch) {
    let answer;
    try { answer = await res.json(); } catch (err) { return; }
    const rejected = answer && Array.isArray(answer.rejected) ? answer.rejected : [];
    if (!rejected.length) return;
    const items = rejected.map((r) => ({ ...r, item: batch[r.i] }));
    const first = rejected[0];
    this._report(new TallyError(
      `tally rejected ${rejected.length} of ${batch.length}: ${first.error}`,
      { code: 'rejected', rejected: items }));
  }
}

export default Tally;
