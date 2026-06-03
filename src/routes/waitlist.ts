import { Router, Request, Response } from 'express';
import { addToWaitlist } from '../db/waitlist.js';
import { checkPilotCapacity, MAX_PILOT_USERS } from '../pilot/pilot_controls.js';

export const waitlistRouter = Router();

waitlistRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const cap = await checkPilotCapacity();
    res.json({
      pilotOpen: cap.allowed,
      maxUsers: MAX_PILOT_USERS,
      message: cap.allowed ? 'Pilot open' : cap.message,
    });
  } catch {
    res.status(503).json({ error: 'Unavailable' });
  }
});

waitlistRouter.post('/', async (req: Request, res: Response) => {
  const email = req.body?.email as string;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Valid email required' });
    return;
  }
  try {
    const row = await addToWaitlist(email);
    res.json({ ok: true, email: row.email, status: row.status });
  } catch {
    res.status(500).json({ error: 'Could not join waitlist' });
  }
});
