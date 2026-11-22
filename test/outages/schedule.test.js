import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQueue,
  compareQueues,
  parseRanges,
  slotsFromRanges,
  buildQueueDay,
  queueStateFromSlots,
  regionState,
  diffSlots,
} from '../../src/service-layer/services/outages/schedule.js';

test('normalizeQueue accepts url and text forms', () => {
  assert.equal(normalizeQueue('3-1'), '3.1');
  assert.equal(normalizeQueue(' 03.2 '), '3.2');
  assert.equal(normalizeQueue('12'), '12');
  assert.equal(normalizeQueue('abc'), null);
  assert.deepEqual(['2.1', '10.1', '1.2', '1.1'].sort(compareQueues), [
    '1.1',
    '1.2',
    '2.1',
    '10.1',
  ]);
});

test('parseRanges handles HOE text with trailing dots and 24:00', () => {
  assert.deepEqual(parseRanges('10:00-14:00; 20:00-24:00.'), [
    [600, 840],
    [1200, 1440],
  ]);
  assert.deepEqual(parseRanges('06:00–10:30'), [[360, 630]]);
  assert.equal(parseRanges('10:00-09:00'), null);
  assert.equal(parseRanges('щось'), null);
  assert.equal(parseRanges(''), null);
});

test('buildQueueDay computes intervals and totals', () => {
  const slots = slotsFromRanges([
    [360, 600],
    [1020, 1260],
  ]);
  const day = buildQueueDay('2026-11-22', '3.1', slots);
  assert.equal(day.publishedState, 'published');
  assert.equal(day.totalOffMinutes, 480);
  assert.deepEqual(
    day.intervals.map((i) => [i.start, i.end]),
    [
      ['2026-11-22T06:00:00+02:00', '2026-11-22T10:00:00+02:00'],
      ['2026-11-22T17:00:00+02:00', '2026-11-22T21:00:00+02:00'],
    ],
  );
});

test('interval ending at midnight ends on the next date', () => {
  const day = buildQueueDay('2026-11-22', '1.2', slotsFromRanges([[1200, 1440]]));
  assert.equal(day.intervals[0].end, '2026-11-23T00:00:00+02:00');
  assert.equal(day.intervals[0].minutes, 240);
});

test('DST fall-back night counts the real duration', () => {
  // 00:00-06:00 local on 2026-10-25 lasts 7 real hours.
  const day = buildQueueDay('2026-10-25', '1.1', slotsFromRanges([[0, 360]]));
  assert.equal(day.totalOffMinutes, 420);
});

test('maybe slots are separate intervals and totals', () => {
  const slots = slotsFromRanges([[600, 660]]);
  slots[22] = 'maybe';
  slots[23] = 'maybe';
  const day = buildQueueDay('2026-11-22', '1.1', slots);
  assert.equal(day.totalOffMinutes, 60);
  assert.equal(day.totalMaybeMinutes, 60);
  assert.deepEqual(
    day.intervals.map((i) => i.status),
    ['off', 'maybe'],
  );
});

test('states: empty, not published, emergency', () => {
  assert.equal(queueStateFromSlots(Array(48).fill('on')), 'empty');
  assert.equal(queueStateFromSlots(Array(48).fill('unknown')), 'not_published');
  assert.equal(queueStateFromSlots([]), 'not_published');
  const q = (publishedState) => ({ publishedState });
  assert.equal(regionState([q('empty'), q('published')], false), 'published');
  assert.equal(regionState([q('empty')], false), 'empty');
  assert.equal(regionState([], false), 'not_published');
  assert.equal(regionState([q('published')], true), 'emergency');
});

test('diffSlots reports added and removed intervals', () => {
  const before = slotsFromRanges([[360, 480]]);
  const after = slotsFromRanges([[1200, 1320]]);
  const { added, removed } = diffSlots('2026-11-22', before, after);
  assert.equal(added.length, 1);
  assert.equal(added[0].start, '2026-11-22T20:00:00+02:00');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].start, '2026-11-22T06:00:00+02:00');
});
