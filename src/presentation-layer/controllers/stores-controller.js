import ApiError from '../../middlewares/exceptions/api-errors.js';
import storesModel from '../../data-layer/models/stores-model.js';

const queryMappings = {
  id: 'id',
  slug: 'slug',
  user_id: 'user_id',
  title: 'title',
  description: 'description',
  sortField: 'sort_field',
  sortDirection: 'sortDirection',
};

class storesController {
  async getStores(req, res) {
    let conditions = {};
    try {
      const queryParams = req.query;
      for (const key in queryParams) {
        const mappedKey = queryMappings[key];
        if (mappedKey) {
          conditions[mappedKey] = queryParams[key];
        }
      }
      const response = await storesModel.getStoresByCondition(conditions);
      if (!response) {
        return res.json(ApiError.NotFound('stores not found'));
      }
      return res.json(response);
    } catch (error) {
      console.error(error);
      return res.json(ApiError.IntServError(error.message));
    }
  }
}

export default new storesController();
