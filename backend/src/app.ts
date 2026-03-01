import express from 'express';
import cors from 'cors';
import { departuresRouter } from './routes/departures';
import { vehiclesRouter } from './routes/vehicles';
import { sseRouter } from './routes/sse';
import { statsRouter } from './routes/stats';
import { checkinRouter } from './routes/checkin';

/**
 * Create and configure the Express app.
 * Separated from index.ts so tests can import the app without
 * triggering database init, GTFS loading, or polling.
 */
export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
  app.use(express.json({ limit: '10kb' }));

  // API routes
  app.use('/api/departures', departuresRouter);
  app.use('/api/vehicles/stream', sseRouter);
  app.use('/api/vehicles', vehiclesRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/checkin', checkinRouter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
