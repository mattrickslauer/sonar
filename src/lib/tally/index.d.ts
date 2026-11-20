// Vendored from tally sdk/js/src/index.d.ts — @mattrickslauer/tally 0.1.0, tally@c174850. Do not edit here;
// re-copy with infra/vendor-tally.sh.
/** A property value the collector keeps: strings are cut to 200 characters. */
export type PropertyValue = string | number | boolean | null;

/** Flat, at most 25 keys, each matching /^[A-Za-z0-9_$.-]{1,40}$/. */
export type Properties = Record<string, PropertyValue | undefined>;

export interface InitOptions {
  /** Full URL of t.js. Wins over `host`. */
  src?: string;
  /** Where tally lives; t.js is loaded from `${host}/t.js`. Default https://t.mattrickslauer.com */
  host?: string;
}

/** The method names queued in `window.tally.q` before t.js loads. */
export type QueuedMethod = 'event' | 'capture' | 'identify' | 'reset' | 'optOut' | 'optIn';

/** One waiting call: `[method, ...args]`. */
export type QueuedCall = [QueuedMethod, ...unknown[]];

/** `window.tally` as t.js defines it (or the stand-in that queues for it). */
export interface TallyGlobal {
  (name: string, label?: string): void;
  capture(name: string, properties?: Properties): void;
  identify(id: string | number, properties?: Properties): void;
  reset(): void;
  optOut(): void;
  optIn(): void;
  q?: QueuedCall[];
}

declare global {
  interface Window {
    tally?: TallyGlobal;
  }
}

/** Put t.js on the page once and install the queue. Does nothing without `window`. */
export function init(options?: InitOptions): void;
/** A named event, lowercased; name must match /^[a-z0-9][a-z0-9_.:-]{0,39}$/. */
export function capture(name: string, properties?: Properties): void;
/** Tie this browser to your own id for the user. */
export function identify(id: string | number, properties?: Properties): void;
/** Forget the identified user. */
export function reset(): void;
/** Stop counting this browser on this site. */
export function optOut(): void;
/** Undo optOut(). */
export function optIn(): void;
/** Legacy `tally(name, label)`. */
export function event(name: string, label?: string): void;
