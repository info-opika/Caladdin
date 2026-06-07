import { config } from '../config.js';

export type RedisPingStatus = 'ok' | 'error' | 'skipped';

/** Optional Redis ping when REDIS_URL is set (rate-limit backend upgrade path). */
export async function pingRedis(): Promise<RedisPingStatus> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    return 'skipped';
  }
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return 'ok';
  }

  try {
    const net = await import('net');
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parseInt(parsed.port || '6379', 10);

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Redis connect timeout'));
      }, 2000);

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.end();
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    return 'ok';
  } catch {
    return config.isProd ? 'error' : 'skipped';
  }
}
