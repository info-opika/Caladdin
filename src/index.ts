import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { pingDb } from './db/client.js';
import { pingRedis } from './services/redis.js';
import { securityHeadersMiddleware } from './middleware/securityHeaders.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { csrfProtectionMiddleware } from './middleware/csrf.js';
import { errorSanitizer } from './middleware/errorSanitizer.js';
import { authRouter } from './routes/auth.js';
import { voiceRouter } from './routes/voice.js';
import { confirmRouter } from './routes/confirm.js';
import { waitlistRouter } from './routes/waitlist.js';
import { inviteRouter } from './routes/invite.js';
import schedulePublicRoutes from './routes/schedule_public.js';
import { apiRouter, feedbackRouter } from './routes/api.js';
import { eventTypesRouter } from './routes/event_types.js';
import { bookPublicRouter } from './routes/book_public.js';
import { webhooksRouter } from './routes/webhooks.js';
import { jobsRouter } from './routes/jobs.js';
import { startCompensationWorker } from './jobs/compensation-worker.js';
import { startSessionExpiryWorker } from './jobs/session-expiry.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const processStartMs = Date.now();

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

app.use(securityHeadersMiddleware);
app.use(requestIdMiddleware);
app.use(compression({ threshold: 1024 }));
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));
app.use(csrfProtectionMiddleware);

app.get('/health', async (_req, res) => {
  const db = await pingDb();
  const redis = await pingRedis();
  const version = getAppVersion();
  const uptime = Math.floor((Date.now() - processStartMs) / 1000);

  const redisRequired =
    process.env.NODE_ENV === 'production' && Boolean(process.env.REDIS_URL?.trim());
  const redisUnhealthy = redis === 'error' && redisRequired;
  const unhealthy = db === 'error' || redisUnhealthy;

  res.status(unhealthy ? 503 : 200).json({
    status: unhealthy ? 'error' : 'ok',
    db,
    redis,
    version,
    uptime,
  });
});

app.use('/waitlist', waitlistRouter);
app.use('/auth', authRouter);
app.use('/voice', voiceRouter);
app.use('/confirm', confirmRouter);
app.use(schedulePublicRoutes);
app.use('/invite', inviteRouter);
app.use('/api', apiRouter);
app.use('/api/event-types', eventTypesRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/book', bookPublicRouter);
app.use('/feedback', feedbackRouter);
app.use('/jobs', jobsRouter);

// In development serve web/ source so UI changes apply without running build:web.
const webRoot = join(__dirname, '..', config.isProd ? 'web/dist' : 'web');
app.set('webRoot', webRoot);
app.use(express.static(webRoot));

app.get('/embed.js', (_req, res) => {
  res.type('application/javascript').sendFile(join(webRoot, 'embed.js'));
});

app.get('/', (_req, res) => {
  res.sendFile(join(webRoot, 'index.html'), (err) => {
    if (err) res.redirect('/auth/start');
  });
});

function notFoundHandler(req: express.Request, res: express.Response): void {
  if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api')) {
    res.status(404).sendFile(join(webRoot, '404.html'), (err) => {
      if (err) res.status(404).json({ error: 'Not found' });
    });
    return;
  }
  res.status(404).json({ error: 'Not found' });
}

app.use(notFoundHandler);
app.use(errorSanitizer);

const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

if (!isTest) {
  startCompensationWorker();
  startSessionExpiryWorker();
  const server = app.listen(config.port, () => {
    logger.info(`Caladdin listening on ${config.baseUrl}`, { port: config.port });
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use. Stop the other process or set PORT in .env`, {
        port: config.port,
        hint: `Windows: netstat -ano | findstr :${config.port} then taskkill /PID <pid> /F`,
      });
      process.exit(1);
    }
    throw err;
  });
}

export { app };
