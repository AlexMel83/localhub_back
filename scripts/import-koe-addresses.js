// Import of the Kharkivoblenergo address PDF ("Адреси та черги ...pdf").
// The operator site blocks automated downloads, so the file is saved by hand:
//   npm run outages:addresses:koe                 # bundled data/outages/koe-addresses.pdf
//   npm run outages:addresses:koe -- ./new.pdf    # a newer file
import { resolve } from 'node:path';
import { runKoeAddressImport } from '../src/service-layer/services/outages/scheduler.js';

const file = process.argv[2] ? resolve(process.argv[2]) : undefined;
const result = await runKoeAddressImport('cli', file);
process.exit(result?.error ? 1 : 0);
