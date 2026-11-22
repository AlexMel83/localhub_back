import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  fileDateFromName,
  findAddressFileLinks,
  groupMatches,
  normHouse,
  normStreet,
  parseAddressQuery,
  parseAddressWorkbook,
  remFromName,
  splitHouses,
} from '../../src/service-layer/services/outages/addresses.js';
import { importAddressFiles } from '../../src/service-layer/services/outages/address-import.js';
import { readFileSync } from 'node:fs';

async function workbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Аркуш1');
  ws.addRow(['Старокостянтинівський РЕМ']);
  ws.addRow([]);
  ws.addRow(['Населений пункт', 'Вулиця', 'Список будинків', 'Черга/підчерга']);
  ws.addRow(['Старокостянтинів', 'вул. Острозького', ' 10, 12, 21 а', '4.2. підчерга']);
  ws.addRow(['Старокостянтинів', 'вул. Варчука', 7, '1.1. підчерга']);
  ws.addRow(['Старокостянтинів', 'вул. Варчука', ' 7, 9', '5.1. підчерга']);
  ws.addRow(['Попівці', 'вул. Острозького', '10', '6.1. підчерга']);
  ws.addRow(['', '', '', 'сміття']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('normalizers', () => {
  assert.equal(normStreet('вул. М.Грушевського'), 'м грушевського');
  assert.equal(normStreet('пров. Трипільський'), 'трипільський');
  assert.equal(normStreet('Героїв Майдану'), 'героїв майдану');
  assert.equal(normHouse('21 а'), '21а');
  assert.equal(normHouse('47 А'), '47а');
  assert.equal(normHouse('21a'), '21а');
  assert.deepEqual(splitHouses(' 1, 19/1, 20 а'), ['1', '19/1', '20а']);
  assert.deepEqual(parseAddressQuery('вул. Острозького, 10А'), { street: 'острозького', house: '10а' });
  assert.deepEqual(parseAddressQuery('Острозького'), { street: 'острозького', house: null });
  assert.deepEqual(parseAddressQuery('Миру 1/144'), { street: 'миру', house: '1/144' });
  assert.deepEqual(parseAddressQuery('Героїв Майдану буд. 5'), { street: 'героїв майдану', house: '5' });
});

test('file metadata from names', () => {
  const url =
    'https://hoe.com.ua/Content/Uploads/GPV6/xls/%D0%A7%D0%B5%D1%80%D0%B3%D0%B8_%D0%BD%D0%B0_%D0%B2%D1%96%D0%B4%D0%BA%D0%BB%D1%8E%D1%87%D0%B5%D0%BD%D0%BD%D1%8F_%D0%A5%D0%BC%D0%B5%D0%BB%D1%8C%D0%BD%D0%B8%D1%86%D1%8C%D0%BA%D0%B8%D0%B9_%D0%A0%D0%95%D0%9C_%D0%BF%D0%BE%D0%B1%D1%83%D1%82_09102026.xlsx';
  assert.equal(remFromName(url), 'Хмельницький РЕМ побут');
  assert.equal(fileDateFromName('Черги_на_відключення_Шепетівський_РЕМ_09102026.xlsx'), '2026-10-09');
});

test('finds the 7 XLSX links on the HOE page fixture', () => {
  const html = readFileSync(new URL('./fixtures/hoe-2026-11-22.html', import.meta.url), 'utf8');
  const links = findAddressFileLinks(html);
  assert.equal(links.length, 7);
  assert.ok(links.every((l) => l.startsWith('https://hoe.com.ua/Content/Uploads/GPV6/xls/')));
});

test('workbook parsing and grouped search results', async () => {
  const rows = await parseAddressWorkbook(await workbook());
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].houses, ['10', '12', '21а']);

  const withRem = rows.map((r) => ({ ...r, rem: 'Старокостянтинівський РЕМ', file_date: '2026-10-09' }));
  const byHouse = groupMatches(withRem, '10');
  assert.deepEqual(
    byHouse.map((m) => [m.settlement, m.queues]),
    [
      ['Попівці', ['6.1']],
      ['Старокостянтинів', ['4.2']],
    ],
  );
  const multi = groupMatches(withRem, '7');
  assert.deepEqual(multi[0].queues, ['1.1', '5.1']);
  assert.equal(groupMatches(withRem, '999').length, 0);
});

test('importAddressFiles skips unchanged files and reports failures', async () => {
  const buffer = await workbook();
  const page = `<a href="/Content/Uploads/GPV6/xls/Черги_на_відключення_A_РЕМ_09102026.xlsx">a</a>
    <a href="/Content/Uploads/GPV6/xls/Черги_на_відключення_B_РЕМ_09102026.xlsx">b</a>
    <a href="/Content/Uploads/GPV6/xls/Черги_на_відключення_C_РЕМ_09102026.xlsx">c</a>`;
  const stored = [];
  const model = {
    fileMeta: async (url) => (url.includes('B_') ? { last_modified: 'x' } : null),
    replaceFile: async (meta, rows) => stored.push([meta, rows.length]),
  };
  const getFile = async (url, { lastModified }) => {
    if (decodeURI(url).includes('C_')) throw new Error('HTTP 500');
    return lastModified ? null : { buffer, lastModified: 'Fri, 09 Oct 2026 10:56:07 GMT' };
  };
  const res = await importAddressFiles({ model, getPage: async () => page, getFile, log: () => {} });
  assert.deepEqual(res, { files: 3, imported: 1, unchanged: 1, rows: 4, failed: 1 });
  assert.equal(stored[0][0].rem, 'A РЕМ');
  assert.equal(stored[0][0].fileDate, '2026-10-09');
});

test('streetHouses lists houses naturally and resolves a house to its queues', async () => {
  const { streetHouses, compareHouses } = await import(
    '../../src/service-layer/services/outages/addresses.js'
  );
  assert.deepEqual(['10', '2', '1а', '10/1', '1', 'б/н'].sort(compareHouses), ['1', '1а', '2', '10', '10/1', 'б/н']);
  const rows = [
    { houses: ['7', '9', '21а'], queue: '5.1', rem: 'Старокостянтинівський РЕМ', file_date: '2026-10-09' },
    { houses: ['7', '11'], queue: '1.1', rem: 'Старокостянтинівський РЕМ', file_date: '2026-10-09' },
  ];
  const all = streetHouses(rows, null);
  assert.deepEqual(all.houses, ['7', '9', '11', '21а']);
  assert.deepEqual(all.queues, ['1.1', '5.1']);
  const one = streetHouses(rows, '21 А');
  assert.equal(one.house, '21а');
  assert.equal(one.found, true);
  assert.deepEqual(one.queues, ['5.1']);
  assert.deepEqual(streetHouses(rows, '7').queues, ['1.1', '5.1']);
  assert.equal(streetHouses(rows, '99').found, false);
});
