// Vendored from tally sdk/js/src/server.d.ts — @mattrickslauer/tally 0.1.0, tally@c174850. Do not edit here;
// re-copy with infra/vendor-tally.sh.
import type { Properties } from '../../tally/index.js';

export type { Properties, PropertyValue } from '../../tally/index.js';

export type TallyErrorCode =
  | 'invalid'   // input dropped or changed before sending
  | 'http'      // tally answered with an error status
  | 'network'   // tally could not be reached (or timed out)
  | 'rejected'  // a 200 that turned some items away
  | 'config'    // no key, or no fetch
  | 'full'      // the waiting queue hit maxQueueSize
  | 'closed';   // captured after shutdown()

export interface BatchItem {
  type: 'capture' | 'identify';
  distinct_id: string;
  event?: string;
  properties?: Record<string, string | number | boolean | null>;
  timestamp?: string;
}

export declare class TallyError extends Error {
  name: 'TallyError';
  code: TallyErrorCode;
  /** On 'http'. */
  status?: number;
  /** On 'http', 'network', 'config': the items that were not delivered. */
  batch?: BatchItem[];
  /** On 'rejected'. */
  rejected?: Array<{ i: number; error: string; item: BatchItem }>;
  cause?: unknown;
}

export interface TallyOptions {
  /** The site's secret key, sk_<site>_<32 hex>. */
  key: string;
  /** Default https://t.mattrickslauer.com */
  host?: string;
  /** Send once this many are waiting (1–100). Default 20; use 1 on edge runtimes. */
  flushAt?: number;
  /** Ms after the first waiting event to send anyway. Default 2000; 0 turns the timer off. */
  flushInterval?: number;
  /** Ms one request may take. Default 5000. */
  timeout?: number;
  /** Told about every drop and failed send. Default: console.warn. Never throws into your app. */
  onError?: (error: TallyError) => void;
  /** Events kept while tally can't be reached. Default 10000. */
  maxQueueSize?: number;
  /** A fetch to use instead of the global one. */
  fetch?: typeof fetch;
  /** Waits between retries; for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CaptureInput {
  /** Your id for the user (numbers are turned into strings). */
  distinctId: string | number;
  /** Lowercased, then must match /^[a-z0-9][a-z0-9_.:-]{0,39}$/. */
  event: string;
  properties?: Properties;
  /** Date, ISO string, or epoch milliseconds. Default: now. */
  timestamp?: Date | string | number;
}

export interface IdentifyInput {
  distinctId: string | number;
  properties?: Properties;
}

export declare class Tally {
  constructor(options: TallyOptions);
  /** Queue an event. False if it was dropped. */
  capture(input: CaptureInput): boolean;
  /** Attach properties to a user. False if it was dropped. */
  identify(input: IdentifyInput): boolean;
  /** Send everything waiting. Never rejects. */
  flush(): Promise<void>;
  /** Send what's left and stop accepting events. Never rejects. */
  shutdown(): Promise<void>;
}

export default Tally;
