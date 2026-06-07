import { Router, Request, Response, NextFunction } from 'express';
import { requireSession } from '../middleware/session.js';
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookSubscriptions,
  updateWebhookSubscription,
  type WebhookEvent,
} from '../db/webhook_subscriptions.js';

export const webhooksRouter = Router();

const ALLOWED_EVENTS: WebhookEvent[] = ['booking.confirmed', 'booking.cancelled'];

function parseEvents(value: unknown): WebhookEvent[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const events = value.filter((e): e is WebhookEvent => ALLOWED_EVENTS.includes(e as WebhookEvent));
  return events.length > 0 ? events : null;
}

webhooksRouter.get('/', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const subscriptions = await listWebhookSubscriptions(session.userId);
    res.json({
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        url: s.url,
        events: s.events,
        active: s.active,
        secret: s.secret,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

webhooksRouter.post('/', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const url = typeof req.body.url === 'string' ? req.body.url.trim() : '';
    const events = parseEvents(req.body.events);

    if (!url.startsWith('https://')) {
      res.status(400).json({ error: 'url must be an https URL' });
      return;
    }
    if (!events) {
      res.status(400).json({ error: 'events must include booking.confirmed and/or booking.cancelled' });
      return;
    }

    const created = await createWebhookSubscription(session.userId, { url, events });
    res.status(201).json({
      subscription: {
        id: created.id,
        url: created.url,
        events: created.events,
        active: created.active,
        secret: created.secret,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

webhooksRouter.patch('/:id', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const patch: Parameters<typeof updateWebhookSubscription>[2] = {};

    if (req.body.url !== undefined) {
      const url = String(req.body.url).trim();
      if (!url.startsWith('https://')) {
        res.status(400).json({ error: 'url must be an https URL' });
        return;
      }
      patch.url = url;
    }
    if (req.body.events !== undefined) {
      const events = parseEvents(req.body.events);
      if (!events) {
        res.status(400).json({ error: 'Invalid events list' });
        return;
      }
      patch.events = events;
    }
    if (req.body.active !== undefined) patch.active = Boolean(req.body.active);

    const updated = await updateWebhookSubscription(session.userId, String(req.params.id), patch);
    if (!updated) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    res.json({
      subscription: {
        id: updated.id,
        url: updated.url,
        events: updated.events,
        active: updated.active,
        secret: updated.secret,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

webhooksRouter.delete('/:id', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const deleted = await deleteWebhookSubscription(session.userId, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
