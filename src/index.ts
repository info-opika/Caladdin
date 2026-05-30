import express from 'express';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorSanitizer, notFoundHandler } from './middleware/errorSanitizer.js';
import { authRouter } from './routes/auth.js';
import { voiceRouter } from './routes/voice.js';
import { confirmRouter } from './routes/confirm.js';
import { schedulingRouter } from './routes/scheduling.js';
import { apiRouter, feedbackRouter } from './routes/api.js';
import { jobsRouter } from './routes/jobs.js';
import { startCompensationWorker } from './jobs/compensation-worker.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(requestIdMiddleware);
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.use('/auth', authRouter);
app.use('/voice', voiceRouter);
app.use('/confirm', confirmRouter);
app.use('/s', schedulingRouter);
app.use('/api', apiRouter);
app.use('/feedback', feedbackRouter);
app.use('/jobs', jobsRouter);

// In development serve web/ source so UI changes apply without running build:web.
const webRoot = join(__dirname, '..', config.isProd ? 'web/dist' : 'web');
app.use(express.static(webRoot));
app.get('/', (_req, res) => {
  res.sendFile(join(webRoot, 'index.html'), (err) => {
    if (err) res.redirect('/auth/start');
  });
});

app.use(notFoundHandler);
app.use(errorSanitizer);

const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

if (!isTest) {
  startCompensationWorker();
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
