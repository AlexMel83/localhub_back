// Europe/Kyiv time helpers built on Intl (no tz database dependency).
// Schedules are expressed as 48 wall-clock half-hour slots (00:00..23:30).
// Converting a slot to an absolute instant goes through kyivLocalToDate,
// which keeps DST days correct (46 or 50 real half-hours).

export const TZ = 'Europe/Kyiv';
export const SLOTS_PER_DAY = 48;
export const SLOT_MINUTES = 30;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** @param {Date} date */
function kyivParts(date) {
  const p = Object.fromEntries(
    partsFormatter.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset of Kyiv from UTC in minutes at the given instant (120 or 180). */
export function kyivOffsetMinutes(date) {
  const p = kyivParts(date);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/** YYYY-MM-DD of the given instant in Kyiv. */
export function kyivDate(date = new Date()) {
  const p = kyivParts(date);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** Adds whole calendar days to a YYYY-MM-DD string. */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** True for a valid YYYY-MM-DD calendar date. */
export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  return addDays(value, 0) === value;
}

/**
 * Absolute instant for a Kyiv wall-clock time. `minutes` may be 0..1440
 * (1440 = next midnight). A non-existent local time (spring-forward gap)
 * resolves to the instant right after the gap.
 */
export function kyivLocalToDate(dateStr, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes converge for any single offset change.
  let guess = wallAsUtc - kyivOffsetMinutes(new Date(wallAsUtc)) * 60000;
  guess = wallAsUtc - kyivOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

/** ISO 8601 with the Kyiv offset, e.g. 2026-11-22T17:00:00+02:00. */
export function toKyivIso(date) {
  const off = kyivOffsetMinutes(date);
  const local = new Date(date.getTime() + off * 60000);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

/** "HH:MM" -> minutes from midnight; "24:00" -> 1440. Null if invalid. */
export function parseHm(hm) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(hm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** Slot index (0..47) -> "HH:MM". */
export function slotLabel(index) {
  const minutes = index * SLOT_MINUTES;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
