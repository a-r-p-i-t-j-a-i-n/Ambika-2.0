import * as clientService from './client.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const createClient = async (req, res) => {
  const client = await clientService.createClient(req.body, req.user?._id);
  res.status(201).json(ApiResponse.created('Client created successfully', client));
};

export const getClients = async (req, res) => {
  const { data, meta } = await clientService.getClients(req.query);
  res.json(ApiResponse.ok('Clients fetched successfully', data, meta));
};

export const getClientById = async (req, res) => {
  const client = await clientService.getClientById(req.params.id);
  res.json(ApiResponse.ok('Client fetched successfully', client));
};

export const updateClient = async (req, res) => {
  const client = await clientService.updateClient(req.params.id, req.body, req.user?._id);
  res.json(ApiResponse.ok('Client updated successfully', client));
};
