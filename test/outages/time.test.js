import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kyivDate,
  kyivLocalToDate,
  kyivOffsetMinutes,
  toKyivIso,
  addDays,
  isIsoDate,
  parseHm,
  slotLabel,
} from '../../src/service-layer/services/outages/time.js';

test('offset is +02:00 in winter and +03:00 in summer', () => {
  assert.equal(kyivOffsetMinutes(new Date('2026-11-22T12:00:00Z')), 120);
  assert.equal(kyivOffsetMinutes(new Date('2026-07-01T12:00:00Z')), 180);
});

test('kyivDate crosses midnight using Kyiv time, not UTC', () => {
  // 22:30 UTC on Nov 22 is 00:30 on Nov 23 in Kyiv.
  assert.equal(kyivDate(new Date('2026-11-22T22:30:00Z')), '2026-11-23');
  assert.equal(kyivDate(new Date('2026-11-22T21:59:00Z')), '2026-11-22');
});

test('local wall time to instant and back', () => {
  const d = kyivLocalToDate('2026-11-22', 17 * 60);
  assert.equal(d.toISOString(), '2026-11-22T15:00:00.000Z');
  assert.equal(toKyivIso(d), '2026-11-22T17:00:00+02:00');
  const midnight = kyivLocalToDate('2026-11-22', 1440);
  assert.equal(toKyivIso(midnight), '2026-11-23T00:00:00+02:00');
});

test('spring forward day (2026-03-29) is 23 hours long', () => {
  const start = kyivLocalToDate('2026-03-29', 0);
  const end = kyivLocalToDate('2026-03-29', 1440);
  assert.equal((end - start) / 3600000, 23);
  // 03:30 does not exist; it resolves after the gap.
  assert.equal(toKyivIso(kyivLocalToDate('2026-03-29', 3 * 60 + 30)).slice(11, 16), '04:30');
});

test('fall back day (2026-10-25) is 25 hours long', () => {
  const start = kyivLocalToDate('2026-10-25', 0);
  const end = kyivLocalToDate('2026-10-25', 1440);
  assert.equal((end - start) / 3600000, 25);
});

test('date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.ok(isIsoDate('2026-11-22'));
  assert.ok(!isIsoDate('2026-02-30'));
  assert.ok(!isIsoDate('tomorrow'));
  assert.equal(parseHm('24:00'), 1440);
  assert.equal(parseHm('6.30'), 390);
  assert.equal(parseHm('25:00'), null);
  assert.equal(slotLabel(47), '23:30');
});
