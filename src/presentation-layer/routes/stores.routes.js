import validateMiddleware from '../../middlewares/validate-middleware.js';
// import authMiddleware from '../../middlewares/auth-middleware.js';
import storesController from '../controllers/stores-controller.js';
import { query } from 'express-validator';

const validateQueryStores = [
  query('id')
    .optional({ checkFalsy: true })
    .isNumeric()
    .withMessage('id is number'),
  query('slug')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('slug is string'),
  query('user_id')
    .optional({ checkFalsy: true })
    .isNumeric()
    .withMessage('user_id is number'),
  query('title')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('title is string'),
  query('description')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('description is string'),
];

export default function (app) {
  app.get(
    '/stores',
    validateQueryStores,
    validateMiddleware,
    storesController.getStores,
  );
}
