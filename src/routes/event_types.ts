import { Router, Request, Response, NextFunction } from 'express';
import { requireSession } from '../middleware/session.js';
import { auditSensitiveOperation } from '../middleware/sensitiveAudit.js';
import { config } from '../config.js';
import { ensureUsername, getUserById } from '../db/users.js';
import {
  createEventType,
  deactivateEventType,
  getEventTypeById,
  listEventTypes,
  updateEventType,
  type EventType,
} from '../db/event_types.js';
import { listEventTypeMembers, setEventTypeMembers } from '../db/event_type_members.js';

export const eventTypesRouter = Router();

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function parseDuration(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0 || n > 480) return null;
  return n;
}

async function publicUrlFor(userId: string, slug: string): Promise<string> {
  const user = await getUserById(userId);
  const username = user?.username ?? (user ? await ensureUsername(userId, user.email) : null);
  if (!username) return `${config.baseUrl}/book/_/${slug}`;
  return `${config.baseUrl}/book/${username}/${slug}`;
}

function serializeEventType(eventType: EventType, publicUrl: string) {
  return {
    id: eventType.id,
    name: eventType.name,
    slug: eventType.slug,
    durationMinutes: eventType.durationMinutes,
    description: eventType.description,
    availabilityRules: eventType.availabilityRules,
    schedulingMode: eventType.schedulingMode,
    active: eventType.active,
    publicUrl,
    createdAt: eventType.createdAt,
    updatedAt: eventType.updatedAt,
  };
}

async function withPublicUrl(eventType: EventType) {
  const publicUrl = await publicUrlFor(eventType.userId, eventType.slug);
  return serializeEventType(eventType, publicUrl);
}

eventTypesRouter.get('/', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const includeInactive = req.query.includeInactive === 'true';
    const rows = await listEventTypes(session.userId, includeInactive);
    const eventTypes = await Promise.all(rows.map(withPublicUrl));
    res.json({ eventTypes });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.post('/', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string; email: string } }).session;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const durationMinutes = parseDuration(req.body.durationMinutes ?? req.body.duration);
    const slugInput = typeof req.body.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
    const slug = slugInput || slugifyName(name);

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (!durationMinutes) {
      res.status(400).json({ error: 'durationMinutes must be between 1 and 480' });
      return;
    }
    if (!slug || !SLUG_RE.test(slug)) {
      res.status(400).json({ error: 'slug must be lowercase letters, numbers, and hyphens' });
      return;
    }

    const user = await getUserById(session.userId);
    if (user) await ensureUsername(session.userId, user.email);

    const description =
      req.body.description === undefined || req.body.description === null
        ? null
        : String(req.body.description);
    const availabilityRules =
      req.body.availabilityRules && typeof req.body.availabilityRules === 'object'
        ? (req.body.availabilityRules as Record<string, unknown>)
        : {};
    const schedulingMode =
      req.body.schedulingMode === 'round_robin' ? 'round_robin' : req.body.schedulingMode === 'single' ? 'single' : undefined;

    const created = await createEventType(session.userId, {
      name,
      slug,
      durationMinutes,
      description,
      availabilityRules,
      schedulingMode,
    });
    await auditSensitiveOperation(req, session.userId, 'EVENT_TYPE_CREATE', 'success', { slug });
    res.status(201).json({ eventType: await withPublicUrl(created) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('duplicate key') || message.includes('unique')) {
      res.status(409).json({ error: 'An event type with this slug already exists' });
      return;
    }
    next(err);
  }
});

eventTypesRouter.get('/:id', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const eventType = await getEventTypeById(session.userId, String(req.params.id));
    if (!eventType) {
      res.status(404).json({ error: 'Event type not found' });
      return;
    }
    res.json({ eventType: await withPublicUrl(eventType) });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.patch('/:id', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const patch: Parameters<typeof updateEventType>[2] = {};

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        res.status(400).json({ error: 'Name cannot be empty' });
        return;
      }
      patch.name = name;
    }
    if (req.body.slug !== undefined) {
      const slug = String(req.body.slug).trim().toLowerCase();
      if (!SLUG_RE.test(slug)) {
        res.status(400).json({ error: 'slug must be lowercase letters, numbers, and hyphens' });
        return;
      }
      patch.slug = slug;
    }
    if (req.body.durationMinutes !== undefined || req.body.duration !== undefined) {
      const durationMinutes = parseDuration(req.body.durationMinutes ?? req.body.duration);
      if (!durationMinutes) {
        res.status(400).json({ error: 'durationMinutes must be between 1 and 480' });
        return;
      }
      patch.durationMinutes = durationMinutes;
    }
    if (req.body.description !== undefined) patch.description = req.body.description ?? null;
    if (req.body.availabilityRules !== undefined && typeof req.body.availabilityRules === 'object') {
      patch.availabilityRules = req.body.availabilityRules as Record<string, unknown>;
    }
    if (req.body.schedulingMode === 'round_robin' || req.body.schedulingMode === 'single') {
      patch.schedulingMode = req.body.schedulingMode;
    }
    if (req.body.active !== undefined) patch.active = Boolean(req.body.active);

    const updated = await updateEventType(session.userId, String(req.params.id), patch);
    if (!updated) {
      res.status(404).json({ error: 'Event type not found' });
      return;
    }
    await auditSensitiveOperation(req, session.userId, 'EVENT_TYPE_UPDATE', 'success', {
      eventTypeId: req.params.id,
    });
    res.json({ eventType: await withPublicUrl(updated) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('duplicate key') || message.includes('unique')) {
      res.status(409).json({ error: 'An event type with this slug already exists' });
      return;
    }
    next(err);
  }
});

eventTypesRouter.get('/:id/members', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const eventType = await getEventTypeById(session.userId, String(req.params.id));
    if (!eventType) {
      res.status(404).json({ error: 'Event type not found' });
      return;
    }
    const members = await listEventTypeMembers(session.userId, eventType.id);
    res.json({ members: members.map((m) => ({ userId: m.userId, position: m.position })) });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.put('/:id/members', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const eventType = await getEventTypeById(session.userId, String(req.params.id));
    if (!eventType) {
      res.status(404).json({ error: 'Event type not found' });
      return;
    }
    const memberUserIds = Array.isArray(req.body.memberUserIds)
      ? req.body.memberUserIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const members = await setEventTypeMembers(session.userId, eventType.id, memberUserIds);
    res.json({ members: members.map((m) => ({ userId: m.userId, position: m.position })) });
  } catch (err) {
    next(err);
  }
});

eventTypesRouter.delete('/:id', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = (req as Request & { session: { userId: string } }).session;
    const updated = await deactivateEventType(session.userId, String(req.params.id));
    if (!updated) {
      res.status(404).json({ error: 'Event type not found' });
      return;
    }
    await auditSensitiveOperation(req, session.userId, 'EVENT_TYPE_DELETE', 'success', {
      eventTypeId: req.params.id,
    });
    res.json({ eventType: await withPublicUrl(updated) });
  } catch (err) {
    next(err);
  }
});
