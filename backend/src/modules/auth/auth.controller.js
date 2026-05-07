import asyncHandler from '../../middleware/asyncHandler.js';
import { authService } from './auth.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import jwt from 'jsonwebtoken';
import env from '../../config/env.js';

const signToken = (id) => {
  return jwt.sign({ id }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
};

export const authController = {
  register: asyncHandler(async (req, res) => {
    const user = await authService.register(req.body);
    const token = signToken(user._id);
    user.password = undefined;
    res.status(201).json(ApiResponse.created('User registered', { token, user }));
  }),

  login: asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await authService.login(email, password);
    const token = signToken(user._id);
    user.password = undefined;
    res.json(ApiResponse.ok('Logged in successfully', { token, user }));
  }),

  getMe: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('User data retrieved', req.user));
  }),
};
