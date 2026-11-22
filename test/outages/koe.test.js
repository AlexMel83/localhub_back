import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  koeBlocks,
  koeRegionDay,
  parseKoePosts,
  parseKoeRanges,
  resolveKoe,
} from '../../src/service-layer/services/outages/providers/koe.js';

const html = readFileSync(new URL('./fixtures/koe-telegram-2026-11-22.html', import.meta.url), 'utf8');
const hm = (iso) => iso.slice(11, 16);
const offOf = (day, queue) =>
  day.queues
    .find((q) => q.queue === queue)
    .intervals.filter((i) => i.status === 'off')
    .map((i) => `${hm(i.start)}-${hm(i.end)}`);

test('parseKoePosts reads text and time of every channel post', () => {
  const posts = parseKoePosts(html);
  assert.equal(posts.length, 20);
  assert.ok(posts.every((p, i) => i === 0 || Date.parse(p.at) >= Date.parse(posts[i - 1].at)));
  assert.ok(posts.some((p) => p.text.includes('1.1 06:00-07:30; 16:00-18:00')));
});

test('parseKoeRanges tolerates trailing separators and the HH:MM:HH:MM typo', () => {
  assert.deepEqual(parseKoeRanges('06:00-07:30; 14:30-18:00;'), [
    [360, 450],
    [870, 1080],
  ]);
  assert.deepEqual(parseKoeRanges('06:30-10:00; 17:00:20:30'), [
    [390, 600],
    [1020, 1230],
  ]);
  assert.equal(parseKoeRanges('вночі'), null);
});

test('schedule posts become dated plans; undated emergency posts mark their day', () => {
  const { blocks, emergencyDates } = koeBlocks(parseKoePosts(html));
  assert.equal(blocks[0].date, '2026-11-22'); // newest first
  assert.equal(blocks[0].fromMinutes, 360); // "з 06:00 до 24:00"
  assert.equal(Object.keys(blocks[0].queues).length, 12);
  assert.ok(emergencyDates.has('2026-11-22'));
  assert.ok(!emergencyDates.has('2026-11-21'));
});

test('koeRegionDay normalizes 22.11 like the published post', () => {
  const resolved = resolveKoe(html);
  const day = koeRegionDay(resolved, '2026-11-22', { region: 'kharkivska-oblast' });
  assert.equal(day.provider, 'koe');
  assert.equal(day.emergency, true);
  assert.equal(day.sourceUpdatedAt, '2026-11-21T20:16:08+00:00');
  assert.equal(day.queues.length, 12);
  assert.deepEqual(offOf(day, '1.1'), ['06:00-07:30', '16:00-18:00']);
  assert.deepEqual(offOf(day, '5.2'), ['22:00-00:00']);
  // The typo "17:00:20:30" on 20.11 still parses.
  const fri = koeRegionDay(resolved, '2026-11-20', { region: 'kharkivska-oblast' });
  assert.deepEqual(offOf(fri, '6.1'), ['06:30-10:00', '17:00-20:30']);
  assert.equal(koeRegionDay(resolved, '2026-11-23', { region: 'kharkivska-oblast' }), null);
});
