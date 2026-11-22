// svitlo.live public Cloudflare workers (unofficial, open CORS).
// Format: { date_today, date_tomorrow, regions: [{ cpu, schedule: {
//   "1.1": { "YYYY-MM-DD": { "00:00": 1, ..., "23:30": 2 } } }, emergency? }] }
// The dtek-api variant wraps it as { body: "<json>", timestamp: <ms> }.
// Values: 1 = power on, 2 = off, 3 = possible outage, 0 = no data.
import { politeGet } from './http.js';
import { buildQueueDay, compareQueues, normalizeQueue } from '../schedule.js';
import { SLOTS_PER_DAY, slotLabel, toKyivIso } from '../time.js';

export const DTEK_URL = 'https://dtek-api.svitlo-proxy.workers.dev/';
export const LEGACY_URL = 'https://svitlo-proxy.svitlo-proxy.workers.dev/';

const VALUE_MAP = { 1: 'on', 2: 'off', 3: 'maybe', 0: 'unknown' };

/** Parses raw text of either endpoint into { payload, sourceUpdatedAt }. */
export function parseSvitloPayload(text) {
  const json = JSON.parse(text);
  if (json && typeof json.body === 'string') {
    const ts = Number(json.timestamp);
    return {
      payload: JSON.parse(json.body),
      sourceUpdatedAt: Number.isFinite(ts) ? toKyivIso(new Date(ts)) : null,
    };
  }
  return { payload: json, sourceUpdatedAt: null };
}

function slotsForDay(dayMap) {
  if (!dayMap || typeof dayMap !== 'object') return null;
  const slots = [];
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    const raw = dayMap[slotLabel(i)];
    slots.push(VALUE_MAP[raw] ?? 'unknown');
  }
  return slots;
}

/**
 * Normalizes one region of a svitlo payload for one date.
 * @returns {import('../schedule.js').RegionDay | null} null when the region is absent
 */
export function normalizeSvitloRegion(payload, cpu, date, { provider, sourceUpdatedAt, region }) {
  const r = payload?.regions?.find((x) => x.cpu === cpu);
  if (!r) return null;
  const queues = [];
  for (const [rawQueue, byDate] of Object.entries(r.schedule ?? {})) {
    const queue = normalizeQueue(rawQueue);
    if (!queue) continue;
    const slots = slotsForDay(byDate?.[date]) ?? Array(SLOTS_PER_DAY).fill('unknown');
    queues.push(buildQueueDay(date, queue, slots));
  }
  queues.sort((a, b) => compareQueues(a.queue, b.queue));
  return {
    region,
    date,
    provider,
    emergency: r.emergency === true,
    sourceUpdatedAt,
    queues,
  };
}

export async function fetchSvitlo(url) {
  const res = await politeGet(url, { conditional: false });
  return { ...parseSvitloPayload(res.text), ms: res.ms, status: res.status };
}
