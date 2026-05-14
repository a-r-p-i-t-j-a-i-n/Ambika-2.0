import * as poService from './purchase-order.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const createPurchaseOrder = async (req, res) => {
  const po = await poService.createPurchaseOrder(req.body, req.user?._id);
  res.status(201).json(ApiResponse.created('Purchase Order created successfully', po));
};

export const getPurchaseOrders = async (req, res) => {
  const { data, meta } = await poService.getPurchaseOrders(req.query);
  res.json(ApiResponse.ok('Purchase Orders fetched successfully', data, meta));
};

export const getPurchaseOrderById = async (req, res) => {
  const po = await poService.getPurchaseOrderById(req.params.id);
  res.json(ApiResponse.ok('Purchase Order fetched successfully', po));
};

export const generateSalesOrder = async (req, res) => {
  const so = await poService.generateSalesOrder(req.params.id, req.user?._id);
  res.status(201).json(ApiResponse.created('Sales Order generated successfully', so));
};
