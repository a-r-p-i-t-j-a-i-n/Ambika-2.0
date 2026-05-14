import Client from './client.model.js';
import { AppError } from '../../utils/apiResponse.js';

export const createClient = async (data, userId) => {
  const existingClient = await Client.findOne({ code: data.code });
  if (existingClient) {
    throw new AppError('Client code must be unique', 400);
  }
  
  const client = new Client({
    ...data,
    createdBy: userId
  });
  
  return await client.save();
};

export const getClients = async (query = {}) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;
  const skip = (page - 1) * limit;
  
  const filter = { isDeleted: false };
  
  // Basic Search
  if (query.search) {
    filter.$or = [
      { companyName: new RegExp(query.search, 'i') },
      { code: new RegExp(query.search, 'i') },
      { 'emails': new RegExp(query.search, 'i') }
    ];
  }
  
  const [data, total] = await Promise.all([
    Client.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
    Client.countDocuments(filter)
  ]);
  
  return { data, meta: { total, page, limit } };
};

export const getClientById = async (id) => {
  const client = await Client.findOne({ _id: id, isDeleted: false });
  if (!client) throw new AppError('Client not found', 404);
  return client;
};

export const updateClient = async (id, data, userId) => {
  const client = await Client.findOne({ _id: id, isDeleted: false });
  if (!client) throw new AppError('Client not found', 404);
  
  Object.assign(client, data);
  client.updatedBy = userId;
  
  return await client.save();
};
