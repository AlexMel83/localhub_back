// One-off import of operator address files: npm run outages:addresses
import { runAddressImport } from '../src/service-layer/services/outages/scheduler.js';

const result = await runAddressImport('cli');
process.exit(result?.error ? 1 : 0);
