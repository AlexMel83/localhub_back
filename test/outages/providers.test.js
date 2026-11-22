import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseHoeBlocks,
  resolveHoePlans,
  hoeRegionDay,
  headerDate,
} from '../../src/service-layer/services/outages/providers/hoe.js';
import {
  parseSvitloPayload,
  normalizeSvitloRegion,
} from '../../src/service-layer/services/outages/providers/svitlo-proxy.js';
import { slotsSignature } from '../../src/service-layer/services/outages/schedule.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const hoeHtml = fx('hoe-2026-11-22.html');
const ctx = { region: 'khmelnytska-oblast' };
const ranges = (day, queue) =>
  day.queues
    .find((q) => q.queue === queue)
    .intervals.map((i) => `${i.start.slice(11, 16)}-${i.end.slice(11, 16)}`);

test('headerDate reads numeric and verbal dates', () => {
  assert.equal(headerDate('... 22.11.2026 р. ... (ГПВ)', '2026-11-22'), '2026-11-22');
  assert.equal(headerDate('(ГПВ) на 21 листопада (оновлено 23:00)', '2026-11-22'), '2026-11-21');
  assert.equal(headerDate('(ГПВ) на 2 січня', '2026-12-30'), '2027-01-02');
});

test('HOE: parses the latest plan for 22.11 for all 12 subqueues', () => {
  const plans = resolveHoePlans(parseHoeBlocks(hoeHtml, '2026-11-22'));
  const day = hoeRegionDay(plans, '2026-11-22', ctx);
  assert.equal(day.provider, 'hoe');
  assert.equal(day.queues.length, 12);
  assert.deepEqual(ranges(day, '1.1'), ['14:00-17:00']);
  assert.deepEqual(ranges(day, '1.2'), ['10:00-14:00', '20:00-00:00']);
  assert.deepEqual(ranges(day, '3.1'), ['06:00-10:00', '17:00-21:00']);
  assert.equal(day.queues.find((q) => q.queue === '1.2').totalOffMinutes, 480);
});

test('HOE: the newest update for a date wins (21.11 updated at 23:00)', () => {
  const plans = resolveHoePlans(parseHoeBlocks(hoeHtml, '2026-11-22'));
  const day = hoeRegionDay(plans, '2026-11-21', ctx);
  assert.deepEqual(ranges(day, '1.1'), ['00:00-02:00', '06:00-10:00', '13:00-16:00', '20:00-00:00']);
});

test('HOE: "оновлено з HH:MM" keeps earlier hours from the previous plan', () => {
  const blocks = parseHoeBlocks(hoeHtml, '2026-11-22').filter((b) => b.date === '2026-11-20');
  assert.ok(blocks.length >= 2);
  const plans = resolveHoePlans(blocks);
  const latest = blocks[0];
  assert.equal(latest.fromMinutes, 630);
  const day = hoeRegionDay(plans, '2026-11-20', ctx);
  for (const q of day.queues) {
    const fromLatest = latest.queues[q.queue];
    if (!fromLatest) continue;
    // Every outage from 10:30 on comes from the latest block.
    const after = q.intervals.filter((i) => i.start.slice(11, 16) >= '10:30');
    for (const i of after) {
      const s = Number(i.start.slice(11, 13)) * 60 + Number(i.start.slice(14, 16));
      assert.ok(fromLatest.some(([a, b]) => s >= a && s < b) || s < 630, `${q.queue} ${i.start}`);
    }
  }
});

test('HOE: synthetic cancelled day and emergency header', () => {
  const html = `<div class="content-main">
    <p>22.11.2026 р. графіки погодинних відключень (ГПВ) не застосовуватимуться.</p>
    <p>За розпорядженням НЕК «Укренерго» 21.11.2026 р. застосовано графіки аварійних відключень (ГАВ).</p>
    <p>Підчерга 1.1 – 10:00-12:00.<br/>Підчерга 1.2 – без відключень.</p>
  </div>`;
  const plans = resolveHoePlans(parseHoeBlocks(html, '2026-11-22'));
  const cancelled = hoeRegionDay(plans, '2026-11-22', ctx);
  assert.equal(cancelled.queues.length, 12);
  assert.ok(cancelled.queues.every((q) => q.publishedState === 'empty'));
  const emergency = hoeRegionDay(plans, '2026-11-21', ctx);
  assert.equal(emergency.emergency, true);
  assert.equal(emergency.queues.find((q) => q.queue === '1.2').publishedState, 'empty');
});

test('HOE: garbage page yields no plan', () => {
  const plans = resolveHoePlans(parseHoeBlocks('<p>Технічні роботи</p>', '2026-11-22'));
  assert.equal(hoeRegionDay(plans, '2026-11-22', ctx), null);
});

test('svitlo dtek-api: unwraps body and reads timestamp', () => {
  const { payload, sourceUpdatedAt } = parseSvitloPayload(fx('svitlo-dtek-2026-11-22.json'));
  assert.equal(payload.date_today, '2026-11-22');
  assert.match(sourceUpdatedAt, /^2026-11-22T12:05:37\+02:00$/);
  const day = normalizeSvitloRegion(payload, 'khmelnytska-oblast', '2026-11-22', {
    ...ctx,
    provider: 'svitlo-dtek',
    sourceUpdatedAt,
  });
  assert.equal(day.queues.length, 12);
  assert.equal(day.queues[0].queue, '1.1');
  assert.deepEqual(ranges(day, '1.1'), ['14:00-17:00']);
});

test('svitlo legacy: tomorrow with all zeros is not published', () => {
  const { payload } = parseSvitloPayload(fx('svitlo-legacy-2026-11-22.json'));
  const day = normalizeSvitloRegion(payload, 'hmelnitska-oblast', '2026-11-23', {
    ...ctx,
    provider: 'svitlo-legacy',
    sourceUpdatedAt: null,
  });
  assert.ok(day.queues.every((q) => q.publishedState === 'not_published'));
  assert.equal(
    normalizeSvitloRegion(payload, 'missing', '2026-11-22', { ...ctx, provider: 'x', sourceUpdatedAt: null }),
    null,
  );
});

test('HOE and svitlo agree for 22.11 in Khmelnytska', () => {
  const plans = resolveHoePlans(parseHoeBlocks(hoeHtml, '2026-11-22'));
  const hoe = hoeRegionDay(plans, '2026-11-22', ctx);
  const { payload } = parseSvitloPayload(fx('svitlo-dtek-2026-11-22.json'));
  const sv = normalizeSvitloRegion(payload, 'khmelnytska-oblast', '2026-11-22', {
    ...ctx,
    provider: 'svitlo-dtek',
    sourceUpdatedAt: null,
  });
  for (const q of hoe.queues) {
    const other = sv.queues.find((x) => x.queue === q.queue);
    assert.equal(slotsSignature(q.slots), slotsSignature(other.slots), q.queue);
  }
});

test('alerts.energy hour codes map to half-hour slots', async () => {
  const { hoursToSlots, normalizeAlertsRows } = await import(
    '../../src/service-layer/services/outages/providers/alerts-energy.js'
  );
  const hours = Array(24).fill(0);
  hours[10] = 1;
  hours[12] = 2;
  hours[14] = 3;
  const possible = Array(24).fill(0);
  possible[16] = 1;
  const slots = hoursToSlots(hours, possible);
  assert.deepEqual(slots.slice(20, 34), ['off', 'off', 'on', 'on', 'off', 'on', 'on', 'on', 'on', 'off', 'on', 'on', 'maybe', 'maybe']);
  assert.equal(hoursToSlots([1, 2]), null);
  const day = normalizeAlertsRows(
    [
      { initiator: 'op', queue: '1.1', today: hours, today_date: '2026-11-22', today_status: 'ScheduleApplies' },
      { initiator: 'op', queue: '1.2', today: [], today_date: '2026-11-22', today_status: 'WaitingForSchedule' },
    ],
    'today',
    { region: 'khmelnytska-oblast', initiator: 'op' },
  );
  assert.equal(day.queues[0].totalOffMinutes, 120);
  assert.equal(day.queues[1].publishedState, 'not_published');
});
