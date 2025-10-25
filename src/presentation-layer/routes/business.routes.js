import validateMiddleware from '../../middlewares/validate-middleware.js';
import businessController from '../controllers/business-controller.js';
import { body, query } from 'express-validator';

const validateQueryBusiness = [
  query('id').optional({ checkFalsy: true }).isNumeric(),
  query('slug').optional({ checkFalsy: true }).isString(),
  query('user_id').optional({ checkFalsy: true }).isNumeric(),
  query('title').optional({ checkFalsy: true }).isString(),
  query('description').optional({ checkFalsy: true }).isString(),
];

const validateBodyBusiness = [
  body('id').optional({ checkFalsy: true }).isNumeric(),
  body('slug').optional({ checkFalsy: true }).isString().isAscii(),
  body('user_id').optional({ checkFalsy: true }).isNumeric(),
  body('title').optional({ checkFalsy: true }).isString(),
  body('description').optional({ checkFalsy: true }).isString(),
];

export default function (app) {
  app.get(
    '/business',
    validateQueryBusiness,
    validateMiddleware,
    businessController.getBusiness,
  );

  app.post(
    '/business/create',
    validateBodyBusiness,
    validateMiddleware,
    businessController.createBusiness,
  );

  app.put(
    '/business',
    [
      body('id').notEmpty().withMessage('Поле "id" обов\'язкове для оновлення'),
      ...validateBodyBusiness,
      validateMiddleware,
    ],
    businessController.updateBusiness,
  );

  app.delete(
    '/business',
    [query('id').notEmpty().withMessage('Id is required'), validateMiddleware],
    businessController.removeBusiness,
  );
}
