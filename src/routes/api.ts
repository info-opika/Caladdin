import { Router, Request, Response } from 'express';
import { requireSession } from '../middleware/session.js';
import { listSessionsForHost } from '../db/scheduling_sessions.js';
import { insertFeedback } from '../db/feedback.js';

export const apiRouter = Router();

apiRouter.get('/sessions', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const sessions = await listSessionsForHost(session.userId);
  res.json({ sessions });
});

export const feedbackRouter = Router();

feedbackRouter.post('/', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  await insertFeedback({
    userId: session.userId,
    rating: req.body.rating,
    stars: req.body.stars,
    intent: req.body.intent,
    comment: req.body.comment,
  });
  res.json({ ok: true });
});
