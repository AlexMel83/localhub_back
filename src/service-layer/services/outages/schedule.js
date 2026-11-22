// Outage schedule contract (mirrored by the Nuxt types in
// localhub/server/utils/svitlo/types.ts) and pure builders.
import {
  SLOTS_PER_DAY,
  SLOT_MINUTES,
  kyivLocalToDate,
  toKyivIso,
  parseHm,
} from './time.js';

/**
 * @typedef {'on'|'off'|'maybe'|'unknown'} SlotStatus
 * @typedef {'published'|'empty'|'not_published'|'emergency'} PublishedState
 * @typedef {{ start: string, end: string, status: 'off'|'maybe', minutes: number }} Interval
 * @typedef {{
 *   queue: string,
 *   slots: SlotStatus[],
 *   intervals: Interval[],
 *   totalOffMinutes: number,
 *   totalMaybeMinutes: number,
 *   publishedState: PublishedState,
 * }} QueueDay
 * @typedef {{
 *   region: string,
 *   date: string,
 *   provider: string,
 *   emergency: boolean,
 *   sourceUpdatedAt: string|null,
 *   queues: QueueDay[],
 * }} RegionDay
 */

/** Normalizes queue ids: "3-1", "3.1", " 3,1 " -> "3.1"; "7" -> "7". */
export function normalizeQueue(q) {
  const pair = /^\s*(\d{1,2})\s*[.,\-_]\s*(\d{1,2})\s*$/.exec(String(q));
  if (pair) return `${Number(pair[1])}.${Number(pair[2])}`;
  const single = /^\s*(\d{1,2})\s*$/.exec(String(q));
  return single ? String(Number(single[1])) : null;
}

/** Numeric queue order: 1.1, 1.2, 2.1 ... 10.1. */
export function compareQueues(a, b) {
  const [a1, a2 = 0] = a.split('.').map(Number);
  const [b1, b2 = 0] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}

/**
 * Builds 48 slots from minute ranges. A partially covered slot takes the
 * range status (sources publish on a 30-minute grid).
 */
export function slotsFromRanges(ranges, base = 'on', status = 'off') {
  const slots = Array.from({ length: SLOTS_PER_DAY }, () => base);
  for (const [from, to] of ranges) {
    const first = Math.max(0, Math.floor(from / SLOT_MINUTES));
    const last = Math.min(SLOTS_PER_DAY, Math.ceil(to / SLOT_MINUTES));
    for (let i = first; i < last; i++) slots[i] = status;
  }
  return slots;
}

/** Parses "06:00-10:00; 17:00-21:00" into minute ranges. Null on any error. */
export function parseRanges(text) {
  const ranges = [];
  const parts = String(text)
    .replace(/[–—]/g, '-')
    .split(/[;,]/)
    .map((s) => s.trim().replace(/\.$/, '').trim())
    .filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})$/.exec(part);
    if (!m) return null;
    const from = parseHm(m[1]);
    const to = parseHm(m[2]);
    if (from === null || to === null || to <= from) return null;
    ranges.push([from, to]);
  }
  return ranges;
}

/** Merges consecutive off/maybe slots of equal status into intervals. */
export function intervalsFromSlots(date, slots) {
  /** @type {Interval[]} */
  const out = [];
  let i = 0;
  while (i < slots.length) {
    const status = slots[i];
    if (status !== 'off' && status !== 'maybe') {
      i++;
      continue;
    }
    let j = i;
    while (j < slots.length && slots[j] === status) j++;
    const start = kyivLocalToDate(date, i * SLOT_MINUTES);
    const end = kyivLocalToDate(date, j * SLOT_MINUTES);
    out.push({
      start: toKyivIso(start),
      end: toKyivIso(end),
      status,
      minutes: Math.round((end.getTime() - start.getTime()) / 60000),
    });
    i = j;
  }
  return out;
}

/**
 * Per-queue state from slots:
 * all unknown -> not_published; no off/maybe -> empty (nothing planned).
 */
export function queueStateFromSlots(slots) {
  if (!slots.length || slots.every((s) => s === 'unknown'))
    return 'not_published';
  if (!slots.some((s) => s === 'off' || s === 'maybe')) return 'empty';
  return 'published';
}

/** @returns {QueueDay} */
export function buildQueueDay(date, queue, slots, stateOverride) {
  const intervals = intervalsFromSlots(date, slots);
  const sum = (st) =>
    intervals
      .filter((x) => x.status === st)
      .reduce((acc, x) => acc + x.minutes, 0);
  return {
    queue,
    slots,
    intervals,
    totalOffMinutes: sum('off'),
    totalMaybeMinutes: sum('maybe'),
    publishedState: stateOverride ?? queueStateFromSlots(slots),
  };
}

/** Region-level state: emergency wins, then any published, then empty. */
export function regionState(queues, emergency) {
  if (emergency) return 'emergency';
  if (
    !queues.length ||
    queues.every((q) => q.publishedState === 'not_published')
  )
    return 'not_published';
  if (queues.some((q) => q.publishedState === 'published')) return 'published';
  return 'empty';
}

/** Compact signature for change detection ("oooffm..."). */
export function slotsSignature(slots) {
  return slots.map((s) => s[0]).join('');
}

/**
 * Diff of two slot arrays for the change feed: intervals that became an
 * outage (added) and outage intervals that disappeared (removed).
 */
export function diffSlots(date, before, after) {
  const isOut = (s) => s === 'off' || s === 'maybe';
  const prev = before ?? [];
  const addedSlots = after.map((s, i) =>
    isOut(s) && !isOut(prev[i]) ? 'off' : 'on',
  );
  const removedSlots = after.map((s, i) =>
    !isOut(s) && isOut(prev[i]) ? 'off' : 'on',
  );
  return {
    added: intervalsFromSlots(date, addedSlots),
    removed: intervalsFromSlots(date, removedSlots),
  };
}
