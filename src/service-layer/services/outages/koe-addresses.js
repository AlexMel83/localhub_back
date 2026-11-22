// Address directory of JSC "Kharkivoblenergo" from its PDF
// "Адреси та черги" (a table: free-text cell "district, settlement, streets"
// + an X in one of 12 subqueue columns). The PDF cannot be fetched
// automatically (bot challenge), so it is imported from a local file.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { normalizeQueue } from './schedule.js';
import { normHouse, normStreet, normText } from './addresses.js';

export const KOE_QUEUE_COLUMNS = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];
export const ALL_STREETS = 'Усі вулиці';

export const KOE_REGION = 'kharkivska-oblast';
/** Where the operator publishes the file (linked from its Telegram posts). */
export const KOE_ADDRESS_URL =
  'https://oblenergo.kharkiv.ua/sites/default/files/pdf/%D0%90%D0%B4%D1%80%D0%B5%D1%81%D0%B8%20%D1%82%D0%B0%20%D1%87%D0%B5%D1%80%D0%B3%D0%B8%2026-27.pdf';
/** Copy of that file kept in the repo, imported on startup when it changes. */
export const KOE_BUNDLED_FILE = new URL('../../../../data/outages/koe-addresses.pdf', import.meta.url);

const OPS_CONSTRUCT_PATH = 91; // pdfjs OPS.constructPath

/** Groups text items into lines (same baseline), top to bottom. */
function textLines(items) {
  const lines = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - it.y) < 2) last.s += (/\s$/.test(last.s) || /^\s/.test(it.s) ? '' : ' ') + it.s;
    else lines.push({ y: it.y, s: it.s });
  }
  return lines.map((l) => l.s.trim()).filter(Boolean);
}

/**
 * Table cells of the PDF using its ruling lines: rows between horizontal
 * rules, the address column left of the first queue column.
 * @returns {Promise<{ cells: { page: number, text: string, queue: string|null }[], periodStart: string|null }>}
 */
export async function extractKoeTable(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false, verbosity: 0 })
    .promise;
  const cells = [];
  let periodStart = null;
  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn);
    const ops = await page.getOperatorList();
    const rows = [];
    let cols = [];
    ops.fnArray.forEach((fn, i) => {
      if (fn !== OPS_CONSTRUCT_PATH) return;
      const [x0, y0, x1, y1] = ops.argsArray[i][2];
      if (y1 - y0 < 1.5 && x1 - x0 > 300 && x0 < 100) rows.push((y0 + y1) / 2);
      else if (x1 - x0 < 1.5 && y1 - y0 > 100) cols.push((x0 + x1) / 2);
    });
    rows.sort((a, b) => b - a);
    cols = cols.sort((a, b) => a - b).filter((v, k, arr) => k === 0 || v - arr[k - 1] > 2);
    // Expect: left border, address|queue border, then 12 queue columns.
    if (cols.length < KOE_QUEUE_COLUMNS.length + 2) continue;
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str?.trim())
      .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }));
    periodStart ??= koePeriodStart(items.map((it) => it.s).join(' '));
    for (let r = 0; r < rows.length - 1; r++) {
      const inRow = items.filter((it) => it.y < rows[r] && it.y > rows[r + 1]);
      const text = textLines(inRow.filter((it) => it.x < cols[1] - 1)).join('\n');
      const marks = inRow
        .filter((it) => it.s.trim() === 'X' && it.x > cols[1])
        .map((it) => {
          const cx = it.x + it.w / 2;
          const c = cols.findIndex((v, k) => k >= 1 && cx > v && cx < cols[k + 1]);
          return KOE_QUEUE_COLUMNS[c - 1] ?? null;
        })
        .filter(Boolean);
      if (text) cells.push({ page: pn, text, queue: marks[0] ?? null });
    }
  }
  return { cells, periodStart };
}

/** "з 01.10.2026" in the title -> "2026-10-01". */
export function koePeriodStart(text) {
  const m = /з\s+(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// --- cell text -> (district, settlement, street, houses) ---------------------

const ci = (word) =>
  [...word].map((ch) => (/[а-яіїєґa-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch)).join('');

// Marker -> kind. Multi-letter markers ignore case; one-letter ones are
// lowercase only so initials ("М Шелеханя", "Б Хмельницкого") stay names.
const MARKERS = [
  ['р-н', 'district', 'района?|р-н'],
  ['т-г', 'district', 'т-г|тг'],
  ['settlement', 'settlement', 'місто|смт|пгт|с-ще|селище|села|село|сел|пос|хутір'],
  ['street', 'street', "вулиці|вулиця|вул|ул|провулок|пров|пер|в-зд|в-д|в'їзд|в`їзд|тупик|туп|площа|пл|майдан|просп|пр-т|бульвар|бул|м-н|мкр|мікрорайон|шосе|узвіз|проїзд|наб|кв-л"],
  ['house', 'house', 'буд'],
];
const ONE_LETTER = { м: 'settlement', с: 'settlement', c: 'settlement', х: 'settlement', б: 'house', пр: 'street' };

const MULTI_RE = MARKERS.map(([, , alt]) => alt.split('|').map(ci).join('|')).join('|');
const MARKER_RE = new RegExp(
  `(?<![\\p{L}'’-])(${MULTI_RE}|м|с|c|х|б|пр)(?:\\.\\s*:?|:|(?=\\s)|(?=\\p{Lu})|$)`,
  'gu',
);

function markerKind(raw) {
  const word = raw.toLowerCase();
  if (ONE_LETTER[raw]) return ONE_LETTER[raw];
  if (/^(района?|р-н|т-г|тг)$/.test(word)) return 'district';
  if (/^(місто|смт|пгт|с-ще|селище|села|село|сел|пос|хутір)$/.test(word)) return 'settlement';
  if (word === 'буд') return 'house';
  return 'street';
}

const STREET_TYPE = (raw) => {
  const w = raw.toLowerCase();
  if (/^(вулиці|вулиця|вул|ул)$/.test(w)) return 'вул.';
  if (/^(провулок|пров|пер)$/.test(w)) return 'пров.';
  if (/^(в-зд|в-д|в'їзд|в`їзд)$/.test(w)) return "в'їзд";
  if (/^(тупик|туп)$/.test(w)) return 'туп.';
  if (/^(площа|пл)$/.test(w)) return 'пл.';
  if (/^(просп|пр-т|пр)$/.test(w)) return 'просп.';
  if (/^(бульвар|бул)$/.test(w)) return 'бульв.';
  if (/^(м-н|мкр|мікрорайон)$/.test(w)) return 'мкр';
  if (w === 'кв-л') return 'кв-л';
  return w; // майдан, шосе, узвіз, проїзд, наб
};

const cleanName = (s) =>
  String(s ?? '')
    .replace(/^[\s.,:;–—-]+|[\s.,:;–—-]+$/g, '')
    .replace(/^(часть|частина)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "1-16" -> 1..16, "3" -> ["3"], "66А" -> ["66а"]. Large ranges are kept as text. */
export function expandHouses(text) {
  const out = [];
  for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range && Number(range[2]) > Number(range[1]) && Number(range[2]) - Number(range[1]) <= 400) {
      for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(String(n));
    } else if (/^\d/.test(part)) out.push(normHouse(part));
  }
  return out;
}

const isHouseList = (s) => /^\d+[\p{L}]?(?:\/\d+)?(?:\s*-\s*\d+)?$/u.test(s.trim());

/** Pre-cleaning of a cell: one line, unified separators. */
function prepare(text) {
  return String(text)
    .replace(/\n/g, ' ')
    .replace(/[’ʼ`´]/g, "'")
    .replace(/\(\s*частково\s*\)/gi, ' ⟨partial⟩ ')
    .replace(/\(\s*[^()]*с\/р\s*\)/gi, ' ') // "(Шарівська с/р)"
    .replace(/[()]/g, ', ')
    // "...вул.Валківський р-н" -> "...вул., Валківський р-н"
    .replace(/([.,]?)\s*((?:\p{Lu}[\p{L}'-]+\s+)?\p{Lu}[\p{L}'-]+\s+(?:р-н|район))/gu, ', $2')
    // "с.Борки-вул.Залізнична", "смт.Кегичівка - пров. 1 Травня"
    .replace(/\s*[-–]\s*(?=(?:вул|пров|ул|пер)[.:\s])/gi, ', ')
    .replace(/\s+/g, ' ');
}

/** Whether street markers mostly follow their names ("Лісова вул.,"). */
function suffixStyle(text) {
  const after = (text.match(/\p{L}{3,}\s+(вул|пров|туп|в-д|пл)\.?\s*(?:[,;]|$|⟨|\p{Lu})/gu) ?? []).length;
  const before = (text.match(/(?:^|[,;]\s*|\s)(вул|пров|туп|пл)\.?\s*\p{Lu}/gu) ?? []).length;
  return after > before;
}

/**
 * Splits one table cell into typed tokens in reading order.
 * @returns {{ kind: 'district'|'settlement'|'street'|'house'|'partial', name: string, type?: string }[]}
 */
export function tokenizeKoeCell(text) {
  const prepared = prepare(text);
  const suffix = suffixStyle(prepared);
  const tokens = [];
  let lastKind = 'settlement';
  let lastType = 'вул.';
  for (const piece of prepared.split(/[,;]/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const markers = [];
    for (const m of trimmed.matchAll(MARKER_RE)) {
      markers.push({ start: m.index, end: m.index + m[0].length, raw: m[1], kind: markerKind(m[1]) });
    }
    const chunk = (a, b) => cleanName(trimmed.slice(a, b).replace(/⟨partial⟩/g, ''));
    const partial = /⟨partial⟩/.test(trimmed);
    const emit = (kind, name, raw) => {
      if (!name) return;
      if (kind === 'street') lastType = raw ? STREET_TYPE(raw) : lastType;
      // Plain names after a district are settlements ("Валківський р-н, Ков'яги").
      if (kind !== 'house') lastKind = kind === 'district' ? 'settlement' : kind;
      tokens.push({ kind, name, type: kind === 'street' ? lastType : undefined, raw });
    };
    const emitUnmarked = (name) => {
      if (!name) return;
      if (isHouseList(name) && (lastKind === 'street' || tokens.at(-1)?.kind === 'house')) emit('house', name);
      else emit(lastKind, name);
    };
    if (!markers.length) {
      emitUnmarked(chunk(0));
    } else {
      let cursor = 0;
      markers.forEach((mk, k) => {
        const next = markers[k + 1];
        const before = chunk(cursor, mk.start);
        const after = chunk(mk.end, next ? next.start : undefined);
        // The marker belongs to the side that has a name; when both do, the
        // cell's style decides. District markers always follow their name.
        const takeBefore =
          mk.kind === 'district' || (before && !after) || (before && after && suffix);
        if (takeBefore) {
          emit(mk.kind, chunk(cursor, mk.start), mk.raw);
          cursor = mk.end;
        } else {
          if (k === 0 || cursor < mk.start) emitUnmarked(chunk(cursor, mk.start));
          emit(mk.kind, chunk(mk.end, next ? next.start : undefined), mk.raw);
          cursor = next ? next.start : trimmed.length;
        }
      });
      if (cursor < trimmed.length) emitUnmarked(chunk(cursor));
      // A bare list marker ("вул.:") switches the kind of the following names.
      const last = markers.at(-1);
      if (!chunk(last.end) && !suffix) {
        lastKind = last.kind === 'house' ? lastKind : last.kind;
        if (last.kind === 'street') lastType = STREET_TYPE(last.raw);
      }
    }
    if (partial) tokens.push({ kind: 'partial', name: '' });
  }
  return tokens;
}

// Typos of district names seen in the operator's file.
const DISTRICT_FIXES = [
  [/^богодух/i, 'Богодухівський'],
  [/^чугу/i, 'Чугуївський'],
  [/^хар/i, 'Харківський'],
];

/** "Харківська Нововодолазький" -> "Нововодолазький р-н", "Богодухвський" -> "Богодухівський р-н". */
export function canonicalDistrict(name) {
  const word = capitalize(cleanName(name).split(' ').at(-1) ?? '');
  const fixed = DISTRICT_FIXES.find(([re]) => re.test(word))?.[1] ?? word;
  return `${fixed} р-н`;
}

const looksLikeSettlement = (name) =>
  name.length >= 2 &&
  !/\d/.test(name) &&
  !/["«»]/.test(name) &&
  !/^\p{Lu}{3,}$/u.test(name) && // "ДСНС", "ГПУ"
  !/\b(об'єкт|завод|ТОВ|ПАТ|АТ|ФОП|ТРЦ)\b/u.test(name);

/**
 * Directory entries of one cell.
 * @returns {{ district: string, settlement: string, street: string, houses: string[] }[]}
 */
export function parseKoeCell(text) {
  const entries = [];
  let district = '';
  let current = null; // { name, streets: number }
  const closeSettlement = () => {
    if (current && current.streets === 0) {
      entries.push({ district: current.district, settlement: current.name, street: ALL_STREETS, houses: [] });
    }
  };
  for (const tok of tokenizeKoeCell(text)) {
    if (tok.kind === 'district') {
      closeSettlement();
      current = null;
      district = /^(т-г|тг)$/i.test(tok.raw ?? '') ? `${capitalize(tok.name)} громада` : canonicalDistrict(tok.name);
    } else if (tok.kind === 'settlement') {
      const name = capitalize(tok.name);
      if (!looksLikeSettlement(name)) continue;
      closeSettlement();
      current = { name, district, streets: 0 };
    } else if (tok.kind === 'street') {
      // Numbered microdistricts ("М-н 4") are the only numeric street names.
      if (!current || (tok.type !== 'мкр' && (/^\d+$/.test(tok.name) || tok.name.length < 2))) continue;
      current.streets++;
      entries.push({ district: current.district, settlement: current.name, street: `${tok.type} ${tok.name}`, houses: [] });
    } else if (tok.kind === 'house') {
      const last = entries.at(-1);
      if (last && current && last.settlement === current.name && last.street !== ALL_STREETS) {
        last.houses.push(...expandHouses(tok.name));
      }
    } else if (tok.kind === 'partial') {
      const last = entries.at(-1);
      if (last && last.street !== ALL_STREETS && !last.street.endsWith('(частково)')) last.street += ' (частково)';
    }
  }
  closeSettlement();
  return entries;
}

/**
 * Database rows for all cells; a settlement listed with its district once
 * inherits that district where a cell omits it.
 */
export function koeAddressRows(cells) {
  const raw = [];
  for (const cell of cells) {
    const queue = normalizeQueue(cell.queue ?? '');
    if (!queue) continue;
    for (const e of parseKoeCell(cell.text)) raw.push({ ...e, queue });
  }
  const districts = new Map();
  for (const r of raw) {
    if (!r.district) continue;
    const key = normText(r.settlement);
    if (!districts.has(key)) districts.set(key, new Set());
    districts.get(key).add(r.district);
  }
  const merged = new Map();
  for (const r of raw) {
    const known = districts.get(normText(r.settlement));
    const rem = r.district || (known?.size === 1 ? [...known][0] : '');
    const streetNorm = r.street === ALL_STREETS ? '' : normStreet(r.street.replace(/\s*\(частково\)$/, ''));
    const key = [normText(r.settlement), rem, normText(r.street), r.queue].join('|');
    const row = merged.get(key);
    if (row) {
      for (const h of r.houses) if (!row.houses.includes(h)) row.houses.push(h);
      continue;
    }
    merged.set(key, {
      rem,
      settlement: r.settlement,
      settlement_norm: normText(r.settlement),
      street: r.street,
      street_norm: streetNorm,
      houses: [...new Set(r.houses)],
      queue: r.queue,
    });
  }
  return [...merged.values()];
}

/**
 * Imports the PDF unless the same file (by hash) is already in the database.
 * @param {{ model: typeof import('../../../data-layer/models/outage-model.js').addressModel,
 *   buffer?: Buffer, path?: string|URL, sourceUrl?: string, log?: Function }} deps
 */
export async function importKoeAddresses({
  model,
  buffer,
  path = KOE_BUNDLED_FILE,
  sourceUrl = KOE_ADDRESS_URL,
  log = console.log,
}) {
  const data = buffer ?? (await readFile(path));
  const hash = createHash('sha256').update(data).digest('hex');
  const meta = await model.fileMeta(sourceUrl);
  if (meta?.last_modified === hash) return { imported: false, reason: 'unchanged' };
  const { cells, periodStart } = await extractKoeTable(data);
  const rows = koeAddressRows(cells);
  if (rows.length < 100) throw new Error(`only ${rows.length} rows parsed, refusing to replace the directory`);
  await model.replaceFile(
    { url: sourceUrl, region: KOE_REGION, rem: '', fileDate: periodStart, lastModified: hash },
    rows,
  );
  log(`[outages] Kharkivoblenergo addresses: ${cells.length} cells -> ${rows.length} rows`);
  return { imported: true, cells: cells.length, rows: rows.length, fileDate: periodStart };
}
