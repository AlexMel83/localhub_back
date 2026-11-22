// Address directory from the operator's XLSX files
// ("Населений пункт | Вулиця | Список будинків | Черга/підчерга").
import ExcelJS from 'exceljs';
import * as cheerio from 'cheerio';
import { normalizeQueue, compareQueues } from './schedule.js';
import { HOE_URL } from './providers/hoe.js';

const STREET_PREFIX_RE =
  /^(вул(иця)?|пров(улок)?|просп(ект)?|пр-т|пл(оща)?|бул(ьв(ар)?)?|б-р|туп(ик)?|узвіз|шосе|проїзд|мкр|мікрорайон|в'їзд|майдан|наб(ережна)?)(\.\s*|\s+)/i;

/** Lowercase, unified apostrophes and letters, no punctuation noise. */
export function normText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[’ʼ`´"«»]/g, "'")
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Street name without type prefix and initials punctuation: "вул. М.Грушевського" -> "м грушевського". */
export function normStreet(value) {
  let s = normText(value);
  s = s.replace(STREET_PREFIX_RE, '');
  return s.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Latin look-alikes typed instead of Cyrillic letters (after lowercasing).
const LATIN_TO_CYR = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х" };

/** "21 а" / "47 А" / "21a" -> "21а"; "19/1" stays. */
export function normHouse(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[abcehkmoptx]/g, (ch) => LATIN_TO_CYR[ch] ?? ch)
    .replace(/^№/, '');
}

export function splitHouses(cell) {
  return String(cell ?? '')
    .split(/[,;]/)
    .map(normHouse)
    .filter(Boolean);
}

/** Date from file names like "..._09102026.xlsx". */
export function fileDateFromName(name) {
  const m = /_(\d{2})(\d{2})(\d{4})\.xlsx?$/i.exec(name);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** REM name from "Черги_на_відключення_Старокостянтинівський_РЕМ_09102026.xlsx". */
export function remFromName(name) {
  const base = decodeURIComponent(name.split('/').pop() ?? '');
  const m = /відключення_(.+?)_\d{8}\.xlsx?$/i.exec(base);
  return m ? m[1].replace(/_/g, ' ') : base;
}

const cellText = (cell) => {
  const v = cell?.value;
  if (v && typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return String(v.result ?? '');
    if ('text' in v) return String(v.text);
  }
  return v === null || v === undefined ? '' : String(v);
};

/**
 * Parses one workbook buffer into rows. Header row is detected by its titles,
 * so a shifted layout still works.
 */
export async function parseAddressWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const rows = [];
  for (const ws of wb.worksheets) {
    let cols = null;
    ws.eachRow((row) => {
      const texts = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        texts[col] = cellText(cell).trim();
      });
      if (!cols) {
        const idx = (re) => texts.findIndex((t) => t && re.test(t));
        const settlement = idx(/населений/i);
        const street = idx(/вулиц/i);
        const houses = idx(/будин/i);
        const queue = idx(/черга/i);
        if ([settlement, street, houses, queue].every((i) => i > 0)) {
          cols = { settlement, street, houses, queue };
        }
        return;
      }
      const queue = normalizeQueue(/(\d{1,2})\s*\.\s*(\d{1,2})/.exec(texts[cols.queue] ?? '')?.slice(1).join('.') ?? '');
      const settlement = texts[cols.settlement];
      const street = texts[cols.street];
      if (!queue || !settlement || !street) return;
      rows.push({
        settlement,
        settlement_norm: normText(settlement),
        street,
        street_norm: normStreet(street),
        houses: splitHouses(texts[cols.houses]),
        queue,
      });
    });
  }
  return rows;
}

/** XLSX links on the HOE schedule page. */
export function findAddressFileLinks(html, base = HOE_URL) {
  const $ = cheerio.load(html);
  const urls = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (href && /\.xlsx?$/i.test(href) && /черг/i.test(decodeURIComponent(href))) {
      urls.add(new URL(href, base).href);
    }
  });
  return [...urls];
}

/** Splits "Острозького 10а" into street query and house. */
export function parseAddressQuery(q) {
  const text = normText(q).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.*?)[\s]+(?:буд\.?\s*)?(\d+\s*[а-яa-z]?(?:\/\d+[а-яa-z]?)?)$/i.exec(text);
  if (m && m[1]) return { street: normStreet(m[1]), house: normHouse(m[2]) };
  return { street: normStreet(text), house: null };
}

/**
 * Groups raw rows into AddressMatch results.
 * With a house: only rows containing it; queues merged (a building may have several).
 */
export function groupMatches(rows, house) {
  const groups = new Map();
  for (const r of rows) {
    if (house && !r.houses.includes(house)) continue;
    const key = `${r.settlement}|${r.street}`;
    const g = groups.get(key) ?? {
      settlement: r.settlement,
      street: r.street,
      house: house ?? null,
      queues: new Set(),
      rem: r.rem,
      fileDate: r.file_date ?? null,
    };
    g.queues.add(r.queue);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, queues: [...g.queues].sort(compareQueues) }))
    .sort((a, b) => a.settlement.localeCompare(b.settlement, 'uk') || a.street.localeCompare(b.street, 'uk'))
    .slice(0, 20);
}

/** Natural house order: 1, 1а, 2, 10, 10/1, 21а ... */
export function compareHouses(a, b) {
  const pa = /^(\d+)(.*)$/.exec(a);
  const pb = /^(\d+)(.*)$/.exec(b);
  if (pa && pb) {
    return Number(pa[1]) - Number(pb[1]) || pa[2].localeCompare(pb[2], 'uk');
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b, 'uk');
}

/**
 * Houses of a street with their queues, plus the queues for one house.
 * @param {{ houses: string[], queue: string, rem: string, file_date: string|null }[]} rows
 */
export function streetHouses(rows, house) {
  const byHouse = new Map();
  for (const r of rows) {
    for (const h of r.houses) {
      if (!byHouse.has(h)) byHouse.set(h, new Set());
      byHouse.get(h).add(r.queue);
    }
  }
  const houses = [...byHouse.keys()].sort(compareHouses);
  const wanted = house ? normHouse(house) : null;
  const queues = wanted
    ? [...(byHouse.get(wanted) ?? [])].sort(compareQueues)
    : [...new Set(rows.map((r) => r.queue))].sort(compareQueues);
  return {
    houses,
    house: wanted,
    found: wanted ? byHouse.has(wanted) : rows.length > 0,
    queues,
    rem: rows[0]?.rem ?? null,
    fileDate: rows[0]?.file_date ?? null,
  };
}
