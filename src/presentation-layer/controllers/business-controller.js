import ApiError from '../../middlewares/exceptions/api-errors.js';
import businessModel from '../../data-layer/models/business-model.js';
import knex from '../../../config/knex.config.js'; // ✅ додано

const ErrorBd = {
  AvalableAmountMustBeLesThanAmount: '23514',
  WrongFieldsInserted: '22P02',
};

class BusinessController {
  async getBusiness(req, res) {
    try {
      const response = await businessModel.getBusinessByCondition(req.query);
      if (!response)
        return res.status(404).json(ApiError.NotFound('Business not found'));
      return res.json(response);
    } catch (error) {
      console.error(error);
      return res.status(500).json(ApiError.IntServError(error.message));
    }
  }

  async createBusiness(req, res) {
    try {
      const response = await businessModel.createBusiness(req.body);
      if (!response)
        return res
          .status(400)
          .json(ApiError.BadRequest('Business not created'));
      return res.status(201).json(response);
    } catch (error) {
      console.error(error);
      return res.status(500).json(ApiError.IntServError(error.message));
    }
  }

  async updateBusiness(req, res) {
    const trx = await knex.transaction();
    try {
      const fields = req.body;
      if (!fields.id) {
        return res.status(400).json(ApiError.BadRequest('Missing "id" field'));
      }

      const updated = await businessModel.updateBusiness(fields, trx);
      await trx.commit();

      if (!updated) {
        return res
          .status(404)
          .json(ApiError.NotFound(`Business with id ${fields.id} not found`));
      }

      return res.status(200).json(updated);
    } catch (error) {
      await trx.rollback();
      console.error('Update error:', error);
      if (error.code === ErrorBd.WrongFieldsInserted) {
        return res
          .status(400)
          .json(ApiError.BadRequest('Not allowed send empty fields'));
      } else if (error.code === ErrorBd.AvalableAmountMustBeLesThanAmount) {
        return res
          .status(400)
          .json(
            ApiError.BadRequest(
              'field available_amount must be less than amount',
            ),
          );
      } else {
        return res
          .status(500)
          .json(ApiError.IntServError(error.detail || error.message));
      }
    }
  }

  async removeBusiness(req, res) {
    try {
      const id = req.query.id;
      if (!id) return res.status(400).json(ApiError.BadRequest('Missing id'));

      const deleted = await businessModel.removeBusiness(id);
      if (!deleted) {
        return res
          .status(404)
          .json(ApiError.NotFound(`Business with id ${id} not found`));
      }

      return res.status(200).json({ success: true, id });
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json(ApiError.IntServError(error.detail || error.message));
    }
  }
}

export default new BusinessController();
