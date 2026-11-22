import { rateLimit } from 'express-rate-limit';
import ApiError from '../../middlewares/exceptions/api-errors.js';
import {
  getChanges,
  getSchedule,
  health,
  listRegions,
  resolveDate,
} from '../../service-layer/services/outages/outage-service.js';
import { getRegion } from '../../service-layer/services/outages/regions.js';

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function params(req) {
  if (!getRegion(req.params.region)) throw ApiError.NotFound('Unknown region');
  const date = resolveDate(req.query.date);
  if (!date) throw ApiError.BadRequest('date must be today, tomorrow or YYYY-MM-DD within the last 31 days');
  return { region: req.params.region, date };
}

export default function (app) {
  app.use('/outages', limiter);

  app.get(
    '/outages/regions',
    wrap(async (req, res) => {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(await listRegions());
    }),
  );

  app.get(
    '/outages/health',
    wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await health());
    }),
  );

  app.get(
    '/outages/:region/schedule',
    wrap(async (req, res) => {
      const { region, date } = params(req);
      res.set('Cache-Control', 'public, max-age=60');
      res.json(await getSchedule(region, date));
    }),
  );

  app.get(
    '/outages/:region/changes',
    wrap(async (req, res) => {
      const { region, date } = params(req);
      res.set('Cache-Control', 'public, max-age=60');
      res.json(await getChanges(region, date));
    }),
  );
}
