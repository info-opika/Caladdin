import { Router, Request, Response } from 'express';
import { requireApiKey } from '../middleware/session.js';
import { runImprovementLoop } from '../jobs/improvement-loop.js';
import { runReminders } from '../jobs/reminders.js';
import { runSessionExpiry } from '../jobs/session-expiry.js';

export const jobsRouter = Router();

jobsRouter.use(requireApiKey);

jobsRouter.post('/improvement-loop', async (req: Request, res: Response) => {
  try {
    const result = await runImprovementLoop({
      lookbackDays: req.body.lookbackDays ?? 7,
      minFailuresPerGroup: req.body.minFailuresPerGroup ?? 3,
    });
    res.json({ status: 'complete', ...result });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.post('/reminders', async (_req: Request, res: Response) => {
  try {
    const result = await runReminders();
    res.json({ status: 'complete', ...result });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.post('/session-expiry', async (_req: Request, res: Response) => {
  try {
    const result = await runSessionExpiry();
    res.json({ status: 'complete', ...result, expired: result.sessions });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.get('/oauth-probe', async (_req: Request, res: Response) => {
  const { probeGoogleTokenEndpoint } = await import('../services/google_token_exchange.js');
  const { config } = await import('../config.js');
  const probe = await probeGoogleTokenEndpoint();
  res.json({
    ok: probe.ok,
    detail: probe.detail,
    redirectUri: config.googleRedirectUri,
    baseUrl: config.baseUrl,
    clientIdPrefix: config.googleClientId.trim().slice(0, 20),
  });
});
