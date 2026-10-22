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

// Single-sign-on failures carry a machine-readable `code` so the embedded
// frontend can tell the Suite exactly which message to show the user.
const ssoFail = (res, statusCode, message, code) =>
  res.status(statusCode).json({ ...ApiResponse.fail(message), ...(code ? { code } : {}) });

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

  // Delegation Suite → ERP single sign-on. The Suite backend signs a 60-second
  // ticket with the shared ERP_SSO_SECRET; we verify it, find the ERP account
  // with the same email — creating it from the Delegation details the first
  // time that employee opens the ERP — and return the same { token, user } as
  // /login. Existing accounts are never changed.
  sso: asyncHandler(async (req, res) => {
    if (!env.ERP_SSO_SECRET) {
      return ssoFail(res, 503, 'ERP sign-in is not configured');
    }

    const ticket = req.body?.ticket;
    if (typeof ticket !== 'string' || !ticket.trim()) {
      return ssoFail(res, 400, 'A sign-in ticket is required');
    }

    let payload;
    try {
      payload = jwt.verify(ticket.trim(), env.ERP_SSO_SECRET, {
        algorithms: ['HS256'],
        issuer: 'ambika-suite',
        audience: 'agl-erp',
      });
    } catch {
      return ssoFail(res, 401, 'The sign-in ticket is invalid or has expired', 'invalid-ticket');
    }

    const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email) {
      return ssoFail(res, 401, 'The sign-in ticket is invalid or has expired', 'invalid-ticket');
    }

    let user = await authService.findByEmail(email);
    if (!user) {
      try {
        user = await authService.createFromSuite({
          email,
          name: typeof payload.name === 'string' ? payload.name.trim() : '',
          mobile: payload.mobile,
          suiteRole: payload.role,
        });
      } catch (err) {
        // e.g. no valid 10-digit mobile number in Delegation — the ERP needs one.
        if (err?.name === 'ValidationError') {
          return ssoFail(
            res, 403,
            'Ambika 2.0 needs a name and a valid 10-digit mobile number in your Delegation profile',
            'incomplete-profile',
          );
        }
        throw err;
      }
      if (!user) {
        return ssoFail(res, 403, 'No ERP account uses this email address', 'no-account');
      }
    }
    if (user.isActive === false) {
      return ssoFail(res, 403, 'This ERP account is inactive', 'inactive');
    }

    const token = signToken(user._id);
    user.password = undefined;
    return res.json(ApiResponse.ok('Signed in', { token, user }));
  }),

  getMe: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('User data retrieved', req.user));
  }),

  getEmployees: asyncHandler(async (req, res) => {
    const employees = await authService.getAllEmployees();
    res.json(ApiResponse.ok('Employees retrieved successfully', employees));
  }),

  createEmployee: asyncHandler(async (req, res) => {
    const user = await authService.register(req.body);
    user.password = undefined;
    res.status(201).json(ApiResponse.created('Employee created successfully', user));
  }),
};
