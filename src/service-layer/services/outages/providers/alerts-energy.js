// alerts.energy documented API (https://alerts.energy/api/v1/openapi).
// Disabled unless ALERTS_ENERGY_API_KEY is set: every method requires a paid
// subscription key, and automated access without one is not permitted.
// Hour codes: 0 = no outage, 1 = whole hour, 2 = first half, 3 = second half.
import { buildQueueDay, compareQueues, normalizeQueue } from '../schedule.js';

export const ALERTS_BASE = 'https://alerts.energy/api/v1';

export const isAlertsEnergyEnabled = () => Boolean(process.env.ALERTS_ENERGY_API_KEY);

const STATUS_TO_STATE = {
  NoShutdowns: 'empty',
  WaitingForSchedule: 'not_published',
  EmergencyShutdowns: 'emergency',
};

/** 24 hour codes (+ optional possible codes) -> 48 slots. */
export function hoursToSlots(hours, possible = []) {
  if (!Array.isArray(hours) || hours.length !== 24) return null;
  const slots = [];
  hours.forEach((code, h) => {
    const p = possible[h] ?? 0;
    const first = code === 1 || code === 2 ? 'off' : p === 1 || p === 2 ? 'maybe' : 'on';
    const second = code === 1 || code === 3 ? 'off' : p === 1 || p === 3 ? 'maybe' : 'on';
    slots.push(first, second);
  });
  return slots;
}

/** Normalizes GET /source-registry/areas/{slug}/shutdowns rows for one operator. */
export function normalizeAlertsRows(rows, day, { region, initiator }) {
  const date = rows.find((r) => r[`${day}_date`])?.[`${day}_date`];
  if (!date) return null;
  const queues = [];
  let emergency = false;
  let updated = null;
  for (const row of rows) {
    if (initiator && row.initiator !== initiator) continue;
    const queue = normalizeQueue(row.queue);
    if (!queue) continue;
    const status = row[`${day}_status`];
    if (status === 'EmergencyShutdowns') emergency = true;
    const slots = hoursToSlots(row[day], row[`${day}_possible`]) ?? Array(48).fill('unknown');
    const override = STATUS_TO_STATE[status];
    queues.push(buildQueueDay(date, queue, slots, override === 'emergency' ? undefined : override));
    if (row.updated && (!updated || row.updated > updated)) updated = row.updated;
  }
  queues.sort((a, b) => compareQueues(a.queue, b.queue));
  return { region, date, provider: 'alerts-energy', emergency, sourceUpdatedAt: updated, queues };
}

export async function fetchAlertsArea(slug) {
  const key = process.env.ALERTS_ENERGY_API_KEY;
  if (!key) throw new Error('alerts.energy is disabled (no API key)');
  const res = await fetch(`${ALERTS_BASE}/source-registry/areas/${encodeURIComponent(slug)}/shutdowns`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const err = new Error(`alerts.energy ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
