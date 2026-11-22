import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALL_STREETS,
  KOE_BUNDLED_FILE,
  canonicalDistrict,
  expandHouses,
  extractKoeTable,
  importKoeAddresses,
  koeAddressRows,
  parseKoeCell,
} from '../../src/service-layer/services/outages/koe-addresses.js';

const flat = (text) =>
  parseKoeCell(text).map(
    (e) => `${e.district}|${e.settlement}|${e.street}${e.houses.length ? `[${e.houses.join(',')}]` : ''}`,
  );

test('prefix style: district, settlement, street list after "вул.:"', () => {
  assert.deepEqual(flat('м. Люботин, вул.: Абдулова, Травнева,Горького, с. Манченки, Валківський р-н, Буцьківка с.'), [
    '|Люботин|вул. Абдулова',
    '|Люботин|вул. Травнева',
    '|Люботин|вул. Горького',
    '|Манченки|Усі вулиці',
    'Валківський р-н|Буцьківка|Усі вулиці',
  ]);
  assert.deepEqual(flat('Ізюмський р-н, м. Балаклія, пров. Народний, вул. Василя Стуса'), [
    'Ізюмський р-н|Балаклія|пров. Народний',
    'Ізюмський р-н|Балаклія|вул. Василя Стуса',
  ]);
});

test('suffix style: names before markers, partial streets and house numbers', () => {
  assert.deepEqual(
    flat('Балаклія м. Буровиків вул., І. Франка вул.(частково), Губкина вул. 3 б., Гайдамацька вул.Балаклія м. Б Хмельницкого вул.'),
    [
      '|Балаклія|вул. Буровиків',
      '|Балаклія|вул. І. Франка (частково)',
      '|Балаклія|вул. Губкина[3]',
      '|Балаклія|вул. Гайдамацька',
      '|Балаклія|вул. Б Хмельницкого',
    ],
  );
  assert.deepEqual(flat('Коломацький р-н, Андрусівка с., Коломак смт.'), [
    'Коломацький р-н|Андрусівка|Усі вулиці',
    'Коломацький р-н|Коломак|Усі вулиці',
  ]);
});

test('house ranges, numbered microdistricts and communities', () => {
  assert.deepEqual(flat('с.Зорянське вул. Шкільна б. 1-3'), ['|Зорянське|вул. Шкільна[1,2,3]']);
  assert.deepEqual(flat('м.Лозова: М-н 4 буд. 46, 47, 66А'), ['|Лозова|мкр 4[46,47,66а]']);
  assert.deepEqual(flat('с. Худояр (ШРЭС) Шевченківська т-г, с. Василенкове'), [
    '|Худояр|Усі вулиці',
    'Шевченківська громада|Василенкове|Усі вулиці',
  ]);
  assert.deepEqual(expandHouses('2-4, 7А'), ['2', '3', '4', '7а']);
  assert.equal(canonicalDistrict('Богодухвський'), 'Богодухівський р-н');
  assert.equal(canonicalDistrict('Харківська Нововодолазький'), 'Нововодолазький р-н');
});

test('rows inherit a known district and keep same-name street types apart', () => {
  const rows = koeAddressRows([
    { text: 'Ізюмський р-н, м. Балаклія, вул. Соборна', queue: '1.1' },
    { text: 'Балаклія м. Грушевського вул., Грушевського пров.', queue: '3.2' },
    { text: 'без черги', queue: null },
  ]);
  assert.deepEqual(
    rows.map((r) => `${r.rem}|${r.settlement}|${r.street}|${r.street_norm}|${r.queue}`),
    [
      'Ізюмський р-н|Балаклія|вул. Соборна|соборна|1.1',
      'Ізюмський р-н|Балаклія|вул. Грушевського|грушевського|3.2',
      'Ізюмський р-н|Балаклія|пров. Грушевського|грушевського|3.2',
    ],
  );
  assert.equal(koeAddressRows([{ text: 'с. Гроза', queue: '5.2' }])[0].street_norm, '');
  assert.equal(koeAddressRows([{ text: 'с. Гроза', queue: '5.2' }])[0].street, ALL_STREETS);
});

test('the bundled operator PDF parses into a usable directory', async () => {
  const buffer = readFileSync(KOE_BUNDLED_FILE);
  const { cells, periodStart } = await extractKoeTable(buffer);
  assert.equal(periodStart, '2026-10-01');
  assert.ok(cells.length > 380);
  assert.ok(cells.filter((c) => c.queue).length >= cells.length - 2);
  const rows = koeAddressRows(cells);
  const balakliia = rows.filter((r) => r.settlement_norm === 'балаклія');
  assert.ok(balakliia.length > 100);
  assert.ok(balakliia.every((r) => r.rem === 'Ізюмський р-н'));
  const sobornaQueues = balakliia.filter((r) => r.street === 'вул. Соборна').map((r) => r.queue);
  assert.deepEqual(sobornaQueues.sort(), ['1.1', '3.2']);
  assert.ok(balakliia.some((r) => r.street === 'вул. Буровиків' && r.queue === '3.2'));

  // Import replaces the file once, then skips it while unchanged.
  const calls = [];
  const model = {
    meta: null,
    async fileMeta() {
      return this.meta;
    },
    async replaceFile(meta, r) {
      calls.push(r.length);
      this.meta = { last_modified: meta.lastModified };
    },
  };
  const first = await importKoeAddresses({ model, buffer, log: () => {} });
  assert.equal(first.imported, true);
  assert.equal(first.rows, rows.length);
  const second = await importKoeAddresses({ model, buffer, log: () => {} });
  assert.equal(second.imported, false);
  assert.equal(calls.length, 1);
});
