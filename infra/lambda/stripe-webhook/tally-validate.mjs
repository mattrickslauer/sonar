// Vendored from tally sdk/js/src/validate.js — @mattrickslauer/tally 0.1.0, tally@c174850. Do not edit here;
// re-copy with infra/vendor-tally.sh.
// The collector's rules, checked before anything is sent. The server enforces
// the same ones; checking here means one bad property costs that property, not
// the whole event, and a typo shows up in your logs instead of as a silent 400.
//
// Nothing here throws. Each function returns the cleaned value and calls
// `warn(message)` for every thing it had to drop or change.

export const MAX_BATCH = 100;
export const MAX_BODY = 256 * 1024;
export const MAX_KEYS = 25;
export const MAX_STRING = 200;
export const MAX_ID = 200;

const EVENT = /^[a-z0-9][a-z0-9_.:-]{0,39}$/;
const KEY = /^[A-Za-z0-9_$.-]{1,40}$/;

// Lengths are counted in characters (code points), as the Python collector
// counts them, and cutting never splits a surrogate pair.
function cut(s, n) {
  if (s.length <= n) return s;
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n).join('');
}

function length(s) {
  return s.length <= MAX_ID ? s.length : Array.from(s).length;
}

/** Lowercased event name, or null if it can't be one. */
export function eventName(name, warn) {
  if (typeof name !== 'string') {
    warn(`event name must be a string, got ${typeof name}; event dropped`);
    return null;
  }
  const lower = name.toLowerCase();
  if (!EVENT.test(lower)) {
    warn(`event name ${JSON.stringify(name)} must match ${EVENT}; event dropped`);
    return null;
  }
  return lower;
}

/** distinct_id as a string (numbers are turned into one), or null. */
export function distinctId(id, warn) {
  if (typeof id === 'number' && Number.isFinite(id)) id = String(id);
  else if (typeof id === 'bigint') id = String(id);
  if (typeof id !== 'string' || id.length === 0) {
    warn('distinct_id must be a non-empty string or a number; event dropped');
    return null;
  }
  // Not cut short: two users whose ids share 200 characters would become one.
  if (length(id) > MAX_ID) {
    warn(`distinct_id is longer than ${MAX_ID} characters; event dropped`);
    return null;
  }
  return id;
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A flat object the collector will take, or undefined when there's nothing. */
export function properties(props, warn) {
  if (props === undefined || props === null) return undefined;
  if (!isPlainObject(props)) {
    warn('properties must be a plain object; properties dropped');
    return undefined;
  }
  const out = {};
  let kept = 0;
  for (const key of Object.keys(props)) {
    let value = props[key];
    if (value === undefined) continue; // JSON would leave it out anyway
    if (!KEY.test(key)) {
      warn(`property key ${JSON.stringify(key)} must match ${KEY}; dropped`);
      continue;
    }
    if (typeof value === 'string') {
      value = cut(value, MAX_STRING);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        warn(`property ${key} is not a finite number; dropped`);
        continue;
      }
    } else if (typeof value !== 'boolean' && value !== null) {
      warn(`property ${key} must be a string, number, boolean or null; dropped`);
      continue;
    }
    if (kept === MAX_KEYS) {
      warn(`more than ${MAX_KEYS} properties; the rest dropped`);
      break;
    }
    out[key] = value;
    kept++;
  }
  return out;
}

/** An ISO-8601 time (UTC, milliseconds). Missing or unreadable means now. */
export function timestamp(when, warn, now = () => new Date()) {
  if (when === undefined || when === null) return now().toISOString();
  let d;
  if (when instanceof Date) d = when;
  else if (typeof when === 'number') d = new Date(when); // epoch milliseconds
  else if (typeof when === 'string') d = new Date(when);
  if (!d || Number.isNaN(d.getTime())) {
    warn(`timestamp ${JSON.stringify(String(when))} is not a date; using now`);
    return now().toISOString();
  }
  return d.toISOString();
}
