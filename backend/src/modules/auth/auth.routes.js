import { Router } from 'express';
import { authController } from './auth.controller.js';
import { protect, restrictTo } from '../../middleware/auth.middleware.js';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
// Single sign-on from the Delegation Suite (the ERP shown inside its sidebar).
router.post('/sso', authController.sso);
router.get('/me', protect, authController.getMe);

// Employee Management Routes
router.get('/employees', protect, restrictTo('MD'), authController.getEmployees);
router.post('/employees', protect, restrictTo('MD'), authController.createEmployee);

export default router;
