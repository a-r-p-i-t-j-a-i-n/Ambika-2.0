import * as skuService from './sku.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { userHasPermission } from '../../middleware/permission.middleware.js';

export const createSku = async (req, res) => {
  const sku = await skuService.createSku(req.body, req.user?._id);
  res.status(201).json(ApiResponse.created('SKU created successfully', sku));
};

export const getSkus = async (req, res) => {
  const { data, meta } = await skuService.getSkus(req.query);
  res.json(ApiResponse.ok('SKUs fetched successfully', data, meta));
};

export const getSkuById = async (req, res) => {
  const sku = await skuService.getSkuById(req.params.id);
  res.json(ApiResponse.ok('SKU fetched successfully', sku));
};

export const updateSku = async (req, res) => {
  const sku = await skuService.updateSku(req.params.id, req.body, req.user?._id, {
    canReclassify: userHasPermission(req, 'masters.editSku'),
  });
  res.json(ApiResponse.ok('SKU updated successfully', sku));
};

export const deleteSku = async (req, res) => {
  const result = await skuService.deleteSku(req.params.id, req.user?._id);
  res.json(ApiResponse.ok('SKU deleted successfully', result));
};

export const bulkUpsertSkus = async (req, res) => {
  const skus = await skuService.bulkUpsertSkus(req.body.items, req.user?._id);
  res.json(ApiResponse.ok('SKUs imported successfully', skus, { count: skus.length }));
};

export const getSkuLookup = async (req, res) => {
  const skus = await skuService.getSkuLookup(req.query);
  res.json(ApiResponse.ok('SKU lookup fetched successfully', skus));
};
