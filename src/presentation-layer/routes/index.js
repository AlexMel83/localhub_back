import uploadsRouteInit from './uploads.routes.js';
import authRouteInit from './auth.routes.js';
import businessRouteInit from './business.routes.js';
import geoQueriesRouteInit from './geo-queries.routes.js';
import outagesRouteInit from './outages.routes.js';
import telegramRouteInit from './telegram.routes.js';

const routeInit = (app, express) => {
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  authRouteInit(app);
  businessRouteInit(app);
  uploadsRouteInit(app);
  geoQueriesRouteInit(app);
  outagesRouteInit(app);
  telegramRouteInit(app);
};

export default routeInit;
