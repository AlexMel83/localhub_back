import { rateLimit } from 'express-rate-limit';
import ApiError from '../../middlewares/exceptions/api-errors.js';
import {
  getChanges,
  getSchedule,
  health,
  listRegions,
  listSettlements,
  listStreets,
  lookupHouse,
  searchAddress,
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

  app.get(
    "/outages/:region/address",
    wrap(async (req, res) => {
      if (!getRegion(req.params.region)) throw ApiError.NotFound("Unknown region");
      const q = String(req.query.q ?? "").slice(0, 120);
      const settlement = req.query.settlement ? String(req.query.settlement).slice(0, 80) : null;
      res.set("Cache-Control", "public, max-age=3600");
      res.json(await searchAddress(req.params.region, q, settlement));
    }),
  );

  app.get(
    "/outages/:region/settlements",
    wrap(async (req, res) => {
      if (!getRegion(req.params.region)) throw ApiError.NotFound("Unknown region");
      res.set("Cache-Control", "public, max-age=3600");
      res.json(await listSettlements(req.params.region, String(req.query.q ?? "").slice(0, 80)));
    }),
  );

  const text = (v, max) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));

  app.get(
    "/outages/:region/streets",
    wrap(async (req, res) => {
      if (!getRegion(req.params.region)) throw ApiError.NotFound("Unknown region");
      const settlement = text(req.query.settlement, 128);
      if (!settlement) throw ApiError.BadRequest("settlement is required");
      res.set("Cache-Control", "public, max-age=3600");
      res.json(
        await listStreets(req.params.region, {
          settlement,
          rem: text(req.query.rem, 128) || null,
          q: text(req.query.q, 80),
        }),
      );
    }),
  );

  app.get(
    "/outages/:region/house",
    wrap(async (req, res) => {
      if (!getRegion(req.params.region)) throw ApiError.NotFound("Unknown region");
      const settlement = text(req.query.settlement, 128);
      const street = text(req.query.street, 256);
      if (!settlement || !street) throw ApiError.BadRequest("settlement and street are required");
      res.set("Cache-Control", "public, max-age=3600");
      res.json(
        await lookupHouse(req.params.region, {
          settlement,
          street,
          rem: text(req.query.rem, 128) || null,
          house: text(req.query.house, 32) || null,
        }),
      );
    }),
  );
}
