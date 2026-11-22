// Imports operator address files (Khmelnytska: 7 XLSX files linked from the
// HOE schedule page). Files are re-downloaded only when Last-Modified changes.
import { politeGet, politeGetBuffer } from './providers/http.js';
import { HOE_URL } from './providers/hoe.js';
import {
  fileDateFromName,
  findAddressFileLinks,
  parseAddressWorkbook,
  remFromName,
} from './addresses.js';

const REGION = 'khmelnytska-oblast';

/**
 * @param {{ model: typeof import('../../../data-layer/models/outage-model.js').addressModel,
 *   getPage?: () => Promise<string>, getFile?: typeof politeGetBuffer, log?: Function }} deps
 */
export async function importAddressFiles({ model, getPage, getFile = politeGetBuffer, log = console.log }) {
  const html = getPage ? await getPage() : (await politeGet(HOE_URL, { conditional: false })).text;
  const links = findAddressFileLinks(html);
  if (!links.length) throw new Error('no address files found on the HOE page');
  const result = { files: links.length, imported: 0, unchanged: 0, rows: 0, failed: 0 };
  for (const url of links) {
    try {
      const meta = await model.fileMeta(url);
      const file = await getFile(url, { lastModified: meta?.last_modified ?? undefined });
      if (!file) {
        result.unchanged++;
        continue;
      }
      const rows = await parseAddressWorkbook(file.buffer);
      if (!rows.length) throw new Error('workbook has no rows');
      await model.replaceFile(
        {
          url,
          region: REGION,
          rem: remFromName(url),
          fileDate: fileDateFromName(decodeURIComponent(url)),
          lastModified: file.lastModified,
        },
        rows,
      );
      result.imported++;
      result.rows += rows.length;
    } catch (error) {
      result.failed++;
      log(`[outages] address import failed for ${decodeURIComponent(url)}: ${error.message}`);
    }
  }
  return result;
}
