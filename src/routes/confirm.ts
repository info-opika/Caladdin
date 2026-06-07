import { Router, Request, Response } from 'express';
import { requireApiKey } from '../middleware/session.js';
import { approvePendingConfirmation, rejectPendingConfirmation } from '../core/confirmation-actions.js';

export const confirmRouter = Router();

confirmRouter.use(requireApiKey);

confirmRouter.post('/:token/approve', async (req: Request, res: Response) => {
  const { status, body } = await approvePendingConfirmation(String(req.params.token));
  res.status(status).json(body);
});

confirmRouter.post('/:token/reject', async (req: Request, res: Response) => {
  const { status, body } = await rejectPendingConfirmation(String(req.params.token));
  res.status(status).json(body);
});
