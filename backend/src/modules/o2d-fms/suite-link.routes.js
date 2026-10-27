import { Router } from 'express';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { completeFromDelegation } from './o2d-delegation.js';
import { readSuiteEnvelope } from './suite-client.js';

/**
 * Server-to-server calls from the Delegation Suite backend. There is no ERP
 * login here: every request must carry the Suite's signature (made with the
 * shared ERP_SSO_SECRET — see o2d-delegation.js), or it is refused.
 */
const router = Router();

// A Delegation task for an O2D step was marked Completed → complete the step.
router.post('/o2d/complete', asyncHandler(async (req, res) => {
  const data = readSuiteEnvelope(req.body);
  res.json(ApiResponse.ok('O2D step completed', await completeFromDelegation(data)));
}));

export default router;
