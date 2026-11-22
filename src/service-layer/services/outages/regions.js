// Region registry: our slug (matches alerts.energy / svitlo dtek-api naming)
// mapped to source-specific identifiers.
// KATOTTG: Khmelnytska code taken from a codifier mirror (matches Wikipedia);
// re-check against the official Ministry codifier before using it with APIs.

const SVITLO_SOURCE = { name: 'svitlo.live', url: 'https://svitlo.live' };

/**
 * @typedef {{
 *   slug: string,
 *   nameUk: string,
 *   nameEn: string,
 *   katottg: string|null,
 *   legacyCpu: string|null,
 *   dtekCpu: string|null,
 *   operator: { key: string, name: string, url: string },
 *   official: boolean,
 * }} Region
 */

/** @type {Region[]} */
export const REGIONS = [
  {
    slug: 'khmelnytska-oblast',
    nameUk: 'Хмельницька область',
    nameEn: 'Khmelnytskyi Oblast',
    katottg: 'UA68000000000099709',
    legacyCpu: 'hmelnitska-oblast',
    dtekCpu: 'khmelnytska-oblast',
    operator: {
      key: 'hoe',
      name: 'АТ «Хмельницькобленерго»',
      url: 'https://hoe.com.ua/page/pogodinni-vidkljuchennja',
    },
    official: true,
  },
  ...[
    ['vinnytska-oblast', 'Вінницька область', 'Vinnytsia Oblast', 'vinnitska-oblast', null],
    ['volynska-oblast', 'Волинська область', 'Volyn Oblast', 'volinska-oblast', null],
    ['dnipropetrovska-oblast', 'Дніпропетровська область', 'Dnipropetrovsk Oblast', 'dnipropetrovska-oblast', 'dnipropetrovska-oblast'],
    ['donetska-oblast', 'Донецька область', 'Donetsk Oblast', 'donetska-oblast', null],
    ['zhytomyrska-oblast', 'Житомирська область', 'Zhytomyr Oblast', 'jitomirska-oblast', 'zhytomyrska-oblast'],
    ['zakarpatska-oblast', 'Закарпатська область', 'Zakarpattia Oblast', 'zakarpatska-oblast', 'zakarpatska-oblast'],
    ['zaporizka-oblast', 'Запорізька область', 'Zaporizhzhia Oblast', 'zaporizka-oblast', 'zaporizka-oblast'],
    ['ivano-frankivska-oblast', 'Івано-Франківська область', 'Ivano-Frankivsk Oblast', 'ivano-frankivska-oblast', 'ivano-frankivska-oblast'],
    ['kyivska-oblast', 'Київська область', 'Kyiv Oblast', 'kiivska-oblast', 'kiivska-oblast'],
    ['kirovogradska-oblast', 'Кіровоградська область', 'Kirovohrad Oblast', 'kirovogradska-oblast', null],
    ['lvivska-oblast', 'Львівська область', 'Lviv Oblast', 'lvivska-oblast', 'lvivska-oblast'],
    ['mykolaivska-oblast', 'Миколаївська область', 'Mykolaiv Oblast', 'mikolaivska-oblast', null],
    ['odeska-oblast', 'Одеська область', 'Odesa Oblast', 'odeska-oblast', 'odeska-oblast'],
    ['poltavska-oblast', 'Полтавська область', 'Poltava Oblast', 'poltavska-oblast', 'poltavska-oblast'],
    ['rivnenska-oblast', 'Рівненська область', 'Rivne Oblast', 'rivnenska-oblast', 'rivnenska-oblast'],
    ['sumska-oblast', 'Сумська область', 'Sumy Oblast', 'sumska-oblast', null],
    ['ternopilska-oblast', 'Тернопільська область', 'Ternopil Oblast', 'ternopilska-oblast', 'ternopilska-oblast'],
    ['kharkivska-oblast', 'Харківська область', 'Kharkiv Oblast', 'harkivska-oblast', 'kharkivska-oblast'],
    ['cherkaska-oblast', 'Черкаська область', 'Cherkasy Oblast', 'cherkaska-oblast', 'cherkaska-oblast'],
    ['chernivetska-oblast', 'Чернівецька область', 'Chernivtsi Oblast', 'chernivetska-oblast', 'chernivetska-oblast'],
    ['chernihivska-oblast', 'Чернігівська область', 'Chernihiv Oblast', 'chernigivska-oblast', 'chernihivska-oblast'],
    ['kyiv', 'Київ', 'Kyiv', 'kyiv', 'kyiv'],
  ].map(([slug, nameUk, nameEn, legacyCpu, dtekCpu]) => ({
    slug,
    nameUk,
    nameEn,
    katottg: null,
    legacyCpu,
    dtekCpu,
    operator: { key: 'svitlo', ...SVITLO_SOURCE },
    official: false,
  })),
];

const bySlug = new Map(REGIONS.map((r) => [r.slug, r]));

/** @returns {Region|undefined} */
export function getRegion(slug) {
  return bySlug.get(String(slug));
}

export const DEFAULT_REGION = 'khmelnytska-oblast';
